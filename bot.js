require("dotenv").config()
const TelegramBot = require("node-telegram-bot-api")
const { sequelize, User, Group, GroupRequest, UserGroup, Subject, Task, UserTask } = require("./index")
const cron = require("node-cron")

const token = process.env.TELEGRAM_TOKEN
const bot = new TelegramBot(token, { polling: true })

// Хранилище состояний пользователей
const userStates = new Map()

// Инициализация базы данных
async function initDB() {
  try {
    await sequelize.authenticate()
    console.log("Подключение к базе данных установлено.")
    await sequelize.sync()
    console.log("Модели синхронизированы.")
  } catch (error) {
    console.error("Ошибка подключения к базе данных:", error)
  }
}

// Получение или создание пользователя
async function getOrCreateUser(msg) {
  const [user] = await User.findOrCreate({
    where: { telegram_id: msg.from.id },
    defaults: {
      telegram_id: msg.from.id,
      username: msg.from.username,
      first_name: msg.from.first_name,
      last_name: msg.from.last_name,
    },
  })
  return user
}

// Проверка роли администратора
async function isAdmin(telegramId) {
  const user = await User.findOne({ where: { telegram_id: telegramId } })
  return user && user.role === "admin"
}

// Проверка роли куратора группы
async function isCurator(userId, groupId) {
  const userGroup = await UserGroup.findOne({
    where: { user_id: userId, group_id: groupId, role: "curator" },
  })
  return !!userGroup
}

// Главное меню
function getMainMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📚 Выбрать группу", callback_data: "select_group" }],
        [{ text: "➕ Добавить группу", callback_data: "add_group" }],
        [{ text: "⏳ Заявки на группы", callback_data: "pending_groups" }],
        [{ text: "⚙️ Настройки", callback_data: "settings" }],
      ],
    },
  }
}

// Меню группы
function getGroupMenu(groupId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📋 Задачи", callback_data: `group_tasks_${groupId}` }],
        [{ text: "➕ Добавить задачу", callback_data: `add_task_${groupId}` }],
        [{ text: "✅ Отметить выполненное", callback_data: `mark_completed_${groupId}` }],
        [{ text: "🔙 Назад", callback_data: "back_to_main" }],
      ],
    },
  }
}

// Команда /start
bot.onText(/\/start/, async (msg) => {
  const user = await getOrCreateUser(msg)
  const welcomeText = `Привет, ${user.first_name}! 👋\n\nЯ помощник студента. Выберите действие:`

  bot.sendMessage(msg.chat.id, welcomeText, getMainMenu())
})

// Обработка callback запросов
bot.on("callback_query", async (callbackQuery) => {
  const msg = callbackQuery.message
  const data = callbackQuery.data
  const user = await getOrCreateUser({ from: callbackQuery.from })

  try {
    if (data === "select_group") {
      await handleSelectGroup(msg, user)
    } else if (data === "add_group") {
      await handleAddGroup(msg, user)
    } else if (data === "pending_groups") {
      await handlePendingGroups(msg, user)
    } else if (data === "settings") {
      await handleSettings(msg, user)
    } else if (data === "back_to_main") {
      await handleBackToMain(msg)
    } else if (data.startsWith("select_group_")) {
      const groupId = data.split("_")[2]
      await handleGroupSelected(msg, user, groupId)
    } else if (data.startsWith("group_tasks_")) {
      const groupId = data.split("_")[2]
      await handleGroupTasks(msg, user, groupId)
    } else if (data.startsWith("add_task_")) {
      const groupId = data.split("_")[2]
      await handleAddTask(msg, user, groupId)
    } else if (data.startsWith("mark_completed_")) {
      const groupId = data.split("_")[2]
      await handleMarkCompleted(msg, user, groupId)
    } else if (data.startsWith("approve_group_")) {
      const requestId = data.split("_")[2]
      await handleApproveGroup(msg, user, requestId)
    } else if (data.startsWith("reject_group_")) {
      const requestId = data.split("_")[2]
      await handleRejectGroup(msg, user, requestId)
    }

    bot.answerCallbackQuery(callbackQuery.id)
  } catch (error) {
    console.error("Ошибка обработки callback:", error)
    bot.answerCallbackQuery(callbackQuery.id, { text: "Произошла ошибка" })
  }
})

// Выбор группы
async function handleSelectGroup(msg, user) {
  const userGroups = await UserGroup.findAll({
    where: { user_id: user.id },
    include: [Group],
  })

  if (userGroups.length === 0) {
    bot.editMessageText("У вас нет доступных групп. Добавьте группу или попросите куратора добавить вас.", {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      ...getMainMenu(),
    })
    return
  }

  const keyboard = userGroups.map((ug) => [{ text: ug.Group.name, callback_data: `select_group_${ug.Group.id}` }])
  keyboard.push([{ text: "🔙 Назад", callback_data: "back_to_main" }])

  bot.editMessageText("Выберите группу:", {
    chat_id: msg.chat.id,
    message_id: msg.message_id,
    reply_markup: { inline_keyboard: keyboard },
  })
}

// Добавление группы
async function handleAddGroup(msg, user) {
  userStates.set(user.telegram_id, { action: "adding_group" })

  bot.editMessageText("Введите название группы, которую хотите добавить:", {
    chat_id: msg.chat.id,
    message_id: msg.message_id,
    reply_markup: {
      inline_keyboard: [[{ text: "❌ Отмена", callback_data: "back_to_main" }]],
    },
  })
}

// Заявки на группы (только для админов)
async function handlePendingGroups(msg, user) {
  if (!(await isAdmin(user.telegram_id))) {
    bot.editMessageText("У вас нет прав для просмотра заявок.", {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      ...getMainMenu(),
    })
    return
  }

  const pendingRequests = await GroupRequest.findAll({
    where: { status: "pending" },
    include: [User],
  })

  if (pendingRequests.length === 0) {
    bot.editMessageText("Нет заявок на рассмотрении.", {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      ...getMainMenu(),
    })
    return
  }

  let text = "Заявки на создание групп:\n\n"
  const keyboard = []

  pendingRequests.forEach((request) => {
    text += `📝 ${request.group_name}\nОт: ${request.User.first_name}\n\n`
    keyboard.push([
      { text: `✅ ${request.group_name}`, callback_data: `approve_group_${request.id}` },
      { text: `❌ ${request.group_name}`, callback_data: `reject_group_${request.id}` },
    ])
  })

  keyboard.push([{ text: "🔙 Назад", callback_data: "back_to_main" }])

  bot.editMessageText(text, {
    chat_id: msg.chat.id,
    message_id: msg.message_id,
    reply_markup: { inline_keyboard: keyboard },
  })
}

// Настройки
async function handleSettings(msg, user) {
  const text = `Настройки:\n\n🔔 Уведомления: ${user.notifications_enabled ? "Включены" : "Выключены"}`

  bot.editMessageText(text, {
    chat_id: msg.chat.id,
    message_id: msg.message_id,
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: user.notifications_enabled ? "🔕 Выключить уведомления" : "🔔 Включить уведомления",
            callback_data: "toggle_notifications",
          },
        ],
        [{ text: "🔙 Назад", callback_data: "back_to_main" }],
      ],
    },
  })
}

// Возврат в главное меню
async function handleBackToMain(msg) {
  bot.editMessageText("Главное меню:", {
    chat_id: msg.chat.id,
    message_id: msg.message_id,
    ...getMainMenu(),
  })
}

// Выбрана группа
async function handleGroupSelected(msg, user, groupId) {
  const group = await Group.findByPk(groupId)
  if (!group) {
    bot.editMessageText("Группа не найдена.", {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      ...getMainMenu(),
    })
    return
  }

  userStates.set(user.telegram_id, { selectedGroup: groupId })

  bot.editMessageText(`Группа: ${group.name}\n\nВыберите действие:`, {
    chat_id: msg.chat.id,
    message_id: msg.message_id,
    ...getGroupMenu(groupId),
  })
}

// Просмотр задач группы
async function handleGroupTasks(msg, user, groupId) {
  const tasks = await Task.findAll({
    where: { group_id: groupId, status: "active" },
    include: [Subject],
    order: [["deadline", "ASC"]],
  })

  if (tasks.length === 0) {
    bot.editMessageText("В группе пока нет задач.", {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      ...getGroupMenu(groupId),
    })
    return
  }

  let text = "📋 Задачи группы:\n\n"

  for (const task of tasks) {
    const userTask = await UserTask.findOne({
      where: { user_id: user.id, task_id: task.id },
    })

    const status = userTask?.completed ? "✅" : "⏳"
    const deadline = new Date(task.deadline).toLocaleDateString("ru-RU")

    text += `${status} ${task.title}\n`
    text += `📚 ${task.Subject.name}\n`
    text += `📅 До: ${deadline}\n`
    if (task.description) {
      text += `📝 ${task.description}\n`
    }
    text += "\n"
  }

  bot.editMessageText(text, {
    chat_id: msg.chat.id,
    message_id: msg.message_id,
    ...getGroupMenu(groupId),
  })
}

// Добавление задачи
async function handleAddTask(msg, user, groupId) {
  userStates.set(user.telegram_id, {
    action: "adding_task",
    selectedGroup: groupId,
    step: "title",
  })

  bot.editMessageText("Введите название задачи:", {
    chat_id: msg.chat.id,
    message_id: msg.message_id,
    reply_markup: {
      inline_keyboard: [[{ text: "❌ Отмена", callback_data: `select_group_${groupId}` }]],
    },
  })
}

// Отметить задачу как выполненную
async function handleMarkCompleted(msg, user, groupId) {
  const tasks = await Task.findAll({
    where: { group_id: groupId, status: "active" },
    include: [Subject],
  })

  const incompleteTasks = []
  for (const task of tasks) {
    const userTask = await UserTask.findOne({
      where: { user_id: user.id, task_id: task.id },
    })

    if (!userTask || !userTask.completed) {
      incompleteTasks.push(task)
    }
  }

  if (incompleteTasks.length === 0) {
    bot.editMessageText("Все задачи выполнены! 🎉", {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      ...getGroupMenu(groupId),
    })
    return
  }

  const keyboard = incompleteTasks.map((task) => [
    { text: `✅ ${task.title}`, callback_data: `complete_task_${task.id}` },
  ])
  keyboard.push([{ text: "🔙 Назад", callback_data: `select_group_${groupId}` }])

  bot.editMessageText("Выберите задачу для отметки как выполненная:", {
    chat_id: msg.chat.id,
    message_id: msg.message_id,
    reply_markup: { inline_keyboard: keyboard },
  })
}

// Обработка текстовых сообщений
bot.on("message", async (msg) => {
  if (msg.text && !msg.text.startsWith("/")) {
    const user = await getOrCreateUser(msg)
    const state = userStates.get(user.telegram_id)

    if (state?.action === "adding_group") {
      await GroupRequest.create({
        group_name: msg.text,
        requested_by: user.id,
      })

      userStates.delete(user.telegram_id)
      bot.sendMessage(msg.chat.id, "Заявка на создание группы отправлена администратору!", getMainMenu())
    } else if (state?.action === "adding_task") {
      await handleTaskCreationStep(msg, user, state)
    }
  }
})

// Обработка шагов создания задачи
async function handleTaskCreationStep(msg, user, state) {
  if (state.step === "title") {
    state.taskData = { title: msg.text }
    state.step = "description"
    bot.sendMessage(msg.chat.id, 'Введите описание задачи (или отправьте "-" чтобы пропустить):')
  } else if (state.step === "description") {
    state.taskData.description = msg.text === "-" ? null : msg.text
    state.step = "deadline"
    bot.sendMessage(msg.chat.id, "Введите дедлайн в формате ДД.ММ.ГГГГ:")
  } else if (state.step === "deadline") {
    try {
      const [day, month, year] = msg.text.split(".")
      const deadline = new Date(year, month - 1, day)

      if (isNaN(deadline.getTime())) {
        throw new Error("Неверный формат даты")
      }

      state.taskData.deadline = deadline

      // Получаем предметы группы
      const subjects = await Subject.findAll({
        where: { group_id: state.selectedGroup, status: "active" },
      })

      if (subjects.length === 0) {
        bot.sendMessage(msg.chat.id, "В группе нет предметов. Сначала добавьте предмет.")
        userStates.delete(user.telegram_id)
        return
      }

      const keyboard = subjects.map((subject) => [
        { text: subject.name, callback_data: `select_subject_${subject.id}` },
      ])
      keyboard.push([{ text: "➕ Добавить новый предмет", callback_data: "add_new_subject" }])

      state.step = "subject"
      bot.sendMessage(msg.chat.id, "Выберите предмет:", {
        reply_markup: { inline_keyboard: keyboard },
      })
    } catch (error) {
      bot.sendMessage(msg.chat.id, "Неверный формат даты. Используйте ДД.ММ.ГГГГ (например, 25.12.2024):")
    }
  }
}

// Система уведомлений о дедлайнах
cron.schedule("0 9 * * *", async () => {
  console.log("Проверка дедлайнов...")

  const now = new Date()
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)

  // Уведомления за неделю
  const weekTasks = await Task.findAll({
    where: {
      deadline: {
        [require("sequelize").Op.between]: [now, weekFromNow],
      },
      status: "active",
    },
    include: [Subject, Group],
  })

  // Уведомления за 3 дня
  const urgentTasks = await Task.findAll({
    where: {
      deadline: {
        [require("sequelize").Op.between]: [now, threeDaysFromNow],
      },
      status: "active",
    },
    include: [Subject, Group],
  })

  // Отправка уведомлений
  for (const task of [...weekTasks, ...urgentTasks]) {
    const users = await UserGroup.findAll({
      where: { group_id: task.group_id },
      include: [User],
    })

    const daysLeft = Math.ceil((new Date(task.deadline) - now) / (1000 * 60 * 60 * 24))
    const urgencyIcon = daysLeft <= 3 ? "🚨" : "⏰"

    for (const userGroup of users) {
      if (userGroup.User.notifications_enabled) {
        const message =
          `${urgencyIcon} Напоминание о дедлайне!\n\n` +
          `📚 Предмет: ${task.Subject.name}\n` +
          `📝 Задача: ${task.title}\n` +
          `📅 Дедлайн: ${new Date(task.deadline).toLocaleDateString("ru-RU")}\n` +
          `⏳ Осталось дней: ${daysLeft}`

        try {
          await bot.sendMessage(userGroup.User.telegram_id, message)
        } catch (error) {
          console.error(`Ошибка отправки уведомления пользователю ${userGroup.User.telegram_id}:`, error)
        }
      }
    }
  }
})

// Обработка утверждения группы
async function handleApproveGroup(msg, user, requestId) {
  const request = await GroupRequest.findByPk(requestId)
  if (!request) {
    bot.editMessageText("Заявка не найдена.", {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      ...getMainMenu(),
    })
    return
  }

  await request.update({ status: "approved" })
  await Group.create({ name: request.group_name })

  bot.editMessageText("Заявка одобрена!", {
    chat_id: msg.chat.id,
    message_id: msg.message_id,
    ...getMainMenu(),
  })
}

// Обработка отклонения группы
async function handleRejectGroup(msg, user, requestId) {
  const request = await GroupRequest.findByPk(requestId)
  if (!request) {
    bot.editMessageText("Заявка не найдена.", {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      ...getMainMenu(),
    })
    return
  }

  await request.update({ status: "rejected" })

  bot.editMessageText("Заявка отклонена.", {
    chat_id: msg.chat.id,
    message_id: msg.message_id,
    ...getMainMenu(),
  })
}

// Инициализация
initDB().then(() => {
  console.log("Бот запущен!")
})

module.exports = bot

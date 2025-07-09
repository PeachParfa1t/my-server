require("dotenv").config()
const TelegramBot = require("node-telegram-bot-api")
const { sequelize, User, Group, GroupRequest, UserGroup, Subject, Task, UserTask } = require("./index")
const cron = require("node-cron")

const token = process.env.TELEGRAM_TOKEN
const bot = new TelegramBot(token, { polling: true })

// Хранилище состояний пользователей
const userStates = new Map()

// Константы для пагинации
const GROUPS_PER_PAGE = 5
const TASKS_PER_PAGE = 10

// Инициализация базы данных
async function initDB() {
  try {
    await sequelize.authenticate()
    console.log("✅ Подключение к базе данных установлено.")
    await sequelize.sync()
    console.log("✅ Модели синхронизированы.")
    await createTestData()
  } catch (error) {
    console.error("❌ Ошибка подключения к базе данных:", error)
    process.exit(1)
  }
}

// Получение или создание пользователя
async function getOrCreateUser(msg) {
  try {
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
  } catch (error) {
    console.error("Ошибка создания пользователя:", error)
    throw error
  }
}

// Проверка роли администратора
async function isAdmin(telegramId) {
  try {
    const user = await User.findOne({ where: { telegram_id: telegramId } })
    return user && user.role === "admin"
  } catch (error) {
    console.error("Ошибка проверки роли администратора:", error)
    return false
  }
}

// Получение роли пользователя в группе
async function getUserRoleInGroup(userId, groupId) {
  try {
    const userGroup = await UserGroup.findOne({
      where: { user_id: userId, group_id: groupId },
    })
    return userGroup ? userGroup.role : null
  } catch (error) {
    console.error("Ошибка получения роли пользователя в группе:", error)
    return null
  }
}

// Проверка роли куратора группы
async function isCurator(userId, groupId) {
  try {
    const userGroup = await UserGroup.findOne({
      where: { user_id: userId, group_id: groupId, role: "curator" },
    })
    return !!userGroup
  } catch (error) {
    console.error("Ошибка проверки роли куратора:", error)
    return false
  }
}

// Главное меню
function getMainMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📚 Выбрать группу", callback_data: "select_group_page_0" }],
        [{ text: "➕ Добавить группу", callback_data: "add_group" }],
        [{ text: "⏳ Заявки на группы", callback_data: "pending_groups" }],
        [{ text: "👥 Управление пользователями", callback_data: "manage_users" }],
        [{ text: "⚙️ Настройки", callback_data: "settings" }],
      ],
    },
  }
}

// Меню группы
function getGroupMenu(groupId, userRole = "member") {
  const keyboard = [
    [{ text: "📋 Задачи", callback_data: `group_tasks_${groupId}_0` }],
    [{ text: "➕ Добавить задачу", callback_data: `add_task_${groupId}` }],
    [{ text: "✅ Отметить выполненное", callback_data: `mark_completed_${groupId}` }],
    [{ text: "📚 Предметы", callback_data: `subjects_${groupId}` }],
  ]

  if (userRole === "curator") {
    keyboard.push([{ text: "📢 Уведомление группе", callback_data: `notify_group_${groupId}` }])
    keyboard.push([{ text: "➕ Добавить предмет", callback_data: `add_subject_${groupId}` }])
  }

  keyboard.push([{ text: "🔙 Назад", callback_data: "back_to_main" }])

  return { reply_markup: { inline_keyboard: keyboard } }
}

// Команда /start
bot.onText(/\/start/, async (msg) => {
  try {
    const user = await getOrCreateUser(msg)
    const welcomeText = `Привет, ${user.first_name}! 👋\n\nЯ помощник студента. Выберите действие:`

    bot.sendMessage(msg.chat.id, welcomeText, getMainMenu())
  } catch (error) {
    console.error("Ошибка в команде /start:", error)
    bot.sendMessage(msg.chat.id, "Произошла ошибка. Попробуйте позже.")
  }
})

// Команда /help
bot.onText(/\/help/, async (msg) => {
  const helpText = `
🤖 **Помощник студента**

**Основные функции:**
📚 Управление группами с пагинацией
📋 Создание и отслеживание задач
⏰ Уведомления о дедлайнах
✅ Отметка выполненных заданий
👥 Управление пользователями (админ)
📢 Уведомления группе (куратор)

**Команды:**
/start - Главное меню
/help - Справка
/setrole [telegram_id] [role] - Назначить роль (только админ)

**Роли:**
👑 Администратор - управляет системой
🎓 Куратор группы - управляет задачами и предметами группы
👤 Участник - работает с личными задачами
  `

  bot.sendMessage(msg.chat.id, helpText, { parse_mode: "Markdown" })
})

// Обработка callback запросов
bot.on("callback_query", async (callbackQuery) => {
  const msg = callbackQuery.message
  const data = callbackQuery.data

  try {
    const user = await getOrCreateUser({ from: callbackQuery.from })

    // Основные действия
    if (data.startsWith("select_group_page_")) {
      const page = Number.parseInt(data.split("_")[3])
      await handleSelectGroup(msg, user, page)
    } else if (data === "add_group") {
      await handleAddGroup(msg, user)
    } else if (data === "pending_groups") {
      await handlePendingGroups(msg, user)
    } else if (data === "manage_users") {
      await handleManageUsers(msg, user)
    } else if (data === "settings") {
      await handleSettings(msg, user)
    } else if (data === "back_to_main") {
      await handleBackToMain(msg)
    } else if (data === "cancel_action") {
      await handleCancelAction(msg, user)
    }

    // Действия с группами
    else if (data.startsWith("select_group_")) {
      const groupId = data.split("_")[2]
      await handleGroupSelected(msg, user, groupId)
    } else if (data.startsWith("join_group_")) {
      const groupId = data.split("_")[2]
      await handleJoinGroup(msg, user, groupId)
    }

    // Действия с задачами
    else if (data.startsWith("group_tasks_")) {
      const [, , groupId, page] = data.split("_")
      await handleGroupTasks(msg, user, groupId, Number.parseInt(page))
    } else if (data.startsWith("add_task_")) {
      const groupId = data.split("_")[2]
      await handleAddTask(msg, user, groupId)
    } else if (data.startsWith("mark_completed_")) {
      const groupId = data.split("_")[2]
      await handleMarkCompleted(msg, user, groupId)
    } else if (data.startsWith("complete_task_")) {
      const taskId = data.split("_")[2]
      await handleCompleteTask(msg, user, taskId)
    }

    // Действия с предметами
    else if (data.startsWith("subjects_")) {
      const groupId = data.split("_")[1]
      await handleSubjects(msg, user, groupId)
    } else if (data.startsWith("add_subject_")) {
      const groupId = data.split("_")[2]
      await handleAddSubject(msg, user, groupId)
    } else if (data.startsWith("select_subject_")) {
      const subjectId = data.split("_")[2]
      await handleSubjectSelected(msg, user, subjectId)
    } else if (data === "create_without_subject") {
      await handleCreateTaskWithoutSubject(msg, user)
    }

    // Уведомления группе
    else if (data.startsWith("notify_group_")) {
      const groupId = data.split("_")[2]
      await handleNotifyGroup(msg, user, groupId)
    }

    // Управление пользователями
    else if (data.startsWith("manage_group_users_")) {
      const groupId = data.split("_")[3]
      await handleManageGroupUsers(msg, user, groupId)
    } else if (data.startsWith("set_user_role_")) {
      const [, , , userId, groupId, role] = data.split("_")
      await handleSetUserRole(msg, user, userId, groupId, role)
    }

    // Заявки на группы
    else if (data.startsWith("approve_group_")) {
      const requestId = data.split("_")[2]
      await handleApproveGroup(msg, user, requestId)
    } else if (data.startsWith("reject_group_")) {
      const requestId = data.split("_")[2]
      await handleRejectGroup(msg, user, requestId)
    }

    // Настройки
    else if (data === "toggle_notifications") {
      await handleToggleNotifications(msg, user)
    }

    bot.answerCallbackQuery(callbackQuery.id)
  } catch (error) {
    console.error("Ошибка обработки callback:", error)
    bot.answerCallbackQuery(callbackQuery.id, { text: "Произошла ошибка" })
  }
})

// Выбор группы с пагинацией
async function handleSelectGroup(msg, user, page = 0) {
  try {
    console.log(`Пользователь ${user.telegram_id} выбирает группу, страница ${page}...`)

    const userGroups = await UserGroup.findAll({
      where: { user_id: user.id },
      include: [{ model: Group, required: true }],
    })

    if (userGroups.length === 0) {
      // Показываем все доступные группы для вступления с пагинацией
      const offset = page * GROUPS_PER_PAGE
      const { count, rows: allGroups } = await Group.findAndCountAll({
        where: { status: "active" },
        limit: GROUPS_PER_PAGE,
        offset: offset,
        order: [["name", "ASC"]],
      })

      if (count === 0) {
        bot.editMessageText("Пока нет доступных групп. Создайте заявку на новую группу!", {
          chat_id: msg.chat.id,
          message_id: msg.message_id,
          ...getMainMenu(),
        })
        return
      }

      let text = `Доступные группы для вступления (${offset + 1}-${Math.min(offset + GROUPS_PER_PAGE, count)} из ${count}):\n\n`
      const keyboard = []

      allGroups.forEach((group) => {
        text += `📚 ${group.name}\n`
        if (group.description) {
          text += `📝 ${group.description}\n`
        }
        text += "\n"
        keyboard.push([{ text: `Вступить в "${group.name}"`, callback_data: `join_group_${group.id}` }])
      })

      // Кнопки пагинации
      const paginationRow = []
      if (page > 0) {
        paginationRow.push({ text: "⬅️ Назад", callback_data: `select_group_page_${page - 1}` })
      }
      if (offset + GROUPS_PER_PAGE < count) {
        paginationRow.push({ text: "➡️ Далее", callback_data: `select_group_page_${page + 1}` })
      }
      if (paginationRow.length > 0) {
        keyboard.push(paginationRow)
      }

      keyboard.push([{ text: "🔙 Назад", callback_data: "back_to_main" }])

      bot.editMessageText(text, {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        reply_markup: { inline_keyboard: keyboard },
      })
      return
    }

    const keyboard = userGroups.map((ug) => [
      {
        text: `${ug.Group.name} (${ug.role === "curator" ? "👑" : "👤"})`,
        callback_data: `select_group_${ug.Group.id}`,
      },
    ])
    keyboard.push([{ text: "🔙 Назад", callback_data: "back_to_main" }])

    bot.editMessageText("Ваши группы:", {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      reply_markup: { inline_keyboard: keyboard },
    })
  } catch (error) {
    console.error("Ошибка выбора группы:", error)
    bot.editMessageText("Произошла ошибка при загрузке групп. Попробуйте позже.", {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      ...getMainMenu(),
    })
  }
}

// Вступление в группу
async function handleJoinGroup(msg, user, groupId) {
  try {
    const group = await Group.findByPk(groupId)
    if (!group) {
      bot.editMessageText("Группа не найдена.", {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        ...getMainMenu(),
      })
      return
    }

    const existingMembership = await UserGroup.findOne({
      where: { user_id: user.id, group_id: groupId },
    })

    if (existingMembership) {
      bot.editMessageText("Вы уже состоите в этой группе!", {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        ...getMainMenu(),
      })
      return
    }

    await UserGroup.create({
      user_id: user.id,
      group_id: groupId,
      role: "member",
    })

    bot.editMessageText(`✅ Вы успешно вступили в группу "${group.name}"!`, {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      ...getMainMenu(),
    })
  } catch (error) {
    console.error("Ошибка вступления в группу:", error)
    bot.editMessageText("Произошла ошибка при вступлении в группу.", {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      ...getMainMenu(),
    })
  }
}

// Добавление группы
async function handleAddGroup(msg, user) {
  userStates.set(user.telegram_id, { action: "adding_group" })

  bot.editMessageText("📝 Введите название группы, которую хотите добавить:", {
    chat_id: msg.chat.id,
    message_id: msg.message_id,
    reply_markup: {
      inline_keyboard: [[{ text: "❌ Отмена", callback_data: "cancel_action" }]],
    },
  })
}

// Заявки на группы (только для админов)
async function handlePendingGroups(msg, user) {
  try {
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
      order: [["createdAt", "DESC"]],
    })

    if (pendingRequests.length === 0) {
      bot.editMessageText("Нет заявок на рассмотрении.", {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        ...getMainMenu(),
      })
      return
    }

    let text = "📋 Заявки на создание групп:\n\n"
    const keyboard = []

    pendingRequests.forEach((request) => {
      text += `📝 ${request.group_name}\n👤 От: ${request.User.first_name}\n📅 ${new Date(request.createdAt).toLocaleDateString("ru-RU")}\n\n`
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
  } catch (error) {
    console.error("Ошибка загрузки заявок:", error)
    bot.editMessageText("Произошла ошибка при загрузке заявок.", {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      ...getMainMenu(),
    })
  }
}

// Управление пользователями (только для админов)
async function handleManageUsers(msg, user) {
  try {
    if (!(await isAdmin(user.telegram_id))) {
      bot.editMessageText("У вас нет прав для управления пользователями.", {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        ...getMainMenu(),
      })
      return
    }

    const groups = await Group.findAll({
      where: { status: "active" },
      order: [["name", "ASC"]],
    })

    if (groups.length === 0) {
      bot.editMessageText("Нет активных групп.", {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        ...getMainMenu(),
      })
      return
    }

    let text = "👥 Выберите группу для управления пользователями:\n\n"
    const keyboard = []

    groups.forEach((group) => {
      text += `📚 ${group.name}\n`
      keyboard.push([{ text: group.name, callback_data: `manage_group_users_${group.id}` }])
    })

    keyboard.push([{ text: "🔙 Назад", callback_data: "back_to_main" }])

    bot.editMessageText(text, {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      reply_markup: { inline_keyboard: keyboard },
    })
  } catch (error) {
    console.error("Ошибка управления пользователями:", error)
  }
}

// Управление пользователями группы
async function handleManageGroupUsers(msg, user, groupId) {
  try {
    const group = await Group.findByPk(groupId)
    const userGroups = await UserGroup.findAll({
      where: { group_id: groupId },
      include: [User],
      order: [[User, "first_name", "ASC"]],
    })

    if (userGroups.length === 0) {
      bot.editMessageText(`В группе "${group.name}" пока нет участников.`, {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Назад", callback_data: "manage_users" }]],
        },
      })
      return
    }

    let text = `👥 Участники группы "${group.name}":\n\n`
    const keyboard = []

    userGroups.forEach((ug) => {
      const roleIcon = ug.role === "curator" ? "👑" : "👤"
      text += `${roleIcon} ${ug.User.first_name} (${ug.role})\n`

      keyboard.push([
        { text: `👑 Куратор - ${ug.User.first_name}`, callback_data: `set_user_role_${ug.User.id}_${groupId}_curator` },
        { text: `👤 Участник - ${ug.User.first_name}`, callback_data: `set_user_role_${ug.User.id}_${groupId}_member` },
      ])
    })

    keyboard.push([{ text: "🔙 Назад", callback_data: "manage_users" }])

    bot.editMessageText(text, {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      reply_markup: { inline_keyboard: keyboard },
    })
  } catch (error) {
    console.error("Ошибка управления пользователями группы:", error)
  }
}

// Установка роли пользователя
async function handleSetUserRole(msg, adminUser, userId, groupId, role) {
  try {
    if (!(await isAdmin(adminUser.telegram_id))) {
      return
    }

    const userGroup = await UserGroup.findOne({
      where: { user_id: userId, group_id: groupId },
      include: [User, Group],
    })

    if (!userGroup) {
      bot.editMessageText("Пользователь не найден в группе.", {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Назад", callback_data: "manage_users" }]],
        },
      })
      return
    }

    await userGroup.update({ role })

    bot.editMessageText(
      `✅ Роль пользователя ${userGroup.User.first_name} в группе "${userGroup.Group.name}" изменена на ${role}.`,
      {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Назад", callback_data: `manage_group_users_${groupId}` }]],
        },
      },
    )
  } catch (error) {
    console.error("Ошибка установки роли:", error)
  }
}

// Настройки
async function handleSettings(msg, user) {
  const text = `⚙️ Настройки:\n\n🔔 Уведомления: ${user.notifications_enabled ? "Включены" : "Выключены"}`

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

// Переключение уведомлений
async function handleToggleNotifications(msg, user) {
  try {
    await user.update({ notifications_enabled: !user.notifications_enabled })
    await handleSettings(msg, user)
  } catch (error) {
    console.error("Ошибка переключения уведомлений:", error)
  }
}

// Возврат в главное меню
async function handleBackToMain(msg) {
  bot.editMessageText("🏠 Главное меню:", {
    chat_id: msg.chat.id,
    message_id: msg.message_id,
    ...getMainMenu(),
  })
}

// Отмена действия
async function handleCancelAction(msg, user) {
  userStates.delete(user.telegram_id)
  await handleBackToMain(msg)
}

// Выбрана группа
async function handleGroupSelected(msg, user, groupId) {
  try {
    const group = await Group.findByPk(groupId)
    if (!group) {
      bot.editMessageText("Группа не найдена.", {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        ...getMainMenu(),
      })
      return
    }

    const userRole = await getUserRoleInGroup(user.id, groupId)
    userStates.set(user.telegram_id, { selectedGroup: groupId, userRole })

    const roleText = userRole === "curator" ? " (👑 Куратор)" : ""
    bot.editMessageText(`📚 Группа: ${group.name}${roleText}\n\nВыберите действие:`, {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      ...getGroupMenu(groupId, userRole),
    })
  } catch (error) {
    console.error("Ошибка выбора группы:", error)
  }
}

// Просмотр задач группы с пагинацией
async function handleGroupTasks(msg, user, groupId, page = 0) {
  try {
    const offset = page * TASKS_PER_PAGE
    const { count, rows: tasks } = await Task.findAndCountAll({
      where: { group_id: groupId, status: "active" },
      include: [Subject],
      order: [["deadline", "ASC"]],
      limit: TASKS_PER_PAGE,
      offset: offset,
    })

    if (count === 0) {
      const userGroup = await UserGroup.findOne({ where: { user_id: user.id, group_id: groupId } })
      const userRole = userGroup ? userGroup.role : "member"

      bot.editMessageText("📋 В группе пока нет задач.", {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        ...getGroupMenu(groupId, userRole),
      })
      return
    }

    let text = `📋 Задачи группы (${offset + 1}-${Math.min(offset + TASKS_PER_PAGE, count)} из ${count}):\n\n`

    for (const task of tasks) {
      const userTask = await UserTask.findOne({
        where: { user_id: user.id, task_id: task.id },
      })

      const status = userTask?.completed ? "✅" : "⏳"
      const deadline = new Date(task.deadline).toLocaleDateString("ru-RU")

      text += `${status} ${task.title}\n`
      if (task.Subject) {
        text += `📚 ${task.Subject.name}\n`
      }
      text += `📅 До: ${deadline}\n`
      if (task.description) {
        text += `📝 ${task.description}\n`
      }
      text += "\n"
    }

    const keyboard = []

    // Кнопки пагинации
    const paginationRow = []
    if (page > 0) {
      paginationRow.push({ text: "⬅️ Назад", callback_data: `group_tasks_${groupId}_${page - 1}` })
    }
    if (offset + TASKS_PER_PAGE < count) {
      paginationRow.push({ text: "➡️ Далее", callback_data: `group_tasks_${groupId}_${page + 1}` })
    }
    if (paginationRow.length > 0) {
      keyboard.push(paginationRow)
    }

    keyboard.push([{ text: "🔙 Назад", callback_data: `select_group_${groupId}` }])

    bot.editMessageText(text, {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      reply_markup: { inline_keyboard: keyboard },
    })
  } catch (error) {
    console.error("Ошибка загрузки задач:", error)
  }
}

// Добавление задачи
async function handleAddTask(msg, user, groupId) {
  const userRole = await getUserRoleInGroup(user.id, groupId)
  const isCuratorUser = userRole === "curator"

  userStates.set(user.telegram_id, {
    action: "adding_task",
    selectedGroup: groupId,
    step: "title",
    isCurator: isCuratorUser,
  })

  bot.editMessageText("📝 Введите название задачи:", {
    chat_id: msg.chat.id,
    message_id: msg.message_id,
    reply_markup: {
      inline_keyboard: [[{ text: "❌ Отмена", callback_data: `select_group_${groupId}` }]],
    },
  })
}

// Предметы группы
async function handleSubjects(msg, user, groupId) {
  try {
    const subjects = await Subject.findAll({
      where: { group_id: groupId, status: "active" },
      order: [["name", "ASC"]],
    })

    const userRole = await getUserRoleInGroup(user.id, groupId)

    if (subjects.length === 0) {
      const text = "📚 В группе пока нет предметов."
      const keyboard = []

      if (userRole === "curator") {
        keyboard.push([{ text: "➕ Добавить предмет", callback_data: `add_subject_${groupId}` }])
      }
      keyboard.push([{ text: "🔙 Назад", callback_data: `select_group_${groupId}` }])

      bot.editMessageText(text, {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        reply_markup: { inline_keyboard: keyboard },
      })
      return
    }

    let text = "📚 Предметы группы:\n\n"
    const keyboard = []

    subjects.forEach((subject) => {
      text += `📖 ${subject.name}\n`
    })

    if (userRole === "curator") {
      keyboard.push([{ text: "➕ Добавить предмет", callback_data: `add_subject_${groupId}` }])
    }
    keyboard.push([{ text: "🔙 Назад", callback_data: `select_group_${groupId}` }])

    bot.editMessageText(text, {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      reply_markup: { inline_keyboard: keyboard },
    })
  } catch (error) {
    console.error("Ошибка загрузки предметов:", error)
  }
}

// Добавление предмета
async function handleAddSubject(msg, user, groupId) {
  const userRole = await getUserRoleInGroup(user.id, groupId)

  if (userRole !== "curator") {
    bot.editMessageText("У вас нет прав для добавления предметов.", {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      reply_markup: {
        inline_keyboard: [[{ text: "🔙 Назад", callback_data: `subjects_${groupId}` }]],
      },
    })
    return
  }

  userStates.set(user.telegram_id, {
    action: "adding_subject",
    selectedGroup: groupId,
  })

  bot.editMessageText("📚 Введите название предмета:", {
    chat_id: msg.chat.id,
    message_id: msg.message_id,
    reply_markup: {
      inline_keyboard: [[{ text: "❌ Отмена", callback_data: `subjects_${groupId}` }]],
    },
  })
}

// Уведомление группе (только для кураторов)
async function handleNotifyGroup(msg, user, groupId) {
  try {
    const userRole = await getUserRoleInGroup(user.id, groupId)

    if (userRole !== "curator") {
      bot.editMessageText("У вас нет прав для отправки уведомлений группе.", {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Назад", callback_data: `select_group_${groupId}` }]],
        },
      })
      return
    }

    userStates.set(user.telegram_id, {
      action: "notifying_group",
      selectedGroup: groupId,
    })

    bot.editMessageText("📢 Введите сообщение для группы:", {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      reply_markup: {
        inline_keyboard: [[{ text: "❌ Отмена", callback_data: `select_group_${groupId}` }]],
      },
    })
  } catch (error) {
    console.error("Ошибка уведомления группы:", error)
  }
}

// Отметить задачу как выполненную
async function handleMarkCompleted(msg, user, groupId) {
  try {
    const tasks = await Task.findAll({
      where: { group_id: groupId, status: "active" },
      include: [Subject],
      order: [["deadline", "ASC"]],
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
      bot.editMessageText("🎉 Все задачи выполнены!", {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Назад", callback_data: `select_group_${groupId}` }]],
        },
      })
      return
    }

    let text = "✅ Выберите задачу для отметки как выполненная:\n\n"
    const keyboard = []

    incompleteTasks.forEach((task) => {
      const deadline = new Date(task.deadline).toLocaleDateString("ru-RU")
      text += `⏳ ${task.title} (до ${deadline})\n`
      keyboard.push([{ text: `✅ ${task.title}`, callback_data: `complete_task_${task.id}` }])
    })

    keyboard.push([{ text: "🔙 Назад", callback_data: `select_group_${groupId}` }])

    bot.editMessageText(text, {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      reply_markup: { inline_keyboard: keyboard },
    })
  } catch (error) {
    console.error("Ошибка загрузки невыполненных задач:", error)
  }
}

// Отметить конкретную задачу как выполненную
async function handleCompleteTask(msg, user, taskId) {
  try {
    const [userTask] = await UserTask.findOrCreate({
      where: { user_id: user.id, task_id: taskId },
      defaults: { completed: true, completed_at: new Date() },
    })

    if (!userTask.completed) {
      await userTask.update({ completed: true, completed_at: new Date() })
    }

    const task = await Task.findByPk(taskId)
    bot.editMessageText(`✅ Задача "${task.title}" отмечена как выполненная!`, {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      reply_markup: {
        inline_keyboard: [[{ text: "🔙 Назад", callback_data: `select_group_${task.group_id}` }]],
      },
    })
  } catch (error) {
    console.error("Ошибка отметки задачи:", error)
  }
}

// Выбор предмета для задачи
async function handleSubjectSelected(msg, user, subjectId) {
  try {
    const state = userStates.get(user.telegram_id)
    if (!state || state.action !== "adding_task") {
      return
    }

    const subject = await Subject.findByPk(subjectId)
    state.taskData.subject_id = subjectId

    // Если куратор, спрашиваем для кого создать задачу
    if (state.isCurator) {
      state.step = "target"
      bot.editMessageText("👥 Для кого создать задачу?", {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        reply_markup: {
          inline_keyboard: [
            [{ text: "👤 Только для себя", callback_data: "task_for_self" }],
            [{ text: "👥 Для всей группы", callback_data: "task_for_group" }],
            [{ text: "❌ Отмена", callback_data: `select_group_${state.selectedGroup}` }],
          ],
        },
      })
    } else {
      // Обычный участник - создаем задачу только для себя
      await createTask(state, user, false)
      userStates.delete(user.telegram_id)

      bot.editMessageText(`✅ Задача "${state.taskData.title}" создана!`, {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Назад", callback_data: `select_group_${state.selectedGroup}` }]],
        },
      })
    }
  } catch (error) {
    console.error("Ошибка выбора предмета:", error)
  }
}

// Создание задачи без предмета
async function handleCreateTaskWithoutSubject(msg, user) {
  try {
    const state = userStates.get(user.telegram_id)
    if (!state || state.action !== "adding_task") {
      return
    }

    state.taskData.subject_id = null

    // Если куратор, спрашиваем для кого создать задачу
    if (state.isCurator) {
      state.step = "target"
      bot.editMessageText("👥 Для кого создать задачу?", {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        reply_markup: {
          inline_keyboard: [
            [{ text: "👤 Только для себя", callback_data: "task_for_self" }],
            [{ text: "👥 Для всей группы", callback_data: "task_for_group" }],
            [{ text: "❌ Отмена", callback_data: `select_group_${state.selectedGroup}` }],
          ],
        },
      })
    } else {
      // Обычный участник - создаем задачу только для себя
      await createTask(state, user, false)
      userStates.delete(user.telegram_id)

      bot.editMessageText(`✅ Задача "${state.taskData.title}" создана!`, {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Назад", callback_data: `select_group_${state.selectedGroup}` }]],
        },
      })
    }
  } catch (error) {
    console.error("Ошибка создания задачи без предмета:", error)
  }
}

// Создание задачи
async function createTask(state, user, forAllGroup) {
  try {
    const task = await Task.create({
      title: state.taskData.title,
      description: state.taskData.description,
      subject_id: state.taskData.subject_id,
      group_id: state.selectedGroup,
      created_by: user.id,
      deadline: state.taskData.deadline,
      for_all_group: forAllGroup,
    })

    if (!forAllGroup) {
      // Создаем задачу только для создателя
      await UserTask.create({
        user_id: user.id,
        task_id: task.id,
        completed: false,
      })
    }

    return task
  } catch (error) {
    console.error("Ошибка создания задачи:", error)
    throw error
  }
}

// Обработка текстовых сообщений
bot.on("message", async (msg) => {
  if (msg.text && !msg.text.startsWith("/")) {
    try {
      const user = await getOrCreateUser(msg)
      const state = userStates.get(user.telegram_id)

      if (state?.action === "adding_group") {
        await GroupRequest.create({
          group_name: msg.text,
          requested_by: user.id,
        })

        userStates.delete(user.telegram_id)
        bot.sendMessage(msg.chat.id, "✅ Заявка на создание группы отправлена администратору!", getMainMenu())
      } else if (state?.action === "adding_task") {
        await handleTaskCreationStep(msg, user, state)
      } else if (state?.action === "adding_subject") {
        await handleSubjectCreationStep(msg, user, state)
      } else if (state?.action === "notifying_group") {
        await handleGroupNotificationStep(msg, user, state)
      }
    } catch (error) {
      console.error("Ошибка обработки сообщения:", error)
      bot.sendMessage(msg.chat.id, "Произошла ошибка. Попробуйте позже.")
    }
  }
})

// Обработка шагов создания задачи
async function handleTaskCreationStep(msg, user, state) {
  try {
    if (state.step === "title") {
      state.taskData = { title: msg.text }
      state.step = "description"
      bot.sendMessage(msg.chat.id, '📝 Введите описание задачи (или отправьте "-" чтобы пропустить):', {
        reply_markup: {
          inline_keyboard: [[{ text: "❌ Отмена", callback_data: `select_group_${state.selectedGroup}` }]],
        },
      })
    } else if (state.step === "description") {
      state.taskData.description = msg.text === "-" ? null : msg.text
      state.step = "deadline"
      bot.sendMessage(msg.chat.id, "📅 Введите дедлайн в формате ДД.ММ.ГГГГ:", {
        reply_markup: {
          inline_keyboard: [[{ text: "❌ Отмена", callback_data: `select_group_${state.selectedGroup}` }]],
        },
      })
    } else if (state.step === "deadline") {
      const [day, month, year] = msg.text.split(".")
      const deadline = new Date(year, month - 1, day)

      if (isNaN(deadline.getTime())) {
        bot.sendMessage(msg.chat.id, "❌ Неверный формат даты. Используйте ДД.ММ.ГГГГ (например, 25.12.2024):", {
          reply_markup: {
            inline_keyboard: [[{ text: "❌ Отмена", callback_data: `select_group_${state.selectedGroup}` }]],
          },
        })
        return
      }

      state.taskData.deadline = deadline

      // Получаем предметы группы
      const subjects = await Subject.findAll({
        where: { group_id: state.selectedGroup, status: "active" },
        order: [["name", "ASC"]],
      })

      const keyboard = subjects.map((subject) => [
        { text: subject.name, callback_data: `select_subject_${subject.id}` },
      ])
      keyboard.push([{ text: "➕ Создать без предмета", callback_data: "create_without_subject" }])
      keyboard.push([{ text: "❌ Отмена", callback_data: `select_group_${state.selectedGroup}` }])

      state.step = "subject"
      bot.sendMessage(msg.chat.id, "📚 Выберите предмет:", {
        reply_markup: { inline_keyboard: keyboard },
      })
    }
  } catch (error) {
    console.error("Ошибка создания задачи:", error)
    bot.sendMessage(msg.chat.id, "Произошла ошибка при создании задачи.")
  }
}

// Обработка создания предмета
async function handleSubjectCreationStep(msg, user, state) {
  try {
    await Subject.create({
      name: msg.text,
      group_id: state.selectedGroup,
      created_by: user.id,
      status: "active",
    })

    userStates.delete(user.telegram_id)
    bot.sendMessage(msg.chat.id, `✅ Предмет "${msg.text}" добавлен!`, {
      reply_markup: {
        inline_keyboard: [[{ text: "🔙 Назад", callback_data: `subjects_${state.selectedGroup}` }]],
      },
    })
  } catch (error) {
    console.error("Ошибка создания предмета:", error)
    bot.sendMessage(msg.chat.id, "Произошла ошибка при создании предмета.")
  }
}

// Обработка уведомления группы
async function handleGroupNotificationStep(msg, user, state) {
  try {
    const groupUsers = await UserGroup.findAll({
      where: { group_id: state.selectedGroup },
      include: [User],
    })

    const group = await Group.findByPk(state.selectedGroup)
    const message = `📢 Уведомление от куратора группы "${group.name}":\n\n${msg.text}`

    let sentCount = 0
    for (const userGroup of groupUsers) {
      if (userGroup.User.notifications_enabled && userGroup.User.id !== user.id) {
        try {
          await bot.sendMessage(userGroup.User.telegram_id, message)
          sentCount++
        } catch (error) {
          console.error(`Ошибка отправки уведомления пользователю ${userGroup.User.telegram_id}:`, error)
        }
      }
    }

    userStates.delete(user.telegram_id)
    bot.sendMessage(msg.chat.id, `✅ Уведомление отправлено ${sentCount} участникам группы!`, {
      reply_markup: {
        inline_keyboard: [[{ text: "🔙 Назад", callback_data: `select_group_${state.selectedGroup}` }]],
      },
    })
  } catch (error) {
    console.error("Ошибка отправки уведомления группе:", error)
    bot.sendMessage(msg.chat.id, "Произошла ошибка при отправке уведомления.")
  }
}

// Дополнительные callback обработчики для кураторов
bot.on("callback_query", async (callbackQuery) => {
  const msg = callbackQuery.message
  const data = callbackQuery.data

  try {
    const user = await getOrCreateUser({ from: callbackQuery.from })
    const state = userStates.get(user.telegram_id)

    if (data === "task_for_self" && state?.action === "adding_task") {
      await createTask(state, user, false)
      userStates.delete(user.telegram_id)

      bot.editMessageText(`✅ Задача "${state.taskData.title}" создана для вас!`, {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Назад", callback_data: `select_group_${state.selectedGroup}` }]],
        },
      })
    } else if (data === "task_for_group" && state?.action === "adding_task") {
      await createTask(state, user, true)
      userStates.delete(user.telegram_id)

      bot.editMessageText(`✅ Задача "${state.taskData.title}" создана для всей группы!`, {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Назад", callback_data: `select_group_${state.selectedGroup}` }]],
        },
      })
    }

    bot.answerCallbackQuery(callbackQuery.id)
  } catch (error) {
    console.error("Ошибка обработки callback куратора:", error)
    bot.answerCallbackQuery(callbackQuery.id, { text: "Произошла ошибка" })
  }
})

// Обработка утверждения группы
async function handleApproveGroup(msg, user, requestId) {
  try {
    const request = await GroupRequest.findByPk(requestId, { include: [User] })
    if (!request) {
      bot.editMessageText("Заявка не найдена.", {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        ...getMainMenu(),
      })
      return
    }

    await request.update({ status: "approved" })
    const group = await Group.create({
      name: request.group_name,
      description: request.description,
      created_by: request.requested_by,
    })

    // Добавляем создателя в группу как куратора
    await UserGroup.create({
      user_id: request.requested_by,
      group_id: group.id,
      role: "curator",
    })

    bot.editMessageText("✅ Заявка одобрена! Группа создана.", {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      ...getMainMenu(),
    })

    // Уведомляем создателя группы
    try {
      await bot.sendMessage(
        request.User.telegram_id,
        `🎉 Ваша заявка на создание группы "${request.group_name}" одобрена! Вы назначены куратором группы.`,
      )
    } catch (error) {
      console.error("Ошибка отправки уведомления:", error)
    }
  } catch (error) {
    console.error("Ошибка одобрения группы:", error)
  }
}

// Обработка отклонения группы
async function handleRejectGroup(msg, user, requestId) {
  try {
    const request = await GroupRequest.findByPk(requestId, { include: [User] })
    if (!request) {
      bot.editMessageText("Заявка не найдена.", {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        ...getMainMenu(),
      })
      return
    }

    await request.update({ status: "rejected" })

    bot.editMessageText("❌ Заявка отклонена.", {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      ...getMainMenu(),
    })

    // Уведомляем создателя группы
    try {
      await bot.sendMessage(
        request.User.telegram_id,
        `❌ Ваша заявка на создание группы "${request.group_name}" отклонена.`,
      )
    } catch (error) {
      console.error("Ошибка отправки уведомления:", error)
    }
  } catch (error) {
    console.error("Ошибка отклонения группы:", error)
  }
}

// Система уведомлений о дедлайнах (каждый день в 9:00)
cron.schedule("0 9 * * *", async () => {
  console.log("🔔 Проверка дедлайнов...")

  try {
    const now = new Date()
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)

    // Задачи с дедлайном в течение недели
    const upcomingTasks = await Task.findAll({
      where: {
        deadline: {
          [require("sequelize").Op.between]: [now, weekFromNow],
        },
        status: "active",
      },
      include: [Subject, Group],
    })

    for (const task of upcomingTasks) {
      // Получаем пользователей для уведомления
      let usersToNotify = []

      if (task.for_all_group) {
        // Задача для всей группы
        const groupUsers = await UserGroup.findAll({
          where: { group_id: task.group_id },
          include: [User],
        })
        usersToNotify = groupUsers.map((ug) => ug.User)
      } else {
        // Личная задача
        const taskCreator = await User.findByPk(task.created_by)
        if (taskCreator) {
          usersToNotify = [taskCreator]
        }
      }

      const daysLeft = Math.ceil((new Date(task.deadline) - now) / (1000 * 60 * 60 * 24))
      const urgencyIcon = daysLeft <= 3 ? "🚨" : "⏰"

      for (const user of usersToNotify) {
        if (user.notifications_enabled) {
          const message =
            `${urgencyIcon} Напоминание о дедлайне!\n\n` +
            `📚 Группа: ${task.Group.name}\n` +
            `📖 Предмет: ${task.Subject?.name || "Без предмета"}\n` +
            `📝 Задача: ${task.title}\n` +
            `📅 Дедлайн: ${new Date(task.deadline).toLocaleDateString("ru-RU")}\n` +
            `⏳ Осталось дней: ${daysLeft}`

          try {
            await bot.sendMessage(user.telegram_id, message)
          } catch (error) {
            console.error(`Ошибка отправки уведомления пользователю ${user.telegram_id}:`, error)
          }
        }
      }
    }
  } catch (error) {
    console.error("Ошибка системы уведомлений:", error)
  }
})

// Функция для создания тестовых данных
async function createTestData() {
  try {
    const groupCount = await Group.count()
    if (groupCount > 0) {
      console.log("Тестовые данные уже существуют")
      return
    }

    console.log("Создание тестовых данных...")

    // Создаем тестовую группу
    const testGroup = await Group.create({
      name: "Тестовая группа ИТ-21",
      description: "Группа для изучения информационных технологий",
      status: "active",
    })

    // Создаем тестовые предметы
    await Subject.create({
      name: "Математика",
      group_id: testGroup.id,
      status: "active",
    })

    await Subject.create({
      name: "Программирование",
      group_id: testGroup.id,
      status: "active",
    })

    await Subject.create({
      name: "Базы данных",
      group_id: testGroup.id,
      status: "active",
    })

    console.log("✅ Тестовые данные созданы")
  } catch (error) {
    console.error("Ошибка создания тестовых данных:", error)
  }
}

// Обработка ошибок
bot.on("polling_error", (error) => {
  console.error("Ошибка polling:", error)
})

// Инициализация
initDB().then(() => {
  console.log("🚀 Бот запущен и готов к работе!")
})

module.exports = bot

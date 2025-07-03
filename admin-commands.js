// Дополнительные команды для администраторов
const { User, Group, UserGroup } = require("./models")
const bot = require("./bot") // Declare the bot variable

// Команда для назначения ролей (только для админов)
bot.onText(/\/setrole (\d+) (admin|user)/, async (msg, match) => {
  const adminUser = await User.findOne({ where: { telegram_id: msg.from.id } })

  if (!adminUser || adminUser.role !== "admin") {
    bot.sendMessage(msg.chat.id, "У вас нет прав для выполнения этой команды.")
    return
  }

  const targetUserId = match[1]
  const newRole = match[2]

  try {
    const targetUser = await User.findOne({ where: { telegram_id: targetUserId } })
    if (!targetUser) {
      bot.sendMessage(msg.chat.id, "Пользователь не найден.")
      return
    }

    await targetUser.update({ role: newRole })
    bot.sendMessage(msg.chat.id, `Роль пользователя ${targetUser.first_name} изменена на ${newRole}.`)
  } catch (error) {
    console.error("Ошибка изменения роли:", error)
    bot.sendMessage(msg.chat.id, "Ошибка при изменении роли.")
  }
})

// Команда для назначения куратора группы
bot.onText(/\/setcurator (\d+) (\d+)/, async (msg, match) => {
  const adminUser = await User.findOne({ where: { telegram_id: msg.from.id } })

  if (!adminUser || adminUser.role !== "admin") {
    bot.sendMessage(msg.chat.id, "У вас нет прав для выполнения этой команды.")
    return
  }

  const userId = match[1]
  const groupId = match[2]

  try {
    const userGroup = await UserGroup.findOne({ where: { user_id: userId, group_id: groupId } })

    if (!userGroup) {
      bot.sendMessage(msg.chat.id, "Пользователь не состоит в этой группе.")
      return
    }

    await userGroup.update({ role: "curator" })
    bot.sendMessage(msg.chat.id, "Пользователь назначен куратором группы.")
  } catch (error) {
    console.error("Ошибка назначения куратора:", error)
    bot.sendMessage(msg.chat.id, "Ошибка при назначении куратора.")
  }
})

module.exports = { bot }

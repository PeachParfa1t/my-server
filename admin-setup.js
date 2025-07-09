// Скрипт для настройки администратора
require("dotenv").config()
const { User } = require("./index")

async function setupAdmin() {
  try {
    const ADMIN_TELEGRAM_ID = 1625895045 

    const [admin, created] = await User.findOrCreate({
      where: { telegram_id: ADMIN_TELEGRAM_ID },
      defaults: {
        telegram_id: ADMIN_TELEGRAM_ID,
        username: "@lust_lord",
        first_name: "Администратор",
        role: "admin",
      },
    })

    if (created) {
      console.log("✅ Администратор создан!")
    } else {
      await admin.update({ role: "admin" })
      console.log("✅ Роль администратора обновлена!")
    }

    console.log(`Администратор: ${admin.first_name} (ID: ${admin.telegram_id})`)
    process.exit(0)
  } catch (error) {
    console.error("Ошибка настройки администратора:", error)
    process.exit(1)
  }
}

setupAdmin()

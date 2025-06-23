require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const db = require('./db');

const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token, { polling: true });

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Привет, октагон!');
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id, `
Список команд:
/help - список доступных команд
/site - ссылка на сайт Октагона
/creator - ФИО создателя бота
/randomItem - Вытягивает случайный предмет из БД
/getItemByID - Вытягивает предмет по указаному айди
/deleteItem - Удаляет предметы по айди 
`);
});

bot.onText(/\/site/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Сайт Октагона: https://octagon.org.ru');
});

bot.onText(/\/creator/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Создатель: Филатова Софьяя Сергеевна');
});

bot.onText(/\/randomItem/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const [rows] = await db.query('SELECT * FROM Items ORDER BY RAND() LIMIT 1');
    if (rows.length === 0) {
      bot.sendMessage(chatId, 'База пуста.');
    } else {
      const item = rows[0];
      bot.sendMessage(chatId, `(${item.id}) - ${item.name}: ${item.desc}`);
    }
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, 'Ошибка при получении данных.');
  }
});

bot.onText(/\/getItemByID (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const id = parseInt(match[1]);

  try {
    const [rows] = await db.query('SELECT * FROM Items WHERE id = ?', [id]);
    if (rows.length === 0) {
      bot.sendMessage(chatId, 'Предмет не найден.');
    } else {
      const item = rows[0];
      bot.sendMessage(chatId, `(${item.id}) - ${item.name}: ${item.desc}`);
    }
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, 'Ошибка при поиске предмета.');
  }
});

bot.onText(/\/deleteItem (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const id = parseInt(match[1]);

  try {
    const [result] = await db.query('DELETE FROM Items WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      bot.sendMessage(chatId, 'Ошибка: предмет с таким ID не найден.');
    } else {
      bot.sendMessage(chatId, 'Предмет успешно удалён.');
    }
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, 'Ошибка при удалении.');
  }
});

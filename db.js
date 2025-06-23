const mysql = require('mysql2');

const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '', // если есть пароль — укажи
  database: 'ChatBotTests',
});

module.exports = pool.promise();

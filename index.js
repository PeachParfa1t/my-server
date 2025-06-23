const http = require('http');
const url = require('url');
const db = require('./db');

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const path = parsedUrl.pathname;
  const query = parsedUrl.query;

  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (path === '/getAllItems' && req.method === 'GET') {
    const [rows] = await db.query('SELECT * FROM Items');
    res.end(JSON.stringify(rows));
  }

  else if (path === '/addItem' && req.method === 'POST') {
    const { name, desc } = query;
    if (!name || !desc) return res.end('null');

    await db.query('INSERT INTO Items (name, `desc`) VALUES (?, ?)', [name, desc]);
    const [newItem] = await db.query('SELECT * FROM Items ORDER BY id DESC LIMIT 1');
    res.end(JSON.stringify(newItem[0]));
  }

  else if (path === '/deleteItem' && req.method === 'POST') {
    const { id } = query;
    if (!id || isNaN(id)) return res.end('null');

    const [oldItem] = await db.query('SELECT * FROM Items WHERE id = ?', [id]);
    if (oldItem.length === 0) return res.end('{}');

    await db.query('DELETE FROM Items WHERE id = ?', [id]);
    res.end(JSON.stringify(oldItem[0]));
  }

  else if (path === '/updateItem' && req.method === 'POST') {
    const { id, name, desc } = query;
    if (!id || isNaN(id) || !name || !desc) return res.end('null');

    const [oldItem] = await db.query('SELECT * FROM Items WHERE id = ?', [id]);
    if (oldItem.length === 0) return res.end('{}');

    await db.query('UPDATE Items SET name = ?, `desc` = ? WHERE id = ?', [name, desc, id]);
    const [updatedItem] = await db.query('SELECT * FROM Items WHERE id = ?', [id]);
    res.end(JSON.stringify(updatedItem[0]));
  }

  else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not Found' }));
  }
});

server.listen(3000, () => {
  console.log('Сервер запущен на http://localhost:3000');
});

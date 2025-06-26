const http = require('express');
const app = express();
const db = require('./db');

const port = 3000;

pp.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get('/getAllItems', async (req, res) => {
  try {
  const [rows] = await db.query('SELECT * FROM Items');
  res.json(rows);
}catch (err) {
    res.status(500).json({ error: 'DB Error' });
  }
});

app.post('/addItem', async (req, res) => {
  const { name, desc } = query;
  if (!name || !desc) return res.json('null');
  try {
    await db.query('INSERT INTO Items (name, `desc`) VALUES (?, ?)', [name, desc]);
    const [newItem] = await db.query('SELECT * FROM Items ORDER BY id DESC LIMIT 1');
    res.json(newItem[0]);
  }catch (err) {
    res.status(500).json({ error: 'DB Insert Error' });
  }
});

app.post('/deleteItem', async (req, res) => {
  const { id } = req.query;
  if (!id || isNaN(id)) return res.json('null');
try{
  const [oldItem] = await db.query('SELECT * FROM Items WHERE id = ?', [id]);
  if (oldItem.length === 0) return res.json('{}');

  await db.query('DELETE FROM Items WHERE id = ?', [id]);
  res.json(oldItem[0]);
} catch (err) {
    res.status(500).json({ error: 'DB Delete Error' });
}
});

app.post('/updateItem', async (req, res) => {
  const { id, name, desc } = query;
  if (!id || isNaN(id) || !name || !desc) return res.json('null');
  try {
    const [oldItem] = await db.query('SELECT * FROM Items WHERE id = ?', [id]);
    if (oldItem.length === 0) return res.json('{}');

    await db.query('UPDATE Items SET name = ?, `desc` = ? WHERE id = ?', [name, desc, id]);
    const [updatedItem] = await db.query('SELECT * FROM Items WHERE id = ?', [id]);
    res.json(updatedItem[0]);
  } catch (err) {
    res.status(500).json({ error: 'DB Update Error' });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

app.listen(port, () => {
  console.log(`Сервер запущен на http://localhost:${port}`);
});

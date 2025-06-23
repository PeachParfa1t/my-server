const http = require('http');
const url = require('url');

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true); // true — чтобы получить query как объект
  const path = parsedUrl.pathname;
  const query = parsedUrl.query;

  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (path === '/static') {
    const data = {
      header: 'Hello',
      body: 'Octagon NodeJS Test',
    };
    res.writeHead(200);
    res.end(JSON.stringify(data));
  }

  else if (path === '/dynamic') {
    const { a, b, c } = query;

    // Проверим, что все параметры существуют и являются числами
    const numA = Number(a);
    const numB = Number(b);
    const numC = Number(c);

    if (!a || !b || !c || isNaN(numA) || isNaN(numB) || isNaN(numC)) {
      res.writeHead(400);
      res.end(JSON.stringify({ header: 'Error' }));
      return;
    }

    const result = (numA * numB * numC) / 3;

    const response = {
      header: 'Calculated',
      body: String(result),
    };

    res.writeHead(200);
    res.end(JSON.stringify(response));
  }

  else {
    res.writeHead(404);
    res.end(JSON.stringify({ header: 'Error' }));
  }
});

server.listen(3000, () => {
  console.log('Сервер запущен на http://localhost:3000');
});



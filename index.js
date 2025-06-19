const http = require('http');

const server = http.createServer((req, res) => {
    if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); 
        res.end('<h1>привет, Октагон!</h1>');
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); 
        res.end('Страница не найдена');
    }
});

server.listen(3000, () => {
    console.log('Сервер запущен на http://localhost:3000/');
});


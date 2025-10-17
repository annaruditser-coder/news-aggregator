const express = require('express');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Раздача статических файлов (index.html, styles.css, script.js)
app.use(express.static(__dirname));

// Явный маршрут для главной страницы
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// Прокси для CORS
app.get('/proxy', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('Missing url');
  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (News-Proxy)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
      timeout: 15000,
    });
    if (!upstream.ok) {
      return res.status(upstream.status).send(await upstream.text());
    }
    const buf = await upstream.buffer();
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Content-Type', upstream.headers.get('content-type') || 'application/xml; charset=utf-8');
    res.send(buf);
  } catch (e) {
    res.status(500).send(String(e));
  }
});

// Для Vercel
module.exports = app;

// Для локального запуска
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}
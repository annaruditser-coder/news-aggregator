const express = require('express');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Раздача статических файлов (index.html, styles.css, script.js)
app.use(express.static(__dirname));

// Генерируем версию на основе времени деплоя (или можно использовать git commit hash)
const BUILD_VERSION = process.env.VERCEL_GIT_COMMIT_SHA?.substring(0, 7) || Date.now().toString(36);

// Явный маршрут для главной страницы
app.get('/', (req, res) => {
  // Читаем HTML и заменяем пути к статическим файлам на версионированные
  const fs = require('fs');
  const path = require('path');
  let html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  // Добавляем версию к script.js и styles.css
  html = html.replace(/href="\/styles\.css"/g, `href="/styles.css?v=${BUILD_VERSION}"`);
  html = html.replace(/src="\/script\.js"/g, `src="/script.js?v=${BUILD_VERSION}"`);
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(html);
});

// Прокси для CORS
app.get('/proxy', async (req, res) => {
  const url = req.query.url;
  if (!url) {
    return res.status(400).send('Missing url parameter');
  }
  
  try {
    // Увеличиваем таймаут для медленных источников (node-fetch 2 использует timeout в миллисекундах)
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; News-Proxy/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml, text/html, */*',
      },
      timeout: 25000, // 25 секунд для node-fetch 2
    });
    
    if (!upstream.ok) {
      // Возвращаем текст ошибки, а не JSON, чтобы клиент мог обработать
      const errorText = await upstream.text().catch(() => `Upstream returned ${upstream.status}`);
      return res.status(upstream.status).send(errorText);
    }
    
    const buf = await upstream.buffer();
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET');
    res.set('Content-Type', upstream.headers.get('content-type') || 'application/xml; charset=utf-8');
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(buf);
  } catch (e) {
    // Проверяем различные типы ошибок таймаута для node-fetch 2
    const isTimeout = e.type === 'request-timeout' || 
                      e.name === 'AbortError' ||
                      (e.message && (e.message.includes('timeout') || e.message.includes('aborted')));
    
    if (isTimeout) {
      return res.status(504).send('Request timeout');
    }
    console.error('Proxy error:', e);
    res.status(500).send('Internal server error');
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
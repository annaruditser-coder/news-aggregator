const express = require('express');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Раздача статических файлов (index.html, styles.css, script.js)
app.use(express.static(__dirname));

// Генерируем версию на основе времени деплоя (или можно использовать git commit hash)
const BUILD_VERSION = process.env.VERCEL_GIT_COMMIT_SHA?.substring(0, 7) || 
                       process.env.VERCEL_GIT_COMMIT_REF || 
                       `v${Date.now().toString(36)}`;

console.log(`[Server] BUILD_VERSION: ${BUILD_VERSION}`);

// Явный маршрут для главной страницы
app.get('/', (req, res) => {
  try {
    // Читаем HTML и заменяем пути к статическим файлам на версионированные
    const fs = require('fs');
    const path = require('path');
    const htmlPath = path.join(__dirname, 'index.html');
    
    if (!fs.existsSync(htmlPath)) {
      console.error(`[Server] index.html не найден по пути: ${htmlPath}`);
      return res.status(500).send('index.html not found');
    }
    
    let html = fs.readFileSync(htmlPath, 'utf8');
    console.log(`[Server] HTML загружен, длина: ${html.length}, версия: ${BUILD_VERSION}`);
    
    // Добавляем версию к script.js и styles.css (более гибкое регулярное выражение)
    html = html.replace(/(href=["'])\/styles\.css(["'])/g, `$1/styles.css?v=${BUILD_VERSION}$2`);
    html = html.replace(/(src=["'])\/script\.js(["'])/g, `$1/script.js?v=${BUILD_VERSION}$2`);
    
    // Проверяем, что замена произошла
    if (!html.includes(`script.js?v=${BUILD_VERSION}`)) {
      console.warn(`[Server] Предупреждение: версия не добавлена к script.js`);
    }
    if (!html.includes(`styles.css?v=${BUILD_VERSION}`)) {
      console.warn(`[Server] Предупреждение: версия не добавлена к styles.css`);
    }
    
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    console.error('[Server] Ошибка при обработке главной страницы:', error);
    res.status(500).send(`Error: ${error.message}`);
  }
});

// Прокси для CORS
app.get('/proxy', async (req, res) => {
  const url = req.query.url;
  if (!url) {
    return res.status(400).send('Missing url parameter');
  }
  
  try {
    console.log(`[Proxy] Запрос к: ${url}`);
    
    // Увеличиваем таймаут для медленных источников (node-fetch 2 использует timeout в миллисекундах)
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, text/html, */*',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      timeout: 25000, // 25 секунд для node-fetch 2
      redirect: 'follow', // Следовать редиректам
      follow: 5, // Максимум 5 редиректов
    });
    
    console.log(`[Proxy] Ответ: ${upstream.status} ${upstream.statusText}`);
    
    if (!upstream.ok) {
      // Возвращаем текст ошибки, а не JSON, чтобы клиент мог обработать
      const errorText = await upstream.text().catch(() => `Upstream returned ${upstream.status}`);
      return res.status(upstream.status).send(errorText);
    }
    
    // Получаем контент с ограничением размера для больших HTML страниц
    const contentType = upstream.headers.get('content-type') || '';
    const isHtml = contentType.includes('text/html');
    const maxSize = isHtml ? 5 * 1024 * 1024 : 10 * 1024 * 1024; // 5MB для HTML, 10MB для XML
    
    let buf;
    try {
      buf = await upstream.buffer();
    } catch (bufferError) {
      console.error(`[Proxy] Ошибка при чтении буфера:`, bufferError.message);
      return res.status(500).send(`Error reading response: ${bufferError.message}`);
    }
    
    if (buf.length > maxSize) {
      console.log(`[Proxy] Файл слишком большой: ${buf.length} байт`);
      return res.status(413).send('File too large');
    }
    
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET');
    res.set('Content-Type', contentType || 'application/xml; charset=utf-8');
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
    console.error(`[Proxy] Ошибка для ${url}:`, {
      message: e.message,
      type: e.type,
      name: e.name,
      stack: e.stack?.substring(0, 500)
    });
    res.status(500).send(`Internal server error: ${e.message || 'Unknown error'}`);
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
(() => {
  const SOURCES = [
    { id: 'chita', name: 'Chita.ru', url: 'https://www.chita.ru/rss-feeds/zen-news.xml' },
    { id: 'zabmedia', name: 'Забмедиа', url: 'https://zab.ru/rss/index.php' },
    { id: 'zabnews', name: 'ZabNews', url: 'https://zabnews.ru/YandexRss.rss' },
    { id: 'mkchita', name: 'МК Чита', url: 'https://www.mkchita.ru/news/' },
    { id: 'chitamedia', name: 'ЧитаМедиа', url: 'https://chitamedia.su/export/new/news81.rss' },
  ];

  const STORAGE_KEYS = { tzOffsetMin: 'newsTimeOffsetMin', cellColors: 'cellColors' };

  const dom = {
    dateEl: document.getElementById('current-date'),
    tzSelect: document.getElementById('timezone-select'),
    refreshBtn: document.getElementById('refresh-btn'),
    headRow: document.getElementById('table-head-row'),
    tbody: document.getElementById('table-body'),
    sentinel: document.getElementById('sentinel'),
    cellTpl: /** @type {HTMLTemplateElement} */ (document.getElementById('news-cell-template')),
    paletteColors: document.getElementById('palette-colors'),
    paletteClear: document.getElementById('palette-clear'),
  };

  let state = {
    tzOffsetMin: loadSavedTzOffset(),
    columns: [],
    maxRows: 0,
    renderedRows: 0,
    batchSize: 40,
    selectedColor: null,
    cellColors: loadCellColors(), // key: `${colIdx}:${rowIdx}` -> color
  };

  const PUBLIC_PROXIES = [
    (u) => `https://r.jina.ai/http/${u.replace(/^https?:\/\//, '')}`,
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  ];

  const PALETTE = [
    '#e2e8f0', '#cbd5e1', '#bfdbfe', '#93c5fd', '#a7f3d0',
    '#86efac', '#fde68a', '#fcd34d', '#fca5a5', '#f9a8d4',
    '#f5d0fe', '#ddd6fe', '#c7d2fe', '#bae6fd', '#a5f3fc',
    '#fecaca', '#fed7aa', '#fde68a', '#d9f99d', '#bbf7d0'
  ];

  // Функции для стабильных ключей на основе ссылок
  function normalizeLink(raw) {
    try {
      const u = new URL(raw);
      u.hash = '';
      // убираем рекламные метки
      const params = u.searchParams;
      ['utm_source','utm_medium','utm_campaign','utm_term','utm_content'].forEach(p => params.delete(p));
      u.search = params.toString() ? `?${params.toString()}` : '';
      // убираем финальный слэш кроме корня
      if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
      return u.href;
    } catch { return raw; }
  }

  function hash32(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
    return (h >>> 0).toString(16);
  }

  function getCellKey(link) {
    return `lnk:${hash32(normalizeLink(link))}`;
  }

  // Init
  populateTimezoneSelect();
  updateHeaderDate();
  renderTableHead();
  buildPalette();
  attachEvents();
  loadAllSources().then(() => {
    resetTableBody();
    renderNextBatch(true);
    setupInfiniteScroll();
  });

  function attachEvents() {
    dom.tzSelect.addEventListener('change', () => {
      state.tzOffsetMin = Number(dom.tzSelect.value);
      saveTzOffset(state.tzOffsetMin);
      updateHeaderDate();
      loadAllSources().then(() => {
        resetTableBody();
        renderNextBatch(true);
      });
    });
    dom.refreshBtn.addEventListener('click', () => {
      dom.refreshBtn.disabled = true;
      loadAllSources().finally(() => {
        resetTableBody();
        renderNextBatch(true);
        dom.refreshBtn.disabled = false;
      });
    });
    dom.paletteClear?.addEventListener('click', () => {
      state.selectedColor = null;
      for (const el of dom.paletteColors.querySelectorAll('.palette__color')) el.classList.remove('is-selected');
    });
  }

  function buildPalette() {
    if (!dom.paletteColors) return;
    dom.paletteColors.innerHTML = '';
    PALETTE.forEach((color) => {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'palette__color';
      sw.style.background = color;
      sw.setAttribute('aria-label', `Цвет ${color}`);
      sw.addEventListener('click', () => {
        if (state.selectedColor === color) {
          state.selectedColor = null;
          sw.classList.remove('is-selected');
          return;
        }
        state.selectedColor = color;
        for (const el of dom.paletteColors.querySelectorAll('.palette__color')) el.classList.remove('is-selected');
        sw.classList.add('is-selected');
      });
      dom.paletteColors.appendChild(sw);
    });
  }

  function handleCellColoring(cell, linkKey) {
    cell.addEventListener('click', (ev) => {
      // не реагируем на клики по ссылке
      if (ev.target && (ev.target.closest && ev.target.closest('a'))) return;
      // если нет ключа ссылки — ничего не делаем
      if (!linkKey) return;

      const current = state.cellColors[linkKey];
      
      if (state.selectedColor) {
        // есть выбранный цвет — применяем/снимаем его
        if (current === state.selectedColor) {
          delete state.cellColors[linkKey];
          cell.style.background = '';
        } else {
          state.cellColors[linkKey] = state.selectedColor;
          cell.style.background = state.selectedColor;
        }
      } else {
        // нет выбранного цвета — снимаем любой существующий цвет
        if (current) {
          delete state.cellColors[linkKey];
          cell.style.background = '';
        }
      }
      saveCellColors();
    });
  }

  function loadCellColors() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.cellColors) || '{}'); } catch { return {}; }
  }
  function saveCellColors() {
    localStorage.setItem(STORAGE_KEYS.cellColors, JSON.stringify(state.cellColors));
  }

  function populateTimezoneSelect() {
    const offsets = buildUtcOffsets();
    dom.tzSelect.innerHTML = '';
    offsets.forEach(({ minutes, label }) => {
      const opt = document.createElement('option');
      opt.value = String(minutes);
      opt.textContent = label;
      if (minutes === state.tzOffsetMin) opt.selected = true;
      dom.tzSelect.appendChild(opt);
    });
  }

  function buildUtcOffsets() {
    const fixed = [
      -12, -11, -10, -9.5, -9, -8, -7, -6, -5, -4, -3.5, -3, -2, -1,
      0, 1, 2, 3, 3.5, 4, 4.5, 5, 5.5, 5.75, 6, 6.5, 7, 8, 8.75, 9,
      9.5, 10, 10.5, 11, 12, 12.75, 13, 14
    ];
    const result = fixed.map((val) => {
      const minutes = Math.round(val * 60);
      const sign = minutes >= 0 ? '+' : '-';
      const abs = Math.abs(minutes);
      const hh = String(Math.floor(abs / 60)).padStart(2, '0');
      const mm = String(abs % 60).padStart(2, '0');
      return { minutes, label: `UTC${sign}${hh}:${mm}` };
    });
    const browserOffsetMin = -new Date().getTimezoneOffset();
    if (!result.some(r => r.minutes === browserOffsetMin)) {
      const sign = browserOffsetMin >= 0 ? '+' : '-';
      const abs = Math.abs(browserOffsetMin);
      const hh = String(Math.floor(abs / 60)).padStart(2, '0');
      const mm = String(abs % 60).padStart(2, '0');
      result.push({ minutes: browserOffsetMin, label: `Локально (UTC${sign}${hh}:${mm})` });
    }
    result.sort((a, b) => a.minutes - b.minutes);
    return result;
  }

  function loadSavedTzOffset() {
    const saved = localStorage.getItem(STORAGE_KEYS.tzOffsetMin);
    if (saved != null) return Number(saved);
    return -new Date().getTimezoneOffset();
  }
  function saveTzOffset(min) {
    localStorage.setItem(STORAGE_KEYS.tzOffsetMin, String(min));
  }

  function updateHeaderDate() {
    const now = nowInOffset(state.tzOffsetMin);
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    dom.dateEl.textContent = `${dd}.${mm}.${yyyy}`;
    document.title = `Сводка новостей — ${dd}.${mm}.${yyyy}`;
  }

  function renderTableHead() {
    dom.headRow.innerHTML = '';
    SOURCES.forEach((src) => {
      const th = document.createElement('th');
      th.textContent = src.name;
      dom.headRow.appendChild(th);
    });
  }

  async function loadAllSources() {
    const today = datePartsInOffset(nowInOffset(state.tzOffsetMin));
    const perSource = await Promise.all(
      SOURCES.map(src => loadSource(src, state.tzOffsetMin, today))
    );
    state.columns = perSource;
    state.maxRows = Math.max(0, ...perSource.map(col => col.length));
    state.renderedRows = 0;
  }

  async function loadSource(src, tzOffsetMin, todayParts) {
    if (src.id === 'mkchita') {
      return await loadMkchitaSource(src, tzOffsetMin, todayParts);
    } else {
      const xmlText = await fetchWithCorsFallback(src.url);
      const parsed = parseRss(xmlText);
      const items = parsed.items.map(i => ({
        title: i.title || '',
        link: i.link || '#',
        pubDate: i.pubDate ? new Date(i.pubDate) : null,
      })).filter(i => i.title && i.link && i.pubDate);
      const filtered = items.filter(i => isSameDayInOffset(i.pubDate, tzOffsetMin, todayParts));
      filtered.sort((a, b) => b.pubDate - a.pubDate);
      return filtered;
    }
  }

  async function loadMkchitaSource(src, tzOffsetMin, todayParts) {
    const htmlText = await fetchWithCorsFallback(src.url);
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');

    const items = [];
    const nowChita = nowInOffset(9 * 60); // Чита UTC+9
    const currentYear = nowChita.getUTCFullYear();
    const todayChitaParts = { y: nowChita.getUTCFullYear(), m: nowChita.getUTCMonth() + 1, d: nowChita.getUTCDate() };

    // Найдём все заголовки дат и собираем элементы до следующего заголовка даты
    const dateHeads = Array.from(doc.querySelectorAll('h2.news-listing__day-date'));
    if (dateHeads.length) {
      for (let i = 0; i < dateHeads.length; i++) {
        const head = dateHeads[i];
        const nextHead = dateHeads[i + 1] || null;
        const dateText = (head.textContent || '').trim();
        const dparts = parseRuDate(dateText, currentYear) || { y: currentYear, m: nowChita.getUTCMonth() + 1, d: nowChita.getUTCDate() };

        let node = head.nextElementSibling;
        while (node && node !== nextHead) {
          // Собираем все li.news-listing__item в поддереве между заголовками
          if (node.querySelectorAll) {
            const list = node.matches('li.news-listing__item') ? [node] : Array.from(node.querySelectorAll('li.news-listing__item'));
            for (const article of list) {
              const linkEl = article.querySelector('a.news-listing__item-link');
              const timeEl = article.querySelector('span.news-listing__item-time');
              const titleEl = article.querySelector('h3.news-listing__item-title');
              if (!linkEl || !timeEl || !titleEl) continue;

              const rawHref = linkEl.getAttribute('href') || '';
              const link = (() => { try { const u = new URL(rawHref, src.url); u.hash=''; return u.href; } catch { return '#'; } })();
              const rawTitle = (titleEl.textContent || '').trim();
              const timeText = (timeEl.textContent || '').trim();
              const tm = timeText.match(/^(\d{1,2}):(\d{2})$/);
              if (!tm) continue;
              const hh = Number(tm[1]);
              const mm = Number(tm[2]);

              // Чита UTC+9 -> UTC
              const utcMs = Date.UTC(
                dparts.y,
                dparts.m - 1,
                dparts.d,
                hh - 9,
                mm,
                0
              );
              const pubDate = new Date(utcMs);
              if (!rawTitle || link === '#' || isNaN(pubDate.getTime())) continue;
              items.push({ title: rawTitle, link, pubDate });
            }
          }
          node = node.nextElementSibling;
        }
      }
    } else {
      // Fallback: нет заголовков — собираем все элементы и считаем сегодняшнюю дату Читы
      const dparts = { y: nowChita.getUTCFullYear(), m: nowChita.getUTCMonth() + 1, d: nowChita.getUTCDate() };
      const articles = Array.from(doc.querySelectorAll('li.news-listing__item'));
      for (const article of articles) {
        const linkEl = article.querySelector('a.news-listing__item-link');
        const timeEl = article.querySelector('span.news-listing__item-time');
        const titleEl = article.querySelector('h3.news-listing__item-title');
        if (!linkEl || !timeEl || !titleEl) continue;
        const rawHref = linkEl.getAttribute('href') || '';
        const link = (() => { try { const u = new URL(rawHref, src.url); u.hash=''; return u.href; } catch { return '#'; } })();
        const rawTitle = (titleEl.textContent || '').trim();
        const timeText = (timeEl.textContent || '').trim();
        const tm = timeText.match(/^(\d{1,2}):(\d{2})$/);
        if (!tm) continue;
        const hh = Number(tm[1]);
        const mm = Number(tm[2]);
        const utcMs = Date.UTC(dparts.y, dparts.m - 1, dparts.d, hh - 9, mm, 0);
        const pubDate = new Date(utcMs);
        if (!rawTitle || link === '#' || isNaN(pubDate.getTime())) continue;
        items.push({ title: rawTitle, link, pubDate });
      }
    }

    // Дедупликация по ссылке
    const uniqueItems = [];
    const seenLinks = new Set();
    for (const item of items) {
      if (!seenLinks.has(item.link)) {
        seenLinks.add(item.link);
        uniqueItems.push(item);
      }
    }

    const filtered = uniqueItems.filter(i => isSameDayInOffset(i.pubDate, tzOffsetMin, todayParts));
    filtered.sort((a, b) => b.pubDate - a.pubDate);
    return filtered;
  }

  function parseRuDate(text, fallbackYear) {
    const t = text.toLowerCase().replace(/\s+/g, ' ').trim();
    // dd.mm.yyyy или dd.mm
    let m = t.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/);
    if (m) {
      const d = Number(m[1]);
      const mo = Number(m[2]);
      const y = m[3] ? Number(m[3].length === 2 ? ('20' + m[3]) : m[3]) : fallbackYear;
      if (d && mo) return { y, m: mo, d };
    }
    // 20 октября 2025 или 20 октября
    const months = {
      'января': 1, 'февраля': 2, 'марта': 3, 'апреля': 4, 'мая': 5, 'июня': 6,
      'июля': 7, 'августа': 8, 'сентября': 9, 'октября': 10, 'ноября': 11, 'декабря': 12
    };
    m = t.match(/^(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?/);
    if (m) {
      const d = Number(m[1]);
      const mo = months[m[2]];
      const y = m[3] ? Number(m[3]) : fallbackYear;
      if (d && mo) return { y, m: mo, d };
    }
    return null;
  }

  async function fetchWithCorsFallback(url) {
    // helper: decode via TextDecoder respecting windows-1251 when indicated
    async function decodeResponse(r) {
      const ct = (r.headers.get('content-type') || '').toLowerCase();
      const buf = await r.arrayBuffer();
      const utf8 = new TextDecoder('utf-8').decode(buf);
      const decl = utf8.slice(0, 200).toLowerCase();
      const is1251 = ct.includes('windows-1251') || decl.includes('encoding="windows-1251"') || decl.includes('encoding=\'windows-1251\'');
      if (is1251 && typeof TextDecoder !== 'undefined') {
        try { return new TextDecoder('windows-1251').decode(buf); } catch {}
      }
      return utf8;
    }
    try {
      const r = await fetch(`/proxy?url=${encodeURIComponent(url)}`, { cache: 'no-store' });
      if (r.ok) return await decodeResponse(r);
    } catch {}
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (r.ok) return await decodeResponse(r);
    } catch {}
    for (const wrap of PUBLIC_PROXIES) {
      const proxied = wrap(url);
      try { const r = await fetch(proxied, { cache: 'no-store' }); if (r.ok) return await decodeResponse(r); } catch {}
    }
    throw new Error('Не удалось получить RSS: ' + url);
  }

  function parseRss(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');
    const itemNodes = Array.from(doc.querySelectorAll('item'));
    const items = itemNodes.map(node => ({
      title: textContent(node, 'title'),
      link: textContent(node, 'link'),
      pubDate: textContent(node, 'pubDate'),
    }));
    return { items };
  }
  function textContent(parent, sel) { const n = parent.querySelector(sel); return n ? (n.textContent || '').trim() : ''; }

  function nowInOffset(offsetMin) { const now = new Date(); const utc = now.getTime() + now.getTimezoneOffset() * 60000; return new Date(utc + offsetMin * 60000); }
  function datePartsInOffset(dateInOffset) { return { y: dateInOffset.getUTCFullYear(), m: dateInOffset.getUTCMonth() + 1, d: dateInOffset.getUTCDate() }; }
  function isSameDayInOffset(dateUtc, offsetMin, targetParts) { const shifted = new Date(dateUtc.getTime() + offsetMin * 60000); return shifted.getUTCFullYear() === targetParts.y && (shifted.getUTCMonth() + 1) === targetParts.m && shifted.getUTCDate() === targetParts.d; }
  function formatTimeInOffset(dateUtc, offsetMin) { const shifted = new Date(dateUtc.getTime() + offsetMin * 60000); const hh = String(shifted.getUTCHours()).padStart(2, '0'); const mm = String(shifted.getUTCMinutes()).padStart(2, '0'); return `${hh}:${mm}`; }

  function resetTableBody() { dom.tbody.innerHTML = ''; }

  function renderNextBatch(first = false) {
    const start = state.renderedRows;
    const end = Math.min(state.maxRows, start + (first ? state.batchSize : 30));
    for (let rowIdx = start; rowIdx < end; rowIdx++) {
      const tr = document.createElement('tr');
      for (let c = 0; c < SOURCES.length; c++) {
        const cell = dom.cellTpl.content.firstElementChild.cloneNode(true);
        const item = state.columns[c]?.[rowIdx];
        const a = cell.querySelector('.news-title');
        const time = cell.querySelector('.news-time');
        if (item) {
          a.textContent = item.title;
          a.href = item.link;
          time.textContent = formatTimeInOffset(item.pubDate, state.tzOffsetMin);
        } else {
          a.textContent = '';
          a.removeAttribute('href');
          time.textContent = '';
        }
        // Применить сохранённый цвет по ключу ссылки, подключить обработчик кликов
        const linkKey = item ? getCellKey(item.link) : null;
        if (linkKey && state.cellColors[linkKey]) cell.style.background = state.cellColors[linkKey];
        handleCellColoring(cell, linkKey);

        tr.appendChild(cell);
      }
      dom.tbody.appendChild(tr);
    }
    state.renderedRows = end;
  }

  function setupInfiniteScroll() {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && state.renderedRows < state.maxRows) {
          renderNextBatch(false);
        }
      }
    }, { root: null, rootMargin: '600px 0px', threshold: 0 });
    io.observe(dom.sentinel);
  }
})();
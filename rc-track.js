/*
 * racechat.pt — простая аналитика: кто заходит, какие разделы открывают, откуда пришли.
 * События уходят в тот же Apps Script, что и регистрации (action: 'track'),
 * и пишутся строкой в таблицу «racechat.pt — аналитика» (лист «Лог», сводка — лист «Сводка»).
 *
 * Подключение:  <script src="/rc-track.js"></script>  (+ data-page="имя" — сразу записать просмотр страницы)
 *   rcTrack('view', 'drivers')              — открыт раздел
 *   rcTrack('profile', 'Сводка', '@handle') — событие с деталями
 *   rcTrack.setWho('@handle')               — запомнить, кто сидит в этом браузере
 * Ссылки в постах можно метить: racechat.pt/?src=channel → источник «channel».
 */
(function () {
  var me = document.currentScript;
  var API = 'https://script.google.com/macros/s/AKfycbyePWRgZqXMs90Tby6WzCnCHFyomEZ0ryLJxdDPG-bz2ziDgEmAqLeXgL1T0BPNs_KN/exec';

  // Не считаем локальную разработку и превью
  var host = location.hostname;
  var off = !/racechat\.pt$/.test(host) && !/github\.io$/.test(host);

  function rid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
  function keep(storage, key) {
    try {
      var v = storage.getItem(key);
      if (!v) { v = rid(); storage.setItem(key, v); }
      return v;
    } catch (e) { return 'na'; }
  }
  var vid = keep(window.localStorage, 'rc_vid');     // браузер (уникальный посетитель)
  var newSession = false;
  try { newSession = !sessionStorage.getItem('rc_sid'); } catch (e) {}
  var sid = keep(window.sessionStorage, 'rc_sid');   // визит

  function tgApp() {
    var w = window.Telegram && window.Telegram.WebApp;
    return w && w.initData ? w : null;               // initData непустой только внутри Mini App
  }
  function who() {
    var w = tgApp(), u = w && w.initDataUnsafe && w.initDataUnsafe.user;
    if (u && u.username) return '@' + u.username;
    if (u && u.first_name) return [u.first_name, u.last_name].filter(Boolean).join(' ');
    try { return localStorage.getItem('rc_who') || ''; } catch (e) { return ''; }
  }
  function source() {
    var q = location.search.match(/[?&](?:src|utm_source)=([^&#]+)/);
    if (q) return decodeURIComponent(q[1]);
    var w = tgApp();
    if (w) return 'tg-miniapp' + (w.initDataUnsafe && w.initDataUnsafe.start_param ? ':' + w.initDataUnsafe.start_param : '');
    if (window.TelegramWebviewProxy || window.TelegramWebview) return 'tg-browser';   // ссылка открыта во встроенном браузере Telegram
    var r = document.referrer;
    if (r) {
      try {
        var h = new URL(r).hostname.replace(/^www\./, '');
        if (h && h !== host) return /t\.me|telegram/.test(h) ? 'telegram' : h;
      } catch (e) {}
      return '';
    }
    return 'direct';
  }
  function device() {
    var w = tgApp();
    if (w && w.platform && w.platform !== 'unknown') return w.platform;
    var ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
    if (/Android/.test(ua)) return 'android';
    return /Mobi/.test(ua) ? 'mobile' : 'desktop';
  }
  function lang() {
    return (document.documentElement.lang || navigator.language || '').slice(0, 2);
  }

  var SRC = source(), DEV = device();
  var last = '', lastAt = 0;

  function send(type, page, detail) {
    if (off) return;
    var key = type + '|' + page + '|' + detail;
    var now = Date.now();
    if (key === last && now - lastAt < 3000) return;   // двойные клики / повторный рендер
    last = key; lastAt = now;
    var body = JSON.stringify({
      action: 'track', t: type, p: page || '', d: detail || '',
      vid: vid, sid: sid, who: who(), src: SRC, dev: DEV, lang: lang(),
      path: location.pathname + location.hash
    });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(API, new Blob([body], { type: 'text/plain;charset=UTF-8' }))) return;
    } catch (e) {}
    try {
      fetch(API, { method: 'POST', mode: 'no-cors', keepalive: true, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body }).catch(function () {});
    } catch (e) {}
  }

  window.rcTrack = function (type, page, detail) { send(type, page, detail); };
  window.rcTrack.setWho = function (h) {
    h = String(h || '').trim();
    if (!h) return;
    try { localStorage.setItem('rc_who', h); } catch (e) {}
  };

  // Начало визита — один раз за сессию
  if (newSession) send('open', location.pathname, document.referrer ? document.referrer.slice(0, 120) : '');

  // Отдельные страницы (coach, rotax): <script src="/rc-track.js" data-page="coach"> → сразу «view»
  if (me && me.getAttribute('data-page')) send('view', me.getAttribute('data-page'), '');

  // Клики по внешним ссылкам (чат, Telegram, карты, оплата)
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (/^https?:\/\//.test(href) && href.indexOf(location.host) === -1) send('out', href.replace(/^https?:\/\//, '').slice(0, 60), (a.textContent || '').trim().slice(0, 60));
  }, true);
})();

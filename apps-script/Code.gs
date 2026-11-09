/**
 * Катаемся Чатом — регистрации на гонки (racechat.pt)
 * Один проект Apps Script на все ивенты: каждый ивент пишет в свою таблицу (EVENTS ниже).
 * Код на чистом ES5 (var, без стрелок и шаблонных строк) — работает и на Rhino, и на V8.
 *
 * УСТАНОВКА (один раз)
 *  1. script.google.com → «Новый проект» → вставить этот файл целиком вместо Code.gs.
 *  2. Вписать в SECRETS ниже GH_TOKEN (фото → GitHub) и BOT_TOKEN (уведомления в Telegram) —
 *     те же, что в прошлом скрипте. Пустые → регистрация работает, просто без фото / без сообщений.
 *     (Можно вместо этого задать их в ⚙️ Настройки проекта → «Свойства скрипта».)
 *     ⚠️ Этот файл в репозитории хранится с ПУСТЫМИ токенами — репо публичный, токены туда не коммитить.
 *  3. Выбрать функцию setup → «Выполнить» → разрешить доступ (оформит обе таблицы).
 *  4. «Развернуть» → «Новое развёртывание» → тип «Веб-приложение»:
 *       Запуск от имени: «Я» · У кого есть доступ: «Все» → «Развернуть» → скопировать URL …/exec
 *     Этот URL — REG_API в index.html (один на оба ивента).
 *  ПОСЛЕ ЛЮБОЙ ПРАВКИ КОДА: «Развернуть» → «Управление развёртываниями» → ✏️ →
 *     Версия: «Новая версия» → «Развернуть». Просто сохранить — недостаточно. URL не меняется.
 *
 * API (совпадает с фронтендом)
 *  GET  ?event=ID&callback=cb                       → cb({ regs: [...] })
 *  GET  ?action=register&event=ID&callback=cb&...   → cb({ ok: true, regs }) | cb({ ok: false, reason })
 *       reason: full | duplicate | mate_dup | invalid | closed | busy | error
 *  POST { action: 'photo', event, name, handle, telegram_id, photoBase64 }  → фото в photos/{ключ}.jpg
 *  POST { action: 'track', t, p, d, vid, sid, who, src, dev, lang, path }     → строка в таблицу аналитики
 *
 * АНАЛИТИКА (один раз): выбрать функцию setupAnalytics → «Выполнить». Создаст таблицу
 *  «racechat.pt — аналитика» (листы «Лог» и «Сводка»), ссылка — в журнале выполнения.
 *  Повторный запуск setupAnalytics пересобирает «Сводку», лог не трогает.
 */

var EVENTS = {
  'campera-oct': {
    title: 'Campera 18.10',
    sheetId: '1mPkZ0Z3A_wfYig4qhG7PMeKQX6AWR9SRLlbe6t3E-yM',
    kind: 'sprint',
    open: true,
    maxDrivers: 24,          // лимит пилотов
    price: 55,
    dmWhen: 'Ждём тебя 18 октября в 15:00 в Campera Karting (Carregado).',
    dmFormat: '2 × (5 мин квалификации + 10 мин гонки), карты 390cc.'
  },
  'endurance-nov': {
    title: 'Эндуранс KIP 01.11',
    sheetId: '1Rpo827tpqXseK5GvJvH4I0x5Awl3zukg8Akvbmc95fo',
    kind: 'endurance',
    open: true,
    maxTeams: 36,            // лимит команд (картов): команда = 1, Iron Man = 1, двое из жеребьёвки = 1
    price: { team: 75, draft: 75, ironman: 130 },  // € с участника
    dmWhen: 'Эндуранс · 1 ноября в 13:00, KIP Palmela.',
    dmFormat: '15 мин квалификации + 50 мин гонки, 1 пит-стоп (≥ 3 мин) + джокер-круг. Карты Sodi RT-10 390cc.'
  },
  'rotax-nov': {
    title: 'Rotax Almeirim 07.11',
    sheetId: '1bOEKeKWwiZl2qZ5Y9ZCCvY_De7Wx-MjCEcalo4m8U0w',
    kind: 'rental',          // прокат: пилот выбирает окно, класс карта — по желанию
    open: true,
    sessions: ['10:00–12:00', '12:00–14:00', '14:00–16:00'],
    windowCap: 12,           // сколько пилотов в одном окне
    classes: {
      max:    { label: 'Rotax Max' },
      dd2:    { label: 'Rotax DD2' },
      junior: { label: 'Rotax Junior' }
    },
    price: null,             // цена уточняется — пока в DM пишем «пришлём отдельно»
    dmWhen: 'Прокат Rotax · суббота, 7 ноября, Kartódromo de Almeirim.',
    dmFormat: 'Сессии по 15 минут, шасси Tony Kart.'
  }
};

// ⬇ Токены. В публичный репозиторий — только пустыми.
var SECRETS = {
  GH_TOKEN: '',     // GitHub fine-grained PAT: Contents Read and write, только Karting_Pt
  BOT_TOKEN: ''     // Telegram-бот, который пишет участнику и в оргчат
};
var CORE_CHAT = -1003970912551;   // оргчат: «✅ Новая регистрация»
var PAY = { revolut: 'https://revolut.me/renat1xmv', iban: 'LT843250088480951926', ibanName: 'Renat Ashrafedinov' };

var GITHUB = { repo: 'evgburan/Karting_Pt', branch: 'main', dir: 'photos' };
var PHOTO_WINDOW_MIN = 30;   // фото принимаем только к свежей регистрации

// Заголовки столбцов в таблицах (порядок столбцов можно менять — ищем по названию)
var COL = {
  ts: 'Дата', mode: 'Формат', name: 'Имя', handle: 'Telegram',
  mate: 'Напарник', mateHandle: 'Telegram напарника', team: 'Команда',
  tgid: 'Telegram ID', beginner: 'Новичок', hide: 'Скрыть ник',
  due: 'К оплате €', photo: 'Фото', paid: 'Оплачено', note: 'Комментарий',
  session: 'Окно', kart: 'Карт', exp: 'Опыт', height: 'Рост, см', weight: 'Вес, кг'
};
var BOOL_COLS = ['beginner', 'hide', 'paid'];
var MODE_LABEL = { team: 'Команда', draft: 'Жеребьёвка', ironman: 'Iron Man' };

// ───────────────────────── HTTP ─────────────────────────

function doGet(e) {
  var p = (e && e.parameter) || {};
  var cb = safeCallback(p.callback);
  var out;
  try {
    out = p.action === 'register' ? register(p) : { regs: listRegs(p.event) };
  } catch (err) {
    console.error(err);
    out = { ok: false, reason: 'error' };
  }
  return respond(out, cb);
}

function doPost(e) {
  var data = {};
  try { data = JSON.parse(e.postData.contents); } catch (err) { return respond({ ok: false, reason: 'invalid' }); }
  try {
    if (data.action === 'photo') return respond(savePhoto(data));
    if (data.action === 'track') return respond(track(data));
  } catch (err) {
    console.error(err);
    return respond({ ok: false, reason: 'error' });
  }
  return respond({ ok: false, reason: 'invalid' });
}

function respond(obj, cb) {
  var json = JSON.stringify(obj);
  if (cb) {
    return ContentService.createTextOutput(cb + '(' + json + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function safeCallback(cb) {
  return /^[A-Za-z_$][A-Za-z0-9_$]{0,80}$/.test(cb || '') ? cb : '';
}

// ───────────────────────── Список ─────────────────────────

function listRegs(eventId) {
  var ev = EVENTS[eventId];
  if (!ev) return [];
  return readRows(sheetOf(ev)).map(function (r) { return publicReg(ev, r); });
}

// Что уходит на сайт: без Telegram ID и служебных полей
function publicReg(ev, r) {
  var o = { name: r.name, handle: r.handle, hideHandle: !!r.hide, beginner: !!r.beginner, photoUrl: r.photo || '' };
  if (ev.kind === 'endurance') {
    o.mode = r.mode;
    o.team = r.team;
    o.mate = r.mate;
    o.mateHandle = r.mateHandle;
  }
  if (ev.kind === 'rental') {
    o.session = r.session;
    o.kart = r.kart;
  }
  return o;
}

// ───────────────────────── Регистрация ─────────────────────────

function register(p) {
  var ev = EVENTS[p.event];
  if (!ev || !ev.open) return { ok: false, reason: 'closed' };

  var name = clean(p.name, 60);
  var handle = cleanHandle(p.handle);
  var tgid = clean(p.telegram_id, 20);
  if (!name) return { ok: false, reason: 'invalid' };

  var mode = '', mate = '', mateHandle = '', team = '';
  if (ev.kind === 'endurance') {
    mode = String(p.mode || '');
    if (!MODE_LABEL[mode]) return { ok: false, reason: 'invalid' };
    if (mode === 'team') {
      mate = clean(p.mate, 60);
      mateHandle = cleanHandle(p.mate_handle);
      team = clean(p.team, 40);
      if (!mate) return { ok: false, reason: 'invalid' };
    }
  }

  var session = '', kart = '', exp = '', height = '', weight = '';
  if (ev.kind === 'rental') {
    session = String(p.session || '');
    kart = String(p.kart || '');
    exp = clean(p.exp, 40);
    height = Number(p.height);
    weight = Number(p.weight);
    if (ev.sessions.indexOf(session) < 0 || (kart && !ev.classes[kart])) return { ok: false, reason: 'invalid' };
    if (!(height >= 120 && height <= 230) || !(weight >= 30 && weight <= 200)) return { ok: false, reason: 'invalid' };
  }

  var me = { name: name, handle: handle, tgid: tgid };
  var partner = mode === 'team' ? { name: mate, handle: mateHandle, tgid: '' } : null;
  if (partner && samePerson(me, partner)) return { ok: false, reason: 'invalid' };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, reason: 'busy' };
  try {
    var sh = sheetOf(ev);
    var rows = readRows(sh);

    // Дубли: и сам пилот, и его напарник не должны уже стоять в таблице (ни пилотом, ни напарником)
    for (var i = 0; i < rows.length; i++) {
      if (ev.kind === 'rental' && rows[i].session !== session) continue;   // в прокате можно взять несколько сессий
      var people = peopleOf(rows[i]);
      for (var j = 0; j < people.length; j++) {
        if (samePerson(me, people[j])) return { ok: false, reason: 'duplicate' };
        if (partner && samePerson(partner, people[j])) return { ok: false, reason: 'mate_dup' };
      }
    }

    // Места
    if (ev.kind === 'rental' && ev.windowCap) {
      var taken = 0;
      for (var q = 0; q < rows.length; q++) if (rows[q].session === session) taken++;
      if (taken >= ev.windowCap) return { ok: false, reason: 'full' };
    }
    if (ev.kind === 'sprint' && ev.maxDrivers && rows.length >= ev.maxDrivers) return { ok: false, reason: 'full' };
    if (ev.kind === 'endurance' && ev.maxTeams) {
      // нечётный пилот жеребьёвки встаёт в пару к уже записанному — новая команда не нужна
      var need = mode === 'draft' ? (countMode(rows, 'draft') % 2 === 0 ? 1 : 0) : 1;
      if (teamsUsed(rows) + need > ev.maxTeams) return { ok: false, reason: 'full' };
    }

    var row = {
      ts: new Date(), name: name, handle: handle, tgid: tgid,
      beginner: p.beginner === '1', hide: p.hide === '1', paid: false
    };
    if (ev.kind === 'endurance') {
      row.mode = MODE_LABEL[mode];
      row.mate = mate;
      row.mateHandle = mateHandle;
      row.team = team;
      row.due = mode === 'team' ? ev.price.team * 2 : ev.price[mode];
    }
    if (ev.kind === 'rental') {
      row.session = session;
      row.kart = kart ? ev.classes[kart].label : 'На месте';
      row.exp = exp;
      row.height = height;
      row.weight = weight;
      if (ev.price) row.due = ev.price;
    }
    writeRow(sh, row);
    SpreadsheetApp.flush();
    row._session = session;
    row._kartCode = kart;

    var fresh = readRows(sh);
    notifyTelegram(ev, row, mode, tgid, fresh);
    return { ok: true, regs: fresh.map(function (r) { return publicReg(ev, r); }) };
  } finally {
    lock.releaseLock();
  }
}

function peopleOf(r) {
  var out = [{ name: r.name, handle: r.handle, tgid: r.tgid }];
  if (r.mate) out.push({ name: r.mate, handle: r.mateHandle, tgid: '' });
  return out;
}

// Один и тот же человек: совпал Telegram ID, @ник или имя
function samePerson(a, b) {
  if (a.tgid && b.tgid && String(a.tgid) === String(b.tgid)) return true;
  if (a.handle && b.handle && normHandle(a.handle) === normHandle(b.handle)) return true;
  return !!a.name && normName(a.name) === normName(b.name);
}

function countMode(rows, mode) {
  var n = 0;
  for (var i = 0; i < rows.length; i++) if (rows[i].mode === mode) n++;
  return n;
}

function teamsUsed(rows) {
  return countMode(rows, 'team') + countMode(rows, 'ironman') + Math.ceil(countMode(rows, 'draft') / 2);
}

function pilotsUsed(rows) {
  return countMode(rows, 'team') * 2 + countMode(rows, 'draft') + countMode(rows, 'ironman');
}

// ───────────────────────── Telegram ─────────────────────────

// Участнику — подтверждение с оплатой (если открыл форму из Telegram и писал боту), в оргчат — кто записался
function notifyTelegram(ev, row, mode, tgid, rows) {
  if (!secret('BOT_TOKEN')) return;
  try {
    var amount, payLine;
    if (ev.kind === 'endurance') {
      amount = row.due;
      payLine = mode === 'team' ? ' (2 × €' + ev.price.team + ' — за себя и напарника)' : '';
    } else {
      amount = ev.price;
      payLine = '';
    }
    if (ev.kind === 'rental') {
      var kl = row._kartCode ? ev.classes[row._kartCode].label : 'класс выберешь на месте';
      if (tgid) {
        var rl = ['🏁 ' + row.name + ', ты записан!', '', ev.dmWhen, 'Окно ' + row._session + ' · ' + kl + '.', 'Рост ' + row.height + ' см, вес ' + row.weight + ' кг — подгоним карт под тебя.'];
        if (ev.price) rl.push('', '💶 Оплата €' + ev.price + ':', 'Revolut: ' + PAY.revolut, 'IBAN: ' + PAY.iban + ' (' + PAY.ibanName + ')', 'В назначении укажи своё имя.');
        else rl.push('', '💶 Цену и оплату пришлём отдельно.');
        rl.push('', ev.dmFormat + ' До встречи на трассе! 🛞');
        sendTelegram(tgid, rl.join('\n'));
      }
      var inS = 0;
      for (var n = 0; n < rows.length; n++) if (rows[n].session === row._session) inS++;
      sendTelegram(CORE_CHAT, '✅ Новая регистрация · ' + ev.title + '\n' + row.name + (row.handle ? ' (' + row.handle + ')' : '') +
        '\nОкно ' + row._session + ' · ' + kl + ' · ' + row.height + ' см / ' + row.weight + ' кг' +
        '\nВ окне: ' + inS + (ev.windowCap ? ' / ' + ev.windowCap : '') + (row.exp ? '\nОпыт: ' + row.exp : ''));
      return;
    }
    if (tgid) {
      var lines = ['🏁 ' + row.name + ', ты в гонке!', '', ev.dmWhen];
      if (ev.kind === 'endurance') lines.push('Формат участия: ' + row.mode + (mode === 'team' ? ' с ' + row.mate + (row.team ? ' («' + row.team + '»)' : '') : ''));
      if (amount && mode === 'team') {
        lines.push('', '💶 Оплата: €' + ev.price.team + ' с участника — каждый платит за себя, или €' + amount + ' сразу за двоих:',
          'Revolut: ' + PAY.revolut, 'IBAN: ' + PAY.iban + ' (' + PAY.ibanName + ')',
          'В назначении укажи своё имя, а если платишь за двоих — оба имени.');
      } else if (amount) {
        lines.push('', '💶 Оплата €' + amount + payLine + ':', 'Revolut: ' + PAY.revolut, 'IBAN: ' + PAY.iban + ' (' + PAY.ibanName + ')', 'В назначении укажи своё имя.');
      }
      lines.push('', ev.dmFormat + ' До встречи на трассе! 🛞');
      sendTelegram(tgid, lines.join('\n'));
    }
    var who = row.name + (row.handle ? ' (' + row.handle + ')' : '');
    if (ev.kind === 'endurance') who += ' · ' + row.mode + (mode === 'team' ? ' + ' + row.mate + (row.team ? ' «' + row.team + '»' : '') : '');
    var total = ev.kind === 'endurance'
      ? 'Команд: ' + teamsUsed(rows) + ' / ' + ev.maxTeams + ' · пилотов: ' + pilotsUsed(rows)
      : 'Всего: ' + rows.length + (ev.maxDrivers ? ' / ' + ev.maxDrivers : '');
    sendTelegram(CORE_CHAT, '✅ Новая регистрация · ' + ev.title + '\n' + who + '\n' + total);
  } catch (err) {
    console.error(err);
  }
}

function sendTelegram(chatId, text) {
  UrlFetchApp.fetch('https://api.telegram.org/bot' + secret('BOT_TOKEN') + '/sendMessage', {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ chat_id: chatId, text: text }),
    muteHttpExceptions: true
  });
}

// Токен: из SECRETS, иначе из «Свойств скрипта»
function secret(name) {
  return SECRETS[name] || PropertiesService.getScriptProperties().getProperty(name) || '';
}

// Проверка из редактора: выбрать testTelegram → «Выполнить» → в оргчат придёт тестовое сообщение
function testTelegram() {
  sendTelegram(CORE_CHAT, 'Тест уведомлений · регистрации racechat.pt');
}

// ───────────────────────── Фото → GitHub ─────────────────────────

function savePhoto(d) {
  var ev = EVENTS[d.event];
  if (!ev) return { ok: false, reason: 'closed' };
  var m = String(d.photoBase64 || '').match(new RegExp('^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$'));
  if (!m || m[2].length > 3000000) return { ok: false, reason: 'invalid' };

  // Только к свежей регистрации этого человека, у которой ещё нет фото
  var who = { name: clean(d.name, 60), handle: cleanHandle(d.handle), tgid: clean(d.telegram_id, 20) };
  var sh = sheetOf(ev);
  var rows = readRows(sh);
  var target = null;
  var now = new Date().getTime();
  for (var i = rows.length - 1; i >= 0; i--) {
    var r = rows[i];
    var fresh = r.ts instanceof Date && now - r.ts.getTime() < PHOTO_WINDOW_MIN * 60000;
    if (fresh && !r.photo && samePerson(who, { name: r.name, handle: r.handle, tgid: r.tgid })) { target = r; break; }
  }
  if (!target) return { ok: false, reason: 'no_registration' };

  var token = secret('GH_TOKEN');
  if (!token) return { ok: false, reason: 'no_token' };

  var key = photoKey(target.handle, target.name);
  var path = GITHUB.dir + '/' + encodeURIComponent(key + '.jpg');
  var url = 'https://api.github.com/repos/' + GITHUB.repo + '/contents/' + path;
  var headers = {
    Authorization: 'token ' + token,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'racechat-registration'      // без User-Agent GitHub отвечает 403
  };
  var cur = UrlFetchApp.fetch(url + '?ref=' + GITHUB.branch, { method: 'get', headers: headers, muteHttpExceptions: true });
  var body = { message: 'Photo: ' + key + ' (' + ev.title + ')', content: m[2], branch: GITHUB.branch };
  if (cur.getResponseCode() === 200) body.sha = JSON.parse(cur.getContentText()).sha;
  var put = UrlFetchApp.fetch(url, {
    method: 'put', contentType: 'application/json', headers: headers,
    payload: JSON.stringify(body), muteHttpExceptions: true
  });
  var code = put.getResponseCode();
  if (code !== 200 && code !== 201) {
    console.error('GitHub ' + code + ': ' + put.getContentText());
    return { ok: false, reason: 'github_' + code };
  }
  var raw = 'https://raw.githubusercontent.com/' + GITHUB.repo + '/' + GITHUB.branch + '/' + path;
  setCell(sh, target._row, 'photo', raw);
  return { ok: true, photoUrl: raw };
}

// Ключ файла — как в getPhoto() на сайте: ник без @ в нижнем регистре, иначе имя-через-дефис
function photoKey(handle, name) {
  var h = normHandle(handle);
  if (h) return h;
  return String(name || '').toLowerCase().split(' ').filter(function (s) { return s; }).join('-');
}

// ───────────────────────── Таблица ─────────────────────────

function sheetOf(ev) {
  return SpreadsheetApp.openById(ev.sheetId).getSheets()[0];
}

// { key: номер столбца (1-based) } по заголовкам первой строки
function headerMap(sh) {
  var hdr = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
  var map = {};
  for (var key in COL) {
    for (var c = 0; c < hdr.length; c++) {
      if (String(hdr[c]).trim() === COL[key]) { map[key] = c + 1; break; }
    }
  }
  return map;
}

function readRows(sh) {
  var map = headerMap(sh);
  if (!map.name) throw new Error('Нет столбца «' + COL.name + '» в ' + sh.getName());
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var v = values[i];
    var get = function (k) { return map[k] ? v[map[k] - 1] : ''; };
    var name = String(get('name') || '').trim();
    if (!name) continue;
    rows.push({
      _row: i + 2,
      ts: get('ts'),
      name: name,
      handle: String(get('handle') || '').trim(),
      tgid: String(get('tgid') || '').trim(),
      beginner: toBool(get('beginner')),
      hide: toBool(get('hide')),
      photo: String(get('photo') || '').trim(),
      mode: modeCode(get('mode')),
      mate: String(get('mate') || '').trim(),
      mateHandle: String(get('mateHandle') || '').trim(),
      team: String(get('team') || '').trim(),
      session: String(get('session') || '').trim(),
      kart: kartCode(get('kart'))
    });
  }
  return rows;
}

// Новая строка — сразу под последней заполненной (чекбоксы не сдвигают «конец» таблицы)
function writeRow(sh, row) {
  var map = headerMap(sh);
  var width = sh.getLastColumn();
  var line = [];
  for (var c = 0; c < width; c++) line.push('');
  for (var key in row) {
    if (map[key]) line[map[key] - 1] = safeCellValue(row[key]);
  }
  var target = lastFilledRow(sh, map.name) + 1;
  sh.getRange(target, 1, 1, width).setValues([line]);
  var rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  BOOL_COLS.forEach(function (k) { if (map[k]) sh.getRange(target, map[k]).setDataValidation(rule); });
  return target;
}

function setCell(sh, rowNum, key, value) {
  var map = headerMap(sh);
  if (map[key]) sh.getRange(rowNum, map[key]).setValue(safeCellValue(value));
}

function lastFilledRow(sh, nameCol) {
  var last = sh.getLastRow();
  if (last < 2) return 1;
  var col = sh.getRange(2, nameCol, last - 1, 1).getValues();
  for (var i = col.length - 1; i >= 0; i--) if (String(col[i][0]).trim()) return i + 2;
  return 1;
}

// ───────────────────────── Оформление (запустить один раз) ─────────────────────────

function setup() {
  Object.keys(EVENTS).forEach(function (id) {
    var sh = sheetOf(EVENTS[id]);
    sh.setName(EVENTS[id].title);
    var width = sh.getLastColumn();
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#1a1a1a').setFontColor('#ffffff');
    var map = headerMap(sh);
    var widths = { session: 110, kart: 120, exp: 160, height: 80, weight: 80, ts: 140, mode: 110, name: 180, handle: 140, mate: 170, mateHandle: 150, team: 150, tgid: 110, beginner: 80, hide: 90, due: 90, photo: 120, paid: 90, note: 220 };
    for (var k in widths) if (map[k]) sh.setColumnWidth(map[k], widths[k]);
    if (map.ts) sh.getRange(2, map.ts, sh.getMaxRows() - 1, 1).setNumberFormat('dd.MM HH:mm');
    var last = lastFilledRow(sh, map.name);
    if (last >= 2) {
      var rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
      BOOL_COLS.forEach(function (key) { if (map[key]) sh.getRange(2, map[key], last - 1, 1).setDataValidation(rule); });
    }
  });
}

// ───────────────────────── Аналитика ─────────────────────────
// Сайт шлёт события через rc-track.js. Одна строка = одно событие.

var ANALYTICS_TZ = 'Europe/Lisbon';
var LOG_SHEET = 'Лог';
var SUMMARY_SHEET = 'Сводка';
var LOG_HEADERS = ['Время', 'День', 'Браузер', 'Визит', 'Кто', 'Событие', 'Раздел', 'Детали', 'Источник', 'Устройство', 'Язык', 'Адрес'];
var TRACK_TYPES = ['open', 'view', 'tab', 'profile', 'reg_open', 'reg_ok', 'reg_fail', 'out'];

function track(d) {
  var type = clean(d.t, 20);
  if (TRACK_TYPES.indexOf(type) === -1) return { ok: false, reason: 'invalid' };
  var now = new Date();
  var row = [
    now,
    Utilities.parseDate(Utilities.formatDate(now, ANALYTICS_TZ, 'yyyy-MM-dd'), ANALYTICS_TZ, 'yyyy-MM-dd'),   // полночь по Лиссабону
    clean(d.vid, 24), clean(d.sid, 24), clean(d.who, 60),
    type, clean(d.p, 60), clean(d.d, 120), clean(d.src, 60),
    clean(d.dev, 20), clean(d.lang, 5), clean(d.path, 80)
  ].map(safeCellValue);
  logSheet().appendRow(row);
  return { ok: true };
}

function logSheet() {
  var id = PropertiesService.getScriptProperties().getProperty('ANALYTICS_SHEET_ID');
  if (!id) {
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      id = PropertiesService.getScriptProperties().getProperty('ANALYTICS_SHEET_ID') || setupAnalytics();
    } finally { lock.releaseLock(); }
  }
  return SpreadsheetApp.openById(id).getSheetByName(LOG_SHEET);
}

// Запустить из редактора один раз. Повторно — пересобирает «Сводку».
function setupAnalytics() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('ANALYTICS_SHEET_ID');
  var ss;
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create('racechat.pt — аналитика');
    ss.setSpreadsheetTimeZone(ANALYTICS_TZ);
    props.setProperty('ANALYTICS_SHEET_ID', ss.getId());
  }

  var log = ss.getSheetByName(LOG_SHEET);
  if (!log) {
    log = ss.getSheets()[0];
    log.setName(LOG_SHEET);
  }
  log.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS])
    .setFontWeight('bold').setBackground('#1a1a1a').setFontColor('#ffffff');
  log.setFrozenRows(1);
  log.getRange('A2:A').setNumberFormat('dd.MM HH:mm');
  log.getRange('B2:B').setNumberFormat('yyyy-MM-dd');
  var w = [110, 90, 100, 100, 150, 80, 110, 200, 120, 80, 50, 160];
  for (var i = 0; i < w.length; i++) log.setColumnWidth(i + 1, w[i]);

  var sum = ss.getSheetByName(SUMMARY_SHEET) || ss.insertSheet(SUMMARY_SHEET, 0);
  sum.clear();
  buildSummary(sum);

  console.log('Аналитика: ' + ss.getUrl());
  return ss.getId();
}

function buildSummary(sh) {
  var L = "'" + LOG_SHEET + "'!";
  var since30 = 'datetime \'"&TEXT(NOW()-30,"yyyy-mm-dd HH:mm:ss")&"\'';
  function q(select) { return '=IFERROR(QUERY(' + L + 'A2:L,"' + select + '",0),"—")'; }

  sh.getRange('A1').setValue('racechat.pt — сводка').setFontSize(14).setFontWeight('bold');
  sh.getRange('A2').setValue('Обновляется сама. «Браузер» = уникальный посетитель (телефон/комп), «Визит» = один заход.').setFontColor('#888888');

  // KPI
  var kpi = [
    ['Посетителей за 7 дней', '=COUNTUNIQUEIFS(' + L + 'C2:C,' + L + 'A2:A,">="&(NOW()-7))'],
    ['Посетителей за 30 дней', '=COUNTUNIQUEIFS(' + L + 'C2:C,' + L + 'A2:A,">="&(NOW()-30))'],
    ['Визитов за 7 дней', '=COUNTUNIQUEIFS(' + L + 'D2:D,' + L + 'A2:A,">="&(NOW()-7))'],
    ['Визитов за 30 дней', '=COUNTUNIQUEIFS(' + L + 'D2:D,' + L + 'A2:A,">="&(NOW()-30))'],
    ['Узнанных людей за 30 дней', '=COUNTUNIQUEIFS(' + L + 'E2:E,' + L + 'A2:A,">="&(NOW()-30),' + L + 'E2:E,"<>")'],
    ['Регистраций с сайта за 30 дней', '=COUNTIFS(' + L + 'F2:F,"reg_ok",' + L + 'A2:A,">="&(NOW()-30))'],
    ['Событий всего', '=COUNTA(' + L + 'A2:A)']
  ];
  sh.getRange('A4').setValue('Главное').setFontWeight('bold');
  for (var i = 0; i < kpi.length; i++) {
    sh.getRange(5 + i, 1).setValue(kpi[i][0]);
    sh.getRange(5 + i, 2).setFormula(kpi[i][1]).setFontWeight('bold');
  }

  // По дням (последние 30 дней с активностью)
  sh.getRange('D4:G4').setValues([['День', 'Посетители', 'Визиты', 'Открыто разделов']]).setFontWeight('bold');
  sh.getRange('D5').setFormula('=IFERROR(ARRAY_CONSTRAIN(SORT(UNIQUE(FILTER(' + L + 'B2:B,' + L + 'B2:B<>"")),1,FALSE),30,1),"")');
  sh.getRange('E5').setFormula('=BYROW(D5:D34,LAMBDA(d,IF(d="","",COUNTUNIQUEIFS(' + L + 'C2:C,' + L + 'B2:B,d))))');
  sh.getRange('F5').setFormula('=BYROW(D5:D34,LAMBDA(d,IF(d="","",COUNTUNIQUEIFS(' + L + 'D2:D,' + L + 'B2:B,d))))');
  sh.getRange('G5').setFormula('=BYROW(D5:D34,LAMBDA(d,IF(d="","",COUNTIFS(' + L + 'B2:B,d,' + L + 'F2:F,"view"))))');
  sh.getRange('D5:D34').setNumberFormat('dd.MM ddd');

  // Разделы, люди, источники, профили, воронка регистраций — за 30 дней
  sh.getRange('I4').setValue('Разделы · 30 дней').setFontWeight('bold');
  sh.getRange('I5').setFormula(q("select G, count(A) where (F='view' or F='tab') and A >= " + since30 + " group by G order by count(A) desc label G 'Раздел', count(A) 'Открытий'"));

  sh.getRange('L4').setValue('Кто заходит · 30 дней').setFontWeight('bold');
  sh.getRange('L5').setFormula(q("select E, count(D), max(A) where E <> '' and A >= " + since30 + " group by E order by max(A) desc label E 'Кто', count(D) 'Событий', max(A) 'Последний раз'"));
  sh.getRange('N5:N').setNumberFormat('dd.MM HH:mm');

  sh.getRange('P4').setValue('Откуда приходят · 30 дней').setFontWeight('bold');
  sh.getRange('P5').setFormula(q("select I, count(A) where F='open' and A >= " + since30 + " group by I order by count(A) desc label I 'Источник', count(A) 'Визитов'"));

  sh.getRange('S4').setValue('Чьи профили смотрят · 30 дней').setFontWeight('bold');
  sh.getRange('S5').setFormula(q("select H, count(A) where F='profile' and A >= " + since30 + " group by H order by count(A) desc limit 20 label H 'Пилот', count(A) 'Просмотров'"));

  sh.getRange('V4').setValue('Регистрации: открыли форму → записались · 30 дней').setFontWeight('bold');
  sh.getRange('V5').setFormula(q("select G, count(A) where (F='reg_open' or F='reg_ok' or F='reg_fail') and A >= " + since30 + " group by G pivot F label G 'Ивент'"));

  sh.getRange('A14').setValue('Устройства · 30 дней').setFontWeight('bold');
  sh.getRange('A15').setFormula(q("select J, count(A) where F='open' and A >= " + since30 + " group by J order by count(A) desc label J 'Устройство', count(A) 'Визитов'"));

  sh.getRange('A25').setValue('Клики по внешним ссылкам · 30 дней').setFontWeight('bold');
  sh.getRange('A26').setFormula(q("select G, count(A) where F='out' and A >= " + since30 + " group by G order by count(A) desc limit 15 label G 'Ссылка', count(A) 'Кликов'"));

  sh.setFrozenRows(4);
  var widths = { 1: 230, 2: 80, 4: 90, 5: 90, 6: 70, 7: 110, 9: 120, 10: 80, 12: 160, 13: 70, 14: 110, 16: 150, 17: 70, 19: 160, 20: 90, 22: 140, 23: 80, 24: 80, 25: 80 };
  for (var c in widths) sh.setColumnWidth(Number(c), widths[c]);
  [3, 8, 11, 15, 18, 21].forEach(function (c) { sh.setColumnWidth(c, 20); });
}

// ───────────────────────── Мелочи ─────────────────────────

function clean(s, max) {
  return String(s == null ? '' : s).split('<').join('').split('>').join('')
    .split(' ').filter(function (x) { return x; }).join(' ').trim().slice(0, max);
}

function cleanHandle(s) {
  var h = clean(s, 40).split(' ').join('');
  if (!h) return '';
  h = h.replace(/^@+/, '');
  return h ? '@' + h : '';
}

function normHandle(h) { return String(h || '').replace(/^@+/, '').toLowerCase().trim(); }
function normName(n) { return String(n || '').toLowerCase().split(' ').filter(function (x) { return x; }).join(' '); }

function toBool(v) { return v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1'; }

// «Сессия» может прийти из таблицы как Date (Sheets сам превращает 12:00 во время) — нормализуем в HH:mm
function cellTime(v) {
  if (v instanceof Date) return ('0' + v.getHours()).slice(-2) + ':' + ('0' + v.getMinutes()).slice(-2);
  return String(v || '').trim();
}

// «Карт» в таблице хранится подписью (Rotax Max) — обратно в код (max)
function kartCode(label) {
  var s = String(label || '').trim().toLowerCase();
  for (var id in EVENTS) {
    var cl = EVENTS[id].classes;
    if (!cl) continue;
    for (var k in cl) if (cl[k].label.toLowerCase() === s || k === s) return k;
  }
  return s === 'на месте' ? '' : s;
}

function modeCode(label) {
  var s = String(label || '').trim().toLowerCase();
  for (var k in MODE_LABEL) if (MODE_LABEL[k].toLowerCase() === s || k === s) return k;
  return '';
}

// Защита от формул в ячейках: строка, начинающаяся с = + -, пишется как текст
function safeCellValue(v) {
  if (typeof v === 'string' && /^[=+-]/.test(v)) return "'" + v;
  return v;
}

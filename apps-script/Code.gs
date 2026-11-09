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
 *  GET  ?action=subscribe&callback=cb&name=&handle=&telegram_id=&lang=&src=
 *       → cb({ ok: true, dm: бот смог написать, isNew }) — подписка на анонс следующей гонки
 *
 * ПОДПИСЧИКИ НА АНОНСЫ
 *  Таблица «racechat.pt — подписчики» создаётся сама при первой подписке, ссылка приходит в оргчат.
 *  Разослать анонс: вписать текст в ANNOUNCE_TEXT ниже → выполнить announceTest (придёт только в оргчат)
 *  → если всё ок, выполнить announceSend. Бот пишет тем, у кого «Бот может писать» = да;
 *  остальным (оставили только @ник) — писать руками, они в той же таблице.
 *  importPastRegs — один раз добавить в таблицу всех, кто регистрировался на прошлые гонки через Telegram.
 */

// ⬇ Текст рассылки подписчикам (announceTest / announceSend). После рассылки можно стереть.
var ANNOUNCE_TEXT = '';

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
    out = p.action === 'register' ? register(p)
      : p.action === 'subscribe' ? subscribe(p)
      : { regs: listRegs(p.event) };
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

// То же, но с ответом: true — сообщение доставлено (человек запускал бота / разрешил писать)
function sendTelegramOk(chatId, text) {
  try {
    var r = UrlFetchApp.fetch('https://api.telegram.org/bot' + secret('BOT_TOKEN') + '/sendMessage', {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ chat_id: chatId, text: text }),
      muteHttpExceptions: true
    });
    return JSON.parse(r.getContentText()).ok === true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

// ───────────────────────── Подписка на анонсы ─────────────────────────

var SUBS_COLS = ['Дата', 'Имя', 'Telegram', 'Telegram ID', 'Бот может писать', 'Язык', 'Источник', 'Последняя рассылка'];
var SUBS_DM = {
  ru: '🔔 Готово, ты в списке. Напишу сюда, как только откроется регистрация на следующую гонку.\n\nКатаемся Чатом · racechat.pt',
  pt: '🔔 Feito, estás na lista. Escrevo-te aqui assim que abrirem as inscrições para a próxima corrida.\n\nКатаемся Чатом · racechat.pt',
  en: '🔔 Done, you are on the list. I will message you here as soon as registration for the next race opens.\n\nКатаемся Чатом · racechat.pt'
};

// Таблица подписчиков: создаётся сама, id хранится в «Свойствах скрипта» (SUBS_SHEET_ID)
function subsSheet() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SUBS_SHEET_ID');
  var ss;
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create('racechat.pt — подписчики');
    props.setProperty('SUBS_SHEET_ID', ss.getId());
    var sh0 = ss.getSheets()[0];
    sh0.setName('Подписчики');
    sh0.getRange(1, 1, 1, SUBS_COLS.length).setValues([SUBS_COLS])
      .setFontWeight('bold').setBackground('#1a1a1a').setFontColor('#ffffff');
    sh0.setFrozenRows(1);
    sh0.getRange('A2:A').setNumberFormat('dd.MM HH:mm');
    sh0.getRange('H2:H').setNumberFormat('dd.MM HH:mm');
    var w = [110, 180, 150, 120, 130, 60, 130, 150];
    for (var i = 0; i < w.length; i++) sh0.setColumnWidth(i + 1, w[i]);
    if (secret('BOT_TOKEN')) sendTelegram(CORE_CHAT, '🔔 Создана таблица подписчиков на анонсы:\n' + ss.getUrl());
  }
  return ss.getSheets()[0];
}

// Строки таблицы подписчиков: [{ _row, name, handle, tgid, can }]
function subsRows(sh) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  var v = sh.getRange(2, 1, last - 1, SUBS_COLS.length).getValues();
  var out = [];
  for (var i = 0; i < v.length; i++) {
    var handle = String(v[i][2] || '').trim(), tgid = String(v[i][3] || '').trim();
    if (!handle && !tgid) continue;
    out.push({ _row: i + 2, name: String(v[i][1] || '').trim(), handle: handle, tgid: tgid, can: String(v[i][4] || '').trim().toLowerCase() === 'да' });
  }
  return out;
}

function findSub(rows, tgid, handle) {
  for (var i = 0; i < rows.length; i++) {
    if (tgid && rows[i].tgid === tgid) return rows[i];
    if (handle && rows[i].handle && normHandle(rows[i].handle) === normHandle(handle)) return rows[i];
  }
  return null;
}

function subscribe(p) {
  var name = clean(p.name, 60);
  var handle = cleanHandle(p.handle);
  var tgid = clean(p.telegram_id, 20);
  if (!/^[0-9]+$/.test(tgid)) tgid = '';
  var lang = SUBS_DM[p.lang] ? p.lang : 'ru';
  var src = clean(p.src, 40);
  if (!tgid && !handle) return { ok: false, reason: 'invalid' };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, reason: 'busy' };
  try {
    var sh = subsSheet();
    var rows = subsRows(sh);
    var cur = findSub(rows, tgid, handle);
    // Подтверждение в личку — новому подписчику и тому, кому раньше написать не получалось
    var can = cur ? cur.can : false;
    if (tgid && !can && secret('BOT_TOKEN')) can = sendTelegramOk(tgid, SUBS_DM[lang]);

    if (cur) {
      if (name && !cur.name) sh.getRange(cur._row, 2).setValue(safeCellValue(name));
      if (handle && !cur.handle) sh.getRange(cur._row, 3).setValue(safeCellValue(handle));
      if (tgid && !cur.tgid) sh.getRange(cur._row, 4).setValue(tgid);
      sh.getRange(cur._row, 5).setValue(can ? 'да' : 'нет');
    } else {
      sh.getRange(sh.getLastRow() + 1, 1, 1, SUBS_COLS.length).setValues([[
        new Date(), safeCellValue(name), safeCellValue(handle), tgid, can ? 'да' : 'нет', lang, safeCellValue(src), ''
      ]]);
      if (secret('BOT_TOKEN')) {
        sendTelegram(CORE_CHAT, '🔔 Подписка на анонс гонки\n' + (name || handle) + (name && handle ? ' (' + handle + ')' : '') +
          (can ? '' : ' · бот написать не может') + '\nВсего в списке: ' + (rows.length + 1));
      }
    }
    return { ok: true, dm: can, isNew: !cur };
  } finally {
    lock.releaseLock();
  }
}

// Один раз: добавить в подписчики всех, кто регистрировался на прошлые гонки с Telegram ID.
// Никому ничего не отправляет; «Бот может писать» = да (при регистрации бот им уже писал),
// при рассылке недоставленные сами станут «нет».
function importPastRegs() {
  var sh = subsSheet();
  var rows = subsRows(sh);
  var added = 0;
  Object.keys(EVENTS).forEach(function (id) {
    var regs;
    try { regs = readRows(sheetOf(EVENTS[id])); } catch (err) { console.error(err); return; }
    regs.forEach(function (r) {
      var tgid = /^[0-9]+$/.test(r.tgid) ? r.tgid : '';
      if (!tgid || findSub(rows, tgid, r.handle)) return;
      var line = [new Date(), safeCellValue(r.name), safeCellValue(r.handle), tgid, 'да', 'ru', 'reg:' + id, ''];
      sh.getRange(sh.getLastRow() + 1, 1, 1, SUBS_COLS.length).setValues([line]);
      rows.push({ _row: sh.getLastRow(), name: r.name, handle: r.handle, tgid: tgid, can: true });
      added++;
    });
  });
  console.log('Добавлено из прошлых регистраций: ' + added);
}

// Проверка текста: придёт только в оргчат
function announceTest() {
  if (!ANNOUNCE_TEXT) throw new Error('ANNOUNCE_TEXT пустой');
  sendTelegram(CORE_CHAT, '— ТЕСТ РАССЫЛКИ, так увидят подписчики —\n\n' + ANNOUNCE_TEXT);
}

// Рассылка всем, кому бот может писать. Кому не дошло — помечаются «нет»; итог приходит в оргчат.
function announceSend() {
  if (!ANNOUNCE_TEXT) throw new Error('ANNOUNCE_TEXT пустой');
  var sh = subsSheet();
  var rows = subsRows(sh);
  var sent = 0, failed = 0, manual = [];
  var now = new Date();
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r.tgid || !r.can) { manual.push(r.handle || r.name); continue; }
    if (sendTelegramOk(r.tgid, ANNOUNCE_TEXT)) {
      sent++;
      sh.getRange(r._row, 8).setValue(now);
    } else {
      failed++;
      sh.getRange(r._row, 5).setValue('нет');
      manual.push(r.handle || r.name);
    }
    Utilities.sleep(60);   // лимит Telegram — около 30 сообщений в секунду
  }
  sendTelegram(CORE_CHAT, '📣 Рассылка анонса: доставлено ' + sent + ', не дошло ' + failed +
    (manual.length ? '\nНаписать руками (' + manual.length + '): ' + manual.join(', ').slice(0, 3000) : ''));
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

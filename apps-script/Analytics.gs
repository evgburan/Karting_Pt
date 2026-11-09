/**
 * racechat.pt — АНАЛИТИКА. Отдельный проект Apps Script, к регистрациям отношения не имеет.
 *
 * УСТАНОВКА (один раз, ~3 минуты, лучше с компьютера):
 *  1. script.google.com → «Новый проект».
 *  2. Стереть всё в редакторе, вставить ЭТОТ файл целиком, нажать 💾.
 *  3. «Развернуть» (синяя кнопка справа вверху) → «Новое развёртывание» →
 *     ⚙️ «Выберите тип» → «Веб-приложение».
 *     Запуск от имени: «Я». У кого есть доступ: «Все». → «Развернуть».
 *     Google попросит доступ → выбрать свой аккаунт → «Дополнительно» → «Перейти…» → «Разрешить».
 *  4. Скопировать «URL веб-приложения» (…/exec) и прислать Claude — он вставит его в сайт.
 *  5. Открыть этот URL в браузере — появится ссылка на таблицу «racechat.pt — аналитика».
 *
 * Лист «Сводка» — всё главное (посетители, разделы, кто заходит, откуда). Лист «Лог» — сырые события.
 * Код на чистом ES5 (var, без стрелок) — работает и на Rhino, и на V8.
 */

function doGet() {
  var url = SpreadsheetApp.openById(sheetId()).getUrl();
  return HtmlService.createHtmlOutput(
    '<div style="font:16px sans-serif;padding:24px">✅ Аналитика работает.<br><br>' +
    '<a href="' + url + '" target="_blank">Открыть таблицу «racechat.pt — аналитика»</a></div>');
}

function doPost(e) {
  try {
    var d = JSON.parse(e.postData.contents);
    if (d.action === 'track') return respond(track(d));
  } catch (err) {
    console.error(err);
  }
  return respond({ ok: false });
}

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

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
  return SpreadsheetApp.openById(sheetId()).getSheetByName(LOG_SHEET);
}

// Таблица создаётся сама при первом обращении
function sheetId() {
  var id = PropertiesService.getScriptProperties().getProperty('ANALYTICS_SHEET_ID');
  if (id) return id;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return PropertiesService.getScriptProperties().getProperty('ANALYTICS_SHEET_ID') || setupAnalytics();
  } finally { lock.releaseLock(); }
}

// Можно запустить из редактора вручную — пересоберёт «Сводку», лог не трогает.
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

// Защита от формул в ячейках: строка, начинающаяся с = + -, пишется как текст
function safeCellValue(v) {
  if (typeof v === 'string' && /^[=+-]/.test(v)) return "'" + v;
  return v;
}

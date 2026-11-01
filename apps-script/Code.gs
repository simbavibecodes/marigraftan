/**
 * Mari & Graftan wedding site: connects the website to this Google Sheet.
 *  - The website reads the guest list from the first tab, so edits here reach the site within a minute.
 *  - Every RSVP is saved on the "Replies" tab (one row per invitation; changes update the same row).
 *  - Names that aren't found are logged on the "Not found" tab.
 *  - Each of these also sends an email to NOTIFY_EMAIL.
 */
const NOTIFY_EMAIL = 'mgdarnall11@gmail.com';

function doGet(e) {
  if ((e.parameter.action || '') !== 'guests') return out({ ok: false });
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  return out({ ok: true, rows: sheet.getDataRange().getDisplayValues() });
}

function doPost(e) {
  const d = JSON.parse(e.postData.contents || '{}');
  if (d.type === 'rsvp') saveReply(d);
  else if (d.type === 'notfound') saveNotFound(d);
  return out({ ok: true });
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Text that starts with = + - @ would be read as a formula, so it is stored as plain text.
function safe(v) {
  const s = String(v == null ? '' : v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function tab(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  return sh;
}

const REPLY_HEADERS = ['Invitation', 'Coming', 'Who', 'Arriving', 'Leaving', 'Plus-one', 'Plus-one name',
  'Dietary restrictions', 'Dietary details', 'Note', 'Language', 'First replied', 'Last updated', 'Times updated'];

function saveReply(d) {
  const r = d.reply || {};
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = tab('Replies', REPLY_HEADERS);
    const now = new Date();
    const vals = [d.party, r.attending === 'yes' ? 'Yes' : 'No', r.who, r.arrival, r.departure, r.plusOne,
      r.plusOneName, r.dietary, r.dietaryDetails, r.note, r.lang === 'ka' ? 'Georgian' : 'English'].map(safe);
    const last = sh.getLastRow();
    const names = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues().map(function (x) { return x[0]; }) : [];
    const i = names.indexOf(d.party);
    if (i >= 0) {
      const row = i + 2, prev = sh.getRange(row, 12, 1, 3).getValues()[0];
      sh.getRange(row, 1, 1, 14).setValues([vals.concat([prev[0], now, (Number(prev[2]) || 0) + 1])]);
    } else {
      sh.appendRow(vals.concat([now, now, 0]));
    }
  } finally {
    lock.releaseLock();
  }
  const coming = r.attending === 'yes' ? (r.who || 'Coming') : 'Not coming';
  const subject = (d.status === 'updated' ? 'Updated RSVP: ' : 'RSVP: ') + d.party + ' (' + coming + ')';
  const body = [
    'Invitation: ' + d.party,
    'Coming: ' + (r.attending === 'yes' ? 'Yes' : 'No') + (r.who ? ' (' + r.who + ')' : ''),
    r.attending === 'yes' ? 'Dates: ' + (r.arrival || '?') + ' to ' + (r.departure || '?') : '',
    r.plusOne ? 'Plus-one: ' + r.plusOne + (r.plusOneName ? ' (' + r.plusOneName + ')' : '') : '',
    r.dietary ? 'Dietary restrictions: ' + r.dietary + (r.dietaryDetails ? ' (' + r.dietaryDetails + ')' : '') : '',
    r.note ? 'Note: ' + r.note : '',
    '',
    'All replies: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl()
  ].filter(function (x, k) { return x !== '' || k === 6; }).join('\n');
  MailApp.sendEmail(NOTIFY_EMAIL, subject, body);
}

function saveNotFound(d) {
  const sh = tab('Not found', ['When', 'Typed', 'Email or phone', 'Closest name on the list', 'Match', 'Language', 'What happened']);
  sh.appendRow([new Date(), safe(d.typed), safe(d.contact), safe(d.closest), d.score || '',
    d.lang === 'ka' ? 'Georgian' : 'English', safe(d.kind)]);
  const subject = d.contact ? 'Guest left contact details: ' + d.typed : 'Name not found: ' + d.typed;
  const body = [
    'Typed: ' + d.typed,
    d.contact ? 'Email or phone: ' + d.contact : '',
    d.closest ? 'Closest name on the list: ' + d.closest + ' (' + Math.round((Number(d.score) || 0) * 100) + '% match)' : '',
    '',
    'If this is a guest, add this spelling to their row under "Other spellings / nicknames".',
    'Sheet: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl()
  ].filter(function (x, k) { return x !== '' || k === 3; }).join('\n');
  MailApp.sendEmail(NOTIFY_EMAIL, subject, body);
}

// Run this once from the editor (select "authorize" above and press Run) to grant access before deploying.
function authorize() {
  SpreadsheetApp.getActiveSpreadsheet().getSheets();
  MailApp.getRemainingDailyQuota();
}

/* ============================================================
   勤怠管理 — 日時と表示の共通処理

   日付はすべて日本標準時（UTC+9）で扱う。端末のタイムゾーン設定が
   狂っていても勤務日がずれないよう、+9時間を明示的に足して判定する。
   ============================================================ */

var KT_JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/* UTC のゲッターで日本時間が読める Date を返す */
function ktJst(v) {
  var d = (v instanceof Date) ? v : new Date(v);
  return new Date(d.getTime() + KT_JST_OFFSET_MS);
}

function ktPad(n) { return (n < 10 ? '0' : '') + n; }

/* 'YYYY-MM-DD'（日本時間） */
function ktYmd(v) {
  var j = ktJst(v);
  return j.getUTCFullYear() + '-' + ktPad(j.getUTCMonth() + 1) + '-' + ktPad(j.getUTCDate());
}

/* 'HH:MM'（日本時間） */
function ktHm(v) {
  var j = ktJst(v);
  return ktPad(j.getUTCHours()) + ':' + ktPad(j.getUTCMinutes());
}

/* 日本時間の 0:00 からの経過分 */
function ktMinOfDay(v) {
  var j = ktJst(v);
  return j.getUTCHours() * 60 + j.getUTCMinutes();
}

/* 'YYYY-MM-DD' → その日の日本時間 0:00 を指す Date */
function ktParseYmd(s) {
  var p = String(s || '').split('-');
  if (p.length < 3) return null;
  return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]) - KT_JST_OFFSET_MS);
}

function ktYmdAddDays(s, n) {
  var d = ktParseYmd(s);
  if (!d) return s;
  return ktYmd(new Date(d.getTime() + n * 86400000));
}

/* 月末を超える場合は月末に丸める（1/31 の1か月後 = 2/28） */
function ktYmdAddMonths(s, n) {
  var p = String(s || '').split('-');
  if (p.length < 3) return s;
  var y = +p[0], m = +p[1] - 1 + n, day = +p[2];
  var y2 = y + Math.floor(m / 12);
  var m2 = ((m % 12) + 12) % 12;
  var last = new Date(Date.UTC(y2, m2 + 1, 0)).getUTCDate();
  return y2 + '-' + ktPad(m2 + 1) + '-' + ktPad(Math.min(day, last));
}

function ktYmdAddYears(s, n) { return ktYmdAddMonths(s, n * 12); }

/* 差の日数（a - b） */
function ktYmdDiffDays(a, b) {
  var da = ktParseYmd(a), db = ktParseYmd(b);
  if (!da || !db) return 0;
  return Math.round((da.getTime() - db.getTime()) / 86400000);
}

function ktYmdWeekday(s) {
  var d = ktParseYmd(s);
  return d ? ktJst(d).getUTCDay() : 0;
}

function ktYmdDay(s) { return +String(s || '').split('-')[2] || 0; }

function ktToday() { return ktYmd(new Date()); }

var KT_WD = ['日', '月', '火', '水', '木', '金', '土'];

function ktYmdLabel(s) {
  var p = String(s || '').split('-');
  if (p.length < 3) return s || '';
  return (+p[1]) + '/' + (+p[2]) + '（' + KT_WD[ktYmdWeekday(s)] + '）';
}

function ktYmdLabelFull(s) {
  var p = String(s || '').split('-');
  if (p.length < 3) return s || '';
  return p[0] + '年' + (+p[1]) + '月' + (+p[2]) + '日（' + KT_WD[ktYmdWeekday(s)] + '）';
}

/* 分 → 'H:MM' */
function ktMinToHm(min) {
  var m = Math.max(0, Math.round(min || 0));
  return Math.floor(m / 60) + ':' + ktPad(m % 60);
}

/* その月の 'YYYY-MM' */
function ktYm(s) { return String(s || '').slice(0, 7); }

function ktMonthRange(ym) {
  var p = String(ym).split('-');
  var y = +p[0], m = +p[1];
  var last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: ym + '-01', to: ym + '-' + ktPad(last), days: last };
}

/* 日曜始まりの週の初日 */
function ktWeekStart(s) { return ktYmdAddDays(s, -ktYmdWeekday(s)); }

function ktEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* 'YYYY-MM-DDTHH:MM'（日本時間）→ ISO文字列（UTC）
   手入力した時刻を、サーバ時刻と同じ土俵で扱えるようにする。 */
function ktJstToIso(s) {
  var m = String(s || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - KT_JST_OFFSET_MS).toISOString();
}

/* 'YYYY-MM-DD' と 'HH:MM' から手入力用の文字列をつくる */
function ktMakeManual(ymd, hm) {
  var m = String(hm || '').match(/^(\d{1,2})[:：](\d{1,2})$/);
  if (!m || !ymd) return null;
  return ymd + 'T' + ktPad(+m[1]) + ':' + ktPad(+m[2]);
}

/* 'H:MM' や '8時30分' などを 'HH:MM' に正規化する。無効なら null */
function ktNormalizeHm(s) {
  s = String(s == null ? '' : s).trim()
       .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
       .replace(/[時：]/g, ':').replace(/分$/, '');
  var m = s.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) {
    // 「830」「0830」のような入力も受け付ける
    var d = s.match(/^(\d{3,4})$/);
    if (!d) return null;
    var v = d[1].padStart(4, '0');
    m = [null, v.slice(0, 2), v.slice(2)];
  }
  var h = +m[1], mi = +m[2];
  if (h > 47 || mi > 59) return null;
  return ktPad(h) + ':' + ktPad(mi);
}

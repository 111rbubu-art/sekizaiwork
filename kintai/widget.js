/* ============================================================
   打刻ウィジェット — 既存アプリ（index_b.html など）に埋め込む用

   使い方は kintai/WIDGET.md を参照。要点だけ再掲：

     <script src="./kintai/config.js"></script>
     <script src="./kintai/util.js"></script>
     <script src="./kintai/geo.js"></script>
     <script src="./kintai/graph.js"></script>
     <script src="./kintai/widget.js"></script>
     ...
     <div id="kintai-widget"></div>
     <script>
       ktWidgetInit({ el: '#kintai-widget', getToken: getToken });
     </script>

   ★ MSAL は既存アプリのものをそのまま使う。ここでは初期化しない。
     getToken に既存アプリの getToken をそのまま渡すこと。

   ★ 見た目は .ktw- で始まるクラスだけで組み立て、既存アプリの CSS と
     ぶつからないようにしている。
   ============================================================ */

var KTW = {
  root: null, emp: null, sites: [], punches: [],
  pending: 0,                                    // 取消を申請中の打刻の件数
  ready: false, busy: false, msg: null,
  workDate: '',                                  // いま表示している勤務日
  lastLoad: 0,                                   // 最後に一覧を取り直した時刻
  loading: false, watching: false
};

/* ── 起動 ────────────────────────────────────────────────── */

function ktWidgetInit(opt) {
  opt = opt || {};
  var el = typeof opt.el === 'string' ? document.querySelector(opt.el) : opt.el;
  if (!el) { return; }
  KTW.root = el;

  // 既存アプリのトークンを使う（MSAL を二重に初期化しない）
  if (typeof opt.getToken === 'function') KT_TOKEN_PROVIDER = opt.getToken;

  ktwStyle();
  ktwRender('<div class="ktw-line">読み込んでいます…</div>');
  ktwLoad();
}

function ktwLoad() {
  var me = ktwUserName();
  return ktwFlush().then(function () {
  return Promise.all([
    ktList('employees'),
    ktList('sites').catch(function () { return []; })
  ]).then(function (r) {
    KTW.sites = r[1];
    KTW.emp = r[0].filter(function (e) {
      return String(e.UserPrincipalName || '').toLowerCase() === me;
    })[0] || null;

    if (!KTW.emp) {
      ktwRender('<div class="ktw-line ktw-warn">勤怠の社員マスタに ' +
        ktEsc(me || 'このアカウント') + ' の登録がありません。</div>');
      return;
    }
    return ktwLoadPunches();
  }).then(function () {
    if (!KTW.emp) return;
    KTW.ready = true;
    ktwDraw();
    ktwWatch();
  }).catch(function (e) {
    ktwRender('<div class="ktw-line ktw-warn">勤怠の読み込みに失敗しました：' +
      ktEsc(e.message) + '</div>');
  });
  });
}

/* 保留していた打刻を送る。順番を崩さないよう1件ずつ送り、
   失敗したらそこで止めて残りは次の機会に回す。 */
function ktwFlush() {
  var q = ktwQueue();
  if (!q.length) return Promise.resolve(0);
  var sent = 0;
  return q.reduce(function (chain, f) {
    return chain.then(function () {
      return ktCreate('punches', f).then(function () { sent++; })
        .catch(function () { throw new Error('stop'); });
    });
  }, Promise.resolve()).catch(function () {}).then(function () {
    localStorage.setItem('kt_queue_v1', JSON.stringify(q.slice(sent)));
    return sent;
  });
}

/* ログイン中のアカウント。既存アプリの msalApp があればそこから取る。 */
function ktwUserName() {
  try {
    if (typeof msalApp !== 'undefined' && msalApp.getActiveAccount) {
      var a = msalApp.getActiveAccount();
      if (a && a.username) return String(a.username).toLowerCase();
    }
  } catch (e) {}
  if (typeof ktUserName === 'function') return ktUserName();
  return '';
}

/* 打刻の取消申請。決まりごとは app.js と同じ。
   ウィジェット単体で動く必要があるので、ここにも同じ形で置いている。 */
var KTW_CANCEL_STATUS = '打刻取消申請';
var KTW_CANCEL_MARK   = '取消対象#';

function ktwCancelTargetId(c) {
  var m = new RegExp(KTW_CANCEL_MARK + '([^／\\s]+)').exec(String((c || {}).AdminNote || ''));
  return m ? m[1] : '';
}

function ktwLoadPunches() {
  var wd = ktwWorkDate();
  return ktList('punches', "fields/WorkDate eq '" + wd + "'").then(function (rows) {
    var mine = rows.filter(function (p) {
      return p.Title === KTW.emp.Title && p.WorkDate === wd;
    });

    // 未処理の取消申請がある打刻は、勤怠アプリと同じく無かったものとして扱う。
    // ただし対象の打刻が既に取り消されているなら、申請の行に処理済みの印が
    // 付いていなくても済んだものとみなす。管理者が SharePoint で直接取り消した
    // 場合など、印が付かないことがあり、いつまでも「申請中」と出てしまうため。
    var alive = {};
    mine.forEach(function (p) {
      if (p.Voided !== true && p.LocationStatus !== KTW_CANCEL_STATUS) alive[p._id] = true;
    });
    var pending = {};
    mine.forEach(function (p) {
      if (p.LocationStatus !== KTW_CANCEL_STATUS || p.Reviewed === true) return;
      var id = ktwCancelTargetId(p);
      if (id && alive[id]) pending[id] = true;
    });
    KTW.pending = Object.keys(pending).length;

    KTW.punches = mine.filter(function (p) {
      return p.Voided !== true && !pending[p._id] &&
             ['出勤', '退勤', '休憩開始', '休憩終了'].indexOf(p.PunchType) >= 0;
    }).sort(function (a, b) { return new Date(a._time) - new Date(b._time); });
    KTW.workDate = wd;
    KTW.lastLoad = Date.now();
  });
}

/* 送信できた打刻を手元の一覧にも入れる。
   SharePoint の一覧に出てくるまで少し遅れることがあり、
   取り直した結果だけを信じると、押した直後の表示が前のままになる。 */
function ktwAdd(p) {
  if (!p || !p._id) return;
  var dup = KTW.punches.filter(function (x) { return x._id === p._id; }).length;
  if (dup) return;
  KTW.punches = KTW.punches.concat([p]).sort(function (a, b) {
    return new Date(a._time) - new Date(b._time);
  });
}

/* 画面に戻ったとき・勤務日が変わったときに、開き直さなくても最新の状態にする。
   退勤したまま画面を開きっぱなしで翌朝出社しても、［出勤］が押せる状態になる。 */
var KTW_REFRESH_MIN_MS = 30000;   // 続けて開き直したときに取りに行きすぎないための間隔

function ktwWatch() {
  if (KTW.watching) return;
  KTW.watching = true;

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') ktwRefresh(false);
  });
  window.addEventListener('focus',  function () { ktwRefresh(false); });
  window.addEventListener('online', function () { ktwRefresh(true); });

  // 画面を開いたままでも日付の変わり目に気づけるよう、1分ごとに勤務日だけ見る
  setInterval(function () {
    if (ktwWorkDate() !== KTW.workDate) ktwRefresh(true);
  }, 60000);
}

function ktwRefresh(force) {
  if (!KTW.ready || KTW.busy || KTW.loading) return;
  var dayChanged = ktwWorkDate() !== KTW.workDate;
  if (!force && !dayChanged && (Date.now() - KTW.lastLoad) < KTW_REFRESH_MIN_MS) return;

  if (dayChanged) {
    // 日付が変わったら前の日の打刻は出さない（すぐ［出勤］が押せる状態にする）
    KTW.punches = []; KTW.pending = 0; KTW.msg = null;
    KTW.workDate = ktwWorkDate();
    ktwDraw();
  }
  KTW.loading = true;
  ktwFlush().then(function () { return ktwLoadPunches(); })
    .catch(function () {})
    .then(function () { KTW.loading = false; ktwDraw(); });
}

/* 直前の打刻の取消を申請する。対象は書き換えず、申請の行を1件足すだけ。 */
function ktwRequestVoid(punchId) {
  var p = KTW.punches.filter(function (x) { return x._id === punchId; })[0];
  if (!p || KTW.busy) return;

  var why = window.prompt(
    ktHm(p._time) + ' の「' + p.PunchType + '」を取り消すよう申請します。\n理由を書いてください。',
    '誤って押した');
  if (why === null) return;

  KTW.busy = true;
  KTW.msg = { text: '申請しています…' };
  ktwDraw();

  ktCreate('punches', {
    Title:          KTW.emp.Title,
    PunchType:      p.PunchType,
    WorkDate:       p.WorkDate,
    ManualTime:     ktYmd(p._time) + 'T' + ktHm(p._time),
    ClientTime:     new Date().toISOString(),
    LocationStatus: KTW_CANCEL_STATUS,
    Voided:         true,
    VoidReason:     '取消の申請',
    AdminNote:      KTW_CANCEL_MARK + p._id + '／' + (String(why).trim() || '誤って押した'),
    UserAgent:      (navigator.userAgent || '').slice(0, 250)
  }).then(function () {
    KTW.msg = { text: '取消を申請しました。管理者の確認をお待ちください' };
    return ktwLoadPunches();
  }).catch(function (e) {
    KTW.msg = { text: '申請に失敗しました：' + e.message, err: true };
  }).then(function () {
    KTW.busy = false; ktwDraw();
  });
}

/* 勤務日（深夜勤務は前日扱い）。app.js と同じ考え方だが、
   ウィジェット単体で動くようここにも置く。 */
function ktwWorkDate() {
  var now = new Date();
  var h = ktJst(now).getUTCHours();
  return h < KT_PUNCH.dayStartHour ? ktYmdAddDays(ktYmd(now), -1) : ktYmd(now);
}

function ktwState() {
  if (!KTW.punches.length) return 'off';
  var last = KTW.punches[KTW.punches.length - 1].PunchType;
  if (last === '出勤' || last === '休憩終了') return 'in';
  if (last === '休憩開始') return 'break';
  if (last === '退勤') return 'done';
  return 'off';
}

/* ── 描画 ────────────────────────────────────────────────── */

function ktwRender(html) { if (KTW.root) KTW.root.innerHTML = '<div class="ktw">' + html + '</div>'; }

function ktwDraw() {
  var st = ktwState();
  var last = KTW.punches[KTW.punches.length - 1];
  var label = { off: '未出勤', in: '勤務中', break: '休憩中', done: '退勤済み' }[st];

  var h = '';
  h += '<div class="ktw-head">';
  h += '<span class="ktw-name">' + ktEsc(KTW.emp.EmpName || KTW.emp.Title) + '</span>';
  h += '<span class="ktw-state">' + label + '</span>';
  if (last) {
    h += '<span class="ktw-time">' + ktHm(last._time) + '</span>';
    if (last.SiteName) {
      h += '<span class="ktw-site' + (last.SiteName === '事業所外' || last.SiteName === '位置なし'
            ? ' ktw-warn' : '') + '">' + ktEsc(last.SiteName) + '</span>';
    }
  }
  h += '</div>';

  h += '<div class="ktw-btns">';
  if (st === 'done' && KT_PUNCH.lockAfterOut) {
    // 退勤の直後に出勤を押してしまう事故を防ぐ。日付が変われば押せるようになる
    h += '<button type="button" class="ktw-main" disabled>出勤</button>';
  } else if (st === 'off' || st === 'done') {
    h += '<button type="button" class="ktw-main" data-ktw="出勤"' +
         (KTW.busy ? ' disabled' : '') + '>出勤</button>';
  } else if (st === 'break') {
    // 勤怠アプリ側で休憩を打った場合にそなえ、終了だけは押せるようにしておく
    h += '<button type="button" class="ktw-main" data-ktw="休憩終了"' +
         (KTW.busy ? ' disabled' : '') + '>休憩終了</button>';
  } else {
    h += '<button type="button" class="ktw-main ktw-out" data-ktw="退勤"' +
         (KTW.busy ? ' disabled' : '') + '>退勤</button>';
  }
  h += '</div>';

  if (KTW.punches.length) {
    // 1件ずつを塊にして、「退／勤」のように途中で折り返さないようにする
    h += '<div class="ktw-log">' + KTW.punches.map(function (p) {
      return '<span class="ktw-logi">' + ktEsc(p.PunchType) + ' ' + ktHm(p._time) + '</span>';
    }).join('<span class="ktw-logs">／</span>');
    // 押し間違いはすぐ気づくので、直前の打刻にだけ取消を出す
    if (last && (Date.now() - new Date(last._time)) < KT_PUNCH.undoMin * 60000) {
      h += ' <button type="button" class="ktw-undo" data-ktwundo="' + last._id + '"' +
           (KTW.busy ? ' disabled' : '') + '>取消</button>';
    }
    h += '</div>';
  }
  if (st === 'done' && KT_PUNCH.lockAfterOut) {
    h += '<div class="ktw-line">本日は退勤済みです。次の出勤は日付が変わってから押せます。</div>';
  }
  if (KTW.pending) {
    h += '<div class="ktw-line ktw-warn">取消を申請中の打刻が' + KTW.pending +
         '件あります。管理者が確認するまで集計から外れます。</div>';
  }

  var q = ktwQueue();
  if (q.length) {
    h += '<div class="ktw-line ktw-warn">送信待ちの打刻が' + q.length +
         '件あります。通信が戻ると自動で送信されます。</div>';
  }
  if (KTW.msg) {
    h += '<div class="ktw-line ' + (KTW.msg.err ? 'ktw-warn' : 'ktw-ok') + '">' +
         ktEsc(KTW.msg.text) + '</div>';
  }

  ktwRender(h);
  ktwBind();
}

function ktwBind() {
  KTW.root.querySelectorAll('[data-ktw]').forEach(function (b) {
    b.onclick = function () { ktwPunch(b.getAttribute('data-ktw')); };
  });
  KTW.root.querySelectorAll('[data-ktwundo]').forEach(function (b) {
    b.onclick = function () { ktwRequestVoid(b.getAttribute('data-ktwundo')); };
  });
}

/* ── 打刻 ────────────────────────────────────────────────── */

function ktwPunch(type) {
  if (KTW.busy || !KTW.emp) return;

  if (type === '出勤' && KT_PUNCH.lockAfterOut && ktwState() === 'done') {
    KTW.msg = { text: '本日は退勤済みです。次の出勤は日付が変わってから押せます' };
    ktwDraw(); return;
  }

  var recent = KTW.punches.filter(function (p) {
    return p.PunchType === type &&
           (Date.now() - new Date(p._time)) < KT_PUNCH.dedupeMin * 60000;
  });
  if (recent.length) { KTW.msg = { text: type + 'は既に記録されています' }; ktwDraw(); return; }

  // 出勤してすぐの退勤・定時前の退勤は押し間違いが多いので、一度だけ確かめる
  if (type === '退勤') {
    var why = ktEarlyOutReason(KTW.punches);
    if (why && !window.confirm(why + '\n退勤にしますか？')) return;
  }

  KTW.busy = true;
  KTW.msg = { text: '位置を確認しています…' };
  ktwDraw();

  var clientTime = new Date().toISOString();
  var wd = ktwWorkDate();

  ktGetLocation().then(function (loc) {
    var site = ktJudgeSite(loc, KTW.sites);
    var fields = {
      Title:          KTW.emp.Title,
      PunchType:      type,
      WorkDate:       wd,
      ClientTime:     clientTime,
      LocationStatus: loc.status,
      LocationSource: loc.source || '',
      SiteName:       site.name,
      UserAgent:      (navigator.userAgent || '').slice(0, 250)
    };
    if (loc.lat != null) {
      fields.Lat = loc.lat; fields.Lon = loc.lon; fields.AccuracyM = loc.accuracy;
    }
    if (site.dist != null) fields.SiteDistM = site.dist;

    // 失敗時の処理は then の第2引数に置く。こうしないと、送信は成功したのに
    // そのあとの取り直しが失敗しただけで保留キューに積まれ、二重に打刻されてしまう。
    return ktCreate('punches', fields).then(function (saved) {
      if (navigator.vibrate) { try { navigator.vibrate(80); } catch (e) {} }
      KTW.msg = { text: ktHm(saved._time) + ' ' + type +
                        (site.name && site.name !== '位置なし' ? '／' + site.name : '') };
      ktwAdd(saved);                       // 押した内容をその場で反映（ボタンがすぐ切り替わる）
      return ktwLoadPunches().catch(function () {})
        .then(function () { ktwAdd(saved); });   // 一覧にまだ出ていなければ入れ直す
    }, function () {
      // 送信できなければ勤怠アプリと同じ保留キューに入れる
      ktwQueuePush(fields);
      KTW.msg = { text: type + 'を保留しました（通信が戻ると自動で送信されます）', err: true };
    });
  }).then(function () {
    KTW.busy = false; ktwDraw();
  }).catch(function (e) {
    KTW.busy = false;
    KTW.msg = { text: '打刻に失敗しました：' + e.message, err: true };
    ktwDraw();
  });
}

/* 勤怠アプリと同じ保留キューを使う（同じサイトなので共有される） */
function ktwQueue() {
  try { return JSON.parse(localStorage.getItem('kt_queue_v1') || '[]'); } catch (e) { return []; }
}
function ktwQueuePush(f) {
  var q = ktwQueue(); q.push(f);
  localStorage.setItem('kt_queue_v1', JSON.stringify(q));
}

/* ── 見た目 ──────────────────────────────────────────────
   既存アプリの CSS とぶつからないよう、すべて .ktw- で始めている。 */

function ktwStyle() {
  if (document.getElementById('ktw-style')) return;
  var css = [
    '.ktw{font-family:"Hiragino Sans","Yu Gothic",YuGothic,sans-serif;font-size:14px;',
    '  line-height:1.6;color:#191D1E;background:#F8F9F7;border:1px solid #C9CDC8;',
    '  border-radius:8px;padding:10px 12px;box-sizing:border-box}',
    '.ktw *{box-sizing:border-box}',
    '.ktw-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:8px}',
    '.ktw-name{font-weight:700}',
    '.ktw-state{color:#6B7371;font-size:13px}',
    '.ktw-time{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:15px}',
    '.ktw-site{color:#2F5645;font-size:13px}',
    '.ktw-btns{display:flex;gap:8px;align-items:stretch}',
    '.ktw-main{flex:1;border:none;border-radius:7px;background:#2F5645;color:#fff;',
    '  font-size:19px;font-weight:700;letter-spacing:.25em;text-indent:.25em;',
    '  padding:14px 0;cursor:pointer;font-family:inherit}',
    '.ktw-main.ktw-out{background:#A63D2C}',
    '.ktw-main:disabled{opacity:.45;cursor:default}',
    '.ktw-log{margin-top:8px;color:#6B7371;font-size:12px}',
    '.ktw-logi{white-space:nowrap}',
    '.ktw-logs{opacity:.5;margin:0 6px}',
    '.ktw-undo{border:1px solid #C9CDC8;background:transparent;color:#6B7371;',
    '  border-radius:4px;padding:1px 7px;font-size:11px;cursor:pointer;font-family:inherit}',
    '.ktw-undo:disabled{opacity:.45;cursor:default}',
    '.ktw-line{margin-top:8px;font-size:13px}',
    '.ktw-ok{color:#2F5645}',
    '.ktw-warn{color:#A63D2C}',
    '@media (prefers-color-scheme:dark){',
    '  .ktw{color:#E4E9E6;background:#1C2120;border-color:#333B39}',
    '  .ktw-state,.ktw-log{color:#8B9390}',
    '  .ktw-undo{border-color:#333B39;color:#8B9390}',
    '  .ktw-site,.ktw-ok{color:#8FBFA7}',
    '  .ktw-main{background:#6FA189;color:#0E1211}',
    '  .ktw-main.ktw-out{background:#D5806D;color:#0E1211}',
    '  .ktw-warn{color:#D5806D}}'
  ].join('');
  var el = document.createElement('style');
  el.id = 'ktw-style';
  el.textContent = css;
  document.head.appendChild(el);
}

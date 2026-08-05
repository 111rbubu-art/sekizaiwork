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
  ready: false, busy: false, showBreak: false, msg: null
};

/* ── 起動 ────────────────────────────────────────────────── */

function ktWidgetInit(opt) {
  opt = opt || {};
  var el = typeof opt.el === 'string' ? document.querySelector(opt.el) : opt.el;
  if (!el) { return; }
  KTW.root = el;
  KTW.appUrl = opt.appUrl || './kintai/';

  // 既存アプリのトークンを使う（MSAL を二重に初期化しない）
  if (typeof opt.getToken === 'function') KT_TOKEN_PROVIDER = opt.getToken;

  ktwStyle();
  ktwRender('<div class="ktw-line">読み込んでいます…</div>');
  ktwLoad();
}

function ktwLoad() {
  var me = ktwUserName();
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
  }).catch(function (e) {
    ktwRender('<div class="ktw-line ktw-warn">勤怠の読み込みに失敗しました：' +
      ktEsc(e.message) + '</div>');
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

function ktwLoadPunches() {
  var wd = ktwWorkDate();
  return ktList('punches', "fields/WorkDate eq '" + wd + "'").then(function (rows) {
    KTW.punches = rows.filter(function (p) {
      return p.Title === KTW.emp.Title && p.WorkDate === wd && p.Voided !== true &&
             ['出勤', '退勤', '休憩開始', '休憩終了'].indexOf(p.PunchType) >= 0;
    }).sort(function (a, b) { return new Date(a._time) - new Date(b._time); });
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
  h += '<a class="ktw-link" href="' + ktEsc(KTW.appUrl) + '" target="_blank" rel="noopener">勤怠を開く</a>';
  h += '</div>';

  h += '<div class="ktw-btns">';
  if (st === 'off' || st === 'done') {
    h += '<button type="button" class="ktw-main" data-ktw="出勤"' +
         (KTW.busy ? ' disabled' : '') + '>出勤</button>';
  } else if (st === 'break') {
    h += '<button type="button" class="ktw-main" data-ktw="休憩終了"' +
         (KTW.busy ? ' disabled' : '') + '>休憩終了</button>';
  } else {
    h += '<button type="button" class="ktw-main ktw-out" data-ktw="退勤"' +
         (KTW.busy ? ' disabled' : '') + '>退勤</button>';
  }
  h += '<button type="button" class="ktw-sub" data-ktwtoggle="1">休憩</button>';
  h += '</div>';

  // 休憩中は畳んでいても終了を押せるようにする
  if (KTW.showBreak || st === 'break') {
    h += '<div class="ktw-btns ktw-brk">';
    h += '<button type="button" class="ktw-sub" data-ktw="休憩開始"' +
         (st === 'in' && !KTW.busy ? '' : ' disabled') + '>休憩開始</button>';
    h += '<button type="button" class="ktw-sub" data-ktw="休憩終了"' +
         (st === 'break' && !KTW.busy ? '' : ' disabled') + '>休憩終了</button>';
    h += '</div>';
  }

  if (KTW.punches.length) {
    h += '<div class="ktw-log">' + KTW.punches.map(function (p) {
      return ktEsc(p.PunchType) + ' ' + ktHm(p._time);
    }).join('　／　') + '</div>';
  }

  var q = ktwQueue();
  if (q.length) {
    h += '<div class="ktw-line ktw-warn">送信待ちの打刻が' + q.length +
         '件あります。勤怠アプリを開くと送信されます。</div>';
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
  var tg = KTW.root.querySelector('[data-ktwtoggle]');
  if (tg) tg.onclick = function () { KTW.showBreak = !KTW.showBreak; ktwDraw(); };
}

/* ── 打刻 ────────────────────────────────────────────────── */

function ktwPunch(type) {
  if (KTW.busy || !KTW.emp) return;

  var recent = KTW.punches.filter(function (p) {
    return p.PunchType === type &&
           (Date.now() - new Date(p._time)) < KT_PUNCH.dedupeMin * 60000;
  });
  if (recent.length) { KTW.msg = { text: type + 'は既に記録されています' }; ktwDraw(); return; }

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

    return ktCreate('punches', fields).then(function (saved) {
      if (navigator.vibrate) { try { navigator.vibrate(80); } catch (e) {} }
      KTW.msg = { text: ktHm(saved._time) + ' ' + type +
                        (site.name && site.name !== '位置なし' ? '／' + site.name : '') };
      return ktwLoadPunches();
    }).catch(function () {
      // 送信できなければ勤怠アプリと同じ保留キューに入れる
      ktwQueuePush(fields);
      KTW.msg = { text: type + 'を保留しました（勤怠アプリを開くと送信されます）', err: true };
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
    '.ktw-link{margin-left:auto;font-size:12px;color:#2F5645;text-decoration:underline}',
    '.ktw-btns{display:flex;gap:8px;align-items:stretch}',
    '.ktw-brk{margin-top:8px}',
    '.ktw-main{flex:1;border:none;border-radius:7px;background:#2F5645;color:#fff;',
    '  font-size:19px;font-weight:700;letter-spacing:.25em;text-indent:.25em;',
    '  padding:14px 0;cursor:pointer;font-family:inherit}',
    '.ktw-main.ktw-out{background:#A63D2C}',
    '.ktw-main:disabled,.ktw-sub:disabled{opacity:.45;cursor:default}',
    '.ktw-sub{flex:0 0 auto;min-width:76px;background:transparent;border:1px solid #C9CDC8;',
    '  border-radius:6px;color:#4A5251;padding:10px 12px;cursor:pointer;',
    '  font-size:13px;font-family:inherit}',
    '.ktw-brk .ktw-sub{flex:1}',
    '.ktw-log{margin-top:8px;color:#6B7371;font-size:12px}',
    '.ktw-line{margin-top:8px;font-size:13px}',
    '.ktw-ok{color:#2F5645}',
    '.ktw-warn{color:#A63D2C}',
    '@media (prefers-color-scheme:dark){',
    '  .ktw{color:#E4E9E6;background:#1C2120;border-color:#333B39}',
    '  .ktw-state,.ktw-log{color:#8B9390}',
    '  .ktw-site,.ktw-link,.ktw-ok{color:#8FBFA7}',
    '  .ktw-main{background:#6FA189;color:#0E1211}',
    '  .ktw-main.ktw-out{background:#D5806D;color:#0E1211}',
    '  .ktw-sub{border-color:#333B39;color:#B2B9B6}',
    '  .ktw-warn{color:#D5806D}}'
  ].join('');
  var el = document.createElement('style');
  el.id = 'ktw-style';
  el.textContent = css;
  document.head.appendChild(el);
}

/* ============================================================
   勤怠管理 — 画面と操作
   ============================================================ */

var KT = {
  emp: null, employees: [], sites: [], holidays: [],
  punches: [], consents: [], grants: [], requests: [],
  consent: null,                                 // true=同意 / false=不同意 / null=未回答
  cancels: [],                                   // 打刻の取消申請
  isAdmin: false, tab: 'punch',
  showBreak: false, showFix: false,        // 休憩の打刻・訂正欄の開閉
  histYm: ktYm(ktToday()), adminYm: ktYm(ktToday()), adminDate: ktToday(),
  fixDate: ktToday(),                            // 訂正欄で見ている日
  busy: false
};

/* ── 小物 ──────────────────────────────────────────────── */

function $(id) { return document.getElementById(id); }

var _toastTimer = null;
function ktToast(msg, isErr) {
  var t = $('toast');
  t.textContent = msg;
  t.className = isErr ? 'err' : '';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function () { t.className = 'hide'; }, isErr ? 6000 : 3000);
}

function ktBuzz(ms) {
  if (navigator.vibrate) { try { navigator.vibrate(ms || 60); } catch (e) {} }
}

/* ── 打刻の要確認判定（読み出し時に計算する） ─────────────
   打刻ログは書き換えない設計のため、フラグは保存せず毎回導出する。 */
function ktEvalReview(p, prev) {
  var reasons = [];

  // 手入力は位置情報も端末時刻も無いのが当然なので、それを理由に警告しない。
  // ただし本人が後から出した打刻漏れの申請は、管理者が確認するまで要確認にする。
  if (p._manual) {
    if (p.LocationStatus === KT_CANCEL_STATUS) {
      var why = ktCancelReason(p);
      p.ReviewReasons = ['打刻の取消申請' + (why ? '（' + why + '）' : '')];
      p.NeedsReview = p.Reviewed !== true;
      return p;
    }
    var isFix = p.LocationStatus === KT_FIX_STATUS;
    p.ReviewReasons = isFix
      ? ['打刻漏れの申請' + (p.AdminNote ? '（' + p.AdminNote + '）' : '')]
      : [];
    p.NeedsReview = isFix && p.Reviewed !== true;
    return p;
  }

  if (p.ClientTime && p._createdAt) {
    var drift = Math.round((new Date(p.ClientTime) - new Date(p._createdAt)) / 1000);
    p.TimeDriftSec = drift;
    if (Math.abs(drift) >= KT_PUNCH.driftAlertSec) {
      reasons.push('端末の時刻が' + Math.round(Math.abs(drift) / 60) + '分ずれています');
    }
  }
  if (p.LocationStatus && p.LocationStatus !== '取得成功') {
    reasons.push('位置情報' + p.LocationStatus);
  } else {
    // 事業所外と測位精度は別々の問題なので、両方あてはまれば両方出す
    if (p.SiteName === '事業所外') reasons.push('事業所外で打刻');
    if (+p.AccuracyM > KT_GEO.poorAccuracyM) {
      reasons.push('測位精度が粗い（' + p.AccuracyM + 'm）');
    }
  }
  var travel = ktCheckTravel(prev, { lat: p.Lat, lon: p.Lon },
                             prev && prev._time, p._time);
  if (travel) reasons.push(travel);

  p.ReviewReasons = reasons;
  p.NeedsReview = reasons.length > 0 && p.Reviewed !== true;
  return p;
}

function ktAnnotate(punches) {
  var byEmp = {};
  punches.slice().sort(function (a, b) { return new Date(a._time) - new Date(b._time); })
    .forEach(function (p) {
      var k = p.Title || '';
      ktEvalReview(p, byEmp[k]);
      if (p.Lat != null) byEmp[k] = p;
    });
  return punches;
}

/* ── オフラインの保留キュー ─────────────────────────────── */

var KT_QKEY = 'kt_queue_v1';

function ktQueue() {
  try { return JSON.parse(localStorage.getItem(KT_QKEY) || '[]'); } catch (e) { return []; }
}
function ktQueueSave(q) { localStorage.setItem(KT_QKEY, JSON.stringify(q)); }
function ktQueuePush(fields) { var q = ktQueue(); q.push(fields); ktQueueSave(q); }

function ktQueueFlush() {
  var q = ktQueue();
  if (!q.length) return Promise.resolve(0);
  var sent = 0;
  return q.reduce(function (chain, f) {
    return chain.then(function () {
      return ktCreate('punches', f).then(function () { sent++; })
        .catch(function () { throw new Error('stop'); });
    });
  }, Promise.resolve()).catch(function () {})
    .then(function () {
      ktQueueSave(q.slice(sent));
      return sent;
    });
}

/* ── データ読み込み ─────────────────────────────────────── */

function ktLoadMasters() {
  return Promise.all([
    ktList('employees'),
    ktList('sites').catch(function () { return []; }),
    ktList('holidays').catch(function () { return []; })
  ]).then(function (r) {
    KT.employees = r[0];
    KT.sites     = r[1];
    KT.holidays  = r[2];

    var me = ktUserName();
    KT.emp = KT.employees.filter(function (e) {
      return String(e.UserPrincipalName || '').toLowerCase() === me;
    })[0] || null;
    KT.isAdmin = !!(KT.emp && KT.emp.IsAdmin === true);
  });
}

/* 位置情報の同意も打刻ログに記録する。
   打刻ログは追記専用でサーバが時刻と本人を押すため、同意の記録先として最も確実。
   （社員マスタを本人が編集できるようにすると、入社日まで書き換えられてしまう） */
var KT_CONSENT_TYPES = ['位置情報同意', '位置情報不同意'];

/* 本人が後から申請した打刻の目印（LocationStatus に入れる） */
var KT_FIX_STATUS = '打刻漏れ申請';

/* ── 打刻の取消申請 ──────────────────────────────────────
   誤って押した打刻を、本人が「これは間違いです」と申し出るための行。

   打刻ログは追記専用なので、本人は自分の打刻を書き換えられない。
   そこで「取消してほしい」という1行を新しく追加し、管理者がそれを見て
   対象の打刻に Voided を立てる。押した記録も、取り消した記録も両方残る。

   取消申請の行そのものは Voided=true で作る。勤怠の集計には一切入らず、
   LocationStatus と AdminNote だけが意味を持つ。
   AdminNote は「取消対象#<対象の項目ID>／<理由>」の形で入れる。
   SharePoint 側に列を足さずに、対象と理由の両方を残すための決まりごと。
   ------------------------------------------------------------ */
var KT_CANCEL_STATUS = '打刻取消申請';
var KT_CANCEL_MARK   = '取消対象#';

function ktCancelTargetId(c) {
  var m = new RegExp(KT_CANCEL_MARK + '([^／\\s]+)').exec(String((c || {}).AdminNote || ''));
  return m ? m[1] : '';
}
function ktCancelReason(c) {
  var s = String((c || {}).AdminNote || '');
  var i = s.indexOf('／');
  return i >= 0 ? s.slice(i + 1) : '';
}

/* 集計に入れてよい打刻。取消済みと、取消を申請中のものを外す。 */
function ktActive(ps) {
  return (ps || []).filter(function (p) {
    return p.Voided !== true && p.CancelPending !== true;
  });
}

/* 打刻は直近13か月分だけ読む（月次と有給の集計に十分）。
   同意の記録は期間に関わらず必要なので別途すべて読む。 */
function ktLoadPunches() {
  var from = ktYmdAddMonths(ktToday(), -13);
  return ktList('punches').then(function (rows) {
    ktAnnotate(rows);
    KT.consents = rows.filter(function (p) {
      return KT_CONSENT_TYPES.indexOf(p.PunchType) >= 0;
    });
    KT.cancels = rows.filter(function (p) {
      return p.LocationStatus === KT_CANCEL_STATUS;
    }).sort(function (a, b) { return new Date(b._createdAt) - new Date(a._createdAt); });
    KT.punches = rows.filter(function (p) {
      return KT_CONSENT_TYPES.indexOf(p.PunchType) < 0 &&
             p.LocationStatus !== KT_CANCEL_STATUS &&
             ktYmdDiffDays(p.WorkDate || from, from) >= 0;
    });
    ktMarkCancelPending();
    KT.consent = ktConsentOf(KT.emp ? KT.emp.Title : null);
  });
}

/* 未処理の取消申請がある打刻に印をつける。
   打刻ログは書き換えない設計なので、読み出すたびにここで導出する。 */
function ktMarkCancelPending() {
  var pending = {};
  KT.cancels.forEach(function (c) {
    if (c.Reviewed === true) return;
    var id = ktCancelTargetId(c);
    if (id) pending[id] = c;
  });
  KT.punches.forEach(function (p) {
    p.CancelPending = !!pending[p._id];
    p.CancelReq     = pending[p._id] || null;
  });
}

/* その社員の最新の同意状況 */
function ktConsentOf(empNo) {
  if (!empNo) return null;
  var rows = KT.consents.filter(function (c) { return c.Title === empNo; })
    .sort(function (a, b) { return new Date(b._time) - new Date(a._time); });
  if (!rows.length) return null;
  return rows[0].PunchType === '位置情報同意';
}

function ktLoadLeave() {
  return Promise.all([
    ktList('grants').catch(function () { return []; }),
    ktList('requests').catch(function () { return []; })
  ]).then(function (r) { KT.grants = r[0]; KT.requests = r[1]; });
}

function ktReload() {
  return ktQueueFlush().then(function (sent) {
    if (sent) ktToast(sent + '件の保留していた打刻を送信しました');
    return Promise.all([ktLoadPunches(), ktLoadLeave()]);
  }).then(ktRender);
}

/* ── 絞り込み ──────────────────────────────────────────── */

function ktMyPunches() {
  if (!KT.emp) return [];
  return KT.punches.filter(function (p) { return p.Title === KT.emp.Title; });
}
function ktMyRequests() {
  if (!KT.emp) return [];
  return KT.requests.filter(function (r) { return r.EmpNo === KT.emp.Title; });
}
function ktMyGrants() {
  if (!KT.emp) return [];
  return KT.grants.filter(function (g) { return g.EmpNo === KT.emp.Title; });
}
function ktEmpOf(no) {
  return KT.employees.filter(function (e) { return e.Title === no; })[0] || {};
}

/* 有給の対象者か。役員は労基法上の労働者ではないため対象外。
   入社日が未登録の場合も、付与日を決められないので対象外として扱う。 */
function ktIsOfficer(emp) { return (emp || {}).EmpType === '役員'; }
function ktLeaveTarget(emp) {
  emp = emp || {};
  return !ktIsOfficer(emp) && /^\d{4}-\d{2}-\d{2}$/.test(emp.HireDate || '');
}
function ktLeaveOffReason(emp) {
  if (ktIsOfficer(emp)) return '役員のため対象外';
  return '入社日が未登録のため計算できません';
}

/* 役員には労基法の労働時間規制が適用されないので、その由来の警告は出さない */
function ktFilterAlerts(alerts, emp) {
  if (!ktIsOfficer(emp)) return alerts;
  return (alerts || []).filter(function (a) {
    return !/休憩が|法定休日に労働|所定休日に労働/.test(a);
  });
}

/* 代休の状況。発生は打刻から算出するので、期限より長めの期間を見る */
function ktCompFor(emp) {
  if (!emp) return null;
  var t = ktToday();
  // 期限切れの分も少し見せたいので、期限の期間＋半年ぶんをさかのぼる
  var from = ktYmdAddMonths(t, -(KT_COMP.expireMonths + 6));
  var ps = KT.punches.filter(function (p) { return p.Title === emp.Title; });
  var rs = KT.requests.filter(function (r) { return r.EmpNo === emp.Title; });
  var days = ktComputeRange(from, t, ps, KT.holidays, ktWorkDateNow());
  return ktCompState(emp, days, rs, t);
}

/* その日に承認済みの有給があれば種別を返す */
function ktLeaveOn(ymd, empNo) {
  var no = empNo || (KT.emp ? KT.emp.Title : '');
  var r = KT.requests.filter(function (x) {
    return x.EmpNo === no && x.LeaveDate === ymd && x.Status === '承認';
  })[0];
  return r ? (r.LeaveType || '有給') : '';
}

/* 今日の勤務日（深夜勤務は前日扱い） */
function ktWorkDateNow() {
  var now = new Date();
  var h = ktJst(now).getUTCHours();
  return h < KT_PUNCH.dayStartHour ? ktYmdAddDays(ktYmd(now), -1) : ktYmd(now);
}

function ktTodayPunches() {
  var wd = ktWorkDateNow();
  return ktMyPunches().filter(function (p) { return p.WorkDate === wd && p.Voided !== true; })
    .sort(function (a, b) { return new Date(a._time) - new Date(b._time); });
}

/* 現在の状態 … 'off'（未出勤）/'in'（勤務中）/'break'（休憩中）/'done'（退勤済）
   取消を申請中の打刻は無かったものとして状態を決める。
   間違って押した退勤を申請すれば、余計な出勤を押し直さずに勤務中へ戻れる。 */
function ktCurrentState() {
  var ps = ktActive(ktTodayPunches());
  if (!ps.length) return 'off';
  var last = ps[ps.length - 1].PunchType;
  if (last === '出勤' || last === '休憩終了') return 'in';
  if (last === '休憩開始') return 'break';
  if (last === '退勤') return 'done';
  return 'off';
}

/* ── 打刻 ──────────────────────────────────────────────── */

function ktPunch(type) {
  if (KT.busy) return;
  if (!KT.emp) { ktToast('社員マスタに登録がありません', true); return; }

  // 同じ種類の打刻が短時間に重なっていないか
  var recent = ktTodayPunches().filter(function (p) {
    return p.PunchType === type &&
           (Date.now() - new Date(p._time)) < KT_PUNCH.dedupeMin * 60000;
  });
  if (recent.length) { ktToast(type + 'は既に記録されています'); return; }

  // 出勤してすぐの退勤・定時前の退勤は押し間違いが多いので、一度だけ確かめる
  if (type === '退勤') {
    var why = ktEarlyOutReason(ktActive(ktTodayPunches()));
    if (why && !window.confirm(why + '\n退勤にしますか？')) return;
  }

  KT.busy = true;
  ktRender();
  ktToast('位置を確認しています…');

  var clientTime = new Date().toISOString();
  var wd = ktWorkDateNow();

  var locPromise = (KT.consent === false)
    ? Promise.resolve({ status: '同意なし' })
    : ktGetLocation();

  locPromise.then(function (loc) {
    var site = ktJudgeSite(loc, KT.sites);
    var fields = {
      Title:          KT.emp.Title,
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
      ktBuzz(80);
      ktToast(ktHm(saved._time) + ' ' + type +
              (site.name && site.name !== '位置なし' ? '／' + site.name : ''));
      return ktLoadPunches();
    }).catch(function (e) {
      // 送信できなければ端末に保留し、次回オンライン時に自動送信する
      ktQueuePush(fields);
      ktBuzz([40, 60, 40]);
      ktToast(type + 'を保留しました（電波が戻り次第、自動で送信します）', true);
    });
  }).then(function () {
    KT.busy = false; ktRender();
  }).catch(function (e) {
    KT.busy = false; ktRender();
    ktToast('打刻に失敗しました：' + e.message, true);
  });
}

/* ── 画面：打刻 ────────────────────────────────────────── */

function ktViewPunch() {
  var wd = ktWorkDateNow();
  var ps = ktTodayPunches();                     // 表示用（取消申請中も見せる）
  var live = ktActive(ps);                       // 集計用
  var st = ktCurrentState();
  var day = ktComputeDay(wd, live, KT.holidays, st === 'in' || st === 'break');
  var kind = ktDayKind(wd, KT.holidays);

  var lastIn = live.filter(function (p) { return p.PunchType === '出勤'; })[0];
  var lastAny = live[live.length - 1];

  var stateTxt = { off: '未出勤', in: '勤務中', break: '休憩中', done: '退勤済み' }[st];
  var placeP = lastAny || lastIn;
  var placeTxt = '', placeWarn = false;
  if (placeP) {
    placeTxt = placeP.SiteName || '';
    placeWarn = (placeP.SiteName === '事業所外' || placeP.SiteName === '位置なし');
  }

  var h = '';

  h += '<div class="card">';
  h += '<div class="state">';
  h += '<span class="d">' + ktEsc(ktYmdLabelFull(wd)) +
       (kind ? ' <span class="badge cau">' + ktDayKindLabel(kind) + '</span>' : '') + '</span>';
  if (st === 'off') {
    h += '<span class="big">--:--</span><span class="s">' + stateTxt + '</span>';
  } else {
    var shown = st === 'done' ? day.clockOut : (lastAny ? lastAny._time : null);
    h += '<span class="big">' + (shown ? ktHm(shown) : '--:--') +
         ' <span style="font-size:.95rem;font-family:var(--font)">' + stateTxt + '</span></span>';
    if (placeTxt) {
      h += '<span class="place' + (placeWarn ? ' warn' : '') + '">' + ktEsc(placeTxt) + '</span>';
    }
  }
  h += '</div>';

  // 主ボタンは「いま押せるもの」だけを出す
  if (st === 'off' || st === 'done') {
    h += '<button class="punch" data-punch="出勤"' + (KT.busy ? ' disabled' : '') + '>出勤</button>';
  } else if (st === 'break') {
    h += '<button class="punch" data-punch="休憩終了"' + (KT.busy ? ' disabled' : '') + '>休憩終了</button>';
  } else {
    h += '<button class="punch out" data-punch="退勤"' + (KT.busy ? ' disabled' : '') + '>退勤</button>';
  }

  // 休憩の打刻はふだん使わないので、押したときだけ出す。
  // ただし休憩中は必ず見えるようにする（終了を押せないと困るため）
  var openBreak = KT.showBreak || st === 'break';
  h += '<button class="more" id="tg-break">' +
       (openBreak ? '休憩の打刻を隠す' : '休憩の打刻') + '</button>';
  if (openBreak) {
    h += '<div class="subrow">';
    h += '<button data-punch="休憩開始"' + (st === 'in' && !KT.busy ? '' : ' disabled') + '>休憩開始</button>';
    h += '<button data-punch="休憩終了"' + (st === 'break' && !KT.busy ? '' : ' disabled') + '>休憩終了</button>';
    h += '</div>';
    if (st === 'break') {
      h += '<div class="btnrow"><button class="btn ghost" data-punch="退勤" style="flex:1">休憩のまま退勤する</button></div>';
    }
  }

  var q = ktQueue();
  if (q.length) h += '<div class="alert cau">送信待ちの打刻が' + q.length + '件あります。電波が戻ると自動で送信されます。</div>';
  h += '<button class="more" id="tg-fix">打刻をまちがえたとき・忘れたときは</button>';
  if (KT.showFix) h += ktFixForm();
  h += '</div>';

  // 今日の打刻
  if (ps.length) {
    h += '<div class="card"><h2>今日の打刻</h2>';
    ps.forEach(function (p) {
      h += '<div class="row"><span class="k">' + ktEsc(p.PunchType) +
           (p._manual ? ' <span class="badge cau">手入力</span>' : '') +
           (p.CancelPending ? ' <span class="badge no">取消申請中</span>'
            : p.NeedsReview ? ' <span class="badge no">要確認</span>' : '') + '</span>';
      h += '<span class="v">' + ktHm(p._time) + '　<span class="muted">' +
           ktEsc(p.SiteName || '') + '</span>' + ktVoidBtn(p) + '</span></div>';
    });
    if (day.workMin) {
      h += '<div class="sep"></div>';
      h += '<div class="row"><span class="k">労働時間</span><span class="v">' + ktMinToHm(day.workMin) + '</span></div>';
      if (day.breakMin) h += '<div class="row"><span class="k">休憩</span><span class="v">' + day.breakMin + '分</span></div>';
    }
    ktFilterAlerts(day.alerts, KT.emp).forEach(function (a) { h += '<div class="alert cau">' + ktEsc(a) + '</div>'; });
    h += '</div>';
  }

  // 今月
  var mr = ktMonthRange(ktYm(wd));
  var days = ktComputeRange(mr.from, mr.to, ktMyPunches(), KT.holidays, ktWorkDateNow());
  var sum = ktSummarize(days);
  h += '<div class="card"><h2>今月（' + (+ktYm(wd).split('-')[1]) + '月）</h2>';
  h += '<div class="row"><span class="k">勤務時間</span><span class="v">' + ktMinToHm(sum.workMin) + '</span></div>';
  h += '<div class="row"><span class="k">うち時間外</span><span class="v">' + ktMinToHm(sum.otMin) + '</span></div>';
  if (sum.nightMin) h += '<div class="row"><span class="k">うち深夜</span><span class="v">' + ktMinToHm(sum.nightMin) + '</span></div>';
  if (sum.legalHolidayMin) h += '<div class="row"><span class="k">法定休日労働</span><span class="v">' + ktMinToHm(sum.legalHolidayMin) + '</span></div>';
  h += '<div class="row"><span class="k">出勤日数</span><span class="v">' + sum.workDays + '日</span></div>';
  h += '</div>';

  // 有給
  h += ktLeaveSummaryCard();

  // 代休
  h += ktCompSummaryCard();

  return h;
}

/* 代休の残と期限。発生がなければ何も出さない。 */
function ktCompSummaryCard() {
  if (!KT.emp) return '';
  var cs = ktCompFor(KT.emp);
  if (!cs || (!cs.earnedDays && !cs.takenDays)) return '';

  var h = '<div class="card"><h2>代休</h2>';
  h += '<div class="row"><span class="k">残日数</span><span class="v" style="font-size:1.3rem">' +
       cs.balanceDays + '日</span></div>';
  h += '<div class="row"><span class="k">これまでの発生</span><span class="v">' + cs.earnedDays + '日</span></div>';
  h += '<div class="row"><span class="k">取得済み</span><span class="v">' + cs.takenDays + '日</span></div>';
  if (cs.expiringSoon.length) {
    var e = cs.expiringSoon[0];
    h += '<div class="alert">' + ktEsc(e.date) + 'の休日出勤ぶんが ' + ktEsc(e.expireDate) +
         ' で期限切れになります（残り' + ktYmdDiffDays(e.expireDate, ktToday()) + '日）</div>';
  }
  if (cs.expiredDays) {
    h += '<div class="alert cau">期限切れになった代休：' + cs.expiredDays + '日</div>';
  }
  h += '</div>';
  return h;
}

/* ── 打刻漏れの申請 ────────────────────────────────────────
   本人が後から時刻を申請する。打刻ログに ManualTime 付きで1行追加し、
   LocationStatus を「打刻漏れ申請」にして、管理者の確認待ちにする。
   サーバが作成日時と本人を自動で記録するので、いつ誰が申請したかは残る。 */
/* 本人が押せる［取消］。管理者のように直接消すのではなく、申請を1件足す。
   すでに申請中のものと、管理者が取り消し済みのものには出さない。 */
function ktVoidBtn(p) {
  if (!KT.emp || p.Title !== KT.emp.Title) return '';
  if (p.Voided === true || p.CancelPending) return '';
  return ' <button class="btn ghost" data-reqvoid="' + p._id +
         '" style="padding:.1rem .5rem;font-size:.72rem;font-weight:400">取消</button>';
}

/* 誤って押した打刻の取消を申請する。
   打刻ログは追記専用なので、対象を書き換えず申請の行を1件足すだけ。 */
function ktRequestVoid(punchId) {
  var p = KT.punches.filter(function (x) { return x._id === punchId; })[0];
  if (!p || !KT.emp) return;
  if (p.Title !== KT.emp.Title) { ktToast('自分の打刻だけ申請できます', true); return; }
  if (p.Voided === true || p.CancelPending) return;

  var why = window.prompt(
    ktYmdLabel(p.WorkDate) + ' ' + ktHm(p._time) + ' の「' + p.PunchType +
    '」を取り消すよう申請します。\n理由を書いてください。', '誤って押した');
  if (why === null) return;

  ktCreate('punches', {
    Title:          KT.emp.Title,
    PunchType:      p.PunchType,
    WorkDate:       p.WorkDate,
    ManualTime:     ktYmd(p._time) + 'T' + ktHm(p._time),
    ClientTime:     new Date().toISOString(),
    LocationStatus: KT_CANCEL_STATUS,
    Voided:         true,                        // 申請の行そのものは勤怠に数えない
    VoidReason:     '取消の申請',
    AdminNote:      KT_CANCEL_MARK + p._id + '／' + (String(why).trim() || '誤って押した'),
    UserAgent:      (navigator.userAgent || '').slice(0, 250)
  }).then(function () {
    ktToast('取消を申請しました。管理者の確認をお待ちください');
    return ktLoadPunches();
  }).then(ktRender)
    .catch(function (e) { ktToast('申請に失敗しました：' + e.message, true); });
}

function ktFixForm() {
  var h = '<div class="fixbox">';

  // ① まちがえた打刻を取り消す（押し間違いはこちらのほうが多い）
  h += '<p class="muted" style="font-weight:700;color:var(--ink2)">まちがえて押した打刻を取り消す</p>';
  h += '<p class="muted">取り消したい打刻の［取消］を押してください。' +
       '管理者が確認するまでは「取消申請中」となり、その間は勤怠の集計から外れます。</p>';
  h += '<label class="f" for="fx-vdate">日付</label>' +
       '<input type="date" id="fx-vdate" value="' + KT.fixDate + '" max="' + ktToday() + '">';
  var list = ktMyPunches().filter(function (x) {
    return x.WorkDate === KT.fixDate && x.Voided !== true;
  }).sort(function (a, b) { return new Date(a._time) - new Date(b._time); });
  if (!list.length) {
    h += '<p class="muted" style="margin-top:.4rem">この日の打刻はありません。</p>';
  }
  list.forEach(function (p) {
    h += '<div class="row"><span class="k">' + ktEsc(p.PunchType) + ' ' + ktHm(p._time) +
         (p._manual ? ' <span class="badge cau">手入力</span>' : '') + '</span>';
    h += '<span class="v">' +
         (p.CancelPending ? '<span class="badge no">取消申請中</span>' : ktVoidBtn(p)) +
         '</span></div>';
  });

  h += '<div class="sep"></div>';

  // ② 押し忘れた打刻を申請する
  h += '<p class="muted" style="font-weight:700;color:var(--ink2)">押し忘れた打刻を申請する</p>';
  h += '<p class="muted" style="margin-bottom:.4rem">' +
       '押し忘れた打刻を後から申請できます。管理者が確認するまで「要確認」の印がつきます。</p>';
  h += '<label class="f" for="fx-date">日付</label>' +
       '<input type="date" id="fx-date" value="' + ktWorkDateNow() + '" max="' + ktToday() + '">';
  h += '<label class="f" for="fx-type">種別</label><select id="fx-type">' +
       '<option selected>退勤</option><option>出勤</option>' +
       '<option>休憩開始</option><option>休憩終了</option></select>';
  h += '<label class="f" for="fx-time">時刻</label>' +
       '<input type="text" id="fx-time" inputmode="numeric" placeholder="17:30">';
  h += '<label class="f" for="fx-why">理由</label>' +
       '<input type="text" id="fx-why" placeholder="例：退勤の押し忘れ">';
  h += '<div class="btnrow"><button class="btn" id="fx-send">申請する</button></div>';
  h += '</div>';
  return h;
}

function ktSubmitFix() {
  if (!KT.emp) return;
  var date = $('fx-date').value;
  var type = $('fx-type').value;
  var hm   = ktNormalizeHm($('fx-time').value);
  var why  = ($('fx-why').value || '').trim();

  if (!date) { ktToast('日付を選んでください', true); return; }
  if (!hm)   { ktToast('時刻を 17:30 のように入れてください', true); return; }
  if (ktYmdDiffDays(date, ktToday()) > 0) { ktToast('未来の日付は申請できません', true); return; }

  var dup = ktMyPunches().filter(function (p) {
    return p.WorkDate === date && p.PunchType === type && p.Voided !== true;
  });
  if (dup.length && !window.confirm(
        ktYmdLabel(date) + ' の' + type + 'は既に ' + ktHm(dup[0]._time) +
        ' で記録されています。それでも申請しますか？')) return;

  $('fx-send').disabled = true;
  ktCreate('punches', {
    Title:          KT.emp.Title,
    PunchType:      type,
    WorkDate:       date,
    ManualTime:     date + 'T' + hm,
    ClientTime:     new Date().toISOString(),
    LocationStatus: '打刻漏れ申請',
    SiteName:       '',
    AdminNote:      why,
    UserAgent:      (navigator.userAgent || '').slice(0, 250)
  }).then(function () {
    ktToast(ktYmdLabel(date) + ' ' + hm + ' の' + type + 'を申請しました');
    KT.showFix = false;
    return ktReload();
  }).catch(function (e) {
    if ($('fx-send')) $('fx-send').disabled = false;
    ktToast('申請に失敗しました：' + e.message, true);
  });
}

function ktLeaveSummaryCard() {
  if (!KT.emp) return '';
  if (!ktLeaveTarget(KT.emp)) {
    return '<div class="card"><h2>有給休暇</h2><div class="muted">' +
           ktEsc(ktLeaveOffReason(KT.emp)) + '</div></div>';
  }
  var st = ktLeaveState(KT.emp, ktMyGrants(), ktMyRequests(), ktToday());
  var h = '<div class="card"><h2>有給休暇</h2>';
  h += '<div class="row"><span class="k">残日数</span><span class="v" style="font-size:1.3rem">' +
       st.balanceDays + '日</span></div>';
  if (st.pendingDays) h += '<div class="row"><span class="k">申請中</span><span class="v">' + st.pendingDays + '日</span></div>';
  if (st.nextExpire) {
    h += '<div class="row"><span class="k">次の失効</span><span class="v">' +
         ktEsc(st.nextExpire.expireDate) + '</span></div>';
  }
  var ob = st.obligation;
  if (ob && ob.level && ob.level !== 'done') {
    var cls = ob.level === 'urgent' ? 'alert' : 'alert cau';
    h += '<div class="' + cls + '">今年度あと' + ob.remain + '日の取得が必要です（期限 ' +
         ktEsc(ob.to) + '／残り' + ob.deadlineDays + '日）</div>';
  } else if (ob && ob.level === 'done') {
    h += '<div class="alert ok">年5日の取得義務は達成しています（' + ob.taken + '日）</div>';
  }
  h += '</div>';
  return h;
}

/* ── 画面：履歴 ────────────────────────────────────────── */

function ktViewHist() {
  var mr = ktMonthRange(KT.histYm);
  var days = ktComputeRange(mr.from, mr.to, ktMyPunches(), KT.holidays, ktWorkDateNow());
  var sum = ktSummarize(days);

  var h = '<div class="card">';
  h += '<div class="btnrow" style="margin:0 0 .6rem;align-items:center">';
  h += '<button class="btn ghost" id="hist-prev">前月</button>';
  h += '<span style="flex:1;text-align:center;font-weight:700">' + ktEsc(KT.histYm) + '</span>';
  h += '<button class="btn ghost" id="hist-next">翌月</button></div>';
  h += '<div class="row"><span class="k">勤務時間</span><span class="v">' + ktMinToHm(sum.workMin) + '</span></div>';
  h += '<div class="row"><span class="k">時間外</span><span class="v">' + ktMinToHm(sum.otMin) + '</span></div>';
  h += '<div class="row"><span class="k">深夜</span><span class="v">' + ktMinToHm(sum.nightMin) + '</span></div>';
  h += '<div class="row"><span class="k">法定休日労働</span><span class="v">' + ktMinToHm(sum.legalHolidayMin) + '</span></div>';
  h += '<div class="row"><span class="k">出勤日数</span><span class="v">' + sum.workDays + '日</span></div>';
  h += '</div>';

  h += '<div class="card"><h2>日ごとの記録</h2>' + ktDayTable(days, true) + '</div>';
  return h;
}

function ktDayTable(days, showPlace) {
  var h = '<div class="tw"><table><thead><tr>';
  h += '<th>日</th><th>出勤</th><th>退勤</th><th>休憩</th><th>労働</th><th>時間外</th>';
  if (showPlace) h += '<th>場所</th>';
  h += '<th></th></tr></thead><tbody>';
  var any = false;
  var today = ktToday();
  days.forEach(function (d) {
    // 休みで打刻がない日と、これから来る日は省く。平日の打刻漏れは残して見せる。
    if (!d.punches.length && (d.kind || ktYmdDiffDays(d.date, today) > 0)) return;
    any = true;
    var cls = d.review ? 'rev' : (d.kind ? 'hol' : '');
    h += '<tr class="' + cls + '">';
    h += '<td>' + ktEsc(ktYmdLabel(d.date)) + '</td>';
    h += '<td class="n">' + (d.clockIn ? ktHm(d.clockIn) : '—') + '</td>';
    h += '<td class="n">' + (d.clockOut ? ktHm(d.clockOut) : '—') + '</td>';
    h += '<td class="n">' + (d.breakMin || 0) + '</td>';
    h += '<td class="n">' + (d.workMin ? ktMinToHm(d.workMin) : '—') + '</td>';
    h += '<td class="n">' + ((d.dailyOtMin + d.weeklyOtMin) ? ktMinToHm(d.dailyOtMin + d.weeklyOtMin) : '—') + '</td>';
    if (showPlace) {
      var pl = d.punches.length ? (d.punches[0].SiteName || '') : '';
      h += '<td>' + ktEsc(pl) + '</td>';
    }
    var b = '';
    if (d.kind === 'legal')   b += '<span class="badge cau">法定休日</span> ';
    if (d.kind === 'company') b += '<span class="badge cau">所定休日</span> ';
    if (!d.punches.length) {
      var lv = ktLeaveOn(d.date);
      b += lv ? '<span class="badge ok">' + ktEsc(lv) + '</span> '
              : '<span class="badge cau">未打刻</span> ';
    }
    if (d.punches.some(function (p) { return p._manual; })) {
      b += '<span class="badge cau">手入力</span> ';
    }
    if (d.review)             b += '<span class="badge no">要確認</span> ';
    var al = ktFilterAlerts(d.alerts, KT.emp);
    if (al.length)            b += '<span class="badge no" title="' + ktEsc(al.join('／')) + '">!</span>';
    h += '<td>' + b + '</td></tr>';
  });
  if (!any) h += '<tr><td colspan="8" class="muted">記録がありません</td></tr>';
  h += '</tbody></table></div>';
  return h;
}

/* ── 画面：有給 ────────────────────────────────────────── */

function ktViewLeave() {
  if (!KT.emp) return '<div class="card muted">社員マスタに登録がありません。</div>';
  // 対象外の方にも画面は見せる（内容の確認ができるように）。申請だけを閉じる。
  var target = ktLeaveTarget(KT.emp);
  var head = '';
  if (!target) {
    head = '<div class="card"><h2>有給休暇</h2><div class="alert cau">' +
      ktEsc(ktLeaveOffReason(KT.emp)) + '。以下は確認用の表示です。</div>' +
      (ktIsOfficer(KT.emp)
        ? '<p class="muted">役員は労働基準法上の労働者にあたらないため、年次有給休暇の付与対象ではありません。' +
          '打刻・労働時間・代休の記録はこれまでどおり有効です。</p>'
        : '<p class="muted">社員マスタの <code>HireDate</code> に入社日を ' +
          '<code>2019-04-01</code> の形式で登録すると、付与日数が自動で計算されます。</p>') +
      '</div>';
  }
  var st = ktLeaveState(KT.emp, ktMyGrants(), ktMyRequests(), ktToday());
  var h = head + (target ? ktLeaveSummaryCard() : '');

  // 付与の内訳
  h += '<div class="card"><h2>付与の内訳</h2><div class="tw"><table><thead><tr>' +
       '<th>付与日</th><th>失効日</th><th>付与</th><th>消化</th><th>残</th></tr></thead><tbody>';
  if (!st.grants.length) {
    h += '<tr><td colspan="5" class="muted">まだ付与がありません（入社6か月後が初回）</td></tr>';
  }
  st.grants.slice().reverse().forEach(function (g) {
    var dead = ktYmdDiffDays(ktToday(), g.expireDate) >= 0;
    h += '<tr' + (dead ? ' class="hol"' : '') + '>';
    h += '<td>' + ktEsc(g.grantDate) + '</td><td>' + ktEsc(g.expireDate) +
         (dead ? ' <span class="badge no">失効</span>' : '') + '</td>';
    h += '<td class="n">' + g.days + '</td><td class="n">' + (Math.round(g.used * 10) / 10) + '</td>';
    h += '<td class="n">' + (Math.round((g.days - g.used) * 10) / 10) + '</td></tr>';
  });
  h += '</tbody></table></div>';
  if (st.expiredDays) h += '<div class="muted">これまでに失効した日数：' + st.expiredDays + '日</div>';
  h += '</div>';

  // 代休
  h += ktCompDetailCard();

  // 申請
  var cs0 = ktCompFor(KT.emp);
  var canComp = cs0 && cs0.balanceDays > 0;
  if (!target && !canComp) return h;             // 申請できるものが何もない
  h += '<div class="card"><h2>休みを申請する</h2>';
  h += '<label class="f" for="lv-date">取得する日</label><input type="date" id="lv-date" value="' + ktToday() + '">';
  h += '<label class="f" for="lv-type">種別</label><select id="lv-type">' +
       (target ? '<option>全日</option><option>午前半休</option><option>午後半休</option><option>時間単位</option>' : '') +
       (canComp ? '<option>代休</option>' : '') + '</select>';
  h += '<div id="lv-hours-wrap" class="hide"><label class="f" for="lv-hours">時間数</label>' +
       '<input type="number" id="lv-hours" min="1" max="8" step="1" value="1"></div>';
  h += '<label class="f" for="lv-note">備考（任意）</label><input type="text" id="lv-note" placeholder="記入は任意です">';
  h += '<div class="btnrow"><button class="btn" id="lv-submit">申請する</button></div>';
  if (!canComp && cs0 && cs0.earnedDays) {
    h += '<p class="muted" style="margin-top:.5rem">代休の残がないため、種別に代休は出ません。</p>';
  }
  h += '</div>';

  // 申請一覧
  var reqs = ktMyRequests().slice().sort(function (a, b) { return ktYmdDiffDays(b.LeaveDate, a.LeaveDate); });
  h += '<div class="card"><h2>申請の履歴（有給・代休）</h2><div class="tw"><table><thead><tr>' +
       '<th>取得日</th><th>種別</th><th>日数</th><th>状態</th><th></th></tr></thead><tbody>';
  if (!reqs.length) h += '<tr><td colspan="5" class="muted">申請はありません</td></tr>';
  reqs.forEach(function (r) {
    var bcls = r.Status === '承認' ? 'ok' : r.Status === '却下' ? 'no' : 'cau';
    h += '<tr><td>' + ktEsc(ktYmdLabel(r.LeaveDate)) + '</td><td>' + ktEsc(r.LeaveType || '') + '</td>';
    h += '<td class="n">' + ktRequestDays(r, KT.emp) + '</td>';
    h += '<td><span class="badge ' + bcls + '">' + ktEsc(r.Status || '') + '</span></td>';
    h += '<td>' + (r.Status === '申請中'
      ? '<button class="btn ghost" data-cancel="' + r._id + '" style="padding:.2rem .5rem;font-size:.75rem">取消</button>' : '') + '</td></tr>';
  });
  h += '</tbody></table></div></div>';

  if (st.shortages.length) {
    h += '<div class="alert">残日数を超えて承認されている申請があります（' +
         st.shortages.map(function (s) { return ktEsc(s.req.LeaveDate); }).join('、') + '）</div>';
  }
  return h;
}

/* 代休の発生と消化の内訳 */
function ktCompDetailCard() {
  var cs = ktCompFor(KT.emp);
  if (!cs || (!cs.earnedDays && !cs.takenDays)) {
    return '<div class="card"><h2>代休</h2><div class="muted">' +
           '休日に出勤した記録がないため、代休は発生していません。</div></div>';
  }
  var h = '<div class="card"><h2>代休</h2>';
  h += '<div class="row"><span class="k">残日数</span><span class="v" style="font-size:1.3rem">' +
       cs.balanceDays + '日</span></div>';
  h += '<div class="sep"></div>';
  h += '<div class="tw"><table><thead><tr><th>休日出勤した日</th><th>区分</th><th>労働</th>' +
       '<th>発生</th><th>消化</th><th>期限</th></tr></thead><tbody>';
  cs.earned.slice().reverse().forEach(function (e) {
    var dead = ktYmdDiffDays(ktToday(), e.expireDate) >= 0;
    var soon = !dead && ktYmdDiffDays(e.expireDate, ktToday()) <= KT_COMP.alertDays;
    h += '<tr' + (dead ? ' class="hol"' : '') + '>';
    h += '<td>' + ktEsc(ktYmdLabel(e.date)) + '</td>';
    h += '<td><span class="badge cau">' + ktEsc(e.kindLabel) + '</span></td>';
    h += '<td class="n">' + ktMinToHm(e.workMin) + '</td>';
    h += '<td class="n">' + e.days + '</td>';
    h += '<td class="n">' + (Math.round(e.used * 10) / 10) + '</td>';
    h += '<td>' + ktEsc(e.expireDate) +
         (dead ? ' <span class="badge no">期限切れ</span>'
               : soon ? ' <span class="badge no">期限間近</span>' : '') + '</td></tr>';
  });
  h += '</tbody></table></div>';
  if (cs.overDays) {
    h += '<div class="alert">発生していない代休が' + cs.overDays + '日ぶん取得されています。' +
         '管理者に確認してください。</div>';
  }
  h += '<div class="alert cau">代休を取っても、休日出勤の<b>割増賃金は別途支払われます</b>' +
       '（法定休日35%、所定休日は週40時間を超えた分25%）。代休で相殺されるのは通常の賃金部分だけです。</div>';
  h += '</div>';
  return h;
}

function ktSubmitLeave() {
  var date = $('lv-date').value;
  var type = $('lv-type').value;
  var hours = +($('lv-hours') ? $('lv-hours').value : 0);
  if (!date) { ktToast('取得する日を選んでください', true); return; }

  var days = ktRequestDays({ LeaveType: type, Hours: hours }, KT.emp);

  if (type === '代休') {
    var cs = ktCompFor(KT.emp);
    var pendComp = ktMyRequests().filter(function (r) {
      return r.Status === '申請中' && r.LeaveType === '代休';
    }).reduce(function (a, r) { return a + (+r.Days || 1); }, 0);
    if (days > cs.balanceDays - pendComp + 1e-9) {
      ktToast('代休の残がありません（残 ' + cs.balanceDays + '日・申請中 ' + pendComp + '日）', true);
      return;
    }
  } else {
    var st = ktLeaveState(KT.emp, ktMyGrants(), ktMyRequests(), ktToday());
    if (days > st.balanceDays - st.pendingDays + 1e-9) {
      ktToast('有給の残日数が足りません（残 ' + st.balanceDays + '日・申請中 ' + st.pendingDays + '日）', true);
      return;
    }
  }
  var fields = {
    Title:     KT.emp.Title + '_' + date,
    EmpNo:     KT.emp.Title,
    LeaveDate: date,
    LeaveType: type,
    Days:      days,
    Status:    '申請中',
    Reason:    $('lv-note').value || ''
  };
  if (type === '時間単位') fields.Hours = hours;

  ktCreate('requests', fields).then(function () {
    ktToast('申請しました');
    return ktLoadLeave();
  }).then(ktRender).catch(function (e) { ktToast('申請に失敗しました：' + e.message, true); });
}

/* ── 画面：管理 ────────────────────────────────────────── */

function ktViewAdmin() {
  var h = '';

  // 日次一覧
  h += '<div class="card"><h2>日ごとの一覧</h2>';
  h += '<label class="f" for="ad-date">日付</label><input type="date" id="ad-date" value="' + KT.adminDate + '">';
  h += '<div class="tw"><table><thead><tr><th>社員</th><th>出勤</th><th>退勤</th><th>休憩</th>' +
       '<th>労働</th><th>時間外</th><th>出勤場所</th><th>退勤場所</th><th></th></tr></thead><tbody>';
  var actives = KT.employees.filter(function (e) { return e.Active !== false; });
  actives.forEach(function (e) {
    var ps = ktActive(KT.punches.filter(function (p) {
      return p.Title === e.Title && p.WorkDate === KT.adminDate;
    })).sort(function (a, b) { return new Date(a._time) - new Date(b._time); });
    var d = ktComputeDay(KT.adminDate, ps, KT.holidays, KT.adminDate === ktWorkDateNow());
    var ins  = ps.filter(function (p) { return p.PunchType === '出勤'; })[0];
    var outs = ps.filter(function (p) { return p.PunchType === '退勤'; });
    var out  = outs[outs.length - 1];
    h += '<tr class="' + (d.review ? 'rev' : '') + '">';
    h += '<td>' + ktEsc(e.EmpName || e.Title) + '</td>';
    h += '<td class="n">' + (d.clockIn ? ktHm(d.clockIn) : '—') + '</td>';
    h += '<td class="n">' + (d.clockOut ? ktHm(d.clockOut) : '—') + '</td>';
    h += '<td class="n">' + (d.breakMin || 0) + '</td>';
    h += '<td class="n">' + (d.workMin ? ktMinToHm(d.workMin) : '—') + '</td>';
    h += '<td class="n">' + ((d.dailyOtMin + d.weeklyOtMin) ? ktMinToHm(d.dailyOtMin + d.weeklyOtMin) : '—') + '</td>';
    h += '<td>' + ktEsc(ins ? (ins.SiteName || '') : '') + '</td>';
    h += '<td>' + ktEsc(out ? (out.SiteName || '') : '') + '</td>';
    var al = ktFilterAlerts(d.alerts, e);
    var mk = d.punches.some(function (p) { return p._manual; })
      ? '<span class="badge cau">手入力</span> ' : '';
    h += '<td>' + mk + (al.length ? '<span class="badge no" title="' + ktEsc(al.join('／')) + '">!</span>' : '') + '</td>';
    h += '</tr>';
  });
  h += '</tbody></table></div></div>';

  // その日の打刻を1件ずつ取り消す（誤って押した打刻の後始末）
  var dayPs = KT.punches.filter(function (p) { return p.WorkDate === KT.adminDate; })
    .sort(function (a, b) { return new Date(a._time) - new Date(b._time); });
  h += '<div class="card"><h2>' + ktEsc(ktYmdLabel(KT.adminDate)) +
       ' の打刻（1件ずつ取り消せます）</h2><div class="tw"><table><thead><tr>' +
       '<th>社員</th><th>種別</th><th>時刻</th><th>場所</th><th>状態</th><th></th></tr></thead><tbody>';
  if (!dayPs.length) h += '<tr><td colspan="6" class="muted">打刻がありません</td></tr>';
  dayPs.forEach(function (p) {
    var mark = p.Voided === true    ? '<span class="badge cau">取消済</span>'
             : p.CancelPending      ? '<span class="badge no">取消申請中</span>'
             : p._manual            ? '<span class="badge cau">手入力</span>' : '';
    h += '<tr class="' + (p.Voided === true ? 'hol' : '') + '">';
    h += '<td>' + ktEsc((ktEmpOf(p.Title).EmpName) || p.Title) + '</td>';
    h += '<td>' + ktEsc(p.PunchType) + '</td>';
    h += '<td class="n">' + ktHm(p._time) + '</td>';
    h += '<td>' + ktEsc(p.SiteName || '') + '</td>';
    h += '<td>' + mark + (p.Voided === true && p.VoidReason
          ? ' <span class="muted">' + ktEsc(p.VoidReason) + '</span>' : '') + '</td>';
    h += '<td>' + (p.Voided === true ? '' :
         '<button class="btn ghost" data-void="' + p._id +
         '" style="padding:.2rem .5rem;font-size:.75rem">取消</button>') + '</td></tr>';
  });
  h += '</tbody></table></div>';
  h += '<p class="muted" style="margin-top:.5rem">取り消しても行は消えません。' +
       '「取消済」として残り、集計から外れるだけです。</p></div>';

  // 要確認の打刻（本人からの取消申請もここに並ぶ）
  var review = KT.punches.filter(function (p) { return p.NeedsReview && p.Voided !== true; })
    .concat(KT.cancels.filter(function (p) { return p.NeedsReview; }))
    .sort(function (a, b) { return new Date(b._time) - new Date(a._time); }).slice(0, 40);
  h += '<div class="card"><h2>要確認の打刻（' + review.length + '件）</h2><div class="tw"><table><thead><tr>' +
       '<th>日時</th><th>社員</th><th>種別</th><th>場所</th><th>理由</th><th></th></tr></thead><tbody>';
  if (!review.length) h += '<tr><td colspan="6" class="muted">ありません</td></tr>';
  review.forEach(function (p) {
    var isCan = p.LocationStatus === KT_CANCEL_STATUS;
    h += '<tr><td>' + ktEsc(ktYmdLabel(p.WorkDate)) + ' ' + ktHm(p._time) + '</td>';
    h += '<td>' + ktEsc((ktEmpOf(p.Title).EmpName) || p.Title) + '</td>';
    h += '<td>' + ktEsc(p.PunchType) +
         (isCan ? ' <span class="badge no">取消申請</span>'
          : p.LocationStatus === KT_FIX_STATUS ? ' <span class="badge no">申請</span>'
          : p._manual ? ' <span class="badge cau">手入力</span>' : '') +
         (p.ManualTime ? '<br><span class="muted">' + ktEsc(String(p.ManualTime).replace('T', ' ')) + '</span>' : '') +
         '</td>';
    h += '<td>' + ktEsc(p.SiteName || '') +
         (p.Lat != null ? ' <a href="https://www.google.com/maps?q=' + p.Lat + ',' + p.Lon +
                          '" target="_blank" rel="noopener">地図</a>' : '') + '</td>';
    h += '<td style="white-space:normal;min-width:11rem">' +
         ktEsc((p.ReviewReasons || []).join('／')) + '</td>';
    h += '<td>' + (isCan
      ? '<button class="btn" data-canok="' + p._id + '" style="padding:.2rem .5rem;font-size:.75rem">取消を実行</button> ' +
        '<button class="btn ghost" data-canng="' + p._id + '" style="padding:.2rem .5rem;font-size:.75rem">却下</button>'
      : '<button class="btn ghost" data-ok="' + p._id + '" style="padding:.2rem .5rem;font-size:.75rem">確認済</button> ' +
        '<button class="btn ghost" data-void="' + p._id + '" style="padding:.2rem .5rem;font-size:.75rem">取消</button>') +
      '</td></tr>';
  });
  h += '</tbody></table></div></div>';

  // 月次集計
  h += '<div class="card"><h2>月次集計</h2>';
  h += '<div class="btnrow" style="margin:0 0 .6rem;align-items:center">';
  h += '<button class="btn ghost" id="ad-prev">前月</button>';
  h += '<span style="flex:1;text-align:center;font-weight:700">' + ktEsc(KT.adminYm) + '</span>';
  h += '<button class="btn ghost" id="ad-next">翌月</button></div>';
  h += '<div class="tw"><table><thead><tr><th>社員</th><th>勤務</th><th>時間外</th><th>60h超</th>' +
       '<th>深夜</th><th>法定休日</th><th>出勤</th></tr></thead><tbody>';
  var mr = ktMonthRange(KT.adminYm);
  actives.forEach(function (e) {
    var ps = KT.punches.filter(function (p) { return p.Title === e.Title; });
    var s = ktSummarize(ktComputeRange(mr.from, mr.to, ps, KT.holidays, ktWorkDateNow()));
    h += '<tr><td>' + ktEsc(e.EmpName || e.Title) + '</td>';
    h += '<td class="n">' + ktMinToHm(s.workMin) + '</td><td class="n">' + ktMinToHm(s.otMin) + '</td>';
    h += '<td class="n">' + (s.ot60Min ? ktMinToHm(s.ot60Min) : '—') + '</td>';
    h += '<td class="n">' + ktMinToHm(s.nightMin) + '</td><td class="n">' + ktMinToHm(s.legalHolidayMin) + '</td>';
    h += '<td class="n">' + s.workDays + '日</td></tr>';
  });
  h += '</tbody></table></div>';
  h += '<div class="btnrow"><button class="btn" id="ad-csv">CSVを書き出す</button>' +
       '<button class="btn ghost" id="ad-import">過去の勤怠を入力する</button>' +
       '<button class="btn ghost" id="ad-holidays">会社の休日を設定する</button>' +
       '<button class="btn ghost" id="ad-leaveinit">移行前の有給を登録する</button></div>';
  h += '</div>';

  // 有給の承認
  var pend = KT.requests.filter(function (r) { return r.Status === '申請中'; })
    .sort(function (a, b) { return ktYmdDiffDays(a.LeaveDate, b.LeaveDate); });
  h += '<div class="card"><h2>有給の承認待ち（' + pend.length + '件）</h2><div class="tw"><table><thead><tr>' +
       '<th>社員</th><th>取得日</th><th>種別</th><th>日数</th><th></th></tr></thead><tbody>';
  if (!pend.length) h += '<tr><td colspan="5" class="muted">ありません</td></tr>';
  pend.forEach(function (r) {
    h += '<tr><td>' + ktEsc((ktEmpOf(r.EmpNo).EmpName) || r.EmpNo) + '</td>';
    h += '<td>' + ktEsc(ktYmdLabel(r.LeaveDate)) + '</td><td>' + ktEsc(r.LeaveType || '') + '</td>';
    h += '<td class="n">' + ktRequestDays(r, ktEmpOf(r.EmpNo)) + '</td>';
    h += '<td><button class="btn" data-approve="' + r._id + '" style="padding:.2rem .55rem;font-size:.75rem">承認</button> ' +
         '<button class="btn ghost" data-reject="' + r._id + '" style="padding:.2rem .55rem;font-size:.75rem">却下</button></td></tr>';
  });
  h += '</tbody></table></div></div>';

  // 代休の状況
  h += '<div class="card"><h2>代休の状況</h2>';
  h += '<div class="tw"><table><thead><tr><th>社員</th><th>発生</th><th>取得</th><th>残</th>' +
       '<th>期限切れ</th><th>次の期限</th></tr></thead><tbody>';
  var anyComp = false;
  actives.forEach(function (e) {
    var cs = ktCompFor(e);
    if (!cs || (!cs.earnedDays && !cs.takenDays)) return;
    anyComp = true;
    var soon = cs.expiringSoon.length;
    h += '<tr><td>' + ktEsc(e.EmpName || e.Title) + '</td>';
    h += '<td class="n">' + cs.earnedDays + '</td>';
    h += '<td class="n">' + cs.takenDays + '</td>';
    h += '<td class="n">' + cs.balanceDays + '</td>';
    h += '<td class="n">' + (cs.expiredDays || '—') + '</td>';
    h += '<td>' + (cs.nextExpire
      ? ktEsc(cs.nextExpire.expireDate) + (soon ? ' <span class="badge no">間近</span>' : '')
      : '—') + '</td></tr>';
  });
  if (!anyComp) h += '<tr><td colspan="6" class="muted">休日出勤の記録がありません</td></tr>';
  h += '</tbody></table></div>';
  h += '<p class="muted" style="margin-top:.5rem">代休を取得しても、休日出勤の割増賃金' +
       '（法定休日35%／所定休日は週40時間超で25%）は別途支払いが必要です。' +
       '事前に休日と労働日を入れ替える「振替休日」にすれば割増は不要になります。</p>';
  h += '</div>';

  // 有給の状況
  h += '<div class="card"><h2>有給の状況と年5日義務</h2><div class="tw"><table><thead><tr>' +
       '<th>社員</th><th>残</th><th>次の失効</th><th>義務の期限</th><th>取得</th><th>状態</th></tr></thead><tbody>';
  actives.forEach(function (e) {
    var gs = KT.grants.filter(function (g) { return g.EmpNo === e.Title; });
    var rs = KT.requests.filter(function (r) { return r.EmpNo === e.Title; });
    if (!ktLeaveTarget(e)) {
      h += '<tr><td>' + ktEsc(e.EmpName || e.Title) + '</td>' +
           '<td colspan="5" class="muted">' + ktEsc(ktLeaveOffReason(e)) + '</td></tr>';
      return;
    }
    var s = ktLeaveState(e, gs, rs, ktToday());
    var ob = s.obligation;
    var bcls = !ob ? '' : ob.level === 'done' ? 'ok' : ob.level === 'urgent' ? 'no' : 'cau';
    var btxt = !ob ? '対象外' : ob.level === 'done' ? '達成' : 'あと' + ob.remain + '日';
    h += '<tr><td>' + ktEsc(e.EmpName || e.Title) + '</td>';
    h += '<td class="n">' + s.balanceDays + '</td>';
    h += '<td>' + ktEsc(s.nextExpire ? s.nextExpire.expireDate : '—') + '</td>';
    h += '<td>' + ktEsc(ob ? ob.to : '—') + '</td>';
    h += '<td class="n">' + (ob ? ob.taken : '—') + '</td>';
    h += '<td>' + (bcls ? '<span class="badge ' + bcls + '">' + btxt + '</span>' : btxt) + '</td></tr>';
  });
  h += '</tbody></table></div></div>';

  return h;
}

/* CSV（給与ソフト取り込み用） */
function ktExportCsv() {
  var mr = ktMonthRange(KT.adminYm);
  var rows = [['社員番号', '氏名', '日付', '曜日', '日区分', '出勤', '退勤', '休憩分',
               '労働分', '法定内分', '時間外分', '深夜分', '法定休日分', '出勤場所', '退勤場所',
               '手入力', '代休発生', '備考']];
  KT.employees.filter(function (e) { return e.Active !== false; }).forEach(function (e) {
    var ps = KT.punches.filter(function (p) { return p.Title === e.Title; });
    var rangeDays = ktComputeRange(mr.from, mr.to, ps, KT.holidays, ktWorkDateNow());
    var comp = {};
    ktCompEarned(rangeDays).forEach(function (c) { comp[c.date] = c.days; });
    rangeDays.forEach(function (d) {
      if (!d.punches.length) return;
      var ins  = d.punches.filter(function (p) { return p.PunchType === '出勤'; })[0];
      var outs = d.punches.filter(function (p) { return p.PunchType === '退勤'; });
      var out  = outs[outs.length - 1];
      rows.push([
        e.Title, e.EmpName || '', d.date, KT_WD[ktYmdWeekday(d.date)], d.kindLabel,
        d.clockIn ? ktHm(d.clockIn) : '', d.clockOut ? ktHm(d.clockOut) : '',
        d.breakMin, d.workMin, d.innerMin, d.dailyOtMin + d.weeklyOtMin,
        d.nightMin, d.legalHolidayMin,
        ins ? (ins.SiteName || '') : '', out ? (out.SiteName || '') : '',
        d.punches.some(function (p) { return p._manual; }) ? '手入力' : '',
        (comp[d.date] || ''),
        ktFilterAlerts(d.alerts, e).join('／')
      ]);
    });
  });
  var csv = rows.map(function (r) {
    return r.map(function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(',');
  }).join('\r\n');

  // Excel が文字化けしないよう BOM を付ける
  var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '勤怠_' + KT.adminYm + '.csv';
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
}

/* ── 描画と操作の割り当て ──────────────────────────────── */

function ktRender() {
  $('ver').textContent = KINTAI_VERSION;
  $('hd-who').textContent = KT.emp ? (KT.emp.EmpName || KT.emp.Title) : ktUserName();

  var adminTab = document.querySelector('[data-tab="admin"]');
  adminTab.classList.toggle('hide', !KT.isAdmin);

  // 管理の表は列が多いので、その画面のときだけ横幅を広げる
  var wrap = document.querySelector('main.wrap');
  if (wrap) wrap.classList.toggle('wide', KT.tab === 'admin');

  ['punch', 'hist', 'leave', 'admin'].forEach(function (t) {
    $('v-' + t).classList.toggle('hide', KT.tab !== t);
  });
  document.querySelectorAll('#tabs button').forEach(function (b) {
    if (KT.tab === b.dataset.tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });

  if (KT.tab === 'punch') $('v-punch').innerHTML = ktViewPunch();
  if (KT.tab === 'hist')  $('v-hist').innerHTML  = ktViewHist();
  if (KT.tab === 'leave') $('v-leave').innerHTML = ktViewLeave();
  if (KT.tab === 'admin') $('v-admin').innerHTML = KT.isAdmin ? ktViewAdmin() : '';

  ktBind();
}

function ktBind() {
  document.querySelectorAll('[data-punch]').forEach(function (b) {
    b.onclick = function () {
      b.disabled = true;
      setTimeout(function () { ktRender(); }, KT_PUNCH.lockMs);
      ktPunch(b.dataset.punch);
    };
  });

  if ($('tg-break')) $('tg-break').onclick = function () {
    KT.showBreak = !KT.showBreak; ktRender();
  };
  if ($('tg-fix')) $('tg-fix').onclick = function () {
    KT.showFix = !KT.showFix; ktRender();
  };
  if ($('fx-send')) $('fx-send').onclick = ktSubmitFix;
  if ($('fx-vdate')) $('fx-vdate').onchange = function () { KT.fixDate = this.value; ktRender(); };

  document.querySelectorAll('[data-reqvoid]').forEach(function (b) {
    b.onclick = function () { ktRequestVoid(b.dataset.reqvoid); };
  });
  document.querySelectorAll('[data-canok]').forEach(function (b) {
    b.onclick = function () { ktApplyCancel(b.dataset.canok); };
  });
  document.querySelectorAll('[data-canng]').forEach(function (b) {
    b.onclick = function () { ktRejectCancel(b.dataset.canng); };
  });

  if ($('hist-prev')) $('hist-prev').onclick = function () { KT.histYm = ktYm(ktYmdAddMonths(KT.histYm + '-01', -1)); ktRender(); };
  if ($('hist-next')) $('hist-next').onclick = function () { KT.histYm = ktYm(ktYmdAddMonths(KT.histYm + '-01',  1)); ktRender(); };
  if ($('ad-prev'))   $('ad-prev').onclick   = function () { KT.adminYm = ktYm(ktYmdAddMonths(KT.adminYm + '-01', -1)); ktRender(); };
  if ($('ad-next'))   $('ad-next').onclick   = function () { KT.adminYm = ktYm(ktYmdAddMonths(KT.adminYm + '-01',  1)); ktRender(); };
  if ($('ad-date'))   $('ad-date').onchange  = function () { KT.adminDate = this.value; ktRender(); };
  if ($('ad-csv'))    $('ad-csv').onclick    = ktExportCsv;
  if ($('ad-import')) $('ad-import').onclick = function () { location.href = './import.html'; };
  if ($('ad-holidays')) $('ad-holidays').onclick = function () { location.href = './holidays.html'; };
  if ($('ad-leaveinit')) $('ad-leaveinit').onclick = function () { location.href = './leaveinit.html'; };

  if ($('lv-type')) {
    $('lv-type').onchange = function () {
      $('lv-hours-wrap').classList.toggle('hide', this.value !== '時間単位');
    };
  }
  if ($('lv-submit')) $('lv-submit').onclick = ktSubmitLeave;

  document.querySelectorAll('[data-cancel]').forEach(function (b) {
    b.onclick = function () {
      ktUpdate('requests', b.dataset.cancel, { Status: '取消' })
        .then(ktLoadLeave).then(ktRender)
        .catch(function (e) { ktToast('取消に失敗しました：' + e.message, true); });
    };
  });
  document.querySelectorAll('[data-approve]').forEach(function (b) {
    b.onclick = function () { ktDecide(b.dataset.approve, '承認'); };
  });
  document.querySelectorAll('[data-reject]').forEach(function (b) {
    b.onclick = function () { ktDecide(b.dataset.reject, '却下'); };
  });
  document.querySelectorAll('[data-void]').forEach(function (b) {
    b.onclick = function () {
      if (!window.confirm('この打刻を取り消します。よろしいですか？')) return;
      ktUpdate('punches', b.dataset.void, { Voided: true, VoidReason: '管理者が取消' })
        .then(ktLoadPunches).then(ktRender)
        .catch(function (e) { ktToast('取消に失敗しました：' + e.message, true); });
    };
  });
  document.querySelectorAll('[data-ok]').forEach(function (b) {
    b.onclick = function () {
      ktUpdate('punches', b.dataset.ok, { Reviewed: true })
        .then(ktLoadPunches).then(ktRender)
        .catch(function (e) { ktToast('更新に失敗しました：' + e.message, true); });
    };
  });
}

/* 取消申請を認める。対象の打刻に Voided を立て、申請の行を処理済みにする。
   どちらの行も消さないので、押した記録と取り消した記録が両方残る。 */
function ktApplyCancel(reqId) {
  var c = KT.cancels.filter(function (x) { return x._id === reqId; })[0];
  if (!c) return;
  // 対象が実在するときだけ書き換える。見つからない申請は処理済みにするだけ。
  var tid = ktCancelTargetId(c);
  if (tid && !KT.punches.some(function (p) { return p._id === tid; })) tid = '';
  var who = (ktEmpOf(c.Title).EmpName) || c.Title;
  if (!window.confirm(who + 'さんの ' + ktYmdLabel(c.WorkDate) + ' ' + ktHm(c._time) +
                      ' の「' + c.PunchType + '」を取り消します。よろしいですか？')) return;

  var why = ktCancelReason(c);
  var first = tid
    ? ktUpdate('punches', tid, {
        Voided: true,
        VoidReason: '本人の申請により取消' + (why ? '（' + why + '）' : '')
      })
    : Promise.resolve();

  first.then(function () { return ktUpdate('punches', reqId, { Reviewed: true }); })
    .then(ktLoadPunches).then(ktRender)
    .then(function () {
      ktToast(tid ? '取り消しました' : '対象の打刻が見つかりませんでした');
    })
    .catch(function (e) { ktToast('取消に失敗しました：' + e.message, true); });
}

/* 取消申請を認めない。対象の打刻はそのまま残る。 */
function ktRejectCancel(reqId) {
  ktUpdate('punches', reqId, { Reviewed: true, VoidReason: '取消申請を却下' })
    .then(ktLoadPunches).then(ktRender)
    .then(function () { ktToast('却下しました'); })
    .catch(function (e) { ktToast('更新に失敗しました：' + e.message, true); });
}

function ktDecide(id, status) {
  ktUpdate('requests', id, {
    Status: status,
    ApprovedBy: KT.emp ? (KT.emp.EmpName || KT.emp.Title) : ktUserName(),
    ApprovedDate: ktToday()
  }).then(ktLoadLeave).then(ktRender)
    .then(function () { ktToast(status + 'しました'); })
    .catch(function (e) { ktToast('更新に失敗しました：' + e.message, true); });
}

/* ── 起動 ──────────────────────────────────────────────── */

function ktStart() {
  $('login').classList.add('hide');
  ktLoadMasters().then(function () {
    if (!KT.emp) {
      $('app').classList.remove('hide');
      $('v-punch').innerHTML =
        '<div class="card"><div class="alert">社員マスタ（' + KT_LIST.employees + '）に ' +
        ktEsc(ktUserName()) + ' の登録がありません。管理者に登録を依頼してください。</div></div>';
      return;
    }
    return ktQueueFlush()
      .then(function () { return Promise.all([ktLoadPunches(), ktLoadLeave()]); })
      .then(function () {
        // 位置情報について一度も回答していなければ説明画面を出す
        if (KT.consent === null) {
          $('consent-screen').classList.remove('hide');
          return;
        }
        $('app').classList.remove('hide');
        ktRender();
      });
  }).catch(function (e) {
    $('login').classList.remove('hide');
    $('login-err').textContent = '読み込みに失敗しました：' + e.message;
    $('login-err').classList.remove('hide');
  });
}

/* 同意も打刻ログに1行として残す（サーバ時刻と本人が自動で記録される） */
function ktSaveConsent(agreed) {
  $('consent-ok').disabled = true;
  $('consent-skip').disabled = true;

  ktCreate('punches', {
    Title:      KT.emp.Title,
    PunchType:  agreed ? '位置情報同意' : '位置情報不同意',
    WorkDate:   ktToday(),
    ClientTime: new Date().toISOString(),
    UserAgent:  (navigator.userAgent || '').slice(0, 250)
  }).then(function () {
    KT.consent = agreed;
    $('consent-screen').classList.add('hide');
    $('app').classList.remove('hide');
    if (agreed && navigator.geolocation) {
      // ここでブラウザの許可ダイアログが一度だけ出る。以降は打刻時に自動で取得される。
      navigator.geolocation.getCurrentPosition(function () {}, function () {}, { timeout: 10000 });
    }
    return ktReload();
  }).catch(function (e) {
    $('consent-ok').disabled = false;
    $('consent-skip').disabled = false;
    ktToast('記録に失敗しました：' + e.message, true);
  });
}

document.addEventListener('DOMContentLoaded', function () {
  $('ver').textContent = KINTAI_VERSION;

  $('login-btn').onclick   = ktLogin;
  $('hd-logout').onclick   = ktLogout;
  $('hd-reload').onclick   = function () { ktToast('読み込み中…'); ktReload(); };
  $('consent-ok').onclick  = function () { ktSaveConsent(true); };
  $('consent-skip').onclick = function () { ktSaveConsent(false); };

  document.querySelectorAll('#tabs button').forEach(function (b) {
    b.onclick = function () { KT.tab = b.dataset.tab; ktRender(); };
  });

  window.addEventListener('online', function () {
    ktQueueFlush().then(function (n) { if (n) { ktToast(n + '件の打刻を送信しました'); ktReload(); } });
  });

  ktInitAuth(ktStart, function () {
    $('login').classList.remove('hide');
  }, function (e) {
    $('login-err').textContent = 'ログインエラー：' + e.message;
    $('login-err').classList.remove('hide');
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(function () {});
  }
});

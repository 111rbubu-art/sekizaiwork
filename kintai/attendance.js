/* ============================================================
   勤怠管理 — 労働時間の計算

   打刻ログから日ごとの労働時間・残業・深夜・休日労働を組み立てる。
   時刻は必ず打刻ログの _createdAt（SharePoint がサーバ側で付けた時刻）を
   使う。端末が送ってきた時刻は照合にのみ用いる。

   丸めは行わず 1分単位で計算する。日々の切り捨ては労基法違反にあたる。
   ============================================================ */

/* ── 区間の演算 ──────────────────────────────────────────── */

function ktOverlapMs(a1, a2, b1, b2) {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

/* base の各区間から cuts を差し引く */
function ktSubtractIntervals(base, cuts) {
  var out = base.slice();
  (cuts || []).forEach(function (c) {
    var next = [];
    out.forEach(function (b) {
      if (c[1] <= b[0] || c[0] >= b[1]) { next.push(b); return; }
      if (c[0] > b[0]) next.push([b[0], c[0]]);
      if (c[1] < b[1]) next.push([c[1], b[1]]);
    });
    out = next;
  });
  return out.filter(function (b) { return b[1] > b[0]; });
}

/* 区間に含まれる深夜（22:00〜翌5:00）の分数 */
function ktNightMinutes(intervals) {
  var total = 0;
  intervals.forEach(function (iv) {
    var day = ktYmd(new Date(iv[0]));
    var end = ktYmd(new Date(iv[1]));
    // 区間がまたぐ日をすべて走査する（深夜勤務は日をまたぐ）
    for (var guard = 0; guard < 4; guard++) {
      var mid = ktParseYmd(day).getTime();
      var a = mid + KT_WORK.nightEndHour * 3600000;                 // その日の 5:00
      var b = mid + KT_WORK.nightStartHour * 3600000;               // その日の 22:00
      total += ktOverlapMs(iv[0], iv[1], mid, a);                   // 0:00〜5:00
      total += ktOverlapMs(iv[0], iv[1], b, mid + 86400000);        // 22:00〜24:00
      if (day === end) break;
      day = ktYmdAddDays(day, 1);
    }
  });
  return Math.round(total / 60000);
}

/* ── 休日の判定 ──────────────────────────────────────────── */

/* 'legal'（法定休日・35%）／'company'（所定休日）／'' （平日） */
function ktDayKind(ymd, holidays) {
  var ov = (holidays || []).filter(function (h) { return h.HolidayDate === ymd; })[0];
  if (ov) {
    if (ov.HolidayType === '法定休日') return 'legal';
    if (ov.HolidayType === '平日')     return '';
    return 'company';
  }
  var w = ktYmdWeekday(ymd);
  if (w === KT_HOLIDAY.legalWeekday) return 'legal';
  if (KT_HOLIDAY.companyWeekdays.indexOf(w) >= 0) return 'company';
  if (KT_HOLIDAY.companyDays.indexOf(ktYmdDay(ymd)) >= 0) return 'company';
  return '';
}

function ktDayKindLabel(kind) {
  return kind === 'legal' ? '法定休日' : kind === 'company' ? '所定休日' : '平日';
}

/* ── 1日の集計 ──────────────────────────────────────────── */

/* punches … その勤務日の打刻（_createdAt 昇順）
   isOpen  … 今まさに勤務中の日。退勤がなくても打刻漏れとして扱わない */
function ktComputeDay(ymd, punches, holidays, isOpen) {
  var kind = ktDayKind(ymd, holidays);
  var d = {
    date: ymd, kind: kind, kindLabel: ktDayKindLabel(kind),
    punches: punches, clockIn: null, clockOut: null,
    breakMin: 0, workMin: 0, innerMin: 0, dailyOtMin: 0, weeklyOtMin: 0,
    nightMin: 0, legalHolidayMin: 0,
    attended: false, inProgress: false,
    alerts: [], review: false
  };
  if (!punches || !punches.length) return d;

  var ins    = punches.filter(function (p) { return p.PunchType === '出勤'; });
  var outs   = punches.filter(function (p) { return p.PunchType === '退勤'; });
  var bStart = punches.filter(function (p) { return p.PunchType === '休憩開始'; });
  var bEnd   = punches.filter(function (p) { return p.PunchType === '休憩終了'; });

  d.review = punches.some(function (p) { return p.NeedsReview === true; });

  // 出勤・退勤は揃っていなくても、打刻されている方は必ず表示できるようにする
  d.attended = ins.length > 0;
  if (ins.length)  d.clockIn  = ins[0]._createdAt;
  if (outs.length) d.clockOut = outs[outs.length - 1]._createdAt;

  // 片方だけ打刻されている日は打刻漏れ。両方ない日は単に出勤していない日なので警告しない。
  // 勤務中の日はまだ退勤していないだけなので警告しない。
  if (!ins.length && outs.length)  d.alerts.push('出勤の打刻がありません');
  if (ins.length  && !outs.length) {
    if (isOpen) d.inProgress = true;
    else        d.alerts.push('退勤の打刻がありません');
  }
  if (!ins.length || !outs.length) return d;

  var inMs  = new Date(d.clockIn).getTime();
  var outMs = new Date(d.clockOut).getTime();
  if (outMs <= inMs) { d.alerts.push('退勤が出勤より前になっています'); return d; }

  // 休憩の区間をつくる（開始と終了を順に対応させる）
  var breaks = [];
  var n = Math.min(bStart.length, bEnd.length);
  for (var i = 0; i < n; i++) {
    var s = new Date(bStart[i]._createdAt).getTime();
    var e = new Date(bEnd[i]._createdAt).getTime();
    if (e > s) breaks.push([s, e]);
  }
  if (bStart.length > bEnd.length) d.alerts.push('休憩終了の打刻がありません');

  var work = ktSubtractIntervals([[inMs, outMs]], breaks);
  d.workMin  = Math.round(work.reduce(function (a, iv) { return a + (iv[1] - iv[0]); }, 0) / 60000);
  d.breakMin = Math.round((outMs - inMs) / 60000) - d.workMin;
  d.nightMin = ktNightMinutes(work);

  // 休憩が足りているか（労基法34条）
  for (var r = 0; r < KT_WORK.breakRule.length; r++) {
    var rule = KT_WORK.breakRule[r];
    if (d.workMin > rule.overMin) {
      if (d.breakMin < rule.needMin) {
        d.alerts.push('休憩が' + rule.needMin + '分に足りません（' + d.breakMin + '分）');
      }
      break;
    }
  }

  if (kind === 'legal') {
    // 法定休日の労働はすべて35%。時間外の計算からは切り離す。
    d.legalHolidayMin = d.workMin;
    d.alerts.push('法定休日に労働しています');
  } else {
    d.dailyOtMin = Math.max(0, d.workMin - KT_WORK.dailyLegalMin);
    d.innerMin   = d.workMin - d.dailyOtMin;
    if (kind === 'company') d.alerts.push('所定休日に労働しています');
  }
  return d;
}

/* ── 打刻ログを勤務日ごとにまとめる ─────────────────────── */

function ktGroupByDate(punches) {
  var map = {};
  (punches || []).forEach(function (p) {
    if (p.Voided === true) return;               // 取り消された打刻は集計しない
    var k = p.WorkDate || ktYmd(p._createdAt);
    (map[k] = map[k] || []).push(p);
  });
  Object.keys(map).forEach(function (k) {
    map[k].sort(function (a, b) { return new Date(a._createdAt) - new Date(b._createdAt); });
  });
  return map;
}

/* 期間内の各日を計算し、週40時間超の時間外を上乗せする
   openDate … 今まさに勤務中の日（あれば） */
function ktComputeRange(from, to, punches, holidays, openDate) {
  var byDate = ktGroupByDate(punches);
  var days = [], d = from;
  for (var guard = 0; guard < 400 && ktYmdDiffDays(d, to) <= 0; guard++) {
    days.push(ktComputeDay(d, byDate[d] || [], holidays, d === openDate));
    d = ktYmdAddDays(d, 1);
  }

  // 週（日曜始まり）ごとに、法定内労働の累計が40時間を超えた分を時間外に振り替える
  var weeks = {};
  days.forEach(function (x) { (weeks[ktWeekStart(x.date)] = weeks[ktWeekStart(x.date)] || []).push(x); });
  Object.keys(weeks).forEach(function (w) {
    var acc = 0;
    weeks[w].forEach(function (x) {
      if (x.kind === 'legal') return;            // 法定休日労働は週40時間の計算に含めない
      var before = acc;
      acc += x.innerMin;
      if (acc > KT_WORK.weeklyLegalMin) {
        var over = acc - Math.max(before, KT_WORK.weeklyLegalMin);
        x.weeklyOtMin = Math.min(x.innerMin, over);
        x.innerMin   -= x.weeklyOtMin;
      }
    });
  });
  return days;
}

/* 月次の合計 */
function ktSummarize(days) {
  var s = {
    workMin: 0, innerMin: 0, otMin: 0, nightMin: 0, legalHolidayMin: 0,
    workDays: 0, legalHolidayDays: 0, companyHolidayDays: 0,
    reviewDays: 0, alertDays: 0, ot60Min: 0
  };
  days.forEach(function (d) {
    s.workMin         += d.workMin;
    s.innerMin        += d.innerMin;
    s.otMin           += d.dailyOtMin + d.weeklyOtMin;
    s.nightMin        += d.nightMin;
    s.legalHolidayMin += d.legalHolidayMin;
    // 出勤の打刻がある日を出勤日数に数える（勤務中でまだ退勤していない日も含める）
    if (d.attended) {
      s.workDays++;
      if (d.kind === 'legal')   s.legalHolidayDays++;
      if (d.kind === 'company') s.companyHolidayDays++;
    }
    if (d.review)        s.reviewDays++;
    if (d.alerts.length) s.alertDays++;
  });
  // 1か月60時間を超える法定時間外は割増50%
  s.ot60Min = Math.max(0, s.otMin - 60 * 60);
  return s;
}

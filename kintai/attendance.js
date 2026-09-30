/* ============================================================
   勤怠管理 — 労働時間の計算

   打刻ログから日ごとの労働時間・残業・深夜・休日労働を組み立てる。
   時刻は打刻ログの _time を使う。通常は SharePoint がサーバ側で付けた時刻、
   過去分の手入力や打刻漏れの訂正ではその手入力時刻になる。
   端末が送ってきた時刻は照合にのみ用いる。

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

/* 始業前の繰り上げ（v0.10.4）。平日で、始業の KT_WORK.earlyGraceMin 分前〜始業 の出勤なら、
   始業の時刻（ミリ秒）を返す。あてはまらなければ null。 */
function ktStartRound(ymd, inMs, kind, emp) {
  var g = +KT_WORK.earlyGraceMin || 0;
  if (!g || kind) return null;                               // 休日は 始業が無いので 繰り上げない
  var m = /^(\d{1,2}):(\d{2})/.exec(String((emp || {}).WorkStart || KT_WORK.defaultStart || '').trim());
  if (!m) return null;
  var base = ktParseYmd(ymd);
  if (!base) return null;
  var startMs = base.getTime() + ((+m[1]) * 60 + (+m[2])) * 60000;
  return (inMs >= startMs - g * 60000 && inMs < startMs) ? startMs : null;
}

function ktDayKindLabel(kind) {
  return kind === 'legal' ? '法定休日' : kind === 'company' ? '所定休日' : '平日';
}

/* ── 1日の集計 ──────────────────────────────────────────── */

/* その社員のみなし休憩（分）。社員マスタの BreakMin が優先。
   未設定なら KT_BREAK.defaultMin、0 が入っていればみなし休憩なし。 */
function ktBreakMinOf(emp) {
  var v = (emp || {}).BreakMin;
  if (v == null || v === '') return KT_BREAK.defaultMin;
  return Math.max(0, +v || 0);
}

/* punches … その勤務日の打刻（_time 昇順）
   isOpen  … 今まさに勤務中の日。退勤がなくても打刻漏れとして扱わない
   emp     … 社員（みなし休憩の分数を決めるのに使う。省略可） */
function ktComputeDay(ymd, punches, holidays, isOpen, emp) {
  var kind = ktDayKind(ymd, holidays);
  var d = {
    date: ymd, kind: kind, kindLabel: ktDayKindLabel(kind),
    punches: punches, clockIn: null, clockOut: null,
    breakMin: 0, workMin: 0, innerMin: 0, dailyOtMin: 0, weeklyOtMin: 0,
    nightMin: 0, legalHolidayMin: 0, deemedBreakMin: 0,
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
  if (ins.length)  d.clockIn  = ins[0]._time;
  if (outs.length) d.clockOut = outs[outs.length - 1]._time;

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
  // 始業前 15 分以内の出勤は 始業から数える（v0.10.4）。打刻そのものは そのまま残す
  var adj = ktStartRound(ymd, inMs, kind, emp);
  if (adj && adj < outMs) { inMs = adj; d.countFrom = new Date(adj).toISOString(); }
  if (outMs <= inMs) { d.alerts.push('退勤が出勤より前になっています'); return d; }

  // 休憩の区間をつくる（開始と終了を順に対応させる）
  var breaks = [];
  var n = Math.min(bStart.length, bEnd.length);
  for (var i = 0; i < n; i++) {
    var s = new Date(bStart[i]._time).getTime();
    var e = new Date(bEnd[i]._time).getTime();
    if (e > s) breaks.push([s, e]);
  }
  if (bStart.length > bEnd.length) d.alerts.push('休憩終了の打刻がありません');

  var work = ktSubtractIntervals([[inMs, outMs]], breaks);
  var spanMin = Math.round((outMs - inMs) / 60000);
  d.workMin  = Math.round(work.reduce(function (a, iv) { return a + (iv[1] - iv[0]); }, 0) / 60000);

  // 休憩の打刻が1つもない日は、所定の休憩を取ったものとして差し引く。
  // 休憩ボタンはふだん使わないので、これがないと休憩0分になってしまう。
  // 休憩の義務がない短い日（拘束6時間以下）には適用しない。
  if (!bStart.length && !bEnd.length) {
    var def = ktBreakMinOf(emp);
    if (def > 0 && spanMin > KT_BREAK.minSpanMin) {
      d.deemedBreakMin = Math.min(def, spanMin);
      d.workMin -= d.deemedBreakMin;
    }
  }

  d.breakMin = spanMin - d.workMin;
  // 深夜は打刻された区間から数える。みなし休憩は昼の想定なので差し引かない。
  d.nightMin = Math.min(d.workMin, ktNightMinutes(work));

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
    if (p.CancelPending === true) return;        // 本人が取消を申請中の打刻も外す
    var k = p.WorkDate || ktYmd(p._time);
    (map[k] = map[k] || []).push(p);
  });
  Object.keys(map).forEach(function (k) {
    map[k].sort(function (a, b) { return new Date(a._time) - new Date(b._time); });
  });
  return map;
}

/* 期間内の各日を計算し、週40時間超の時間外を上乗せする
   openDate … 今まさに勤務中の日（あれば）
   emp      … 社員（みなし休憩の分数を決めるのに使う。省略可） */
function ktComputeRange(from, to, punches, holidays, openDate, emp) {
  var byDate = ktGroupByDate(punches);
  var days = [], d = from;
  // guard は日付が壊れていたときの暴走止め。通常は to に達して抜ける。
  // 代休は期限を含めて1年以上さかのぼるので、月単位より広い範囲を許す。
  for (var guard = 0; guard < 3660 && ktYmdDiffDays(d, to) <= 0; guard++) {
    days.push(ktComputeDay(d, byDate[d] || [], holidays, d === openDate, emp));
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

/* 期間ちょうどの日々を返す。
   週40時間超の振り替えは週単位で決まるので、前後を週の切れ目まで広げて
   計算してから、期間の分だけ取り出す。こうしないと、給与期間のように
   月の途中で区切る場合に、境目の週の時間外がずれる。 */
function ktComputeRangeExact(from, to, punches, holidays, openDate, emp) {
  var wFrom = ktWeekStart(from);
  var wTo   = ktYmdAddDays(ktWeekStart(to), 6);
  return ktComputeRange(wFrom, wTo, punches, holidays, openDate, emp).filter(function (d) {
    return ktYmdDiffDays(d.date, from) >= 0 && ktYmdDiffDays(d.date, to) <= 0;
  });
}

/* ── 残業代の金額（v0.10.0）─────────────────────────────
   pay … KintaiPay の行 { MonthlySalary, MonthlyHours }
   s   … ktSummarize の結果
   単価 = 月給 ÷ 月平均所定労働時間。割増率は KT_RATE。
   時間外のうち月60時間を超えた分（ot60Min）は 1.50、残りは 1.25。
   深夜は 時間外・法定休日と重なっても +0.25 を上乗せする（労基法37条）。
   金額は種類ごとに円未満を切り上げる（KT_OTPAY.yenRound）。 */
function ktYen(v) {
  if (!(v > 0)) return 0;
  return (KT_OTPAY && KT_OTPAY.yenRound === 'ceil') ? Math.ceil(v - 1e-9) : Math.round(v);
}
function ktOtPay(s, pay, autoHours) {
  var sal = Number((pay || {}).MonthlySalary), hrs = Number((pay || {}).MonthlyHours);
  var auto = false;
  if (!(hrs > 0) && autoHours > 0) { hrs = autoHours; auto = true; }
  if (!(sal > 0) || !(hrs > 0)) return null;
  var unit = sal / hrs;
  var perMin = unit / 60;
  var ot60 = s.ot60Min || 0, ot = Math.max(0, (s.otMin || 0) - ot60);
  var r = {
    unit:     unit,
    ot:       ktYen(ot  * perMin * KT_RATE.overtime),
    ot60:     ktYen(ot60 * perMin * KT_RATE.overtime60),
    holiday:  ktYen((s.legalHolidayMin || 0) * perMin * KT_RATE.legalHoliday),
    night:    ktYen((s.nightMin || 0) * perMin * KT_RATE.nightAdd)
  };
  r.total = r.ot + r.ot60 + r.holiday + r.night;
  r.hours = hrs; r.hoursAuto = auto;
  return r;
}

/* ── 月平均所定労働時間を 休日から計算する（v0.10.1。本人「計算できませんか？」）──
   その年（1/1〜12/31）の日を1日ずつ見て、休日でない日（ktDayKind が ''）を所定労働日に数える。
   休日＝土日・毎月14日15日（config.js）＋ KintaiHolidays（正月・5月・夏 など、会社の休日の画面で登録したもの）。
   1日の所定 ＝ 社員マスタの 始業〜終業 − 休憩（無ければ 8時間）。
   月平均 ＝ 所定労働日数 × 1日の所定 ÷ 12。KintaiPay に MonthlyHours を入れた人はそちらが優先。 */
function ktDailySchedMin(emp) {
  var hm = function (v) {
    var m = /^(\d{1,2}):(\d{2})/.exec(String(v || '').trim());
    return m ? (+m[1]) * 60 + (+m[2]) : null;
  };
  var a = hm((emp || {}).WorkStart), b = hm((emp || {}).WorkEnd);
  if (a == null || b == null || b <= a) return KT_WORK.dailyLegalMin;
  return Math.min(KT_WORK.dailyLegalMin, Math.max(0, b - a - ktBreakMinOf(emp)));
}
function ktYearSched(year, holidays, emp) {
  var d = year + '-01-01', end = year + '-12-31';
  var work = 0, off = 0;
  while (d <= end) {
    if (ktDayKind(d, holidays)) off++; else work++;
    d = ktYmdAddDays(d, 1);
  }
  var reg = (holidays || []).filter(function (h) {
    return String(h.HolidayDate || '').slice(0, 4) === String(year) && h.HolidayType !== '平日';
  });
  // 正月・5月・夏の休みが 会社の休日リストに入っているか（入っていないと 所定日数が多すぎる）
  var has = function (mm) { return reg.some(function (h) { return String(h.HolidayDate).slice(5, 7) === mm; }); };
  var missing = [];
  if (!has('01')) missing.push('正月');
  if (!has('05')) missing.push('5月の連休');
  if (!has('08')) missing.push('夏休み');
  var dayMin = ktDailySchedMin(emp);
  return { year: year, workDays: work, offDays: off, regDays: reg.length, dayMin: dayMin,
           monthHours: work * dayMin / 60 / 12, missing: missing };
}

/* ── 納骨の手当（v0.10.0）──────────────────────────────
   納骨リストの行から、締め期間 from〜to に入る 納骨・納骨戒切・お骨だし を拾い、
   納骨担当（姓だけ・2人のこともある）を 社員マスタの正社員に当てる。
   返すもの：
     byEmp[社員番号] = { count, dates: ['YYYY-MM-DD', …] }
     skipped = [{ date, name, why }]   … 数えなかった名前（外注・役員・同じ姓が2人 など）
   名前の当て方：KintaiPay の NokotsuName があればそれ、無ければ 氏名の空白より前（姓）。
   氏名に空白が無いときは、担当の名前で始まるかで見る。 */
function ktNokDate(v) {
  var m = /(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/.exec(String(v || ''));
  return m ? m[1] + '-' + ktPad(+m[2]) + '-' + ktPad(+m[3]) : '';
}
function ktNokNames(v) {
  return String(v || '').split(/[、,，・･\/／\s　&＆+＋]+/).map(function (x) {
    return x.replace(/(様|さん|氏)$/, '').trim();
  }).filter(Boolean);
}
function ktNokotsuCount(items, employees, payRows, from, to, holidays) {
  var C = KT_NOKOTSU, byEmp = {}, skipped = [];
  var payBy = {};
  (payRows || []).forEach(function (p) { payBy[p.Title] = p; });
  var emps = (employees || []).map(function (e) {
    var nm = String(e.EmpName || '').trim();
    var alias = String((payBy[e.Title] || {}).NokotsuName || '').trim();
    var sp = nm.split(/[\s　]+/);
    return { e: e, key: alias || (sp.length > 1 ? sp[0] : ''), full: nm.replace(/[\s　]+/g, '') };
  });
  (items || []).forEach(function (it) {
    var kind = String(it[C.fKind] || '').trim();
    if (C.kinds.indexOf(kind) < 0) return;
    var d = ktNokDate(it[C.fDate]);
    if (!d || d < from || d > to) return;
    // 定休日（土日・14日15日・正月・5月・夏 など会社の休日）の納骨だけが手当の対象（本人の指示）
    var offDay = !!ktDayKind(d, holidays);
    ktNokNames(it[C.fPerson]).forEach(function (n) {
      var hit = emps.filter(function (x) {
        return x.key ? x.key === n : (x.full && x.full.indexOf(n) === 0);
      });
      if (!hit.length) { skipped.push({ date: d, name: n, why: '社員マスタに無い名前（外注先など）' }); return; }
      if (hit.length > 1) { skipped.push({ date: d, name: n, why: '同じ姓の社員が ' + hit.length + ' 人（KintaiPay の NokotsuName で分けてください）' }); return; }
      var e = hit[0].e;
      if (!offDay) { skipped.push({ date: d, name: n, why: '平日の納骨（定休日ではない）' }); return; }
      if (e.EmpType !== '正社員') { skipped.push({ date: d, name: n, why: (e.EmpType || '種別なし') + 'のため対象外' }); return; }
      var b = byEmp[e.Title] || (byEmp[e.Title] = { count: 0, dates: [] });
      b.count++; b.dates.push(d);
    });
  });
  Object.keys(byEmp).forEach(function (k) { byEmp[k].dates.sort(); });
  return { byEmp: byEmp, skipped: skipped };
}

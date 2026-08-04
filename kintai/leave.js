/* ============================================================
   勤怠管理 — 年次有給休暇（労働基準法39条）

   ・入社日から6か月後に初回付与、以降1年ごと
   ・出勤率が8割未満の年は付与なし
   ・付与日から2年で時効（労基法115条）
   ・消化は古い付与分から（FIFO）＝失効を減らし従業員に有利
   ・年10日以上付与された者は1年以内に5日取得させる義務（39条7項）
   ============================================================ */

/* 勤続インデックス（0 = 6か月、1 = 1年6か月 … 6以上 = 6年6か月以降） */
function ktYearsIndex(nth) { return Math.min(nth, KT_GRANT_FULL.length - 1); }

/* 付与日数を求める */
function ktGrantDays(nth, weeklyDays, weeklyHours, attendRate) {
  if (attendRate != null && attendRate < KT_LEAVE.minAttendRate) return 0;
  var i = ktYearsIndex(nth);
  var wd = +weeklyDays  || 5;
  var wh = +weeklyHours || 40;
  var isPro = wd <= 4 && wh < 30;               // 比例付与の対象か
  if (isPro) return (KT_GRANT_PRO[wd] || [])[i] || 0;
  return KT_GRANT_FULL[i];
}

/* 基準日（初回付与日）を求める */
function ktFirstGrantDate(emp) {
  var hire = emp.HireDate;
  if (!hire) return null;
  if (KT_LEAVE.baseDateMode === 'fixed') {
    // 全社統一の基準日。法定の付与日より前倒しはできても後ろ倒しはできない。
    var legal = ktYmdAddMonths(hire, 6);
    var y = +legal.split('-')[0];
    var cand = y + '-' + ktPad(KT_LEAVE.fixedBaseMonth) + '-' + ktPad(KT_LEAVE.fixedBaseDay);
    if (ktYmdDiffDays(cand, legal) > 0) cand = ktYmdAddYears(cand, -1);
    return cand;
  }
  return ktYmdAddMonths(hire, 6);               // 入社日基準
}

/* 今日までに発生している付与の一覧をつくる。
   grantRecords … 保存済みの付与レコード（出勤率や手修正がある場合はそれを優先） */
function ktBuildGrants(emp, grantRecords, today) {
  var first = ktFirstGrantDate(emp);
  if (!first) return [];
  var out = [];
  for (var nth = 0; nth < 60; nth++) {
    var gd = nth === 0 ? first : ktYmdAddYears(first, nth);
    if (ktYmdDiffDays(gd, today) > 0) break;    // 未来の付与は含めない
    var rec = (grantRecords || []).filter(function (r) { return r.GrantDate === gd; })[0];
    var rate = rec && rec.AttendRate != null ? (+rec.AttendRate) / 100 : null;
    out.push({
      nth:        nth,
      grantDate:  gd,
      expireDate: ktYmdAddYears(gd, KT_LEAVE.expireYears),
      days:       rec && rec.GrantDays != null
                    ? +rec.GrantDays
                    : ktGrantDays(nth, emp.WeeklyDays, emp.WeeklyHours, rate),
      attendRate: rate,
      recordId:   rec ? rec._id : null,
      used:       0,
      pending:    0
    });
  }
  return out;
}

/* 申請1件が何日分にあたるか */
function ktRequestDays(req, emp) {
  if (req.Days != null) return +req.Days;
  if (req.LeaveType === '全日') return 1;
  if (req.LeaveType === '午前半休' || req.LeaveType === '午後半休') return 0.5;
  if (req.LeaveType === '時間単位') {
    var per = (+emp.WeeklyHours || 40) / (+emp.WeeklyDays || 5);
    return per > 0 ? (+req.Hours || 0) / per : 0;
  }
  return 1;
}

/* 承認済みの取得を古い付与分から順に割り当てる */
function ktAllocate(grants, requests, emp) {
  var approved = (requests || [])
    .filter(function (r) { return r.Status === '承認'; })
    .sort(function (a, b) { return ktYmdDiffDays(a.LeaveDate, b.LeaveDate); });

  var short = [];
  approved.forEach(function (r) {
    var need = ktRequestDays(r, emp);
    var alive = grants.filter(function (g) {
      return ktYmdDiffDays(r.LeaveDate, g.grantDate) >= 0 &&
             ktYmdDiffDays(r.LeaveDate, g.expireDate) < 0;
    });                                          // ktBuildGrants は既に古い順
    r._alloc = [];
    for (var i = 0; i < alive.length && need > 1e-9; i++) {
      var g = alive[i];
      var avail = g.days - g.used;
      if (avail <= 0) continue;
      var use = Math.min(avail, need);
      g.used += use; need -= use;
      r._alloc.push({ grantDate: g.grantDate, days: use });
    }
    if (need > 1e-9) short.push({ req: r, shortDays: need });
  });

  (requests || []).filter(function (r) { return r.Status === '申請中'; })
    .forEach(function (r) {
      var d = ktRequestDays(r, emp);
      var alive = grants.filter(function (g) {
        return ktYmdDiffDays(r.LeaveDate, g.grantDate) >= 0 &&
               ktYmdDiffDays(r.LeaveDate, g.expireDate) < 0;
      });
      if (alive.length) alive[0].pending += d;
    });

  return short;
}

/* 年5日の取得義務（労基法39条7項）の状況
   ・付与日数10日以上の付与が対象
   ・時間単位の年休はこの5日には算入しない */
function ktObligation(grant, requests, emp, today) {
  if (grant.days < KT_LEAVE.obligationMinGrant) return null;
  var from = grant.grantDate;
  var to   = ktYmdAddYears(grant.grantDate, 1);
  var taken = 0;
  (requests || []).forEach(function (r) {
    if (r.Status !== '承認') return;
    if (r.LeaveType === '時間単位') return;      // 義務日数には算入しない
    if (ktYmdDiffDays(r.LeaveDate, from) < 0) return;
    if (ktYmdDiffDays(r.LeaveDate, to) >= 0) return;
    taken += ktRequestDays(r, emp);
  });

  var elapsedMonths = Math.floor(ktYmdDiffDays(today, from) / 30.44);
  var level = '';
  KT_LEAVE.alerts.forEach(function (a) {
    if (elapsedMonths >= a.afterMonth && taken < a.underDays) level = a.level;
  });
  if (taken >= KT_LEAVE.obligationDays) level = 'done';

  return {
    from: from, to: to, taken: taken,
    remain: Math.max(0, KT_LEAVE.obligationDays - taken),
    elapsedMonths: elapsedMonths,
    deadlineDays: ktYmdDiffDays(to, today),
    level: level
  };
}

/* 社員1名の有給の状態をまとめる */
function ktLeaveState(emp, grantRecords, requests, today) {
  var t = today || ktToday();
  var grants = ktBuildGrants(emp, grantRecords, t);
  var shortages = ktAllocate(grants, requests, emp);

  var alive = grants.filter(function (g) { return ktYmdDiffDays(t, g.expireDate) < 0; });
  var balance = alive.reduce(function (a, g) { return a + (g.days - g.used); }, 0);
  var pending = alive.reduce(function (a, g) { return a + g.pending; }, 0);
  var expired = grants.filter(function (g) { return ktYmdDiffDays(t, g.expireDate) >= 0; })
                      .reduce(function (a, g) { return a + Math.max(0, g.days - g.used); }, 0);

  // 現在の年度にあたる付与（いちばん新しいもの）
  var current = grants.length ? grants[grants.length - 1] : null;

  return {
    grants:      grants,
    alive:       alive,
    balanceDays: Math.round(balance * 10) / 10,
    pendingDays: Math.round(pending * 10) / 10,
    expiredDays: Math.round(expired * 10) / 10,
    nextExpire:  alive.length ? alive[0] : null,
    current:     current,
    obligation:  current ? ktObligation(current, requests, emp, t) : null,
    shortages:   shortages
  };
}

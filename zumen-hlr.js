// 投影・隠れ線（図面化と 組み立ての サムネで 共通。Three なし）
// ── 投影（[u,v,深さ]。深さ＝小さいほど 手前）。斜めは 左前の 上から（メーカー図と 同じ。軸の 長さ＝実長）──
var KR2 = Math.SQRT2, KR3 = Math.sqrt(3), KR6 = Math.sqrt(6), KISO = Math.sqrt(1.5);
var KPJ = {
  front:function(p){ return [p[0], p[1], -p[2]]; },
  top:function(p){ return [p[0], -p[2], -p[1]]; },
  topR:function(p){ return [-p[2], p[0], -p[1]]; },
  right:function(p){ return [-p[2], p[1], -p[0]]; },
  left:function(p){ return [p[2], p[1], p[0]]; },
  back:function(p){ return [-p[0], p[1], p[2]]; },
  bottom:function(p){ return [p[0], p[2], p[1]]; },
  iso:function(p){ return [(p[0] + p[2]) / KR2 * KISO, (p[0] + 2 * p[1] - p[2]) / KR6 * KISO, -(-p[0] + p[1] + p[2]) / KR3]; }
};
// 平らな 大きい 面の 縁（R 面取りの 始まりの 線 など。CSG の T 字の つなぎが あっても 線の 上の 重なりで 見る）。
function kmTan(tr){
  var n = tr.length / 9, bx = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity], i;
  for (i = 0; i < tr.length; i += 3) { bx[0] = Math.min(bx[0], tr[i]); bx[1] = Math.max(bx[1], tr[i]); bx[2] = Math.min(bx[2], tr[i + 1]); bx[3] = Math.max(bx[3], tr[i + 1]); bx[4] = Math.min(bx[4], tr[i + 2]); bx[5] = Math.max(bx[5], tr[i + 2]); }
  var dx = bx[1] - bx[0], dy = bx[3] - bx[2], dz = bx[5] - bx[4], big = Math.max(dx * dy, dy * dz, dx * dz) * 0.03, TR = [], PA = {};
  for (var t = 0; t < n; t++) { i = t * 9; var a = [tr[i], tr[i + 1], tr[i + 2]], b = [tr[i + 3], tr[i + 4], tr[i + 5]], c = [tr[i + 6], tr[i + 7], tr[i + 8]];
    var u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], cr = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], L = Math.hypot(cr[0], cr[1], cr[2]); if (L < 1e-6) continue;
    var nn = [cr[0] / L, cr[1] / L, cr[2] / L], d = nn[0] * a[0] + nn[1] * a[1] + nn[2] * a[2], pk = nn.map(function(v){ return Math.round(v * 100); }).join(',') + '|' + Math.round(d);
    PA[pk] = (PA[pk] || 0) + L / 2; TR.push({ v:[a, b, c], n:nn, pk:pk }); }
  var LN = {};
  TR.forEach(function(T, ti){ for (var e = 0; e < 3; e++) { var p = T.v[e], q = T.v[(e + 1) % 3], v = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], l = Math.hypot(v[0], v[1], v[2]); if (l < 0.05) continue;
    var dv = [v[0] / l, v[1] / l, v[2] / l], sg = dv[0] < -1e-6 || (Math.abs(dv[0]) <= 1e-6 && (dv[1] < -1e-6 || (Math.abs(dv[1]) <= 1e-6 && dv[2] < 0))) ? -1 : 1; dv = dv.map(function(x){ return x * sg; });
    var tp = p[0] * dv[0] + p[1] * dv[1] + p[2] * dv[2], tq = q[0] * dv[0] + q[1] * dv[1] + q[2] * dv[2], c0 = [p[0] - dv[0] * tp, p[1] - dv[1] * tp, p[2] - dv[2] * tp];
    var key = dv.map(function(x){ return Math.round(x * 300); }).join(',') + '|' + c0.map(function(x){ return Math.round(x * 2); }).join(',');
    var o = LN[key] || (LN[key] = { dv:dv, c0:c0, iv:[] }); o.iv.push({ a:Math.min(tp, tq), b:Math.max(tp, tq), ti:ti }); } });
  var out = [], dot = function(x, y){ return x[0] * y[0] + x[1] * y[1] + x[2] * y[2]; }, K0 = Object.keys(LN).filter(function(key){ var o = LN[key]; return [0, 1, 2].filter(function(j){ return Math.abs(o.dv[j]) > 0.002; }).length === 1; }); // まっすぐ 軸の 向きの 線だけ
  // 本人の きまり：平らな 面 → 曲面 は 線を 入れる、曲面＋曲面 は 角度 しだい（角は featureEdges が 出す）。
  // 曲面の 1 枚（線に 直角の 向きの 幅が 形の 大きさの 8% 未満の 細い 面。水鉢の 胴の 帯など）の 縁は ここでは 出さない
  var lim = Math.max(dx, dy, dz) * 0.08, PV = {}, WC = {};
  TR.forEach(function(T){ (PV[T.pk] = PV[T.pk] || []).push(T.v[0], T.v[1], T.v[2]); });
  function narrow(pk, n, d){ var pp = [n[1] * d[2] - n[2] * d[1], n[2] * d[0] - n[0] * d[2], n[0] * d[1] - n[1] * d[0]], l = Math.hypot(pp[0], pp[1], pp[2]); if (!(l > 1e-9)) return false;
    pp = [pp[0] / l, pp[1] / l, pp[2] / l]; var ck = pk + '#' + pp.map(function(x){ return Math.round(x * 50); }).join(','); if (WC[ck] !== undefined) return WC[ck];
    var lo = Infinity, hi = -Infinity; PV[pk].forEach(function(q){ var t = dot(q, pp); if (t < lo) lo = t; if (t > hi) hi = t; }); return WC[ck] = hi - lo < lim; }
  K0.forEach(function(key){ var o = LN[key];
    o.iv.forEach(function(I){ var T = TR[I.ti]; if ((PA[T.pk] || 0) < big || narrow(T.pk, T.n, o.dv)) return; var rest = [[I.a, I.b]];
      o.iv.forEach(function(J){ if (J.ti === I.ti || dot(TR[J.ti].n, T.n) < 0.9995) return; var nr = []; rest.forEach(function(K){ if (J.b <= K[0] + 0.05 || J.a >= K[1] - 0.05) { nr.push(K); return; } if (J.a > K[0]) nr.push([K[0], J.a]); if (J.b < K[1]) nr.push([J.b, K[1]]); }); rest = nr; });
      rest.forEach(function(K){ if (K[1] - K[0] > 0.3) out.push([o.c0.map(function(v, j){ return v + o.dv[j] * K[0]; }), o.c0.map(function(v, j){ return v + o.dv[j] * K[1]; })]); }); }); });
  return out;
}
// 隠れ線：items＝[{k, tris, edges, soft, tan, off}]、s＝縮尺（1/n）。答えの 線は 紙の mm（u 右・v 上）
function kmHlr(items, view, s, res){
  var Pf = KPJ[view], RES = res || 8, tr = [], ed = [];
  items.forEach(function(it){ var o = it.off || [0, 0, 0], i, j;
    function pj(p){ var q = Pf([p[0] + o[0], p[1] + o[1], p[2] + o[2]]); return [q[0] * s, q[1] * s, q[2]]; }
    for (i = 0; i < it.tris.length; i += 9) { var t = []; for (j = 0; j < 3; j++) t.push(pj([it.tris[i + j * 3], it.tris[i + j * 3 + 1], it.tris[i + j * 3 + 2]])); tr.push(t); }
    // 輪郭（曲面の 縁）：となりの 三角と 向き（手前／奥／横）が 変わる 辺。3D で 細い 三角は 見ない
    var E = {}, qk = function(a){ return Math.round(a[0] * 20) + ',' + Math.round(a[1] * 20) + ',' + Math.round(a[2] * 20); };
    for (i = 0; i < it.tris.length; i += 9) {
      var V = [0, 1, 2].map(function(jj){ return [it.tris[i + jj * 3], it.tris[i + jj * 3 + 1], it.tris[i + jj * 3 + 2]]; }), Q = V.map(function(p){ return Pf([p[0] + o[0], p[1] + o[1], p[2] + o[2]]); });
      var ar = (Q[1][0] - Q[0][0]) * (Q[2][1] - Q[0][1]) - (Q[1][1] - Q[0][1]) * (Q[2][0] - Q[0][0]);
      var e1 = [V[1][0] - V[0][0], V[1][1] - V[0][1], V[1][2] - V[0][2]], e2 = [V[2][0] - V[0][0], V[2][1] - V[0][1], V[2][2] - V[0][2]];
      var cr = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]), mx = Math.max(Math.hypot(e1[0], e1[1], e1[2]), Math.hypot(e2[0], e2[1], e2[2]), Math.hypot(e2[0] - e1[0], e2[1] - e1[1], e2[2] - e1[2]));
      var sg = cr / (mx * mx) < 0.02 ? null : Math.abs(ar) / cr < 0.03 ? 0 : Math.sign(ar);
      for (var e = 0; e < 3; e++) { var a = V[e], b = V[(e + 1) % 3], ka = qk(a), kb = qk(b); if (ka === kb) continue; var key = ka < kb ? ka + '|' + kb : kb + '|' + ka; if (E[key]) E[key].s.push(sg); else E[key] = { a:a, b:b, s:[sg] }; } }
    Object.keys(E).forEach(function(key){ var x = E[key]; if (x.s.length === 2 && x.s[0] !== null && x.s[1] !== null && (x.s[0] * x.s[1] < 0 || (x.s[0] === 0) !== (x.s[1] === 0))) ed.push({ a:pj(x.a), b:pj(x.b) }); });
    (it.tan || []).forEach(function(q){ ed.push({ a:pj(q[0]), b:pj(q[1]) }); });
    // なめらかな 辺（featureEdges が 線に しなかった もの）：この 向きで 片方の 面が 手前、もう 片方が 奥 向きなら 輪郭
    var sf = it.soft || [], fz = function(i){ return Pf([sf[i], sf[i + 1], sf[i + 2]])[2]; };
    for (i = 0; i + 11 < sf.length; i += 12) { var z1 = fz(i + 6), z2 = fz(i + 9); if ((z1 < -0.01 && z2 > 0.01) || (z2 < -0.01 && z1 > 0.01)) ed.push({ a:pj([sf[i], sf[i + 1], sf[i + 2]]), b:pj([sf[i + 3], sf[i + 4], sf[i + 5]]) }); }
    it.edges.forEach(function(q){ ed.push({ a:pj(q[0]), b:pj(q[1]), k:it.k }); });
  });
  var u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity, d0 = Infinity, d1 = -Infinity;
  tr.forEach(function(t){ t.forEach(function(q){ u0 = Math.min(u0, q[0]); u1 = Math.max(u1, q[0]); v0 = Math.min(v0, q[1]); v1 = Math.max(v1, q[1]); d0 = Math.min(d0, q[2]); d1 = Math.max(d1, q[2]); }); });
  if (!(u1 > u0)) return { vis:[], hid:[], u0:0, u1:0, v0:0, v1:0 };
  var W = Math.ceil((u1 - u0) * RES) + 3, H = Math.ceil((v1 - v0) * RES) + 3, Z = new Float32Array(W * H).fill(1e9);
  var X = function(q){ return (q[0] - u0) * RES + 1; }, Y = function(q){ return (v1 - q[1]) * RES + 1; };
  tr.forEach(function(t){ var x = t.map(X), y = t.map(Y), d = t.map(function(q){ return q[2]; });
    var den = (y[1] - y[2]) * (x[0] - x[2]) + (x[2] - x[1]) * (y[0] - y[2]); if (Math.abs(den) < 1e-9) return;
    var xa = Math.max(0, Math.floor(Math.min(x[0], x[1], x[2]))), xb = Math.min(W - 1, Math.ceil(Math.max(x[0], x[1], x[2]))), ya = Math.max(0, Math.floor(Math.min(y[0], y[1], y[2]))), yb = Math.min(H - 1, Math.ceil(Math.max(y[0], y[1], y[2])));
    for (var py = ya; py <= yb; py++) for (var px = xa; px <= xb; px++) {
      var A = ((y[1] - y[2]) * (px - x[2]) + (x[2] - x[1]) * (py - y[2])) / den, B = ((y[2] - y[0]) * (px - x[2]) + (x[0] - x[2]) * (py - y[2])) / den, C = 1 - A - B;
      if (A < -1e-4 || B < -1e-4 || C < -1e-4) continue; var dd = A * d[0] + B * d[1] + C * d[2], ii = py * W + px; if (dd < Z[ii]) Z[ii] = dd; } });
  var tol = 1.5 + (d1 - d0) * 0.004, vis = [], hid = [];
  ed.forEach(function(e){ var L = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]); if (L < 0.08) return;
    var n = Math.max(2, Math.ceil(L * RES / 1.5)), cur = null, cv = null, Q = [], VV = [];
    for (var i = 0; i <= n; i++) { var t = i / n, q = [e.a[0] + (e.b[0] - e.a[0]) * t, e.a[1] + (e.b[1] - e.a[1]) * t], d = e.a[2] + (e.b[2] - e.a[2]) * t;
      var px = Math.round(X(q)), py = Math.round(Y(q)), zm = -1e9;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { var ix = px + dx, iy = py + dy; if (ix >= 0 && iy >= 0 && ix < W && iy < H) { var z = Z[iy * W + ix]; if (z < 1e8) zm = Math.max(zm, z); } }
      Q.push(q); VV.push(zm < -1e8 || d <= zm + tol); }
    // 1 点だけ 見え方が 変わる ところ（面の 境目の ゆらぎ）は 両どなりに 合わせる（見える 線が 破線の ように 切れない）
    for (i = 1; i < n; i++) if (VV[i - 1] === VV[i + 1] && VV[i] !== VV[i - 1]) VV[i] = VV[i - 1];
    var runs = 0;
    for (i = 0; i <= n; i++) { if (cur && VV[i] === cv) cur.b = Q[i]; else { if (cur) { (cv ? vis : hid).push(cur); runs++; } cur = { a:Q[i], b:Q[i] }; cv = VV[i]; } }
    if (cur) { if (!runs) cur.whole = 1; (cv ? vis : hid).push(cur); } });
  // 短い 切れ端は 捨てる（辺 まるごと 見える／隠れる 短い 辺は のこす）
  var ok = function(g){ var l = Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]); return l > 0.15 || (g.whole && l > 0.02); };
  return { vis:vis.filter(ok), hid:hid.filter(ok), u0:u0, u1:u1, v0:v0, v1:v1, Z:Z, X:X, Y:Y, W:W, H:H, P:Pf, s:s };
}
function kmSeen(r, p3){ var q = r.P(p3), u = q[0] * r.s, v = q[1] * r.s, px = Math.round(r.X([u, v])), py = Math.round(r.Y([u, v]));
  if (px < 0 || py < 0 || px >= r.W || py >= r.H) return null; return q[2] <= r.Z[py * r.W + px] + 3 ? [u, v] : null; }


// サムネ（斜め・線だけの SVG）：g＝{ tris, edges:[[a,b]…] }（部材の 座標）
function kmThumbSvg(g, size){ size = size || 160;
  var it = { tris:g.tris, edges:g.edges, soft:g.soft, tan:g.tan || kmTan(g.tris), off:[0, 0, 0] }, r0 = kmHlr([it], 'iso', 1, 0.2);
  var sc = (size - 12) / Math.max(r0.u1 - r0.u0, r0.v1 - r0.v0, 1), r = kmHlr([it], 'iso', sc, 4), cx = (r.u0 + r.u1) / 2, cy = (r.v0 + r.v1) / 2, h = size / 2;
  var d = r.vis.map(function(s){ return 'M' + (h + s.a[0] - cx).toFixed(1) + ' ' + (h - (s.a[1] - cy)).toFixed(1) + 'L' + (h + s.b[0] - cx).toFixed(1) + ' ' + (h - (s.b[1] - cy)).toFixed(1); }).join('');
  return '<svg viewBox="0 0 ' + size + ' ' + size + '" xmlns="http://www.w3.org/2000/svg"><path d="' + d + '" stroke="#222" stroke-width="1.1" fill="none" stroke-linecap="round"/></svg>'; }

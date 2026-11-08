// 図面化：組み立て（kumitate.html）の 形から 配置図・部品寸法表・加工指示図・部品詳細図を 作る（zumen.html の 部材図モードの ページに する）
// 本人（2026-11-07）：束は 石種で（外柵・石塔・カロート）、紙は ぜんぶ A4 横、詳細図に 斜視図、直方体は 斜視図に 寸法だけ、修正の △ を 機能に。
// 「手で 直した 所は、モデルが 少し 変わっても 毎回 直さなくて よい ように」：
//   自動で 出す 寸法・文字・図には 意味の ある 名前（aid・vid）を つけ、手の 直しは その 名前に むすんで 覚える（KMED）。
//   作り直す ときは 新しい 形で 描いて から、覚えた 直しを 当て直す。手で 足した 寸法・線は 図の 角・穴の 中心に むすぶ（無ければ 図の 中の 割合）。
//   付け先が 無くなった 直しは 捨てずに「付け先が 無い 直し」に 出す。部材の 図の 直しは「ひな形」（KMTPL：セットの 部材ごと）にも 覚えられる。
// 座標：作る ときは 紙の mm（y＝下向き）で 考え、入れる ときに ページ（y＝上向き・N＝1）へ。寸法の 値は k（縮尺の 分母）で 本当の mm。
var KM2 = null;           // { pay, geo:{鍵:{tris,edges,tan}}, bundles, lost }
var KMED = null;          // この 案件の 直し { ov:{aid:{}}, vm:{vid:[dx,dy]}, man:{vid|'pg:'+key:[…]}, revs:{key:[{n,date,s}]} }
function kmLs(k, v){ try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }
function kmTpl(){ return kmLs('zumen.kmTpl') || {}; }
var KM_SC = [5, 10, 15, 20, 25, 30, 40, 50], KM_S3 = Math.pow(303.03, 3);
function kmPick(w, h, bw, bh, min){ for (var i = 0; i < KM_SC.length; i++) { var n = KM_SC[i]; if (min && n < min) continue; if (w / n <= bw && h / n <= bh) return n; } return 50; }

// ── 投影（[u,v,深さ]。深さ＝小さいほど 手前）。斜めは 左前の 上から（メーカー図と 同じ。軸の 長さ＝実長）──
var KR2 = Math.SQRT2, KR3 = Math.sqrt(3), KR6 = Math.sqrt(6), KISO = Math.sqrt(1.5);
var KPJ = {
  front:function(p){ return [p[0], p[1], -p[2]]; },
  top:function(p){ return [p[0], -p[2], -p[1]]; },
  topR:function(p){ return [-p[2], p[0], -p[1]]; },
  right:function(p){ return [-p[2], p[1], -p[0]]; },
  left:function(p){ return [p[2], p[1], p[0]]; },
  iso:function(p){ return [(p[0] + p[2]) / KR2 * KISO, (p[0] + 2 * p[1] - p[2]) / KR6 * KISO, -(-p[0] + p[1] + p[2]) / KR3]; }
};
// 平らな 大きい 面の 縁（R 面取りの 始まりの 線 など。CSG の T 字の つなぎが あっても 線の 上の 重なりで 見る）
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
  var out = [], dot = function(x, y){ return x[0] * y[0] + x[1] * y[1] + x[2] * y[2]; };
  Object.keys(LN).forEach(function(key){ var o = LN[key]; if ([0, 1, 2].filter(function(j){ return Math.abs(o.dv[j]) > 0.002; }).length !== 1) return; // まっすぐ 軸の 向きの 線だけ
    o.iv.forEach(function(I){ var T = TR[I.ti]; if ((PA[T.pk] || 0) < big) return; var rest = [[I.a, I.b]];
      o.iv.forEach(function(J){ if (J.ti === I.ti || dot(TR[J.ti].n, T.n) < 0.9995) return; var nr = []; rest.forEach(function(K){ if (J.b <= K[0] + 0.05 || J.a >= K[1] - 0.05) { nr.push(K); return; } if (J.a > K[0]) nr.push([K[0], J.a]); if (J.b < K[1]) nr.push([J.b, K[1]]); }); rest = nr; });
      rest.forEach(function(K){ if (K[1] - K[0] > 0.3) out.push([o.c0.map(function(v, j){ return v + o.dv[j] * K[0]; }), o.c0.map(function(v, j){ return v + o.dv[j] * K[1]; })]); }); }); });
  return out;
}
// 隠れ線：items＝[{k, tris, edges, tan, off}]、s＝縮尺（1/n）。答えの 線は 紙の mm（u 右・v 上）
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
    var n = Math.max(2, Math.ceil(L * RES / 1.5)), cur = null, cv = null;
    for (var i = 0; i <= n; i++) { var t = i / n, q = [e.a[0] + (e.b[0] - e.a[0]) * t, e.a[1] + (e.b[1] - e.a[1]) * t], d = e.a[2] + (e.b[2] - e.a[2]) * t;
      var px = Math.round(X(q)), py = Math.round(Y(q)), zm = -1e9;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { var ix = px + dx, iy = py + dy; if (ix >= 0 && iy >= 0 && ix < W && iy < H) { var z = Z[iy * W + ix]; if (z < 1e8) zm = Math.max(zm, z); } }
      var vv = zm < -1e8 || d <= zm + tol;
      if (cur && vv === cv) cur.b = q; else { if (cur) (cv ? vis : hid).push(cur); cur = { a:q, b:q }; cv = vv; } }
    if (cur) (cv ? vis : hid).push(cur); });
  var ok = function(g){ return Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]) > 0.15; };
  return { vis:vis.filter(ok), hid:hid.filter(ok), u0:u0, u1:u1, v0:v0, v1:v1, Z:Z, X:X, Y:Y, W:W, H:H, P:Pf, s:s };
}
function kmSeen(r, p3){ var q = r.P(p3), u = q[0] * r.s, v = q[1] * r.s, px = Math.round(r.X([u, v])), py = Math.round(r.Y([u, v]));
  if (px < 0 || py < 0 || px >= r.W || py >= r.H) return null; return q[2] <= r.Z[py * r.W + px] + 3 ? [u, v] : null; }

// ── ページへ 入れる（紙の mm・y 下向き → ページ y 上向き）──
function kY(y){ return 210 - y; }
function kCp(q){ return q ? P(q.x, q.y) : q; } // 基準は 写しで 持つ（移動は 点を その まま 書き換える）
function kOut(pg){ return { ents:[], dims:[], pg:pg }; }
function kL(o, a, b, vid, hid, lay){ o.ents.push({ id:SEQ++, t:'line', a:P(a[0], kY(a[1])), b:P(b[0], kY(b[1])), layer:lay || (hid ? '隠れ線' : '部材'), css:null, aci:256, auto:true, vid:vid || null }); }
function kT(o, x, y, s, h, opt){ opt = opt || {}; var e = { id:SEQ++, t:'text', p:P(x, kY(y)), h:h || 2.5, rot:opt.rot || 0, s:String(s), ha:opt.ha || 0, va:opt.va || 0, wf:1, layer:opt.layer || '文字', css:null, aci:256, auto:true, vid:opt.vid || null, aid:opt.aid || null }; o.ents.push(e); return e; }
function kC(o, x, y, r, vid, opt){ opt = opt || {}; o.ents.push({ id:SEQ++, t:'circle', c:P(x, kY(y)), r:r, layer:opt.hid ? '隠れ線' : opt.layer || '部材', css:null, aci:256, auto:true, vid:vid || null }); }
function kPl(o, pts, vid, hid){ o.ents.push({ id:SEQ++, t:'pl', v:pts.map(function(q){ return { x:q[0], y:kY(q[1]), b:0 }; }), closed:true, layer:hid ? '隠れ線' : '部材', css:null, aci:256, auto:true, vid:vid || null }); }
// 寸法：a,b＝紙の 点（y 下）、n＝外向き（y 下）、d＝離す mm、k＝縮尺の 分母（値＝紙の 長さ×k）
function kD(o, a, b, n, d, k, aid, vid, opt){ opt = opt || {};
  var A = P(a[0], kY(a[1])), B = P(b[0], kY(b[1])), mode = Math.abs(a[1] - b[1]) < 1e-6 ? 'h' : Math.abs(a[0] - b[0]) < 1e-6 ? 'v' : 'a';
  var off = P((a[0] + b[0]) / 2 + n[0] * d, kY((a[1] + b[1]) / 2 + n[1] * d));
  var dm = { id:SEQ++, a:A, b:B, off:off, mode:mode, fmt:null, text:opt.text || null, th:opt.h || 2.3, al:2, k:k, auto:true, layer:'寸法', aid:aid || null, vid:vid || null, dec:opt.dec || 0 };
  o.dims.push(dm); return dm; }
// 図の 置き場（vid）：外の 枠（ページ y 上）と 目印の 点（角・穴の 中心）
function kView(o, vid, k, pts, feat){ var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  pts.forEach(function(q){ x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, kY(q[1])); y1 = Math.max(y1, kY(q[1])); });
  var F = { LB:[x0, y0], RB:[x1, y0], LT:[x0, y1], RT:[x1, y1], C:[(x0 + x1) / 2, (y0 + y1) / 2] };
  Object.keys(feat || {}).forEach(function(nm){ var q = feat[nm]; F[nm] = [q[0], kY(q[1])]; });
  o.pg.vw[vid] = { bb:{ x0:x0, y0:y0, x1:x1, y1:y1 }, f:F, k:k }; }
function kDrawR(o, r, M, vid, hid){ if (hid) r.hid.forEach(function(g){ kL(o, M(g.a), M(g.b), vid, true); }); r.vis.forEach(function(g){ kL(o, M(g.a), M(g.b), vid); }); }
function kPlace(r, cx, cy){ var mu = (r.u0 + r.u1) / 2, mv = (r.v0 + r.v1) / 2; return function(q){ return [cx + q[0] - mu, cy - (q[1] - mv)]; }; }

// ── 部材の 組（束・左右 同じ 石は 1 行）──
function kmBundles(pay){
  var bySet = {}, order = [];
  pay.parts.forEach(function(p){ var sid = p.setId || p.grp; if (!bySet[sid]) { bySet[sid] = []; order.push(sid); } bySet[sid].push(p); });
  var out = [];
  order.sort(function(a, b){ var ga = bySet[a][0].grp === 'fence' ? 0 : 1, gb = bySet[b][0].grp === 'fence' ? 0 : 1; return ga - gb; });
  order.forEach(function(sid){ var ps = bySet[sid], cnt = {};
    ps.forEach(function(p){ var s = p.stone || ''; cnt[s] = (cnt[s] || 0) + 1; });
    var stones = Object.keys(cnt).sort(function(a, b){ return cnt[b] - cnt[a]; });
    stones.forEach(function(st, si){ var pp = ps.filter(function(p){ return (p.stone || '') === st; });
      var names = []; pp.forEach(function(p){ var b = kmBase(p.name); if (names.indexOf(b) < 0) names.push(b); });
      var title = si === 0 ? (ps[0].setName || (ps[0].grp === 'fence' ? '外柵' : '石塔')) : names.join('・');
      var B = { id:sid + '|' + (st || '-'), title:title, stone:st, parts:pp, groups:[] }, seen = {};
      pp.forEach(function(p){ var nm = kmBase(p.name), key = nm + '|' + p.w + 'x' + p.d + 'x' + p.h;
        if (seen[key]) { seen[key].ks.push(p.k); return; }
        var g = { name:nm, ks:[p.k], w:p.w, d:p.d, h:p.h, fin:p.fin || '', kakou:(p.kakou || '') === '左右対称' ? '' : (p.kakou || ''), type:(p.setId || p.grp) + '/' + String(p.key || p.k).replace(/_[LR]$/, '') };
        seen[key] = g; B.groups.push(g); });
      B.groups.forEach(function(g, i){ g.no = i + 1; g.sai = g.w * g.d * g.h / KM_S3; g.sym = g.ks.length === 2; });
      out.push(B); }); });
  return out;
}
function kmBase(n){ return String(n || '').replace(/（[左右]）/, ''); }
function kmPart(k){ return KM2.pay.parts.filter(function(p){ return p.k === k; })[0]; }
function kmItem(k, world){ var p = kmPart(k), g = KM2.geo[k], b = p.box; return { k:k, tris:g.tris, edges:g.edges, tan:g.tan, off:world ? [(b.x0 + b.x1) / 2, b.y0, (b.z0 + b.z1) / 2] : [0, 0, 0] }; }

// ── 枠・表題欄（修正の △ の 一覧も）──
function kmFrame(o, pg, title, kind){
  var R = function(x0, y0, x1, y1, w){ kL(o, [x0, y0], [x1, y0], null, false, '枠'); kL(o, [x1, y0], [x1, y1], null, false, '枠'); kL(o, [x1, y1], [x0, y1], null, false, '枠'); kL(o, [x0, y1], [x0, y0], null, false, '枠'); };
  R(8, 8, 289, 202); kL(o, [8, 15], [289, 15], null, false, '枠');
  kT(o, 10, 13, title, 3.4, { layer:'枠', aid:pg.key + '/title' }); kT(o, 287, 13, (pg.no || 0) + ' / ' + (pg.tot || 0), 3, { ha:2, layer:'枠' });
  R(150, 190, 289, 202); [175, 230, 250].forEach(function(x){ kL(o, [x, 190], [x, 202], null, false, '枠'); }); kL(o, [150, 196], [289, 196], null, false, '枠');
  var info = (BM && BM.main && BM.main.info) || {}, pay = KM2.pay;
  kT(o, 152, 194.4, '件名', 2.2, { layer:'枠' }); kT(o, 177, 194.4, info.name || pay.name || '', 2.4, { layer:'枠', aid:pg.key + '/ken' });
  kT(o, 152, 200.4, '図名', 2.2, { layer:'枠' }); kT(o, 177, 200.4, kind, 2.4, { layer:'枠' });
  kT(o, 232, 194.4, '作成日', 2.2, { layer:'枠' }); kT(o, 252, 194.4, pay.date || '', 2.4, { layer:'枠' });
  kT(o, 232, 200.4, '修正', 2.2, { layer:'枠' });
  var rv = (KMED.revs[pg.key] || []);
  if (rv.length) { var last = rv[rv.length - 1]; kT(o, 252, 200.4, '△' + last.n + ' ' + last.date, 2.2, { layer:'枠' });
    rv.forEach(function(q, i){ kT(o, 152, 188 - (rv.length - 1 - i) * 3.6, '△' + q.n + '　' + q.date + '　' + q.s, 2.3, { layer:'枠' }); }); }
}

// ── ページを 作る ──
function kmGen(pg){
  var o = kOut(pg); pg.vw = {}; pg.regions = []; pg.N = 1;
  var f = { siteIso:kmPgSiteIso, site3:kmPgSite3, table:kmPgTable, index:kmPgIndex, detail:kmPgDetail }[pg.gen];
  if (f) f(o, pg);
  return o;
}
function kmPgSiteIso(o, pg){
  var items = KM2.pay.parts.map(function(p){ return kmItem(p.k, true); });
  var r0 = kmHlr(items, 'iso', 1 / 20, 3), n = kmPick((r0.u1 - r0.u0) * 20, (r0.v1 - r0.v0) * 20, 250, 160);
  var r = kmHlr(items, 'iso', 1 / n, 10), M = kPlace(r, 148.5, 100); kDrawR(o, r, M, 'site/iso');
  kView(o, 'site/iso', n, [M([r.u0, r.v0]), M([r.u1, r.v1])]); pg.regions.push(kmRegion(o, 'site/iso'));
  kmFrame(o, pg, '配置図　墓所 全体', '配置図（斜め）'); kT(o, 12, 186, '縮尺 1/' + n, 2.6, { aid:pg.key + '/scale' });
}
function kmBoxes(f){ return KM2.pay.parts.filter(f || function(){ return true; }).map(function(p){ return p.box; }); }
function kmPgSite3(o, pg){
  var items = KM2.pay.parts.map(function(p){ return kmItem(p.k, true); }), all = kmBoxes();
  var X0 = Math.min.apply(null, all.map(function(b){ return b.x0; })), X1 = Math.max.apply(null, all.map(function(b){ return b.x1; }));
  var Z0 = Math.min.apply(null, all.map(function(b){ return b.z0; })), Z1 = Math.max.apply(null, all.map(function(b){ return b.z1; }));
  var Y0 = Math.min(0, Math.min.apply(null, all.map(function(b){ return b.y0; }))), Y1 = Math.max.apply(null, all.map(function(b){ return b.y1; }));
  var n = kmPick(Math.max(X1 - X0, Z1 - Z0) + 0, (Z1 - Z0) + (Y1 - Y0) + 900, 130, 170 - 40), s = 1 / n;
  var Xc = 20 + (X1 - X0) * s / 2 + 10, Yp = 22 + (Z1 - Z0) * s / 2, Yf = Yp + (Z1 - Z0) * s / 2 + 22 + Y1 * s, Xs = Xc + (X1 - X0) * s / 2 + 30 + (Z1 - Z0) * s / 2;
  var cx = (X0 + X1) / 2, cz = (Z0 + Z1) / 2;
  var rp = kmHlr(items, 'top', s, 10), rf = kmHlr(items, 'front', s, 10), rs = kmHlr(items, 'right', s, 10);
  var Mp = function(q){ return [Xc + q[0] - cx * s, Yp - q[1] - cz * s]; }, Mf = function(q){ return [Xc + q[0] - cx * s, Yf - q[1]]; }, Ms = function(q){ return [Xs + q[0] + cz * s, Yf - q[1]]; };
  kDrawR(o, rp, Mp, 'site/plan'); kDrawR(o, rf, Mf, 'site/front'); kDrawR(o, rs, Ms, 'site/right');
  // 紙の 点：平面（x, z）・正面（x, y）・右側面（z, y）
  var pP = function(x, z){ return Mp([x * s, -z * s]); }, pF = function(x, y){ return Mf([x * s, y * s]); }, pS = function(z, y){ return Ms([-z * s, y * s]); };
  kView(o, 'site/plan', n, [pP(X0, Z0), pP(X1, Z1)]); kView(o, 'site/front', n, [pF(X0, Y0), pF(X1, Y1)]); kView(o, 'site/right', n, [pS(Z0, Y0), pS(Z1, Y1)]);
  ['site/plan', 'site/front', 'site/right'].forEach(function(v){ pg.regions.push(kmRegion(o, v)); });
  // GL
  kL(o, pF(X0 - 150, 0), pF(X1 + 150, 0), 'site/front', false, '部材'); kT(o, pF(X0 - 150, 0)[0] - 1, pF(0, 0)[1] + 0.9, 'GL', 2.4, { ha:2, vid:'site/front', aid:'site/front/gl' });
  kL(o, pS(Z1 + 150, 0), pS(Z0 - 150, 0), 'site/right', false, '部材'); kT(o, pS(Z0 - 150, 0)[0] + 1, pF(0, 0)[1] + 0.9, 'GL', 2.4, { vid:'site/right', aid:'site/right/gl' });
  // 平面：間口・奥行・奥行の 連なり（真ん中を 通る 外柵の 石＋石塔の 下の 段）
  kD(o, pP(X0, Z1), pP(X1, Z1), [0, 1], 6, n, 'site/plan/W', 'site/plan');
  kD(o, pP(X0, Z0), pP(X0, Z1), [-1, 0], 8, n, 'site/plan/D', 'site/plan');
  var fz = [], tw = KM2.pay.parts.filter(function(p){ return p.grp === 'tower'; }), tyMin = tw.length ? Math.min.apply(null, tw.map(function(p){ return p.box.y0; })) : 0;
  KM2.pay.parts.forEach(function(p){ var b = p.box; if (p.grp === 'fence' && b.x0 < 0 && b.x1 > 0) fz.push([b.z0, b.z1]); });
  var tb = tw.filter(function(p){ return Math.abs(p.box.y0 - tyMin) < 1; }).map(function(p){ return p.box; });
  if (tb.length) fz.push([Math.min.apply(null, tb.map(function(b){ return b.z0; })), Math.max.apply(null, tb.map(function(b){ return b.z1; }))]);
  var zs = []; fz.forEach(function(q){ zs.push(q[0], q[1]); }); zs.push(Z0, Z1); zs = zs.map(function(z){ return Math.round(z * 10) / 10; }).sort(function(a, b){ return a - b; }).filter(function(z, i, a){ return !i || z - a[i - 1] > 0.5; });
  for (var i = 0; i < zs.length - 1; i++) kD(o, pP(X1, zs[i]), pP(X1, zs[i + 1]), [1, 0], 6, n, 'site/plan/z' + i, 'site/plan', { h:2 });
  // 正面：間口・高さ（GL から）・埋まる 深さ・外柵の 高さ
  kD(o, pF(X0, Y0), pF(X1, Y0), [0, 1], 7, n, 'site/front/W', 'site/front');
  kD(o, pF(X1, 0), pF(X1, Y1), [1, 0], 14, n, 'site/front/H', 'site/front', { text:'GL+<>' });
  var fen = KM2.pay.parts.filter(function(p){ return p.grp === 'fence'; });
  if (fen.length) { var edge = fen.filter(function(p){ return Math.abs(p.box.x1 - X1) < 1; })[0];
    if (edge && edge.box.y1 > 0) kD(o, pF(X1, 0), pF(X1, edge.box.y1), [1, 0], 6, n, 'site/front/fenceH', 'site/front', { h:2 });
    var hi = fen.reduce(function(a, p){ return p.box.y1 > a.box.y1 ? p : a; }, fen[0]);
    if (hi.box.y1 > (edge ? edge.box.y1 : 0) + 50) kD(o, pF(X0, 0), pF(X0, hi.box.y1), [-1, 0], 11, n, 'site/front/fenceTop', 'site/front', { text:'GL+<>', h:2.1 }); }
  if (Y0 < -1) kD(o, pF(X0, Y0), pF(X0, 0), [-1, 0], 5, n, 'site/front/bury', 'site/front', { h:2 });
  // 右側面：奥行・いちばん 前の 石（階段）の 高さ
  kD(o, pS(Z1, Y0), pS(Z0, Y0), [0, 1], 6, n, 'site/right/D', 'site/right');
  var fr = fen.filter(function(p){ return Math.abs(p.box.z1 - Z1) < 1 && p.box.x0 < 0 && p.box.x1 > 0; })[0];
  if (fr) kD(o, pS(Z1, fr.box.y0), pS(Z1, fr.box.y1), [-1, 0], 5, n, 'site/right/stepH', 'site/right', { h:2 });
  kT(o, 12, 21, '平面図', 3, { aid:'site/plan/name' }); kT(o, 12, Yf - Y1 * s - 5, '正面図', 3, { aid:'site/front/name' }); kT(o, Xs - (Z1 - Z0) * s / 2, Yf - Y1 * s - 5, '右側面図', 3, { aid:'site/right/name' });
  // 注記
  var pay = KM2.pay, nx = Math.max(Xs + (Z1 - Z0) * s / 2 + 12, 175), ny = 24, J = pay.joint || {}, gl = pay.gl || {}, notes = [];
  if (J.h != null) notes.push('目地　横・奥行 ' + J.h + '／高さ ' + J.v);
  if (pay.open != null) notes.push('納骨室の 開口部 ' + Math.round(pay.open) + '（' + (J.open || 270) + ' 以上）');
  if (gl.glH != null) notes.push('GL から 腰石の 上 ' + gl.glH + '（埋まる ' + Math.round(gl.bury) + '）');
  if (gl.stepGL != null) notes.push('階段の 上 GL+' + Math.round(gl.stepGL));
  notes.push('寸法は 目地を 引いた 製作寸法（mm）');
  var st = {}; KM2.bundles.forEach(function(B){ if (B.stone) st[B.title] = B.stone; }); var sl = Object.keys(st).map(function(t){ return t + ' ' + st[t]; }); if (sl.length) notes.push('石種　' + sl.join('／'));
  kT(o, nx, ny, '注記', 3, { aid:'site/notes/h' }); notes.forEach(function(t, i){ kT(o, nx, ny + 5.5 * (i + 1), '・' + t, 2.5, { aid:'site/notes/' + i }); });
  kmFrame(o, pg, '配置図　平面・正面・右側面', '配置図（三面）'); kT(o, 12, 186, '縮尺 1/' + n, 2.6, { aid:pg.key + '/scale' });
}
function kmRegion(o, vid){ var v = o.pg.vw[vid], m = 12; return { x0:v.bb.x0 - m, x1:v.bb.x1 + m, y0:v.bb.y0 - m, y1:v.bb.y1 + m, k:v.k, vid:vid }; }
function kmPgTable(o, pg){
  var B = pg.B; kmFrame(o, pg, '部品寸法表　' + B.title, '部品寸法表');
  kT(o, 12, 22, '図面名　' + B.title, 2.8); kT(o, 110, 22, '石種　' + (B.stone || '（未定）'), 2.8);
  var tot = B.groups.reduce(function(a, g){ return a + g.sai * g.ks.length; }, 0); kT(o, 205, 22, '総才数　' + tot.toFixed(3), 2.8, { ha:2 });
  var cols = [['NO', 9], ['部品名称', 28], ['幅', 13], ['奥行', 13], ['高さ', 13], ['単位', 9], ['数量', 9], ['才数', 15], ['磨き', 26], ['加工明細', 70]], y = 26, rh = 6.2, X0 = 12;
  function row(v, head){ var x = X0; cols.forEach(function(c, i){ var left = i === 1 || i >= 8, s = String(v[i] == null ? '' : v[i]); if (i === 9 && s.length > 30) s = s.slice(0, 29) + '…';
    kT(o, left ? x + 1 : x + c[1] - 1, y + rh - 1.8, s, i === 9 ? 2.1 : 2.5, { ha:left ? 0 : 2, layer:'枠' }); x += c[1]; }); kL(o, [X0, y], [x, y], null, false, '枠'); y += rh; }
  row(cols.map(function(c){ return c[0]; }), 1);
  for (var i = 0; i < 20; i++) { var g = B.groups[i]; row(g ? [g.no, g.name, g.w, g.d, g.h, 'mm', g.ks.length, (g.sai * g.ks.length).toFixed(3), g.fin.replace('（底以外）', ''), (g.sym ? '左右対称 ' : '') + g.kakou] : [i + 1]); }
  var xe = X0 + cols.reduce(function(a, c){ return a + c[1]; }, 0), xx = X0; kL(o, [X0, y], [xe, y], null, false, '枠');
  cols.forEach(function(c){ kL(o, [xx, 26], [xx, y], null, false, '枠'); xx += c[1]; }); kL(o, [xe, 26], [xe, y], null, false, '枠');
  var rx = 225, ry = 26; [['図面枚数', ''], ['数量', '1 基'], ['作成日', KM2.pay.date || ''], ['得意先', ''], ['石種', B.stone || ''], ['発注先', ''], ['納期', ''], ['備考', '']].forEach(function(q){
    kL(o, [rx, ry], [287, ry], null, false, '枠'); kL(o, [rx, ry + 9], [287, ry + 9], null, false, '枠'); kL(o, [rx, ry], [rx, ry + 9], null, false, '枠'); kL(o, [287, ry], [287, ry + 9], null, false, '枠'); kL(o, [rx + 20, ry], [rx + 20, ry + 9], null, false, '枠');
    kT(o, rx + 1.5, ry + 6, q[0], 2.4, { layer:'枠' }); kT(o, rx + 22, ry + 6, q[1], 2.4, { layer:'枠', aid:pg.key + '/info/' + q[0] }); ry += 9; });
  kT(o, 12, 186, '才数＝(幅÷303.03)×(奥行÷303.03)×(高さ÷303.03)。寸法は 目地を 引いた 製作寸法', 2.2);
}
function kmPgIndex(o, pg){
  var B = pg.B, items = B.parts.map(function(p){ return kmItem(p.k, true); });
  var r0 = kmHlr(items, 'iso', 1 / 20, 3), n = kmPick((r0.u1 - r0.u0) * 20, (r0.v1 - r0.v0) * 20, 240, 150);
  var r = kmHlr(items, 'iso', 1 / n, 10), M = kPlace(r, 148.5, 102), vid = B.id + '/index'; kDrawR(o, r, M, vid);
  kView(o, vid, n, [M([r.u0, r.v0]), M([r.u1, r.v1])]); pg.regions.push(kmRegion(o, vid));
  B.groups.forEach(function(g){ g.ks.forEach(function(k){ var b = kmPart(k).box, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, cz = (b.z0 + b.z1) / 2;
    var cand = [[cx, b.y1, cz], [cx, cy, b.z1], [b.x0, cy, cz], [cx, b.y1, b.z1 - (b.z1 - b.z0) * 0.25], [cx - (b.x1 - b.x0) * 0.3, b.y1, cz]];
    for (var i = 0; i < cand.length; i++) { var q = kmSeen(r, cand[i]); if (q) { var p = M(q); kC(o, p[0], p[1], 2.6, vid, { layer:'文字' }); kT(o, p[0], p[1], String(g.no), 2.8, { ha:1, va:2, vid:vid, aid:vid + '/no/' + k }); break; } } }); });
  kmFrame(o, pg, '加工指示図　【' + B.title + '】', '加工指示図'); kT(o, 12, 186, '縮尺 1/' + n, 2.6, { aid:pg.key + '/scale' });
}
function kmPgDetail(o, pg){
  var B = pg.B; kL(o, [148.5, 15], [148.5, 190], null, false, '枠');
  pg.groups.forEach(function(g, j){ kmDetail(o, pg, g, j ? 148.5 : 8, B); });
  kmFrame(o, pg, '【部品詳細図】　' + B.title, '部品詳細図');
}
function kmSimple(k){ var p = kmPart(k), v = p.shape && p.shape.components && p.shape.components[0] && p.shape.components[0].shape && p.shape.components[0].shape.views;
  if (!v) return KM2.geo[k].tris.length / 9 <= 12;
  var r4 = function(q){ return !q || (q.out && q.out.length === 4); };
  return r4(v.front) && r4(v.side) && r4(v.top) && !(v.front.holes || []).length && !(v.side && ((v.side.holes || []).length || (v.side.cuts || []).length)) && !(v.top && ((v.top.holes || []).length || (v.top.cuts || []).length)); }
function kmDetail(o, pg, g, X, B){
  var k = g.ks[0], p = kmPart(k), it = [kmItem(k, false)], T = g.type, W = g.w, D2 = g.d, H = g.h;
  kL(o, [X, 33], [X + 140.5, 33], null, false, '枠');
  kT(o, X + 2, 19, g.no + '.　' + g.name + (g.sym ? '（左右対称・図は ' + (/_R$/.test(p.key || '') ? '右' : '左') + '）' : ''), 2.8, { aid:T + '/h/name' });
  kT(o, X + 2, 23.2, (g.fin || '') + '　　' + (B.stone || '（石種）'), 2.4, { aid:T + '/h/fin' });
  kT(o, X + 2, 27.4, W + '×' + D2 + '×' + H + ' mm', 2.4);
  kT(o, X + 2, 31.6, g.sai.toFixed(3) + ' × ' + g.ks.length + '本 = ' + (g.sai * g.ks.length).toFixed(3) + ' 才', 2.4);
  if (g.kakou) { kT(o, X + 60, 23.2, g.kakou.slice(0, 34), 2.1, { aid:T + '/h/kakou1' }); if (g.kakou.length > 34) kT(o, X + 60, 27.4, g.kakou.slice(34, 68), 2.1, { aid:T + '/h/kakou2' }); }
  var simple = kmSimple(k);
  // 斜め（寸法つき）
  var ia = simple ? { x0:X + 6, x1:X + 134, y0:40, y1:184 } : { x0:X + 6, x1:X + 134, y0:38, y1:100 };
  var r0 = kmHlr(it, 'iso', 1, 0.2), n = Math.max(simple ? 10 : 5, kmPick(r0.u1 - r0.u0, r0.v1 - r0.v0, (ia.x1 - ia.x0) - 26, (ia.y1 - ia.y0) - 20)), s = 1 / n;
  var r = kmHlr(it, 'iso', s, 10), M = kPlace(r, (ia.x0 + ia.x1) / 2, (ia.y0 + ia.y1) / 2), vI = T + '/iso'; kDrawR(o, r, M, vI);
  var ip = function(q){ var z = KPJ.iso(q); return M([z[0] * s, z[1] * s]); };
  var unit = function(a, b){ var L = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; };
  var nz = unit(ip([0, 0, 0]), ip([0, 0, 100])), nx = unit(ip([0, 0, 0]), ip([-100, 0, 0]));
  var corners = {}; [[-1, 0, -1], [1, 0, -1], [-1, 0, 1], [1, 0, 1], [-1, 1, -1], [1, 1, -1], [-1, 1, 1], [1, 1, 1]].forEach(function(c){ corners['c' + c.join('')] = ip([c[0] * W / 2, c[1] * H, c[2] * D2 / 2]); });
  kView(o, vI, n, [M([r.u0, r.v0]), M([r.u1, r.v1])], corners); pg.regions.push(kmRegion(o, vI));
  kD(o, ip([-W / 2, 0, D2 / 2]), ip([W / 2, 0, D2 / 2]), nz, 5, n, vI + '/W', vI);
  kD(o, ip([-W / 2, 0, -D2 / 2]), ip([-W / 2, 0, D2 / 2]), nx, 5, n, vI + '/D', vI);
  kD(o, ip([W / 2, 0, D2 / 2]), ip([W / 2, H, D2 / 2]), [-nx[0], -nx[1]], 5, n, vI + '/H', vI);
  kT(o, X + 136, simple ? 186 : 102, '1/' + n, 2.2, { ha:2, aid:vI + '/scale' });
  if (simple) return;
  // 三面（正面・右側面・平面。左の 面から の 穴が あれば 左側面も）
  var v = (p.shape.components[0].shape.views) || {}, hasL = ((v.side && v.side.holes) || []).some(function(h){ return h.from === 'left'; });
  var needTop = !!((v.top && (((v.top.holes || []).length) || ((v.top.cuts || []).length))) || (v.side && (v.side.cuts || []).length));
  var rot = needTop && D2 > 2.5 * W;
  var area = { x0:X + 4, x1:X + 138, y0:106, y1:186 }, needW = W + D2 + (hasL ? D2 : 0), needH = H + (needTop ? (rot ? W : D2) : 0);
  var m = kmPick(needW, needH, (area.x1 - area.x0) - 34 - (hasL ? 12 : 0), (area.y1 - area.y0) - 22), t = 1 / m;
  var rf = kmHlr(it, 'front', t), rr = kmHlr(it, 'right', t), rt = needTop ? kmHlr(it, rot ? 'topR' : 'top', t) : null, rl = hasL ? kmHlr(it, 'left', t) : null;
  var gap = 12, fx = area.x0 + 12 + (hasL ? D2 * t + gap : 0), fyb = area.y1 - 12;
  var Mf = function(q){ return [fx + W / 2 * t + q[0], fyb - q[1]]; }, Mr = function(q){ return [fx + W * t + gap + D2 / 2 * t + q[0], fyb - q[1]]; };
  var Mt = function(q){ return [fx + W / 2 * t + q[0], fyb - H * t - gap - D2 * t / 2 - q[1]]; }, MtR = function(q){ return [fx + W * t + gap + D2 / 2 * t + q[0], fyb - H * t - gap - W * t / 2 - q[1]]; };
  var Ml = function(q){ return [fx - gap - D2 / 2 * t + q[0], fyb - q[1]]; };
  var VW = { front:[rf, Mf, W, H], right:[rr, Mr, D2, H] }; if (rl) VW.left = [rl, Ml, D2, H]; if (rt) VW.top = [rt, rot ? MtR : Mt, rot ? D2 : W, rot ? W : D2];
  // 穴（図の 形の まま。向こう 側から の 穴は 点線）
  var holes = [], bbx = function(pts){ var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; pts.forEach(function(q){ x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }); return [(x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0]; };
  ((v.front && v.front.holes) || []).forEach(function(h, i){ var c = bbx(h.pts); holes.push({ id:'f' + i, view:'front', pts:h.pts.map(function(q){ return [q[0], q[1]]; }), u:c[0], y:c[1], phi:c[2], hh:c[3], depth:h.depth, far:h.from === 'back', from:h.from === 'back' ? '背面から' : '前から' }); });
  ((v.side && v.side.holes) || []).forEach(function(h, i){ var c = bbx(h.pts), L = h.from === 'left' && hasL;
    holes.push({ id:'s' + i, view:L ? 'left' : 'right', pts:h.pts.map(function(q){ return [L ? D2 / 2 - q[0] : q[0] - D2 / 2, q[1]]; }), u:L ? D2 / 2 - c[0] : c[0] - D2 / 2, y:c[1], phi:c[2], hh:c[3], depth:h.depth, far:h.from === 'left' && !hasL, from:h.from === 'left' ? '左の 面から' : '右の 面から' }); });
  if (!rot) ((v.top && v.top.holes) || []).forEach(function(h, i){ var c = bbx(h.pts); holes.push({ id:'t' + i, view:'top', pts:h.pts.map(function(q){ return [q[0], q[1] - D2 / 2]; }), u:c[0], y:c[1] - D2 / 2, phi:c[2], hh:c[3], depth:h.depth, from:'上から' }); });
  Object.keys(VW).forEach(function(vw){ var V = VW[vw], R = V[0], MM = V[1], L = V[2], Hh = V[3], vid = T + '/' + vw;
    kDrawR(o, R, MM, vid, true);
    var hs = holes.filter(function(h){ return h.view === vw; }), feat = {};
    hs.forEach(function(h){ var c = MM([h.u * t, h.y * t]); feat[h.id] = c;
      [['lb', -1, -1], ['rb', 1, -1], ['lt', -1, 1], ['rt', 1, 1]].forEach(function(cc){ feat[h.id + cc[0]] = MM([(h.u + cc[1] * h.phi / 2) * t, (h.y + cc[2] * h.hh / 2) * t]); });
      if (h.phi * t < 1.1) kC(o, c[0], c[1], 0.55, vid, { hid:h.far }); else kPl(o, h.pts.map(function(q){ return MM([q[0] * t, q[1] * t]); }), vid, h.far); });
    kView(o, vid, m, [MM([-L / 2 * t, (vw === 'top' ? -Hh / 2 : 0) * t]), MM([L / 2 * t, (vw === 'top' ? Hh / 2 : Hh) * t])], feat); pg.regions.push(kmRegion(o, vid));
    var yb = vw === 'top' ? -Hh / 2 : 0, yt = vw === 'top' ? Hh / 2 : Hh;
    kD(o, MM([-L / 2 * t, yb * t]), MM([L / 2 * t, yb * t]), [0, 1], 4, m, vid + '/w', vid, { h:2.2 });
    if (vw === 'front') kD(o, MM([-L / 2 * t, 0]), MM([-L / 2 * t, Hh * t]), [-1, 0], 4, m, vid + '/h', vid, { h:2.2 });
    if (vw === 'top') kD(o, MM([L / 2 * t, yb * t]), MM([L / 2 * t, yt * t]), [1, 0], 4, m, vid + '/d', vid, { h:2.2 });
    if (!hs.length) return;
    // 穴の 位置：上の 端に 横の 連なり、右に 高さ
    var us = []; hs.forEach(function(h){ var u = Math.round(h.u * 10) / 10; if (us.indexOf(u) < 0) us.push(u); }); us.sort(function(a, b){ return a - b; });
    var ch = [-L / 2].concat(us, [L / 2]);
    for (var q = 0; q < ch.length - 1; q++) { if (ch[q + 1] - ch[q] < 0.5) continue; kD(o, MM([ch[q] * t, yt * t]), MM([ch[q + 1] * t, yt * t]), [0, -1], 3.5, m, vid + '/hx/' + q, vid, { h:1.9, dec:1 }); }
    if (vw !== 'top') { var ys = []; hs.forEach(function(h){ var yy = Math.round(h.y); if (ys.indexOf(yy) < 0) ys.push(yy); }); ys.sort(function(a, b){ return a - b; }); var prev = 0;
      ys.forEach(function(yy, i){ kD(o, MM([L / 2 * t, prev * t]), MM([L / 2 * t, yy * t]), [1, 0], 3, m, vid + '/hy/' + i, vid, { h:1.9 }); prev = yy; }); }
    var grp = {}; hs.forEach(function(h){ var key = Math.round(h.phi) + 'x' + Math.round(h.hh) + 'd' + h.depth + h.from; (grp[key] = grp[key] || []).push(h); });
    Object.keys(grp).forEach(function(key, gi){ var g2 = grp[key], h0 = g2[0], c = MM([h0.u * t, h0.y * t]), top = MM([0, yt * t])[1], lp = [c[0] + 4, top - 8 - gi * 3.6];
      var txt = (Math.abs(h0.phi - h0.hh) < 1 && h0.pts.length <= 40 ? 'Φ' + Math.round(h0.phi) : '穴 ' + Math.round(h0.phi) + '×' + Math.round(h0.hh)) + ' 深' + h0.depth + ' ×' + g2.length + '（' + h0.from + '）';
      kL(o, c, lp, vid, false, '文字'); kL(o, lp, [lp[0] + txt.length * 1.75, lp[1]], vid, false, '文字'); kT(o, lp[0] + 0.5, lp[1] - 0.7, txt, 1.9, { vid:vid, aid:vid + '/hole/' + key }); });
  });
  var lb = function(txt, q, vid){ kT(o, q[0], q[1], txt, 2, { ha:1, vid:vid, aid:vid + '/name' }); };
  lb('正面', [Mf([0, 0])[0], fyb + 9], T + '/front'); lb('右側面', [Mr([0, 0])[0], fyb + 9], T + '/right'); if (rl) lb('左側面', [Ml([0, 0])[0], fyb + 9], T + '/left');
  if (rt) { if (rot) lb('平面（回して いる。左が 前）', [MtR([0, 0])[0], MtR([0, 0])[1] - W / 2 * t - 2.5], T + '/top'); else lb('平面', [Mt([0, 0])[0] - W / 2 * t - 6, Mt([0, 0])[1]], T + '/top'); }
  kT(o, X + 136, 186, '1/' + m, 2.2, { ha:2, aid:T + '/ortho/scale' });
}

// ── 直しを 当てる ──
function kmShiftItem(it, dx, dy){ ['a', 'b', 'c', 'p', 'off'].forEach(function(f){ if (it[f]) it[f] = P(it[f].x + dx, it[f].y + dy); }); if (it.v) it.v = it.v.map(function(q){ return { x:q.x + dx, y:q.y + dy, b:q.b }; }); }
var KM_DF = ['text', 'th', 'al', 'at', 'fmt', 'dec'];
function kmApply(pg, o){
  var tpl = kmTpl(), lost = [];
  function ovOf(aid){ if (KMED.ov[aid]) return KMED.ov[aid]; var T = aid && Object.keys(tpl).filter(function(t){ return aid.indexOf(t + '/') === 0; })[0]; return T && tpl[T].ov && tpl[T].ov[aid] || null; }
  function vmOf(vid){ if (KMED.vm[vid]) return KMED.vm[vid]; var T = Object.keys(tpl).filter(function(t){ return vid.indexOf(t + '/') === 0; })[0]; return T && tpl[T].vm && tpl[T].vm[vid] || null; }
  // 図の 置き場
  Object.keys(pg.vw).forEach(function(vid){ var mv = vmOf(vid); if (!mv) return; var V = pg.vw[vid];
    o.ents.concat(o.dims).forEach(function(it){ if (it.vid === vid) kmShiftItem(it, mv[0], mv[1]); });
    V.bb = { x0:V.bb.x0 + mv[0], x1:V.bb.x1 + mv[0], y0:V.bb.y0 + mv[1], y1:V.bb.y1 + mv[1] }; Object.keys(V.f).forEach(function(nm){ V.f[nm] = [V.f[nm][0] + mv[0], V.f[nm][1] + mv[1]]; });
    pg.regions.forEach(function(r){ if (r.vid === vid) { r.x0 += mv[0]; r.x1 += mv[0]; r.y0 += mv[1]; r.y1 += mv[1]; } }); });
  // 自動の 寸法・文字の 直し（基準は 直す 前：手の 直しを 読む ときに 比べる）
  pg.base = {};
  o.dims.forEach(function(d){ if (!d.aid) return; pg.base[d.aid] = { vid:d.vid, a:kCp(d.a), b:kCp(d.b), off:kCp(d.off), text:d.text, th:d.th, al:d.al, at:d.at, fmt:d.fmt, dec:d.dec };
    var ov = ovOf(d.aid); if (!ov) return; if (ov.hide) { d._hide = 1; return; }
    if (ov.doff) d.off = P(d.off.x + ov.doff[0], d.off.y + ov.doff[1]); if (ov.da) d.a = P(d.a.x + ov.da[0], d.a.y + ov.da[1]); if (ov.db) d.b = P(d.b.x + ov.db[0], d.b.y + ov.db[1]);
    KM_DF.forEach(function(f){ if (ov[f] !== undefined) d[f] = ov[f]; }); });
  o.dims = o.dims.filter(function(d){ return !d._hide; });
  o.ents.forEach(function(e){ if (!e.aid) return; pg.base[e.aid] = { vid:e.vid, p:kCp(e.p), s:e.s, h:e.h }; var ov = ovOf(e.aid); if (!ov) return; if (ov.hide) { e._hide = 1; return; }
    if (ov.dp) e.p = P(e.p.x + ov.dp[0], e.p.y + ov.dp[1]); if (ov.s !== undefined) e.s = ov.s; if (ov.h) e.h = ov.h; });
  o.ents = o.ents.filter(function(e){ return !e._hide; });
  // 付け先が 無い 直し（この ページの 図の 名前で 始まるのに 作った 中に 無い もの）
  Object.keys(KMED.ov).forEach(function(aid){ var vid = Object.keys(pg.vw).filter(function(v){ return aid.indexOf(v + '/') === 0; })[0]; if (vid && !pg.base[aid]) lost.push({ aid:aid, pg:pg.key, what:'自動の 寸法・文字の 直し' }); });
  // 手で 足した もの
  var vids = Object.keys(pg.vw);
  vids.concat(['pg:' + pg.key]).forEach(function(vk){ var L = KMED.man[vk];
    if (!L) { var T = Object.keys(tpl).filter(function(t){ return vk.indexOf(t + '/') === 0; })[0]; L = T && tpl[T].man && tpl[T].man[vk]; }
    (L || []).forEach(function(m){ var it = kmUnbind(pg, m, lost); if (!it) return; if (m.type === 'd') o.dims.push(it); else o.ents.push(it); }); });
  pg.lost = lost;
}
// 点の むすび：図の 目印（角・穴の 中心）に 近ければ その 名前、無ければ 図の 枠の 中の 割合
function kmBindPt(pg, q){
  var best = null, bd = 1e9, vids = Object.keys(pg.vw);
  vids.forEach(function(vid){ var V = pg.vw[vid]; Object.keys(V.f).forEach(function(nm){ var f = V.f[nm], d = Math.hypot(f[0] - q.x, f[1] - q.y); if (d < bd) { bd = d; best = { vid:vid, f:nm, d:[q.x - f[0], q.y - f[1]] }; } }); });
  if (best && bd <= 0.8) return best;
  var inV = null, m = 15; vids.forEach(function(vid){ var b = pg.vw[vid].bb; if (q.x >= b.x0 - m && q.x <= b.x1 + m && q.y >= b.y0 - m && q.y <= b.y1 + m) { var a = (b.x1 - b.x0) * (b.y1 - b.y0); if (!inV || a < inV.a) inV = { vid:vid, a:a }; } });
  if (inV) { var b = pg.vw[inV.vid].bb, w = Math.max(1e-6, b.x1 - b.x0), h = Math.max(1e-6, b.y1 - b.y0); return { vid:inV.vid, u:(q.x - b.x0) / w, v:(q.y - b.y0) / h }; }
  return { abs:[q.x, q.y] };
}
function kmPt(pg, bd){
  if (bd.abs) return P(bd.abs[0], bd.abs[1]);
  var V = pg.vw[bd.vid]; if (!V) return null;
  if (bd.f) { var f = V.f[bd.f]; if (!f) return null; return P(f[0] + bd.d[0], f[1] + bd.d[1]); }
  return P(V.bb.x0 + bd.u * (V.bb.x1 - V.bb.x0), V.bb.y0 + bd.v * (V.bb.y1 - V.bb.y0));
}
var KM_PF = ['a', 'b', 'c', 'p'];
function kmBind(pg, it, isDim){
  var o = JSON.parse(JSON.stringify(it)), bd = {}, home = null;
  KM_PF.forEach(function(f){ if (it[f] && typeof it[f].x === 'number') { bd[f] = kmBindPt(pg, it[f]); if (!home && bd[f].vid) home = bd[f].vid; } });
  if (it.v) { bd.v = it.v.map(function(q){ var b = kmBindPt(pg, q); if (!home && b.vid) home = b.vid; return b; }); }
  if (isDim) { var mid = P((it.a.x + it.b.x) / 2, (it.a.y + it.b.y) / 2); bd.od = [it.off.x - mid.x, it.off.y - mid.y]; }
  return { type:isDim ? 'd' : 'e', o:o, bd:bd, home:home };
}
function kmUnbind(pg, m, lost){
  var it = JSON.parse(JSON.stringify(m.o)), bad = false;
  KM_PF.forEach(function(f){ if (m.bd[f]) { var q = kmPt(pg, m.bd[f]); if (!q) bad = true; else it[f] = q; } });
  if (m.bd.v) it.v = m.bd.v.map(function(b, i){ var q = kmPt(pg, b); if (!q) { bad = true; return it.v[i]; } return { x:q.x, y:q.y, b:it.v[i].b || 0 }; });
  if (bad) { lost.push({ pg:pg.key, what:'手で 足した ' + (m.type === 'd' ? '寸法' : '線・文字'), m:m }); return null; }
  if (m.type === 'd') { var mid = P((it.a.x + it.b.x) / 2, (it.a.y + it.b.y) / 2); it.off = P(mid.x + m.bd.od[0], mid.y + m.bd.od[1]); if (m.home && pg.vw[m.home]) it.k = pg.vw[m.home].k; }
  it.id = SEQ++; delete it.auto; return it;
}
// 今の ページの 手の 直しを 読む（作り直す 前・ページを 変える 時・閉じる 時）
function kmHarvest(pg){
  if (!pg || !pg.doc || !pg.vw || !KMED) return;
  var doc = pg.doc, near = function(a, b){ return Math.abs(a - b) < 0.02; };
  // 図ごと 動かした（自動の 線が そろって ずれて いる）
  // 図ごと 動かした：その 図の 自動の 線の 多く（6 割）が 同じ だけ ずれて いる（線の id で 前の 位置と 比べる）
  var vmove = {}, lp = pg.lpos || {};
  Object.keys(pg.vw).forEach(function(vid){ var cnt = {}, n = 0;
    doc.ents.forEach(function(e){ if (!e.auto || e.vid !== vid || e.t !== 'line' || !lp[e.id]) return; n++;
      var k = Math.round((e.a.x - lp[e.id][0]) * 20) + ',' + Math.round((e.a.y - lp[e.id][1]) * 20); cnt[k] = (cnt[k] || 0) + 1; });
    var best = null; Object.keys(cnt).forEach(function(k){ if (!best || cnt[k] > cnt[best]) best = k; });
    if (!best || best === '0,0' || cnt[best] < n * 0.6) return;
    var dd = best.split(',').map(function(v){ return +v / 20; }), old = KMED.vm[vid] || [0, 0]; KMED.vm[vid] = [old[0] + dd[0], old[1] + dd[1]]; vmove[vid] = dd; });
  // 図ごと 動かした ぶんは 基準も 動かす（いっしょに 動いた 寸法・文字は 直し なし、残した ものは その 場所を 覚える）
  Object.keys(pg.base).forEach(function(aid){ var b = pg.base[aid], mv = b.vid && vmove[b.vid]; if (!mv) return; var sh = function(q){ return q ? P(q.x + mv[0], q.y + mv[1]) : q; };
    pg.base[aid] = Object.assign({}, b, { a:sh(b.a), b:sh(b.b), off:sh(b.off), p:sh(b.p) }); });
  var sub = function(q, b){ return [q.x - b.x, q.y - b.y]; }, nz = function(v){ return Math.hypot(v[0], v[1]) > 0.02; };
  var seenAid = {};
  doc.dims.forEach(function(d){ if (!d.auto || !d.aid || !pg.base[d.aid]) return; seenAid[d.aid] = 1; var b = pg.base[d.aid], ov = {};
    var doff = sub(d.off, b.off), da = sub(d.a, b.a), db = sub(d.b, b.b);
    if (nz(doff)) ov.doff = doff; if (nz(da)) ov.da = da; if (nz(db)) ov.db = db;
    KM_DF.forEach(function(f){ if ((d[f] == null ? null : d[f]) !== (b[f] == null ? null : b[f])) ov[f] = d[f]; });
    if (Object.keys(ov).length) KMED.ov[d.aid] = ov; else delete KMED.ov[d.aid]; });
  doc.ents.forEach(function(e){ if (!e.auto || !e.aid || !pg.base[e.aid]) return; seenAid[e.aid] = 1; var b = pg.base[e.aid], ov = {};
    var dp = sub(e.p, b.p); if (nz(dp)) ov.dp = dp; if (e.s !== b.s) ov.s = e.s; if (e.h !== b.h) ov.h = e.h;
    if (Object.keys(ov).length) KMED.ov[e.aid] = ov; else delete KMED.ov[e.aid]; });
  Object.keys(pg.base).forEach(function(aid){ if (!seenAid[aid]) KMED.ov[aid] = { hide:1 }; });
  // 手で 足した もの：図の 目印・割合に むすぶ。図ごと 動かした ぶんは 目印も 動かして から
  Object.keys(vmove).forEach(function(vid){ var V = pg.vw[vid], mv = vmove[vid]; V.bb = { x0:V.bb.x0 + mv[0], x1:V.bb.x1 + mv[0], y0:V.bb.y0 + mv[1], y1:V.bb.y1 + mv[1] }; Object.keys(V.f).forEach(function(nm){ V.f[nm] = [V.f[nm][0] + mv[0], V.f[nm][1] + mv[1]]; }); kmLb(pg, vid); });
  Object.keys(pg.vw).forEach(function(vid){ delete KMED.man[vid]; }); delete KMED.man['pg:' + pg.key];
  doc.ents.forEach(function(e){ if (e.auto) return; var m = kmBind(pg, e, false), k = m.home || 'pg:' + pg.key; (KMED.man[k] = KMED.man[k] || []).push(m); });
  doc.dims.forEach(function(d){ if (d.auto) return; var m = kmBind(pg, d, true), k = m.home || 'pg:' + pg.key; (KMED.man[k] = KMED.man[k] || []).push(m); });
  kmLpos(pg); kmSaveEd();
}
function kmLb(pg, vid){ var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, n = 0;
  pg.doc.ents.forEach(function(e){ if (!e.auto || e.vid !== vid || e.t !== 'line') return; n++; [e.a, e.b].forEach(function(q){ x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }); });
  pg.vw[vid].lb = n ? { x0:x0, x1:x1, y0:y0, y1:y1 } : null; }
function kmLpos(pg){ var L = pg.lpos = {}; pg.doc.ents.forEach(function(e){ if (e.auto && e.vid && e.t === 'line') L[e.id] = [e.a.x, e.a.y]; }); }
// 図ごと 動かす：図の 自動の 線の 半分 以上を 選んで 動かす ときは、その 図の 寸法・文字・残りの 線も いっしょに
function kmMoveSet(es, ds){ if (!(BM && BM.active && BM.km)) return { e:[], d:[] };
  var tot = {}, sel = {}, ex = { e:[], d:[] }, inE = new Set(es), inD = new Set(ds);
  D.ents.forEach(function(e){ if (e.auto && e.vid && e.t === 'line') tot[e.vid] = (tot[e.vid] || 0) + 1; }); es.forEach(function(e){ if (e.auto && e.vid && e.t === 'line') sel[e.vid] = (sel[e.vid] || 0) + 1; });
  var vs = Object.keys(sel).filter(function(v){ return sel[v] >= tot[v] * 0.5; }); if (!vs.length) return ex;
  D.ents.forEach(function(e){ if (e.vid && vs.indexOf(e.vid) >= 0 && !inE.has(e)) { ex.e.push(e); ST.sel.add(e.id); } });
  D.dims.forEach(function(d){ if (d.vid && vs.indexOf(d.vid) >= 0 && !inD.has(d)) { ex.d.push(d); ST.dsel.add(d.id); } });
  return ex; }
function kmSaveEd(){ if (!KMED || !KM2) return; KMED.payT = KM2.pay.t; kmLs('zumen.kmEdit', KMED); if (BM && BM.main) BM.main.kmEdit = KMED; }

// ── ページの 一覧・作り直し ──
function kmPagesDef(){
  var L = [{ key:'site/iso', gen:'siteIso', title:'配置図 斜め' }, { key:'site/3v', gen:'site3', title:'配置図 三面' }];
  KM2.bundles.forEach(function(B){
    L.push({ key:B.id + '/table', gen:'table', title:B.title + ' 部品寸法表', B:B });
    L.push({ key:B.id + '/index', gen:'index', title:B.title + ' 加工指示図', B:B });
    for (var i = 0; i < B.groups.length; i += 2) { var gs = B.groups.slice(i, i + 2); L.push({ key:B.id + '/detail/' + gs.map(function(g){ return g.type; }).join('+'), gen:'detail', title:B.title + ' 詳細 ' + gs.map(function(g){ return g.no; }).join('・'), B:B, groups:gs }); }
  });
  return L;
}
function kmRegen(pg){
  var o = kmGen(pg); kmApply(pg, o);
  pg.doc.ents = o.ents; pg.doc.dims = o.dims;
  Object.keys(pg.vw).forEach(function(vid){ kmLb(pg, vid); }); kmLpos(pg);
}
function kmBuildAll(){
  var defs = kmPagesDef();
  BM.pages = defs.map(function(d, i){ return { key:d.key, gen:d.gen, title:d.title, kind:'km', B:d.B, groups:d.groups, no:i + 1, tot:defs.length, N:1, doc:bmNewDoc() }; });
  BM.pages.forEach(function(pg){ kmRegen(pg); });
  KM2.lost = []; BM.pages.forEach(function(pg){ KM2.lost = KM2.lost.concat(pg.lost || []); });
  // 図が どこにも 無い 手の 直し
  var have = {}; BM.pages.forEach(function(pg){ Object.keys(pg.vw).forEach(function(v){ have[v] = 1; }); have['pg:' + pg.key] = 1; });
  Object.keys(KMED.man).forEach(function(k){ if (!have[k] && KMED.man[k].length) KM2.lost.push({ pg:k, what:'手で 足した もの ' + KMED.man[k].length + ' 個（図が 無い）' }); });
}

// ── 入口：組み立てから ──
function kmLoadPay(){ var p = kmLs('kumitate.zumen'); return p && p.schema === 'kmz/1' ? p : null; }
function kmPrepare(pay){
  return import('./zumen-3d.js?v=' + APP_VER).then(function(mod){
    var geo = {};
    pay.parts.forEach(function(p){
      var g = null;
      if (p.shape && window.BZ) { try { g = mod.partGeo(BZ.model(p.shape, BZ.solve(p.shape))); } catch (e) { g = null; } }
      if (!g || !g.tris.length) g = kmBoxGeo(p.w, p.h, p.d);
      g.tan = kmTan(g.tris); geo[p.k] = g; });
    return geo;
  });
}
function kmBoxGeo(w, h, d){ var x = w / 2, z = d / 2, V = [[-x, 0, -z], [x, 0, -z], [x, h, -z], [-x, h, -z], [-x, 0, z], [x, 0, z], [x, h, z], [-x, h, z]];
  var F = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3], [1, 2, 6, 5], [3, 7, 6, 2], [0, 1, 5, 4]], tris = [], edges = [];
  F.forEach(function(f){ [[f[0], f[1], f[2]], [f[0], f[2], f[3]]].forEach(function(t){ t.forEach(function(i){ tris.push(V[i][0], V[i][1], V[i][2]); }); }); });
  [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(function(e){ edges.push([V[e[0]], V[e[1]]]); });
  return { tris:tris, edges:edges }; }
function kmEnter(again){
  var pay = kmLoadPay();
  if (!pay) { alert('組み立ての 画面で［📐 図面に する］を 押して ください'); return; }
  toastMsg('組み立ての 形から 図面を 作って います…', 8000);
  kmPrepare(pay).then(function(geo){
    var keep = KM2 && BM && BM.active && BM.km ? BM.cur : 0;
    if (KM2 && BM && BM.active && BM.km) BM.pages.forEach(kmHarvest);
    KMED = KMED || (BM && BM.main && BM.main.kmEdit) || (D && D.kmEdit) || kmLs('zumen.kmEdit') || {}; ['ov', 'vm', 'man', 'revs'].forEach(function(f){ KMED[f] = KMED[f] || {}; });
    if (!KMED.v) { // v0.8.7 の まちがい：図を 動かすと いっしょに 動かした 寸法が「その 場に 残す」と 覚えられて いた → 消す
      Object.keys(KMED.ov).forEach(function(aid){ var o = KMED.ov[aid], vid = Object.keys(KMED.vm).filter(function(v){ return aid.indexOf(v + '/') === 0; })[0]; if (!vid) return; var m = KMED.vm[vid];
        var bad = function(q){ return !q || (Math.abs(q[0] + m[0]) < 0.6 && Math.abs(q[1] + m[1]) < 0.6); };
        if ((o.doff || o.dp) && bad(o.doff) && bad(o.da) && bad(o.db) && bad(o.dp)) { ['doff', 'da', 'db', 'dp'].forEach(function(f){ delete o[f]; }); if (!Object.keys(o).length) delete KMED.ov[aid]; } });
      KMED.v = 2; }
    KM2 = { pay:pay, geo:geo }; KM2.bundles = kmBundles(pay);
    if (!(BM && BM.active)) { BM = { main:D, layers:null, pages:null, cur:0, active:true, km:true }; }
    BM.km = true; bmSetupLayers(); kmLayers();
    if (!BM.main.info) BM.main.info = {}; if (!BM.main.info.name && pay.name) BM.main.info.name = pay.name;
    kmBuildAll(); kmSaveEd();
    document.body.classList.add('bmode'); document.body.classList.add('kmmode');
    bmShow(Math.min(keep, BM.pages.length - 1), true);
    toastMsg(again ? '組み立ての 今の 形で 作り直しました（手の 直しは 当て直し）' + (KM2.lost.length ? '。付け先が 無い 直し ' + KM2.lost.length + ' 件' : '') : '図面を 作りました（' + BM.pages.length + ' ページ）', 5000);
  }).catch(function(e){ alert('図面を 作れませんでした：' + (e && e.message || e)); });
}
function kmLayers(){ var L = BM.layers; if (!L['隠れ線']) L['隠れ線'] = { name:'隠れ線', aci:8, css:'#666', on:true, gap:false, dash:true }; }
// 右の 欄（組み立てから 作った ページ）
function kmPanel(el){
  var pg = BM.pages[BM.cur], tpl = kmTpl(), h = '<h3>' + esc(pg.title) + '</h3><div class="bd">';
  h += '<div class="muted">組み立ての 形から 作った ページです。寸法・文字・図は 手で 動かす・直す・消す・足すが できます。<b>直した 所は 覚えて</b>、組み立てを 変えて 作り直しても 当て直します。</div>';
  h += '<div class="row"><button class="b2" id="kmRe">🔄 組み立ての 今の 形で 作り直す</button></div>';
  h += '<div class="row"><button class="b2" id="kmRev">△ 修正の 印を 置く</button></div>';
  var types = (pg.groups || []).map(function(g){ return g.type; });
  if (types.length) { h += '<div class="row"><button class="b2" id="kmTplSave">📌 この ページの 部材の 直しを ひな形に</button></div>';
    var on = types.filter(function(t){ return tpl[t]; }); if (on.length) h += '<div class="muted">ひな形 あり：' + on.map(function(t){ return esc(t.split('/').pop()); }).join('・') + '　<a href="#" id="kmTplDel">ひな形を 消す</a></div>'; }
  h += '<div class="row"><button class="b2" id="kmClr">この ページの 直しを 消す（自動に 戻す）</button></div>';
  var rv = KMED.revs[pg.key] || []; if (rv.length) h += '<div class="muted">修正：' + rv.map(function(q){ return '△' + q.n + ' ' + esc(q.s); }).join('／') + '</div>';
  if (KM2.lost && KM2.lost.length) h += '<div class="muted" style="color:#c03">付け先が 無い 直し ' + KM2.lost.length + ' 件：' + KM2.lost.slice(0, 6).map(function(q){ return esc(q.what) + '（' + esc(String(q.aid || q.pg)) + '）'; }).join('、') + '　<a href="#" id="kmLostClr">捨てる</a></div>';
  h += '</div>';
  el.innerHTML = h;
  document.getElementById('kmRe').onclick = function(){ kmEnter(true); };
  document.getElementById('kmRev').onclick = function(){ setTool('rev'); };
  document.getElementById('kmClr').onclick = function(){ if (!confirm('この ページの 手の 直し（動かした・消した・足した もの）を 消して 自動に 戻します')) return;
    Object.keys(pg.vw).forEach(function(v){ delete KMED.vm[v]; delete KMED.man[v]; Object.keys(KMED.ov).forEach(function(a){ if (a.indexOf(v + '/') === 0) delete KMED.ov[a]; }); });
    delete KMED.man['pg:' + pg.key]; Object.keys(KMED.ov).forEach(function(a){ if (a.indexOf(pg.key + '/') === 0) delete KMED.ov[a]; });
    pushUndo(); kmRegen(pg); D = pg.doc; kmSaveEd(); changed(); bmPages(); bmPanel(); };
  var ts = document.getElementById('kmTplSave'); if (ts) ts.onclick = function(){ kmHarvest(pg); var T = kmTpl();
    types.forEach(function(t){ var e = { ov:{}, vm:{}, man:{} }; Object.keys(KMED.ov).forEach(function(a){ if (a.indexOf(t + '/') === 0) e.ov[a] = KMED.ov[a]; });
      Object.keys(KMED.vm).forEach(function(v){ if (v.indexOf(t + '/') === 0) e.vm[v] = KMED.vm[v]; }); Object.keys(KMED.man).forEach(function(v){ if (v.indexOf(t + '/') === 0) e.man[v] = KMED.man[v]; }); T[t] = e; });
    kmLs('zumen.kmTpl', T); toastMsg('ひな形に 覚えました（ほかの 案件の 同じ 部材にも 使います）', 4000); bmPanel(); };
  var td = document.getElementById('kmTplDel'); if (td) td.onclick = function(ev){ ev.preventDefault(); var T = kmTpl(); types.forEach(function(t){ delete T[t]; }); kmLs('zumen.kmTpl', T); bmPanel(); };
  var lc = document.getElementById('kmLostClr'); if (lc) lc.onclick = function(ev){ ev.preventDefault(); KM2.lost.forEach(function(q){ if (q.aid) delete KMED.ov[q.aid]; else if (q.pg && KMED.man[q.pg] && !q.m) delete KMED.man[q.pg]; else if (q.m) Object.keys(KMED.man).forEach(function(k){ KMED.man[k] = KMED.man[k].filter(function(x){ return x !== q.m; }); }); }); KM2.lost = []; kmSaveEd(); bmPanel(); };
}
// 修正の △：置いた 所に △n、表題欄の 上に 番号・日付・内容
function kmRevAt(p){
  var pg = BM.pages[BM.cur], s = prompt('修正の 内容（表題欄に 出ます）', ''); if (s == null) return;
  var L = KMED.revs[pg.key] = KMED.revs[pg.key] || [], n = L.length + 1, dt = new Date(), ds = dt.getFullYear() + '-' + ('0' + (dt.getMonth() + 1)).slice(-2) + '-' + ('0' + dt.getDate()).slice(-2);
  L.push({ n:n, date:ds, s:s });
  pushUndo(); D.ents.push({ id:SEQ++, t:'text', p:P(p.x, p.y), h:3.2, rot:0, s:'△' + n, ha:1, va:2, wf:1, layer:'文字', css:null, aci:256 });
  kmHarvest(pg); kmRegen(pg); D = pg.doc; kmSaveEd(); changed(); bmPanel();
}

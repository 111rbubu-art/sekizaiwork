// 石の 図面（zumen.html）の 部材設計モード：3D の 表示（Three.js r160・同梱）
// 部材設計を 開いた ときだけ zumen.html から import() で 読む。形の 計算（外形・穴・筆返し）は zumen.html の BZ（部材エンジン）を 使う
import * as THREE from './lib/three-0.160.0/three.module.min.js';
import { OrbitControls } from './lib/three-0.160.0/OrbitControls.js?v=2';
import { TessellateModifier } from './lib/three-0.160.0/TessellateModifier.js';
import { Brush, Evaluator, INTERSECTION, SUBTRACTION } from './lib/three-bvh-csg-0.0.16/index.module.js';

// マウスの 操作を Fusion に そろえる：ホイール＝ズーム（マウスの 所へ）・中ボタン ドラッグ＝移動・Shift＋中ボタン＝回転・中ボタン 2 回＝全体。
// 左は 押して 選ぶ だけ（ドラッグしても 動かない）。右は 何も しない。指（タッチ）は 前の まま（1 本＝回転・2 本＝ズームと 移動）
export function fusionMouse(controls, el, onFit){
  controls.mouseButtons = { LEFT:-1, MIDDLE:THREE.MOUSE.PAN, RIGHT:-1 };   // PAN は Shift／Ctrl／⌘ で 回転（OrbitControls の きまり）
  controls.zoomToCursor = true; controls.screenSpacePanning = true;
  var t0 = 0;
  el.addEventListener('pointerdown', function(e){
    if (e.pointerType !== 'mouse' || e.button !== 1) return;
    e.preventDefault();   // Windows の 自動スクロールを 出さない
    var t = performance.now(); if (t - t0 < 350) { t0 = 0; if (onFit) onFit(); } else t0 = t;
  });
  el.addEventListener('mousedown', function(e){ if (e.button === 1) e.preventDefault(); });
  el.addEventListener('contextmenu', function(e){ e.preventDefault(); });
}
export function create(box){
  var renderer = new THREE.WebGLRenderer({ antialias:true, preserveDrawingBuffer:true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0xffffff);
  box.appendChild(renderer.domElement);
  renderer.domElement.style.touchAction = 'none';
  var scene = new THREE.Scene();
  var cam = new THREE.PerspectiveCamera(35, 1, 1, 20000);
  var controls = new OrbitControls(cam, renderer.domElement);
  controls.enableDamping = true;
  fusionMouse(controls, renderer.domElement, function(){ refit(); });
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.6));
  var dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(400, 700, 600); scene.add(dl);
  var dl2 = new THREE.DirectionalLight(0xffffff, 0.5); dl2.position.set(-500, 200, -300); scene.add(dl2);
  var mat = new THREE.MeshStandardMaterial({ color:0xb8bec6, roughness:0.3, metalness:0.05, flatShading:true, polygonOffset:true, polygonOffsetFactor:1, polygonOffsetUnits:1, side:THREE.DoubleSide });
  var lineMat = new THREE.LineBasicMaterial({ color:0x1a1a1a });
  var group = null, fitted = false, alive = true, timer = 0, last = null;

  function build(m, fine){
    last = m;
    if (group) { group.traverse(function(o){ if (o.geometry) o.geometry.dispose(); }); scene.remove(group); }
    group = partGroup(m, fine, mat, lineMat); scene.add(group);
    controls.target.set(0, m.H / 2, 0);
    if (!fitted) { // 外接球が 画面に 収まる 距離（縦長の 枠でも はみ出さない）
      var rs = 0.5 * Math.sqrt(m.W * m.W + m.H * m.H + m.D * m.D), fv = cam.fov * Math.PI / 180, fh = 2 * Math.atan(Math.tan(fv / 2) * cam.aspect);
      var dist = rs / Math.sin(Math.min(fv, fh) / 2) * 1.05, dir = new THREE.Vector3(0.95, 0.75, 1.55).normalize();
      cam.position.set(dir.x * dist, m.H / 2 + dir.y * dist, dir.z * dist); fitted = true; }
  }
  // 操作中は 粗く、0.3 秒 止まったら 細かく 作り直す（スマホでも 軽く）
  function update(m){ build(m, false); clearTimeout(timer); timer = setTimeout(function(){ if (alive) build(m, true); }, 300); }
  function resize(){ var w = box.clientWidth, h = box.clientHeight; if (!w || !h) return; renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); }
  function loop(){ if (!alive) return; requestAnimationFrame(loop); controls.update(); renderer.render(scene, cam); }
  function refit(){ fitted = false; if (last) build(last, true); }
  function dispose(){ alive = false; clearTimeout(timer); if (group) group.traverse(function(o){ if (o.geometry) o.geometry.dispose(); }); renderer.dispose(); if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement); }
  window.addEventListener('resize', resize);
  resize(); loop();
  return { build:build, update:update, resize:resize, refit:refit, dispose:dispose };
}

// 形の かどの 線（CSG の 答え 用）。CSG の 答えは T 字の つなぎ（となりの 面の 辺が 途中で 切れる）が 多いので、
// 辺の 上に のる 点で 辺を 小さく 切って から となりの 面を 見る（片側の 辺が 抜けて 破線に ならない）。細すぎる 三角は 見ない。
// 角度が deg 以上の 所は 線に する。まっすぐ 続く 小さい 辺は 1 本に つなぐ
export function featureEdges(geo, deg){
  var pos = geo.attributes.position, idx = geo.index, n = idx ? idx.count : pos.count, cosT = Math.cos(deg * Math.PI / 180);
  geo.computeBoundingBox(); var bb = geo.boundingBox, sc = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z) || 1, q = sc * 1e-5, tol = sc * 1e-3;
  function P(i){ var j = idx ? idx.getX(i) : i; return [pos.getX(j), pos.getY(j), pos.getZ(j)]; }
  // 点を まとめる
  // 点を まとめる：CSG の 答えは 同じ 点が 少し（0.1mm ほど）ずれて 別の 点に なる ことが ある（線が 途切れる）。tol の 半分 以内は 同じ 点に する
  var VK = {}, V = [], rw = tol * 0.5;
  function vid(p){ var gx = Math.floor(p[0] / rw), gy = Math.floor(p[1] / rw), gz = Math.floor(p[2] / rw);
    for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) for (var dz = -1; dz <= 1; dz++) { var L = VK[(gx + dx) + ',' + (gy + dy) + ',' + (gz + dz)]; if (!L) continue;
      for (var i = 0; i < L.length; i++) { var o = V[L[i]]; if (Math.abs(o[0] - p[0]) <= rw && Math.abs(o[1] - p[1]) <= rw && Math.abs(o[2] - p[2]) <= rw) return L[i]; } }
    var k = gx + ',' + gy + ',' + gz; (VK[k] = VK[k] || []).push(V.length); V.push(p); return V.length - 1; }
  var cs = Math.max(tol * 4, sc / 200), G = {};
  function ck(x, y, z){ return x + ',' + y + ',' + z; }
  var T = [];
  for (var t = 0; t + 2 < n; t += 3) {
    var a = P(t), b = P(t + 1), c = P(t + 2), ia = vid(a), ib = vid(b), ic = vid(c); if (ia === ib || ib === ic || ic === ia) continue;
    var u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    var nr = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], L = Math.hypot(nr[0], nr[1], nr[2]); if (!(L > 0)) continue;
    var m2 = Math.max(u[0] * u[0] + u[1] * u[1] + u[2] * u[2], w[0] * w[0] + w[1] * w[1] + w[2] * w[2], (c[0] - b[0]) * (c[0] - b[0]) + (c[1] - b[1]) * (c[1] - b[1]) + (c[2] - b[2]) * (c[2] - b[2]));
    var nn = [nr[0] / L, nr[1] / L, nr[2] / L];
    T.push({ v:[ia, ib, ic], n:nn, thin:L / Math.sqrt(m2) < q, pl:nn.map(function(x){ return Math.round(x * 200); }).join(',') + '|' + Math.round((nn[0] * a[0] + nn[1] * a[1] + nn[2] * a[2]) / (tol * 2)) });
  }
  V.forEach(function(p, i){ var k = ck(Math.floor(p[0] / cs), Math.floor(p[1] / cs), Math.floor(p[2] / cs)); (G[k] = G[k] || []).push(i); });
  // 辺の 上に ある 点で 辺を 切る（T 字の つなぎを なくす）→ 小さい 辺どうしで となりの 面を 見る
  var SPL = {}, E = {}, SEEN = new Int32Array(V.length), stamp = 0;
  function split(i0, i1){ var k = i0 < i1 ? i0 + '|' + i1 : i1 + '|' + i0; if (SPL[k]) return SPL[k];
    var a = V[i0], b = V[i1], d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2], on = [[0, i0], [1, i1]], seenC = {}; stamp++;
    var lo = [Math.min(a[0], b[0]) - tol, Math.min(a[1], b[1]) - tol, Math.min(a[2], b[2]) - tol], hi = [Math.max(a[0], b[0]) + tol, Math.max(a[1], b[1]) + tol, Math.max(a[2], b[2]) + tol];
    var len = Math.sqrt(l2), m = Math.max(1, Math.ceil(len / cs));
    for (var s = 0; s <= m; s++) { var x = a[0] + d[0] * s / m, y = a[1] + d[1] * s / m, z = a[2] + d[2] * s / m, gx = Math.floor(x / cs), gy = Math.floor(y / cs), gz = Math.floor(z / cs);
      for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) for (var dz = -1; dz <= 1; dz++) { var cc = ck(gx + dx, gy + dy, gz + dz); if (seenC[cc]) continue; seenC[cc] = 1; var L = G[cc]; if (!L) continue;
        for (var j = 0; j < L.length; j++) { var vi = L[j]; if (SEEN[vi] === stamp || vi === i0 || vi === i1) continue; SEEN[vi] = stamp; var p = V[vi];
          if (p[0] < lo[0] || p[0] > hi[0] || p[1] < lo[1] || p[1] > hi[1] || p[2] < lo[2] || p[2] > hi[2]) continue;
          var tt = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / l2; if (tt <= 0 || tt >= 1) continue;
          if (Math.hypot(a[0] + d[0] * tt - p[0], a[1] + d[1] * tt - p[1], a[2] + d[2] * tt - p[2]) > tol) continue; on.push([tt, vi]); } } }
    on.sort(function(x, y){ return x[0] - y[0]; }); var r = []; for (var i = 0; i + 1 < on.length; i++) r.push([on[i][1], on[i + 1][1]]); SPL[k] = r; return r; }
  // 両側に 面が ある 辺は そのまま（切るのは 片側だけの 辺。速さの ため）
  var CNT = {}; T.forEach(function(tr){ if (tr.thin) return; for (var e = 0; e < 3; e++) { var i0 = tr.v[e], i1 = tr.v[(e + 1) % 3], k = i0 < i1 ? i0 + '|' + i1 : i1 + '|' + i0; CNT[k] = (CNT[k] || 0) + 1; } });
  T.forEach(function(tr){ if (tr.thin) return; for (var e = 0; e < 3; e++) { var i0 = tr.v[e], i1 = tr.v[(e + 1) % 3]; (CNT[i0 < i1 ? i0 + '|' + i1 : i1 + '|' + i0] >= 2 ? [[i0, i1]] : split(i0, i1)).forEach(function(se){ var k = se[0] < se[1] ? se[0] + '|' + se[1] : se[1] + '|' + se[0]; var o = E[k] = E[k] || { a:se[0], b:se[1], n:[], pl:[] }; o.n.push(tr.n); o.pl.push(tr.pl); }); } });
  // 浅い 角（1°〜deg）のきまり（本人）：平らな 面から 曲面に 変わる 所は 線を 入れる、曲面＋曲面は 角度 しだい（deg 以上で 線）。
  // 曲面の 1 枚＝その 辺に 直角の 向きの 幅が 細い 平らな 面（形の 大きさの 8% 未満）。両側とも 細い 面なら 線に しない
  //（浅い 面取り 9×4.5・水ダレ・R の 始まりは 線、円柱の 穴・胴の 帯・拝みの 割れ目は 線なし）
  var S = [], soft = [], cosM = Math.cos(1 * Math.PI / 180), RV = {}, RN = {}, WC = {}, lim = sc * 0.08;
  T.forEach(function(tr){ if (tr.thin) return; var L = RV[tr.pl] = RV[tr.pl] || {}; RN[tr.pl] = tr.n; L[tr.v[0]] = L[tr.v[1]] = L[tr.v[2]] = 1; });
  Object.keys(RV).forEach(function(k){ RV[k] = Object.keys(RV[k]).map(Number); });
  function narrow(R, d){ var n = RN[R], pp = [n[1] * d[2] - n[2] * d[1], n[2] * d[0] - n[0] * d[2], n[0] * d[1] - n[1] * d[0]], l = Math.hypot(pp[0], pp[1], pp[2]); if (!(l > 1e-9)) return false;
    pp = [pp[0] / l, pp[1] / l, pp[2] / l]; var ck2 = R + '#' + pp.map(function(x){ return Math.round(x * 50); }).join(','); if (WC[ck2] !== undefined) return WC[ck2];
    var lo = Infinity, hi = -Infinity; RV[R].forEach(function(vi){ var q = V[vi], t = q[0] * pp[0] + q[1] * pp[1] + q[2] * pp[2]; if (t < lo) lo = t; if (t > hi) hi = t; });
    return WC[ck2] = hi - lo < lim; }
  Object.keys(E).forEach(function(k){ var e = E[k], N = e.n, best = 1, bi = -1, bj = -1;
    if (N.length < 2) return;
    for (var i = 0; i < N.length; i++) for (var j = i + 1; j < N.length; j++) { var dd = N[i][0] * N[j][0] + N[i][1] * N[j][1] + N[i][2] * N[j][2]; if (dd < best) { best = dd; bi = i; bj = j; } }
    if (best < cosT) { S.push([e.a, e.b]); return; }
    var A = e.pl[bi], B = e.pl[bj]; if (A === B) return;
    if (best < cosM) { var d = dir(e.a, e.b); if (!(narrow(A, d) && narrow(B, d))) { S.push([e.a, e.b]); return; } }
    var P = V[e.a], Q = V[e.b]; soft.push(P[0], P[1], P[2], Q[0], Q[1], Q[2], N[bi][0], N[bi][1], N[bi][2], N[bj][0], N[bj][1], N[bj][2]); });
  // まっすぐ 続く 小さい 辺は 1 本に つなぐ（図面化の 隠れ線で 短い 切れ端が 落ちて 破線に ならない ように）
  var AT = {}; S.forEach(function(s, i){ (AT[s[0]] = AT[s[0]] || []).push(i); (AT[s[1]] = AT[s[1]] || []).push(i); });
  function dir(i0, i1){ var a = V[i0], b = V[i1], d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(d[0], d[1], d[2]) || 1; return [d[0] / l, d[1] / l, d[2] / l]; }
  var used = new Uint8Array(S.length), arr = [];
  function grow(s0, end, dv){ var cur = end;
    for (;;) { var L = AT[cur]; if (!L || L.length !== 2) return cur; var nx = used[L[0]] ? L[1] : L[0]; if (used[nx]) return cur;
      var o = S[nx][0] === cur ? S[nx][1] : S[nx][0], d2 = dir(cur, o); if (d2[0] * dv[0] + d2[1] * dv[1] + d2[2] * dv[2] < 0.99995) return cur; used[nx] = 1; cur = o; } }
  S.forEach(function(s, i){ if (used[i]) return; used[i] = 1; var dv = dir(s[0], s[1]), b = grow(i, s[1], dv), a = grow(i, s[0], [-dv[0], -dv[1], -dv[2]]), A = V[a], B = V[b]; arr.push(A[0], A[1], A[2], B[0], B[1], B[2]); });
  var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  g.userData.soft = soft;   // 線に しない なめらかな 辺（[a, b, 法線1, 法線2] を 12 個ずつ）。図面化で 見る 向きの 輪郭に 使う
  return g;
}

// 部材の 形（BZ.model の 答え m）→ Three の Group。原点＝底面の 中心、+z＝前。組み立て（kumitate-3d.js）からも 使う
// 角度が deg より 小さい 面どうしは 法線を ならす（R の 面を なめらかに 見せる。角は そのまま）
function creased(geo, deg){
  if (geo.index) geo = geo.toNonIndexed();
  var pos = geo.attributes.position, n = pos.count, cosT = Math.cos(deg * Math.PI / 180), fn = [], map = {}, out = new Float32Array(n * 3);
  var a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (var t = 0; t < n / 3; t++) {
    a.fromBufferAttribute(pos, t * 3); b.fromBufferAttribute(pos, t * 3 + 1); c.fromBufferAttribute(pos, t * 3 + 2);
    var nn = new THREE.Vector3().subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)); var ar = nn.length(); fn.push(ar > 0 ? nn.divideScalar(ar) : nn); fn[t].ar = ar;
  }
  function key(i){ return Math.round(pos.getX(i) * 100) + ',' + Math.round(pos.getY(i) * 100) + ',' + Math.round(pos.getZ(i) * 100); }
  for (var i = 0; i < n; i++) { var k = key(i); (map[k] = map[k] || []).push(i); }
  for (var i = 0; i < n; i++) {
    var f0 = fn[(i / 3) | 0], acc = new THREE.Vector3();
    map[key(i)].forEach(function(j){ var f = fn[(j / 3) | 0]; if (f.dot(f0) >= cosT) acc.addScaledVector(f, f.ar); });
    if (acc.lengthSq() === 0) acc.copy(f0); acc.normalize(); out[i * 3] = acc.x; out[i * 3 + 1] = acc.y; out[i * 3 + 2] = acc.z;
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(out, 3)); return geo;
}
export function partGroup(m, fine, mat, lineMat){
  var group = new THREE.Group();
  function shp(pts){ var s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (var i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]); s.closePath(); return s; }
  function pth(pts){ var s = new THREE.Path(); s.moveTo(pts[0][0], pts[0][1]); for (var i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]); s.closePath(); return s; }
  function add(geo, edges){ geo.computeVertexNormals(); group.add(new THREE.Mesh(geo, mat)); if (edges) group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 28), lineMat)); }
  function line(pts3, loop){ var g = new THREE.BufferGeometry().setFromPoints(pts3.map(function(p){ return new THREE.Vector3(p[0], p[1], p[2]); })); group.add(loop ? new THREE.LineLoop(g, lineMat) : new THREE.Line(g, lineMat)); }
  function mk(a){ var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(a, 3)); return g; }

  // 樽型（胴＋上下の首）。前側（穴あり）と 奥の壁 に 分ける。前面の 膨らみは 奥行の 位置に 比例して 下げる（バリが 出ない）
  function barrel(c, BZ, zf, fine){
    var s = c.s, y0 = c.at.y, dF = s.d - s.back, zb = zf - s.d, zw = zb + s.back;
    var out = BZ.barrelOutline(s, 60), hole = c.cuts && c.cuts[0] ? BZ.holePts(c.cuts[0].s, 40) : null;
    var s1 = shp(out); if (hole) s1.holes.push(pth(hole));
    var g0 = new THREE.ExtrudeGeometry(s1, { depth:dF, bevelEnabled:false, steps:1 });
    var P = g0.attributes.position.array, capA = [], restA = [];
    for (var i = 0; i < P.length; i += 9) {
      var isCap = Math.abs(P[i + 2] - dF) < 1e-6 && Math.abs(P[i + 5] - dF) < 1e-6 && Math.abs(P[i + 8] - dF) < 1e-6;
      var dst = isCap ? capA : restA; for (var k = 0; k < 9; k++) dst.push(P[i + k]);
    }
    g0.dispose();
    var gc = mk(capA), gr = mk(restA), bul = s.front > 0.01;
    if (bul) {
      gc = new TessellateModifier(Math.max(s.w, s.nb + s.b + s.nt) / (fine ? 110 : 35), 60).modify(gc);
      [gc, gr].forEach(function(g){ var p = g.attributes.position; for (var j = 0; j < p.count; j++) { var z = p.getZ(j); p.setZ(j, z * (dF - BZ.inset(p.getY(j), s.front, s)) / dF); } });
    }
    add(gc.translate(0, y0, zw), false); add(gr.translate(0, y0, zw), false);
    var zfy = function(y){ return zf - (bul ? BZ.inset(y, s.front, s) : 0); };
    line(out.map(function(p){ return [p[0], p[1] + y0, zfy(p[1])]; }), true);
    if (hole) line(hole.map(function(p){ return [p[0], p[1] + y0, zfy(p[1])]; }), true);
    line(out.map(function(p){ return [p[0], p[1] + y0, zb]; }), true);
    [s.nb, s.nb + s.b].forEach(function(y){
      var x = s.w / 2 - s.side;
      [-1, 1].forEach(function(sx){ line([[sx * x, y + y0, zb], [sx * x, y + y0, zfy(y)]]); });
      if (bul) line([[-x, y + y0, zfy(y)], [x, y + y0, zfy(y)]]);
    });
    var top = s.nb + s.b + s.nt;
    [-1, 1].forEach(function(sx){ line([[sx * s.w / 2, y0, zb], [sx * s.w / 2, y0, zf]]); line([[sx * s.w / 2, y0 + top, zb], [sx * s.w / 2, y0 + top, zf]]); });
    add(new THREE.ExtrudeGeometry(shp(out), { depth:s.back, bevelEnabled:false }).translate(0, y0, zb), false);
    if (hole) line(hole.map(function(p){ return [p[0], p[1] + y0, zw]; }), true);
  }

  // 図から 作った 部材（正面・側面・天面の 外形を 重ねる。穴は 上・前から 掘る）
  // 図の 座標：正面 [x,y]（x＝左右 中心 0・y＝下 0）、側面 [d,y]（d＝前から 奥へ）、天面 [x,d]
  function views(c, zf){
    var v = c.views, W = m.W, Dd = m.D, H = m.H, mg = Math.max(W, Dd, H) * 0.05 + 1;
    function ext(out, holes, depth){ var sh = shp(out); (holes || []).forEach(function(h){ sh.holes.push(pth(h)); }); return new THREE.ExtrudeGeometry(sh, { depth:depth, bevelEnabled:false, curveSegments:1 }); }
    function brush(g){ var b = new Brush(g); b.updateMatrixWorld(); return b; }
    var ev = new Evaluator(); ev.attributes = ['position', 'normal']; ev.useGroups = false;
    var gF = ext(v.front.out, null, Dd).translate(0, 0, zf - Dd);
    var res = brush(gF);
    if (v.side && v.side.out) { var gS = ext(v.side.out, null, W + 2 * mg); gS.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, -W / 2 - mg, 0, 1, 0, 0, -1, 0, 0, zf, 0, 0, 0, 1)); res = ev.evaluate(res, brush(gS), INTERSECTION); }
    if (v.top && v.top.out) { var gT = ext(v.top.out, null, H + 2 * mg); gT.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, -mg, 0, -1, 0, zf, 0, 0, 0, 1)); res = ev.evaluate(res, brush(gT), INTERSECTION); }
    (v.top && v.top.holes || []).forEach(function(h){ var g = ext(h.pts, null, h.depth + mg); g.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, H - h.depth, 0, -1, 0, zf, 0, 0, 0, 1)); res = ev.evaluate(res, brush(g), SUBTRACTION); });
    // 上下の 削り（top.cuts：[x,d] を 高さ y0〜y1 で。底からの 耐震穴・中空など）
    (v.top && v.top.cuts || []).forEach(function(h){ var y0 = h.y0 <= 0 ? -mg : h.y0, y1 = h.y1 >= H ? H + mg : h.y1; if (!(y1 > y0)) return; var g = ext(h.pts, null, y1 - y0); g.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, y0, 0, -1, 0, zf, 0, 0, 0, 1)); res = ev.evaluate(res, brush(g), SUBTRACTION); });
    // 前の 穴（from:'back' は 後ろの 面から）。図は 前から 見た 座標の まま
    // ogami（拝み）：前の 面 d0 から 奥 depth へ 行くほど 低く なる 逃げ（1/4 円で 高さ 0 へ）。穴の 形は そのまま 下の 線へ 縮む
    (v.front.holes || []).forEach(function(h){ var g = h.ogami ? ogamiGeo(h) : ext(h.pts, null, h.depth + mg).translate(0, 0, h.from === 'back' ? zf - Dd - mg : zf - h.depth); res = ev.evaluate(res, brush(g), SUBTRACTION); });
    function ogamiGeo(h){
      var P = h.pts.slice(), n = P.length, a2 = 0; for (var i = 0; i < n; i++) { var j = (i + 1) % n; a2 += P[i][0] * P[j][1] - P[j][0] * P[i][1]; } if (a2 < 0) P.reverse();
      var yb = Math.min.apply(null, P.map(function(q){ return q[1]; })), y0 = Math.max(yb, 0), d0 = h.d0 || 0, L = Math.max(h.depth - d0, 1), N = 16, back = h.from === 'back';
      function zz(d){ return back ? zf - Dd + d : zf - d; }
      var rings = [{ z:zz(-mg), k:1 }, { z:zz(d0), k:1 }];
      for (var s = 1; s <= N; s++) { var th = s / N * Math.PI / 2; rings.push({ z:zz(d0 + L * Math.sin(th)), k:Math.max(Math.cos(th), 0.004) }); }   // 1/4 円を 角度で 等分（終わりの 急な 所も 細かく。面の ねじれで 線が 出ない ように）
      var R = rings.map(function(r){ return P.map(function(q){ return [q[0], q[1] > y0 ? y0 + (q[1] - y0) * r.k : q[1], r.z]; }); });
      var tri = [], T = THREE.ShapeUtils.triangulateShape(P.map(function(q){ return new THREE.Vector2(q[0], q[1]); }), []);
      T.forEach(function(f){ tri.push([R[0][f[0]], R[0][f[2]], R[0][f[1]]]); var L2 = R[R.length - 1]; tri.push([L2[f[0]], L2[f[1]], L2[f[2]]]); });
      for (var r = 0; r + 1 < R.length; r++) for (var i2 = 0; i2 < n; i2++) { var j2 = (i2 + 1) % n, A = R[r][i2], B = R[r][j2], C = R[r + 1][j2], D2 = R[r + 1][i2]; tri.push([A, B, C]); tri.push([A, C, D2]); }
      var vol = 0; tri.forEach(function(t){ var a = t[0], b = t[1], c = t[2]; vol += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]); });
      var arr = []; tri.forEach(function(t){ (vol < 0 ? [t[0], t[2], t[1]] : t).forEach(function(p){ arr.push(p[0], p[1], p[2]); }); });
      var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); g.computeVertexNormals(); return g;
    }
    // 横の 穴（side.holes：[d,y]、from:'left'｜'right' の 面から depth）・横から 見た 形で 削る（side.cuts：[d,y] を x0〜x1 で。面取りの 飾りの 線など）
    function sideM(x0){ return new THREE.Matrix4().set(0, 0, 1, x0, 0, 1, 0, 0, -1, 0, 0, zf, 0, 0, 0, 1); }
    (v.side && v.side.holes || []).forEach(function(h){ var g = ext(h.pts, null, h.depth + mg); g.applyMatrix4(sideM(h.from === 'left' ? -W / 2 - mg : W / 2 - h.depth)); res = ev.evaluate(res, brush(g), SUBTRACTION); });
    (v.side && v.side.cuts || []).forEach(function(h){ var g = h.taper ? taperCut(h) : ext(h.pts, null, h.x1 - h.x0); if (!h.taper) g.applyMatrix4(sideM(h.x0)); res = ev.evaluate(res, brush(g), SUBTRACTION); });
    // 両端で 細く なって 消える 削り（taper＝両端の 長さ、apex＝消える 点の 番号）：x0〜x1 は 断面の まま、その 外 taper で 点へ
    function taperCut(h){
      var P = h.pts, ap = P[h.apex || 0], xa = h.x0 - h.taper, xb = h.x1 + h.taper;
      function w(x, q){ return [x, q[1], zf - q[0]]; }
      var A = w(xa, ap), B = w(xb, ap), t1 = P.map(function(q){ return w(h.x0, q); }), t2 = P.map(function(q){ return w(h.x1, q); }), n = P.length, tri = [];
      for (var i = 0; i < n; i++) { var j = (i + 1) % n;
        tri.push([A, t1[i], t1[j]]); tri.push([t1[i], t2[i], t2[j]]); tri.push([t1[i], t2[j], t1[j]]); tri.push([B, t2[j], t2[i]]); }
      var vol = 0; tri.forEach(function(t){ var a = t[0], b = t[1], c = t[2]; vol += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]); });
      var arr = []; tri.forEach(function(t){ (vol < 0 ? [t[0], t[2], t[1]] : t).forEach(function(p){ arr.push(p[0], p[1], p[2]); }); });
      var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); g.computeVertexNormals(); return g;
    }
    // 天面から 見た 形で 高さ y0〜y1 を 削る（top.cuts：[x,d]。角の 欠きなど）
    (v.top && v.top.cuts || []).forEach(function(h){ var g = ext(h.pts, null, h.y1 - h.y0); g.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, h.y0, 0, -1, 0, zf, 0, 0, 0, 1)); res = ev.evaluate(res, brush(g), SUBTRACTION); });
    var geo = res.geometry; geo.translate(0, c.at.y, 0); geo = creased(geo, 20);   // 20°：浅い 面取り（9×4.5＝27°）は 角に 見せる
    group.add(new THREE.Mesh(geo, mat)); group.add(new THREE.LineSegments(featureEdges(geo, 30), lineMat));
  }

  var BZ = m.BZ, D = m.D;
  m.comps.forEach(function(c){
    var zf = D / 2 - (c.at.front || 0), s = c.s;
    if (c.type === 'box') add(new THREE.BoxGeometry(s.w, s.h, s.d).translate(0, c.at.y + s.h / 2, zf - s.d / 2), true);
    else if (c.type === 'barrel') barrel(c, BZ, zf, fine);
    else if (c.type === 'views') { try { views(c, zf); } catch (e) { console.error(e); add(new THREE.BoxGeometry(m.W, m.H, m.D).translate(0, m.H / 2, zf - m.D / 2), true); } }
    else if (c.type === 'profile') {
      (c.mirror === 'x' ? [-1, 1] : [1]).forEach(function(sg){
        add(new THREE.ExtrudeGeometry(shp(BZ.profilePts(c.profile, s, m.W, sg)), { depth:s.len, bevelEnabled:false }).translate(0, c.at.y, zf - s.len), true);
      });
    }
  });
  return group;
}

// 図面化（組み立て → 加工図）用：部材の 形の 三角（平らな 配列 x,y,z…）と かどの 線（[[x,y,z],[x,y,z]] の 組）。原点＝底面の 中心、+z＝前
export function partGeo(m){
  var g = partGroup(m, true, new THREE.MeshBasicMaterial(), new THREE.LineBasicMaterial()), tris = [], edges = [], v = new THREE.Vector3();
  g.updateMatrixWorld(true);
  var soft = [], v2 = new THREE.Vector3();
  g.traverse(function(o){
    if (o.isLineSegments && o.geometry.userData.soft) { var S2 = o.geometry.userData.soft; for (var si = 0; si < S2.length; si += 12) {
      v.set(S2[si], S2[si + 1], S2[si + 2]).applyMatrix4(o.matrixWorld); v2.set(S2[si + 3], S2[si + 4], S2[si + 5]).applyMatrix4(o.matrixWorld); soft.push(v.x, v.y, v.z, v2.x, v2.y, v2.z);
      v.set(S2[si + 6], S2[si + 7], S2[si + 8]).transformDirection(o.matrixWorld); v2.set(S2[si + 9], S2[si + 10], S2[si + 11]).transformDirection(o.matrixWorld); soft.push(v.x, v.y, v.z, v2.x, v2.y, v2.z); } }
    if (o.isMesh) { var geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry, p = geo.attributes.position;
      for (var i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); tris.push(v.x, v.y, v.z); } }
    else if (o.isLine) { var q = o.geometry.attributes.position, pts = [];
      for (var j = 0; j < q.count; j++) { v.fromBufferAttribute(q, j).applyMatrix4(o.matrixWorld); pts.push([v.x, v.y, v.z]); }
      if (o.isLineSegments) { for (var k = 0; k + 1 < pts.length; k += 2) edges.push([pts[k], pts[k + 1]]); }
      else { for (var k2 = 0; k2 + 1 < pts.length; k2++) edges.push([pts[k2], pts[k2 + 1]]); if (o.isLineLoop && pts.length > 2) edges.push([pts[pts.length - 1], pts[0]]); } }
  });
  g.traverse(function(o){ if (o.geometry) o.geometry.dispose(); });
  return { tris:tris, edges:edges, soft:soft };
}

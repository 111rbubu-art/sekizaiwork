// 石の 図面（zumen.html）の 部材設計モード：3D の 表示（Three.js r160・同梱）
// 部材設計を 開いた ときだけ zumen.html から import() で 読む。形の 計算（外形・穴・筆返し）は zumen.html の BZ（部材エンジン）を 使う
import * as THREE from './lib/three-0.160.0/three.module.min.js';
import { OrbitControls } from './lib/three-0.160.0/OrbitControls.js';
import { TessellateModifier } from './lib/three-0.160.0/TessellateModifier.js';
import { Brush, Evaluator, INTERSECTION, SUBTRACTION } from './lib/three-bvh-csg-0.0.16/index.module.js';

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

// 形の かどの 線（CSG の 答え 用）。EdgesGeometry は 三角が 片側に しか ない 辺（T 字の つなぎ目）を 全部 線に して しまい
// 曲面に すじが 出る。片側だけの 辺は、その 上の 何点かで 隣の 三角を 探し、なめらかに つながって いれば 描かない
export function featureEdges(geo, deg){
  var pos = geo.attributes.position, idx = geo.index, n = idx ? idx.count : pos.count, cosT = Math.cos(deg * Math.PI / 180);
  geo.computeBoundingBox(); var bb = geo.boundingBox, sc = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z) || 1, q = sc * 1e-5, tol = sc * 1e-3;
  function V(i){ var j = idx ? idx.getX(i) : i; return [pos.getX(j), pos.getY(j), pos.getZ(j)]; }
  function key(p){ return Math.round(p[0] / q) + ',' + Math.round(p[1] / q) + ',' + Math.round(p[2] / q); }
  function dot(x, y){ return x[0] * y[0] + x[1] * y[1] + x[2] * y[2]; }
  var E = {}, all = [], out = [];
  for (var t = 0; t + 2 < n; t += 3) {
    var a = V(t), b = V(t + 1), c = V(t + 2), u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    var nr = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], L = Math.hypot(nr[0], nr[1], nr[2]);
    if (L < q * q) continue; nr = [nr[0] / L, nr[1] / L, nr[2] / L];
    var m2 = Math.max(dot(u, u), dot(w, w), (c[0] - b[0]) * (c[0] - b[0]) + (c[1] - b[1]) * (c[1] - b[1]) + (c[2] - b[2]) * (c[2] - b[2]));
    var thin = L / Math.sqrt(m2) < sc * 1e-3; // 高さが ほとんど ない 三角（向きが あてに ならない）
    [[a, b], [b, c], [c, a]].forEach(function(e){ var k1 = key(e[0]), k2 = key(e[1]); if (k1 === k2) return; var k = k1 < k2 ? k1 + '|' + k2 : k2 + '|' + k1;
      (E[k] = E[k] || { p:e, n:[], t:[], th:[] }).n.push(nr); E[k].t.push(t); E[k].th.push(thin); all.push({ a:e[0], b:e[1], n:nr, t:t, thin:thin }); });
  }
  // 辺の 升目（近くの 辺を すぐ 探す）
  var cs = sc / 80, G = {};
  function ck(p){ return Math.floor(p[0] / cs) + ',' + Math.floor(p[1] / cs) + ',' + Math.floor(p[2] / cs); }
  all.forEach(function(f){ var d = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1], f.b[2] - f.a[2]), m = Math.max(1, Math.ceil(d / (cs * 0.5))), seen = {};
    for (var i = 0; i <= m; i++) { var s = i / m, k = ck([f.a[0] + (f.b[0] - f.a[0]) * s, f.a[1] + (f.b[1] - f.a[1]) * s, f.a[2] + (f.b[2] - f.a[2]) * s]); if (seen[k]) continue; seen[k] = 1; (G[k] = G[k] || []).push(f); } });
  function dseg(p, a, b){ var ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l2 = dot(ab, ab), s = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / l2)) : 0;
    return Math.hypot(p[0] - a[0] - ab[0] * s, p[1] - a[1] - ab[1] * s, p[2] - a[2] - ab[2] * s); }
  function smoothAt(p, e){ var L = G[ck(p)] || [], found = false;
    for (var i = 0; i < L.length; i++) { var f = L[i]; if (e.t.indexOf(f.t) >= 0 || f.thin) continue; if (dseg(p, f.a, f.b) > tol) continue; found = true; if (dot(e.n[0], f.n) >= cosT) return 1; }
    return found ? -1 : 0; } // 1＝なめらか、-1＝角、0＝相手 なし
  Object.keys(E).forEach(function(k){ var e = E[k];
    var ok = e.n.filter(function(_, i){ return !e.th[i]; });
    if (ok.length >= 2) { for (var i = 1; i < ok.length; i++) if (dot(ok[0], ok[i]) < cosT) { out.push(e.p[0], e.p[1]); return; } return; }
    if (!ok.length) return; // 高さの ない 三角 だけの 辺は 描かない
    // 片側だけの 辺：3 点で となりを 探し、角の 所が あって なめらかな 所が ない ときだけ 描く（となりが 見つからない＝すき間 だけ なら 描かない）
    var a = e.p[0], b = e.p[1], sharp = 0, smooth = 0, e1 = { n:ok, t:e.t };
    [0.2, 0.5, 0.8].forEach(function(s){ var r = smoothAt([a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s], e1); if (r === -1) sharp++; if (r === 1) smooth++; });
    if (sharp && !smooth) out.push(a, b);
  });
  var arr = []; out.forEach(function(p){ arr.push(p[0], p[1], p[2]); });
  var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); return g;
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
    // 前の 穴（from:'back' は 後ろの 面から）。図は 前から 見た 座標の まま
    (v.front.holes || []).forEach(function(h){ var g = ext(h.pts, null, h.depth + mg).translate(0, 0, h.from === 'back' ? zf - Dd - mg : zf - h.depth); res = ev.evaluate(res, brush(g), SUBTRACTION); });
    // 横の 穴（side.holes：[d,y]、from:'left'｜'right' の 面から depth）・横から 見た 形で 削る（side.cuts：[d,y] を x0〜x1 で。面取りの 飾りの 線など）
    function sideM(x0){ return new THREE.Matrix4().set(0, 0, 1, x0, 0, 1, 0, 0, -1, 0, 0, zf, 0, 0, 0, 1); }
    (v.side && v.side.holes || []).forEach(function(h){ var g = ext(h.pts, null, h.depth + mg); g.applyMatrix4(sideM(h.from === 'left' ? -W / 2 - mg : W / 2 - h.depth)); res = ev.evaluate(res, brush(g), SUBTRACTION); });
    (v.side && v.side.cuts || []).forEach(function(h){ var g = ext(h.pts, null, h.x1 - h.x0); g.applyMatrix4(sideM(h.x0)); res = ev.evaluate(res, brush(g), SUBTRACTION); });
    // 天面から 見た 形で 高さ y0〜y1 を 削る（top.cuts：[x,d]。角の 欠きなど）
    (v.top && v.top.cuts || []).forEach(function(h){ var g = ext(h.pts, null, h.y1 - h.y0); g.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, h.y0, 0, -1, 0, zf, 0, 0, 0, 1)); res = ev.evaluate(res, brush(g), SUBTRACTION); });
    var geo = res.geometry; geo.translate(0, c.at.y, 0); geo = creased(geo, 30);
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

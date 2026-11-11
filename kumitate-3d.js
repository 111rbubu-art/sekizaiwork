// 組み立て（kumitate.html）の 3D 表示（Three.js r160・同梱）。位置と 大きさは kumitate-engine.js の 答え（boxes）を 使う
import * as THREE from './lib/three-0.160.0/three.module.min.js';
import { OrbitControls } from './lib/three-0.160.0/OrbitControls.js?v=2';
import { partGroup, fusionMouse } from './zumen-3d.js?v=0.9.27';

export function create(box, onPick, onDbl, onCtx){
  var renderer = new THREE.WebGLRenderer({ antialias:true, preserveDrawingBuffer:true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0xf3f5f8);
  box.appendChild(renderer.domElement);
  renderer.domElement.style.touchAction = 'none';
  var scene = new THREE.Scene();
  var cam = new THREE.PerspectiveCamera(32, 1, 10, 60000);
  var controls = new OrbitControls(cam, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.495;
  fusionMouse(controls, renderer.domElement, function(){ fit(); });
  // ホイールの ズーム：近づき すぎ・離れ すぎで 消えない ように 距離に 限りを つけ、近い・遠い 切る 面（near・far）を 距離に 合わせて 毎回 直す
  controls.minDistance = 300; controls.maxDistance = 40000; controls.zoomSpeed = 0.8;
  function clip(){ var d = cam.position.distanceTo(controls.target); var n = Math.max(1, d / 200), f = Math.max(d * 30, 60000); if (Math.abs(cam.near - n) > n * 0.2 || cam.far !== f) { cam.near = n; cam.far = f; cam.updateProjectionMatrix(); } }
  controls.addEventListener('change', clip);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.5));
  var dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(800, 1500, 1200); scene.add(dl);
  var dl2 = new THREE.DirectionalLight(0xffffff, 0.45); dl2.position.set(-900, 600, -700); scene.add(dl2);
  var ground = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), new THREE.MeshStandardMaterial({ color:0xdcdcd6, roughness:1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -1; scene.add(ground);
  var grid = new THREE.GridHelper(12000, 120, 0xc4c4bc, 0xcbcbc4); scene.add(grid);
  var group = new THREE.Group(); scene.add(group);
  var meshes = [], alive = true, fitted = false, last = null, viewName = '3d';
  var badMat = new THREE.MeshBasicMaterial({ color:0xd92020, transparent:true, opacity:0.32, depthWrite:false, side:THREE.DoubleSide }), badLine = new THREE.LineBasicMaterial({ color:0xb42020 });
  var lineMat = new THREE.LineBasicMaterial({ color:0x1a1a1a }), darkLine = new THREE.LineBasicMaterial({ color:0x9aa0a8 }), selMat = new THREE.LineBasicMaterial({ color:0xe07a1f }), hitMat = new THREE.LineBasicMaterial({ color:0xd92020 });

  function size(){ var w = box.clientWidth || 300, h = box.clientHeight || 300; renderer.setSize(w, h, false); renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px'; cam.aspect = w / h; cam.updateProjectionMatrix(); dirty = true; }
  new ResizeObserver(size).observe(box); size();

  function clear(){ var keep = [lineMat, darkLine, selMat, hitMat, badMat, badLine]; while (group.children.length) { group.children.pop().traverse(function(c){ if (c.geometry && !c.geometry.userData.cached) c.geometry.dispose(); if (c.material && keep.indexOf(c.material) < 0) c.material.dispose(); }); } meshes = []; }

  // 形の ある 部材の 立体（CSG・面の ならし・かどの 線）は 重いので、形が 同じ 間は 作り直さない。
  // 選ぶ・敷地を 打つ などで update が 来ても、形の 中身（JSON）が 同じなら 前に 作った 形を 写して 色と 線だけ 付け直す
  var cache = new Map(), CACHE_MAX = 80, phMat = new THREE.MeshBasicMaterial(), phLine = new THREE.LineBasicMaterial();
  function shapeKey(shp){ try { return JSON.stringify(shp, function(k, v){ return k === 'thumb' ? undefined : v; }); } catch (e) { return null; } }
  function shapeProto(shp){
    var key = shapeKey(shp), hit = key && cache.get(key);
    if (hit) { cache.delete(key); cache.set(key, hit); return hit; }   // 使った 順に 並べ直す（古い ものから 捨てる）
    var pg = partGroup(window.BZ.model(shp, window.BZ.solve(shp)), true, phMat, phLine);
    pg.traverse(function(o){ if (o.geometry) o.geometry.userData.cached = true; });
    if (key) { cache.set(key, pg); trim(); }
    return pg;
  }
  var inUse = new Set();
  function trim(){
    if (cache.size <= CACHE_MAX) return;
    for (var it = cache.keys(), k = it.next(); !k.done && cache.size > CACHE_MAX; k = it.next()) {
      var pg = cache.get(k.value); if (inUse.has(pg)) continue;
      cache.delete(k.value); pg.traverse(function(o){ if (o.geometry) o.geometry.dispose(); });
    }
  }

  // r = KM.compute の 答え（かくした 部材は 抜いて ある）、col(key) → '#rrggbb'、sel＝選んだ 部材の 鍵 か {鍵:1}、site＝{W,D}（null で 敷地の 線を 出さない）
  function update(r, col, sel, site, refit){
    last = { r:r, col:col, sel:sel, site:site };
    clear(); inUse = new Set();
    var hit = {}; r.hits.forEach(function(h){ hit[h.a] = hit[h.b] = 1; });
    Object.keys(r.boxes).forEach(function(k){
      var b = r.boxes[k], w = b.x1 - b.x0, h = b.y1 - b.y0, d = b.z1 - b.z0;
      if (!(w > 0 && h > 0 && d > 0)) return;
      var bad = r.bad && r.bad[k], c0 = new THREE.Color(col(k)); if (bad) c0.lerp(new THREE.Color(0xd9534f), 0.85);   // ✕ の 部材は 赤く（v0.8.23）
      var g = new THREE.BoxGeometry(w, h, d), dark = c0.getHSL({}).l < 0.25;
      var sm = new THREE.MeshStandardMaterial({ color:c0, roughness:0.4, metalness:0.05, polygonOffset:true, polygonOffsetFactor:1, polygonOffsetUnits:1, side:THREE.DoubleSide });
      var on = sel && typeof sel === 'object' ? !!sel[k] : k === sel; // sel＝1 つの 鍵 か、{鍵:1}（外柵 ぜんぶ など）
      var lm = on ? selMat : hit[k] || bad ? hitMat : dark ? darkLine : lineMat;
      var rot = +(r.parts[k].rot || 0) * Math.PI / 180;   // 足した 部材の 回転（箱＝回した 形を 囲む 箱）
      if (rot) { g.dispose(); g = new THREE.BoxGeometry(r.parts[k].w, h, r.parts[k].d); }
      var m = new THREE.Mesh(g, sm);
      m.position.set(b.x0 + w / 2, b.y0 + h / 2, b.z0 + d / 2); m.rotation.y = rot; m.userData.key = k;
      var shp = r.parts[k].shape, pg = null;
      if (shp && window.BZ) { try { var pr = shapeProto(shp); inUse.add(pr); pg = pr.clone(); pg.traverse(function(o){ if (o.isMesh) o.material = sm; else if (o.isLine) o.material = lm; }); } catch (err) { pg = null; } }
      if (pg) { // 形の ある 部材：底面の 中心に 置く。押せる ように 中の 面に 鍵を つける
        g.dispose(); pg.position.set(b.x0 + w / 2, b.y0, b.z0 + d / 2); pg.rotation.y = rot; pg.traverse(function(o){ if (o.isMesh) { o.userData.key = k; meshes.push(o); } }); group.add(pg);
      } else {
        group.add(m); meshes.push(m);
        var e = new THREE.LineSegments(new THREE.EdgesGeometry(g), lm); e.position.copy(m.position); e.rotation.y = rot; group.add(e);
      }
      if (k === sel && typeof sel === 'string') { var e2 = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w + 14, h + 14, d + 14)), selMat); e2.position.copy(m.position); group.add(e2); }
    });
    if (site && site.W > 20 && site.D > 20) {
      var ol = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(site.W - 20, site.D - 20)), new THREE.LineBasicMaterial({ color:0x3355aa }));
      ol.rotation.x = -Math.PI / 2; ol.position.y = 1; group.add(ol);
    }
    // 合わない 所（拝石が 中仕切に かかる 長さ・開口部 など）：赤い 半透明の 箱と 文字（v0.8.23）
    (r.zones || []).forEach(function(z){
      var w = Math.max(2, z.x1 - z.x0), h = Math.max(2, z.y1 - z.y0), d = Math.max(2, z.z1 - z.z0), g = new THREE.BoxGeometry(w, h, d);
      var m = new THREE.Mesh(g, badMat); m.position.set(z.x0 + w / 2, z.y0 + h / 2, z.z0 + d / 2); m.renderOrder = 5; group.add(m);
      var e = new THREE.LineSegments(new THREE.EdgesGeometry(g), badLine); e.position.copy(m.position); group.add(e);
      if (z.label) { var sp = textSprite(z.label); sp.position.set(z.x0 + w / 2, z.y1 + 30, z.z0 + d / 2); group.add(sp); }
    });
    // 作り直した 部材の 位置を すぐ 当たり判定に 効かせる（次の 描画を 待たない）。ダブルクリックの 1 回目で 作り直すと、2 回目が 古い 位置（原点）で 当たって ちがう 部材に なって いた（2026-11-11）
    scene.updateMatrixWorld(true);
    if (!fitted || refit) { fit(); fitted = true; }
    dirty = true;
  }
  function bounds(){ var bb = new THREE.Box3(); meshes.forEach(function(m){ bb.expandByObject(m); }); if (bb.isEmpty()) bb.set(new THREE.Vector3(-800, 0, -800), new THREE.Vector3(800, 1000, 800)); return bb; }
  function fit(name){
    if (name) viewName = name;
    var bb = bounds(), c = bb.getCenter(new THREE.Vector3()), s = bb.getSize(new THREE.Vector3()), R = Math.max(s.x, s.y, s.z) * 0.7 + 250;
    var dist = R / Math.sin(cam.fov * Math.PI / 360) * 1.05;
    var dir = viewName === 'front' ? new THREE.Vector3(0, 0.02, 1) : viewName === 'top' ? new THREE.Vector3(0, 1, 0.0001) : new THREE.Vector3(0.55, 0.5, 0.95);
    if (cam.aspect < 1) dist /= Math.max(0.55, cam.aspect);
    controls.maxDistance = Math.max(40000, dist * 4); controls.minDistance = Math.max(300, R * 0.35); controls.target.copy(c); cam.position.copy(c).add(dir.normalize().multiplyScalar(dist)); controls.update(); clip(); dirty = true;
  }
  // 押した 部材（動かした ときは 押した ことに しない）
  var down = null, ray = new THREE.Raycaster();
  renderer.domElement.addEventListener('pointerdown', function(e){ down = e.button === 0 ? { x:e.clientX, y:e.clientY } : null; });   // 左で 押した ときだけ 選ぶ
  renderer.domElement.addEventListener('pointerup', function(e){
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down = null; return; }
    down = null;
    var rc = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2((e.clientX - rc.left) / rc.width * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1), cam);
    if (PM) { var inf = pmHit(e); if (inf && PM.onClick) PM.onClick(inf); return; }
    var hits = ray.intersectObjects(meshes, false);
    if (onPick) onPick(hits.length ? hits[0].object.userData.key : null);
  });
  // ダブルクリック＝その 部材の 加工図面（タブの 枠の 中だけ）
  if (onDbl) renderer.domElement.addEventListener('dblclick', function(e){ if (PM || e.button !== 0) return;
    var rc = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2((e.clientX - rc.left) / rc.width * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1), cam);
    var hits = ray.intersectObjects(meshes, false); if (hits.length) onDbl(hits[0].object.userData.key); });
  // ── 支点を 選ぶ（足した 部材の 置き方）。マウスを 当てた 部材の 面の 角・辺の 中点・面の 中心に 吸い付く。そこから 外れたら 面の 上の 点 ──
  // opts = { ok:function(鍵)→押せるか, onHover(info|null), onClick(info) }。info = { key, face, f:[fx,fy,fz], snap:'corner'|'edge'|'center'|'', p:{x,y,z} }
  var PM = null, marks = new THREE.Group(), hoverG = new THREE.Group(); marks.renderOrder = 999; hoverG.renderOrder = 999; scene.add(marks); scene.add(hoverG);
  function dotTex(ring){ var c = document.createElement('canvas'); c.width = c.height = 64; var x = c.getContext('2d');
    if (ring) { x.lineWidth = 9; x.strokeStyle = '#fff'; x.beginPath(); x.arc(32, 32, 24, 0, 7); x.stroke(); x.lineWidth = 5; x.strokeStyle = '#000'; x.beginPath(); x.arc(32, 32, 24, 0, 7); x.stroke(); x.fillStyle = '#000'; x.beginPath(); x.arc(32, 32, 7, 0, 7); x.fill(); }
    else { x.fillStyle = '#fff'; x.beginPath(); x.arc(32, 32, 28, 0, 7); x.fill(); x.fillStyle = '#000'; x.beginPath(); x.arc(32, 32, 19, 0, 7); x.fill(); }
    var t = new THREE.CanvasTexture(c); return t; }
  var TEX = { dot:dotTex(false), ring:dotTex(true) };
  function pts(list, color, size, ring){
    var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([].concat.apply([], list.map(function(p){ return [p.x, p.y, p.z]; })), 3));
    var m = new THREE.PointsMaterial({ color:new THREE.Color(color), size:size, sizeAttenuation:false, map:ring ? TEX.ring : TEX.dot, transparent:true, alphaTest:0.3, depthTest:false });
    var o = new THREE.Points(g, m); o.renderOrder = 999; return o;
  }
  function clearG(G){ while (G.children.length) { var o = G.children.pop(); o.geometry.dispose(); o.material.dispose(); } }
  // 部材の 箱の 座標（回す 前）：底面の 中心が 原点
  function frame(k){ var r = last && last.r, b = r && r.boxes[k], p = r && r.parts[k]; if (!b) return null; var rot = +(p.rot || 0);
    return { c:new THREE.Vector3((b.x0 + b.x1) / 2, b.y0, (b.z0 + b.z1) / 2), w:rot ? p.w : b.x1 - b.x0, h:b.y1 - b.y0, d:rot ? p.d : b.z1 - b.z0, rot:rot * Math.PI / 180 }; }
  function toWorld(F, f){ var v = new THREE.Vector3((f[0] - 0.5) * F.w, f[1] * F.h, (f[2] - 0.5) * F.d); v.applyAxisAngle(new THREE.Vector3(0, 1, 0), F.rot); return v.add(F.c); }
  function scr(v, rc){ var q = v.clone().project(cam); return { x:(q.x + 1) / 2 * rc.width, y:(1 - q.y) / 2 * rc.height }; }
  function pmHit(e){
    var rc = renderer.domElement.getBoundingClientRect(), mx = e.clientX - rc.left, my = e.clientY - rc.top;
    ray.setFromCamera(new THREE.Vector2(mx / rc.width * 2 - 1, -(my / rc.height) * 2 + 1), cam);
    var hs = ray.intersectObjects(meshes, false), k = null;
    for (var i = 0; i < hs.length; i++) { var kk = hs[i].object.userData.key; if (kk && (!PM.ok || PM.ok(kk))) { k = kk; break; } }   // 押せない 部材は 透かして 奥を 見る
    if (!k) return null;
    var F = frame(k); if (!F) return null;
    // 光線を 部材の 座標へ（回転を 戻す）
    var inv = new THREE.Vector3(0, 1, 0), o = ray.ray.origin.clone().sub(F.c).applyAxisAngle(inv, -F.rot), dv = ray.ray.direction.clone().applyAxisAngle(inv, -F.rot);
    var bx = new THREE.Box3(new THREE.Vector3(-F.w / 2, 0, -F.d / 2), new THREE.Vector3(F.w / 2, F.h, F.d / 2)), P = new THREE.Ray(o, dv).intersectBox(bx, new THREE.Vector3());
    if (!P) return null;
    var f = [P.x / F.w + 0.5, F.h ? P.y / F.h : 0, P.z / F.d + 0.5].map(function(v){ return Math.min(1, Math.max(0, v)); });
    var dd = [Math.abs(f[0]) * F.w, Math.abs(1 - f[0]) * F.w, Math.abs(f[1]) * F.h, Math.abs(1 - f[1]) * F.h, Math.abs(f[2]) * F.d, Math.abs(1 - f[2]) * F.d], fi = dd.indexOf(Math.min.apply(null, dd));
    var ax = fi >> 1, val = fi & 1, face = ['left', 'right', 'bottom', 'top', 'back', 'front'][fi], oth = [0, 1, 2].filter(function(a){ return a !== ax; });
    f[ax] = val;
    var cands = [];
    [0, 0.5, 1].forEach(function(u){ [0, 0.5, 1].forEach(function(v){ var g = [0, 0, 0]; g[ax] = val; g[oth[0]] = u; g[oth[1]] = v; var n = (u === 0.5) + (v === 0.5); cands.push({ f:g, snap:n === 0 ? 'corner' : n === 1 ? 'edge' : 'center' }); }); });
    var best = null, bd = 26;
    cands.forEach(function(c){ c.p = toWorld(F, c.f); var s2 = scr(c.p, rc), dist = Math.hypot(s2.x - mx, s2.y - my); if (dist < bd) { bd = dist; best = c; } });
    var info = best ? { key:k, face:face, f:best.f, snap:best.snap, p:best.p } : { key:k, face:face, f:f, snap:'', p:toWorld(F, f) };
    info.cands = cands; info.p = { x:info.p.x, y:info.p.y, z:info.p.z }; return info;
  }
  var hovT = 0;
  renderer.domElement.addEventListener('pointermove', function(e){
    if (!PM || e.buttons) return; var now = performance.now(); if (now - hovT < 30) return; hovT = now;
    var inf = pmHit(e); clearG(hoverG);
    if (inf) { hoverG.add(pts(inf.cands.map(function(c){ return c.p; }), '#475569', 9, false)); hoverG.add(pts([inf.p], PM.color || '#e07a1f', 18, true)); }
    renderer.domElement.style.cursor = inf ? 'crosshair' : '';
    if (PM.onHover) PM.onHover(inf); dirty = true;
  });
  function pickMode(opts){ PM = opts || null; clearG(hoverG); if (!PM) renderer.domElement.style.cursor = ''; dirty = true; }
  // 選んだ 支点の 印：[{p:{x,y,z}, color, ring}]
  function setMarks(list){ clearG(marks); (list || []).forEach(function(m){ marks.add(pts([m.p], m.color || '#e07a1f', m.ring ? 22 : 14, !!m.ring)); }); dirty = true; }
  // 描くのは 変わった ときだけ（止まって いる 間は 描かない。回す・ズーム・慣性の 間と 部材・地面・大きさが 変わった とき）
  var dirty = true;
  controls.addEventListener('change', function(){ dirty = true; });
  (function loop(){ if (!alive) return; requestAnimationFrame(loop); if (controls.update()) dirty = true; if (dirty) { dirty = false; renderer.render(scene, cam); } })();
  // 3D の 中の 文字（赤い 札）。画面の 大きさで 一定
  function textSprite(txt, bg, fg){
    var c = document.createElement('canvas'), x = c.getContext('2d'), fs = 30; x.font = 'bold ' + fs + 'px sans-serif';
    var tw = Math.ceil(x.measureText(txt).width) + 28; c.width = tw; c.height = fs + 22; x = c.getContext('2d'); x.font = 'bold ' + fs + 'px sans-serif';
    x.fillStyle = bg || '#b42020'; x.beginPath(); if (x.roundRect) x.roundRect(0, 0, c.width, c.height, 10); else x.rect(0, 0, c.width, c.height); x.fill();
    x.fillStyle = fg || '#fff'; x.textBaseline = 'middle'; x.fillText(txt, 14, c.height / 2 + 1);
    var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; var m = new THREE.SpriteMaterial({ map:t, depthTest:false, sizeAttenuation:false }), s = new THREE.Sprite(m);
    s.scale.set(c.width / 3600, c.height / 3600, 1); s.center.set(0.5, 0); s.renderOrder = 1000; return s;
  }
  // ── 右クリック：押した 部材と 画面の 位置を 返す（メニューは kumitate.html）──
  renderer.domElement.addEventListener('contextmenu', function(e){
    e.preventDefault(); if (!onCtx || PM) return;
    var rc = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2((e.clientX - rc.left) / rc.width * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1), cam);
    var hs = ray.intersectObjects(meshes, false); onCtx(hs.length ? hs[0].object.userData.key : null, e.clientX, e.clientY);
  });
  // ── 大きさを 変更：広げられる 面に 矢印。矢印を 引くと onDrag(面, mm, 終わり)。押すだけ（引かない）は onDrag(面, 0, true, 'click') ──
  // faces = [{ id, p:{x,y,z}（面の 中心）, n:[x,y,z]（外向き）, ok（false＝灰色で 動かせない）}]
  var SZ = null, szG = new THREE.Group(), szDrag = null; szG.renderOrder = 998; scene.add(szG);
  function sizeMode(opts){
    while (szG.children.length) { var o = szG.children.pop(); o.traverse(function(c){ if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); }); }
    SZ = opts || null; dirty = true; if (!SZ) { renderer.domElement.style.cursor = ''; return; }
    var dist = cam.position.distanceTo(controls.target), L = Math.max(90, dist * 0.05), R = L * 0.12;
    SZ.faces.forEach(function(f){
      var col = f.ok === false ? 0x9aa0a8 : f.id === (szDrag && szDrag.id) ? 0xe07a1f : 0x1f9d55, mat = new THREE.MeshBasicMaterial({ color:col, depthTest:false, transparent:true, opacity:0.95 });
      var a = new THREE.Group(), sh = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.35, R * 0.35, L * 0.7, 12), mat), hd = new THREE.Mesh(new THREE.ConeGeometry(R, L * 0.35, 16), mat.clone());
      var dot = new THREE.Mesh(new THREE.SphereGeometry(R * 0.55, 12, 8), mat.clone());
      sh.position.y = L * 0.35; hd.position.y = L * 0.7 + L * 0.175; a.add(sh); a.add(hd); a.add(dot);
      a.position.set(f.p.x, f.p.y, f.p.z); a.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(f.n[0], f.n[1], f.n[2]).normalize());
      a.traverse(function(c){ c.renderOrder = 998; c.userData.face = f.id; c.userData.ok = f.ok !== false; }); szG.add(a);
    });
    // 部材の 寸法（幅・奥行・高さ）：寸法線と 札。変えて いる 寸法は 橙（v0.8.24 本人「寸法を 変更する とき 部材の 寸法を 表示させて」）
    (SZ.dims || []).forEach(function(d){
      var col = d.hot ? 0xe07a1f : 0x1f3a5f, lm = new THREE.LineBasicMaterial({ color:col, depthTest:false }), A = new THREE.Vector3(d.a.x, d.a.y, d.a.z), B = new THREE.Vector3(d.b.x, d.b.y, d.b.z);
      var pts = [A, B], t = d.t ? new THREE.Vector3(d.t[0], d.t[1], d.t[2]).multiplyScalar(L * 0.18) : null;
      if (t) pts.push(A.clone().sub(t), A.clone().add(t), B.clone().sub(t), B.clone().add(t));
      var ln = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), lm); ln.renderOrder = 997; szG.add(ln);
      if (d.e) d.e.forEach(function(e){ var el = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(e[0].x, e[0].y, e[0].z), new THREE.Vector3(e[1].x, e[1].y, e[1].z)]), lm.clone()); el.renderOrder = 997; szG.add(el); });
      var sp = textSprite(d.text, d.hot ? '#e07a1f' : '#1f3a5f'); sp.center.set(0.5, 0.5); sp.position.copy(A).add(B).multiplyScalar(0.5); szG.add(sp);
    });
  }
  function szHit(e){
    if (!SZ) return null; var rc = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2((e.clientX - rc.left) / rc.width * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1), cam);
    var hs = ray.intersectObjects(szG.children, true).filter(function(h){ return h.object.userData.ok; }); return hs.length ? hs[0].object.userData.face : null;
  }
  renderer.domElement.addEventListener('pointerdown', function(e){
    if (!SZ || e.button !== 0) return; var id = szHit(e); if (!id) return;
    var f = SZ.faces.filter(function(x){ return x.id === id; })[0], rc = renderer.domElement.getBoundingClientRect();
    var a = scr(new THREE.Vector3(f.p.x, f.p.y, f.p.z), rc), b = scr(new THREE.Vector3(f.p.x + f.n[0] * 100, f.p.y + f.n[1] * 100, f.p.z + f.n[2] * 100), rc);
    var dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    szDrag = { id:id, x:e.clientX, y:e.clientY, ux:dx / l, uy:dy / l, per:l / 100, moved:false };   // per＝1 mm の 画面の 長さ
    renderer.domElement.setPointerCapture(e.pointerId); e.stopImmediatePropagation(); e.preventDefault();
  }, true);
  renderer.domElement.addEventListener('pointermove', function(e){
    if (!SZ) return;
    if (!szDrag) { if (!e.buttons) renderer.domElement.style.cursor = szHit(e) ? 'grab' : ''; return; }
    var mx = e.clientX - szDrag.x, my = e.clientY - szDrag.y; if (!szDrag.moved && Math.hypot(mx, my) < 4) return;
    szDrag.moved = true; renderer.domElement.style.cursor = 'grabbing';
    SZ.onDrag(szDrag.id, (mx * szDrag.ux + my * szDrag.uy) / szDrag.per, false);
  });
  renderer.domElement.addEventListener('pointerup', function(e){
    if (!szDrag) return; var d = szDrag; szDrag = null; renderer.domElement.style.cursor = '';
    var mx = e.clientX - d.x, my = e.clientY - d.y;
    if (SZ) SZ.onDrag(d.id, d.moved ? (mx * d.ux + my * d.uy) / d.per : 0, true, d.moved ? '' : 'click');
    e.stopImmediatePropagation(); down = null;
  }, true);
  // 地面の 見え方：''＝ふつう｜'half'＝半透明（GL の 下も 見える）｜'off'＝出さない（格子は のこす）
  function setGround(mode){
    var gm = ground.material;
    ground.visible = mode !== 'off';
    gm.transparent = mode === 'half'; gm.opacity = mode === 'half' ? 0.35 : 1; gm.depthWrite = mode !== 'half'; gm.needsUpdate = true; dirty = true;
  }
  return { update:update, fit:fit, setGround:setGround, pickMode:pickMode, setMarks:setMarks, sizeMode:sizeMode, dragging:function(){ return !!szDrag; }, project:function(p){ var rc = renderer.domElement.getBoundingClientRect(), q = scr(new THREE.Vector3(p.x, p.y, p.z), rc); return { x:rc.left + q.x, y:rc.top + q.y }; }, png:function(){ renderer.render(scene, cam); return renderer.domElement.toDataURL('image/png'); }, dispose:function(){ alive = false; clear(); cache.forEach(function(pg){ pg.traverse(function(o){ if (o.geometry) o.geometry.dispose(); }); }); cache.clear(); renderer.dispose(); } };
}

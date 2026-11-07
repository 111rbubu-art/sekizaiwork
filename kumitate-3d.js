// 組み立て（kumitate.html）の 3D 表示（Three.js r160・同梱）。位置と 大きさは kumitate-engine.js の 答え（boxes）を 使う
import * as THREE from './lib/three-0.160.0/three.module.min.js';
import { OrbitControls } from './lib/three-0.160.0/OrbitControls.js?v=2';
import { partGroup, fusionMouse } from './zumen-3d.js?v=0.8.6';

export function create(box, onPick){
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
  var lineMat = new THREE.LineBasicMaterial({ color:0x1a1a1a }), darkLine = new THREE.LineBasicMaterial({ color:0x9aa0a8 }), selMat = new THREE.LineBasicMaterial({ color:0xe07a1f }), hitMat = new THREE.LineBasicMaterial({ color:0xd92020 });

  function size(){ var w = box.clientWidth || 300, h = box.clientHeight || 300; renderer.setSize(w, h, false); renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px'; cam.aspect = w / h; cam.updateProjectionMatrix(); }
  new ResizeObserver(size).observe(box); size();

  function clear(){ var keep = [lineMat, darkLine, selMat, hitMat]; while (group.children.length) { group.children.pop().traverse(function(c){ if (c.geometry) c.geometry.dispose(); if (c.material && keep.indexOf(c.material) < 0) c.material.dispose(); }); } meshes = []; }

  // r = KM.compute の 答え（かくした 部材は 抜いて ある）、col(key) → '#rrggbb'、sel＝選んだ 部材の 鍵 か {鍵:1}、site＝{W,D}（null で 敷地の 線を 出さない）
  function update(r, col, sel, site, refit){
    last = { r:r, col:col, sel:sel, site:site };
    clear();
    var hit = {}; r.hits.forEach(function(h){ hit[h.a] = hit[h.b] = 1; });
    Object.keys(r.boxes).forEach(function(k){
      var b = r.boxes[k], w = b.x1 - b.x0, h = b.y1 - b.y0, d = b.z1 - b.z0;
      if (!(w > 0 && h > 0 && d > 0)) return;
      var g = new THREE.BoxGeometry(w, h, d), dark = new THREE.Color(col(k)).getHSL({}).l < 0.25;
      var sm = new THREE.MeshStandardMaterial({ color:new THREE.Color(col(k)), roughness:0.4, metalness:0.05, polygonOffset:true, polygonOffsetFactor:1, polygonOffsetUnits:1, side:THREE.DoubleSide });
      var on = sel && typeof sel === 'object' ? !!sel[k] : k === sel; // sel＝1 つの 鍵 か、{鍵:1}（外柵 ぜんぶ など）
      var lm = on ? selMat : hit[k] ? hitMat : dark ? darkLine : lineMat;
      var m = new THREE.Mesh(g, sm);
      m.position.set(b.x0 + w / 2, b.y0 + h / 2, b.z0 + d / 2); m.userData.key = k;
      var shp = r.parts[k].shape, pg = null;
      if (shp && window.BZ) { try { pg = partGroup(window.BZ.model(shp, window.BZ.solve(shp)), true, sm, lm); } catch (err) { pg = null; } }
      if (pg) { // 形の ある 部材：底面の 中心に 置く。押せる ように 中の 面に 鍵を つける
        g.dispose(); pg.position.set(b.x0 + w / 2, b.y0, b.z0 + d / 2); pg.traverse(function(o){ if (o.isMesh) { o.userData.key = k; meshes.push(o); } }); group.add(pg);
      } else {
        group.add(m); meshes.push(m);
        var e = new THREE.LineSegments(new THREE.EdgesGeometry(g), lm); e.position.copy(m.position); group.add(e);
      }
      if (k === sel && typeof sel === 'string') { var e2 = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w + 14, h + 14, d + 14)), selMat); e2.position.copy(m.position); group.add(e2); }
    });
    if (site && site.W > 20 && site.D > 20) {
      var ol = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(site.W - 20, site.D - 20)), new THREE.LineBasicMaterial({ color:0x3355aa }));
      ol.rotation.x = -Math.PI / 2; ol.position.y = 1; group.add(ol);
    }
    if (!fitted || refit) { fit(); fitted = true; }
  }
  function bounds(){ var bb = new THREE.Box3(); meshes.forEach(function(m){ bb.expandByObject(m); }); if (bb.isEmpty()) bb.set(new THREE.Vector3(-800, 0, -800), new THREE.Vector3(800, 1000, 800)); return bb; }
  function fit(name){
    if (name) viewName = name;
    var bb = bounds(), c = bb.getCenter(new THREE.Vector3()), s = bb.getSize(new THREE.Vector3()), R = Math.max(s.x, s.y, s.z) * 0.7 + 250;
    var dist = R / Math.sin(cam.fov * Math.PI / 360) * 1.05;
    var dir = viewName === 'front' ? new THREE.Vector3(0, 0.02, 1) : viewName === 'top' ? new THREE.Vector3(0, 1, 0.0001) : new THREE.Vector3(0.55, 0.5, 0.95);
    if (cam.aspect < 1) dist /= Math.max(0.55, cam.aspect);
    controls.maxDistance = Math.max(40000, dist * 4); controls.minDistance = Math.max(300, R * 0.35); controls.target.copy(c); cam.position.copy(c).add(dir.normalize().multiplyScalar(dist)); controls.update(); clip();
  }
  // 押した 部材（動かした ときは 押した ことに しない）
  var down = null, ray = new THREE.Raycaster();
  renderer.domElement.addEventListener('pointerdown', function(e){ down = e.button === 0 ? { x:e.clientX, y:e.clientY } : null; });   // 左で 押した ときだけ 選ぶ
  renderer.domElement.addEventListener('pointerup', function(e){
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down = null; return; }
    down = null;
    var rc = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2((e.clientX - rc.left) / rc.width * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1), cam);
    var hits = ray.intersectObjects(meshes, false);
    if (onPick) onPick(hits.length ? hits[0].object.userData.key : null);
  });
  (function loop(){ if (!alive) return; requestAnimationFrame(loop); controls.update(); renderer.render(scene, cam); })();
  // 地面の 見え方：''＝ふつう｜'half'＝半透明（GL の 下も 見える）｜'off'＝出さない（格子は のこす）
  function setGround(mode){
    var gm = ground.material;
    ground.visible = mode !== 'off';
    gm.transparent = mode === 'half'; gm.opacity = mode === 'half' ? 0.35 : 1; gm.depthWrite = mode !== 'half'; gm.needsUpdate = true;
  }
  return { update:update, fit:fit, setGround:setGround, png:function(){ renderer.render(scene, cam); return renderer.domElement.toDataURL('image/png'); }, dispose:function(){ alive = false; clear(); renderer.dispose(); } };
}

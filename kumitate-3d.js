// 組み立て（kumitate.html）の 3D 表示（Three.js r160・同梱）。位置と 大きさは kumitate-engine.js の 答え（boxes）を 使う
import * as THREE from './lib/three-0.160.0/three.module.min.js';
import { OrbitControls } from './lib/three-0.160.0/OrbitControls.js?v=2';
import { partGroup, fusionMouse } from './zumen-3d.js?v=0.9.52';

export function create(box, onPick, onDbl, onCtx, onBox){
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
  var hemi = new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.5); scene.add(hemi);
  var dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(800, 1500, 1200); scene.add(dl);
  var dl2 = new THREE.DirectionalLight(0xffffff, 0.45); dl2.position.set(-900, 600, -700); scene.add(dl2);
  var ground = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), new THREE.MeshStandardMaterial({ color:0xdcdcd6, roughness:1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -1; scene.add(ground);
  var grid = new THREE.GridHelper(12000, 120, 0xc4c4bc, 0xcbcbc4); scene.add(grid);
  var group = new THREE.Group(); scene.add(group);
  var jMeshes = [], JM = null;   // 砂利の 板（押して 外す ため）
  var meshes = [], ancMeshes = [], alive = true, fitted = false, last = null, viewName = '3d';
  var badMat = new THREE.MeshBasicMaterial({ color:0xd92020, transparent:true, opacity:0.32, depthWrite:false, side:THREE.DoubleSide }), badLine = new THREE.LineBasicMaterial({ color:0xb42020 });
  var lineMat = new THREE.LineBasicMaterial({ color:0x1a1a1a }), darkLine = new THREE.LineBasicMaterial({ color:0x9aa0a8 }), selMat = new THREE.LineBasicMaterial({ color:0xe07a1f }), selDash = new THREE.LineDashedMaterial({ color:0xe07a1f, dashSize:14, gapSize:10 }), hitMat = new THREE.LineBasicMaterial({ color:0xd92020 });

  function size(){ var w = box.clientWidth || 300, h = box.clientHeight || 300; renderer.setSize(w, h, false); renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px'; cam.aspect = w / h; cam.updateProjectionMatrix(); dirty = true; }
  new ResizeObserver(size).observe(box); size();

  // 線のみ の 線の 色：ソリッドの 色の まま。明るい 色（黄・既製品の 灰 など）は 白い 地で 見える ように 少し 濃く
  function colLine(c){ var q = c.getHSL({}), cc = c.clone(); if (q.l > 0.5) cc.setHSL(q.h, q.s, 0.5); return new THREE.LineBasicMaterial({ color:cc }); }
  function clear(){ wtMap = new WeakMap(); var keep = [lineMat, darkLine, selMat, selDash, hitMat, badMat, badLine]; while (group.children.length) { group.children.pop().traverse(function(c){ if (c.geometry && !c.geometry.userData.cached) c.geometry.dispose(); if (c.material && keep.indexOf(c.material) < 0) c.material.dispose(); }); } meshes = []; jMeshes = []; ancMeshes = []; }

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
  // ── 石目（v0.8.57）：部材に 石の 写真を 貼る。形に UV が 無いので 3 方向から 映す（triplanar）。部材の 座標で 映すので 動かしても 石目は ずれない ──
  // texFn(鍵) → { key, url, scale(写真 1 枚の 幅 mm) } か null。砂利も 同じ しくみ（r.jari）
  var texFn = null, texCache = new Map(), texLoader = new THREE.TextureLoader();
  function texOf(src){
    var t = texCache.get(src.key);
    if (!t) { t = texLoader.load(src.url, function(){ dirty = true; }); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); texCache.set(src.key, t); }
    return t;
  }
  function seedOf(k){ var h = 0; for (var i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) | 0; return new THREE.Vector2(((h & 1023) / 1024), (((h >> 10) & 1023) / 1024)); }
  // 石目の 大きさは 画像ごとに 1 つの uniform を 分けあう（つまみを 動かす 間は 作り直さず 数だけ 変える・v0.8.63）
  var scU = new Map();
  function scOf(key, sc){ var u = scU.get(key); if (!u) { u = { value:sc }; scU.set(key, u); } else u.value = sc; return u; }
  function setTexScale(key, sc){ var u = scU.get(key); if (u && sc > 0) { u.value = sc; dirty = true; } }
  function triMat(mat, src, k, world){
    var tex = texOf(src), sc = +src.scale > 0 ? +src.scale : 600, off = seedOf(k || ''), su = scOf(src.key, sc);
    mat.onBeforeCompile = function(sh){
      sh.uniforms.triMap = { value:tex }; sh.uniforms.triScale = su; sh.uniforms.triOff = { value:off };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTriP; varying vec3 vTriN;')
        .replace('#include <begin_vertex>', world ? '#include <begin_vertex>\nvTriP = (modelMatrix * vec4(position, 1.0)).xyz; vTriN = normal;' : '#include <begin_vertex>\nvTriP = position; vTriN = normal;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D triMap; uniform float triScale; uniform vec2 triOff; varying vec3 vTriP; varying vec3 vTriN;')
        .replace('#include <color_fragment>', '#include <color_fragment>\n{ vec3 bw = pow(abs(normalize(vTriN)), vec3(4.0)); bw /= (bw.x + bw.y + bw.z + 1e-5); vec3 q = vTriP / triScale;' +
          ' vec3 tc = texture2D(triMap, q.zy + triOff).rgb * bw.x + texture2D(triMap, q.xz + triOff.yx).rgb * bw.y + texture2D(triMap, q.xy + triOff * 1.7).rgb * bw.z; diffuseColor.rgb *= tc; }');
    };
    mat.customProgramCacheKey = function(){ return world ? 'ishime-w' : 'ishime'; };
    return mat;
  }
  // 光（v0.8.57 本人「光源の 位置や 強さも 変更できるように」）：L = { az:方向（度・0＝前・90＝右）, el:高さ（度）, main:日の 強さ, amb:周りの 明るさ }
  // v0.8.63（本人「光の 調整が 難しい」）：L.follow＝見る 向きに 合わせる（az は 見て いる 向きから の 角度。回しても 見て いる 面が 暗く ならない）、
  // L.exp＝明るさ（日と 周りを まとめて 掛ける）、L.col＝日の 色
  var LT = {};
  function placeLight(){ var az = (LT.az != null ? +LT.az : 34) * Math.PI / 180, el = (LT.el != null ? +LT.el : 46) * Math.PI / 180, R = 2000, x, z;
    if (LT.follow) { var v = cam.position.clone().sub(controls.target); var a0 = Math.atan2(v.x, v.z); x = Math.sin(a0 + az); z = Math.cos(a0 + az); } else { x = Math.sin(az); z = Math.cos(az); }
    dl.position.set(x * Math.cos(el) * R, Math.sin(el) * R, z * Math.cos(el) * R); dl2.position.set(-dl.position.x, 600, -dl.position.z); }
  function setLight(L){ LT = L || {}; var ex = LT.exp != null ? +LT.exp : 1;
    dl.intensity = (LT.main != null ? +LT.main : 1.6) * ex; hemi.intensity = (LT.amb != null ? +LT.amb : 1.5) * ex; dl2.intensity = 0.45 * hemi.intensity / 1.5;
    dl.color.set(LT.col || '#ffffff'); placeLight(); dirty = true; }
  function setTexture(fn){ texFn = fn || null; if (last) update(last.r, last.col, last.sel, last.site, false); }
  // 見た目（v0.8.74 本人「石の テクスチャ ON・ソリッド・線のみ（隠れて いる 部材も 選べる）」）：'tex'｜'solid'｜'line'
  var MODE = 'tex';
  function setMode(m){ MODE = m === 'solid' || m === 'line' ? m : 'tex'; if (last) update(last.r, last.col, last.sel, last.site, false); else tagsBuild(null); }
  // 線のみ の ときの 部材名の 札（本人「隠れた 部材は 選びにくい。部材名を 出して 押したら 選べるように」）。押す＝選ぶ・右クリック＝メニュー・ダブルクリック＝加工図面
  var tagL = document.createElement('div'); tagL.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:3';
  if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
  box.appendChild(tagL);
  var tagSt = document.createElement('style'); tagSt.textContent = '.k3tag{position:absolute;pointer-events:auto;cursor:pointer;font-size:12px;line-height:1;padding:3px 7px;border-radius:10px;background:#ffffffe6;border:1px solid #64748b;color:#1e293b;white-space:nowrap;transform:translate(-50%,-50%);user-select:none;font-family:inherit}' +
    '.k3tag:hover{background:#fff3e0;border-color:#e07a1f;z-index:2}.k3tag.on{background:#e07a1f;border-color:#e07a1f;color:#fff;font-weight:700;z-index:3}';
  document.head.appendChild(tagSt);
  var tags = [];
  function tagsBuild(r, sel){ tagL.textContent = ''; tags = []; if (MODE !== 'line' || !r) return;
    Object.keys(r.boxes).forEach(function(k){ var b = r.boxes[k], p = r.parts[k]; if (!p || !(b.x1 > b.x0)) return;
      var el = document.createElement('div'), on = sel && typeof sel === 'object' ? !!sel[k] : k === sel; el.className = 'k3tag' + (on ? ' on' : ''); el.textContent = p.name || k; el.title = (p.name || k) + '（押すと 選ぶ）';
      el.addEventListener('pointerdown', function(e){ e.stopPropagation(); });
      el.addEventListener('click', function(e){ e.stopPropagation(); if (onPick) onPick(k, e); });
      el.addEventListener('dblclick', function(e){ e.stopPropagation(); if (onDbl) onDbl(k); });
      el.addEventListener('contextmenu', function(e){ e.preventDefault(); e.stopPropagation(); if (onCtx) onCtx(k, e.clientX, e.clientY); });
      tagL.appendChild(el); tags.push({ k:k, el:el, p:new THREE.Vector3((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2), on:on }); });
    tagsPlace(); }
  // 札の 置き場：部材の 真ん中。重なる ときは 下へ ずらす（選んだ 札は 動かさない）
  function tagsPlace(){ if (!tags.length) return; var rc = { width:box.clientWidth, height:box.clientHeight }, put = [];
    tags.map(function(t){ var v = t.p.clone().project(cam); return { t:t, x:(v.x + 1) / 2 * rc.width, y:(1 - v.y) / 2 * rc.height, out:v.z > 1 }; })
      .sort(function(a, b){ return (b.t.on - a.t.on) || (a.y - b.y); })
      .forEach(function(q){ var el = q.t.el; if (q.out) { el.style.display = 'none'; return; } el.style.display = ''; var w = el.offsetWidth || 60, h = (el.offsetHeight || 18) + 2, y = q.y;
        for (var i = 0; i < 12; i++) { var hit = put.filter(function(o){ return Math.abs(o.x - q.x) < (o.w + w) / 2 && Math.abs(o.y - y) < h; })[0]; if (!hit) break; y = hit.y + h; }
        put.push({ x:q.x, y:y, w:w }); el.style.left = q.x + 'px'; el.style.top = y + 'px'; }); }
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
      var bad = r.bad && r.bad[k], c0 = new THREE.Color(col(k)); var hl = r.hl && r.hl[k]; if (hl) c0 = new THREE.Color(hl); else if (bad) c0.lerp(new THREE.Color(0xd9534f), 0.85);   // 開いた 札の 部材は 選択肢の 部材名と 同じ 色（v0.8.47）   // ✕ の 部材は 赤く（v0.8.23）
      var src = texFn && MODE === 'tex' ? texFn(k) : null; if (src) { var tint = hl ? new THREE.Color(hl) : bad ? new THREE.Color(0xd9534f) : null; c0 = new THREE.Color(0xffffff); if (tint) c0.lerp(tint, 0.6); }   // 石目：写真の 色を そのまま（✕・札の 部材は 色を 少し 重ねる）
      var g = new THREE.BoxGeometry(w, h, d), dark = src ? !!(src.dark) : c0.getHSL({}).l < 0.25;
      var sm = new THREE.MeshStandardMaterial({ color:c0, roughness:src ? 0.32 : 0.4, metalness:0.05, polygonOffset:true, polygonOffsetFactor:1, polygonOffsetUnits:1, side:THREE.DoubleSide });
      if (src) triMat(sm, src, k, false);
      if (MODE === 'line') { sm.colorWrite = false; sm.depthWrite = false; }   // 面は 描かない（奥の 線も 見える）。押す ための 面は 残す
      var on = sel && typeof sel === 'object' ? !!sel[k] : k === sel; // sel＝1 つの 鍵 か、{鍵:1}（外柵 ぜんぶ など）
      var lm = on ? selMat : hit[k] || bad ? hitMat : MODE === 'line' ? colLine(c0) : dark ? darkLine : lineMat;   // 線のみ＝ソリッドと 同じ 色の 線（v0.8.88）
      var rot = +(r.parts[k].rot || 0) * Math.PI / 180;   // 足した 部材の 回転（箱＝回した 形を 囲む 箱）
      if (rot) { g.dispose(); g = new THREE.BoxGeometry(r.parts[k].ow || r.parts[k].w, h, r.parts[k].od || r.parts[k].d); }
      var m = new THREE.Mesh(g, sm);
      m.position.set(b.x0 + w / 2, b.y0 + h / 2, b.z0 + d / 2); m.rotation.y = rot; m.userData.key = k;
      var shp = r.parts[k].shape, pg = null;
      if (shp && window.BZ) { try { var pr = shapeProto(shp); inUse.add(pr); pg = pr.clone(); pg.traverse(function(o){ if (o.isMesh) o.material = sm; else if (o.isLine) o.material = lm; }); } catch (err) { pg = null; } }
      if (pg) { // 形の ある 部材：底面の 中心に 置く。押せる ように 中の 面に 鍵を つける
        g.dispose(); pg.traverse(function(o){ if (o.isMesh) { o.userData.key = k; meshes.push(o); } });
        var tl = r.parts[k].tilt || 0, rl = r.parts[k].roll || 0;
        if (tl || rl) {   // 倒した・裏返した 部材（v0.8.78）：形の 真ん中を 回して、囲む 箱の 真ん中に 置く
          var H0 = window.BZ && shp.params && shp.params.H ? +(shp.params.H.value != null ? shp.params.H.value : shp.params.H.default) : h;
          var gR = new THREE.Group(), gT = new THREE.Group(), gY = new THREE.Group(); pg.position.set(0, -H0 / 2, 0); gR.add(pg); gR.rotation.z = rl * Math.PI / 2; gT.add(gR); gT.rotation.x = tl * Math.PI / 2; gY.add(gT);
          gY.position.set(b.x0 + w / 2, b.y0 + h / 2, b.z0 + d / 2); gY.rotation.y = rot; group.add(gY);
        } else { pg.position.set(b.x0 + w / 2, b.y0, b.z0 + d / 2); pg.rotation.y = rot; group.add(pg); }
      } else {
        group.add(m); meshes.push(m);
        var e = new THREE.LineSegments(new THREE.EdgesGeometry(g), lm); e.position.copy(m.position); e.rotation.y = rot; group.add(e);
      }
      if (k === sel && typeof sel === 'string' && !(r.parts[k].role === '金具' || /金具/.test(r.parts[k].name || '') || (shp && shp.bolts && shp.bolts.length))) { var e2 = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w + 14, h + 14, d + 14)), selDash); e2.computeLineDistances(); e2.position.copy(m.position); group.add(e2); }   // 選んだ 印の 外の 枠（各面 7 mm 外）は 破線、石の 線は 実線（v0.8.85 本人「二重の 線を 実線と 破線に」）
    });
    // アンカーの ボルト（v0.8.78）：金具の 根元から 石の 中へ 深さ ぶん。当たる 石が 無い・端に 近いは 赤、ほかは 濃い 灰
    (r.anc || []).forEach(function(a){ var L = a.depth + 10, rr = Math.max(a.dia / 2, 3), cg = new THREE.CylinderGeometry(rr, rr, L, 12);
      var dv = new THREE.Vector3(a.dir[0], a.dir[1], a.dir[2]), cm = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ color:a.hit && !a.warn ? 0x8a1c1c : 0xe03030, depthTest:false, transparent:true, opacity:0.85 }));
      cm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dv); cm.position.set(a.p[0], a.p[1], a.p[2]).add(dv.clone().multiplyScalar(L / 2 - 10)); cm.renderOrder = 5; cm.userData.anc = a; group.add(cm); ancMeshes.push(cm); });
    tagsBuild(r, sel);
    // 砂利（v0.8.57）：外柵の 内側の 部材の 無い 所に 敷く 板。r.jari = { y:上の 高さ, rects:[{x0,z0,x1,z1}], src:{key,url,scale} }
    if (r.jari && r.jari.rects && r.jari.rects.length) {
      var jm = new THREE.MeshStandardMaterial({ color:0xffffff, roughness:0.95, metalness:0 }), jt = 20;
      if (r.jari.src) triMat(jm, r.jari.src, 'jari', true); else jm.color.set(r.jari.color || '#d8d4cc');
      var jOff = new THREE.MeshBasicMaterial({ color:0xd92020, transparent:true, opacity:0.28, depthWrite:false });   // 外した 所（選んで いる 間だけ 見せる）
      r.jari.rects.forEach(function(q){ var w = q.x1 - q.x0, d = q.z1 - q.z0; if (!(w > 1 && d > 1)) return;
        var jg = new THREE.BoxGeometry(w, jt, d), mm = new THREE.Mesh(jg, q.off ? jOff : jm); mm.position.set(q.x0 + w / 2, r.jari.y - jt / 2, q.z0 + d / 2); mm.userData.jari = q.key || 1; group.add(mm); jMeshes.push(mm); });
    }
    if (site && site.W > 20 && site.D > 20) {
      // 設置寸法 ちょうどに 描く（v0.8.77 本人「青の 線が 敷地では？ 部材が はみ出て 見える」。前は 各辺 10 mm 内側＝W−20・D−20 で、外柵の 外の 面が 線より 外に 見えて いた）
      var ol = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(site.W, site.D)), new THREE.LineBasicMaterial({ color:0x3355aa }));
      ol.rotation.x = -Math.PI / 2; ol.position.y = 2; ol.renderOrder = 2; group.add(ol);
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
  function fit(name, pad){   // pad＝まわりの 余白（mm・既定 250。基点の 窓は 部材 1 つを 大きく 出す ので 小さく）
    if (name) viewName = name;
    var bb = bounds(), c = bb.getCenter(new THREE.Vector3()), s = bb.getSize(new THREE.Vector3()), R = Math.max(s.x, s.y, s.z) * 0.7 + (pad != null ? pad : 250);
    var dist = R / Math.sin(cam.fov * Math.PI / 360) * 1.05;
    var dir = viewName === 'front' ? new THREE.Vector3(0, 0.02, 1) : viewName === 'top' ? new THREE.Vector3(0, 1, 0.0001) : new THREE.Vector3(0.55, 0.5, 0.95);
    if (cam.aspect < 1) dist /= Math.max(0.55, cam.aspect);
    controls.maxDistance = Math.max(40000, dist * 4); controls.minDistance = Math.max(pad != null ? 60 : 300, R * 0.35); controls.target.copy(c); cam.position.copy(c).add(dir.normalize().multiplyScalar(dist)); controls.update(); clip(); dirty = true;
  }
  // 押した 部材（動かした ときは 押した ことに しない）
  var down = null, ray = new THREE.Raycaster(), selRect = null;
  renderer.domElement.addEventListener('pointerdown', function(e){ down = e.button === 0 ? { x:e.clientX, y:e.clientY, mouse:e.pointerType === 'mouse' } : null; });   // 左で 押した ときだけ 選ぶ
  // 窓で 選ぶ（マウスの 左で 引く。v0.8.48）：左から 右＝囲んだ 部材（青の 実線）、右から 左＝かかった 部材（緑の 破線）。AutoCAD・Fusion と 同じ
  renderer.domElement.addEventListener('pointermove', function(e){
    if (!down || !down.mouse || !onBox || PM || MS || SZ || szDrag || !(e.buttons & 1)) return;
    if (!selRect && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= 6) return;
    if (!selRect) { selRect = document.createElement('div'); selRect.style.cssText = 'position:fixed;z-index:40;pointer-events:none'; document.body.appendChild(selRect); try { renderer.domElement.setPointerCapture(e.pointerId); } catch (er) {} }
    var cross = e.clientX < down.x;
    selRect.style.left = Math.min(e.clientX, down.x) + 'px'; selRect.style.top = Math.min(e.clientY, down.y) + 'px';
    selRect.style.width = Math.abs(e.clientX - down.x) + 'px'; selRect.style.height = Math.abs(e.clientY - down.y) + 'px';
    selRect.style.border = cross ? '1.5px dashed #1f9d55' : '1.5px solid #2563eb'; selRect.style.background = cross ? 'rgba(31,157,85,.10)' : 'rgba(37,99,235,.10)';
  });
  function boxPick(x0, y0, x1, y1, cross){
    var r = last && last.r; if (!r) return []; var rc = renderer.domElement.getBoundingClientRect(), L = Math.min(x0, x1) - rc.left, R = Math.max(x0, x1) - rc.left, T = Math.min(y0, y1) - rc.top, B = Math.max(y0, y1) - rc.top, out = [];
    Object.keys(r.boxes).forEach(function(k){ var b = r.boxes[k], mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9, behind = false;
      [b.x0, b.x1].forEach(function(x){ [b.y0, b.y1].forEach(function(y){ [b.z0, b.z1].forEach(function(z){ var v = new THREE.Vector3(x, y, z).project(cam); if (v.z > 1) behind = true; var q = { x:(v.x + 1) / 2 * rc.width, y:(1 - v.y) / 2 * rc.height }; mnx = Math.min(mnx, q.x); mxx = Math.max(mxx, q.x); mny = Math.min(mny, q.y); mxy = Math.max(mxy, q.y); }); }); });
      if (behind) return;
      if (cross ? (mxx >= L && mnx <= R && mxy >= T && mny <= B) : (mnx >= L && mxx <= R && mny >= T && mxy <= B)) out.push(k); });
    return out;
  }
  renderer.domElement.addEventListener('pointerup', function(e){
    if (selRect) { selRect.remove(); selRect = null; var d0 = down; down = null; if (d0) onBox(boxPick(d0.x, d0.y, e.clientX, e.clientY, e.clientX < d0.x), e); return; }
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down = null; return; }
    down = null;
    var rc = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2((e.clientX - rc.left) / rc.width * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1), cam);
    if (JM) { var jh = ray.intersectObjects(jMeshes.concat(meshes), false); if (jh.length && jh[0].object.userData.jari) JM(jh[0].object.userData.jari); return; }   // 砂利を 外す・戻す
    if (PM) { var inf = pmHit(e); if (inf && PM.onClick) PM.onClick(inf); return; }
    if (MS) { var mi = msHit(e); if (MS.onClick) MS.onClick(mi ? msOut(mi) : null); return; }
    var hits = ray.intersectObjects(meshes, false);
    if (onPick) onPick(hits.length ? hits[0].object.userData.key : null, e);
  });
  // ダブルクリック＝onDbl（モデリングは v0.8.103 から 渡さない＝何も しない）
  if (onDbl) renderer.domElement.addEventListener('dblclick', function(e){ if (PM || MS || e.button !== 0) return;
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
    return { c:new THREE.Vector3((b.x0 + b.x1) / 2, b.y0, (b.z0 + b.z1) / 2), w:rot ? p.ow || p.w : b.x1 - b.x0, h:b.y1 - b.y0, d:rot ? p.od || p.d : b.z1 - b.z0, rot:rot * Math.PI / 180 }; }
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

  // ── 測定（v0.8.49 本人「測定を 追加して、点 又は 面を クリックした 2 か所の 距離を 表示」）。Fusion の 測定と 同じ 吸い付き：
  // 当てた 面（同じ 平面の 三角 ぜんぶ）を 青く、その 面の 角（頂点）に 近づくと 点に 吸い付く。opts = { onClick(info|null), onHover(info|null) }
  // info = { t:'pt'|'face', p:{x,y,z}, n:[x,y,z]（面の 外向き）, key }
  var MS = null, wtMap = new WeakMap(), msHov = new THREE.Group(), msG = new THREE.Group(); msHov.renderOrder = 996; scene.add(msHov); scene.add(msG);
  function wtris(mesh){   // 三角の 頂点（世界の 座標）
    var w = wtMap.get(mesh); if (w) return w;
    var geo = mesh.geometry, pa = geo.attributes.position, idx = geo.index, n = Math.floor((idx ? idx.count : pa.count) / 3), v = new THREE.Vector3();
    w = new Float32Array(n * 9);
    for (var i = 0; i < n * 3; i++) { v.fromBufferAttribute(pa, idx ? idx.getX(i) : i).applyMatrix4(mesh.matrixWorld); w[i * 3] = v.x; w[i * 3 + 1] = v.y; w[i * 3 + 2] = v.z; }
    wtMap.set(mesh, w); return w;
  }
  function triN(w, i){ var a = new THREE.Vector3(w[i * 9], w[i * 9 + 1], w[i * 9 + 2]), b = new THREE.Vector3(w[i * 9 + 3], w[i * 9 + 4], w[i * 9 + 5]), c = new THREE.Vector3(w[i * 9 + 6], w[i * 9 + 7], w[i * 9 + 8]);
    var n = b.clone().sub(a).cross(c.clone().sub(a)); return n.lengthSq() > 1e-12 ? { n:n.normalize(), a:a } : null; }
  // 当てた 三角と 同じ 平面（向き・高さが 同じ）の 三角を 集める
  function faceRegion(mesh, fi){
    var w = wtris(mesh), t0 = triN(w, fi); if (!t0) return null;
    var d0 = t0.n.dot(t0.a), tris = [], P = {}, E = {};
    var kk = function(x, y, z){ return Math.round(x * 10) + ',' + Math.round(y * 10) + ',' + Math.round(z * 10); };
    for (var i = 0, n = w.length / 9; i < n; i++) { var t = triN(w, i); if (!t || t.n.dot(t0.n) < 0.9995 || Math.abs(t.n.dot(t.a) - d0) > 0.5) continue; tris.push(i);
      var ks = [0, 1, 2].map(function(j){ var x = w[i * 9 + j * 3], y = w[i * 9 + j * 3 + 1], z = w[i * 9 + j * 3 + 2], k = kk(x, y, z); if (!P[k]) P[k] = new THREE.Vector3(x, y, z); return k; });
      [[0, 1], [1, 2], [2, 0]].forEach(function(e){ var a = ks[e[0]], b = ks[e[1]], k = a < b ? a + '|' + b : b + '|' + a; E[k] = (E[k] || 0) + 1; }); }
    // 吸い付く 点＝面の ふちの 角だけ（ふち＝1 つの 三角だけが 使う 辺。まっすぐ 続く ふちの 途中・面の 中の 点は 入れない）
    var nb = {}; Object.keys(E).forEach(function(k){ if (E[k] !== 1) return; var ab = k.split('|'); (nb[ab[0]] = nb[ab[0]] || []).push(ab[1]); (nb[ab[1]] = nb[ab[1]] || []).push(ab[0]); });
    var verts = [];
    Object.keys(nb).forEach(function(k){ var L = nb[k], v = P[k];
      if (L.length === 2) { var a = P[L[0]].clone().sub(v).normalize(), b = P[L[1]].clone().sub(v).normalize(); if (a.dot(b) < -0.9995) return; }
      verts.push(v); });
    return { n:t0.n, d:d0, tris:tris, verts:verts, w:w };
  }
  var msLast = null;
  function msHit(e){
    var rc = renderer.domElement.getBoundingClientRect(), mx = e.clientX - rc.left, my = e.clientY - rc.top;
    ray.setFromCamera(new THREE.Vector2(mx / rc.width * 2 - 1, -(my / rc.height) * 2 + 1), cam);
    // ボルト（金具の ネジ）を 押すと 穴の 中心（石の 面の 所。当たる 石が 無ければ ボルトの 根元）を 点に（v0.8.84 本人「測定モードで ネジを 選択すると 穴中心を 測定点に」）
    var ah = ancMeshes.length ? ray.intersectObjects(ancMeshes, false)[0] : null;
    if (ah) { var A = ah.object.userData.anc, c = A.E || A.p, hp = new THREE.Vector3(c[0], c[1], c[2]); return { t:'pt', p:hp, n:new THREE.Vector3(-A.dir[0], -A.dir[1], -A.dir[2]), key:A.key, hole:A.name || 'ボルト', reg:{ verts:[hp], tris:[], w:[] } }; }
    var hs = ray.intersectObjects(meshes, false), h = hs[0]; if (!h || h.faceIndex == null) return null;
    var ck = h.object.uuid + ':' + h.faceIndex, reg = msLast && msLast.ck === ck ? msLast.reg : faceRegion(h.object, h.faceIndex); if (!reg) return null;
    msLast = { ck:ck, reg:reg };
    var best = null, bd = 14;
    reg.verts.forEach(function(v){ var q = scr(v, rc), dd = Math.hypot(q.x - mx, q.y - my); if (dd < bd) { bd = dd; best = v; } });
    var n = reg.n.clone(); if (n.dot(ray.ray.direction) > 0) n.negate();   // 見て いる 側を 外向きに（裏の 面を 押した とき）
    return { t:best ? 'pt' : 'face', p:best ? best.clone() : h.point.clone(), n:n, key:h.object.userData.key, reg:reg };
  }
  function msOut(i){ var o = { t:i.t, p:{ x:i.p.x, y:i.p.y, z:i.p.z }, n:[i.n.x, i.n.y, i.n.z], key:i.key }; if (i.hole) o.hole = i.hole; return o; }
  function clearDeep(G){ while (G.children.length) { var o = G.children.pop(); o.traverse(function(c){ if (c.geometry) c.geometry.dispose(); if (c.material) { if (c.material.map) c.material.map.dispose(); c.material.dispose(); } }); } }
  function faceMesh(reg, color, op){
    var a = []; reg.tris.forEach(function(i){ for (var j = 0; j < 9; j++) a.push(reg.w[i * 9 + j] + reg.n.getComponent(j % 3) * 0.6); });
    var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(a, 3));
    var m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color:new THREE.Color(color), transparent:true, opacity:op, depthWrite:false, side:THREE.DoubleSide, polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2 }));
    m.renderOrder = 996; return m;
  }
  var msHT = 0;
  renderer.domElement.addEventListener('pointermove', function(e){
    if (!MS || e.buttons) return; var now = performance.now(); if (now - msHT < 30) return; msHT = now;
    var inf = msHit(e); clearDeep(msHov);
    if (inf) {
      if (inf.t === 'face') msHov.add(faceMesh(inf.reg, '#3b82f6', 0.35));
      msHov.add(pts(inf.reg.verts.length < 400 ? inf.reg.verts : [], '#475569', 8, false));
      msHov.add(pts([inf.p], inf.t === 'pt' ? '#e07a1f' : '#2563eb', 18, true));
    }
    renderer.domElement.style.cursor = inf ? 'crosshair' : 'default';
    if (MS.onHover) MS.onHover(inf ? msOut(inf) : null); dirty = true;
  });
  function measureMode(opts){ MS = opts || null; msLast = null; clearDeep(msHov); renderer.domElement.style.cursor = MS ? 'default' : ''; dirty = true; }
  // 部材 key の 面で、点 p を 通り 向き n の 平面に ある 面（部材を 動かした あとの 面を 探す）
  function regionAt(key, p, n){
    var N = new THREE.Vector3(n[0], n[1], n[2]), d = N.x * p.x + N.y * p.y + N.z * p.z, best = null;
    meshes.forEach(function(m){ if (best || m.userData.key !== key) return; var w = wtris(m);
      for (var i = 0, c = w.length / 9; i < c; i++) { var t = triN(w, i); if (!t || Math.abs(t.n.dot(N)) < 0.9995 || Math.abs(t.n.dot(t.a) * Math.sign(t.n.dot(N)) - d) > 0.6) continue; best = faceRegion(m, i); return; } });
    return best;
  }
  function tagSprite(txt, bg){ var sp = textSprite(txt, bg); sp.center.set(0.5, 0.5); sp.scale.multiplyScalar(0.8); return sp; }
  // 測った 結果：list = [{ a:{x,y,z}, b:{x,y,z}, text, color, faces:[{key,p,n,color}]（色を ぬる 面）, tags:[{p,text,color}]（A・B の 札） }]、one＝1 つ目を 押した ところ（info）
  function setMeasures(list, one){
    clearDeep(msG);
    (list || []).forEach(function(m){
      var A = new THREE.Vector3(m.a.x, m.a.y, m.a.z), B = new THREE.Vector3(m.b.x, m.b.y, m.b.z), col = new THREE.Color(m.color || '#e07a1f');
      var ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints([A, B]), new THREE.LineBasicMaterial({ color:col, depthTest:false })); ln.renderOrder = 1000; msG.add(ln);
      if (m.leg) { var dl = new THREE.LineDashedMaterial({ color:0x64748b, dashSize:20, gapSize:14, depthTest:false }), P = [A, new THREE.Vector3(B.x, A.y, A.z), new THREE.Vector3(B.x, A.y, B.z), B];   // X・Z・Y の 足（点線）
        var lg = new THREE.Line(new THREE.BufferGeometry().setFromPoints(P), dl); lg.computeLineDistances(); lg.renderOrder = 999; msG.add(lg); }
      msG.add(pts([A, B], m.color || '#e07a1f', 12, false));
      if (m.text) { var sp = textSprite(m.text, m.color || '#e07a1f'); sp.center.set(0.5, -0.15); sp.position.copy(A).add(B).multiplyScalar(0.5); msG.add(sp); }
      (m.faces || []).forEach(function(f){ var rg = regionAt(f.key, f.p, f.n); if (rg) { var fm = faceMesh(rg, f.color, 0.45); msG.add(fm);
      } });
      (m.tags || []).forEach(function(t){ var sp = tagSprite(t.text, t.color); sp.position.set(t.p.x, t.p.y, t.p.z); msG.add(sp); msG.add(pts([t.p], t.color, 14, false)); });
    });
    if (one) msG.add(pts([new THREE.Vector3(one.p.x, one.p.y, one.p.z)], '#e07a1f', 20, true));
    dirty = true;
  }
  // 描くのは 変わった ときだけ（止まって いる 間は 描かない。回す・ズーム・慣性の 間と 部材・地面・大きさが 変わった とき）
  var dirty = true;
  controls.addEventListener('change', function(){ dirty = true; });
  (function loop(){ if (!alive) return; requestAnimationFrame(loop); if (controls.update()) dirty = true; if (dirty) { if (LT.follow) placeLight(); dirty = false; renderer.render(scene, cam); if (tags.length) tagsPlace(); } })();
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
    e.preventDefault(); if (!onCtx || PM || MS) return;
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
      var col = f.ok === false ? 0x9aa0a8 : f.id === (szDrag && szDrag.id) ? 0xe07a1f : f.touch ? 0x8fd1a8 : 0x1f9d55, mat = new THREE.MeshBasicMaterial({ color:col, depthTest:false, transparent:true, opacity:0.95 });
      var a = new THREE.Group(), sh = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.35, R * 0.35, L * 0.7, 12), mat), hd = new THREE.Mesh(new THREE.ConeGeometry(R, L * 0.35, 16), mat.clone());
      var dot = new THREE.Mesh(new THREE.SphereGeometry(R * 0.55, 12, 8), mat.clone());
      sh.position.y = L * 0.35; hd.position.y = L * 0.7 + L * 0.175; a.add(sh); a.add(hd); a.add(dot);
      a.position.set(f.p.x, f.p.y, f.p.z); a.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(f.n[0], f.n[1], f.n[2]).normalize());
      a.traverse(function(c){ c.renderOrder = 998; c.userData.face = f.id; c.userData.ok = f.ok !== false; }); szG.add(a);
    });
    // 部材の 寸法（幅・奥行・高さ）：寸法線と 札。変えて いる 寸法は 橙（v0.8.24 本人「寸法を 変更する とき 部材の 寸法を 表示させて」）
    (SZ.dims || []).forEach(function(d){
      // 矢印の 先の 札（移動した 距離。v0.8.95）：面の 中心 から 外向きに 矢印の 長さ 少し 先
      if (d.tip) { var st = textSprite(d.text, d.hot ? '#e07a1f' : '#1f3a5f'); st.center.set(0.5, 0.5); st.userData.tipAx = d.ax || null;   // 札を 押すと 数を 打てる（v0.8.109）
        st.position.set(d.a.x + d.tip[0] * L * 1.3, d.a.y + d.tip[1] * L * 1.3, d.a.z + d.tip[2] * L * 1.3); szG.add(st); return; }
      var col = d.hot ? 0xe07a1f : 0x1f3a5f, lm = new THREE.LineBasicMaterial({ color:col, depthTest:false }), A = new THREE.Vector3(d.a.x, d.a.y, d.a.z), B = new THREE.Vector3(d.b.x, d.b.y, d.b.z);
      var pts = [A, B], t = d.t ? new THREE.Vector3(d.t[0], d.t[1], d.t[2]).multiplyScalar(L * 0.18) : null;
      if (t) pts.push(A.clone().sub(t), A.clone().add(t), B.clone().sub(t), B.clone().add(t));
      var ln = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), lm); ln.renderOrder = 997; szG.add(ln);
      if (d.e) d.e.forEach(function(e){ var el = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(e[0].x, e[0].y, e[0].z), new THREE.Vector3(e[1].x, e[1].y, e[1].z)]), lm.clone()); el.renderOrder = 997; szG.add(el); });
      if (d.text) { var sp = textSprite(d.text, d.hot ? '#e07a1f' : '#1f3a5f'); sp.center.set(0.5, 0.5); sp.position.copy(A).add(B).multiplyScalar(0.5); szG.add(sp); }   // 札が 無い ときは 線だけ（札は HTML。v0.8.42）
    });
  }
  function szHit(e){
    if (!SZ) return null; var rc = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2((e.clientX - rc.left) / rc.width * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1), cam);
    var hs = ray.intersectObjects(szG.children, true).filter(function(h){ return h.object.userData.ok; }); return hs.length ? hs[0].object.userData.face : null;
  }
  // 移動した 距離の 札（矢印の 先）に 当たったか：軸（'x'｜'y'｜'z'）を 返す
  function tipHit(e){
    if (!SZ || !SZ.onTip) return null; var rc = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2((e.clientX - rc.left) / rc.width * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1), cam);
    var sp = szG.children.filter(function(o){ return o.isSprite && o.userData.tipAx; }), hs = ray.intersectObjects(sp, false); return hs.length ? hs[0].object.userData.tipAx : null;
  }
  renderer.domElement.addEventListener('pointerdown', function(e){
    if (!SZ || e.button !== 0) return;
    var ta = tipHit(e); if (ta) { SZ.onTip(ta, e.clientX, e.clientY); e.stopImmediatePropagation(); e.preventDefault(); return; }
    var id = szHit(e); if (!id) return;
    var f = SZ.faces.filter(function(x){ return x.id === id; })[0], rc = renderer.domElement.getBoundingClientRect();
    var a = scr(new THREE.Vector3(f.p.x, f.p.y, f.p.z), rc), b = scr(new THREE.Vector3(f.p.x + f.n[0] * 100, f.p.y + f.n[1] * 100, f.p.z + f.n[2] * 100), rc);
    var dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    szDrag = { id:id, x:e.clientX, y:e.clientY, ux:dx / l, uy:dy / l, per:l / 100 * (e.shiftKey ? 10 : 1), moved:false, fine:!!e.shiftKey };   // per＝1 mm の 画面の 長さ。Shift＝0.1 mm 刻みで 10 倍 ゆっくり（v0.8.109）
    renderer.domElement.setPointerCapture(e.pointerId); e.stopImmediatePropagation(); e.preventDefault();
  }, true);
  renderer.domElement.addEventListener('pointermove', function(e){
    if (!SZ) return;
    if (!szDrag) { if (!e.buttons) renderer.domElement.style.cursor = szHit(e) ? 'grab' : tipHit(e) ? 'text' : ''; return; }
    var mx = e.clientX - szDrag.x, my = e.clientY - szDrag.y; if (!szDrag.moved && Math.hypot(mx, my) < 4) return;
    szDrag.moved = true; renderer.domElement.style.cursor = 'grabbing';
    SZ.onDrag(szDrag.id, (mx * szDrag.ux + my * szDrag.uy) / szDrag.per, false, '', szDrag.fine);
  });
  renderer.domElement.addEventListener('pointerup', function(e){
    if (!szDrag) return; var d = szDrag; szDrag = null; renderer.domElement.style.cursor = '';
    var mx = e.clientX - d.x, my = e.clientY - d.y;
    if (SZ) SZ.onDrag(d.id, d.moved ? (mx * d.ux + my * d.uy) / d.per : 0, true, d.moved ? '' : 'click', d.fine);
    e.stopImmediatePropagation(); down = null;
  }, true);
  // 地面の 見え方：''＝ふつう｜'half'＝半透明（GL の 下も 見える）｜'off'＝出さない（格子は のこす）
  function setGround(mode){
    var gm = ground.material;
    ground.visible = mode !== 'off';
    gm.transparent = mode === 'half'; gm.opacity = mode === 'half' ? 0.35 : 1; gm.depthWrite = mode !== 'half'; gm.needsUpdate = true; dirty = true;
  }
  return { update:update, setMode:setMode, mode:function(){ return MODE; }, fit:fit, setGround:setGround, setTexture:setTexture, setTexScale:setTexScale, setLight:setLight, jariMode:function(cb){ JM = cb || null; renderer.domElement.style.cursor = JM ? 'pointer' : ''; }, pickMode:pickMode, setMarks:setMarks, measureMode:measureMode, setMeasures:setMeasures, sizeMode:sizeMode, dragging:function(){ return !!szDrag; }, project:function(p){ var rc = renderer.domElement.getBoundingClientRect(), q = scr(new THREE.Vector3(p.x, p.y, p.z), rc); return { x:rc.left + q.x, y:rc.top + q.y }; }, png:function(){ renderer.render(scene, cam); return renderer.domElement.toDataURL('image/png'); }, dispose:function(){ alive = false; clear(); cache.forEach(function(pg){ pg.traverse(function(o){ if (o.geometry) o.geometry.dispose(); }); }); cache.clear(); renderer.dispose(); } };
}

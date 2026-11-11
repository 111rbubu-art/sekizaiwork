// 部材ライブラリと セットの 分け方（2026-11-08 本人）：
//   部材（buzai/1）＝ 形の モデル ＋ 図面の 情報。部材ライブラリ（SharePoint の 部材ライブラリ/部材/<id>.json）に 1 つずつ。
//   セット（buzai-set/2）＝ 枠（役目・部材の id と 版・左右反転・置き場所）＋ ルール。部材の 中身は 入れない。
//   分類は 2 段（大きな 分類 × 役目）。ルールは 役目に 付ける。和型・洋型・寸・メーカーは タグ。
//   差し替えは 部材の 大きさの まま 置く（幅の 中心・前の 面 そろえ）。ルールの ある 役目は ルールで 置き直す。
// 前の 形の セット（buzai-set/1：parts[].part に 部材を 丸ごと）は 読む ときに 自動で 分ける（左右で 同じ 石は 左右反転で 1 つ）。
// 組み立て（kumitate.html）と 図面（zumen.html）で 共通。Three なし・node でも 動く。
(function(root){
  var BUNRUI = [
    { g:'石塔の 本体', roles:['竿', '上台', '中台', '下台'] },
    { g:'石塔の 台まわり', roles:['芝台前', '芝台横', '芝台後', '拝石'] },
    { g:'供養具', roles:['水鉢', '花立', '香炉', '線香立'] },
    { g:'外柵', roles:['階段', '中仕切', '拝石台', '腰石前', '腰石横', '腰石後', '羽目', '羽目柱', '親柱', '笠石'] },
    { g:'納骨室', roles:['カロート'] },
    { g:'その他', roles:['塔婆柱', '墓誌', '灯籠', '敷石', '物置台', '金具'] }
  ];
  // 名前から 役目（長い ものから。拝石台＞拝石、羽目柱＞羽目、中台横・中台後＞中台）
  var ROLE_WORDS = [];
  BUNRUI.forEach(function(b){ b.roles.forEach(function(r){ ROLE_WORDS.push(r); }); });
  ROLE_WORDS.sort(function(a, b){ return b.length - a.length; });
  var ALIAS = [[/塔婆/, '塔婆柱'], [/棹/, '竿'], [/水鉢/, '水鉢'], [/香炉/, '香炉'], [/花立/, '花立'], [/カロート|納骨/, 'カロート']];
  function baseName(n){ return String(n || '').replace(/[（(][左右][）)]/g, '').trim(); }
  function roleOf(name){
    var n = baseName(name);
    for (var i = 0; i < ROLE_WORDS.length; i++) if (n.indexOf(ROLE_WORDS[i]) >= 0) return ROLE_WORDS[i];
    for (var j = 0; j < ALIAS.length; j++) if (ALIAS[j][0].test(n)) return ALIAS[j][1];
    var m = /^(中台|上台|下台|芝台)/.exec(n); if (m) return m[1] === '芝台' ? '芝台横' : m[1];
    return '';
  }
  function groupOf(role){ for (var i = 0; i < BUNRUI.length; i++) if (BUNRUI[i].roles.indexOf(role) >= 0) return BUNRUI[i].g; return 'その他'; }
  function clone(o){ return JSON.parse(JSON.stringify(o)); }

  // ── 左右反転（x を 反対に。側面の 穴は 左の 面 ⇔ 右の 面）──
  function flipPts(pts){ return pts.map(function(q){ var r = q.slice(); r[0] = -q[0]; return r; }).reverse(); }
  function flipView(v, side){
    if (!v) return v; var o = clone(v);
    if (!side) { if (o.out) o.out = flipPts(o.out); (o.holes || []).forEach(function(h){ if (h.pts) h.pts = flipPts(h.pts); if (h.x != null) h.x = -h.x; if (h.fit && h.fit.x) h.fit.x = h.fit.x === 'L' ? 'R' : 'L'; }); (o.cuts || []).forEach(function(c){ if (c.pts) c.pts = flipPts(c.pts); }); }
    else (o.holes || []).forEach(function(h){ if (h.from === 'left') h.from = 'right'; else if (h.from === 'right') h.from = 'left'; });
    return o;
  }
  function mirror(part){
    if (!part) return part; var p = clone(part);
    (p.components || []).forEach(function(c){ var v = c.shape && c.shape.views; if (!v) return;
      ['front', 'top', 'back', 'bottom'].forEach(function(k){ if (v[k]) v[k] = flipView(v[k], false); }); if (v.side) v.side = flipView(v.side, true); });
    p.__mirror = !part.__mirror; return p;
  }
  // 形が 同じか（点は 0.1 mm に まるめ、並びの 向きは 問わない）
  function sig(part){
    var c = part && part.components && part.components[0], v = c && c.shape && c.shape.views; if (!v) return null;
    function ps(pts){ return (pts || []).map(function(q){ return Math.round(q[0] * 10) + ',' + Math.round(q[1] * 10); }).sort().join(' '); }
    var o = {}; Object.keys(v).sort().forEach(function(k){ var x = v[k]; if (!x || typeof x !== 'object') { o[k] = x; return; }
      o[k] = { out:ps(x.out), holes:(x.holes || []).map(function(h){ return ps(h.pts) + '|' + h.depth + '|' + (h.from || ''); }).sort(), cuts:(x.cuts || []).map(function(q){ return ps(q.pts) + '|' + q.y0 + '|' + q.y1; }).sort(), W:x.W, D:x.D, H:x.H }; });
    return JSON.stringify(o);
  }
  function sameShape(a, b){ var x = sig(a), y = sig(b); return !!x && x === y; }
  // 大きさ違いの 形が 同じか：a を b の 大きさに（buzai-engine の 決まりで）伸ばして 重ね、いちばん 大きい ずれ（mm）と その 場所。
  // 面が 片方に しか 無い・穴の 数が ちがう ときは Infinity（v0.3.9）
  function shapeGap(a, b){
    var BZ = root.BZ; if (!BZ || !BZ.scaleViews) return { gap:Infinity, where:'' };
    var va = a && a.components && a.components[0] && a.components[0].shape && a.components[0].shape.views, vb = b && b.components && b.components[0] && b.components[0].shape && b.components[0].shape.views;
    if (!va || !vb || !va.front || !vb.front) return { gap:Infinity, where:'形の データ' };
    var pv = function(p, k){ var x = p.params && p.params[k]; return x ? +(x.value != null ? x.value : x.default) : 0; };
    var W = pv(b, 'W'), D = pv(b, 'D'), H = pv(b, 'H'); if (!(W > 0 && D > 0 && H > 0)) return { gap:Infinity, where:'大きさ' };
    var A = BZ.scaleViews(va, W, D, H), B = BZ.scaleViews(vb, W, D, H), worst = { gap:0, where:'' };
    var NM = { front:'正面', side:'右側面', top:'天面' };
    function hd(P, Q){ if (!P || !Q || !P.length || !Q.length) return (P && P.length) === (Q && Q.length) ? 0 : Infinity; var m = 0;
      [[P, Q], [Q, P]].forEach(function(z){ z[0].forEach(function(p){ var d = Infinity; z[1].forEach(function(q){ d = Math.min(d, Math.hypot(p[0] - q[0], p[1] - q[1])); }); m = Math.max(m, d); }); }); return m; }
    function put(g, w){ if (g > worst.gap) worst = { gap:g, where:w }; }
    ['front', 'side', 'top'].forEach(function(k){ var x = A[k], y = B[k];
      if (!x && !y) return; if (!x || !y) { if ((x && (x.out || (x.holes || []).length)) || (y && (y.out || (y.holes || []).length))) put(Infinity, NM[k] + 'の 図'); return; }
      put(hd(x.out, y.out), NM[k] + 'の 外形');
      var hx = x.holes || [], hy = y.holes || []; if (hx.length !== hy.length) { put(Infinity, NM[k] + 'の 穴の 数'); return; }
      var used = [];
      hx.forEach(function(h){ var bi = -1, bd = Infinity; hy.forEach(function(g, j){ if (used.indexOf(j) >= 0) return; var d = hd(h.pts, g.pts); if (d < bd) { bd = d; bi = j; } });
        if (bi < 0) return; used.push(bi); put(bd, NM[k] + 'の 穴の 位置'); put(Math.abs((h.depth || 0) - (hy[bi].depth || 0)), NM[k] + 'の 穴の 深さ'); });
      var cx = x.cuts || [], cy = y.cuts || []; if (cx.length !== cy.length) put(Infinity, NM[k] + 'の 切り欠きの 数');
      else cx.forEach(function(c, i){ put(hd(c.pts, cy[i].pts), NM[k] + 'の 切り欠き'); });
    });
    return worst;
  }

  // ── タグ（セットの 名前から：和型・洋型・寸・メーカーの 名前 など）──
  function tagsOf(S){
    var n = String(S.name || ''), t = [];
    if (/和型/.test(n)) t.push('和型'); if (/洋型/.test(n)) t.push('洋型');
    var m = /(\d+)寸/.exec(n); if (m) t.push(m[1] + '寸');
    var q = /[（(]([^）)]+)[）)]/.exec(n); if (q) t.push(q[1]);
    var rest = n.replace(/[（(][^）)]*[）)]/g, ' ').replace(/和型|洋型|\d+寸|外柵|石塔|\d{3,4}\s*[×x]\s*\d{3,4}/g, ' ').trim().split(/\s+/)[0]; if (rest) t.push(rest);
    if (S.kind === 'fence') { var w = /(\d{3,4})\s*[×x]\s*(\d{3,4})/.exec(n); t.push('外柵'); if (w) t.push(w[1] + '×' + w[2]); }
    return t.filter(function(x, i, a){ return x && a.indexOf(x) === i; });
  }

  // ── 前の 形の セット → 新しい 形（枠と 参照）＋ 部材 ──
  function isNew(S){ return !!(S && S.slots); }
  function split(S){
    if (isNew(S)) return { set:S, parts:[] };
    var parts = {}, slots = [], tags = tagsOf(S), byKey = {};
    (S.parts || []).forEach(function(q){ byKey[q.key] = q; });
    (S.parts || []).forEach(function(q){
      var role = roleOf(q.name), slot = { key:q.key, no:q.no, name:q.name, role:role, at:clone(q.at || { x:0, y:0, z:0 }), w:q.w, d:q.d, h:q.h, finish:q.finish || '', kakou:q.kakou || '' };
      if (q.stone) slot.stone = q.stone;
      if (!q.part) { slots.push(slot); return; }   // 形が 無い（箱）
      // 右（_R）で、左（_L）を 反転した ものと 同じ 形なら 左の 部材を 反転で 使う
      var mL = /^(.*)_R$/.exec(q.key), L = mL && byKey[mL[1] + '_L'];
      if (L && L.part && sameShape(mirror(L.part), q.part)) { var idL = partIdOf(S, L); slot.part = { id:idL, version:(parts[idL] || L.part).version || 0 }; slot.mirror = true; slots.push(slot); return; }
      var id = partIdOf(S, q), p = clone(q.part);
      p.id = id; p.name = baseName(q.name); p.role = role; p.category = role || p.category || ''; p.tags = tags.slice();
      if (!p.finish) p.finish = q.finish || ''; if (!p.kakou) p.kakou = q.kakou || '';
      p.version = p.version || 0; p.from = p.from || 'set'; p.sources = (p.sources || []).concat([{ set:S.id, key:q.key }]);
      parts[id] = p; slot.part = { id:id, version:p.version }; slots.push(slot);
    });
    var N = clone(S); delete N.parts; N.schema = 'buzai-set/2'; N.slots = slots; N.from1 = { version:S.version || 0 };
    return { set:N, parts:Object.keys(parts).map(function(k){ return parts[k]; }) };
  }
  // 部材の id：左右の 組は _L を 取る（反転で 右にも 使う）
  function partIdOf(S, q){
    var base = (q.part && q.part.id) || (S.id + '_' + q.key), m = /^(.*)_L$/.exec(q.key);
    if (m && (S.parts || []).some(function(x){ return x.key === m[1] + '_R'; })) base = base.replace(/_L$/, '');
    return base;
  }
  // ── 新しい 形の セット ＋ 部材ライブラリ → 組み立てエンジンが 読む 形（parts[].part） ──
  // lib＝{ id: 部材 }。部材が 無い 枠は 箱（枠の w・d・h）。adds＝この 案件だけ 足した 枠
  function resolve(S, lib, adds){
    if (!isNew(S)) return S;
    var R = clone(S); delete R.slots; R.schema = 'buzai-set/1'; R.parts = []; R.missing = [];
    (S.slots || []).concat(adds || []).forEach(function(sl){
      var p = sl.part && lib[sl.part.id], q = { key:sl.key, no:sl.no, name:sl.name, at:clone(sl.at || { x:0, y:0, z:0 }), w:sl.w, d:sl.d, h:sl.h, finish:sl.finish || '', kakou:sl.kakou || '', role:sl.role || '', partId:sl.part ? sl.part.id : '', mirror:!!sl.mirror, added:!!sl.added };
      if (sl.stone) q.stone = sl.stone;
      if (p) { var d = sl.mirror ? mirror(p) : clone(p); delete d.thumb; q.part = d;
        var pv = function(k){ var x = d.params && d.params[k]; return x ? +(x.value != null ? x.value : x.default) : null; };
        if (pv('W') > 0) { q.w = pv('W'); q.d = pv('D'); q.h = pv('H'); }
        // 大きさ違いを まとめた 部材：セットの 枠の 大きさ（sl.size）で 使う。形の 中は 部材の 決まりで 伸びる（buzai-engine の scaleViews）
        var zs = sl.size; if (zs && zs.W > 0 && zs.D > 0 && zs.H > 0) { q.w = +zs.W; q.d = +zs.D; q.h = +zs.H; ['W', 'D', 'H'].forEach(function(k){ if (d.params && d.params[k]) d.params[k].value = +zs[k]; }); q.size = { W:+zs.W, D:+zs.D, H:+zs.H }; }
        if (!q.finish) q.finish = d.finish || ''; if (!q.kakou) q.kakou = d.kakou || ''; }
      else if (sl.part) R.missing.push(sl.part.id);
      if (q.w > 0) R.parts.push(q);
    });
    return R;
  }
  // 見本図面（1 枚）：画像は IndexedDB（buzai-mihon）、部材には 印（mihon:{key,w,h,at}）だけ。ファイル・SharePoint では mihon.src に 画像を 入れる
  var MHC = {}, MHDB = null;
  function mhDb(){ return MHDB || (MHDB = new Promise(function(ok, ng){ try { var r = indexedDB.open('buzai-mihon', 1); r.onupgradeneeded = function(){ r.result.createObjectStore('img'); }; r.onsuccess = function(){ ok(r.result); }; r.onerror = function(){ ng(r.error); }; } catch (e) { ng(e); } })); }
  function mhPut(key, src){ MHC[key] = src; return mhDb().then(function(db){ return new Promise(function(ok){ var t = db.transaction('img', 'readwrite'); t.objectStore('img').put(src, key); t.oncomplete = ok; t.onerror = ok; }); }).catch(function(){}); }
  function mhGet(m){ if (!m || !m.key) return Promise.resolve(''); if (MHC[m.key]) return Promise.resolve(MHC[m.key]);
    return mhDb().then(function(db){ return new Promise(function(ok){ var q = db.transaction('img').objectStore('img').get(m.key); q.onsuccess = function(){ if (q.result) MHC[m.key] = q.result; ok(q.result || ''); }; q.onerror = function(){ ok(''); }; }); }).catch(function(){ return ''; }); }
  function mhIn(p){ var m = p && p.mihon; if (!m || !m.src) return; m.key = m.key || (p.id + '@' + (m.at || Date.now())); mhPut(m.key, m.src); delete m.src; }
  function mhOut(d){ if (!d || !d.mihon) return Promise.resolve(d); return mhGet(d.mihon).then(function(src){ if (!src) return d; var e = JSON.parse(JSON.stringify(d)); e.mihon.src = src; return e; }); }
  function mhNow(m){ return m && m.key ? MHC[m.key] || '' : ''; }
  root.BL = { BUNRUI:BUNRUI, roleOf:roleOf, groupOf:groupOf, baseName:baseName, mirror:mirror, sameShape:sameShape, shapeGap:shapeGap, tagsOf:tagsOf, isNew:isNew, split:split, resolve:resolve, mhPut:mhPut, mhGet:mhGet, mhIn:mhIn, mhOut:mhOut, mhNow:mhNow };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.BL;
})(typeof window !== 'undefined' ? window : this);

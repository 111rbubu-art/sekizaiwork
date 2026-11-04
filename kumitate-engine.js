// 組み立て（墓所）の エンジン。画面・Three.js なし（node でも 動く）。
// あとで 石の 図面（zumen.html）に モードとして 入れる ときは、この ファイルを そのまま 読めば よい。
// 旧 墓石設計シミュレーター（gravestone-app.js）の 置き方（符号の 接合）・ノウハウ式（dim_calc / pos_calc）・干渉チェック・見積を 書き直した もの。
// ちがう 所：式は new Function を 使わない 自前の 計算機／才数は 1 尺＝303.03mm／合計は 小計の 合計（旧の「合計と 外柵小計が 合わない」を 直した）／
// 土留めは 外柵の 部材 そのもの なので 才数を 二重に 数えない
var KM = (function(){
  'use strict';
  var SHAKU = 303.03;
  function sai(w, d, h){ return (w / SHAKU) * (d / SHAKU) * (h / SHAKU); }
  function r1(n){ return Math.round(n * 10) / 10; }
  function roundUp(v, unit){ unit = unit || 1000; return Math.ceil(v / unit) * unit; }
  function clone(o){ return JSON.parse(JSON.stringify(o)); }

  // ── 式の 計算機（石の 図面の BZ.evalExpr と 同じ 書き方。new Function は 使わない）──
  var FW = { '＋':'+', '－':'-', '−':'-', '×':'*', '＊':'*', '÷':'/', '／':'/', '（':'(', '）':')', '，':',', '、':',', '＜':'<', '＞':'>', '＝':'=', '！':'!', '．':'.', '　':' ', '≦':'<=', '≧':'>=', '≠':'!=' };
  function norm(s){ return String(s).replace(/[＋－−×＊÷／（），、＜＞＝！．　≦≧≠]/g, function(c){ return FW[c]; }).replace(/[０-９]/g, function(c){ return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }); }
  var FN = {
    'もし':function(a){ if (a.length !== 3) throw new Error('もし（条件, 合うとき, 合わないとき）の 形で 書いて ください'); return a[0] ? a[1] : a[2]; },
    '最大':function(a){ return Math.max.apply(null, a); }, '最小':function(a){ return Math.min.apply(null, a); },
    '絶対値':function(a){ return Math.abs(a[0]); }, '四捨五入':function(a){ return Math.round(a[0]); },
    '切上':function(a){ return Math.ceil(a[0]); }, '切捨':function(a){ return Math.floor(a[0]); }, 'ルート':function(a){ return Math.sqrt(a[0]); }
  };
  function tokens(src){
    var s = norm(src), out = [], i = 0, m;
    while (i < s.length) {
      var ch = s[i], rest = s.slice(i);
      if (/\s/.test(ch)) { i++; continue; }
      if ((m = /^(?:\d+\.?\d*|\.\d+)/.exec(rest))) { out.push({ t:'n', v:parseFloat(m[0]) }); i += m[0].length; continue; }
      if ((m = /^(?:<=|>=|==|!=|&&|\|\|)/.exec(rest))) { out.push({ t:'o', v:m[0] }); i += 2; continue; }
      if ('+-*/(),<>=!?:'.indexOf(ch) >= 0) { out.push({ t:'o', v:ch }); i++; continue; }
      if ((m = /^[^\s+\-*\/(),<>=!?:&|]+/.exec(rest))) { out.push({ t:'id', v:m[0] }); i += m[0].length; continue; }
      throw new Error('読めない 文字「' + ch + '」');
    }
    return out;
  }
  function evalExpr(src, look){
    var tk = tokens(src), p = 0;
    if (!tk.length) throw new Error('式が 空です');
    function peek(v){ return tk[p] && tk[p].t === 'o' && tk[p].v === v; }
    function need(v){ if (!peek(v)) throw new Error('「' + v + '」が 足りません'); p++; }
    function tern(){ var c = or(); if (peek('?')) { p++; var a = tern(); need(':'); var b = tern(); return c ? a : b; } return c; }
    function or(){ var a = and(); while (peek('||')) { p++; var b = and(); a = +(a || b); } return a; }
    function and(){ var a = cmp(); while (peek('&&')) { p++; var b = cmp(); a = +(a && b); } return a; }
    function cmp(){ var a = add(); while (tk[p] && tk[p].t === 'o' && ['<', '>', '<=', '>=', '=', '==', '!='].indexOf(tk[p].v) >= 0) { var o = tk[p++].v, b = add();
        a = o === '<' ? +(a < b) : o === '>' ? +(a > b) : o === '<=' ? +(a <= b) : o === '>=' ? +(a >= b) : o === '!=' ? +(a !== b) : +(a === b); } return a; }
    function add(){ var a = mul(); while (peek('+') || peek('-')) { var o = tk[p++].v, b = mul(); a = o === '+' ? a + b : a - b; } return a; }
    function mul(){ var a = una(); while (peek('*') || peek('/')) { var o = tk[p++].v, b = una(); if (o === '/' && b === 0) throw new Error('0 で 割って います'); a = o === '*' ? a * b : a / b; } return a; }
    function una(){ if (peek('-')) { p++; return -una(); } if (peek('+')) { p++; return una(); } if (peek('!')) { p++; return +!una(); } return prim(); }
    function prim(){
      var t = tk[p];
      if (!t) throw new Error('式が 途中で 終わって います');
      if (t.t === 'n') { p++; return t.v; }
      if (peek('(')) { p++; var v = tern(); need(')'); return v; }
      if (t.t === 'id') {
        p++;
        if (peek('(')) { var f = FN[t.v]; if (!f) throw new Error('「' + t.v + '」という 関数は ありません'); p++; var args = [];
          if (!peek(')')) { args.push(tern()); while (peek(',')) { p++; args.push(tern()); } } need(')'); return f(args); }
        if (look) return look(t.v);
        throw new Error('「' + t.v + '」が わかりません');
      }
      throw new Error('「' + t.v + '」の ところが 読めません');
    }
    var r = tern();
    if (p < tk.length) throw new Error('「' + tk[p].v + '」から 先が 読めません');
    return r;
  }

  // ── ノウハウ式（旧と 同じ 順番で 名前を 数に 置きかえて から 計算）──
  // 1. 敷地の 変数 → 2. 部材名_W幅 など（長い 名前から）→ 3. 計算（全角・日本語の 関数は 計算機が 読む）
  var DIMSUF = { 'W幅':'w', 'H高':'h', 'D奥':'d', '幅':'w', '高さ':'h', '奥行':'d', '位置X':'offX', '位置Y':'offY', '位置Z':'offZ' };
  function escRe(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function formula(expr, parts, site, errOut){
    if (expr == null || String(expr).trim() === '') return NaN;
    var code = String(expr);
    code = code.replace(/敷地W（間口）/g, '(' + site.W + ')').replace(/敷地D（奥行）/g, '(' + site.D + ')')
      .replace(/土留め高さ/g, '(' + site.domeH + ')').replace(/土留め厚み/g, '(' + site.domeT + ')').replace(/石塔奥行調整/g, '(' + (site.adj || 0) + ')');
    var ents = Object.keys(parts).map(function(k){ return { k:k, name:parts[k].name || '' }; }).filter(function(e){ return e.name; })
      .sort(function(a, b){ return b.name.length - a.name.length; });
    ents.forEach(function(e){
      var re = new RegExp(escRe(e.name) + '_(W幅|H高|D奥|幅|高さ|奥行|位置X|位置Y|位置Z)', 'g');
      code = code.replace(re, function(_m, dm){ var v = parts[e.k][DIMSUF[dm]]; return '(' + (v != null ? v : 0) + ')'; });
    });
    code = code.replace(/parts\["([^"]+)"\]\.([whd])/g, function(_m, pk, dim){ var p = parts[pk]; return '(' + (p && p[dim] != null ? p[dim] : 0) + ')'; });
    try { var v = evalExpr(code); return typeof v === 'number' && isFinite(v) ? r1(v) : NaN; }
    catch (e) { if (errOut) errOut.push({ expr:expr, msg:e.message }); return NaN; }
  }

  // ── 部材を 集める（石塔・外柵・墓誌・塔婆立・納骨室）──
  var KINDS = [
    { k:'tower', vt:'TOWER_VARIANTS', label:'石塔', grp:'tower' },
    { k:'fence', vt:'FENCE_VARIANTS', label:'外柵', grp:'fence' },
    { k:'boshi', vt:'BOSHI_VARIANTS', label:'墓誌', grp:'other' },
    { k:'toba',  vt:'TOBA_VARIANTS',  label:'塔婆立', grp:'other' },
    { k:'crypt', vt:'CRYPT_VARIANTS', label:'納骨室', grp:'crypt' }
  ];
  function variants(data, kind){ var K = KINDS.filter(function(x){ return x.k === kind; })[0]; return (data.partsData[K.vt] || {}); }
  function gather(data, sel){
    var out = {};
    KINDS.forEach(function(K){
      var v = (data.partsData[K.vt] || {})[sel[K.k]]; if (!v) return;
      var cg = v.colorGroup || K.grp;
      Object.keys(v.parts || {}).forEach(function(pk){ var p = clone(v.parts[pk]); p.cg = cg; p.kind = K.k; out[pk] = p; });
    });
    return out;
  }
  function isActive(data, sel, selId){
    var s = (data.partsData.EDIT_SELECTIONS || []).filter(function(x){ return x.id === selId; })[0];
    if (!s) return false;
    return sel[s.varType] === s.varKey;
  }

  // ── 置き方（符号の 接合。部材の 最小の 角（左・下・奥）が 原点）──
  function s2l(sign, p){ return { dx:(sign && sign.sx || 0) * p.w, dy:(sign && sign.sy || 0) * p.h, dz:(sign && sign.sz || 0) * p.d }; }
  function pos(key, pm, seen){
    seen = seen || {};
    var p = pm[key]; if (!p || seen[key]) return { ox:0, oy:0, oz:0 };
    seen[key] = true;
    if (p.joint && p.joint.dstKey !== key && p.joint.dstKey2 !== key) {
      var d = jointDst(p.joint, pm, seen);
      if (d) { var s = s2l(p.joint.srcSign, p); return { ox:d.x - s.dx + (p.offX || 0), oy:d.y - s.dy + (p.offY || 0), oz:d.z - s.dz + (p.offZ || 0) }; }
    }
    return { ox:p.offX || 0, oy:p.offY || 0, oz:p.offZ || 0 };
  }
  function jointDst(j, pm, seen){
    var dp = pm[j.dstKey]; if (!dp) return null;
    var a = pos(j.dstKey, pm, Object.assign({}, seen)), l = s2l(j.dstSign, dp), p1 = { x:a.ox + l.dx, y:a.oy + l.dy, z:a.oz + l.dz };
    if (!j.dstKey2 || !pm[j.dstKey2]) return p1;
    var dp2 = pm[j.dstKey2], b = pos(j.dstKey2, pm, Object.assign({}, seen)), l2 = s2l(j.dstSign2, dp2);
    return { x:(p1.x + b.ox + l2.dx) / 2, y:(p1.y + b.oy + l2.dy) / 2, z:(p1.z + b.oz + l2.dz) / 2 };
  }

  // ── 寸法の ルール（dim_calc）──
  function applyDim(rules, parts, site, data, sel, errs){
    var next = Object.assign({}, parts);
    rules.slice().sort(function(a, b){ return (a.order || 0) - (b.order || 0); }).forEach(function(r){
      if (!r.enabled || r.type !== 'dim_calc') return;
      if (r.towerFilter && r.towerFilter !== 'all' && r.towerFilter !== sel.tower) return;
      var vm = {}, fs = r.formulas && r.formulas.length ? r.formulas : [{ no:null, expr:r.exprText }];
      fs.forEach(function(f){ vm[f.no] = formula(f.expr, next, site, errs); });
      (r.targets || []).forEach(function(t){
        if (!t.partKey || !next[t.partKey]) return;
        if (t.selId) { var es = (data.partsData.EDIT_SELECTIONS || []).filter(function(x){ return x.id === t.selId; })[0]; if (es && sel[es.varType] && sel[es.varType] !== es.varKey) return; }
        var v = r.formulas && r.formulas.length ? (t.formulaNo != null ? vm[t.formulaNo] : NaN) : vm[null];
        var isOff = /^off[XYZ]$/.test(t.dim), fv = isNaN(v) ? NaN : v + (t.offset || 0);
        if (!isNaN(fv) && (isOff || fv > 0)) { next[t.partKey] = Object.assign({}, next[t.partKey]); next[t.partKey][t.dim] = fv; }
      });
    });
    return next;
  }

  // ── 基準点と 位置の ルール（pos_calc）──
  function anchorPos(a, parts, site, errs){
    if (!a) return null;
    function ex(e, v){ if (e && String(e).trim()) { var x = formula(e, parts, site, errs); if (!isNaN(x)) return x; } return v; }
    if (a.partKey && a.sign && parts[a.partKey]) {
      var p = parts[a.partKey], o = pos(a.partKey, parts), l = s2l(a.sign, p);
      return { x:ex(a.xExpr, o.ox + l.dx), y:ex(a.yExpr, o.oy + l.dy), z:ex(a.zExpr, o.oz + l.dz) };
    }
    if (a.xExpr || a.yExpr || a.zExpr) return { x:ex(a.xExpr, a.x || 0), y:ex(a.yExpr, a.y || 0), z:ex(a.zExpr, a.z || 0) };
    if (a.x == null) return null;
    return { x:a.x, y:a.y, z:a.z };
  }
  function applyPos(rules, parts, anchors, site, data, sel, errs){
    var act = rules.filter(function(r){ return r.enabled && r.type === 'pos_calc' && (!r.towerFilter || r.towerFilter === 'all' || r.towerFilter === sel.tower) && isActive(data, sel, r.srcSelId) && isActive(data, sel, r.dstSelId); });
    var byId = {}, indeg = {}, after = {};
    act.forEach(function(r){ byId[r.id] = r; indeg[r.id] = 0; after[r.id] = []; });
    act.forEach(function(a){ act.forEach(function(b){ if (a.id !== b.id && a.srcSelId === b.dstSelId) { after[a.id].push(b.id); indeg[b.id]++; } }); });
    var ord = function(x, y){ return (byId[x].order || 0) - (byId[y].order || 0); };
    var q = act.filter(function(r){ return indeg[r.id] === 0; }).map(function(r){ return r.id; }).sort(ord), topo = [];
    while (q.length) { var id = q.shift(); topo.push(byId[id]); var nx = after[id].filter(function(n){ return --indeg[n] === 0; }); q = q.concat(nx).sort(ord); }
    act.filter(function(r){ return topo.indexOf(r) < 0; }).sort(function(a, b){ return (a.order || 0) - (b.order || 0); }).forEach(function(r){ topo.push(r); });
    var delta = {}, next = Object.assign({}, parts);
    function gd(s){ return delta[s] || { dx:0, dy:0, dz:0 }; }
    function eff(a, selId){
      if (!a || a.x == null) return null;
      if (a.partKey && a.sign && next[a.partKey]) return anchorPos(a, next, site, errs);
      var d = gd(selId); return { x:a.x + d.dx, y:a.y + d.dy, z:a.z + d.dz };
    }
    topo.forEach(function(r){
      var sa = (anchors[r.srcSelId] || {})[r.srcAnchor === 'a1' ? 'a1' : 'a2'], da = (anchors[r.dstSelId] || {})[r.dstAnchor === 'a1' ? 'a1' : 'a2'];
      if (!sa || !da || sa.x == null || da.x == null) return;
      var sp = eff(sa, r.srcSelId), dp = eff(da, r.dstSelId);
      if (!sp || !dp || isNaN(sp.x) || isNaN(dp.x)) return;
      function off(e, fb){ if (!e || String(e).trim() === '') return fb || 0; var v = formula(e, next, site, errs); return isNaN(v) ? (fb || 0) : v; }
      var ox = off(r.offsetXExpr, r.offsetX) + dp.x - sp.x, oy = off(r.offsetYExpr, r.offsetY) + dp.y - sp.y, oz = off(r.offsetZExpr, r.offsetZ) + dp.z - sp.z;
      var keys = r.srcPartKeys && r.srcPartKeys.length ? r.srcPartKeys : (function(){
        var s = (data.partsData.EDIT_SELECTIONS || []).filter(function(x){ return x.id === r.srcSelId; })[0];
        if (!s) return []; var K = KINDS.filter(function(x){ return x.k === s.varType; })[0]; var v = K && (data.partsData[K.vt] || {})[s.varKey]; return Object.keys(v && v.parts || {});
      })();
      var moved = false;
      keys.forEach(function(pk){
        var p = next[pk]; if (!p || p.parent || p.joint) return;
        next[pk] = Object.assign({}, p, { offX:r1((p.offX || 0) + ox), offY:r1((p.offY || 0) + oy), offZ:r1((p.offZ || 0) + oz) }); moved = true;
      });
      if (moved) { var g = gd(r.srcSelId); delta[r.srcSelId] = { dx:g.dx + ox, dy:g.dy + oy, dz:g.dz + oz }; }
    });
    return next;
  }

  // ── 干渉（箱の 重なり。つないだ 2 つは 見ない）──
  function interferences(parts, boxes, th){
    th = th == null ? 1 : th;
    var pairs = {}, list = [];
    Object.keys(parts).forEach(function(k){ var j = parts[k].joint; if (j && j.dstKey) pairs[[k, j.dstKey].sort().join('|')] = 1; });
    var ks = Object.keys(boxes);
    for (var i = 0; i < ks.length; i++) for (var j = i + 1; j < ks.length; j++) {
      var a = boxes[ks[i]], b = boxes[ks[j]];
      if (pairs[[ks[i], ks[j]].sort().join('|')]) continue;
      var ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0), oz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
      if (ox > th && oy > th && oz > th) list.push({ a:ks[i], b:ks[j], nameA:parts[ks[i]].name, nameB:parts[ks[j]].name, ox:Math.round(ox), oy:Math.round(oy), oz:Math.round(oz) });
    }
    return list;
  }

  // ── まとめて 計算 ──
  // st = { sel:{tower,fence,boshi,toba,crypt}, site:{W,D,domeH,domeT,adj}, over:{部材の鍵:{w,h,d}} }
  function compute(data, st){
    var errs = [], site = st.site;
    var p = gather(data, st.sel);
    p = applyDim(data.knowhow || [], p, site, data, st.sel, errs);
    // 形の ある 部材（buzai/1）を 入れた 石は、部材の 幅・奥行・高さ（params W・D・H）が 箱の 大きさ
    Object.keys(st.shapes || {}).forEach(function(k){ var sz = shapeSize(st.shapes[k]); if (p[k] && sz) { p[k] = Object.assign({}, p[k], sz, { shape:st.shapes[k] }); } });
    Object.keys(st.over || {}).forEach(function(k){ if (st.shapes && st.shapes[k]) return; if (p[k]) { p[k] = Object.assign({}, p[k]); ['w', 'h', 'd'].forEach(function(f){ if (st.over[k][f] > 0) p[k][f] = st.over[k][f]; }); } });
    p = applyPos(data.knowhow || [], p, data.anchors || {}, site, data, st.sel, errs);
    var boxes = {};
    Object.keys(p).forEach(function(k){
      var q = p[k]; if (q.visible === false) return;
      var o = pos(k, p); boxes[k] = { x0:o.ox, y0:o.oy, z0:o.oz, x1:o.ox + q.w, y1:o.oy + q.h, z1:o.oz + q.d };
    });
    return { parts:p, boxes:boxes, hits:interferences(p, boxes), errs:errs };
  }

  function pv(def, id){ var q = def && def.params && def.params[id]; if (!q) return NaN; return +(q.value != null ? q.value : q.default); }
  function shapeSize(def){ if (!def || def.schema !== 'buzai/1') return null; var w = pv(def, 'W'), d = pv(def, 'D'), h = pv(def, 'H'); return w > 0 && d > 0 && h > 0 ? { w:w, d:d, h:h } : null; }

  // ── 才数と 見積（単価が 無ければ 才数だけ）──
  // 部材の 分け方：石塔＝cg tower（納骨室は 入れない）、墓誌＝墓誌の 部材、外柵＝のこり（外柵・塔婆立など。納骨室は 入れない）
  function saiGroups(res){
    var g = { tower:[], fence:[], boshi:[], crypt:[] };
    Object.keys(res.boxes).forEach(function(k){
      var p = res.parts[k], row = { key:k, name:p.name, w:p.w, h:p.h, d:p.d, sai:sai(p.w, p.d, p.h) };
      if (p.kind === 'boshi') g.boshi.push(row);
      else if (p.kind === 'crypt' || p.cg === 'crypt') g.crypt.push(row);
      else if (p.cg === 'tower') g.tower.push(row);
      else g.fence.push(row);
    });
    function sum(a){ return a.reduce(function(s, r){ return s + r.sai; }, 0); }
    return { rows:g, tower:sum(g.tower), fence:sum(g.fence), boshi:sum(g.boshi), crypt:sum(g.crypt) };
  }
  function stoneU(s){ return s ? (s.overseas || 0) + (s.domestic || 0) : 0; }
  function estimate(res, st, tanka){
    var sg = saiGroups(res), out = { sai:sg, ok:!!(tanka && tanka.stones && tanka.estimate) };
    if (!out.ok) return out;
    var se = tanka.estimate, S = function(id){ return tanka.stones.filter(function(x){ return x.id === id; })[0] || tanka.stones[0]; };
    var tS = S(st.stone.tower), fS = S(st.stone.fence), bS = S(st.stone.boshi);
    var tU = stoneU(tS), t = {};
    t.stone = roundUp(sg.tower * tU * (1 + (se.stoneMargin || 0) / 100));
    t.kin = roundUp(((se.hanaRyu || 0) * (se.hanaCount || 0) + (se.kosakara || 0) + (se.kanki || 0)) * (1 + (se.kinkuMargin || 0) / 100));
    t.hakobi = roundUp(((se.hakobi_highway || 0) + (se.hakobi_mileage ? (se.hakobi_dist || 0) * (se.hakobi_fuel || 0) / se.hakobi_mileage : 0) + (se.hakobi_truck || 0) + (se.hakobi_labor || 0)) * (se.hakobi_count || 1));
    t.sekkei = roundUp((se.sekkei_h || 0) * (se.sekkei_unit || 0));
    t.suitsuke = (se.suitsuke_unit || 0) * (((se.suitsuke_by_type || {})[st.sel.tower] || {}).days || 1);
    t.subtotal = t.stone + t.kin + t.hakobi + t.sekkei + t.suitsuke;
    t.stU = tU;
    var f = null;
    if (st.sel.fence && st.sel.fence !== 'none') {
      f = {}; var fU = stoneU(fS);
      f.stone = roundUp(sg.fence * fU * (1 + (se.fence_stoneMargin || 0) / 100));
      f.kin = roundUp(((se.fence_tobakanamonoUnit || 0) * (se.fence_tobakanamonoCount || 0) + (se.fence_caulk || 0) * (se.fence_caulkCount || 0) + (se.fence_secchakuzai || 0) * (se.fence_secchakuCount || 0) + (se.fence_kuji || 0) * (se.fence_kujiCount || 0)) * (1 + (se.fence_kanamonoMargin || 0) / 100));
      f.suitsuke = (se.fence_suitsuke_unit || 0) * (se.fence_suitsuke_days || 0);
      var vol = (st.site.W * st.site.domeT * st.site.domeH * 2 + st.site.D * st.site.domeT * st.site.domeH * 2) / 1e9;
      f.zando = se.fence_zandobu_enabled ? roundUp(vol * (se.fence_zandobu_unit || 0)) : 0;
      f.subtotal = f.stone + f.kin + f.suitsuke + f.zando; f.stU = fU;
    }
    var b = null;
    if (sg.boshi > 0) { b = { stU:stoneU(bS) }; b.stone = roundUp(sg.boshi * b.stU * (1 + (se.stoneMargin || 0) / 100)); b.subtotal = b.stone; }
    out.tower = t; out.fence = f; out.boshi = b;
    out.total = t.subtotal + (f ? f.subtotal : 0) + (b ? b.subtotal : 0);
    return out;
  }

  // ── 保存の 形（kumitate/1）──
  function newState(data){
    var first = function(kind, pref){ var v = variants(data, kind); return v[pref] ? pref : Object.keys(v)[0]; };
    return { schema:'kumitate/1', name:'', sel:{ tower:first('tower', 'wa_8sun'), fence:first('fence', 'design1'), boshi:first('boshi', 'none'), toba:first('toba', 'none'), crypt:'' },
      site:{ W:1500, D:1800, domeH:300, domeT:150, adj:0 }, over:{}, shapes:{}, stone:{ tower:'', fence:'', boshi:'' } };
  }

  return { SHAKU:SHAKU, sai:sai, shapeSize:shapeSize, evalExpr:evalExpr, formula:formula, KINDS:KINDS, variants:variants, gather:gather, pos:pos,
    applyDim:applyDim, applyPos:applyPos, interferences:interferences, compute:compute, saiGroups:saiGroups, estimate:estimate, newState:newState };
})();
if (typeof module !== 'undefined') module.exports = KM;

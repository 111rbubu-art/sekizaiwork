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
      if (parts[ks[i]].setId && parts[ks[i]].setId === parts[ks[j]].setId) continue; // 同じ セットの 中は 図面どおり（切り欠きに 差し込む 所が ある）
      var ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0), oz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
      if (ox > th && oy > th && oz > th) list.push({ a:ks[i], b:ks[j], nameA:parts[ks[i]].name, nameB:parts[ks[j]].name, ox:Math.round(ox), oy:Math.round(oy), oz:Math.round(oz) });
    }
    return list;
  }

  // ── まとめて 計算 ──
  // st = { sel:{tower,fence,boshi,toba,crypt}, site:{W,D,domeH,domeT,adj}, over:{部材の鍵:{w,h,d}} }
  function compute(data, st){
    var errs = [], site = st.site, notes = [], ng = [];
    var p = gather(data, st.sel);
    stretchSets(data, st, p, notes);
    var ff = fitFence(data, st, p, ng);
    placeOnSet(data, st, p, ff);
    var chg = [], gaps = haisekiRule(data, st, p, chg, ng);
    p = applyDim(data.knowhow || [], p, site, data, st.sel, errs);
    // 形の ある 部材（buzai/1）を 入れた 石は、部材の 幅・奥行・高さ（params W・D・H）が 箱の 大きさ
    // セットの 部材は 前の 位置（幅の 中心・前の 面）を 覚えて おき、大きさが 変わっても そこに そろえる
    var base = {}; Object.keys(p).forEach(function(k){ if (p[k].setId) base[k] = { w:p[k].w, d:p[k].d, offX:p[k].offX || 0, offZ:p[k].offZ || 0 }; });
    // 手で 入れた 形（左の「形の ある 部材」）は、入れた ときと 同じ 石（セットか どうか まで 同じ）の ときだけ 使う。
    // 前に 和型 8 寸の 香炉へ 入れた 形が、同じ 鍵（koro）の セットの 香炉に 入り込まない ように
    Object.keys(st.shapes || {}).forEach(function(k){ var sh = st.shapes[k], sz = shapeSize(sh); if (!p[k] || !sz) return;
      if ((p[k].setId || '') !== (sh.__set || '')) return;
      p[k] = Object.assign({}, p[k], sz, { shape:sh }); });
    Object.keys(st.over || {}).forEach(function(k){ if (st.shapes && st.shapes[k] && (p[k] && p[k].shape === st.shapes[k])) return; if (p[k]) { p[k] = Object.assign({}, p[k]); ['w', 'h', 'd'].forEach(function(f){ if (st.over[k][f] > 0) p[k][f] = st.over[k][f]; }); } });
    Object.keys(base).forEach(function(k){ var b = base[k], q = p[k]; if (!q || (q.w === b.w && q.d === b.d)) return;
      p[k] = Object.assign({}, q, { offX:r1(b.offX + (b.w - q.w) / 2), offZ:r1(b.offZ + (b.d - q.d)) }); });
    syncShapes(p, st);
    p = applyPos(data.knowhow || [], p, data.anchors || {}, site, data, st.sel, errs);
    var boxes = {};
    Object.keys(p).forEach(function(k){
      var q = p[k]; if (q.visible === false) return;
      var o = pos(k, p); boxes[k] = { x0:o.ox, y0:o.oy, z0:o.oz, x1:o.ox + q.w, y1:o.oy + q.h, z1:o.oz + q.d };
    });
    return { parts:p, boxes:boxes, hits:interferences(p, boxes), errs:errs, notes:notes, ng:ng, fit:ff, gaps:gaps, chg:chg };
  }

  // ── セット（図面から 読んだ 石塔・外柵。buzai-set/1）──
  // セット＝部材の 一覧（大きさ・置き場所・形）＋ 伸び縮み。組み立てでは 石塔（外柵）の 1 つの 種類 として 並ぶ
  // 置き場所：セットの 原点（左・前・下）→ 組み立ての 座標（幅の 中心・奥行の 中心が 0、+z が 前）
  function setSelId(S){ return S.kind + '_set_' + S.id; }
  function setToVariant(S){
    var W = S.size.W, Dd = S.size.D, parts = {};
    S.parts.forEach(function(q){
      parts[q.key] = { name:q.name, no:String(q.no), grp:S.kind, w:q.w, h:q.h, d:q.d, visible:true, parent:null,
        offX:r1(q.at.x - W / 2), offY:q.at.y, offZ:r1(Dd / 2 - (q.at.z + q.d)), shape:q.part || null, finish:q.finish || '', setId:S.id, setAt:{ x:q.at.x, y:q.at.y || 0, z:q.at.z } };
    });
    return { label:S.name, colorGroup:S.kind === 'fence' ? 'fence' : 'tower', parts:parts, set:{ id:S.id, stretch:S.stretch || null, version:S.version || 0, size:S.size, place:S.place || null, fit:S.kind === 'fence' ? normFit(S) : null } };
  }
  // data に セットを 足した もの（元の data は 変えない）。位置の ルールは 基に した 種類（既定 和型 8 寸）の ものを 写す
  function addSets(data, sets){
    if (!sets || !sets.length) return data;
    var d = clone(data), pd = d.partsData;
    pd.EDIT_SELECTIONS = pd.EDIT_SELECTIONS || []; d.anchors = d.anchors || {}; d.knowhow = d.knowhow || [];
    sets.forEach(function(S){
      if (!S || S.schema !== 'buzai-set/1' || !S.parts || !S.size) return;
      var K = KINDS.filter(function(x){ return x.k === S.kind; })[0]; if (!K) return;
      pd[K.vt] = pd[K.vt] || {}; pd[K.vt][S.id] = setToVariant(S);
      var sid = setSelId(S), Dd = S.size.D;
      pd.EDIT_SELECTIONS = pd.EDIT_SELECTIONS.filter(function(x){ return x.id !== sid; });
      pd.EDIT_SELECTIONS.push({ id:sid, label:K.label + ' ー ' + S.name, varType:S.kind, varKey:S.id });
      d.anchors[sid] = { a1:{ name:'後ろ 中心', x:0, y:0, z:-Dd / 2 }, a2:{ name:'前 中心', x:0, y:0, z:Dd / 2 } };
      var base = S.baseSel || (S.kind === 'tower' ? 'tower_wa_8sun' : '');
      if (!base) return;
      d.knowhow.filter(function(r){ return r.type === 'pos_calc' && (r.srcSelId === base || r.dstSelId === base); }).forEach(function(r){
        var c = clone(r); c.id = (r.id || r.name) + '__' + sid;
        if (c.srcSelId === base) { c.srcSelId = sid; c.srcPartKeys = []; }
        if (c.dstSelId === base) c.dstSelId = sid;
        d.knowhow.push(c);
      });
    });
    return d;
  }
  // 奥行の 伸び縮み（敷地の「石塔 奥行調整」）：grow の 部材の 奥行を 伸ばし、follow_back は 後ろに そろえた まま、のこりは 前へ
  function stretchSets(data, st, p, notes){
    KINDS.forEach(function(K){
      var v = (data.partsData[K.vt] || {})[st.sel[K.k]], sd = v && v.set && v.set.stretch && v.set.stretch.depth;
      if (!sd) return;
      var adj = K.k === 'tower' ? +(st.site.adj || 0) : 0; if (!adj) return;
      var std = sd.std || 0, lo = sd.min != null ? sd.min : -Infinity, hi = sd.max != null ? sd.max : Infinity;
      if (std) { var to = Math.max(lo, Math.min(hi, std + adj)); if (to !== std + adj) notes.push(v.label + '：奥行は ' + lo + '〜' + hi + ' まで（' + (std + adj) + ' → ' + to + '）'); adj = to - std; }
      var grow = {}; (sd.grow || []).forEach(function(g){ var a = String(g).split('.'); grow[a[0]] = a[1] || 'd'; });
      var back = {}; (sd.follow_back || []).forEach(function(k){ back[k] = 1; });
      Object.keys(v.parts || {}).forEach(function(k){
        if (!p[k]) return; p[k] = Object.assign({}, p[k]);
        if (grow[k]) p[k][grow[k]] = r1(p[k][grow[k]] + adj);
        else if (!back[k]) p[k].offZ = r1((p[k].offZ || 0) + adj);
      });
    });
  }
  // 外柵の セットに 石塔の 置き場所（place.tower：外柵の 原点から 石塔の 後ろ 中心・底の 高さ）が あり、石塔も セットの ときは そこへ 動かす
  function placeOnSet(data, st, p, ff){
    var f = (data.partsData.FENCE_VARIANTS || {})[st.sel.fence], t = (data.partsData.TOWER_VARIANTS || {})[st.sel.tower];
    var pl = f && f.set && f.set.place && f.set.place.tower; if (!pl || !t || !t.set || !t.set.size) return;
    var g = ff || { W:f.set.size.W, D:f.set.size.D, dW:0, dD:0, dH:0 };
    var dx = r1(pl.x + g.dW / 2 - g.W / 2), dz = r1((g.D / 2 - (pl.z + g.dD)) + t.set.size.D / 2), dy = (pl.y || 0) + g.dH;
    Object.keys(t.parts || {}).forEach(function(k){ if (!p[k]) return;
      p[k] = Object.assign({}, p[k], { offX:r1((p[k].offX || 0) + dx), offY:r1((p[k].offY || 0) + dy), offZ:r1((p[k].offZ || 0) + dz) }); });
  }
  // ── 外柵の 中の 拝石（外柵の セット＋石塔の セット）──
  // 石塔の「拝石」は 外柵の「拝石台」の 上に のせ、後ろを 芝台の 前に つける（拝石の 上の 香炉も いっしょに）。
  // 拝石台は 芝台の 前まで 伸ばす（前の 端は そのまま。支えなので 隙間は 作らない）。
  // 拝石の 前と 中仕切の 後ろの 隙間（重なり）は お客様の 好みで 直し方が ちがう ので 自動では 決めない：
  //   st.haiseki = ''（直さない＝✕ アラーム）｜'haiseki'（拝石の 奥行を 伸ばす）｜'naka'（中仕切の 奥行を 伸ばす）
  // 座標：offZ＝奥の 面（+z が 前）。前の 面＝offZ＋d
  function haisekiRule(data, st, p, notes, ng){
    var f = (data.partsData.FENCE_VARIANTS || {})[st.sel.fence], t = (data.partsData.TOWER_VARIANTS || {})[st.sel.tower];
    if (!f || !f.set || !t || !t.set) return [];
    var tk = Object.keys(t.parts || {}).filter(function(k){ return p[k]; }), fk = Object.keys(f.parts || {}).filter(function(k){ return p[k]; });
    var hk = tk.filter(function(k){ return /^拝石(?!台)/.test(p[k].name || ''); })[0];
    var dai = fk.filter(function(k){ return /^拝石台/.test(p[k].name || ''); }), naka = fk.filter(function(k){ return /^中仕切/.test(p[k].name || ''); })[0];
    var shiba = tk.filter(function(k){ return /^芝台/.test(p[k].name || ''); });
    if (!hk || !dai.length || !shiba.length) return [];
    var front = Math.max.apply(null, shiba.map(function(k){ return (p[k].offZ || 0) + p[k].d; }));   // 芝台の 前の 面
    var out = [];
    // 拝石台：前の 端は そのまま、奥を 芝台の 前まで
    dai.forEach(function(k){ var q = p[k], fz = (q.offZ || 0) + q.d, nd = r1(fz - front);
      if (Math.abs(nd - q.d) > 0.5 && nd > 0) { notes.push(q.name + 'を 芝台の 前まで ' + (nd > q.d ? '伸ばす' : '縮める') + '（奥行 ' + q.d + ' → ' + nd + '）'); p[k] = Object.assign({}, q, { d:nd, offZ:r1(front) }); }
      else if (nd <= 0) ng.push(q.name + 'が 芝台の 下に 入る（' + r1(-nd) + ' mm）'); });
    var top = Math.max.apply(null, dai.map(function(k){ return (p[k].offY || 0) + p[k].h; }));
    // 拝石を 拝石台の 上へ。後ろを 芝台の 前に
    var h0 = p[hk], dy = r1(top - (h0.offY || 0)), dz = r1(front - (h0.offZ || 0));
    var on = tk.filter(function(k){ var q = p[k]; return k !== hk && Math.abs((q.offY || 0) - ((h0.offY || 0) + h0.h)) < 1 && (q.offZ || 0) >= (h0.offZ || 0) - 1 && (q.offZ || 0) + q.d <= (h0.offZ || 0) + h0.d + 1; });
    [hk].concat(on).forEach(function(k){ p[k] = Object.assign({}, p[k], { offY:r1((p[k].offY || 0) + dy), offZ:r1((p[k].offZ || 0) + dz) }); });
    // 拝石の 前 と 中仕切の 後ろ
    if (naka) {
      var H = p[hk], N = p[naka], g = r1((N.offZ || 0) - ((H.offZ || 0) + H.d));
      if (Math.abs(g) > 1) {
        var fix = st.haiseki || '';
        if (fix === 'haiseki' && H.d + g > 0) {
          p[hk] = Object.assign({}, H, { d:r1(H.d + g) });
          on.forEach(function(k){ p[k] = Object.assign({}, p[k], { offZ:r1((p[k].offZ || 0) + g / 2) }); });  // 香炉は 拝石の 真ん中の まま
          notes.push('拝石の 奥行 ' + H.d + ' → ' + r1(H.d + g) + '（中仕切まで）');
        } else if (fix === 'naka' && N.d + g > 0) {
          p[naka] = Object.assign({}, N, { d:r1(N.d + g), offZ:r1((N.offZ || 0) - g) });
          notes.push('中仕切の 奥行 ' + N.d + ' → ' + r1(N.d + g) + '（拝石まで）');
        } else ng.push('拝石と 中仕切の 間が ' + (g > 0 ? r1(g) + ' mm 空く' : r1(-g) + ' mm 重なる') + '（拝石を 伸ばす か 中仕切を 伸ばすか 選ぶ）');
        out.push({ id:'naka', gap:g, fix:fix, haiseki:H.d, naka:N.d });
      }
    }
    return out;
  }

  // ── 外柵の セットの 寸法の 範囲（fit）──
  // fit = { W:{auto,min,max,std}（間口）, D:{…}（奥行）, H:{…}（GL から 腰石の 高さ）,
  //         parts:{ 鍵:{ w,d,h（☑＝外柵に 合わせて 伸び縮み）, ax:'L'|'C'|'R'（横の 位置：左・中心・右に そろえる）, az:'F'|'C'|'B'（前・中心・奥）, min:{w,d,h}, max:{w,d,h} } } }
  // 書いて いない 所は 図面の 形から 決める：幅（奥行）が 外柵の 半分 以上の 部材が 伸びる、高さは GL に 置いた 腰石の 高さ（−40 まで）の 部材。
  // 横の 位置は 左の 端に つく＝左、右の 端に つく＝右、ほか（塔婆柱・カロート・拝石台）＝中心（左右の 間は 変わらない。塔婆柱は 金具の 長さ、カロートは 仕様で 決まる）。
  // 奥の 位置は 前に つく＝前、後ろに つく＝奥、ほかは 半分より 奥なら 奥
  function r100(v){ return Math.round(v / 100) * 100; }
  function r10(v){ return Math.round(v / 10) * 10; }
  function setH(S){ var h = 0; S.parts.forEach(function(q){ if (!(q.at.y > 0)) h = Math.max(h, q.h); }); return h || S.size.H || 0; }
  function normFit(S){
    var f = S.fit || {}, W = S.size.W, D = S.size.D, H = setH(S);
    function rg(o, std, lo, hi){ o = o || {}; return { auto:o.auto !== false, std:std, min:o.min != null ? o.min : lo, max:o.max != null ? o.max : hi }; }
    var out = { W:rg(f.W, W, r100(W - 300), r100(W + 600)), D:rg(f.D, D, r100(D - 200), r100(D + 700)), H:rg(f.H, H, r10(H - 80), r10(H + 120)), parts:{} };
    S.parts.forEach(function(q){
      var o = (f.parts || {})[q.key] || {};
      var ax = q.at.x <= 1 ? 'L' : q.at.x + q.w >= W - 1 ? 'R' : 'C', az = q.at.z <= 1 ? 'F' : q.at.z + q.d >= D - 1 ? 'B' : q.at.z + q.d / 2 > D / 2 ? 'B' : 'F';
      out.parts[q.key] = { w:o.w != null ? !!o.w : q.w >= W / 2, d:o.d != null ? !!o.d : q.d >= D / 2, h:o.h != null ? !!o.h : (!(q.at.y > 0) && q.h >= H - 40),
        ax:/^[LCR]$/.test(o.ax) ? o.ax : ax, az:/^[FCB]$/.test(o.az) ? o.az : az, min:clone(o.min || {}), max:clone(o.max || {}) };
    });
    return out;
  }
  // 伸びない 部材の 動き方：外柵が 広がった 分の いくつを 動くか（左・前＝0、中心＝½、右・奥＝1）。GL より 上に のる ものは 上へ
  function fitMove(fit, size, q, at){
    var fl = fit.parts[q] || {}, F = { L:0, C:0.5, R:1, F:0, B:1 };
    return { fx:fl.w ? 0 : F[fl.ax] || 0, fz:fl.d ? 0 : F[fl.az] || 0, y:!fl.h && at.y > 0 };
  }
  // いまの 外柵の 寸法（st.fit[セットの id] = {W,D,H}。無ければ 図面の まま）
  function fitCur(fs, st){ var F = fs.fit, c = st.fit && st.fit[fs.id] || {}; return { W:c.W > 0 ? c.W : F.W.std, D:c.D > 0 ? c.D : F.D.std, H:c.H > 0 ? c.H : F.H.std }; }
  function fitFence(data, st, p, ng){
    var v = (data.partsData.FENCE_VARIANTS || {})[st.sel.fence], fs = v && v.set; if (!fs || !fs.fit) return null;
    var F = fs.fit, c = fitCur(fs, st), dW = r1(c.W - F.W.std), dD = r1(c.D - F.D.std), dH = r1(c.H - F.H.std);
    var LB = { W:'間口', D:'奥行', H:'腰石の 高さ' }, FL = { w:'幅', d:'奥行', h:'高さ' };
    ['W', 'D', 'H'].forEach(function(k){ var R = F[k];
      if (c[k] < R.min) ng.push(v.label + '：' + LB[k] + ' ' + c[k] + ' は ' + R.min + ' から（' + r1(R.min - c[k]) + ' mm 足りない）');
      if (c[k] > R.max) ng.push(v.label + '：' + LB[k] + ' ' + c[k] + ' は ' + R.max + ' まで（' + r1(c[k] - R.max) + ' mm 長い）'); });
    var b0 = {}, b1 = {};   // セットの 座標（左・前・下）での 箱：図面の まま／いま
    Object.keys(v.parts || {}).forEach(function(k){
      var q = p[k], o = v.parts[k]; if (!q || !q.setAt) return;
      var fl = F.parts[k] || {}, a = q.setAt, x = a.x, y = a.y, z = a.z, w = q.w, d = q.d, h = q.h;
      b0[k] = { x0:a.x, x1:a.x + o.w, y0:a.y, y1:a.y + o.h, z0:a.z, z1:a.z + o.d };
      if (dW || dD || dH) {
        var mv = fitMove(F, fs.size, k, { x:a.x, y:a.y, z:a.z, w:q.w, d:q.d });
        if (fl.w) w += dW; else x += dW * mv.fx;
        if (fl.d) d += dD; else z += dD * mv.fz;
        if (fl.h) h += dH; else if (mv.y) y += dH;
        p[k] = Object.assign({}, q, { w:r1(w), d:r1(d), h:r1(h), offX:r1(x - c.W / 2), offY:r1(y), offZ:r1(c.D / 2 - (z + d)) });
      }
      b1[k] = { x0:x, x1:x + w, y0:y, y1:y + h, z0:z, z1:z + d };
    });
    // 外柵が 狭く なって 部材 どうしが 新しく ぶつかる（図面では ぶつからない）＝✕ と 何 mm（カロートと 腰石 など。位置を 調整する）
    var ks = Object.keys(b1);
    function ov(A, B){ return { x:Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0), y:Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0), z:Math.min(A.z1, B.z1) - Math.max(A.z0, B.z0) }; }
    if (dW || dD || dH) for (var i = 0; i < ks.length; i++) for (var j = i + 1; j < ks.length; j++) {
      var o1 = ov(b1[ks[i]], b1[ks[j]]); if (!(o1.x > 0.5 && o1.y > 0.5 && o1.z > 0.5)) continue;
      var o0 = ov(b0[ks[i]], b0[ks[j]]); if (o0.x > 0.5 && o0.y > 0.5 && o0.z > 0.5) continue;
      ng.push(p[ks[i]].name + ' と ' + p[ks[j]].name + ' が ぶつかる（' + (o1.x <= o1.z ? '横 ' + r1(o1.x) : '奥行 ' + r1(o1.z)) + ' mm。位置を 調整）');
    }
    Object.keys(v.parts || {}).forEach(function(k){ var q = p[k], fl = F.parts[k]; if (!q || !fl) return;
      ['w', 'd', 'h'].forEach(function(f){
        if (fl.max[f] != null && q[f] > fl.max[f]) ng.push(q.name + '：' + FL[f] + ' ' + q[f] + ' は ' + fl.max[f] + ' まで（' + r1(q[f] - fl.max[f]) + ' mm 長い）');
        if (fl.min[f] != null && q[f] < fl.min[f]) ng.push(q.name + '：' + FL[f] + ' ' + q[f] + ' は ' + fl.min[f] + ' から（' + r1(fl.min[f] - q[f]) + ' mm 足りない）');
      }); });
    return { id:fs.id, W:c.W, D:c.D, H:c.H, dW:dW, dD:dD, dH:dH };
  }

  // セットの 部材の 形（buzai/1）を 箱の 大きさに 合わせる（幅・奥行・高さ → params W・D・H）
  function syncShapes(p, st){
    Object.keys(p).forEach(function(k){
      var q = p[k], def = q.shape; if (!def || (st.shapes && st.shapes[k]) || !def.params) return;
      var cur = shapeSize(def); if (cur && cur.w === q.w && cur.d === q.d && cur.h === q.h) return;
      var nd = clone(def); [['W', 'w'], ['D', 'd'], ['H', 'h']].forEach(function(a){ if (nd.params[a[0]]) nd.params[a[0]].value = q[a[1]]; });
      p[k] = Object.assign({}, q, { shape:nd });
    });
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

  // ── 自動で 設計する（案を 並べる）──
  // 外柵 × 石塔 の 組を 1 つずつ 計算して、収まるか（✓ ok・⚠ adjust・✕ ng）と 何 mm かを 出す。石塔の 大きさは 勝手に 変えない
  //（奥行の 伸び縮みを 持つ セットだけ、外柵の 置き場所に 合わせて 奥行を 変える 案を 出す）
  // opts = { towers:[鍵…]（なければ 全部）, fences:[鍵…] }
  function footprint(res, cg){
    var b = null; Object.keys(res.boxes).forEach(function(k){ var p = res.parts[k], x = res.boxes[k]; if ((p.cg === 'tower') !== (cg === 'tower')) return;
      if (!b) b = { x0:x.x0, x1:x.x1, z0:x.z0, z1:x.z1 }; else { b.x0 = Math.min(b.x0, x.x0); b.x1 = Math.max(b.x1, x.x1); b.z0 = Math.min(b.z0, x.z0); b.z1 = Math.max(b.z1, x.z1); } });
    return b;
  }
  function autoDesign(data, st, opts){
    opts = opts || {};
    var TV = data.partsData.TOWER_VARIANTS || {}, FV = data.partsData.FENCE_VARIANTS || {};
    var towers = opts.towers || Object.keys(TV).filter(function(k){ return k !== 'none'; });
    var fences = opts.fences || Object.keys(FV).filter(function(k){ return k !== 'none'; });
    var out = [];
    towers.forEach(function(tk){ fences.forEach(function(fk){
      var t = TV[tk], f = FV[fk]; if (!f) return; t = t || { label:'石塔 なし', parts:{} };
      var fs = f.set, ts = t.set, pl = fs && fs.place && fs.place.tower;
      if (fs && TV[tk] && !ts) return; // 外柵の セットには セットの 石塔だけ 置ける（置き場所が 決まって いる ため）
      var s2 = clone(st); s2.sel.tower = tk; s2.sel.fence = fk; s2.site.adj = 0; s2.fit = clone(st.fit || {});
      var lv = 0, notes = [], changes = [], dD = 0;
      function say(l, m){ lv = Math.max(lv, l); notes.push({ lv:l, msg:m }); }
      // 外柵の セット：範囲（fit）の 中で 敷地に 合わせる。範囲を 越えたら ✕ と 何 mm
      if (fs && fs.size && fs.fit) {
        var F = fs.fit, c = fitCur(fs, st), LB = { W:'間口', D:'奥行', H:'腰石の 高さ' }, FL = { W:'w', D:'d', H:'h' };
        [['W', s2.site.W], ['D', s2.site.D]].forEach(function(a){
          var k = a[0], to = a[1], R = F[k];
          if (!R.auto) {
            var df = r1(to - c[k]);
            if (df < 0) say(2, '敷地が 足りない：' + LB[k] + ' ' + (-df) + ' mm（外柵の ' + LB[k] + 'は 自動で 変えない 設定）');
            else if (df > 0) say(1, '敷地が 余る：' + LB[k] + ' ' + df + ' mm（外柵の ' + LB[k] + 'は 自動で 変えない 設定）');
            return;
          }
          if (to < R.min) { say(2, '外柵の ' + LB[k] + 'は ' + R.min + ' から（敷地が ' + r1(R.min - to) + ' mm 足りない）→ 最小を 直すか、別の 外柵'); to = R.min; }
          else if (to > R.max) { say(2, '外柵の ' + LB[k] + 'は ' + R.max + ' まで（' + r1(to - R.max) + ' mm 足りない）→ 最大を 直すか、別の 外柵'); to = R.max; }
          c[k] = to;
        });
        ['W', 'D', 'H'].forEach(function(k){ var d = r1(c[k] - F[k].std); if (!d) return;
          var gn = Object.keys(F.parts).filter(function(pk){ return F.parts[pk][FL[k]] && f.parts[pk]; }).map(function(pk){ return f.parts[pk].name; });
          changes.push('外柵 ' + LB[k] + ' ' + F[k].std + ' → ' + c[k] + (gn.length ? '（' + gn.join('・') + ' ' + (d > 0 ? '+' : '') + d + '）' : '')); });
        s2.fit[fs.id] = c; dD = r1(c.D - F.D.std);
      } else if (fs && fs.size) {
        var dW = r1(s2.site.W - fs.size.W), dD0 = r1(s2.site.D - fs.size.D);
        if (dW < 0 || dD0 < 0) say(2, '敷地が 足りない：' + (dW < 0 ? '間口 ' + (-dW) + ' mm ' : '') + (dD0 < 0 ? '奥行 ' + (-dD0) + ' mm' : '') + '（外柵 ' + fs.size.W + '×' + fs.size.D + '）');
        else if (dW > 0 || dD0 > 0) say(1, '敷地が 余る：' + (dW > 0 ? '間口 ' + dW + ' mm ' : '') + (dD0 > 0 ? '奥行 ' + dD0 + ' mm' : '') + '（この 外柵は 伸びない）');
      }
      // 石塔の 奥行：外柵の 置き場所（後ろ z・前の 限り front）に 入るか。入らなければ 伸び縮みの ある セットだけ 縮める（伸ばしは しない）
      var sd = ts && ts.stretch && ts.stretch.depth;
      if (pl && ts && ts.size && pl.front != null) {
        // 前に ある 拝石（外柵では 拝石台の 上に のる）は 石塔の 奥行に 入れない
        var hz = ts.size.D, fp = Object.keys(t.parts || {}).filter(function(k){ return /^拝石(?!台)/.test(t.parts[k].name || ''); })[0];
        var hd = fp && fs.fit && Object.keys(f.parts || {}).some(function(k){ return /^拝石台/.test(f.parts[k].name || ''); }) ? t.parts[fp].d : 0;
        var avail = r1(pl.z + dD - pl.front + hd), std = sd && sd.std || hz;
        if (std > avail) {
          var lo = sd && sd.min != null ? sd.min : std;
          if (sd && avail >= lo) { s2.site.adj = r1(avail - std); var gn2 = (sd.grow || []).map(function(g){ var k = String(g).split('.')[0]; return t.parts[k] ? t.parts[k].name : k; });
            changes.push('石塔 奥行 ' + std + ' → ' + avail + '（' + gn2.join('・') + ' ' + r1(avail - std) + '）'); }
          else say(2, '石塔の 奥行が ' + r1(std - avail) + ' mm 長い（置ける 奥行 ' + avail + '）');
        } else if (std < avail) notes.push({ lv:0, msg:'石塔の 前に ' + r1(avail - std) + ' mm 空き' });
      }
      if (pl && ts && ts.size) {
        if (pl.w_max != null && ts.size.W > pl.w_max) say(2, '石塔の 幅が ' + r1(ts.size.W - pl.w_max) + ' mm 広い（' + pl.w_max + ' まで）');
        if (pl.w_min != null && ts.size.W < pl.w_min) say(2, '石塔の 幅が ' + r1(pl.w_min - ts.size.W) + ' mm 狭い（' + pl.w_min + ' から）');
      }
      var res = compute(data, s2), isT = function(k){ return res.parts[k].cg === 'tower'; };
      // 石塔と 外柵の 重なり＝収まらない（何 mm）。石塔 どうし・外柵 どうしの 重なりは 元の データの くせ（⚠）
      var cross = res.hits.filter(function(h){ return isT(h.a) !== isT(h.b); }), inner = res.hits.length - cross.length;
      if (cross.length) { var w = cross.slice().sort(function(x, y){ return Math.min(y.ox, y.oz) - Math.min(x.ox, x.oz); })[0];
        say(2, '石塔と 外柵が ' + cross.length + ' か所 重なる（いちばん 大きいのは ' + w.nameA + '↔' + w.nameB + '：' + (w.oz <= w.ox ? '奥行 ' + w.oz : '横 ' + w.ox) + ' mm）'); }
      if (inner) say(1, '元の データの 中で 重なる 所が ' + inner + ' か所（部材の 置き方を 見直す 必要）');
      (res.notes || []).forEach(function(m){ say(1, m); });
      (res.ng || []).forEach(function(m){ say(2, m); });
      (res.chg || []).forEach(function(m){ changes.push(m); });
      // 石塔が 外柵の 外へ はみ出すか（何 mm）
      var ft = footprint(res, 'tower'), ff = footprint(res, 'fence');
      if (ft && ff) { var ov = Math.max(ff.x0 - ft.x0, ft.x1 - ff.x1, ff.z0 - ft.z0, ft.z1 - ff.z1);
        if (ov > 0.5) say(2, '石塔が 外柵の 外へ ' + r1(ov) + ' mm はみ出す'); }
      var sg = saiGroups(res);
      out.push({ tower:tk, fence:fk, label:(f.label || fk) + ' ＋ ' + (t.label || tk || '石塔 なし'), lv:lv, notes:notes, changes:changes, fit:fs && fs.fit ? s2.fit[fs.id] : null, fenceId:fs && fs.fit ? fs.id : '', adj:s2.site.adj || 0, sai:sg.tower + sg.fence, hits:res.hits.length, cur:tk === st.sel.tower && fk === st.sel.fence });
    }); });
    out.sort(function(a, b){ return a.lv - b.lv || (b.cur ? 1 : 0) - (a.cur ? 1 : 0) || a.sai - b.sai; });
    return out;
  }

  // ── 保存の 形（kumitate/1）──
  function newState(data){
    var first = function(kind, pref){ var v = variants(data, kind); return v[pref] ? pref : Object.keys(v)[0]; };
    return { schema:'kumitate/1', name:'', sel:{ tower:first('tower', 'wa_8sun'), fence:first('fence', 'design1'), boshi:first('boshi', 'none'), toba:first('toba', 'none'), crypt:'' },
      site:{ W:1500, D:1800, domeH:300, domeT:150, adj:0 }, over:{}, shapes:{}, stone:{ tower:'', fence:'', boshi:'' } };
  }

  return { SHAKU:SHAKU, sai:sai, shapeSize:shapeSize, evalExpr:evalExpr, formula:formula, KINDS:KINDS, variants:variants, gather:gather, pos:pos,
    applyDim:applyDim, applyPos:applyPos, addSets:addSets, normFit:normFit, fitMove:fitMove, fitCur:fitCur, setSelId:setSelId, setToVariant:setToVariant, interferences:interferences, compute:compute, autoDesign:autoDesign, saiGroups:saiGroups, estimate:estimate, newState:newState };
})();
if (typeof module !== 'undefined') module.exports = KM;

// 部材の エンジン（BZ）と 見本の 部材（BZ_KORO）。Three.js を 使わない。
// 石の 図面（zumen.html）の 部材設計と 組み立て（kumitate.html）で 同じ ものを 使う
var BZ = (function(){
  // ── 式（日本語）。全角の ＋－×÷（）も 書ける。new Function は 使わない ──
  var FW = { '＋':'+', '－':'-', '−':'-', '×':'*', '＊':'*', '÷':'/', '／':'/', '（':'(', '）':')', '，':',', '、':',', '＜':'<', '＞':'>', '＝':'=', '！':'!', '．':'.', '　':' ', '≦':'<=', '≧':'>=', '≠':'!=' };
  function norm(s){ return String(s).replace(/[＋－−×＊÷／（），、＜＞＝！．　≦≧≠]/g, function(c){ return FW[c]; }).replace(/[０-９]/g, function(c){ return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }); }
  var FN = {
    'もし':function(a){ if (a.length !== 3) throw new Error('もし（条件, 合うとき, 合わないとき）の 形で 書いて ください'); return a[0] ? a[1] : a[2]; },
    '最大':function(a){ return Math.max.apply(null, a); }, '最小':function(a){ return Math.min.apply(null, a); },
    '絶対値':function(a){ return Math.abs(a[0]); }, '四捨五入':function(a){ return Math.round(a[0]); },
    '切上':function(a){ return Math.ceil(a[0]); }, '切捨':function(a){ return Math.floor(a[0]); }, 'ルート':function(a){ return Math.sqrt(a[0]); }
  };
  FN['if'] = FN['もし']; FN['max'] = FN['最大']; FN['min'] = FN['最小']; FN['abs'] = FN['絶対値']; FN['round'] = FN['四捨五入']; FN['ceil'] = FN['切上']; FN['floor'] = FN['切捨']; FN['sqrt'] = FN['ルート'];
  function tokens(src){
    var s = norm(src), out = [], i = 0, m;
    while (i < s.length) {
      var ch = s[i], rest = s.slice(i);
      if (/\s/.test(ch)) { i++; continue; }
      if ((m = /^(?:\d+\.?\d*|\.\d+)/.exec(rest))) { out.push({ t:'n', v:parseFloat(m[0]) }); i += m[0].length; continue; }
      if ((m = /^(?:<=|>=|==|!=)/.exec(rest))) { out.push({ t:'o', v:m[0] }); i += 2; continue; }
      if ('+-*/(),<>=!'.indexOf(ch) >= 0) { out.push({ t:'o', v:ch }); i++; continue; }
      if (ch === '"' || ch === '「') { var end = s.indexOf(ch === '"' ? '"' : '」', i + 1); if (end < 0) throw new Error('「"」が 閉じて いません'); out.push({ t:'s', v:s.slice(i + 1, end) }); i = end + 1; continue; }
      if ((m = /^[^\s+\-*\/(),<>=!"「」]+/.exec(rest))) { out.push({ t:'id', v:m[0] }); i += m[0].length; continue; }
      throw new Error('読めない 文字「' + ch + '」');
    }
    return out;
  }
  // look(名前) → 数 か 文字。知らない 名前は look が エラーに する
  function evalExpr(src, look){
    var tk = tokens(src), p = 0;
    if (!tk.length) throw new Error('式が 空です');
    function peek(v){ return tk[p] && tk[p].t === 'o' && tk[p].v === v; }
    function need(v){ if (!peek(v)) throw new Error('「' + v + '」が 足りません'); p++; }
    function cmp(){ var a = add(); while (tk[p] && tk[p].t === 'o' && ['<', '>', '<=', '>=', '=', '==', '!='].indexOf(tk[p].v) >= 0) { var o = tk[p++].v, b = add();
        a = o === '<' ? +(a < b) : o === '>' ? +(a > b) : o === '<=' ? +(a <= b) : o === '>=' ? +(a >= b) : o === '!=' ? +(a !== b) : +(a === b); } return a; }
    function add(){ var a = mul(); while (peek('+') || peek('-')) { var o = tk[p++].v, b = mul(); a = o === '+' ? num(a) + num(b) : num(a) - num(b); } return a; }
    function mul(){ var a = una(); while (peek('*') || peek('/')) { var o = tk[p++].v, b = una(); if (o === '/' && num(b) === 0) throw new Error('0 で 割って います'); a = o === '*' ? num(a) * num(b) : num(a) / num(b); } return a; }
    function una(){ if (peek('-')) { p++; return -num(una()); } if (peek('+')) { p++; return num(una()); } if (peek('!')) { p++; return +!una(); } return prim(); }
    function prim(){
      var t = tk[p];
      if (!t) throw new Error('式が 途中で 終わって います');
      if (t.t === 'n' || t.t === 's') { p++; return t.v; }
      if (peek('(')) { p++; var v = cmp(); need(')'); return v; }
      if (t.t === 'id') {
        p++;
        if (peek('(')) { var f = FN[t.v]; if (!f) throw new Error('「' + t.v + '」という 関数は ありません'); p++; var args = [];
          if (!peek(')')) { args.push(cmp()); while (peek(',')) { p++; args.push(cmp()); } } need(')'); return f(args.map(function(x){ return typeof x === 'string' ? x : num(x); })); }
        return look(t.v);
      }
      throw new Error('「' + t.v + '」の ところが 読めません');
    }
    function num(x){ if (typeof x === 'string') throw new Error('文字「' + x + '」は 計算に 使えません'); return x; }
    var r = cmp();
    if (p < tk.length) throw new Error('「' + tk[p].v + '」から 先が 読めません');
    return r;
  }

  // ── 寸法を 解く（比率・固定・式。順番は 自動。ぐるぐるは エラー）──
  function nameMap(def){ var m = {}; [def.params, def.dims].forEach(function(o){ Object.keys(o).forEach(function(k){ m[k] = k; if (o[k].name) m[o[k].name] = k; }); }); return m; }
  function itemOf(def, id){ return def.params[id] || def.dims[id]; }
  function nameOf(def, id){ var it = itemOf(def, id); return it && it.name || id; }
  function solve(def){
    var val = {}, err = {}, busy = {}, nm = nameMap(def);
    function look(n){ var id = nm[n]; if (!id) throw new Error('「' + n + '」という 寸法は ありません'); var v = get(id); if (typeof v === 'number' && isNaN(v)) throw new Error('「' + n + '」が 計算 できて いません'); return v; }
    function get(id){
      if (id in val) return val[id];
      if (busy[id]) throw new Error('「' + nameOf(def, id) + '」の 式が ぐるぐる 自分を 使って います');
      busy[id] = true; var v;
      try {
        var it = itemOf(def, id);
        if (def.params[id]) v = it.type === 'choice' || it.type === 'bool' ? (it.value != null ? it.value : it.default) : +(it.value != null ? it.value : it.default);
        else if (it.rule === 'ratio') { var of = get(it.of); v = of * it.value / it.base; }
        else if (it.rule === 'fixed') v = +it.value;
        else v = evalExpr(it.expr, look);
        if (typeof v === 'number') {
          if (it.min != null && v < it.min) v = it.min;
          if (it.max != null && v > it.max) v = it.max;
          if (!isFinite(v)) throw new Error('計算 できません');
        }
      } catch (e) { err[id] = e.message; v = NaN; }
      busy[id] = false; val[id] = v; return v;
    }
    Object.keys(def.params).concat(Object.keys(def.dims)).forEach(get);
    return { val:val, err:err, ev:function(x){ if (typeof x === 'number') return x; if (x == null || x === '') return 0; return evalExpr(x, look); }, look:look };
  }

  // ── 形の パターン ──
  function inset(y, s, b){ // 樽型の 絞り（y＝胴の 下から）。b＝{nb,b,nt}
    if (s <= 0) return 0;
    var mid = b.nb + b.b + b.nt;
    if (y <= b.nb) return b.nb > 0 ? s * y / b.nb : s;
    if (y >= b.nb + b.b) return b.nt > 0 ? s * (mid - y) / b.nt : s;
    var h = b.b / 2, R = (h * h + s * s) / (2 * s), t = y - b.nb - h;
    return s - (Math.sqrt(Math.max(0, R * R - t * t)) - (R - s));
  }
  function barrelYs(b, n){ var ys = [0, b.nb]; for (var i = 1; i < n; i++) ys.push(b.nb + b.b * i / n); ys.push(b.nb + b.b, b.nb + b.b + b.nt); return ys; }
  function barrelOutline(s, n){
    var r = barrelYs(s, n || 60).map(function(y){ return [s.w / 2 - inset(y, s.side, s), y]; }), pts = r.slice();
    for (var i = r.length - 1; i >= 0; i--) pts.push([-r[i][0], r[i][1]]);
    return pts;
  }
  function holePts(c, n){ // Φ の 円を 3 つ ずらした 雲形（c＝{phi,pitch,cy}）
    n = n || 40; var r = c.phi / 2, p = c.pitch, cy = c.cy, pts = [];
    if (p < 1e-6) { for (var i = 0; i < n * 3; i++) { var a = 2 * Math.PI * i / (n * 3); pts.push([r * Math.cos(a), cy + r * Math.sin(a)]); } return pts; }
    var yi = Math.sqrt(Math.max(0, r * r - (p / 2) * (p / 2))), t1 = Math.atan2(yi, p / 2);
    function arc(cx, a0, a1){ for (var i = 0; i < n; i++) { var a = a0 + (a1 - a0) * i / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } }
    arc(p, t1 - Math.PI, Math.PI - t1); arc(0, t1, Math.PI - t1); arc(-p, t1, 2 * Math.PI - t1); arc(0, Math.PI + t1, 2 * Math.PI - t1);
    return pts;
  }
  function holeArcs(c){ // 図面用：円弧の まま
    var r = c.phi / 2, p = c.pitch, cy = c.cy;
    if (p < 1e-6) return [{ k:'circle', c:[0, cy], r:r }];
    var yi = Math.sqrt(Math.max(0, r * r - (p / 2) * (p / 2))), t1 = Math.atan2(yi, p / 2), PI_ = Math.PI;
    return [{ k:'arc', c:[p, cy], r:r, a0:t1 - PI_, a1:PI_ - t1 }, { k:'arc', c:[0, cy], r:r, a0:t1, a1:PI_ - t1 }, { k:'arc', c:[-p, cy], r:r, a0:t1, a1:2 * PI_ - t1 }, { k:'arc', c:[0, cy], r:r, a0:PI_ + t1, a1:2 * PI_ - t1 }];
  }
  var PROFILES = {
    // 筆返し（立上り＋巻き。2 次＋3 次の ベジェ。元の 図面からの 近似）
    fudegaeshi:function(s, W, sign){
      var w = s.w, h = s.h, pts = [[0, 0], [0, h], [0.07 * w, h]], i, t, u;
      for (i = 1; i <= 16; i++) { t = i / 16; u = 1 - t; pts.push([u * u * 0.07 * w + 2 * u * t * 0.12 * w + t * t * 0.5 * w, u * u * h + 2 * u * t * 0.5 * h + t * t * 0.5 * h]); }
      for (i = 1; i <= 16; i++) { t = i / 16; u = 1 - t; pts.push([u * u * u * 0.5 * w + 3 * u * u * t * 0.8 * w + 3 * u * t * t * w + t * t * t * w, u * u * u * 0.5 * h + 3 * u * u * t * 0.5 * h + 3 * u * t * t * 0.35 * h]); }
      return pts.map(function(q){ return [sign < 0 ? -W / 2 + q[0] : W / 2 - q[0], q[1]]; });
    }
  };
  function profilePts(name, s, W, sign){ var f = PROFILES[name]; if (!f) throw new Error('断面「' + name + '」は まだ ありません'); return f(s, W, sign); }

  // 図から 作った 部材の 外形を 今の 幅・奥行・高さに 合わせて 伸び縮み（base＝作った ときの 大きさ）
  function scaleViews(v, W, Dd, H){
    var b = v.base || { W:W, D:Dd, H:H }, kx = W / b.W, kd = Dd / b.D, ky = H / b.H;
    function m(pts, fx, fy){ return pts.map(function(q){ return [q[0] * fx, q[1] * fy]; }); }
    var o = { front:{ out:m(v.front.out, kx, ky), holes:(v.front.holes || []).map(function(h){ return { pts:m(h.pts, kx, ky), depth:h.depth * kd, from:h.from }; }) } };
    if (v.side && v.side.out) o.side = { out:m(v.side.out, kd, ky),
      holes:(v.side.holes || []).map(function(h){ return { pts:m(h.pts, kd, ky), depth:h.depth * kx, from:h.from }; }),
      cuts:(v.side.cuts || []).map(function(h){ return { pts:m(h.pts, kd, ky), x0:h.x0 * kx, x1:h.x1 * kx, taper:h.taper ? h.taper * kx : 0, apex:h.apex }; }) };
    if (v.top && v.top.out) o.top = { out:m(v.top.out, kx, kd), holes:(v.top.holes || []).map(function(h){ return { pts:m(h.pts, kx, kd), depth:h.depth * ky }; }),
      cuts:(v.top.cuts || []).map(function(h){ return { pts:m(h.pts, kx, kd), y0:h.y0 * ky, y1:h.y1 * ky }; }) };
    return o;
  }
  // 部品の 式を 数に（model）
  function model(def, sv){
    var p = def.params, W = sv.val.W, Dd = sv.val.D, H = sv.val.H, comps = [];
    (def.components || []).forEach(function(c){
      var s = {}, at = {}, sh = c.shape || {};
      Object.keys(sh).forEach(function(k){ if (k !== 'type' && k !== 'profile' && k !== 'views') s[k] = sv.ev(sh[k]); });
      at.y = sv.ev((c.at || {}).y || 0); at.front = sv.ev((c.at || {}).front || 0);
      var cuts = (c.cuts || []).map(function(ct){ var cs = {}; Object.keys(ct).forEach(function(k){ if (k !== 'type' && k !== 'finish') cs[k] = sv.ev(ct[k]); }); return { type:ct.type, s:cs }; });
      comps.push({ id:c.id, name:c.name, type:sh.type, profile:sh.profile, s:s, at:at, cuts:cuts, mirror:c.mirror, views:sh.views ? scaleViews(sh.views, W, Dd, H) : null });
    });
    return { W:W, D:Dd, H:H, comps:comps, BZ:BZ };
  }
  // 正面図・側面図の 線（k：line・arc・circle・pl。hid＝隠れ線）。x＝右（側面図は 前面から 奥へ）、y＝上
  // 6 面（第三角法）：front 正面・side 右側面（左が 前）・top 平面（下が 前）・back 背面・left 左側面・bottom 下面
  function mirX(q){ var o = JSON.parse(JSON.stringify(q)); function f(p){ return [-p[0], p[1]]; }
    if (o.k === 'line') { o.a = f(q.a); o.b = f(q.b); } else if (o.k === 'pl') o.v = q.v.map(f); else { o.c = f(q.c); if (o.k === 'arc') { o.a0 = Math.PI - q.a1; o.a1 = Math.PI - q.a0; } } return o; }
  function mirY(q){ var o = JSON.parse(JSON.stringify(q)); function f(p){ return [p[0], -p[1]]; }
    if (o.k === 'line') { o.a = f(q.a); o.b = f(q.b); } else if (o.k === 'pl') o.v = q.v.map(f); else { o.c = f(q.c); if (o.k === 'arc') { o.a0 = -q.a1; o.a1 = -q.a0; } } return o; }
  function view6(m, v){
    if (v === 'front' || v === 'side') return view(m, v);
    if (v === 'back') return view(m, 'front').map(function(q){ var o = mirX(q); if (q.hole) o.hid = true; return o; });
    if (v === 'left') return view(m, 'side').map(mirX);
    var t = topView(m);
    if (v === 'top') return t;
    return t.map(function(q){ var o = mirY(q); if (q.topHole) o.hid = true; return o; }); // bottom
  }
  // 平面図（上から。y＝前から 奥へ）。上の 部品に 隠れる 部品は 点線
  function topView(m){
    var list = [], out = [];
    function rect(x0, y0, x1, y1){ return { k:'pl', v:[[x0, y0], [x1, y0], [x1, y1], [x0, y1]], closed:true }; }
    m.comps.forEach(function(c){
      var s = c.s, f0 = c.at.front || 0, top = c.at.y, prims = [], extra = [], fp;
      if (c.type === 'box') { fp = [-s.w / 2, f0, s.w / 2, f0 + s.d]; top += s.h; }
      else if (c.type === 'profile') {
        (c.mirror === 'x' ? [-1, 1] : [1]).forEach(function(sg){ var pp = profilePts(c.profile, s, m.W, sg), x0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          pp.forEach(function(q){ x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); });
          list.push({ top:c.at.y + y1, fp:[x0, f0, x1, f0 + s.len], extra:[] }); });
        return;
      }
      else if (c.type === 'barrel') { fp = [-s.w / 2, f0, s.w / 2, f0 + s.d]; top += s.nb + s.b + s.nt;
        c.cuts.forEach(function(ct){ if (ct.type !== 'cloudHole') return; var hw = ct.s.pitch > 1e-6 ? ct.s.pitch + ct.s.phi / 2 : ct.s.phi / 2;
          var q = rect(-hw, f0, hw, f0 + s.d - s.back); q.hid = true; extra.push(q); }); }
      else if (c.type === 'views') { var vv = c.views; top += m.H;
        if (vv.top && vv.top.out) { out.push({ k:'pl', v:vv.top.out, closed:true }); (vv.top.holes || []).forEach(function(h){ out.push({ k:'pl', v:h.pts, closed:true, topHole:true }); }); }
        else out.push(rect(-m.W / 2, 0, m.W / 2, m.D));
        (vv.front.holes || []).forEach(function(h){ var x0 = Infinity, x1 = -Infinity; h.pts.forEach(function(q){ x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); }); var q = rect(x0, 0, x1, h.depth); q.hid = true; out.push(q); });
        return; }
      else return;
      list.push({ top:top, fp:fp, extra:extra });
    });
    list.sort(function(a, b){ return b.top - a.top; });
    var cover = [];
    list.forEach(function(it){
      var f = it.fp, hid = cover.some(function(cv){ return f[0] >= cv[0] - 1e-6 && f[1] >= cv[1] - 1e-6 && f[2] <= cv[2] + 1e-6 && f[3] <= cv[3] + 1e-6; });
      var q = rect(f[0], f[1], f[2], f[3]); if (hid) q.hid = true; out.push(q);
      it.extra.forEach(function(e){ out.push(e); });
      cover.push(f);
    });
    out.sort(function(a, b){ return (b.hid ? 1 : 0) - (a.hid ? 1 : 0); }); // 点線を 先に（上に 実線）
    return out;
  }
  function view(m, v){
    var out = [];
    function L(a, b, hid){ out.push({ k:'line', a:a, b:b, hid:!!hid }); }
    function rect(x0, y0, x1, y1){ out.push({ k:'pl', v:[[x0, y0], [x1, y0], [x1, y1], [x0, y1]], closed:true }); }
    // 側面図：外の 端に そろった 部品（筆返し）が 幅いっぱいの 箱（天板）の 上に 乗る 所は 同じ 面 なので 境の 線を 出さない
    var E = 1e-6, onTop = [], fullBox = [];
    if (v !== 'front') m.comps.forEach(function(c){ if (c.type === 'profile') onTop.push({ y:c.at.y, x0:c.at.front, x1:c.at.front + c.s.len }); if (c.type === 'box' && c.s.w >= m.W - E) fullBox.push({ y:c.at.y + c.s.h, x0:c.at.front, x1:c.at.front + c.s.d }); });
    function hLine(x0, x1, y, cut){ // y の 横線から cut の 範囲を 抜く
      var segs = [[x0, x1]]; cut.forEach(function(r){ if (Math.abs(r.y - y) > E) return; var n = []; segs.forEach(function(g){ if (r.x1 <= g[0] + E || r.x0 >= g[1] - E) { n.push(g); return; } if (r.x0 > g[0] + E) n.push([g[0], r.x0]); if (r.x1 < g[1] - E) n.push([r.x1, g[1]]); }); segs = n; });
      segs.forEach(function(g){ if (g[1] - g[0] > E) L([g[0], y], [g[1], y]); });
    }
    m.comps.forEach(function(c){
      var s = c.s, y0 = c.at.y, f0 = c.at.front;
      if (c.type === 'views') { // 図から 作った 部材：描いた 外形を そのまま
        var vv = c.views, pl = function(pts){ out.push({ k:'pl', v:pts.map(function(q){ return [q[0], q[1] + y0]; }), closed:true }); };
        if (v === 'front') { pl(vv.front.out); (vv.front.holes || []).forEach(function(h){ pl(h.pts); out[out.length - 1].hole = true; }); }
        else if (vv.side && vv.side.out) pl(vv.side.out); else rect(0, y0, m.D, y0 + m.H);
        return;
      }
      if (c.type === 'box') { if (v === 'front') rect(-s.w / 2, y0, s.w / 2, y0 + s.h);
        else if (s.w >= m.W - E) { L([f0, y0], [f0 + s.d, y0]); L([f0, y0], [f0, y0 + s.h]); L([f0 + s.d, y0], [f0 + s.d, y0 + s.h]); hLine(f0, f0 + s.d, y0 + s.h, onTop); }
        else rect(f0, y0, f0 + s.d, y0 + s.h); }
      else if (c.type === 'profile') {
        if (v === 'front') (c.mirror === 'x' ? [-1, 1] : [1]).forEach(function(sg){ out.push({ k:'pl', v:profilePts(c.profile, s, m.W, sg).map(function(q){ return [q[0], q[1] + y0]; }), closed:true }); });
        else { L([f0, y0], [f0, y0 + s.h]); L([f0 + s.len, y0], [f0 + s.len, y0 + s.h]); L([f0, y0 + s.h], [f0 + s.len, y0 + s.h]); hLine(f0, f0 + s.len, y0, fullBox); }
      }
      else if (c.type === 'barrel') {
        var top = s.nb + s.b + s.nt, h = s.b / 2, cyb = y0 + s.nb + h;
        var side = function(edge, sIn, dir){ // dir：+1＝右へ ふくらむ（正面の 右・左は −1）
          var xn = edge - dir * sIn, list = [];
          if (s.nb > 0) list.push({ k:'line', a:[edge, y0], b:[xn, y0 + s.nb] });
          if (sIn > 1e-6) { var R = (h * h + sIn * sIn) / (2 * sIn), th = Math.asin(Math.min(1, h / R)), cx = edge - dir * R;
            list.push(dir > 0 ? { k:'arc', c:[cx, cyb], r:R, a0:-th, a1:th } : { k:'arc', c:[cx, cyb], r:R, a0:Math.PI - th, a1:Math.PI + th }); }
          else list.push({ k:'line', a:[edge, y0 + s.nb], b:[edge, y0 + s.nb + s.b] });
          if (s.nt > 0) list.push({ k:'line', a:[xn, y0 + s.nb + s.b], b:[edge, y0 + top] });
          return list;
        };
        if (v === 'front') {
          out.push.apply(out, side(s.w / 2, s.side, 1)); out.push.apply(out, side(-s.w / 2, s.side, -1));
          // 首と 胴の 境（首の 斜めの 面と 胴の 曲面が 折れて いる 線）
          if (s.side > E || s.front > E) { var xi = s.w / 2 - s.side; if (s.nb > 0) L([-xi, y0 + s.nb], [xi, y0 + s.nb]); if (s.nt > 0) L([-xi, y0 + s.nb + s.b], [xi, y0 + s.nb + s.b]); }
          c.cuts.forEach(function(ct){ if (ct.type === 'cloudHole') holeArcs({ phi:ct.s.phi, pitch:ct.s.pitch, cy:y0 + ct.s.cy }).forEach(function(a){ a.hole = true; out.push(a); }); });
        } else {
          out.push.apply(out, side(f0, s.front, -1));
          L([f0 + s.d, y0], [f0 + s.d, y0 + top]);
          if (s.side > E || s.front > E) { var xa = f0 + s.front; if (s.nb > 0) L([xa, y0 + s.nb], [f0 + s.d, y0 + s.nb]); if (s.nt > 0) L([xa, y0 + s.nb + s.b], [f0 + s.d, y0 + s.nb + s.b]); }
          c.cuts.forEach(function(ct){ if (ct.type !== 'cloudHole') return;
            var ya = y0 + ct.s.cy + ct.s.phi / 2, yb = y0 + ct.s.cy - ct.s.phi / 2, xb = f0 + s.d - s.back;
            var xf = function(y){ return f0 + inset(y - y0, s.front, s); };
            L([xf(ya), ya], [xb, ya], true); L([xb, ya], [xb, yb], true); L([xb, yb], [xf(yb), yb], true); });
        }
      }
    });
    return out;
  }
  function arcPts(c, r, a0, a1, n){ var o = []; n = n || 24; for (var i = 0; i <= n; i++) { var a = a0 + (a1 - a0) * i / n; o.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); } return o; }
  function primPts(q){ return q.k === 'line' ? [q.a, q.b] : q.k === 'pl' ? q.v : q.k === 'circle' ? arcPts(q.c, q.r, 0, 2 * Math.PI) : arcPts(q.c, q.r, q.a0, q.a1); }
  function bbox(prims){ var b = { x0:Infinity, y0:Infinity, x1:-Infinity, y1:-Infinity }; prims.forEach(function(q){ primPts(q).forEach(function(p){ if (p[0] < b.x0) b.x0 = p[0]; if (p[0] > b.x1) b.x1 = p[0]; if (p[1] < b.y0) b.y0 = p[1]; if (p[1] > b.y1) b.y1 = p[1]; }); }); return b; }
  // 図の 寸法（drawing.dims の 並び → 1 本ずつ）。id が ある ものは 押して 直せる
  function viewDims(def, sv, m, v, bb){
    var g = Math.max(m.W, m.H, m.D) * 0.1, out = [];
    (def.drawing && def.drawing.dims || []).forEach(function(c, ci){
      if (c.view !== v) return;
      var lv = c.lv || 1, pos = c.pos, dir = c.dir, line, ref;
      if (dir === 'v') { if (pos === 'left') { line = bb.x0 - g * lv; ref = bb.x0; } else if (pos === 'right') { line = bb.x1 + g * lv; ref = bb.x1; } else { line = ref = sv.ev(pos.x); } }
      else { if (pos === 'top') { line = bb.y1 + g * lv; ref = bb.y1; } else if (pos === 'bottom') { line = bb.y0 - g * lv; ref = bb.y0; } else { line = ref = sv.ev(pos.y); } }
      var cur = c.from != null ? sv.ev(c.from) : (dir === 'v' ? bb.y0 : bb.x0);
      c.chain.forEach(function(it, k){
        var id = typeof it === 'string' ? it : it.id || null, L = typeof it === 'string' ? sv.val[it] : it.show ? sv.ev(it.show) : it.expr ? sv.ev(it.expr) : sv.val[it.id];
        var a = dir === 'v' ? [ref, cur] : [cur, ref], b = dir === 'v' ? [ref, cur + L] : [cur + L, ref];
        var off = dir === 'v' ? [line, cur + L / 2] : [cur + L / 2, line];
        var outw = dir === 'v' ? (pos === 'right' ? [1, 0] : [-1, 0]) : (pos === 'top' ? [0, 1] : [0, -1]);
        out.push({ id:id, a:a, b:b, off:off, mode:dir, L:L, chain:ci, k:k, outw:outw, isParam:!!(id && def.params[id]), pre:(id && def.dims[id] && def.dims[id].prefix) || it.prefix || '' });
        cur += L;
      });
    });
    return out;
  }
  // 1 つの 寸法を 直す（id の 値を v に）。高さの 並び（sums）に 入る 寸法は 全体（H）も 一緒に 変える
  function setValue(def, id, v){
    var sv = solve(def), old = sv.val[id], it = itemOf(def, id);
    if (!it) throw new Error('寸法が ありません');
    var sums = (def.drawing && def.drawing.sums) || [];
    if (def.params[id]) {
      sums.forEach(function(su){ if (su.param !== id) return;
        var fixed = 0, rat = [];
        su.items.forEach(function(k){ var d = def.dims[k]; if (d && d.rule === 'ratio' && d.of === id) rat.push(k); else fixed += sv.val[k] || 0; });
        var kf = (old - fixed) > 1e-9 ? (v - fixed) / (old - fixed) : 1;
        rat.forEach(function(k){ var d = def.dims[k]; d.base = v; d.value = sv.val[k] * kf; });
      });
      it.value = v; return;
    }
    var su = sums.filter(function(x){ return x.items.indexOf(id) >= 0; })[0];
    if (su) { // 全体が 変わる：比率の ものは いまの 値の まま 土台を 新しい 全体に
      var P = su.param, nP = sv.val[P] + (v - old);
      Object.keys(def.dims).forEach(function(k){ var d = def.dims[k]; if (d.rule === 'ratio' && d.of === P) { d.value = sv.val[k]; d.base = nP; } });
      def.params[P].value = nP;
    }
    if (it.rule === 'ratio') { var sv2 = solve(def); it.base = sv2.val[it.of]; it.value = v; }
    else if (it.rule === 'fixed') it.value = v;
    else throw new Error('式の 寸法は、式を 直すか「固定」に して ください');
  }
  function setRule(def, id, rule, sv){
    var d = def.dims[id]; if (!d || d.rule === rule) return;
    var cur = sv.val[id];
    if (rule === 'fixed') d.value = cur;
    else if (rule === 'ratio') { d.of = d.of || ({ v:'H', w:'W', d:'D' }[d.axis] || 'H'); d.base = sv.val[d.of]; d.value = cur; }
    else if (rule === 'formula') { if (!d.expr) d.expr = String(Math.round(cur * 10) / 10); }
    d.rule = rule;
  }
  function ruleText(def, id, sv){
    var d = def.dims[id], r = function(x){ return Math.round(x * 10) / 10; };
    if (!d) return '全体の 大きさ。変えると 比率の 寸法も 一緒に 変わります';
    if (d.rule === 'ratio') return '比率：' + nameOf(def, d.of) + ' を 変えると 一緒に 伸びる（' + nameOf(def, d.of) + '×' + r(d.value) + '÷' + r(d.base) + '）';
    if (d.rule === 'fixed') return '固定：いつも ' + r(d.value);
    return '式：' + d.expr;
  }
  return { norm:norm, evalExpr:evalExpr, solve:solve, model:model, view:view, view6:view6, viewDims:viewDims, bbox:bbox, primPts:primPts, arcPts:arcPts,
           inset:inset, barrelOutline:barrelOutline, holePts:holePts, holeArcs:holeArcs, profilePts:profilePts, setValue:setValue, setRule:setRule, ruleText:ruleText, nameOf:nameOf };
})();

// 1 号の 部材：香炉（筆返し・雲形穴）。元図面 W360×D150×H270、底以外 全面磨き
var BZ_KORO = {
  schema:'buzai/1', id:'koro_fudegaeshi_kumo', name:'香炉（筆返し・雲形穴）', category:'香炉', version:0,
  params:{ W:{ name:'幅', default:360, value:360 }, D:{ name:'奥行', default:150, value:150 }, H:{ name:'高さ', default:270, value:270 } },
  dims:{
    fudeH:{ name:'筆返し高さ', axis:'v', rule:'ratio', of:'H', base:270, value:36 },
    tenT:{ name:'天板厚み', axis:'v', rule:'ratio', of:'H', base:270, value:30 },
    neckT:{ name:'上の首', axis:'v', rule:'ratio', of:'H', base:270, value:9 },
    body:{ name:'胴高さ', axis:'v', rule:'ratio', of:'H', base:270, value:159 },
    neckB:{ name:'下の首', axis:'v', rule:'ratio', of:'H', base:270, value:9 },
    baseH:{ name:'台座厚み', axis:'v', rule:'ratio', of:'H', base:270, value:27 },
    holeMV:{ name:'穴上下残り', axis:'v', rule:'ratio', of:'H', base:270, value:12 },
    fudeW:{ name:'筆返し幅', axis:'w', rule:'ratio', of:'W', base:360, value:60 },
    sideIn:{ name:'左右の絞り', axis:'w', rule:'ratio', of:'W', base:360, value:30 },
    holeM:{ name:'穴左右残り', axis:'w', rule:'ratio', of:'W', base:360, value:45 },
    setback:{ name:'筆返し下がり', axis:'d', rule:'ratio', of:'D', base:150, value:6 },
    frontIn:{ name:'前面の絞り', axis:'d', rule:'ratio', of:'D', base:150, value:30 },
    back:{ name:'奥の壁', axis:'d', rule:'ratio', of:'D', base:150, value:30 },
    phi:{ name:'穴Φ', axis:'v', rule:'formula', expr:'胴高さ－穴上下残り×2', prefix:'Φ' },
    pitch:{ name:'ずらし量', axis:'w', rule:'formula', expr:'最小((幅－穴左右残り×2－穴Φ)÷2, 穴Φ×0.95)', min:0 }
  },
  components:[
    { id:'base', name:'台座', shape:{ type:'box', w:'幅', h:'台座厚み', d:'奥行' }, at:{ y:0 } },
    { id:'body', name:'胴', shape:{ type:'barrel', w:'幅', d:'奥行', nb:'下の首', b:'胴高さ', nt:'上の首', side:'左右の絞り', front:'前面の絞り', back:'奥の壁' },
      at:{ y:'台座厚み' }, cuts:[{ type:'cloudHole', phi:'穴Φ', pitch:'ずらし量', cy:'下の首＋胴高さ÷2', finish:'磨光' }] },
    { id:'top', name:'天板', shape:{ type:'box', w:'幅', h:'天板厚み', d:'奥行' }, at:{ y:'台座厚み＋下の首＋胴高さ＋上の首' } },
    { id:'fude', name:'筆返し', shape:{ type:'profile', profile:'fudegaeshi', w:'筆返し幅', h:'筆返し高さ', len:'奥行－筆返し下がり' }, at:{ y:'高さ－筆返し高さ', front:'筆返し下がり' }, mirror:'x' }
  ],
  finish:{ default:'磨き', faces:{ bottom:'なし' }, note:'底以外 全面磨き' },
  drawing:{
    sums:[{ param:'H', items:['baseH', 'neckB', 'body', 'neckT', 'tenT', 'fudeH'] }],
    dims:[
      { view:'front', dir:'v', pos:'left', from:0, chain:['baseH', 'neckB', 'body', 'neckT', 'tenT', 'fudeH'] },
      { view:'front', dir:'v', pos:'right', from:0, chain:['H'] },
      { view:'front', dir:'h', pos:'bottom', from:'－幅÷2', chain:['W'] },
      { view:'front', dir:'h', pos:'top', from:'－幅÷2', chain:['fudeW', { expr:'幅－筆返し幅×2' }, 'fudeW'] },
      { view:'front', dir:'h', pos:{ y:'台座厚み＋下の首＋胴高さ÷2' }, from:'－幅÷2', chain:[{ id:'holeM', show:'(幅－穴Φ－ずらし量×2)÷2' }, { expr:'穴Φ＋ずらし量×2' }, { id:'holeM', show:'(幅－穴Φ－ずらし量×2)÷2' }] },
      { view:'front', dir:'v', pos:{ x:'ずらし量' }, from:'台座厚み＋下の首', chain:['holeMV', 'phi', 'holeMV'] },
      { view:'front', dir:'h', pos:{ y:'台座厚み＋下の首＋胴高さ÷2－穴Φ×0.3' }, from:0, chain:['pitch'] },
      { view:'front', dir:'h', pos:{ y:'台座厚み＋下の首' }, from:'幅÷2－左右の絞り', chain:['sideIn'] },
      { view:'side', dir:'h', pos:'bottom', from:0, chain:['D'] },
      { view:'side', dir:'h', pos:'top', from:0, chain:['setback', { expr:'奥行－筆返し下がり' }] },
      { view:'side', dir:'h', pos:{ y:'台座厚み＋下の首＋胴高さ÷2' }, from:0, chain:[{ expr:'奥行－奥の壁' }, 'back'] },
      { view:'side', dir:'h', pos:{ y:'台座厚み＋下の首' }, from:0, chain:['frontIn'] }
    ]
  },
  estimate:{ sai:'bbox', processes:[{ name:'筆返し加工', qty:2 }, { name:'雲形穴', qty:1 }], parts:[{ name:'線香皿（ステンレス）', code:'', qty:1 }] },
  sources:[]
};

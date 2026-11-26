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

// 投影・隠れ線（KPJ・kmTan・kmHlr・kmSeen）は zumen-hlr.js（組み立ての サムネと 共通）

// ── ページへ 入れる（紙の mm・y 下向き → ページ y 上向き）──
function kY(y){ return 210 - y; }
function kCp(q){ return q ? P(q.x, q.y) : q; } // 基準は 写しで 持つ（移動は 点を その まま 書き換える）
function kOut(pg){ return { ents:[], dims:[], pg:pg }; }
function kL(o, a, b, vid, hid, lay, opt){ var e = { id:SEQ++, t:'line', a:P(a[0], kY(a[1])), b:P(b[0], kY(b[1])), layer:lay || (hid ? '隠れ線' : '部材'), css:null, aci:256, auto:true, vid:vid || null }; if (opt && opt.aid) { e.aid = opt.aid; if (opt.fol) e.fol = opt.fol; } o.ents.push(e); }
function kT(o, x, y, s, h, opt){ opt = opt || {}; var e = { id:SEQ++, t:'text', p:P(x, kY(y)), h:h || 2.5, rot:opt.rot || 0, s:String(s), ha:opt.ha || 0, va:opt.va || 0, wf:1, layer:opt.layer || '文字', css:null, aci:256, auto:true, vid:opt.vid || null, aid:opt.aid || null }; o.ents.push(e); return e; }
function kC(o, x, y, r, vid, opt){ opt = opt || {}; o.ents.push({ id:SEQ++, t:'circle', c:P(x, kY(y)), r:r, layer:opt.hid ? '隠れ線' : opt.layer || '部材', css:null, aci:256, auto:true, vid:vid || null }); }
function kPl(o, pts, vid, hid){ o.ents.push({ id:SEQ++, t:'pl', v:pts.map(function(q){ return { x:q[0], y:kY(q[1]), b:0 }; }), closed:true, layer:hid ? '隠れ線' : '部材', css:null, aci:256, auto:true, vid:vid || null }); }
// 寸法：a,b＝紙の 点（y 下）、n＝外向き（y 下）、d＝離す mm、k＝縮尺の 分母（値＝紙の 長さ×k）
function kD(o, a, b, n, d, k, aid, vid, opt){ opt = opt || {};
  var A = P(a[0], kY(a[1])), B = P(b[0], kY(b[1])), mode = opt.mode || (Math.abs(a[1] - b[1]) < 1e-6 ? 'h' : Math.abs(a[0] - b[0]) < 1e-6 ? 'v' : 'a');   // opt.mode：中心線の 端から はかる 寸法は 横／縦を 決めて（v0.9.57）
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
// 金具（石では ない）は 部品寸法表・加工指示図・部品詳細図・総才数に 出さない（配置図・3D には 残す）。判定は buzai-lib.js の BL.isKana（モデリングと 同じ）。kana＝モデリングで 付けた 印
function kmIsKana(p){ return !!p && (!!p.kana || (typeof BL !== 'undefined' && BL.isKana ? BL.isKana(p) : p.role === '金具')); }
function kmBundles(pay){
  var bySet = {}, order = []; kmBundles.gnum = {};
  pay.parts.forEach(function(p){ if (pay.only !== 'detail' && (kmIsKana(p) || p.nozu)) return;   /* nozu＝モデリングで「加工図面へ 出力しない」（もう ある 石・v0.8.120） */   /* 部材マスターから 金具 1 つを 開く ときは 出す */ var sid = p.setId || p.grp; if (!bySet[sid]) { bySet[sid] = []; order.push(sid); } bySet[sid].push(p); });
  var out = [];
  order.sort(function(a, b){ var ga = bySet[a][0].grp === 'fence' ? 0 : 1, gb = bySet[b][0].grp === 'fence' ? 0 : 1; return ga - gb; });
  order.forEach(function(sid){ var ps = bySet[sid], cnt = {};
    // 分ける 鍵＝skey（モデリングの グループ「紺：G654 深山」）、図に 出す 石種＝stone（「G654 深山」だけ・v0.9.82）。古い 渡しは skey が 無いので stone
    // v0.9.95：分ける 鍵は グループ（p.kumi＝モデリングの 色の グループの id）。前は「紺：G654 深山」で、石種を 変えると ページの 名前が 変わり
    //   ページに 付いた 手の 直し（部品寸法表・加工指示図・ページに 置いた 寸法・△・対象外）が 外れて いた（2026-11-26 本人「石材を 変えて 更新したら 直した 寸法線が 全部 元に」）
    var skOf = function(p){ return p.kumi ? '#' + p.kumi : p.skey != null ? p.skey : (p.stone || ''); };
    ps.forEach(function(p){ var s = skOf(p); cnt[s] = (cnt[s] || 0) + 1; });
    var stones = Object.keys(cnt).sort(function(a, b){ return cnt[b] - cnt[a]; });
    stones.forEach(function(st, si){ var pp = ps.filter(function(p){ return skOf(p) === st; });
      var names = []; pp.forEach(function(p){ var b = kmBase(p.name); if (names.indexOf(b) < 0) names.push(b); });
      // 束の 名前に セット名（セットファイルの 名前）は 使わない（v0.9.100 本人「基本的に セットファイル名を 使う 事は 無いように」）。外柵／石塔、同じ 種類が 2 つ目なら 番号
      var gk = ps[0].grp === 'fence' ? '外柵' : '石塔', gn = (kmBundles.gnum = kmBundles.gnum || {}); if (si === 0) gn[gk] = (gn[gk] || 0) + 1;
      var title = si === 0 ? gk + (gn[gk] > 1 ? ' ' + gn[gk] : '') : names.join('・');
      var p0 = pp[0], lbl = p0.skey != null ? p0.skey : (p0.stone || '');
      var B = { id:sid + '|' + (st || '-'), sid:sid, lbl:lbl, title:title, stone:p0.skey != null ? (p0.stone || '') : (p0.stone || ''), parts:pp, groups:[] }, seen = {};
      pp.forEach(function(p){ var nm = kmBase(p.name), key = nm + '|' + p.w + 'x' + p.d + 'x' + p.h;
        if (seen[key]) { seen[key].ks.push(p.k); return; }
        var g = { name:nm, ks:[p.k], w:p.w, d:p.d, h:p.h, fin:p.fin || '', kakou:(p.kakou || '') === '左右対称' ? '' : (p.kakou || ''), old:(p.setId || p.grp) + '/' + String(p.key || p.k).replace(/_[LR]$/, '') };
        // 図の 名前（直し・ひな形の 付け先）は 部材の id（v0.9.3〜。同じ 部材なら どの セット・案件でも 同じ ひな形）。部材が 無い 箱は 前の とおり セット/枠
        g.mig = p.basePart || p.partId || g.old; g.type = p.partId || g.old; var n = 2; while (out.concat([B]).some(function(b){ return b.groups.some(function(x){ return x.type === g.type; }); })) g.type = (p.partId || g.old) + '#' + n++;
        seen[key] = g; B.groups.push(g); });
      B.groups.forEach(function(g, i){ g.no = i + 1; g.sai = g.w * g.d * g.h / KM_S3; g.sym = g.ks.length === 2; });
      out.push(B); }); });
  return out;
}
// 前の 付け先（セット/枠）で 覚えた 直し・ひな形を 部材の id へ 移す（ページの 名前に 入って いる ものも）。差し替えて いても 移し先は セットの 既定の 部材
// 前の ページの 名前（セット|紺：G654 深山）で 覚えた 直しを 今の 名前（セット|#グループ）へ 移す（v0.9.95）
//   石種を 変えた あとの 古い 名前（紺：インド黒 など、同じ グループ名で 石種 だけ ちがう）も、今 その 名前の 束が 無ければ 移す（外れて いた 直しを 戻す）
function kmMigBid(bundles){ if (!KMED) return; var txt = JSON.stringify(KMED), now = {}, maps = [];
  bundles.forEach(function(B){ now[B.sid + '|' + B.lbl] = 1; });
  var esc = function(x){ return x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
  bundles.forEach(function(B){ if (!B.sid || B.id === B.sid + '|' + B.lbl) return; var kn = String(B.lbl).split('：')[0], re = new RegExp(esc(B.sid + '|') + '([^/"]*)/', 'g'), m, seen = {};
    while ((m = re.exec(txt))) { var L = m[1]; if (seen[L] || '#' === L.charAt(0)) continue; seen[L] = 1;
      if (L === B.lbl || (L.indexOf('：') > 0 && L.split('：')[0] === kn && !now[B.sid + '|' + L])) maps.push([B.sid + '|' + L + '/', B.id + '/']); } });
  if (!maps.length) return;
  maps.forEach(function(q){ txt = txt.split(q[0]).join(q[1]); });
  var o = JSON.parse(txt); Object.keys(o).forEach(function(k){ KMED[k] = o[k]; }); }
function kmMigType(bundles){
  var pairs = []; bundles.forEach(function(B){ B.groups.forEach(function(g){ if (g.old !== g.mig) pairs.push([g.old, g.mig]); }); }); if (!pairs.length) return;
  var mv = function(txt){ pairs.forEach(function(q){ var o = q[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); txt = txt.replace(new RegExp('(["+:/])' + o + '(?=[/+"#])', 'g'), function(m, a){ return a + q[1]; }); }); return txt; };
  var a = JSON.stringify(KMED), b = mv(a); if (a !== b) { var o = JSON.parse(b); Object.keys(o).forEach(function(k){ KMED[k] = o[k]; }); }
  var t = kmLs('zumen.kmTpl'); if (t) { var ta = JSON.stringify(t), tb = mv(ta); if (ta !== tb) kmLs('zumen.kmTpl', JSON.parse(tb)); }
}
function kmBase(n){ return String(n || '').replace(/（[左右]）/, ''); }
function kmPart(k){ return KM2.pay.parts.filter(function(p){ return p.k === k; })[0]; }
function kmItem(k, world){ var p = kmPart(k), g = KM2.geo[k], b = p.box; return { k:k, tris:g.tris, edges:g.edges, soft:g.soft, tan:g.tan, off:world ? [(b.x0 + b.x1) / 2, b.y0, (b.z0 + b.z1) / 2] : [0, 0, 0] }; }

// ── 枠・表題欄（修正の △ の 一覧も）──
function kmFrame(o, pg, title, kind){
  var R = function(x0, y0, x1, y1, w){ kL(o, [x0, y0], [x1, y0], null, false, '枠'); kL(o, [x1, y0], [x1, y1], null, false, '枠'); kL(o, [x1, y1], [x0, y1], null, false, '枠'); kL(o, [x0, y1], [x0, y0], null, false, '枠'); };
  R(8, 8, 289, 202); kL(o, [8, 15], [289, 15], null, false, '枠');
  kT(o, 10, 13, title, 3.4, { layer:'枠', aid:pg.key + '/title' }); kT(o, 287, 13, pg.skip ? '対象外' : (pg.no || 0) + ' / ' + (pg.tot || 0), 3, { ha:2, layer:'枠' });
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
  // GL と GL からの 寸法は 部材図では 出さない（本人 2026-11-08。施工図で 出す）
  // 平面：間口・奥行・奥行の 連なり（真ん中を 通る 外柵の 石＋石塔の 下の 段）
  kD(o, pP(X0, Z1), pP(X1, Z1), [0, 1], 6, n, 'site/plan/W', 'site/plan');
  kD(o, pP(X0, Z0), pP(X0, Z1), [-1, 0], 8, n, 'site/plan/D', 'site/plan');
  var fz = [], tw = KM2.pay.parts.filter(function(p){ return p.grp === 'tower'; }), tyMin = tw.length ? Math.min.apply(null, tw.map(function(p){ return p.box.y0; })) : 0;
  KM2.pay.parts.forEach(function(p){ var b = p.box; if (p.grp === 'fence' && b.x0 < 0 && b.x1 > 0) fz.push([b.z0, b.z1]); });
  var tb = tw.filter(function(p){ return Math.abs(p.box.y0 - tyMin) < 1; }).map(function(p){ return p.box; });
  if (tb.length) fz.push([Math.min.apply(null, tb.map(function(b){ return b.z0; })), Math.max.apply(null, tb.map(function(b){ return b.z1; }))]);
  var zs = []; fz.forEach(function(q){ zs.push(q[0], q[1]); }); zs.push(Z0, Z1); zs = zs.map(function(z){ return Math.round(z * 10) / 10; }).sort(function(a, b){ return a - b; }).filter(function(z, i, a){ return !i || z - a[i - 1] > 0.5; });
  for (var i = 0; i < zs.length - 1; i++) kD(o, pP(X1, zs[i]), pP(X1, zs[i + 1]), [1, 0], 6, n, 'site/plan/z' + i, 'site/plan', { h:2 });
  // 正面：間口・全体の 高さ（いちばん 下の 石から）・外柵の 高さ
  kD(o, pF(X0, Y0), pF(X1, Y0), [0, 1], 7, n, 'site/front/W', 'site/front');
  kD(o, pF(X1, Y0), pF(X1, Y1), [1, 0], 14, n, 'site/front/H', 'site/front');
  var fen = KM2.pay.parts.filter(function(p){ return p.grp === 'fence'; });
  if (fen.length) { var edge = fen.filter(function(p){ return Math.abs(p.box.x1 - X1) < 1; })[0];
    if (edge) kD(o, pF(X1, edge.box.y0), pF(X1, edge.box.y1), [1, 0], 6, n, 'site/front/fenceH', 'site/front', { h:2 });
    var hi = fen.reduce(function(a, p){ return p.box.y1 > a.box.y1 ? p : a; }, fen[0]);
    if (hi.box.y1 > (edge ? edge.box.y1 : 0) + 50) kD(o, pF(X0, hi.box.y0), pF(X0, hi.box.y1), [-1, 0], 8, n, 'site/front/fenceTop', 'site/front', { h:2.1 }); }
  // 右側面：奥行・いちばん 前の 石（階段）の 高さ
  kD(o, pS(Z1, Y0), pS(Z0, Y0), [0, 1], 6, n, 'site/right/D', 'site/right');
  var fr = fen.filter(function(p){ return Math.abs(p.box.z1 - Z1) < 1 && p.box.x0 < 0 && p.box.x1 > 0; })[0];
  if (fr) kD(o, pS(Z1, fr.box.y0), pS(Z1, fr.box.y1), [-1, 0], 5, n, 'site/right/stepH', 'site/right', { h:2 });
  kT(o, 12, 21, '平面図', 3, { aid:'site/plan/name' }); kT(o, 12, Yf - Y1 * s - 5, '正面図', 3, { aid:'site/front/name' }); kT(o, Xs - (Z1 - Z0) * s / 2, Yf - Y1 * s - 5, '右側面図', 3, { aid:'site/right/name' });
  // 注記
  var pay = KM2.pay, nx = Math.max(Xs + (Z1 - Z0) * s / 2 + 12, 175), ny = 24, J = pay.joint || {}, gl = pay.gl || {}, notes = [];
  if (J.h != null) notes.push('目地　横・奥行 ' + J.h + '／高さ ' + J.v);
  if (pay.open != null) notes.push('納骨室の 開口部 ' + Math.round(pay.open) + '（' + (J.open || 270) + ' 以上）');
  notes.push('寸法は 目地を 引いた 製作寸法（mm）');
  var st = {}; KM2.bundles.forEach(function(B){ if (B.stone) st[B.title] = kmStoneName(B.stone); }); var sl = Object.keys(st).map(function(t){ return t + ' ' + st[t]; }); if (sl.length) notes.push('石種　' + sl.join('／'));
  kT(o, nx, ny, '注記', 3, { aid:'site/notes/h' }); notes.forEach(function(t, i){ kT(o, nx, ny + 5.5 * (i + 1), '・' + t, 2.5, { aid:'site/notes/' + i }); });
  kmFrame(o, pg, '配置図　平面・正面・右側面', '配置図（三面）'); kT(o, 12, 186, '縮尺 1/' + n, 2.6, { aid:pg.key + '/scale' });
}
function kmRegion(o, vid){ var v = o.pg.vw[vid], m = 12; return { x0:v.bb.x0 - m, x1:v.bb.x1 + m, y0:v.bb.y0 - m, y1:v.bb.y1 + m, k:v.k, vid:vid }; }
// 部品寸法表（v0.9.86 本人：得意先・発注先・右の 表・才数の 説明は 不要／幅・奥行・高さは mm（寸）／石種は 石種名だけ）
function kmSunTxt(v){ if (typeof fmtLen === 'function') return fmtLen(+v, 'both'); return String(v); }
function kmFitW(s, h){ var w = 0; for (var i = 0; i < s.length; i++) w += /[ -~]/.test(s[i]) ? 0.6 : 1; return w * h; }   // 文字の 幅の 見込み（mm）
// 欄の 幅 w に 収める：文字を 小さく（h → 最小 hmin）、それでも 入らなければ 後ろを …
function kmFit(s, w, h, hmin){ s = String(s == null ? '' : s); while (h > hmin && kmFitW(s, h) > w) h = Math.round((h - 0.1) * 10) / 10;
  if (kmFitW(s, h) > w) { while (s.length > 1 && kmFitW(s + '…', h) > w) s = s.slice(0, -1); s += '…'; } return { s:s, h:h }; }
function kmStoneName(s){ return String(s || '').replace(/^[^：]*：/, ''); }   // 古い 渡し（「紺：G654 深山」）でも 石種名だけ
function kmPgTable(o, pg){
  var B = pg.B, stone = kmStoneName(B.stone); kmFrame(o, pg, '部品寸法表', '部品寸法表');   // 題に セット名・部材名を 出さない（v0.9.100 本人「土留 1220×900 石塔婆は 不要」）
  kT(o, 12, 22, '石種　' + (stone || '（未定）'), 2.8);   // 図面名（＝セット名）は 出さない（v0.9.97 本人「図面名は 不要」）
  var tot = B.groups.reduce(function(a, g){ return a + g.sai * g.ks.length; }, 0); kT(o, 287, 22, '総才数　' + tot.toFixed(3), 2.8, { ha:2 });
  var cols = [['NO', 8], ['部品名称', 30], ['幅 mm（寸）', 24], ['奥行 mm（寸）', 24], ['高さ mm（寸）', 24], ['数量', 9], ['才数', 14], ['磨き', 40]], y = 26, rh = 6.2, X0 = 12, XE = 287;
  cols.push(['加工明細', XE - X0 - cols.reduce(function(a, c){ return a + c[1]; }, 0)]);
  function row(v, head){ var x = X0; cols.forEach(function(c, i){ var left = i === 1 || i >= 7, h0 = head ? 2.4 : i === 8 ? 2.2 : 2.5, f = kmFit(v[i], c[1] - 2, h0, head ? 1.8 : 1.7);
    kT(o, left ? x + 1 : x + c[1] - 1, y + rh - 1.8, f.s, f.h, { ha:left ? 0 : 2, layer:'枠' }); x += c[1]; }); kL(o, [X0, y], [x, y], null, false, '枠'); y += rh; }
  row(cols.map(function(c){ return c[0]; }), 1);
  for (var i = 0; i < 20; i++) { var g = B.groups[i]; row(g ? [g.no, g.name, kmSunTxt(g.w), kmSunTxt(g.d), kmSunTxt(g.h), g.ks.length, (g.sai * g.ks.length).toFixed(3), g.fin.replace('（底以外）', ''), (g.sym ? '左右対称 ' : '') + g.kakou] : [i + 1]); }
  var xx = X0; kL(o, [X0, y], [XE, y], null, false, '枠');
  cols.forEach(function(c){ kL(o, [xx, 26], [xx, y], null, false, '枠'); xx += c[1]; }); kL(o, [XE, 26], [XE, y], null, false, '枠');
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
  var B = pg.B;
  if (pg.sheet) { pg.groups.forEach(function(g, j){ kmSheetPut(o, pg, g, j * 148.5, B); }); return; }
  kL(o, [148.5, 15], [148.5, 190], null, false, '枠');
  pg.groups.forEach(function(g, j){ kmDetail(o, pg, g, j ? 148.5 : 8, B); });
  kmFrame(o, pg, '【部品詳細図】　' + B.title, '部品詳細図');
}
// 部材の 図枠（部材マスターの 図面で 直す＝加工図面 1 枚）：{ fr, paper, n }。図枠が 無い・前の 範囲の 枠だけ なら null
// 図枠の 図を かいた ときの 大きさ（幅・奥行・高さ）：inf.wdh（v0.9.57〜）か、前の 図は 上の 欄の「1515×150×330 mm」から
function kmSheetWdh(fr){ var inf = fr.sheet.inf || {}; if (inf.wdh && inf.wdh.length === 3) return inf.wdh;
  var m = /^\s*(\d+(?:\.\d+)?)×(\d+(?:\.\d+)?)×(\d+(?:\.\d+)?)\s*mm/.exec(inf.sub1 || ''); return m ? [+m[1], +m[2], +m[3]] : null; }
function kmSizeDiff(g, z){ return !!z && [g.w, g.d, g.h].some(function(v, i){ return Math.abs(+v - z[i]) > 0.5; }); }
// 保存した 加工図面（部材の sketch の 図枠）と モデリングの 大きさの ちがい（v0.9.59）
// lock：加工図面で 🔒 鍵を かけた 値と 図の 大きさが 同じ（＝本人が わざと 加工図面の 大きさに して いる）
var KM_AX = [['W', '幅'], ['D', '奥行'], ['H', '高さ']];
function kmSheetInfo(g){ var p = kmPart(g.ks[0]), sk = p && p.shape && p.shape.sketch; if (!sk || !sk.ents) return null;
  var fr = sk.ents.filter(function(e){ return e.frame && e.t === 'pl' && e.sheet; })[0]; if (!fr) return null;
  var z = kmSheetWdh(fr), lk = (p.shape && p.shape.lock) || {}, m = [g.w, g.d, g.h], diff = [];
  if (z) KM_AX.forEach(function(a, i){ if (Math.abs(+m[i] - z[i]) > 0.5) diff.push({ ax:a[0], n:a[1], sheet:z[i], model:+m[i], lock:+lk[a[0]] > 0 && Math.abs(+lk[a[0]] - z[i]) < 0.5 }); });
  return { fr:fr, sk:sk, paper:fr.sheet.paper === 'A4h' ? 'A4h' : 'A4', n:fr.sheet.n, wdh:z, diff:diff, ver:p.shape.version || 0,
    from:p.shape.__from === 'job' ? 'job' : 'master' }; }
// 大きさ違いの とき：鍵の ちがい だけ なら そのまま 使う。ほかは 保存した 加工図面を もとに モデリングの 大きさに 合わせた 図（kmStretchSheet）を 使う
// 本人が［↩ 自動の 図に 戻す］を 押した 部材（KMED.useSheet＝'auto'）は 使わない（今の 大きさで 部品詳細図）
// （2026-11-24 本人「150 が マスターで 登録した 情報で、それを ベースに して 寸法変更して 図面化する 様に 設計した はず。150 の 部材図面を ベースに して 135 の 図面を」）
// 自動の 図に した 印は お墓（件名）ごと（v0.9.81。前は 部材の 種類 だけ で、1 度 押すと ほかの お墓でも ずっと 自動の 図に なって いた）
function kmUseMap(){ if (!KMED) return {}; var U = KMED.useSheet = KMED.useSheet || {}, nm = (KM2 && KM2.pay && KM2.pay.name) || '';
  if (!U.__byJob) { Object.keys(U).forEach(function(k){ delete U[k]; }); U.__byJob = 1; }   // 前の 種類 だけの 印は 捨てる（マスターの 加工図面を もとに する に 戻す）
  return U[nm] = U[nm] || {}; }
function kmUseOf(t){ return kmUseMap()[t]; }
function kmSheetUse(g, S){ S = S || kmSheetInfo(g); if (!S) return null; if (!S.diff.length) return S;
  if (S.diff.every(function(d){ return d.lock; })) return S;
  var u = kmUseOf(g.type); if (u === 'auto') return null;
  var C = KM2.sheetCache = KM2.sheetCache || {}; if (!C[g.type]) C[g.type] = kmStretchSheet(g, S) || 'x'; return C[g.type] === 'x' ? null : C[g.type]; }
// 保存した 加工図面（図枠）を モデリングの 大きさに：面の 図は skStretch（近い 端からの mm の まま）、立体の 絵・寸法・▲は 今の 形で かき直す（加工図面の 画面と 同じ）
function kmStretchSheet(g, S){ var k = g.ks[0], p = kmPart(k); if (!S.wdh || typeof skStretch !== 'function') return null;
  var to = [g.w, g.d, g.h].map(function(v, i){ var d = S.diff.filter(function(x){ return x.ax === KM_AX[i][0]; })[0]; return d && d.lock ? d.sheet : +v; });
  var sk = JSON.parse(JSON.stringify(S.sk)), mp = sk.info && sk.info.isoMap, had = sk.ents.some(function(e){ return e.iso && !e.mg; });
  var mk = mp && had && KM2.geo[k] ? kmMgPick(sk) : [];   // 手で 置いた 磨きの ▲・矢印（立体の 絵の 上）は skStretch で 動かさず、あとで 面に 合わせて 動かす
  skStretch(sk, S.wdh, to); mk.forEach(function(e){ sk.ents.push(e); });
  sk.ents = sk.ents.filter(function(e){ return !e.iso && !e.mg; }); sk.dims = (sk.dims || []).filter(function(d){ return !d.iso; });
  if (mp && had && KM2.geo[k]) { var r = kmHlr([kmItem(k, false)], 'iso', 1, 1), M = function(q){ return P(mp.ox + q[0] - r.u0, mp.oy + q[1] - r.v0); };
    var mp2 = { ox:mp.ox, oy:mp.oy, u0:r.u0, v0:r.v0 }; sk.info.isoMap = mp2;
    r.vis.forEach(function(sg){ sk.ents.push({ t:'line', a:M(sg.a), b:M(sg.b), layer:'立体の 絵', css:null, aci:256, iso:1 }); });
    isoDimsOf(to[0], to[1], to[2], function(q){ var z = KPJ.iso(q); return M(z); }).forEach(function(d){ sk.dims.push(d); });
    var dr = p.shape && p.shape.drawing, fs = (dr && dr.migaki) || []; if (fs.length) mgEntsOf(fs, to[0], to[1], to[2], mp2, S.n).forEach(function(e){ sk.ents.push(e); });
    kmMgFollow(mk, mp, S.wdh, mp2, to); }
  var fr = sk.ents.filter(function(e){ return e.frame && e.t === 'pl' && e.sheet; })[0];
  return { fr:fr, sk:sk, paper:S.paper, n:S.n, wdh:to, diff:[], from:S.from, ver:S.ver, stretched:S }; }
// 手で 置いた 磨きの ▲・矢印（［▲ 磨き］・画層 磨き・自動の e.mg では ない）の うち 立体の 絵の 上の もの を sk から 抜き出す（v0.9.65）
//   2026-11-25 本人「寸法を 変更したら 磨きの 矢印が ズレた」：立体の 絵は 今の 大きさで かき直すのに、手の ▲・矢印は
//   skStretch で 正面図などの 面の きまりで 動いて（または 動かずに）面から 外れて いた
function kmMgPick(sk){ var ib = { x0:Infinity, y0:Infinity, x1:-Infinity, y1:-Infinity };
  sk.ents.forEach(function(e){ if (!e.iso || e.mg) return; entPts(e).forEach(function(q){ ib.x0 = Math.min(ib.x0, q.x); ib.x1 = Math.max(ib.x1, q.x); ib.y0 = Math.min(ib.y0, q.y); ib.y1 = Math.max(ib.y1, q.y); }); });
  if (!isFinite(ib.x0)) return []; var m = Math.max(ib.x1 - ib.x0, ib.y1 - ib.y0) * 0.35;
  var inB = function(q){ return q.x >= ib.x0 - m && q.x <= ib.x1 + m && q.y >= ib.y0 - m && q.y <= ib.y1 + m; };
  var out = [], rest = [];
  sk.ents.forEach(function(e){ var ok = !e.mg && !e.iso && !e.frame && e.layer === '磨き' && (e.t === 'line' || (e.t === 'text' && /▲/.test(e.s || ''))) && entPts(e).some(inB);
    (ok ? out : rest).push(e); });
  sk.ents = rest; return out; }
// 抜き出した ▲・矢印を 新しい 立体の 絵に：矢印の 先（▲だけ なら ▲）が さす 面（上・正面・左）の 上の 点を 割合で 新しい 大きさへ。▲・矢じりは 先と 同じ だけ 動かす
function kmMgFollow(L, mp0, f, mp1, t){ if (!L.length || !mp0 || !mp1) return;
  var X = KPJ.iso([1, 0, 0]), Y = KPJ.iso([0, 1, 0]), Z = KPJ.iso([0, 0, 1]), d2 = function(a, b){ return Math.hypot(a.x - b.x, a.y - b.y); };
  var to2 = function(q, mp){ var z = KPJ.iso(q); return P(mp.ox + z[0] - mp.u0, mp.oy + z[1] - mp.v0); };
  var A = [X, Y, Z], AX = { top:[1, 0, 2], front:[2, 0, 1], left:[0, 2, 1] };   // [固定の 軸, 解く 軸 2 つ]
  var map = function(c){ var W = f[0], Dd = f[1], H = f[2], lo = [-W / 2, 0, -Dd / 2], hi = [W / 2, H, Dd / 2], best = null;
    var u = c.x - mp0.ox + mp0.u0, v = c.y - mp0.oy + mp0.v0;   // 立体の 絵の もとの 座標
    Object.keys(AX).forEach(function(k){ var a = AX[k], fv = k === 'left' ? lo[0] : hi[a[0]], F = A[a[0]], P1 = A[a[1]], P2 = A[a[2]];
      var ru = u - F[0] * fv, rv = v - F[1] * fv, det = P1[0] * P2[1] - P2[0] * P1[1]; if (Math.abs(det) < 1e-9) return;
      var s1 = (ru * P2[1] - P2[0] * rv) / det, s2 = (P1[0] * rv - ru * P1[1]) / det, q = [0, 0, 0]; q[a[0]] = fv; q[a[1]] = s1; q[a[2]] = s2;
      var out = 0; [a[1], a[2]].forEach(function(i){ out += Math.max(lo[i] - q[i], 0, q[i] - hi[i]); q[i] = Math.min(hi[i], Math.max(lo[i], q[i])); });
      if (!best || out < best.out) best = { q:q, out:out }; });
    if (!best) return c; var q = best.q.map(function(x, i){ var r = (x - lo[i]) / ((hi[i] - lo[i]) || 1); var sz = t[[0, 2, 1][i]]; return i === 1 ? r * sz : (r - 0.5) * sz; });   // t＝[幅, 奥行, 高さ]・立体の 軸＝[幅, 高さ, 奥行]
    var n0 = to2(best.q, mp0), n1 = to2(q, mp1); return P(c.x + n1.x - n0.x, c.y + n1.y - n0.y); };   // 面から 少し 外れて いても その 分は そのまま
  var lines = L.filter(function(e){ return e.t === 'line'; }), tris = L.filter(function(e){ return e.t === 'text'; }), used = new Set();
  var mv = function(es, c){ var c2 = map(c), dx = c2.x - c.x, dy = c2.y - c.y; es.forEach(function(e){ used.add(e); if (e.t === 'line') { e.a = P(e.a.x + dx, e.a.y + dy); e.b = P(e.b.x + dx, e.b.y + dy); } else e.p = P(e.p.x + dx, e.p.y + dy); }); };
  // 矢じり（a＝先）が 2 本 ある 線＝軸。軸の a に いちばん 近い ▲
  lines.forEach(function(sh){ if (used.has(sh)) return; var hs = lines.filter(function(h){ return h !== sh && !used.has(h) && d2(h.a, sh.b) < 1e-3; }); if (!hs.length) return;
    var tr = null, bd = Infinity; tris.forEach(function(x){ if (used.has(x)) return; var d = d2(x.p, sh.a); if (d < bd && d < (x.h || 1) * 3) { bd = d; tr = x; } });
    mv([sh].concat(hs, tr ? [tr] : []), P(sh.b.x, sh.b.y)); });
  tris.forEach(function(x){ if (!used.has(x)) mv([x], P(x.p.x, x.p.y)); });
  lines.forEach(function(e){ if (!used.has(e)) mv([e], P((e.a.x + e.b.x) / 2, (e.a.y + e.b.y) / 2)); });
}
// 図枠の 図が モデリングの 大きさと ちがう ときは、保存した 加工図面を もとに 今の 大きさに 合わせて 使う（v0.9.59）。右の 欄と 知らせで 分かる ように
function kmSheetOf(g){ return kmSheetUse(g); }
function kmDiffTxt(S){ return S.diff.map(function(d){ return d.n + ' ' + kmR(d.sheet) + '（モデリング ' + kmR(d.model) + '）' + (d.lock ? '🔒' : ''); }).join('・'); }
function kmR(v){ return String(Math.round(+v * 10) / 10); }
// 図枠の 寸法の 矢印・文字の ずらしを 紙の 大きさに（図面で 直すと 同じ 見え方）。設定の「矢印の 長さ」は 図面の 単位なので 縮尺で 割る
// （2026-11-24 設定の 矢印 16 が 紙の 16mm に なり、図枠の ページだけ 矢印が 大きく なって いた）
function kmDimPaper(n2, d, s, th){ n2.al = d.al > 0 ? d.al * s : S.arrow > 0 ? S.arrow * s : th; if (d.tx) n2.tx = d.tx * s; }
// 部材の 図に 保存した 寸法の 書き方（sk.ds：表記・mm の 小数・文字の 高さ・矢印。v0.9.91）を 束の ページの 寸法に。1 本ずつ 決めた ものは そのまま
//   （2026-11-26 本人「マスターの 寸法の 書き方が 反映されない」：束は 加工図面タブの 設定で かいて いた）。ds の 無い 前の 図は 今までどおり
function kmDsApply(n2, d, s, ds){ if (!ds) return;
  if (!d.fmt && ds.fmt && d.mode !== 'hole') n2.fmt = ds.fmt;
  if (d.dp == null && ds.mmDec != null) n2.dp = +ds.mmDec;
  if (!(d.th > 0) && ds.th > 0) n2.th = ds.th * s;
  if (!(d.al > 0)) n2.al = ds.arrow > 0 ? ds.arrow * s : n2.th;
  if (!d.at && ds.arrowType) n2.at = ds.arrowType; }
// 保存した 加工図面（図枠）に モデリングの アンカーの 穴（L金具の ボルト・anc:1）を 足す（v0.9.63）
//   2026-11-25 本人「穴加工の 位置ずれは 直ったが 今回は 消えた」：v0.9.59 で 保存した 加工図面を 使う ように なり、
//   マスターの 図（穴なし）だけ 描いて 案件で 開いた アンカーの 穴が 出なく なって いた。面の 外形（pv）に 合わせて 円・中心線・位置の 寸法・書き込みを 足す
function kmAncSheet(sk0, g, n){ var k = g.ks[0], p = kmPart(k); if (!p || !p.shape || !sk0) return sk0;
  var W = +g.w, D = +g.d, H = +g.h;
  // 面の 候補：穴の 開く 面を 先に（背面から の 穴は 背面図）、無ければ 反対の 面に 隠れ線で（v0.9.64 本人「腰石前の 加工図面に 穴が 出ない」＝背面図と 右側面図だけの 図）
  var listOf = function(v){ var L = []; ((v.front && v.front.holes) || []).forEach(function(h){ if (!h.anc) return; var bk = h.from === 'back'; L.push({ pvs:bk ? ['back', 'front'] : ['front', 'back'], h:h, from:bk ? '背面から' : '前から' }); });
    ((v.side && v.side.holes) || []).forEach(function(h){ if (!h.anc) return; var lf = h.from === 'left'; L.push({ pvs:lf ? ['left', 'side'] : ['side', 'left'], h:h, from:lf ? '左の 面から' : '右の 面から' }); });
    ((v.top && v.top.holes) || []).forEach(function(h){ if (h.anc) L.push({ pvs:['top'], h:h, from:'上から' }); }); return L; };
  var L = listOf(kmViews(p, g.w, g.d, g.h));
  // 前の 位置の 穴（v0.9.84）：［〇〇家の 墓に 保存］した 図に かかれた 穴。金具を 動かした あと も 残って いた（2026-11-26 本人「金具の 位置を 変えたのに 加工図面が 変わらない」）
  //   モデリングが 外した 前の 穴（shape.__ancOld）を 同じ 写し方で 図に 置き、今の 穴と 重ならない ものは 円・中心線・位置の 寸法を 消す
  var Lo = [], AO = p.shape.__ancOld; if (AO) { var ps = JSON.parse(JSON.stringify(p.shape)), vv = ps.components && ps.components[0] && ps.components[0].shape && ps.components[0].shape.views;
    if (vv) { ['front', 'side', 'top'].forEach(function(f){ if (!AO[f] || !AO[f].length) return; vv[f] = vv[f] || {}; vv[f].holes = AO[f].map(function(h){ return Object.assign({}, h, { anc:1 }); }); });
      ['front', 'side', 'top'].forEach(function(f){ if (vv[f] && !AO[f]) vv[f].holes = []; });
      Lo = listOf(kmViews({ shape:ps }, g.w, g.d, g.h)); } }
  if (!L.length && !Lo.length) return sk0;
  var sk = JSON.parse(JSON.stringify(sk0)), bbOf = function(pv){ var b = null;
    sk.ents.forEach(function(e){ if (e.pv !== pv || e.t !== 'pl' || !e.v || e.frame) return; var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      e.v.forEach(function(q){ x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); });
      if (!b || (x1 - x0) * (y1 - y0) > (b.x1 - b.x0) * (b.y1 - b.y0)) b = { x0:x0, x1:x1, y0:y0, y1:y1 }; }); return b; };
  // 面ごとの 大きさ・x の 原点・左右の 向き（背面図・左側面図は 左右が 逆）
  var EXT = { front:[W, H], back:[W, H], side:[D, H], left:[D, H], top:[W, D] }, OX = { front:W / 2, back:W / 2, side:0, left:0, top:W / 2 }, MIR = { back:1, left:1 }, grp = {};
  var place = function(a){ var pv = null, b = null; a.pvs.some(function(q){ var bb = bbOf(q); if (bb) { pv = q; b = bb; } return !!bb; }); if (!b) return null;
    var e = EXT[pv], kx = (b.x1 - b.x0) / e[0], ky = (b.y1 - b.y0) / e[1];
    var xs = a.h.pts.map(function(q){ return q[0]; }), ys = a.h.pts.map(function(q){ return q[1]; }), cx = (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2, cy = (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2;
    var r = (Math.max.apply(null, xs) - Math.min.apply(null, xs)) / 2, u = (cx + OX[pv]) * kx;
    return { pv:pv, b:b, kx:kx, r:r, hid:pv !== a.pvs[0], c:{ x:MIR[pv] ? b.x1 - u : b.x0 + u, y:b.y0 + cy * ky } }; };
  var near = function(a, b, t){ return Math.abs(a - b) < (t || 0.5); };
  var now = L.map(place).filter(Boolean);
  Lo.map(place).forEach(function(o){ if (!o || now.some(function(m){ return m.pv === o.pv && near(m.c.x, o.c.x) && near(m.c.y, o.c.y); })) return;
    var c = o.c, R = o.r * o.kx, b = o.b;
    sk.ents = sk.ents.filter(function(e){
      if (e.t === 'circle' && e.c && Math.hypot(e.c.x - c.x, e.c.y - c.y) < 1 && Math.abs(e.r - R) < 1) return false;
      if (e.t === 'line' && /中心/.test(e.layer || '') && e.a && e.b && Math.hypot((e.a.x + e.b.x) / 2 - c.x, (e.a.y + e.b.y) / 2 - c.y) < 1 && Math.hypot(e.a.x - e.b.x, e.a.y - e.b.y) < Math.max(R * 8, 30)) return false;
      return true; });
    // 位置の 寸法：片方が 穴の 中心の 線（横は x・縦は y）、もう 片方が 面の 端
    sk.dims = (sk.dims || []).filter(function(d){ if (!d.a || !d.b) return true;
      var hx = function(p, q){ return near(p.x, c.x) && (near(q.x, b.x0) || near(q.x, b.x1)); }, vy = function(p, q){ return near(p.y, c.y) && (near(q.y, b.y0) || near(q.y, b.y1)); };
      if (d.mode === 'h' && (hx(d.a, d.b) || hx(d.b, d.a))) return false;
      if (d.mode === 'v' && (vy(d.a, d.b) || vy(d.b, d.a))) return false;
      return true; }); });
  L.forEach(function(a, ai){ var o = place(a); if (!o) return; var pv = o.pv, b = o.b, kx = o.kx, r = o.r, hid = o.hid, c = o.c;
    if (sk.ents.some(function(q){ return q.t === 'circle' && q.c && Math.hypot(q.c.x - c.x, q.c.y - c.y) < 1 && Math.abs(q.r - r * kx) < 1; })) return;   // 保存した 図に もう ある
    var G = grp[pv] = grp[pv] || { b:b, cs:[], txt:{} }; G.cs.push(c);
    var tt = 'Φ' + kmR(r * 2) + 'mm 深' + kmR(a.h.depth) + 'mm'; G.txt[tt + '|' + a.from] = (G.txt[tt + '|' + a.from] || 0) + 1;
    var hk = 'anc/' + pv + '/h' + ai;   // 線・円にも 名前（v0.9.99：手で 直した 線を 覚える）
    sk.ents.push({ id:SEQ++, ak:hk + '/c', t:'circle', c:{ x:c.x, y:c.y }, r:r * kx, layer:hid ? '隠れ線' : '部材_外形', css:null, aci:256, pv:pv, anc:1 });
    var ex = Math.max(r * kx * 2.2, 2.2 * n);
    sk.ents.push({ id:SEQ++, ak:hk + '/cx', t:'line', a:{ x:c.x - ex, y:c.y }, b:{ x:c.x + ex, y:c.y }, layer:'中心線', css:null, aci:256, pv:pv, anc:1 });
    sk.ents.push({ id:SEQ++, ak:hk + '/cy', t:'line', a:{ x:c.x, y:c.y - ex }, b:{ x:c.x, y:c.y + ex }, layer:'中心線', css:null, aci:256, pv:pv, anc:1 }); });
  Object.keys(grp).forEach(function(pv){ var G = grp[pv], b = G.b, st = 7 * n, mid = (b.x0 + b.x1) / 2, r1 = function(x){ return Math.round(x * 10) / 10; };
    // 横の 位置：左 半分は 左の 端から・右 半分は 右の 端から（近い 端からの mm）。高さ：右の 外に 下から
    var ux = G.cs.map(function(c){ return r1(c.x); }).filter(function(x, i, A){ return A.indexOf(x) === i; }).sort(function(a, c){ return a - c; });
    // 端に 近い 穴から 1 段目（右 半分は 右の 端から 数える）。同じ 側に 2 本 以上 あれば、入らない 文字を 横へ（kmAncTx）
    var iL = 0, iR = 0, LL = [], LR = [], LV = [];
    ux.filter(function(x){ return x <= mid; }).concat(ux.filter(function(x){ return x > mid; }).reverse()).forEach(function(x){ var left = x <= mid, i = left ? iL++ : iR++, e = left ? b.x0 : b.x1;
      if (Math.abs(x - e) > 0.5) { var d = { id:SEQ++, isoKey:'anc/' + pv + '/' + (left ? 'L' : 'R') + i, a:{ x:e, y:b.y1 }, b:{ x:x, y:b.y1 }, off:{ x:(e + x) / 2, y:b.y1 + st * (1 + i) }, mode:'h', fmt:null, text:null, layer:'寸法', pv:pv, anc:1 }; sk.dims.push(d); (left ? LL : LR).push([d, x - e, i]); } });
    var uy = G.cs.map(function(c){ return r1(c.y); }).filter(function(y, i, A){ return A.indexOf(y) === i; }).sort(function(a, c){ return a - c; });
    uy.forEach(function(y, i){ if (Math.abs(y - b.y0) > 0.5) { var d = { id:SEQ++, isoKey:'anc/' + pv + '/V' + i, a:{ x:b.x1, y:b.y0 }, b:{ x:b.x1, y:y }, off:{ x:b.x1 + st * (1 + i), y:(b.y0 + y) / 2 }, mode:'v', fmt:null, text:null, layer:'寸法', pv:pv, anc:1 }; sk.dims.push(d); LV.push([d, y - b.y0, i]); } });
    [LL, LR, LV].forEach(function(A){ if (A.length > 1) A.forEach(function(q){ kmAncTx(q[0], q[1], q[2], sk.ds, n); }); });
    var c0 = G.cs.slice().sort(function(a, c){ return a.x - c.x; })[0], ty = b.y1 + st * (Math.max(iL, iR) + 1.6), j = 0;
    Object.keys(G.txt).forEach(function(key){ var q = key.split('|'), s = q[0] + ' ×' + G.txt[key] + '（' + q[1] + '）', p = { x:Math.max(b.x0, c0.x - 4 * n), y:ty + j * 4 * n };
      // 引出線：文字（ak …/t j）を 動かすと 文字側の 端が ついて 行く（lt・v0.9.99 本人「この 線を 直したのに 保存して 開くと 元に 戻る」）
      sk.ents.push({ id:SEQ++, ak:'anc/' + pv + '/ld' + j, lt:'anc/' + pv + '/t' + j, t:'line', a:{ x:c0.x, y:c0.y }, b:{ x:p.x + 2 * n, y:p.y - 0.8 * n }, layer:'寸法', css:null, aci:256, pv:pv, anc:1 });
      sk.ents.push({ id:SEQ++, ak:'anc/' + pv + '/t' + j, t:'text', p:p, h:2.4 * n, rot:0, s:s, ha:0, va:0, layer:'文字', css:null, aci:256, pv:pv, anc:1 }); j++; }); });
  return sk; }
// 穴の 位置の 寸法の 文字が 矢印の 間に 入らない とき、文字を 横（寸法線に 沿って）の 外へ ずらす（v0.9.91）
//   2026-11-26 本人「2 つの 穴で 10mm 位置が 違う（151・161）。この 様に 自動で 横に ずらせないか」（見本：151 は 端の 外＝左、161 は 穴の 外＝右）
//   L＝端から 穴（＋は 右・上）、i＝段（端に 近い 方から 0,1,…）。偶数の 段は 端の 外へ、奇数の 段は 穴の 外へ。寸法線は 文字の 下まで 伸びる（dimGeom）
function kmAncTx(d, L, i, ds, n){ var th = ds && ds.th > 0 ? ds.th : 3.5 * n, f = (ds && ds.fmt) || S.fmt, len = Math.abs(L);
  var s = typeof fmtLen === 'function' ? String(fmtLen(len, f)) : String(Math.round(len)), tw = Math.max.apply(null, s.split('\n').map(function(x){ var w = 0; for (var j = 0; j < x.length; j++) w += x.charCodeAt(j) < 256 ? 0.55 : 1; return w; })) * th;
  if (len >= tw + th * 1.6) return d;   // 矢印の 間に 入る
  var sg = L > 0 ? 1 : -1, out = i % 2 === 0 ? -sg : sg;   // 端の 外＝穴と 反対の 向き
  d.tx = out * (len / 2 + tw / 2 + th * 0.6); return d; }
// 図枠の 図の 線・円の 名前（v0.9.99）：作った 線（ak）か 保存した 図の 線の id。立体の 絵（作り直す たびに 変わる）・磨きの 印は 名前なし
function kmEntAid(vid, e, i){ if (e.t === 'text') return vid + '/t' + (e.ak || (e.id != null ? e.id : i)); if (e.ak) return vid + '/g' + e.ak; if (e.iso || e.mg || e.inner || e.sec || e.id == null) return null; return vid + '/g' + e.id; }
// 図枠を 縮尺 そのままで ページに（X＝紙の 左。半分なら 0 か 148.5）。表題欄は 組み立ての 件名・石種で
function kmSheetPut(o, pg, g, X, B){
  var S0 = kmSheetOf(g); if (!S0) return; var fr = S0.fr, sk = kmAncSheet(S0.sk, g, S0.n), n = S0.n, s = 1 / n, k = g.ks[0], p = kmPart(k), T = g.type, vid = T + '/sk';
  var fx0 = Infinity, fx1 = -Infinity, fy0 = Infinity, fy1 = -Infinity; fr.v.forEach(function(q){ fx0 = Math.min(fx0, q.x); fx1 = Math.max(fx1, q.x); fy0 = Math.min(fy0, q.y); fy1 = Math.max(fy1, q.y); });
  var M = function(q){ return P(X + (q.x - fx0) * s, kY((fy1 - q.y) * s)); };
  var inF = function(q){ return q.x >= fx0 - 1e-6 && q.x <= fx1 + 1e-6 && q.y >= fy0 - 1e-6 && q.y <= fy1 + 1e-6; };
  var lay = sk.layers || {}, hidL = function(nm){ var L = lay[nm]; return L && L.on === false; };
  sk.ents.forEach(function(e, i){ if (e.frame || hidL(e.layer)) return;
    var pts = e.t === 'line' ? [e.a, e.b] : e.t === 'pl' ? e.v : e.t === 'text' ? [e.p] : e.c ? [e.c] : []; if (!pts.length || !pts.every(inF)) return;
    var n2 = JSON.parse(JSON.stringify(e)); n2.id = SEQ++; n2.auto = true; n2.vid = vid; n2.aid = kmEntAid(vid, e, i); if (e.lt) n2.fol = { aid:vid + '/t' + e.lt, f:'b' }; delete n2.ak; delete n2.lt; delete n2.pv; delete n2.iso; delete n2.frame;
    if (e.t === 'line') { n2.a = M(e.a); n2.b = M(e.b); } else if (e.t === 'pl') n2.v = e.v.map(function(q){ var m = M(q); return { x:m.x, y:m.y, b:q.b || 0 }; });
    else if (e.t === 'text') { n2.p = M(e.p); n2.h = (e.h || 3.5) * s; } else { n2.c = M(e.c); n2.r = e.r * s; }
    if (/隠れ/.test(e.layer || '')) n2.layer = '隠れ線'; else if (n2.layer !== '文字' && e.t !== 'text' && !/寸法|中心/.test(e.layer || '')) n2.layer = '部材';
    o.ents.push(n2); });
  (sk.dims || []).forEach(function(d, i){ if (![d.a, d.b].every(inF)) return;
    var n2 = JSON.parse(JSON.stringify(d)); n2.id = SEQ++; n2.a = M(d.a); n2.b = M(d.b); n2.off = M(d.off); n2.k = (d.k || 1) * n; n2.th = d.th > 0 ? d.th * s : 3.5; kmDimPaper(n2, d, s, n2.th); kmDsApply(n2, d, s, sk.ds); n2.auto = true; n2.vid = vid; n2.aid = vid + '/d' + (d.isoKey || (d.id != null ? d.id : i)); n2.layer = '寸法'; o.dims.push(n2); });
  var info = (BM && BM.main && BM.main.info) || {}, pay = KM2.pay, nb = g.ks.length;
  var inf = { title:'【加工図面】　' + g.no + '.　' + g.name + (g.sym ? '（左右対称・図は ' + (/_R$/.test(p.key || '') ? '右' : '左') + '）' : ''), ver:pg.skip ? '対象外' : (pg.no || 0) + ' / ' + (pg.tot || 0),
    sub1:g.w + '×' + g.d + '×' + g.h + ' mm　' + g.sai.toFixed(3) + ' × ' + nb + '本 = ' + (g.sai * nb).toFixed(3) + ' 才　' + (g.fin || '') + '　' + kmStoneName(B.stone), sub2:g.kakou || '',
    ken:info.name || pay.name || '', zu:'加工図面（' + B.title + '）', scale:'1/' + n, date:pay.date || '' };
  var dc = sheetDeco(S0.paper, inf);
  dc.lines.forEach(function(l){ kL(o, [X + l[0], l[1]], [X + l[2], l[3]], null, false, '枠'); });
  dc.texts.forEach(function(t){ kT(o, X + t.x, t.y, t.s, t.h, { ha:t.ha || 0, layer:'枠' }); });
  if (S0.paper === 'A4h' && !X) kL(o, [148.5, 0], [148.5, 210], null, false, '枠');
  if (S0.diff.length) { var lockOnly = S0.diff.every(function(d){ return d.lock; });   // 大きさ違いを 赤で（印刷にも 出す。工場へ 黙って 出さない）
    var wt = (lockOnly ? '🔒 加工図面の 鍵の 大きさ：' : '⚠ 大きさ違い：この 図は ') + S0.wdh.map(kmR).join('×') + (lockOnly ? '' : ' で かいた 図') + '　' + kmDiffTxt(S0);
    var we = kT(o, X + dc.area.x0 + 2, dc.area.y0 + 3.2, wt, 2.6, { layer:'枠', aid:vid + '/sizewarn' }); we.css = lockOnly ? '#b45309' : '#d00'; }
  kView(o, vid, n, [[X + dc.area.x0, dc.area.y0], [X + dc.area.x1, dc.area.y1]], {}); pg.regions.push(kmRegion(o, vid));
}
// （前の 形）部材の 図面に 加工図面の 範囲（e.frame）が あれば、その 枠の 中を そのまま 縮めて 入れる
function kmSketch(o, pg, p, X, T, g){
  var sk = p && p.shape && p.shape.sketch; if (!sk || !sk.ents) return false;
  var fr = sk.ents.filter(function(e){ return e.frame && e.t === 'pl'; })[0]; if (!fr) return false;
  if (g && fr.sheet && kmSizeDiff(g, kmSheetWdh(fr)) && !kmSheetUse(g)) return false;   // 図の 大きさが ちがう → 今の 大きさで かく（本人が 使うと した 部材は 使う）
  var fx0 = Infinity, fx1 = -Infinity, fy0 = Infinity, fy1 = -Infinity; fr.v.forEach(function(q){ fx0 = Math.min(fx0, q.x); fx1 = Math.max(fx1, q.x); fy0 = Math.min(fy0, q.y); fy1 = Math.max(fy1, q.y); });
  var area = { x0:X + 3, x1:X + 137.5, y0:36, y1:184 }, n = kmPick(fx1 - fx0, fy1 - fy0, area.x1 - area.x0, area.y1 - area.y0), s = 1 / n;
  var ox = (area.x0 + area.x1) / 2 - (fx1 - fx0) * s / 2, oy = (area.y0 + area.y1) / 2 - (fy1 - fy0) * s / 2;   // 紙（y 下）
  var M = function(q){ return P(ox + (q.x - fx0) * s, kY(oy + (fy1 - q.y) * s)); }, vid = T + '/sk';
  var inF = function(q){ return q.x >= fx0 - 1e-6 && q.x <= fx1 + 1e-6 && q.y >= fy0 - 1e-6 && q.y <= fy1 + 1e-6; };
  var lay = sk.layers || {}, hidL = function(n){ var L = lay[n]; return L && L.on === false; };
  sk.ents.forEach(function(e, i){ if (e.frame || hidL(e.layer)) return;
    var pts = e.t === 'line' ? [e.a, e.b] : e.t === 'pl' ? e.v : e.t === 'text' ? [e.p] : e.c ? [e.c] : []; if (!pts.length || !pts.every(inF)) return;
    var n2 = JSON.parse(JSON.stringify(e)); n2.id = SEQ++; n2.auto = true; n2.vid = vid; n2.aid = kmEntAid(vid, e, i); if (e.lt) n2.fol = { aid:vid + '/t' + e.lt, f:'b' }; delete n2.ak; delete n2.lt; delete n2.pv; delete n2.iso; delete n2.frame;
    if (e.t === 'line') { n2.a = M(e.a); n2.b = M(e.b); } else if (e.t === 'pl') n2.v = e.v.map(function(q){ var m = M(q); return { x:m.x, y:m.y, b:q.b || 0 }; });
    else if (e.t === 'text') { n2.p = M(e.p); n2.h = Math.max(2.2, (e.h || 3.5) * s); } else { n2.c = M(e.c); n2.r = e.r * s; }
    if (/隠れ/.test(e.layer || '')) n2.layer = '隠れ線'; else if (n2.layer !== '文字' && e.t !== 'text' && !/寸法|中心/.test(e.layer || '')) n2.layer = '部材';
    o.ents.push(n2); });
  (sk.dims || []).forEach(function(d, i){ if (![d.a, d.b].every(inF)) return;
    var n2 = JSON.parse(JSON.stringify(d)); n2.id = SEQ++; n2.a = M(d.a); n2.b = M(d.b); n2.off = M(d.off); n2.k = (d.k || 1) * n; n2.th = 2.3; kmDimPaper(n2, d, s, 2.3); kmDsApply(n2, d, s, sk.ds); n2.auto = true; n2.vid = vid; n2.aid = vid + '/d' + (d.isoKey || (d.id != null ? d.id : i)); n2.layer = '寸法'; o.dims.push(n2); });
  var c = [M(P(fx0, fy0)), M(P(fx1, fy1))];
  kView(o, vid, n, [[c[0].x, kY(c[0].y)], [c[1].x, kY(c[1].y)]], {}); pg.regions.push(kmRegion(o, vid));
  kT(o, X + 136, 186, '1/' + n, 2.2, { ha:2, aid:vid + '/scale' });
  return true;
}
// 部材の 図（views）を 今の 大きさに（v0.9.61 2026-11-24 本人「図面化した 腰石後の 穴位置が ずれて いる」）
//   views の 座標は 部材を 作った ときの 大きさ（base）。差し替えた 1515 の 腰石後を 1220 で 使うと、アンカーの 穴（端から mm で 入れる）が
//   base の 座標の まま 1220 の 石に 描かれ (1515−1220)/2＝147.5 左へ ずれて いた。3D と 同じ BZ.scaleViews で 合わせる（穴は fit の 端から mm）
function kmViews(p, W, D, H){ var v = (p && p.shape && p.shape.components && p.shape.components[0] && p.shape.components[0].shape && p.shape.components[0].shape.views) || {}, b = v.base;
  if (!b || !v.front || !window.BZ || !BZ.scaleViews || (Math.abs(b.W - W) < 0.01 && Math.abs(b.D - D) < 0.01 && Math.abs(b.H - H) < 0.01)) return v;
  try { return BZ.scaleViews(v, W, D, H); } catch (e) { return v; } }
// 部材の「加工図面に 出す もの」（部材マスター：drawing.out.mode＝auto・iso・full、top＝天面図も）
function kmOut(k){ var p = kmPart(k); return (p && p.shape && p.shape.drawing && p.shape.drawing.out) || {}; }
function kmSimple(k){ var om = kmOut(k).mode; if (om === 'iso') return true; if (om === 'full') return false; var p = kmPart(k), v = p.shape && p.shape.components && p.shape.components[0] && p.shape.components[0].shape && p.shape.components[0].shape.views;
  if (!v) return KM2.geo[k].tris.length / 9 <= 12;
  var r4 = function(q){ return !q || (q.out && q.out.length === 4); };
  return r4(v.front) && r4(v.side) && r4(v.top) && !(v.front.holes || []).length && !(v.side && ((v.side.holes || []).length || (v.side.cuts || []).length)) && !(v.top && ((v.top.holes || []).length || (v.top.cuts || []).length)); }
// 正面の 穴の 位置の 寸法の 段の 数（見当）：nL＝左に 置く 高さの 段（左右で 高さが 違う とき）、nX＝上の 横の 段（端から 並べる とき）
var KM_HRG = function(){ return (S.fmt === 'both2' ? 2 : 1) * 1.9 * 1.6 + 1.2; };   // 段の 間（紙の mm）
function kmHoleRows(v){ var ys = { l:[], r:[] }, xs = { l:[], r:[] };
  ((v.front && v.front.holes) || []).forEach(function(h){ var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; h.pts.forEach(function(q){ x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); });
    var sd = (x0 + x1) / 2 < 0 ? 'l' : 'r', y = Math.round((y0 + y1) / 2 * 10) / 10, x = Math.round((x0 + x1) / 2 * 10) / 10; if (ys[sd].indexOf(y) < 0) ys[sd].push(y); if (xs[sd].indexOf(x) < 0) xs[sd].push(x); });
  ys.l.sort(); ys.r.sort();
  var nL = !ys.l.length ? 0 : !ys.r.length || ys.l.join() !== ys.r.join() ? ys.l.length : 0;   // 左右で 同じ 高さなら 右に 1 つ（左は 置かない）
  return { nL:nL, nX:Math.max(xs.l.length, xs.r.length) }; }
function kmDetail(o, pg, g, X, B){
  var k = g.ks[0], p = kmPart(k), it = [kmItem(k, false)], T = g.type, W = g.w, D2 = g.d, H = g.h;
  kL(o, [X, 33], [X + 140.5, 33], null, false, '枠');
  kT(o, X + 2, 19, g.no + '.　' + g.name + (g.sym ? '（左右対称・図は ' + (/_R$/.test(p.key || '') ? '右' : '左') + '）' : ''), 2.8, { aid:T + '/h/name' });
  kT(o, X + 2, 23.2, (g.fin || '') + '　　' + (kmStoneName(B.stone) || '（石種）'), 2.4, { aid:T + '/h/fin' });   // 外寸は 出さない（v0.9.89）
  kT(o, X + 2, 27.4, g.sai.toFixed(3) + ' × ' + g.ks.length + '本 = ' + (g.sai * g.ks.length).toFixed(3) + ' 才', 2.4);
  if (g.kakou) { kT(o, X + 60, 23.2, g.kakou.slice(0, 34), 2.1, { aid:T + '/h/kakou1' }); if (g.kakou.length > 34) kT(o, X + 60, 27.4, g.kakou.slice(34, 68), 2.1, { aid:T + '/h/kakou2' }); }
  if (kmSketch(o, pg, p, X, T, g)) return;
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
  var v = kmViews(p, W, D2, H), hasL = ((v.side && v.side.holes) || []).some(function(h){ return h.from === 'left'; });
  var needTop = !!(kmOut(k).top || (v.top && (((v.top.holes || []).length) || ((v.top.cuts || []).length))) || (v.side && (v.side.cuts || []).length));
  var rot = needTop && D2 > 2.5 * W;
  var area = { x0:X + 4, x1:X + 138, y0:106, y1:186 }, needW = W + D2 + (hasL ? D2 : 0), needH = H + (needTop ? (rot ? W : D2) : 0);
  var HR = kmHoleRows(v), xL = HR.nL ? HR.nL * KM_HRG() + 1 : 0;   // 左に 穴の 高さの 寸法を 置く ぶん 空ける（全体の 高さは その 外）
  var m = kmPick(needW, needH, (area.x1 - area.x0) - 34 - (hasL ? 12 : 0) - xL, (area.y1 - area.y0) - 22), t = 1 / m;
  var rf = kmHlr(it, 'front', t), rr = kmHlr(it, 'right', t), rt = needTop ? kmHlr(it, rot ? 'topR' : 'top', t) : null, rl = hasL ? kmHlr(it, 'left', t) : null;
  var gap = 12, fx = area.x0 + 12 + xL + (hasL ? D2 * t + gap : 0), fyb = area.y1 - 12;
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
      // 小さい 穴（紙で 径 2mm 未満）は 円で（点線に すると 崩れて 見える ので 実線）。大きい 穴は 形の まま・向こう 側は 点線
      if (Math.max(h.phi, h.hh) * t < 2) kC(o, c[0], c[1], Math.max(h.phi * t / 2, 0.5), vid); else kPl(o, h.pts.map(function(q){ return MM([q[0] * t, q[1] * t]); }), vid, h.far); });
    // 穴の 中心線（一点鎖線の 十字。穴から 2mm はみ出す）。位置の 寸法は この 中心線の 端から はかる（v0.9.57 本人「中心線を 使って 寸法線を」）
    var cl = {}; hs.forEach(function(h){ var c = feat[h.id], e = Math.max(h.phi, h.hh) * t / 2 + 2; cl[h.id] = e;
      kL(o, [c[0] - e, c[1]], [c[0] + e, c[1]], vid, false, '中心線'); kL(o, [c[0], c[1] - e], [c[0], c[1] + e], vid, false, '中心線'); });
    kView(o, vid, m, [MM([-L / 2 * t, (vw === 'top' ? -Hh / 2 : 0) * t]), MM([L / 2 * t, (vw === 'top' ? Hh / 2 : Hh) * t])], feat); pg.regions.push(kmRegion(o, vid));
    var yb = vw === 'top' ? -Hh / 2 : 0, yt = vw === 'top' ? Hh / 2 : Hh, sideL = vw === 'front' && HR.nL > 0, rg = KM_HRG();
    kD(o, MM([-L / 2 * t, yb * t]), MM([L / 2 * t, yb * t]), [0, 1], 4, m, vid + '/w', vid, { h:2.2 });
    if (vw === 'front') kD(o, MM([-L / 2 * t, 0]), MM([-L / 2 * t, Hh * t]), [-1, 0], sideL ? 4 + xL : 4, m, vid + '/h', vid, { h:2.2 });
    if (vw === 'top') kD(o, MM([L / 2 * t, yb * t]), MM([L / 2 * t, yt * t]), [1, 0], 4, m, vid + '/d', vid, { h:2.2 });
    if (!hs.length) return;
    // 文字が 間に 入らない とき：端の 間は 外へ・中の 間は 広い 隣へ（tx）
    var twOf = function(dm){ var ln = String(dimGeom(dm).text.s).split('\n'); return Math.max.apply(null, ln.map(function(x){ var w = 0; for (var i = 0; i < x.length; i++) w += x.charCodeAt(i) < 256 ? 0.55 : 1; return w; })) * dm.th + dm.th * 0.6; };
    var fits = function(dm, L0){ return L0 >= twOf(dm) + dm.th * 0.6; };
    var shove = function(dm, L0, sg){ dm.tx = sg * (L0 / 2 + twOf(dm) / 2 + dm.th * 0.3); };
    // 中心線の 端（寸法の 補助線は ここから）：縦の 中心線の 上の 端・横の 中心線の 左／右の 端
    var clTop = function(h){ var c = feat[h.id]; return [c[0], c[1] - cl[h.id]]; }, clSide = function(h, sg){ var c = feat[h.id]; return [c[0] + sg * cl[h.id], c[1]]; };
    var r1 = function(x){ return Math.round(x * 10) / 10; }, topY = MM([0, yt * t])[1], botY = MM([0, yb * t])[1], lx = MM([-L / 2 * t, 0])[0], rx = MM([L / 2 * t, 0])[0];
    // 穴の 位置（横）：上に 左の 端 → 中心線 → … → 右の 端 の 連なり。文字が 入らない 間が あれば、左 半分の 穴は 左の 端から・右 半分は 右の 端から（段を 重ねる）
    var us = []; hs.forEach(function(h){ var u = r1(h.u), x = us.filter(function(x){ return Math.abs(x.u - u) < 0.05; })[0]; if (!x) us.push({ u:u, h:h }); else if (h.y > x.h.y) x.h = h; });
    us.sort(function(a, b){ return a.u - b.u; });
    var hxRow = function(i){ return topY - 3.5 - i * rg; }, ptX = [[-L / 2, [lx, topY]]].concat(us.map(function(x){ return [x.u, clTop(x.h)]; }), [[L / 2, [rx, topY]]]), rowsX = 1;
    var chainX = ptX.slice(0, -1).map(function(q, i){ var A = q, B2 = ptX[i + 1]; if ((B2[0] - A[0]) * m < 0.5) return null; var dm = kD(o, A[1], B2[1], [0, -1], 0, m, vid + '/hx/' + i, vid, { h:1.9, dec:1, mode:'h' }); o.dims.pop(); dm.off = P(dm.off.x, kY(hxRow(0))); dm._L = (B2[0] - A[0]) * t; return dm; }).filter(Boolean);
    if (chainX.every(function(dm){ return fits(dm, dm._L); }) || us.length < 2) chainX.forEach(function(dm, i){ if (!fits(dm, dm._L)) shove(dm, dm._L, i === 0 ? -1 : 1); delete dm._L; o.dims.push(dm); });
    else { var lft = us.filter(function(x){ return x.u < 0; }), rgt = us.filter(function(x){ return x.u >= 0; }).reverse();
      [[lft, -1, lx], [rgt, 1, rx]].forEach(function(sd){ sd[0].forEach(function(x, i){ var L0 = Math.abs(x.u - sd[1] * L / 2) * t, dm = kD(o, [sd[2], topY], clTop(x.h), [0, -1], 0, m, vid + '/hx' + (sd[1] < 0 ? 'L/' : 'R/') + i, vid, { h:1.9, dec:1, mode:'h' });
        dm.off = P(dm.off.x, kY(hxRow(i))); if (!fits(dm, L0)) shove(dm, L0, sd[1]); }); rowsX = Math.max(rowsX, sd[0].length); }); }
    // 穴の 位置（縦）：下の 端 → 中心線 → … の 連なり（入らなければ 下の 端から 段を 重ねる）。正面で 左右の 高さが 違えば 左 半分の 穴は 左に。同じなら 右に 1 つ
    if (vw !== 'top') {
      var ysOf = function(list, sg){ var ys = []; list.forEach(function(h){ var yy = r1(h.y), x = ys.filter(function(x){ return Math.abs(x.y - yy) < 0.05; })[0]; if (!x) ys.push({ y:yy, h:h }); else if (sg * (h.u - x.h.u) > 0) x.h = h; }); return ys.sort(function(a, b){ return a.y - b.y; }); };
      var sides = [];
      if (sideL) { var hl = hs.filter(function(h){ return h.u < 0; }), hr = hs.filter(function(h){ return h.u >= 0; }); sides.push([-1, ysOf(hl, -1)]); if (hr.length) sides.push([1, ysOf(hr, 1)]); }
      else sides.push([1, ysOf(hs, 1)]);
      sides.forEach(function(sd){ var sg = sd[0], ys = sd[1], ex = sg < 0 ? lx : rx, row = function(i){ return ex + sg * (3 + i * rg); };
        var pts = [[0, [ex, botY]]].concat(ys.map(function(x){ return [x.y, clSide(x.h, sg)]; }));
        var ch = pts.slice(0, -1).map(function(q, i){ var B2 = pts[i + 1]; if ((B2[0] - q[0]) * m < 0.5) return null; var dm = kD(o, q[1], B2[1], [sg, 0], 0, m, vid + (sg < 0 ? '/hyL/' : '/hy/') + i, vid, { h:1.9, mode:'v' }); o.dims.pop(); dm.off = P(row(0), dm.off.y); dm._L = (B2[0] - q[0]) * t; return dm; }).filter(Boolean);
        if (ch.every(function(dm){ return fits(dm, dm._L); }) || ys.length < 2) ch.forEach(function(dm, i){ if (!fits(dm, dm._L)) shove(dm, dm._L, i === ch.length - 1 ? 1 : -1); delete dm._L; o.dims.push(dm); });
        else ys.forEach(function(x, i){ var L0 = x.y * t, dm = kD(o, [ex, botY], clSide(x.h, sg), [sg, 0], 0, m, vid + (sg < 0 ? '/hyL' : '/hyB') + '/' + i, vid, { h:1.9, mode:'v' }); dm.off = P(row(i), dm.off.y); if (!fits(dm, L0)) shove(dm, L0, 1); });
      });
    }
    var grp = {}; hs.forEach(function(h){ var key = Math.round(h.phi) + 'x' + Math.round(h.hh) + 'd' + h.depth + h.from; (grp[key] = grp[key] || []).push(h); });
    Object.keys(grp).forEach(function(key, gi){ var g2 = grp[key], h0 = g2[0], c = MM([h0.u * t, h0.y * t]), top = MM([0, yt * t])[1], lp = [c[0] + 4, hxRow(rowsX - 1) - rg - 2.5 - gi * 3.6];
      // 穴の 大きさ・深さは mm（ほかの 寸法は 尺寸も 書く ので まぎれない ように「mm」を 付ける。v0.9.57 本人）
      var txt = (Math.abs(h0.phi - h0.hh) < 1 && h0.pts.length <= 40 ? 'Φ' + Math.round(h0.phi) + 'mm' : '穴 ' + Math.round(h0.phi) + '×' + Math.round(h0.hh) + 'mm') + ' 深' + h0.depth + 'mm ×' + g2.length + '（' + h0.from + '）';
      var ta = vid + '/hole/' + key;   // 引出線にも 名前・文字を 動かすと ついて 行く（v0.9.99）
      kL(o, c, lp, vid, false, '文字', { aid:ta + '/l1', fol:{ aid:ta, f:'b' } }); kL(o, lp, [lp[0] + txt.length * 1.75, lp[1]], vid, false, '文字', { aid:ta + '/l2', fol:{ aid:ta, f:'ab' } }); kT(o, lp[0] + 0.5, lp[1] - 0.7, txt, 1.9, { vid:vid, aid:ta }); });
  });
  var lb = function(txt, q, vid){ kT(o, q[0], q[1], txt, 2, { ha:1, vid:vid, aid:vid + '/name' }); };
  lb('正面', [Mf([0, 0])[0], fyb + 9], T + '/front'); lb('右側面', [Mr([0, 0])[0], fyb + 9], T + '/right'); if (rl) lb('左側面', [Ml([0, 0])[0], fyb + 9], T + '/left');
  if (rt) { if (rot) lb('平面（回して いる。左が 前）', [MtR([0, 0])[0], MtR([0, 0])[1] - W / 2 * t - 2.5], T + '/top'); else lb('平面', [Mt([0, 0])[0] - W / 2 * t - 6, Mt([0, 0])[1]], T + '/top'); }
  kT(o, X + 136, 186, '1/' + m, 2.2, { ha:2, aid:T + '/ortho/scale' });
}

// ── 直しを 当てる ──
function kmShiftItem(it, dx, dy){ ['a', 'b', 'c', 'p', 'off'].forEach(function(f){ if (it[f]) it[f] = P(it[f].x + dx, it[f].y + dy); }); if (it.v) it.v = it.v.map(function(q){ return { x:q.x + dx, y:q.y + dy, b:q.b }; }); }
var KM_DF = ['text', 'th', 'al', 'at', 'fmt', 'dec', 'tx'];
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
  o.dims.forEach(function(d){ if (!d.aid) return; pg.base[d.aid] = { vid:d.vid, a:kCp(d.a), b:kCp(d.b), off:kCp(d.off), text:d.text, th:d.th, al:d.al, at:d.at, fmt:d.fmt, dec:d.dec, tx:d.tx };
    var ov = ovOf(d.aid); if (!ov) return; if (ov.hide) { d._hide = 1; return; }
    // 文字の ずらし（tx）：前は 基準に tx が 無く、紙に 縮める 前の 値（図面の mm）が 手の 直しとして 残って いた → 縮めた 値の 縮尺 倍・同じ 値は 直しで ない（2026-11-25 本人「35 の 寸法が 再現されない」）
    if (ov.tx != null && d.tx && (Math.abs(ov.tx - d.tx * (d.k || 1)) < 0.05 || Math.abs(ov.tx - d.tx) < 0.005)) { ov = Object.assign({}, ov); delete ov.tx; }
    if (ov.doff) d.off = P(d.off.x + ov.doff[0], d.off.y + ov.doff[1]); if (ov.da) d.a = P(d.a.x + ov.da[0], d.a.y + ov.da[1]); if (ov.db) d.b = P(d.b.x + ov.db[0], d.b.y + ov.db[1]);
    KM_DF.forEach(function(f){ if (ov[f] !== undefined) d[f] = ov[f]; }); });
  o.dims = o.dims.filter(function(d){ return !d._hide; });
  var tdp = {};
  o.ents.forEach(function(e){ if (!e.aid || e.t !== 'text') return; pg.base[e.aid] = { vid:e.vid, p:kCp(e.p), s:e.s, h:e.h }; var ov = ovOf(e.aid); if (!ov) return; if (ov.hide) { e._hide = 1; return; }
    if (ov.dp) { e.p = P(e.p.x + ov.dp[0], e.p.y + ov.dp[1]); tdp[e.aid] = ov.dp; } if (ov.s !== undefined) e.s = ov.s; if (ov.h) e.h = ov.h; });
  // 線・円・折れ線（v0.9.99 本人「この 選んだ 線を 変更したのに 保存して 開くと 元に 戻る」＝自動の 線は 直しを 覚えて いなかった）
  //   引出線（fol）は 先に 文字の ずらしに ついて 行かせ、それを 基準に する（手の 直しは その 上の ずれ）
  o.ents.forEach(function(e){ if (!e.aid || e.t === 'text') return;
    var a0 = kCp(e.a), b0 = kCp(e.b), fd = e.fol && tdp[e.fol.aid]; if (fd) { if (e.b) e.b = P(e.b.x + fd[0], e.b.y + fd[1]); if (e.fol.f === 'ab' && e.a) e.a = P(e.a.x + fd[0], e.a.y + fd[1]); }
    pg.base[e.aid] = { vid:e.vid, g:1, a:kCp(e.a), b:kCp(e.b), c:kCp(e.c), r:e.r, v:e.v ? e.v.map(function(q){ return [q.x, q.y]; }) : null, fol:e.fol || null, a0:a0, b0:b0 };
    var ov = ovOf(e.aid); if (!ov) return; pg.base[e.aid].oa = ov.da || null; pg.base[e.aid].ob = ov.db || null; if (ov.hide) { e._hide = 1; return; }
    if (ov.da && e.a) e.a = P(e.a.x + ov.da[0], e.a.y + ov.da[1]); if (ov.db && e.b) e.b = P(e.b.x + ov.db[0], e.b.y + ov.db[1]); if (ov.dc && e.c) e.c = P(e.c.x + ov.dc[0], e.c.y + ov.dc[1]);
    if (ov.r != null && e.r != null) e.r = ov.r; if (ov.dv && e.v && ov.dv.length === e.v.length) e.v = e.v.map(function(q, i){ return { x:q.x + ov.dv[i][0], y:q.y + ov.dv[i][1], b:q.b || 0 }; }); });
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
    pg.base[aid] = Object.assign({}, b, { a:sh(b.a), b:sh(b.b), off:sh(b.off), p:sh(b.p), c:sh(b.c), a0:sh(b.a0), b0:sh(b.b0), v:b.v ? b.v.map(function(q){ return [q[0] + mv[0], q[1] + mv[1]]; }) : b.v }); });
  var sub = function(q, b){ return [q.x - b.x, q.y - b.y]; }, nz = function(v){ return Math.hypot(v[0], v[1]) > 0.02; };
  var seenAid = {}, tdpNow = {};
  doc.ents.forEach(function(e){ var b = e.auto && e.aid && e.t === 'text' && pg.base[e.aid]; if (b && b.p && e.p) tdpNow[e.aid] = sub(e.p, b.p); });
  doc.dims.forEach(function(d){ if (!d.auto || !d.aid || !pg.base[d.aid]) return; seenAid[d.aid] = 1; var b = pg.base[d.aid], ov = {};
    var doff = sub(d.off, b.off), da = sub(d.a, b.a), db = sub(d.b, b.b);
    if (nz(doff)) ov.doff = doff; if (nz(da)) ov.da = da; if (nz(db)) ov.db = db;
    KM_DF.forEach(function(f){ if ((d[f] == null ? null : d[f]) !== (b[f] == null ? null : b[f])) ov[f] = d[f]; });
    if (Object.keys(ov).length) KMED.ov[d.aid] = ov; else delete KMED.ov[d.aid]; });
  doc.ents.forEach(function(e){ if (!e.auto || !e.aid || !pg.base[e.aid]) return; seenAid[e.aid] = 1; var b = pg.base[e.aid], ov = {};
    if (b.g) { // 線・円・折れ線（v0.9.99）。引出線は 今の 文字の ずらしに ついて 行った 所を 基準に（ついて 行く 分は 直しに 入れない）
      var ra = b.a, rb = b.b; if (b.fol) { var fd = tdpNow[b.fol.aid] || [0, 0], shf = function(q){ return q ? P(q.x + fd[0], q.y + fd[1]) : q; }; rb = shf(b.b0); ra = b.fol.f === 'ab' ? shf(b.a0) : b.a0; }
      //   さわって いない 端（当てた 所の まま）は 前の 直しの まま（文字だけ 動かした ときに 線を 戻した と 見ない）
      var same = function(q, base, o){ if (!q || !base) return false; var x = base.x + (o ? o[0] : 0), y = base.y + (o ? o[1] : 0); return Math.abs(q.x - x) < 0.02 && Math.abs(q.y - y) < 0.02; };
      if (b.fol && same(e.a, b.a, b.oa)) { if (b.oa) ov.da = b.oa; } else if (e.a && ra) { var da2 = sub(e.a, ra); if (nz(da2)) ov.da = da2; }
      if (b.fol && same(e.b, b.b, b.ob)) { if (b.ob) ov.db = b.ob; } else if (e.b && rb) { var db2 = sub(e.b, rb); if (nz(db2)) ov.db = db2; }
      if (e.c && b.c) { var dc2 = sub(e.c, b.c); if (nz(dc2)) ov.dc = dc2; } if (e.r != null && b.r != null && Math.abs(e.r - b.r) > 0.01) ov.r = e.r;
      if (e.v && b.v && e.v.length === b.v.length) { var dv = e.v.map(function(q, i){ return [q.x - b.v[i][0], q.y - b.v[i][1]]; }); if (dv.some(nz)) ov.dv = dv; }
      if (Object.keys(ov).length) KMED.ov[e.aid] = ov; else delete KMED.ov[e.aid]; return; }
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
function kmSaveEd(){ if (!KMED || !KM2) return; KMED.payT = KM2.pay.t; kmLs('zumen.kmEdit', KMED); if (BM && BM.main) BM.main.kmEdit = KMED; if (typeof zcPush === 'function') try { zcPush(); } catch (e) {} }   // v0.9.92 モデリングにも

// ── ページの 一覧・作り直し ──
function kmPagesDef(){
  var one = KM2.pay.only === 'detail';
  KM2.sheetDiff = []; KM2.sheetCache = {};   // 保存した 加工図面が 大きさ違いの 部材（右の 欄・ページの 名前に ⚠）   // 部材マスターの［📄 加工図面］：この 部材の 部品詳細図 だけ
  var L = one ? [] : [{ key:'site/iso', gen:'siteIso', title:'配置図 斜め' }, { key:'site/3v', gen:'site3', title:'配置図 三面' }];
  KM2.bundles.forEach(function(B){
    if (!one) { L.push({ key:B.id + '/table', gen:'table', title:B.title + ' 部品寸法表', B:B });
      L.push({ key:B.id + '/index', gen:'index', title:B.title + ' 加工指示図', B:B }); }
    // 図枠の ある 部材：A4 横は 1 枚・A4 横の 半分は 2 つで 1 枚。図枠の 無い 部材は 今まで どおり 2 つで 1 枚
    var plain = [], half = [], full = [];
    B.groups.forEach(function(g){ var S = kmSheetInfo(g), sh = kmSheetUse(g, S); (sh ? (sh.paper === 'A4h' ? half : full) : plain).push(g);
      if (S && S.diff.length && !S.diff.every(function(d){ return d.lock; })) KM2.sheetDiff.push({ type:g.type, no:g.no, name:g.name, g:g, S:S, used:!!sh }); });
    var warn = function(){ return ''; };   // v0.9.81 本人「マスターに 対して 寸法変更して 図面化は 普通。エラーの 様な 表示は 不要」
  var put = function(list, step, sheet){ for (var i = 0; i < list.length; i += step) { var gs = list.slice(i, i + step); L.push({ key:B.id + '/detail/' + gs.map(function(g){ return g.type; }).join('+'), gen:'detail', title:warn(gs) + B.title + ' 詳細 ' + gs.map(function(g){ return g.no; }).join('・'), B:B, groups:gs, sheet:sheet }); } };
    put(plain, 2, false); put(half, 2, true); put(full, 1, true);
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
  BM.pages = defs.map(function(d, i){ return { key:d.key, gen:d.gen, title:d.title, kind:'km', B:d.B, groups:d.groups, sheet:d.sheet, no:i + 1, tot:defs.length, N:1, doc:bmNewDoc() }; });
  kmNumber();
  BM.pages.forEach(function(pg){ kmRegen(pg); });
  KM2.lost = []; BM.pages.forEach(function(pg){ KM2.lost = KM2.lost.concat(pg.lost || []); });
  // 図が どこにも 無い 手の 直し
  var have = {}; BM.pages.forEach(function(pg){ Object.keys(pg.vw).forEach(function(v){ have[v] = 1; }); have['pg:' + pg.key] = 1; });
  Object.keys(KMED.man).forEach(function(k){ if (!have[k] && KMED.man[k].length) KM2.lost.push({ pg:k, what:'手で 足した もの ' + KMED.man[k].length + ' 個（図が 無い）' }); });
  // 自動の 寸法・文字の 直しで どの ページにも 当たらない もの（v0.9.95：前は 黙って 外れて いた。ページの 名前が 変わった とき など）
  var inB = {}, got = {}; BM.pages.forEach(function(pg){ Object.keys(pg.base || {}).forEach(function(a){ inB[a] = 1; }); }); KM2.lost.forEach(function(q){ if (q.aid) got[q.aid] = 1; });
  Object.keys(KMED.ov).forEach(function(a){ if (!inB[a] && !got[a]) KM2.lost.push({ aid:a, pg:'', what:KMED.ov[a].hide ? '消した 寸法・文字' : '自動の 寸法・文字の 直し' }); });
}

// ── 対象外の ページ（v0.9.64・本人「石塔は 再利用し、土留だけ 作る ときに 使う」）──
// 対象外の ページは PDF・印刷に 出さない。ページ番号（n / 全）は 出す ページ だけで 数える。
// 覚える 所：KMED.skip[件名][ページの 鍵]（件名＝モデリングの 名前。ほかの お墓に 写らない）→ 端末（zumen.kmEdit）と 作業ファイル・自動保存（BM.main.kmEdit）
function kmSkipMap(){ if (!KMED) return {}; KMED.skip = KMED.skip || {}; var nm = (KM2 && KM2.pay && KM2.pay.name) || ''; return KMED.skip[nm] || {}; }
function kmNumber(){ var m = kmSkipMap(), n = 0, only = KM2 && KM2.pay && KM2.pay.only === 'detail';
  BM.pages.forEach(function(pg){ pg.skip = !only && !!m[pg.key]; });
  var tot = BM.pages.filter(function(pg){ return !pg.skip; }).length;
  BM.pages.forEach(function(pg){ pg.no = pg.skip ? 0 : ++n; pg.tot = tot; }); }
function kmSetSkip(keys, on){
  if (!KMED || !KM2) return; KMED.skip = KMED.skip || {}; var nm = KM2.pay.name || '', m = KMED.skip[nm] = KMED.skip[nm] || {};
  keys.forEach(function(k){ if (on) m[k] = 1; else delete m[k]; }); if (!Object.keys(m).length) delete KMED.skip[nm];
  BM.pages.forEach(kmHarvest); kmNumber(); BM.pages.forEach(function(pg){ kmRegen(pg); });   // 番号が 変わる ので 全部の ページを 作り直す（手の 直しは 当て直し）
  kmSaveEd(); D = BM.pages[BM.cur].doc; VER++; changed(); bmPages(); bmPanel(); redraw();
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
  if (!pay) { alert(SKP ? 'モデリングに 部材が ありません（部材を 置いて から この タブを 押して ください）' : 'モデリングの 画面で［📐 図面に する］を 押して ください'); return; }
  toastMsg('モデリングの 形から 図面を 作って います…', 8000);
  kmPrepare(pay).then(function(geo){
    var keep = KM2 && BM && BM.active && BM.km ? BM.cur : 0;
    if (KM2 && BM && BM.active && BM.km) BM.pages.forEach(kmHarvest);
    if (typeof zcKmed === 'function') zcKmed();   // v0.9.92 この お墓の モデリングに 入って いる 手の 直し
    KMED = KMED || (BM && BM.main && BM.main.kmEdit) || (D && D.kmEdit) || kmLs('zumen.kmEdit') || {}; ['ov', 'vm', 'man', 'revs'].forEach(function(f){ KMED[f] = KMED[f] || {}; });
    if (!KMED.v) { // v0.8.7 の まちがい：図を 動かすと いっしょに 動かした 寸法が「その 場に 残す」と 覚えられて いた → 消す
      Object.keys(KMED.ov).forEach(function(aid){ var o = KMED.ov[aid], vid = Object.keys(KMED.vm).filter(function(v){ return aid.indexOf(v + '/') === 0; })[0]; if (!vid) return; var m = KMED.vm[vid];
        var bad = function(q){ return !q || (Math.abs(q[0] + m[0]) < 0.6 && Math.abs(q[1] + m[1]) < 0.6); };
        if ((o.doff || o.dp) && bad(o.doff) && bad(o.da) && bad(o.db) && bad(o.dp)) { ['doff', 'da', 'db', 'dp'].forEach(function(f){ delete o[f]; }); if (!Object.keys(o).length) delete KMED.ov[aid]; } });
      KMED.v = 2; }
    KM2 = { pay:pay, geo:geo }; KM2.bundles = kmBundles(pay); kmMigType(KM2.bundles); kmMigBid(KM2.bundles);
    if (!(BM && BM.active)) { BM = { main:D, layers:null, pages:null, cur:0, active:true, km:true }; }
    BM.km = true; bmSetupLayers(); kmLayers();
    if (!BM.main.info) BM.main.info = {}; if (!BM.main.info.name && pay.name) BM.main.info.name = pay.name;
    kmBuildAll(); kmSaveEd();
    document.body.classList.add('bmode'); document.body.classList.add('kmmode');
    bmShow(Math.min(keep, BM.pages.length - 1), true);
    toastMsg(again ? 'モデリングの 今の 形で 作り直しました（手の 直しは 当て直し）' + (KM2.lost.length ? '。当て直せなかった 直し ' + KM2.lost.length + ' 件（上の 一覧）' : '') : '図面を 作りました（' + BM.pages.length + ' ページ）', 6000);
  }).catch(function(e){ alert('図面を 作れませんでした：' + (e && e.message || e)); });
}
function kmLayers(){ var L = BM.layers; if (!L['隠れ線']) L['隠れ線'] = { name:'隠れ線', aci:8, css:'#666', on:true, gap:false, dash:true }; if (!L['中心線']) L['中心線'] = { name:'中心線', aci:1, css:'#c0392b', on:true, gap:false, dash:'dd' }; }
// 右の 欄（組み立てから 作った ページ）
// ── マスター・モデルが 変わった 部材（v0.9.88 本人「自動で 変更せず ラベルを 付けて、更新するか どうかを 決めさせて」）──
// モデリングが 前の 中身の まま 渡し、変わった 部材を pay.pending＝[{ k, name, no, kind:'master'|'model', s }] に 載せる
function kmPendOf(pg){ var P = (KM2 && KM2.pay && KM2.pay.pending) || []; if (!P.length || !pg) return [];
  if (/^site\//.test(pg.key)) return P; var ks = {}; (pg.groups || (pg.B && pg.B.groups) || []).forEach(function(g){ (g.ks || []).forEach(function(k){ ks[k] = 1; }); });
  return P.filter(function(x){ return ks[x.k]; }); }
// 当て直せなかった 手の 直しの 名前（どの 部材・ページか）
function kmLostName(q){ var a = String(q.aid || q.pg || ''), nm = '';
  (KM2.bundles || []).forEach(function(B){ B.groups.forEach(function(g){ if (!nm && (a.indexOf(g.type + '/') === 0 || a.indexOf('/' + g.type) >= 0)) nm = g.no + '. ' + g.name; }); });
  if (!nm) BM.pages.forEach(function(pg){ if (!nm && (a.indexOf(pg.key + '/') === 0 || a === pg.key || a === 'pg:' + pg.key)) nm = pg.title; });
  if (!nm) { var m = /\|([^/]*)\/(table|index|detail)/.exec(a); nm = m ? '前の ページ「' + m[1] + ' ' + ({ table:'部品寸法表', index:'加工指示図', detail:'詳細' })[m[2]] + '」' : a.split('/')[0]; }
  return nm; }
function kmLostBan(){ var L = (KM2 && KM2.lost) || []; if (!L.length || KM2.lostAck) return '';
  var by = {}; L.forEach(function(q){ var n = kmLostName(q), k = n + '｜' + q.what; by[k] = (by[k] || 0) + 1; });
  var ks = Object.keys(by), h = '<div class="r"><b>⚠ 当て直せなかった 手の 直し ' + L.length + ' 件（消して いません。図の 形が 変わった 所など）</b><button data-lost="ok">閉じる</button><button data-lost="del" title="この 直しを 捨てる（戻せません）">捨てる</button></div>';
  h += '<div style="font-weight:600;font-size:12px;padding:0 4px 2px">' + ks.slice(0, 8).map(function(k){ var q = k.split('｜'); return '・' + esc(q[0]) + '：' + esc(q[1]) + (by[k] > 1 ? ' ×' + by[k] : ''); }).join('<br>') + (ks.length > 8 ? '<br>…ほか ' + (ks.length - 8) : '') + '</div>';
  return h; }
function kmLostDrop(){ KM2.lost.forEach(function(q){ if (q.aid) delete KMED.ov[q.aid]; else if (q.pg && KMED.man[q.pg] && !q.m) delete KMED.man[q.pg]; else if (q.m) Object.keys(KMED.man).forEach(function(k){ KMED.man[k] = KMED.man[k].filter(function(x){ return x !== q.m; }); }); }); KM2.lost = []; kmSaveEd(); }
function kmPendBan(){ var el = document.getElementById('kmPend'); if (!el) return; var pg = BM && BM.active && BM.km && BM.pages && BM.pages[BM.cur], P = pg ? kmPendOf(pg) : [], LB = pg ? kmLostBan() : '';
  if ((!P.length || !SKP || !SKP.zmAccept) && !LB) { el.className = ''; el.innerHTML = ''; return; }
  if (!P.length || !SKP || !SKP.zmAccept) P = [];
  var all = (KM2.pay.pending || []).length, h = LB + P.map(function(x){ return '<div class="r"><b>🔄 ' + esc(x.name) + '：' + (x.kind === 'master' ? 'マスターが 変わりました' : 'モデルが 変わりました') + ' <small>（' + esc(x.s) + '）</small></b>'
    + '<button class="go" data-pa="' + esc(x.k) + '">更新する</button><button data-pk="' + esc(x.k) + '">このまま</button></div>'; }).join('');
  if (P.length && all > 1) h += '<div class="r"><b></b><button class="go" data-pa="*">全部 更新する（' + all + '）</button></div>';
  el.innerHTML = h; el.className = 'on';
  [].forEach.call(el.querySelectorAll('[data-lost]'), function(b){ b.onclick = function(){ if (b.dataset.lost === 'del') { if (!confirm('当て直せなかった 手の 直し ' + KM2.lost.length + ' 件を 捨てます（戻せません）')) return; kmLostDrop(); } else KM2.lostAck = 1; kmPendBan(); bmPanel(); }; });
  [].forEach.call(el.querySelectorAll('[data-pa]'), function(b){ b.onclick = function(){ var k = b.dataset.pa; SKP.zmAccept(k === '*' ? null : [k], false); }; });
  [].forEach.call(el.querySelectorAll('[data-pk]'), function(b){ b.onclick = function(){ SKP.zmAccept([b.dataset.pk], true); }; }); }
function kmPanel(el){
  var pg = BM.pages[BM.cur], tpl = kmTpl(), h = '<h3>' + esc(pg.title) + '</h3><div class="bd">';
  h += '<div class="muted">モデリングの 形から 作った ページです。寸法・文字・図は 手で 動かす・直す・消す・足すが できます。<b>直した 所は 覚えて</b>、モデリングを 変えて 作り直しても 当て直します。</div>';
  var fromPd = KM2.pay && KM2.pay.master;
  h += fromPd ? '<div class="row"><button class="b2 pr" id="kmRe">✎ 図面で 直すに 戻る</button></div><div class="muted">この 加工図面は 部材の 図面の 枠の 中です。形・寸法・注記は 図面で 直す ほうで 直して ください</div>' : '<div class="row"><button class="b2" id="kmRe">🔄 モデリングの 今の 形で 作り直す</button></div>';
  h += '<div class="row"><button class="b2" id="kmRev">△ 修正の 印を 置く</button></div>';
  var types = (pg.groups || []).map(function(g){ return g.type; });
  // 保存した 加工図面が モデリングと 大きさ違い（v0.9.59）：何が ちがうかと 使う／使わないの ボタン
  // v0.9.81 本人「日本語の 意味が 分からない。マスターに 対して 寸法変更して 図面化は 普通の ことなので、エラーの 様な 表示は 不要」→ 赤・橙の 枠を やめ、小さな 案内 1 行と ボタン
  (KM2.sheetDiff || []).filter(function(x){ return types.indexOf(x.type) >= 0; }).forEach(function(x){ var S = x.S, src = S.from === 'job' ? 'この 墓の 加工図面' : 'マスターの 加工図面' + (S.ver ? '（版 ' + S.ver + '）' : ''), sz = [x.g.w, x.g.d, x.g.h].map(kmR).join('×');
    h += '<div class="muted" style="margin:6px 0">' + esc(x.no + '. ' + x.name) + '：' + (x.used ? esc(src) + 'を ' + esc(sz) + ' に 合わせて かいて います' : esc(sz) + ' の 自動の 図です')
      + ' <button class="b2" style="padding:1px 6px;font-size:11px" data-kmuse="' + esc(x.type) + '" data-v="' + (x.used ? 'auto' : 'sheet') + '">' + (x.used ? '自動の 図に する' : esc(src) + 'を もとに する') + '</button></div>'; });
  if (SKP && SKP.openMaster && !fromPd) { var seen = {}; (pg.groups || []).forEach(function(g){ var k = g.ks && g.ks[0]; if (!k || seen[g.type]) return; seen[g.type] = 1;   // マスターの 加工図面を 橙の 別タブで（v0.9.88 本人「マスターで 直す ことも あるので 別タブで」）
      h += '<div class="row"><button class="b2" data-kmmst="' + esc(k) + '" title="部材マスターに 登録した この 部材の 加工図面を 橙の［✏ 加工図面］タブで 開く（直して 保存すると マスターが 変わる）">📄 ' + esc(g.no + '. ' + g.name) + '：マスターの 加工図面を 開く</button></div>'; }); }
  if (types.length) { h += '<div class="row"><button class="b2" id="kmTplSave">📌 この ページの 部材の 直しを ひな形に</button></div>';
    var on = types.filter(function(t){ return tpl[t]; }); if (on.length) h += '<div class="muted">ひな形 あり：' + on.map(function(t){ return esc(t.split('/').pop()); }).join('・') + '　<a href="#" id="kmTplDel">ひな形を 消す</a></div>'; }
  h += '<div class="row"><button class="b2" id="kmClr">この ページの 直しを 消す（自動に 戻す）</button></div>';
  var rv = KMED.revs[pg.key] || []; if (rv.length) h += '<div class="muted">修正：' + rv.map(function(q){ return '△' + q.n + ' ' + esc(q.s); }).join('／') + '</div>';
  if (KM2.lost && KM2.lost.length) h += '<div class="muted" style="color:#c03">当て直せなかった 直し ' + KM2.lost.length + ' 件：' + KM2.lost.slice(0, 6).map(function(q){ return esc(kmLostName(q)) + ' ' + esc(q.what); }).join('、') + '　<a href="#" id="kmLostClr">捨てる</a></div>';
  h += '</div>';
  el.innerHTML = h;
  document.getElementById('kmRe').onclick = function(){ if (fromPd) kmBackToPd(); else kmEnter(true); };
  document.getElementById('kmRev').onclick = function(){ setTool('rev'); };
  [].forEach.call(el.querySelectorAll('[data-kmmst]'), function(b){ b.onclick = function(){ if (!SKP.openMaster(b.dataset.kmmst)) alert('モデリングが 見つかりません'); }; });
  [].forEach.call(el.querySelectorAll('[data-kmuse]'), function(b){ b.onclick = function(){ kmUseMap()[b.dataset.kmuse] = b.dataset.v; kmSaveEd(); kmEnter(true); }; });
  document.getElementById('kmClr').onclick = function(){ if (!confirm('この ページの 手の 直し（動かした・消した・足した もの）を 消して 自動に 戻します')) return;
    Object.keys(pg.vw).forEach(function(v){ delete KMED.vm[v]; delete KMED.man[v]; Object.keys(KMED.ov).forEach(function(a){ if (a.indexOf(v + '/') === 0) delete KMED.ov[a]; }); });
    delete KMED.man['pg:' + pg.key]; Object.keys(KMED.ov).forEach(function(a){ if (a.indexOf(pg.key + '/') === 0) delete KMED.ov[a]; });
    pushUndo(); kmRegen(pg); D = pg.doc; kmSaveEd(); changed(); bmPages(); bmPanel(); };
  var ts = document.getElementById('kmTplSave'); if (ts) ts.onclick = function(){ kmHarvest(pg); var T = kmTpl();
    types.forEach(function(t){ var e = { ov:{}, vm:{}, man:{} }; Object.keys(KMED.ov).forEach(function(a){ if (a.indexOf(t + '/') === 0) e.ov[a] = KMED.ov[a]; });
      Object.keys(KMED.vm).forEach(function(v){ if (v.indexOf(t + '/') === 0) e.vm[v] = KMED.vm[v]; }); Object.keys(KMED.man).forEach(function(v){ if (v.indexOf(t + '/') === 0) e.man[v] = KMED.man[v]; }); T[t] = e; });
    kmLs('zumen.kmTpl', T); toastMsg('ひな形に 覚えました（ほかの 案件の 同じ 部材にも 使います）', 4000); bmPanel(); };
  var td = document.getElementById('kmTplDel'); if (td) td.onclick = function(ev){ ev.preventDefault(); var T = kmTpl(); types.forEach(function(t){ delete T[t]; }); kmLs('zumen.kmTpl', T); bmPanel(); };
  var lc = document.getElementById('kmLostClr'); if (lc) lc.onclick = function(ev){ ev.preventDefault(); kmLostDrop(); kmPendBan(); bmPanel(); };
}
// 修正の △：置いた 所に △n、表題欄の 上に 番号・日付・内容
function kmRevAt(p){
  var pg = BM.pages[BM.cur], s = prompt('修正の 内容（表題欄に 出ます）', ''); if (s == null) return;
  var L = KMED.revs[pg.key] = KMED.revs[pg.key] || [], n = L.length + 1, dt = new Date(), ds = dt.getFullYear() + '-' + ('0' + (dt.getMonth() + 1)).slice(-2) + '-' + ('0' + dt.getDate()).slice(-2);
  L.push({ n:n, date:ds, s:s });
  pushUndo(); D.ents.push({ id:SEQ++, t:'text', p:P(p.x, p.y), h:3.2, rot:0, s:'△' + n, ha:1, va:2, wf:1, layer:'文字', css:null, aci:256 });
  kmHarvest(pg); kmRegen(pg); D = pg.doc; kmSaveEd(); changed(); bmPanel();
}

// ── 図面タブ：組み立ての 形の 展開図（2026-11-10 本人「図面タブには 組み立てで 作った モデルの 展開図を 配置して」）──
// 第三角法で 正面図を まん中、上に 平面図、左に 左側面図、右に 右側面図、その 右に 背面図。実寸（mm）で 今の 図面（D）に 入れる（DXF・印刷は いつもの ボタン）
// 線は 画層 展開_外形・展開_隠れ線（破線）、寸法は 寸法、名前は 文字。作り直すと 前の 展開図（tk:1）だけ 消して 描き直す（手で 足した 線・寸法は 残る）
function kmTenkai(pay, geo, opt){
  opt = opt || {}; var keep = KM2; KM2 = { pay:pay, geo:geo };
  try {
    var items = pay.parts.map(function(p){ return kmItem(p.k, true); }), B = pay.parts.map(function(p){ return p.box; });
    var mn = function(f){ return Math.min.apply(null, B.map(f)); }, mx = function(f){ return Math.max.apply(null, B.map(f)); };
    var X0 = mn(function(b){ return b.x0; }), X1 = mx(function(b){ return b.x1; }), Z0 = mn(function(b){ return b.z0; }), Z1 = mx(function(b){ return b.z1; }), Y0 = mn(function(b){ return b.y0; }), Y1 = mx(function(b){ return b.y1; });
    var s = 1 / 20, G = Math.max(250, Math.round(Math.max(X1 - X0, Z1 - Z0) * 0.25 / 50) * 50);
    var LO = layerOf('展開_外形'); LO.aci = 7; LO.css = '#000'; LO.dash = false; LO.gap = false;
    var LH = layerOf('展開_隠れ線'); LH.aci = 8; LH.css = '#808080'; LH.dash = true; LH.gap = false; if (opt.first) LH.on = false;   // 隠れ線は はじめ かくす（画層で 出せる）
    layerOf('寸法'); layerOf('文字');
    D.ents = D.ents.filter(function(e){ return !e.tk; }); D.dims = D.dims.filter(function(d){ return !d.tk; });
    var other = bboxOf(D.ents);   // ほかの 図（開いた DXF など）が あれば その 右に 置く
    var R = {}; ['top', 'front', 'left', 'right', 'back'].forEach(function(v){ R[v] = kmHlr(items, v, s, 10); });
    // 図ごとの ずらし（mm）：紙の u・v（s 倍）→ 図面の x・y
    var at = {}, fr = R.front;
    at.front = [0, 0];
    at.top = [0, fr.v1 / s + G - R.top.v0 / s];
    at.left = [fr.u0 / s - G - R.left.u1 / s, 0];
    at.right = [fr.u1 / s + G - R.right.u0 / s, 0];
    at.back = [R.right.u1 / s + at.right[0] + G - R.back.u0 / s, 0];
    var ln = function(a, b, v, lay){ D.ents.push({ id:SEQ++, t:'line', a:P(a[0] / s + at[v][0], a[1] / s + at[v][1]), b:P(b[0] / s + at[v][0], b[1] / s + at[v][1]), layer:lay, css:null, aci:256, tk:1, tv:v }); };
    Object.keys(R).forEach(function(v){ var r = R[v]; r.vis.forEach(function(g){ ln(g.a, g.b, v, '展開_外形'); }); r.hid.forEach(function(g){ ln(g.a, g.b, v, '展開_隠れ線'); }); });
    var bb = function(v){ var r = R[v], o = at[v]; return { x0:r.u0 / s + o[0], x1:r.u1 / s + o[0], y0:r.v0 / s + o[1], y1:r.v1 / s + o[1] }; };
    var th = Math.max(40, Math.round((X1 - X0) / 22 / 5) * 5), dg = th * 2.2;
    var dim = function(a, b, mode, off){ D.dims.push({ id:SEQ++, a:P(a[0], a[1]), b:P(b[0], b[1]), off:P(off[0], off[1]), mode:mode, fmt:null, text:null, th:th, al:th * 0.9, layer:'寸法', tk:1 }); };
    var name = function(v, s0){ var b = bb(v); D.ents.push({ id:SEQ++, t:'text', p:P((b.x0 + b.x1) / 2, b.y0 - (v === 'top' && typeof rowB !== 'undefined' && rowB ? th * 1.8 * 1.6 : dg) - th * 2.6), h:th * 1.2, rot:0, s:s0, ha:1, va:0, wf:1, layer:'文字', css:null, aci:256, tk:1 }); };
    // 全体の 寸法：正面＝間口・高さ、平面＝間口・奥行、側面＝奥行・高さ、背面＝間口
    var f = bb('front'), t = bb('top'), l = bb('left'), rt = bb('right'), bk = bb('back');
    dim([f.x0, f.y0], [f.x1, f.y0], 'h', [(f.x0 + f.x1) / 2, f.y0 - dg]);
    dim([f.x1, f.y0], [f.x1, f.y1], 'v', [f.x1 + dg, (f.y0 + f.y1) / 2]);
    // 平面図：外柵の 部材寸法と 目地の 連なり（2026-11-10 本人「平面図には 外柵の 部材寸法と 目地寸法も」）。外の 4 辺に 接する 外柵の 石を 辺に 沿って 並べ、石の 長さ・目地を 1 本ずつ。
    // 右は 中（x＝真ん中を 通る 外柵の 石。中仕切など）の 奥行の 連なり。全体の 寸法は その 外側
    var pP = function(x, z){ return [x + at.top[0], -z + at.top[1]]; }, fenB = pay.parts.filter(function(p){ return p.grp === 'fence'; }).map(function(p){ return p.box; });
    var chain = function(list, lo, hi){ var I = list.map(function(q){ return [Math.max(lo, q[0]), Math.min(hi, q[1])]; }).filter(function(q){ return q[1] - q[0] > 0.5; }).sort(function(a, b){ return a[0] - b[0]; }), M = [];
      I.forEach(function(q){ var l = M[M.length - 1]; if (l && q[0] <= l[1] + 0.5) l[1] = Math.max(l[1], q[1]); else M.push([q[0], q[1]]); });
      var pts = [lo]; M.forEach(function(q){ pts.push(q[0], q[1]); }); pts.push(hi); pts = pts.map(function(v){ return Math.round(v * 10) / 10; }).filter(function(v, i, A){ return !i || v - A[i - 1] > 0.5; });
      return pts.length > 2 ? pts : null; };   // 石が 1 つ だけ（全体と 同じ）なら 出さない
    var cdim = function(a, b, mode, off){ D.dims.push({ id:SEQ++, a:P(a[0], a[1]), b:P(b[0], b[1]), off:P(off[0], off[1]), mode:mode, fmt:'mm', text:null, th:th * 0.75, al:th * 0.6, layer:'寸法', tk:1 }); };
    // 連なりの 文字が 重ならない ように：いちばん 長い 寸法の 文字は まん中の まま、両側へ 押し出す（tx＝寸法の 向きに ずらす）
    var spread = function(ds){ if (ds.length < 2 || typeof dimGeom !== 'function') return; var G2 = ds.map(function(d){ var g = dimGeom(d), e = g.e, c = g.mid.x * e.x + g.mid.y * e.y; return { d:d, c:c, p:c, w:String(Math.round(Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y))).length * d.th * 0.75 + d.th * 0.5 }; });
      if (G2[0].c > G2[G2.length - 1].c) G2.reverse();
      var m = 0; G2.forEach(function(q, i){ if (Math.hypot(q.d.b.x - q.d.a.x, q.d.b.y - q.d.a.y) > Math.hypot(G2[m].d.b.x - G2[m].d.a.x, G2[m].d.b.y - G2[m].d.a.y)) m = i; });
      for (var j = m - 1; j >= 0; j--) G2[j].p = Math.min(G2[j].c, G2[j + 1].p - (G2[j].w + G2[j + 1].w) / 2);
      for (j = m + 1; j < G2.length; j++) G2[j].p = Math.max(G2[j].c, G2[j - 1].p + (G2[j].w + G2[j - 1].w) / 2);
      G2.forEach(function(q){ if (Math.abs(q.p - q.c) > 0.01) q.d.tx = q.p - q.c; }); };
    var run = function(pts, mk){ var ds = []; for (var j = 0; j < pts.length - 1; j++) { var q = mk(pts[j], pts[j + 1]); cdim(q[0], q[1], q[2], q[3]); ds.push(D.dims[D.dims.length - 1]); } spread(ds); };
    var tol = 1, rowT = 0, rowL = 0, rowR = 0, rowB = 0, cg = th * 1.8;
    if (fenB.length) {
      var side = function(f){ return fenB.filter(f); };
      var cBack = chain(side(function(b){ return b.z0 <= Z0 + tol; }).map(function(b){ return [b.x0, b.x1]; }), X0, X1);
      var cFront = chain(side(function(b){ return b.z1 >= Z1 - tol; }).map(function(b){ return [b.x0, b.x1]; }), X0, X1);
      var cLeft = chain(side(function(b){ return b.x0 <= X0 + tol; }).map(function(b){ return [b.z0, b.z1]; }), Z0, Z1);
      var cRight = chain(side(function(b){ return b.x1 >= X1 - tol; }).map(function(b){ return [b.z0, b.z1]; }), Z0, Z1);
      var cMid = chain(side(function(b){ return b.x0 < (X0 + X1) / 2 && b.x1 > (X0 + X1) / 2; }).map(function(b){ return [b.z0, b.z1]; }), Z0, Z1);
      var same = function(A, B){ return A && B && A.length === B.length && A.every(function(v, i){ return Math.abs(v - B[i]) < 0.6; }); };
      if (cBack) { run(cBack, function(u, w){ var a1 = pP(u, Z0), b1 = pP(w, Z0); return [a1, b1, 'h', [(a1[0] + b1[0]) / 2, a1[1] + cg]]; }); rowT = 1; }
      if (cFront) { run(cFront, function(u, w){ var a1 = pP(u, Z1), b1 = pP(w, Z1); return [a1, b1, 'h', [(a1[0] + b1[0]) / 2, a1[1] - cg]]; }); rowB = 1; }
      if (cLeft) { run(cLeft, function(u, w){ var a1 = pP(X0, u), b1 = pP(X0, w); return [a1, b1, 'v', [a1[0] - cg, (a1[1] + b1[1]) / 2]]; }); rowL = 1; }
      if (cRight && !same(cRight, cLeft)) { run(cRight, function(u, w){ var a1 = pP(X1, u), b1 = pP(X1, w); return [a1, b1, 'v', [a1[0] + cg, (a1[1] + b1[1]) / 2]]; }); rowR = 1; }
      if (cMid && !same(cMid, cLeft) && !same(cMid, cRight)) { run(cMid, function(u, w){ var a1 = pP(X1, u), b1 = pP(X1, w); return [a1, b1, 'v', [a1[0] + cg * (rowR + 1), (a1[1] + b1[1]) / 2]]; }); rowR++; }
    }
    dim([t.x0, t.y1], [t.x1, t.y1], 'h', [(t.x0 + t.x1) / 2, t.y1 + dg + cg * rowT]);
    dim([t.x0, t.y0], [t.x0, t.y1], 'v', [t.x0 - dg - cg * rowL, (t.y0 + t.y1) / 2]);
    dim([l.x0, l.y0], [l.x1, l.y0], 'h', [(l.x0 + l.x1) / 2, l.y0 - dg]);
    dim([rt.x0, rt.y0], [rt.x1, rt.y0], 'h', [(rt.x0 + rt.x1) / 2, rt.y0 - dg]);
    dim([bk.x0, bk.y0], [bk.x1, bk.y0], 'h', [(bk.x0 + bk.x1) / 2, bk.y0 - dg]);
    // 外柵の 高さ（正面の 左）・石塔の 高さ（右側面の 右）
    var fen = pay.parts.filter(function(p){ return p.grp === 'fence'; }), tw = pay.parts.filter(function(p){ return p.grp === 'tower'; });
    if (fen.length) { var fy1 = Math.max.apply(null, fen.map(function(p){ return p.box.y1; })), fy0 = Math.min.apply(null, fen.map(function(p){ return p.box.y0; }));
      dim([f.x0, fy0 - Y0 + f.y0], [f.x0, fy1 - Y0 + f.y0], 'v', [f.x0 - dg, (fy0 + fy1) / 2 - Y0 + f.y0]); }
    if (tw.length) { var ty0 = Math.min.apply(null, tw.map(function(p){ return p.box.y0; })), ty1 = Math.max.apply(null, tw.map(function(p){ return p.box.y1; }));
      if (ty1 - ty0 < Y1 - Y0 - 1) dim([rt.x1, ty0 - Y0 + rt.y0], [rt.x1, ty1 - Y0 + rt.y0], 'v', [rt.x1 + dg, (ty0 + ty1) / 2 - Y0 + rt.y0]); }
    name('top', '平面図'); name('front', '正面図'); name('left', '左側面図'); name('right', '右側面図'); name('back', '背面図');
    D.ents.push({ id:SEQ++, t:'text', p:P(l.x0, t.y1 + dg + th * 2), h:th * 1.3, rot:0, s:'展開図　' + (pay.name || 'モデリング') + '（' + (pay.date || '') + '）', ha:0, va:0, wf:1, layer:'文字', css:null, aci:256, tk:1 });
    if (isFinite(other.x1)) { var mine = bboxOf(D.ents.filter(function(e){ return e.tk; })), dx = other.x1 + G * 2 - mine.x0, dy = other.y1 - mine.y1;
      D.ents.forEach(function(e){ if (e.tk) transEnt(e, dx, dy); }); D.dims.forEach(function(d){ if (!d.tk) return; ['a', 'b', 'off'].forEach(function(k){ d[k] = P(d[k].x + dx, d[k].y + dy); }); }); }
    return { views:Object.keys(R).length, lines:D.ents.filter(function(e){ return e.tk; }).length };
  } finally { KM2 = keep; }
}

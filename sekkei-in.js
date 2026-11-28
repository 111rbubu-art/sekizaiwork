// sekkei.html（墓石設計の タブの 枠）の 中で 開いた ときの つなぎ（2026-11-10 本人「組み立てと 図面と 加工図面を タブで」）
// ・SKP＝枠の 窓口（SK）。単独で 開いた ときは null で、今までと 同じ 動き
// ・SK_TAB＝この 画面の タブ（'kumi' 'zumen' 'kakou' 'buzai'）
// ・SharePoint：業務アプリの *FromTekkyo は 枠の opener に ある ので、この 画面の opener を それに する
var SKP = (function(){ try { return window.parent !== window && window.parent.SK ? window.parent.SK : null; } catch (e) { return null; } })();
var SK_TAB = SKP ? ((/[?&]sk=([a-z]+)/.exec(location.search) || [])[1] || '') : '';
if (SKP) {
  try { if (!window.opener && window.parent.opener) window.opener = window.parent.opener; } catch (e) {}
  document.documentElement.classList.add('insk');
  if (SK_TAB) document.documentElement.classList.add('sk-' + SK_TAB);
}
// ほかの タブへ（枠の 中なら true。単独なら false を 返すので、呼んだ 側で 今までの window.open を する）
function skGo(tab, hash){ if (!SKP) return false; try { SKP.go(tab, hash || ''); return true; } catch (e) { return false; } }
// 加工図面へ 渡す 部材（zumen.part）：枠の 中なら 枠の 窓口にも 置く（v0.1.1・2026-11-28）
//   本人「マスタータブで 開くと 真っ白」：端末の 保存（localStorage）が いっぱいで zumen.part が 書けず、
//   前に 保存した ときの 印（__back）つきの 古い zumen.part が 残って いて 図面が 何も 開かなかった。枠の 中は 保存に 頼らず 渡す
function skPartPut(d){ if (!SKP) return false; try { SKP.zpart = JSON.stringify(d); return true; } catch (e) { return false; } }
function skPartTake(){ if (!SKP) return null; try { var s = SKP.zpart; SKP.zpart = null; return s ? JSON.parse(s) : null; } catch (e) { return null; } }

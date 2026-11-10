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

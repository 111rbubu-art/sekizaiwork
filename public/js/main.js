/* 庄司石材店 — 最小限のスクリプト（ハンバーガーメニューのみ） */
(function () {
  'use strict';

  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('global-nav');
  if (!toggle || !nav) return;

  function setOpen(open) {
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.setAttribute('aria-label', open ? 'メニューを閉じる' : 'メニューを開く');
    nav.setAttribute('data-open', open ? 'true' : 'false');
  }

  toggle.addEventListener('click', function () {
    setOpen(toggle.getAttribute('aria-expanded') !== 'true');
  });

  // メニュー内のリンクを押したら閉じる
  nav.addEventListener('click', function (e) {
    if (e.target.closest('a')) setOpen(false);
  });

  // Esc で閉じる
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      toggle.focus();
    }
  });

  // PC幅に戻したら状態をリセット
  var mq = window.matchMedia('(min-width: 821px)');
  var onChange = function (e) { if (e.matches) setOpen(false); };
  if (mq.addEventListener) mq.addEventListener('change', onChange);
  else if (mq.addListener) mq.addListener(onChange);

  setOpen(false);
})();

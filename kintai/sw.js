/* ============================================================
   勤怠管理 — Service Worker
   画面の材料だけを保存しておき、圏外でもアプリが開くようにする。
   打刻データそのものは保存せず、送信できなかった打刻は
   localStorage の保留キュー（app.js）で扱う。
   ============================================================ */

var KT_CACHE = 'kintai-v0.6.0';

var KT_SHELL = [
  './',
  './index.html',
  './check.html',
  './import.html',
  './holidays.html',
  './leaveinit.html',
  './config.js',
  './util.js',
  './auth.js',
  './graph.js',
  './geo.js',
  './attendance.js',
  './leave.js',
  './app.js',
  './manifest.json'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(KT_CACHE)
      .then(function (c) { return c.addAll(KT_SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === KT_CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var url = e.request.url;

  // 認証とデータ通信は絶対にキャッシュしない（古い勤怠を見せない）
  if (e.request.method !== 'GET' ||
      url.indexOf('graph.microsoft.com') >= 0 ||
      url.indexOf('login.microsoftonline.com') >= 0) {
    return;
  }

  // 画面の材料はネットワーク優先。取れなければキャッシュで開く。
  e.respondWith(
    fetch(e.request).then(function (res) {
      if (res && res.status === 200 && res.type === 'basic') {
        var copy = res.clone();
        caches.open(KT_CACHE).then(function (c) { c.put(e.request, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(e.request).then(function (hit) {
        return hit || caches.match('./index.html');
      });
    })
  );
});

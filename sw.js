var CACHE = 'sekizai-v5';
var FILES = ['./', './index.html', './index_b.html', './manifest.json'];

self.addEventListener('install', function(e) {
  self.skipWaiting();
  // 1ファイルでも欠けてもinstallが失敗しないよう個別にキャッシュ
  e.waitUntil(
    caches.open(CACHE).then(function(c) {
      return Promise.all(FILES.map(function(f) {
        return c.add(f).catch(function() {});
      }));
    })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(names.filter(function(n) { return n !== CACHE; }).map(function(n) { return caches.delete(n); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  var req = e.request;

  // GET以外は素通し（POST等のAPI書き込みを壊さない）
  if (req.method !== 'GET') return;

  // 外部オリジン（SharePoint / Graph / サムネCDN 等）は横取りせずブラウザに任せる。
  // ※ respondWith を呼ばないことで通常のネットワーク処理になる
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  // 同一オリジンのみ: ネットワーク優先 → 失敗時のみキャッシュにフォールバック。
  // 必ず有効な Response を返す（undefinedを返さない）。
  e.respondWith(
    fetch(req).catch(function() {
      return caches.match(req).then(function(cached) {
        if (cached) return cached;
        return caches.match('./index.html').then(function(fallback) {
          return fallback || new Response('オフラインです', {
            status: 504,
            statusText: 'Gateway Timeout',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        });
      });
    })
  );
});

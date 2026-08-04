/* ============================================================
   勤怠管理 — 位置の取得と現場の判定

   ブラウザは位置情報の利用前に必ず本人の許可を求める（回避不可）。
   ただし許可はサイトごとに一度きりで、二回目以降はダイアログが出ない。
   基地局の番号や電波強度そのものはブラウザからは取得できないため、
   OS が GPS・Wi-Fi・基地局を自動で使い分ける Geolocation API を使う。
   ============================================================ */

/* 位置を取得する。失敗しても reject せず、状態を返す。
   打刻を止めないことが最優先（労働時間の記録欠落を作らないため）。 */
function ktGetLocation() {
  return new Promise(function (resolve) {
    if (!navigator.geolocation) {
      return resolve({ status: '失敗', reason: '非対応の端末' });
    }
    var done = false;
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        if (done) return; done = true;
        var c = pos.coords;
        resolve({
          status:   '取得成功',
          lat:      Math.round(c.latitude  * 1e6) / 1e6,
          lon:      Math.round(c.longitude * 1e6) / 1e6,
          accuracy: Math.round(c.accuracy),
          // 精度から測位手段を推定する（ブラウザは手段を教えてくれない）
          source:   c.accuracy <= 50 ? 'GPS' : 'ネットワーク'
        });
      },
      function (err) {
        if (done) return; done = true;
        resolve({
          status: err.code === 1 ? '拒否'
                : err.code === 3 ? 'タイムアウト' : '失敗',
          reason: err.message || ''
        });
      },
      {
        enableHighAccuracy: KT_GEO.enableHighAccuracy,
        timeout:            KT_GEO.timeoutMs,
        maximumAge:         KT_GEO.maximumAgeMs
      }
    );
  });
}

/* 2地点間の距離（メートル・Haversine） */
function ktDistanceM(lat1, lon1, lat2, lon2) {
  var R = 6371000, rad = function (d) { return d * Math.PI / 180; };
  var dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(rad(lat1)) * Math.cos(rad(lat2)) *
          Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/* 打刻位置がどの登録地点に入るかを判定する。
   測位誤差の分だけ半径を広げて甘めに判定し、屋内で GPS が粗くなった程度では
   「事業所外」にしない。 */
function ktJudgeSite(loc, sites) {
  if (!loc || loc.lat == null) {
    return { name: '位置なし', status: '不明', dist: null, review: '位置情報なし' };
  }
  var best = null;
  (sites || []).forEach(function (s) {
    if (s.Active === false) return;
    if (s.Lat == null || s.Lon == null) return;
    var d = ktDistanceM(loc.lat, loc.lon, +s.Lat, +s.Lon);
    var margin = (+s.RadiusM || KT_GEO.defaultRadiusM) +
                 Math.min(loc.accuracy || 0, KT_GEO.accuracyCapM);
    if (d <= margin && (!best || d < best.dist)) best = { site: s, dist: d };
  });

  var poor = (loc.accuracy || 0) > KT_GEO.poorAccuracyM;
  if (!best) {
    return { name: '事業所外', status: '圏外', dist: null, review: '事業所外で打刻' };
  }
  return {
    name:   best.site.Title,
    status: '圏内',
    dist:   Math.round(best.dist),
    review: poor ? '測位精度が粗い（' + loc.accuracy + 'm）' : ''
  };
}

/* 前回の打刻位置から見て、物理的にありえない移動になっていないか */
function ktCheckTravel(prev, loc, prevAt, nowAt) {
  if (!prev || prev.Lat == null || !loc || loc.lat == null) return '';
  var hours = Math.abs(new Date(nowAt) - new Date(prevAt)) / 3600000;
  if (hours <= 0.02) return '';
  var km = ktDistanceM(+prev.Lat, +prev.Lon, loc.lat, loc.lon) / 1000;
  var kmh = km / hours;
  return kmh > KT_GEO.maxSpeedKmh
    ? '移動異常（前回打刻から時速' + Math.round(kmh) + 'km相当）'
    : '';
}

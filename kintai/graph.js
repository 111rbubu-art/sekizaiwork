/* ============================================================
   勤怠管理 — SharePoint リストの読み書き（Microsoft Graph）
   ============================================================ */

var KT_GRAPH = 'https://graph.microsoft.com/v1.0/sites/' + KT_SITE_ID + '/lists/';

function ktApi(path, opts) {
  return ktGetToken().then(function (token) {
    var o = opts || {};
    var headers = {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json'
    };
    if (o.body) headers['Content-Type'] = 'application/json';
    // インデックス未設定の列で絞り込むために必要
    headers['Prefer'] = 'HonorNonIndexedQueriesWarningMayFailRandomly';
    if (o.headers) Object.keys(o.headers).forEach(function (k) { headers[k] = o.headers[k]; });

    return fetch(path.indexOf('http') === 0 ? path : KT_GRAPH + path, {
      method:  o.method || 'GET',
      headers: headers,
      body:    o.body ? JSON.stringify(o.body) : undefined
    }).then(function (res) {
      if (res.status === 204) return null;
      return res.json().then(function (json) {
        if (!res.ok) {
          var msg = (json && json.error && json.error.message) || ('HTTP ' + res.status);
          var err = new Error(msg);
          err.status = res.status;
          throw err;
        }
        return json;
      });
    });
  });
}

/* 次ページを辿って全件取得する */
function ktFetchAll(url) {
  var acc = [];
  function step(u) {
    return ktApi(u).then(function (json) {
      acc = acc.concat(json.value || []);
      var next = json['@odata.nextLink'];
      return next ? step(next) : acc;
    });
  }
  return step(url);
}

/* リストの項目を取得する。
   listKey … KT_LIST のキー
   filter  … OData の絞り込み式（省略可）。失敗したら全件取得に切り替える。 */
function ktList(listKey, filter) {
  var base = KT_LIST[listKey] + '/items?$expand=fields&$top=999';
  var url  = base + (filter ? '&$filter=' + encodeURIComponent(filter) : '');
  return ktFetchAll(url).then(ktShape).catch(function (e) {
    if (!filter) throw e;
    // 絞り込みが通らない環境（列が未インデックス等）では全件取得に落とす
    return ktFetchAll(base).then(ktShape);
  });
}

/* Graph の応答を扱いやすい形にほぐす。
   createdDateTime と createdBy は SharePoint がサーバ側で付ける値で、
   クライアントからは書き換えられない。これを記録の「正」とする。

   _createdAt … 行が作られたサーバ時刻。改ざん不可。
   _time      … 勤怠の計算に使う時刻。手入力(ManualTime)があればそちら。
   _manual    … 手入力かどうか。画面に印を出し、要確認の対象にする。 */
function ktShape(items) {
  return items.map(function (it) {
    var f = it.fields || {};
    var o = {};
    Object.keys(f).forEach(function (k) { o[k] = f[k]; });
    o._id        = it.id;
    o._createdAt = it.createdDateTime;                                  // サーバ時刻（UTC）
    o._createdBy = ((it.createdBy && it.createdBy.user &&
                    (it.createdBy.user.email || it.createdBy.user.displayName)) || '').toLowerCase();
    var manual   = f.ManualTime ? ktJstToIso(f.ManualTime) : null;
    o._manual    = !!manual;
    o._time      = manual || it.createdDateTime;
    return o;
  });
}

function ktCreate(listKey, fields) {
  return ktApi(KT_LIST[listKey] + '/items', {
    method: 'POST',
    body:   { fields: fields }
  }).then(function (it) {
    var o = ktShape([it])[0];
    return o;
  });
}

function ktUpdate(listKey, itemId, fields) {
  return ktApi(KT_LIST[listKey] + '/items/' + itemId + '/fields', {
    method: 'PATCH',
    body:   fields
  });
}

function ktDelete(listKey, itemId) {
  return ktApi(KT_LIST[listKey] + '/items/' + itemId, { method: 'DELETE' });
}

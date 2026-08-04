/* ============================================================
   勤怠管理 — ログイン（Microsoft 365 / MSAL）
   既存の石材業務管理アプリと同じテナント・同じアプリ登録を使う。
   ============================================================ */

var ktMsal = new msal.PublicClientApplication({
  auth: {
    clientId:    KT_CLIENT_ID,
    authority:   'https://login.microsoftonline.com/' + KT_TENANT_ID,
    // このページ自身のフォルダー。Azure のアプリ登録にこの URI の追加が必要。
    redirectUri: location.origin + location.pathname.replace(/[^/]*$/, '')
  },
  cache: { cacheLocation: 'localStorage' }
});

var KT_SCOPES = [
  'https://graph.microsoft.com/Sites.ReadWrite.All',
  'https://graph.microsoft.com/User.Read'
];

/* アクセストークンを取得する。無音で取れなければポップアップで取り直す。 */
function ktGetToken() {
  var acct = ktMsal.getActiveAccount();
  if (!acct) return Promise.reject(new Error('サインインしていません'));
  var req = { scopes: KT_SCOPES, account: acct };
  return ktMsal.acquireTokenSilent(req)
    .then(function (r) { return r.accessToken; })
    .catch(function () {
      return ktMsal.acquireTokenPopup(req).then(function (r) { return r.accessToken; });
    });
}

function ktLogin()  { ktMsal.loginRedirect({ scopes: KT_SCOPES }); }
function ktLogout() { ktMsal.logoutRedirect(); }

function ktAccount() { return ktMsal.getActiveAccount(); }

/* ログイン中のメールアドレス（社員マスタとの突き合わせキー） */
function ktUserName() {
  var a = ktAccount();
  return a ? (a.username || '').toLowerCase() : '';
}

/* リダイレクト結果を処理し、ログイン済みなら onReady を呼ぶ。 */
function ktInitAuth(onReady, onSignedOut, onError) {
  ktMsal.handleRedirectPromise().then(function (resp) {
    if (resp && resp.account) ktMsal.setActiveAccount(resp.account);
    var accounts = ktMsal.getAllAccounts();
    if (accounts.length > 0) {
      if (!ktMsal.getActiveAccount()) ktMsal.setActiveAccount(accounts[0]);
      onReady();
    } else {
      onSignedOut();
    }
  }).catch(function (e) {
    onError(e);
  });
}

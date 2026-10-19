<?php
/*
 * 戒名・法名彫刻のご確認 — 店側の受け口（さくら / PHP）
 * 業務アプリから 確認ページを 作る・回答を 読む・消す。
 * 合言葉は 同じフォルダーの「.htsecret」に 1 行（外注ポータルと 同じ しくみ。.ht* は 外から 読めない）
 *
 * POST multipart/form-data（毎回 secret と action）
 *   create  case(JSON) grave place proof(画像)
 *           case = {ref, cemetery, graveName, sesyu, phones:[{label, number}], rev, shopTel, shopHours, days}
 *           電話番号は 保存しない（伏せ字と 下4桁だけ 残す）。返り値 {token, url, expires}
 *   status  token        → case・状態・記録（log）・回答（answer）
 *   list                 → 全件の 状態の 一覧
 *   getfile token f      → 画像（grave place proof mark photo_N）
 *   delete  token        → 消す（SharePoint へ 取り込んだ 後）
 */
require __DIR__ . '/lib.php';

$ALLOW_ORIGINS = array(
  'https://111rbubu-art.github.io',
  'http://localhost:8000',
  'http://localhost:8899',
);
$origin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '';
if (in_array($origin, $ALLOW_ORIGINS, true)) {
  header('Access-Control-Allow-Origin: ' . $origin);
  header('Vary: Origin');
  header('Access-Control-Allow-Methods: POST, OPTIONS');
  header('Access-Control-Allow-Headers: Content-Type');
  header('Access-Control-Max-Age: 86400');
}
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$action = isset($_POST['action']) ? $_POST['action'] : '';
if ($action !== 'getfile') header('Content-Type: application/json; charset=UTF-8');
if ($_SERVER['REQUEST_METHOD'] === 'GET') kk_out(array('ok' => true, 'service' => 'kakunin-upload', 'version' => KK_VERSION,
  'limits' => array('upload_max_filesize' => ini_get('upload_max_filesize'), 'post_max_size' => ini_get('post_max_size')),
  'actions' => array('create', 'status', 'list', 'getfile', 'delete')));
if ($_SERVER['REQUEST_METHOD'] !== 'POST') kk_fail('POST only', 405);
if (!count($_POST) && isset($_SERVER['CONTENT_LENGTH']) && intval($_SERVER['CONTENT_LENGTH']) > 0)
  kk_fail('ファイルが大きすぎます（サーバーの受信上限 ' . ini_get('post_max_size') . '）', 413);

$secretFile = __DIR__ . '/.htsecret';
if (!is_file($secretFile)) kk_fail('server not configured (.htsecret missing)', 500);
$expected = trim(file_get_contents($secretFile));
$given = isset($_POST['secret']) ? trim($_POST['secret']) : '';
if ($expected === '' || !hash_equals($expected, $given)) kk_fail('unauthorized', 401);

if (!is_dir(KK_DATA)) mkdir(KK_DATA, 0755, true);
// data/ を 外から 読ませない（.htaccess を 置き忘れても 作る）
if (!is_file(KK_DATA . '/.htaccess')) file_put_contents(KK_DATA . '/.htaccess', "<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n  Order allow,deny\n  Deny from all\n</IfModule>\n");

function base_url(){
  $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https');
  $dir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'])), '/');
  return ($https ? 'https' : 'http') . '://' . $_SERVER['HTTP_HOST'] . $dir . '/';
}
function token_arg(){
  $t = isset($_POST['token']) ? $_POST['token'] : '';
  if (!kk_valid_token($t) || !is_file(kk_dir($t) . '/case.json')) kk_fail('notfound', 404);
  return $t;
}

if ($action === 'create') {
  $in = json_decode(isset($_POST['case']) ? $_POST['case'] : '', true);
  if (!is_array($in)) kk_fail('case が JSON ではありません');
  if (empty($_FILES['proof']) || $_FILES['proof']['error'] !== UPLOAD_ERR_OK) kk_fail('原稿の画像（proof）がありません');
  $phones = array();
  foreach ((isset($in['phones']) ? $in['phones'] : array()) as $p) {
    $h = kk_phone_hint(isset($p['number']) ? $p['number'] : '');
    if ($h) $phones[] = array('label' => mb_substr(isset($p['label']) ? $p['label'] : '電話', 0, 10), 'masked' => $h['masked'], 'tail' => $h['tail']);
  }
  if (!$phones) kk_fail('電話番号がありません（本人確認に使います）');
  $days = max(1, min(90, intval(isset($in['days']) ? $in['days'] : 30)));
  $t = kk_new_token();
  $dir = kk_dir($t);
  mkdir($dir, 0755, true);
  $case = array(
    'ref' => mb_substr(isset($in['ref']) ? (string)$in['ref'] : '', 0, 64),
    'cemetery' => mb_substr(isset($in['cemetery']) ? $in['cemetery'] : '', 0, 50),
    'graveName' => mb_substr(isset($in['graveName']) ? $in['graveName'] : '', 0, 50),
    'sesyu' => mb_substr(isset($in['sesyu']) ? $in['sesyu'] : '', 0, 50),
    'phones' => $phones,
    'rev' => max(0, intval(isset($in['rev']) ? $in['rev'] : 0)),
    'shopTel' => mb_substr(isset($in['shopTel']) ? $in['shopTel'] : '', 0, 20),
    'shopHours' => mb_substr(isset($in['shopHours']) ? $in['shopHours'] : '', 0, 80),
    'created' => kk_now(),
    'expires' => date('Y-m-d H:i:s', time() + $days * 86400),
  );
  foreach (array('grave', 'place', 'proof') as $f) {
    if (empty($_FILES[$f]) || $_FILES[$f]['error'] !== UPLOAD_ERR_OK) continue;
    if (!kk_save_image($_FILES[$f]['tmp_name'], $dir . '/' . $f)) { kk_rmdir($dir); kk_fail($f . ' が画像ではありません'); }
  }
  kk_write($dir . '/case.json', $case);
  kk_write($dir . '/log.json', array());
  kk_log($t, 'create', array('ref' => $case['ref']));
  kk_out(array('ok' => true, 'token' => $t, 'url' => base_url() . '?t=' . $t, 'expires' => $case['expires']));
}

if ($action === 'status') {
  $t = token_arg(); $dir = kk_dir($t);
  $case = kk_read($dir . '/case.json');
  foreach ($case['phones'] as &$p) unset($p['tail']);
  kk_out(array('ok' => true, 'token' => $t, 'status' => kk_status($case), 'case' => $case,
    'log' => kk_read($dir . '/log.json', array()), 'answer' => kk_read($dir . '/answer.json')));
}

if ($action === 'list') {
  $rows = array();
  if (is_dir(KK_DATA)) foreach (scandir(KK_DATA) as $t) {
    if (!kk_valid_token($t)) continue;
    $c = kk_read(kk_dir($t) . '/case.json');
    if (!$c) continue;
    $a = kk_read(kk_dir($t) . '/answer.json');
    $rows[] = array('token' => $t, 'ref' => $c['ref'], 'graveName' => $c['graveName'], 'rev' => $c['rev'],
      'status' => kk_status($c), 'created' => $c['created'], 'expires' => $c['expires'],
      'seenAt' => isset($c['seenAt']) ? $c['seenAt'] : '', 'answeredAt' => isset($c['answeredAt']) ? $c['answeredAt'] : '',
      'result' => $a ? $a['result'] : '');
  }
  kk_out(array('ok' => true, 'items' => $rows));
}

if ($action === 'getfile') {
  $t = token_arg();
  $f = isset($_POST['f']) ? $_POST['f'] : '';
  if (!preg_match('/^(grave|place|proof|mark|photo_\d{1,2})$/', $f)) { header('Content-Type: application/json; charset=UTF-8'); kk_fail('bad file'); }
  $p = kk_find_file(kk_dir($t), $f);
  if (!$p) { header('Content-Type: application/json; charset=UTF-8'); kk_fail('no file', 404); }
  kk_send_file($p);
}

if ($action === 'delete') {
  $t = token_arg();
  kk_rmdir(kk_dir($t));
  kk_out(array('ok' => true));
}

kk_fail('unknown action');

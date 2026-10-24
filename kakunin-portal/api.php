<?php
/*
 * 戒名・法名彫刻のご確認 — お客様側の受け口（さくら / PHP）
 * 同じフォルダーの index.html から呼ぶ（同じオリジンなので CORS は不要）
 *
 *   GET  ?a=hint&t=…              状態・電話番号のヒント・店の電話（開いた記録を残す）
 *   POST a=verify t tail who rel   電話番号の下4桁を確かめ、合えば 鍵 k と お墓・画像の URL を返す
 *                                  （電話番号の無い 確認ページ（v2）は 下4桁なしで 鍵を 返す。お名前は 回答の 時に 書いて もらう）
 *   GET  ?a=img&t=…&k=…&f=grave|place|proof   画像（鍵が要る）
 *   POST a=seen t k                原稿を最後まで見た記録
 *   POST a=answer t k result=ok|ng|grave_ng consent who rel tel placeFix fix callMe nok(ok|fix) nokFix mark(画像) photos[](画像)
 *                                  回答を保存して 締め切る。同じ フォルダーに .htnotify（メールアドレス 1 行）が あれば 回答を メールで 知らせる
 */
require __DIR__ . '/lib.php';
header('X-Robots-Tag: noindex');

$MAX_FAIL = 10;   // 下4桁の間違いが この回数に なったら 止める（店に 電話して もらう）

$a = isset($_REQUEST['a']) ? $_REQUEST['a'] : '';
$t = isset($_REQUEST['t']) ? $_REQUEST['t'] : '';

if ($a !== 'img') header('Content-Type: application/json; charset=UTF-8');
if (!kk_valid_token($t)) kk_fail('notfound', 404);
$dir = kk_dir($t);
$case = kk_read($dir . '/case.json');
if (!$case) kk_fail('notfound', 404);
$status = kk_status($case);

function shop_info($case){
  return array('shopTel' => isset($case['shopTel']) ? $case['shopTel'] : '', 'shopHours' => isset($case['shopHours']) ? $case['shopHours'] : '');
}
// 回答を 店へ メールで 知らせる（.htnotify に アドレス。無ければ 何もしない。お名前・電話は 書かない＝アプリで 見る）
function notify($case, $ans){
  $f = __DIR__ . '/.htnotify';
  if (!is_file($f)) return;
  $to = trim(file_get_contents($f));
  if (!filter_var($to, FILTER_VALIDATE_EMAIL)) return;
  $label = array('ok' => 'この内容で承諾', 'ng' => '訂正あり', 'grave_ng' => 'お墓が違う（彫刻を止めて確認）');
  $res = isset($label[$ans['result']]) ? $label[$ans['result']] : $ans['result'];
  $name = trim($case['cemetery'] . ' ' . $case['graveName']);
  $body = "戒名・法名彫刻のご確認に 回答が ありました。\n\n" . $name . "\n回答：" . $res . "\n日時：" . $ans['at'] .
    "\n\n業務アプリの 納骨・戒切（案件 " . $case['ref'] . "）の［📨 お客様確認］で 内容を 見て、取り込んでください。\n";
  mb_language('Japanese');
  @mb_send_mail($to, '【お客様確認】' . $res . '（' . $name . '）', $body);
}
function check_key($dir){
  $k = isset($_REQUEST['k']) ? $_REQUEST['k'] : '';
  $s = kk_read($dir . '/sess.json', array());
  if ($k === '' || empty($s['keys']) || !in_array($k, $s['keys'], true)) kk_fail('session', 403);
}

if ($a === 'hint') {
  kk_log($t, 'open');
  $phones = array();
  foreach ((isset($case['phones']) ? $case['phones'] : array()) as $p) $phones[] = array('label' => $p['label'], 'masked' => $p['masked']);
  kk_out(array_merge(array('ok' => true, 'status' => $status, 'phones' => $phones, 'needVerify' => count($phones) > 0,
    'rev' => intval(isset($case['rev']) ? $case['rev'] : 0), 'expires' => isset($case['expires']) ? $case['expires'] : '',
    'noukotsu' => isset($case['noukotsu']) ? $case['noukotsu'] : '',
    'noukotsuTime' => isset($case['noukotsuTime']) ? $case['noukotsuTime'] : ''), shop_info($case)));
}

if ($a === 'img') {
  check_key($dir);
  $f = isset($_GET['f']) ? $_GET['f'] : '';
  if (!in_array($f, array('grave', 'place', 'proof'), true)) kk_fail('bad file', 400);
  $p = kk_find_file($dir, $f);
  if (!$p) kk_fail('no file', 404);
  kk_send_file($p);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') kk_fail('POST only', 405);
if ($status !== 'open') kk_out(array('ok' => false, 'error' => $status));

if ($a === 'verify') {
  $tail = isset($_POST['tail']) ? preg_replace('/\D/', '', $_POST['tail']) : '';
  $ok = empty($case['phones']);   // 電話番号の 無い 確認ページは 本人確認なし
  foreach ($case['phones'] as $p) if (strlen($tail) === 4 && hash_equals($p['tail'], $tail)) $ok = true;
  if (!$ok) {
    $case['fails'] = intval(isset($case['fails']) ? $case['fails'] : 0) + 1;
    if ($case['fails'] >= $MAX_FAIL) $case['locked'] = kk_now();
    kk_write($dir . '/case.json', $case);
    kk_log($t, 'verify_ng', array('tail' => $tail));
    kk_out(array('ok' => false, 'error' => empty($case['locked']) ? 'mismatch' : 'locked'));
  }
  $k = bin2hex(random_bytes(16));
  $s = kk_read($dir . '/sess.json', array('keys' => array()));
  $s['keys'][] = $k;
  kk_write($dir . '/sess.json', $s);
  $who = mb_substr(trim(isset($_POST['who']) ? $_POST['who'] : ''), 0, 50);
  $rel = mb_substr(trim(isset($_POST['rel']) ? $_POST['rel'] : ''), 0, 30);
  kk_log($t, empty($case['phones']) ? 'start' : 'verify_ok', array('who' => $who, 'rel' => $rel));
  $img = array();
  foreach (array('grave', 'place', 'proof') as $f) if (kk_find_file($dir, $f)) $img[$f] = 'api.php?a=img&t=' . $t . '&k=' . $k . '&f=' . $f;
  kk_out(array('ok' => true, 'k' => $k, 'img' => $img,
    'cemetery' => $case['cemetery'], 'graveName' => $case['graveName'], 'sesyu' => $case['sesyu']));
}

check_key($dir);

if ($a === 'seen') {
  if (empty($case['seenAt'])) { $case['seenAt'] = kk_now(); kk_write($dir . '/case.json', $case); }
  kk_log($t, 'seen');
  kk_out(array('ok' => true));
}

if ($a === 'answer') {
  $result = isset($_POST['result']) ? $_POST['result'] : '';
  if (!in_array($result, array('ok', 'ng', 'grave_ng'), true)) kk_fail('bad result');
  if ($result === 'ok' && empty($_POST['consent'])) kk_fail('consent required');
  if (empty($case['phones']) && trim(isset($_POST['who']) ? $_POST['who'] : '') === '') kk_fail('name required');
  $ans = array(
    'at' => kk_now(), 'result' => $result,
    'who' => mb_substr(trim(isset($_POST['who']) ? $_POST['who'] : ''), 0, 50),
    'rel' => mb_substr(trim(isset($_POST['rel']) ? $_POST['rel'] : ''), 0, 30),
    'tel' => mb_substr(preg_replace('/[^0-9\-+() ]/', '', isset($_POST['tel']) ? $_POST['tel'] : ''), 0, 20),
    'consent' => !empty($_POST['consent']),
    'consentText' => mb_substr(isset($_POST['consentText']) ? $_POST['consentText'] : '', 0, 300),
    'placeFix' => mb_substr(trim(isset($_POST['placeFix']) ? $_POST['placeFix'] : ''), 0, 2000),
    'fix' => mb_substr(trim(isset($_POST['fix']) ? $_POST['fix'] : ''), 0, 2000),
    'callMe' => !empty($_POST['callMe']),
    'nok' => (isset($_POST['nok']) && in_array($_POST['nok'], array('ok', 'fix'), true)) ? $_POST['nok'] : '',
    'nokFix' => mb_substr(trim(isset($_POST['nokFix']) ? $_POST['nokFix'] : ''), 0, 1000),
    'rev' => intval(isset($case['rev']) ? $case['rev'] : 0),
    'proofSha256' => ($p = kk_find_file($dir, 'proof')) ? hash_file('sha256', $p) : '',
    'seenAt' => isset($case['seenAt']) ? $case['seenAt'] : '',
    'ip' => kk_ip(), 'ua' => kk_ua(), 'files' => array(),
  );
  if (!empty($_FILES['mark']) && $_FILES['mark']['error'] === UPLOAD_ERR_OK) {
    $n = kk_save_image($_FILES['mark']['tmp_name'], $dir . '/mark');
    if ($n) $ans['files'][] = $n;
  }
  if (!empty($_FILES['photos']) && is_array($_FILES['photos']['tmp_name'])) {
    foreach ($_FILES['photos']['tmp_name'] as $i => $tmp) {
      if ($i >= 10 || $_FILES['photos']['error'][$i] !== UPLOAD_ERR_OK) continue;
      $n = kk_save_image($tmp, $dir . '/photo_' . ($i + 1));
      if ($n) $ans['files'][] = $n;
    }
  }
  kk_write($dir . '/answer.json', $ans);
  $case['answeredAt'] = $ans['at'];
  kk_write($dir . '/case.json', $case);
  @unlink($dir . '/sess.json');
  kk_log($t, 'answer', array('result' => $result, 'who' => $ans['who'], 'rel' => $ans['rel']));
  notify($case, $ans);
  kk_out(array('ok' => true, 'at' => $ans['at']));
}

kk_fail('unknown action');

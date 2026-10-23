<?php
/*
 * 戒名・法名彫刻のご確認 — api.php と upload.php の共通部分
 * データは data/<お客様ごとの番号>/ に置く（data/ は .htaccess で外から読めない）
 *   case.json   … 店が作った確認の内容（電話は 下4桁と 伏せ字だけ）
 *   grave.jpg   … お墓の写真　place.jpg … 彫刻する場所の写真　proof.jpg … 拓本＋原稿
 *   log.json    … 開いた・本人確認・最後まで見た・回答 の記録（日時・IP・端末）
 *   answer.json … お客様の回答。mark.jpg（原稿に印）・photo_N.jpg（撮った写真）
 *   sess.json   … 本人確認が通った後の鍵
 */
mb_internal_encoding('UTF-8');
date_default_timezone_set('Asia/Tokyo');

define('KK_DATA', __DIR__ . '/data');
define('KK_VERSION', 2);

function kk_out($arr){ echo json_encode($arr, JSON_UNESCAPED_UNICODE); exit; }
function kk_fail($msg, $code = 400){ http_response_code($code); kk_out(array('ok' => false, 'error' => $msg)); }

// お客様ごとの番号：推測できない 32 文字（16 進）
function kk_new_token(){ return bin2hex(random_bytes(16)); }
function kk_valid_token($t){ return is_string($t) && preg_match('/^[0-9a-f]{32}$/', $t); }
function kk_dir($t){ return KK_DATA . '/' . $t; }

function kk_read($path, $def = null){
  if (!is_file($path)) return $def;
  $j = json_decode(file_get_contents($path), true);
  return is_array($j) ? $j : $def;
}
function kk_write($path, $data){
  $tmp = $path . '.tmp' . getmypid();
  file_put_contents($tmp, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);
  rename($tmp, $path);
}

function kk_ip(){ return isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : ''; }
function kk_ua(){ return isset($_SERVER['HTTP_USER_AGENT']) ? mb_substr($_SERVER['HTTP_USER_AGENT'], 0, 300) : ''; }
function kk_now(){ return date('Y-m-d H:i:s'); }

// 記録を 1 行足す（同時に書かれても消えないように ロックして 足す）
function kk_log($t, $ev, $extra = array()){
  $path = kk_dir($t) . '/log.json';
  $fp = fopen($path, 'c+');
  if (!$fp) return;
  flock($fp, LOCK_EX);
  $raw = stream_get_contents($fp);
  $list = json_decode($raw ? $raw : '[]', true);
  if (!is_array($list)) $list = array();
  $list[] = array_merge(array('at' => kk_now(), 'ev' => $ev, 'ip' => kk_ip(), 'ua' => kk_ua()), $extra);
  ftruncate($fp, 0); rewind($fp);
  fwrite($fp, json_encode($list, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
  fflush($fp); flock($fp, LOCK_UN); fclose($fp);
}

// いまの状態：open（回答待ち）・answered（回答済み）・expired（期限切れ）・locked（番号の間違いが多すぎる）
function kk_status($case){
  if (!empty($case['answeredAt'])) return 'answered';
  if (!empty($case['locked'])) return 'locked';
  if (!empty($case['expires']) && strtotime($case['expires']) < time()) return 'expired';
  return 'open';
}

// 電話番号 → 伏せ字（市外局番などの最初の区切りだけ見せる）と下4桁
function kk_phone_hint($number){
  $n = preg_replace('/[^0-9\-]/', '', (string)$number);
  $digits = preg_replace('/\D/', '', $n);
  if (strlen($digits) < 4) return null;
  $parts = explode('-', $n);
  if (count($parts) >= 3) {
    $masked = $parts[0];
    for ($i = 1; $i < count($parts) - 1; $i++) $masked .= '-' . str_repeat('×', strlen($parts[$i]));
    $masked .= '-○○○○';
  } else {
    $masked = substr($digits, 0, 3) . '-…-○○○○';
  }
  return array('masked' => $masked, 'tail' => substr($digits, -4));
}

function kk_rmdir($dir){
  if (!is_dir($dir)) return;
  foreach (scandir($dir) as $f) {
    if ($f === '.' || $f === '..') continue;
    $p = $dir . '/' . $f;
    is_dir($p) ? kk_rmdir($p) : unlink($p);
  }
  rmdir($dir);
}

// 画像として受け取る（JPEG・PNG・WebP・HEIC）。中身を確かめて 拡張子は こちらで 決める
function kk_save_image($tmp, $destNoExt){
  $info = @getimagesize($tmp);
  $mime = $info ? $info['mime'] : (function_exists('mime_content_type') ? mime_content_type($tmp) : '');
  $ext = array('image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/heic' => 'heic', 'image/heif' => 'heic');
  if (!isset($ext[$mime])) return null;
  $dest = $destNoExt . '.' . $ext[$mime];
  if (!move_uploaded_file($tmp, $dest) && !rename($tmp, $dest)) return null;
  return basename($dest);
}

function kk_find_file($dir, $base){
  foreach (array('jpg', 'png', 'webp', 'heic') as $e) if (is_file("$dir/$base.$e")) return "$dir/$base.$e";
  return null;
}

function kk_send_file($path){
  $mime = array('jpg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp', 'heic' => 'image/heic');
  $e = strtolower(pathinfo($path, PATHINFO_EXTENSION));
  header('Content-Type: ' . (isset($mime[$e]) ? $mime[$e] : 'application/octet-stream'));
  header('Content-Length: ' . filesize($path));
  header('Cache-Control: no-store');
  header('X-Robots-Tag: noindex');
  readfile($path);
  exit;
}

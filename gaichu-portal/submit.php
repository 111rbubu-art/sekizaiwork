<?php
/*
 * 外注先からの報告 受信スクリプト（さくら / PHP）— Phase 3
 * ------------------------------------------------------------------
 * ポータル（index.php）と同じ外注先フォルダーに置く。
 * Basic認証の“中”なので、投稿できるのは認証済みの外注先だけ。
 * 同一オリジンなので CORS も合言葉も不要（庄司→さくらの upload.php とは別物）。
 *
 * 保存先：
 *   cases/<case>/報告/<投稿者名>_<YYYYMMDD>_<連番>.<拡張子>   ← 写真
 *   cases/<case>/comments.json                                  ← コメント
 *
 * アクション（POST）:
 *   list    : {case}                 → 報告写真一覧＋コメント一覧
 *   comment : {case, name, text}     → comments.json に1件追記
 *   upload  : {case, name, file}     → 報告/ に1枚保存
 *   del     : {case, path}           → 報告/ 配下の1ファイル削除
 */

mb_internal_encoding('UTF-8');
$BASE = __DIR__;
$CASES_DIR = $BASE . '/cases';

header('Content-Type: application/json; charset=UTF-8');
function out($a){ echo json_encode($a, JSON_UNESCAPED_UNICODE); exit; }
function fail($m,$c=400){ http_response_code($c); out(array('ok'=>false,'error'=>$m)); }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('POST only', 405);

$IMG_EXT   = array('jpg','jpeg','png','gif','webp','heic','heif');
$ALLOW_EXT = array_merge($IMG_EXT, array('pdf'));

function valid_case($id){ return $id !== '' && preg_match('/^[A-Za-z0-9_-]{1,64}$/', $id); }
function safe_name($s){ $s = str_replace(array("\0","/","\\","..",'"',"'"), '', $s); return trim(preg_replace('/\s+/u',' ',$s)); }

function list_report($caseDir, $IMG_EXT){
  $dir = $caseDir . '/報告'; $out = array();
  if (is_dir($dir)) {
    $names = scandir($dir);
    if ($names) foreach ($names as $f) {
      if ($f === '.' || $f === '..' || substr($f,0,1)==='.') continue;
      if (is_file($dir.'/'.$f)) {
        $ext = strtolower(pathinfo($f, PATHINFO_EXTENSION));
        $out[] = array('rel'=>'報告/'.$f, 'name'=>$f, 'img'=>in_array($ext,$IMG_EXT,true));
      }
    }
  }
  return $out;
}
function load_comments($caseDir){
  $p = $caseDir.'/comments.json';
  if (!is_file($p)) return array();
  $j = json_decode(file_get_contents($p), true);
  return is_array($j) ? $j : array();
}

$action = isset($_POST['action']) ? $_POST['action'] : '';
$case   = isset($_POST['case'])   ? $_POST['case']   : '';
if (!valid_case($case)) fail('invalid case');
$caseDir = $CASES_DIR . '/' . $case;
if (!is_dir($caseDir)) fail('case not found', 404);

// ---- list ----
if ($action === 'list') {
  out(array('ok'=>true, 'photos'=>list_report($caseDir,$IMG_EXT), 'comments'=>load_comments($caseDir)));
}

// ---- comment ----
if ($action === 'comment') {
  $name = safe_name(isset($_POST['name']) ? $_POST['name'] : '');
  $text = trim(isset($_POST['text']) ? $_POST['text'] : '');
  if ($text === '') fail('empty text');
  if (mb_strlen($text) > 2000) $text = mb_substr($text, 0, 2000);
  $c = load_comments($caseDir);
  $c[] = array('name'=>($name!==''?$name:'外注先'), 'at'=>date('Y-m-d H:i'), 'text'=>$text);
  file_put_contents($caseDir.'/comments.json', json_encode($c, JSON_UNESCAPED_UNICODE));
  out(array('ok'=>true));
}

// ---- upload（1枚ずつ）----
if ($action === 'upload') {
  if (!isset($_FILES['file']) || !isset($_FILES['file']['error']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK
      || !is_uploaded_file($_FILES['file']['tmp_name'])) {
    fail('upload error: '.(isset($_FILES['file']['error']) ? $_FILES['file']['error'] : 'no file'));
  }
  $orig = $_FILES['file']['name'];
  $ext  = strtolower(pathinfo($orig, PATHINFO_EXTENSION));
  if (!in_array($ext, $ALLOW_EXT, true)) fail('extension not allowed: '.$ext);
  $name = safe_name(isset($_POST['name']) ? $_POST['name'] : ''); if ($name==='') $name='外注先';
  $repDir = $caseDir.'/報告';
  if (!is_dir($repDir) && !@mkdir($repDir, 0755, true)) fail('cannot create 報告 dir', 500);
  // ファイル名：<名前>_<YYYYMMDD>_<2桁連番>
  $ymd = date('Ymd'); $prefix = $name.'_'.$ymd.'_';
  $n = 0; foreach (scandir($repDir) as $f) { if (strpos($f, $prefix) === 0) $n++; }
  $fname = $prefix . str_pad($n+1, 2, '0', STR_PAD_LEFT) . '.' . $ext;
  if (!@move_uploaded_file($_FILES['file']['tmp_name'], $repDir.'/'.$fname)) fail('save failed', 500);
  out(array('ok'=>true, 'saved'=>$fname));
}

// ---- del（報告/ 配下のみ）----
if ($action === 'del') {
  $rel = isset($_POST['path']) ? str_replace('\\','/', $_POST['path']) : '';
  if ($rel === '' || strpos($rel,'..') !== false || strpos($rel,'報告/') !== 0) fail('invalid path');
  $target = $caseDir.'/'.$rel;
  if (is_file($target)) { @unlink($target); out(array('ok'=>true)); }
  fail('file not found', 404);
}

fail('unknown action');

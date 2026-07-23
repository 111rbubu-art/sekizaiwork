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
// 投稿者名は自動決定（入力不要）：環境変数 GAICHU_NAME →無ければ外注先フォルダー名
function poster_name(){ $n = getenv('GAICHU_NAME'); if ($n !== false && $n !== '') return safe_name($n); return safe_name(basename(__DIR__)); }

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
function load_progress($caseDir){
  $p = $caseDir.'/progress.json';
  if (!is_file($p)) return null;
  $j = json_decode(file_get_contents($p), true);
  return is_array($j) ? $j : null;
}

$action = isset($_POST['action']) ? $_POST['action'] : '';
$case   = isset($_POST['case'])   ? $_POST['case']   : '';
if (!valid_case($case)) fail('invalid case');
$caseDir = $CASES_DIR . '/' . $case;
if (!is_dir($caseDir)) fail('case not found', 404);

// ---- list ----
if ($action === 'list') {
  out(array('ok'=>true, 'photos'=>list_report($caseDir,$IMG_EXT), 'comments'=>load_comments($caseDir), 'progress'=>load_progress($caseDir)));
}

// ---- progress（完了報告：外注先が完了日を登録／取消）----
if ($action === 'progress') {
  $p = $caseDir.'/progress.json';
  $done = isset($_POST['done']) ? $_POST['done'] : '1';
  if ($done === '0') { @unlink($p); out(array('ok'=>true, 'progress'=>null)); }
  $date = isset($_POST['date']) ? trim($_POST['date']) : '';
  if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) $date = date('Y-m-d');
  $prog = array('done'=>true, 'date'=>$date);
  file_put_contents($p, json_encode($prog, JSON_UNESCAPED_UNICODE));
  out(array('ok'=>true, 'progress'=>$prog));
}

// ---- comment（追記）----
if ($action === 'comment') {
  $text = trim(isset($_POST['text']) ? $_POST['text'] : '');
  if ($text === '') fail('empty text');
  if (mb_strlen($text) > 2000) $text = mb_substr($text, 0, 2000);
  $c = load_comments($caseDir);
  $c[] = array('name'=>poster_name(), 'at'=>date('Y-m-d H:i'), 'text'=>$text, 'side'=>'gaichu');
  file_put_contents($caseDir.'/comments.json', json_encode($c, JSON_UNESCAPED_UNICODE));
  out(array('ok'=>true));
}

// ---- editcomment（外注先が自分のコメントを修正）----
if ($action === 'editcomment') {
  $idx  = isset($_POST['idx']) ? intval($_POST['idx']) : -1;
  $text = trim(isset($_POST['text']) ? $_POST['text'] : '');
  $c = load_comments($caseDir);
  if ($idx < 0 || $idx >= count($c)) fail('index out of range');
  if (isset($c[$idx]['side']) && $c[$idx]['side'] === 'shoji') fail('庄司石材の投稿は編集できません'); // 相手の投稿は不可
  if ($text === '') fail('empty text');
  if (mb_strlen($text) > 2000) $text = mb_substr($text, 0, 2000);
  $c[$idx]['text'] = $text;
  $c[$idx]['at']   = date('Y-m-d H:i') . '（編集）';
  file_put_contents($caseDir.'/comments.json', json_encode($c, JSON_UNESCAPED_UNICODE));
  out(array('ok'=>true));
}

// ---- delcomment（コメント削除）----
if ($action === 'delcomment') {
  $idx = isset($_POST['idx']) ? intval($_POST['idx']) : -1;
  $c = load_comments($caseDir);
  if ($idx < 0 || $idx >= count($c)) fail('index out of range');
  if (isset($c[$idx]['side']) && $c[$idx]['side'] === 'shoji') fail('庄司石材の投稿は削除できません'); // 相手の投稿は不可
  array_splice($c, $idx, 1);
  file_put_contents($caseDir.'/comments.json', json_encode(array_values($c), JSON_UNESCAPED_UNICODE));
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
  $name = poster_name(); // 元のファイル名は使わず、外注先名＋日付＋連番で命名
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

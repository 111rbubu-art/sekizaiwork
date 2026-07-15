<?php
/*
 * 外注ポータル 受信スクリプト（さくら / PHP）— Phase 2 片方向Push
 * ------------------------------------------------------------------
 * 内部アプリ（index_b.html）から案件データを受け取り、
 *   cases/<id>/case.json ＋ 地図/図面/写真 … を作成・差し替え・削除します。
 *
 * 合言葉は同じフォルダーの「.htsecret」に1行で書いておきます
 *   （Apache は既定で .ht* を配信拒否するので外からは読めません）。
 *   例:  echo -n 'ここに長いランダム文字列' > .htsecret
 *
 * 呼び出し（multipart/form-data, POST）:
 *   secret : 合言葉（.htsecret と一致）
 *   action : push | unpublish | list
 *   id     : 案件ID（英数・_-のみ）  ※push/unpublish で必須
 *   case   : case.json の中身（JSON文字列） ※push で必須
 *   files[]: アップロードするファイル       ※push（0個でも可）
 *   paths[]: 各ファイルの相対パス（例 "地図/現場図.jpg"） files[] と同順
 *
 * 応答: JSON  { ok:true, ... } / { ok:false, error:"..." }
 */

mb_internal_encoding('UTF-8');

// ---- CORS（内部アプリの配信元を許可）----
$ALLOW_ORIGINS = array(
  'https://111rbubu-art.github.io',
  'http://localhost:8000',
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

header('Content-Type: application/json; charset=UTF-8');
function out($arr){ echo json_encode($arr, JSON_UNESCAPED_UNICODE); exit; }
function fail($msg, $code=400){ http_response_code($code); out(array('ok'=>false,'error'=>$msg)); }

// GETでアクセスされたら版情報を返す（設置バージョン確認用・合言葉不要）
if ($_SERVER['REQUEST_METHOD'] === 'GET') out(array('ok'=>true, 'service'=>'gaichu-upload', 'version'=>6, 'actions'=>array('push','addfile','updatecase','delfile','getfile','status','comments','unpublish','list')));
if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('POST only', 405);

$BASE      = __DIR__;
$CASES_DIR = $BASE . '/cases';

// ---- 認証 ----
$secretFile = $BASE . '/.htsecret';
if (!is_file($secretFile)) fail('server not configured (.htsecret missing)', 500);
$expected = trim(file_get_contents($secretFile));
$given    = isset($_POST['secret']) ? trim($_POST['secret']) : '';
if ($expected === '' || !hash_equals($expected, $given)) fail('unauthorized', 401);

$action = isset($_POST['action']) ? $_POST['action'] : '';

// ---- list: 公開中の案件ID一覧 ----
if ($action === 'list') {
  $ids = array();
  if (is_dir($CASES_DIR)) {
    foreach (scandir($CASES_DIR) as $d) {
      if ($d === '.' || $d === '..' || substr($d,0,1)==='.') continue;
      if (is_file($CASES_DIR.'/'.$d.'/case.json')) {
        $c = json_decode(file_get_contents($CASES_DIR.'/'.$d.'/case.json'), true);
        $ids[] = array('id'=>$d, 'updated'=>(is_array($c)&&isset($c['updated']))?$c['updated']:'');
      }
    }
  }
  out(array('ok'=>true, 'cases'=>$ids));
}

// ---- id 検証 ----
function valid_id($id){ return $id !== '' && preg_match('/^[A-Za-z0-9_-]{1,64}$/', $id); }
$id = isset($_POST['id']) ? $_POST['id'] : '';
if (!valid_id($id)) fail('invalid id');
$caseDir = $CASES_DIR . '/' . $id;

// フォルダーを再帰削除
function rrmdir($dir){
  if (!is_dir($dir)) return;
  foreach (scandir($dir) as $f) {
    if ($f === '.' || $f === '..') continue;
    $p = $dir.'/'.$f;
    is_dir($p) ? rrmdir($p) : @unlink($p);
  }
  @rmdir($dir);
}
// 案件フォルダー内のファイル相対パス一覧（case.json除く）
function list_case_files($dir, $base=''){
  $out = array();
  if (!is_dir($dir)) return $out;
  foreach (scandir($dir) as $f) {
    if ($f === '.' || $f === '..' || $f === 'case.json' || $f === 'comments.json' || substr($f,0,1)==='.') continue;
    $p = $dir.'/'.$f; $rel = ($base==='') ? $f : $base.'/'.$f;
    if (is_dir($p)) $out = array_merge($out, list_case_files($p, $rel));
    else $out[] = $rel;
  }
  return $out;
}

// 許可する拡張子（実行系は拒否）
$ALLOW_EXT = array('jpg','jpeg','png','gif','webp','bmp','heic','heif','pdf','txt','csv',
                   'doc','docx','xls','xlsx','ppt','pptx','dwg','dxf');

// パスの各セグメントを安全化
function safe_seg($s){
  $s = str_replace(array("\0","\\"), '', $s);
  $s = str_replace('..', '', $s);
  return trim($s);
}
function safe_relpath($rel){
  $parts = array();
  foreach (explode('/', str_replace('\\','/',$rel)) as $seg) {
    $seg = safe_seg($seg);
    if ($seg === '' || $seg === '.' ) continue;
    $parts[] = $seg;
  }
  return $parts; // 配列（最後がファイル名）
}

// ---- unpublish: 案件フォルダーを削除（公開を外す）----
if ($action === 'unpublish') {
  rrmdir($caseDir);
  out(array('ok'=>true, 'unpublished'=>$id));
}

// ---- addfile: 既存の案件フォルダーへ1ファイル追加（大きい工事写真対策・分割送信）----
if ($action === 'addfile') {
  if (!is_dir($caseDir)) fail('case not initialized (push first)');
  if (!isset($_FILES['file']) || !isset($_FILES['file']['error']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK
      || !is_uploaded_file($_FILES['file']['tmp_name'])) {
    $e = isset($_FILES['file']['error']) ? $_FILES['file']['error'] : 'no file';
    fail('upload error: '.$e); // 1=ini上限, 2=フォーム上限, 3=一部, 4=無し …
  }
  $rel  = (isset($_POST['path']) && $_POST['path'] !== '') ? $_POST['path'] : $_FILES['file']['name'];
  $segs = safe_relpath($rel);
  if (!count($segs)) fail('invalid path');
  $fname = array_pop($segs);
  $ext = strtolower(pathinfo($fname, PATHINFO_EXTENSION));
  if (!in_array($ext, $ALLOW_EXT, true)) fail('extension not allowed: '.$ext);
  $destDir = $caseDir . (count($segs) ? '/'.implode('/', $segs) : '');
  if (!is_dir($destDir) && !@mkdir($destDir, 0755, true)) fail('cannot create dir', 500);
  if (!@move_uploaded_file($_FILES['file']['tmp_name'], $destDir.'/'.$fname)) fail('cannot save file', 500);
  out(array('ok'=>true, 'saved'=>$fname));
}

// ---- status: この案件の登録状況（公開中か／case.json／ファイル一覧）----
if ($action === 'status') {
  if (!is_dir($caseDir)) out(array('ok'=>true, 'published'=>false));
  $c = json_decode(@file_get_contents($caseDir.'/case.json'), true);
  $cm = is_file($caseDir.'/comments.json') ? json_decode(file_get_contents($caseDir.'/comments.json'), true) : array();
  out(array('ok'=>true, 'published'=>true, 'case'=>(is_array($c)?$c:null),
            'files'=>list_case_files($caseDir), 'comments'=>(is_array($cm)?$cm:array())));
}

// ---- getfile: 合言葉付きでファイル本体を返す（アプリのサムネ表示用）----
if ($action === 'getfile') {
  if (!is_dir($caseDir)) fail('case not found', 404);
  $rel  = isset($_POST['path']) ? $_POST['path'] : '';
  $segs = safe_relpath($rel);
  if (!count($segs)) fail('invalid path');
  $target = $caseDir . '/' . implode('/', $segs);
  if (!is_file($target)) fail('file not found', 404);
  $ext = strtolower(pathinfo($target, PATHINFO_EXTENSION));
  $types = array('jpg'=>'image/jpeg','jpeg'=>'image/jpeg','png'=>'image/png','gif'=>'image/gif',
                 'webp'=>'image/webp','bmp'=>'image/bmp','heic'=>'image/heic','heif'=>'image/heif','pdf'=>'application/pdf');
  header('Content-Type: '.(isset($types[$ext]) ? $types[$ext] : 'application/octet-stream'));
  header('Content-Length: '.filesize($target));
  readfile($target);
  exit;
}

// ---- comments: 外注先コメント(comments.json)を返す（内部アプリの閲覧用）----
if ($action === 'comments') {
  $p = $caseDir.'/comments.json';
  $c = is_file($p) ? json_decode(file_get_contents($p), true) : array();
  out(array('ok'=>true, 'comments'=>is_array($c)?$c:array()));
}

// ---- updatecase: 既存案件の case.json だけ差し替え（ファイルは触らない）----
if ($action === 'updatecase') {
  if (!is_dir($caseDir)) out(array('ok'=>true, 'notPublished'=>true));
  $caseJson = isset($_POST['case']) ? $_POST['case'] : '';
  $caseData = json_decode($caseJson, true);
  if (!is_array($caseData)) fail('invalid case json');
  file_put_contents($caseDir.'/case.json', json_encode($caseData, JSON_UNESCAPED_UNICODE));
  out(array('ok'=>true, 'updated'=>$id));
}

// ---- delfile: 公開中の案件から1ファイルだけ削除（写真の取り下げ等）----
if ($action === 'delfile') {
  if (!is_dir($caseDir)) fail('case not found');
  $rel  = isset($_POST['path']) ? $_POST['path'] : '';
  $segs = safe_relpath($rel);
  if (!count($segs)) fail('invalid path');
  $target = $caseDir . '/' . implode('/', $segs);
  if (!is_file($target)) fail('file not found');
  @unlink($target);
  // 空になったサブフォルダーを掃除
  $sub = dirname($target);
  if ($sub !== $caseDir && is_dir($sub)) {
    $rest = array_diff(scandir($sub), array('.','..'));
    if (count($rest) === 0) @rmdir($sub);
  }
  out(array('ok'=>true, 'deleted'=>$rel, 'files'=>list_case_files($caseDir)));
}

// ---- push: 案件を作成・差し替え（case.json＋任意でまとめてファイル）----
if ($action !== 'push') fail('unknown action');

$caseJson = isset($_POST['case']) ? $_POST['case'] : '';
$caseData = json_decode($caseJson, true);
if (!is_array($caseData)) fail('invalid case json');

if (!is_dir($CASES_DIR) && !@mkdir($CASES_DIR, 0755, true)) fail('cannot create cases dir', 500);

// いったん全消し → 作り直し（片方向なので毎回まるごと差し替え）
rrmdir($caseDir);
clearstatcache();
if (!is_dir($caseDir)) @mkdir($caseDir, 0755, true);
clearstatcache();
if (!is_dir($caseDir)) fail('cannot create case dir', 500);
// 削除が一部残っていても再公開できるよう、中身を空にする
foreach (glob($caseDir.'/*') as $g) { is_dir($g) ? rrmdir($g) : @unlink($g); }

// case.json 書き込み
file_put_contents($caseDir.'/case.json', json_encode($caseData, JSON_UNESCAPED_UNICODE));

// ファイル保存
$saved = 0; $skipped = array();
if (isset($_FILES['files']) && is_array($_FILES['files']['tmp_name'])) {
  $paths = isset($_POST['paths']) && is_array($_POST['paths']) ? $_POST['paths'] : array();
  $n = count($_FILES['files']['tmp_name']);
  for ($i=0; $i<$n; $i++) {
    if ($_FILES['files']['error'][$i] !== UPLOAD_ERR_OK) continue;
    $tmp = $_FILES['files']['tmp_name'][$i];
    if (!is_uploaded_file($tmp)) continue;
    $rel  = isset($paths[$i]) && $paths[$i] !== '' ? $paths[$i] : $_FILES['files']['name'][$i];
    $segs = safe_relpath($rel);
    if (!count($segs)) { $skipped[] = $rel; continue; }
    $fname = array_pop($segs);
    $ext = strtolower(pathinfo($fname, PATHINFO_EXTENSION));
    if (!in_array($ext, $ALLOW_EXT, true)) { $skipped[] = $rel; continue; }
    $destDir = $caseDir . (count($segs) ? '/'.implode('/', $segs) : '');
    if (!is_dir($destDir) && !@mkdir($destDir, 0755, true)) { $skipped[] = $rel; continue; }
    if (@move_uploaded_file($tmp, $destDir.'/'.$fname)) $saved++; else $skipped[] = $rel;
  }
}

out(array('ok'=>true, 'id'=>$id, 'saved'=>$saved, 'skipped'=>$skipped));

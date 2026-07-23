<?php
/*
 * 外注先ポータル（さくらのレンタルサーバ / PHP）— Phase 2 閲覧版
 * ------------------------------------------------------------------
 * 内部アプリ（index_b.html の「外注先へ公開」）から upload.php 経由で
 * 送られてきた案件データ（cases/<id>/case.json ＋ 地図/図面/写真 …）を、
 * スマホ向けUI（工事・納骨・彫刻タブ）で「閲覧のみ」表示します。
 *
 * 置き場所（各外注先フォルダー = Basic認証をかけたフォルダー）:
 *   yamada/
 *     index.php        ← このファイル
 *     upload.php       ← 受信スクリプト
 *     .htaccess        ← パスワード（Basic認証）
 *     .htsecret        ← アップロード合言葉（Apacheが .ht* を配信拒否）
 *     cases/
 *       k-123/  case.json  地図/  図面/  写真/
 *       n-45/   case.json  資料/
 *       c-45/   case.json  地図/  写真/
 *
 * case.json（すべて文字列。無い項目は省略可）:
 *   { "type":"kouji|nok|chokoku", "temple":"光明院", "family":"小張家",
 *     "titleExtra":"墓石建立", "category":"墓石工事", "status":"open|done",
 *     "dateLabel":"納期", "date":"7/20", "sortDate":"2026-07-20",
 *     "time":"10:00", "state":"式あり", "noteLabel":"彫刻箇所",
 *     "note":"墓誌 3行目 …", "updated":"7/10" }
 */

mb_internal_encoding('UTF-8');
$BASE      = __DIR__;
$CASES_DIR = $BASE . '/cases';
$IMG_EXT   = array('jpg','jpeg','png','gif','webp','bmp','heic','heif');
// 資料グループの表示順（先頭ほど上に）
$GROUP_ORDER = array('地図','図面','写真','資料');

function h($s){ return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }
function urlseg($s){ return implode('/', array_map('rawurlencode', explode('/', $s))); }
function ext_of($f){ return strtolower(pathinfo($f, PATHINFO_EXTENSION)); }
function is_hidden($n){ return substr($n,0,1) === '.'; }

// 1案件フォルダー内のファイルを「サブフォルダー名」でグループ化（直下ファイルは「資料」）
function collect_groups($casePath, $caseId){
  $groups = array();
  $root = array();
  $items = @scandir($casePath);
  if ($items) foreach ($items as $n) {
    if (in_array($n, array('.','..','case.json','comments.json'), true) || is_hidden($n)) continue;
    $p = $casePath . '/' . $n;
    if (is_file($p)) { $root[] = array('name'=>$n, 'rel'=>$n); }
    else if (is_dir($p)) {
      $sub = array();
      $items2 = @scandir($p);
      if ($items2) foreach ($items2 as $n2) {
        if (in_array($n2, array('.','..'), true) || is_hidden($n2)) continue;
        if (is_file($p . '/' . $n2)) $sub[] = array('name'=>$n2, 'rel'=>$n.'/'.$n2);
      }
      if (count($sub)) $groups[$n] = $sub;
    }
  }
  if (count($root)) $groups['資料'] = isset($groups['資料'])
      ? array_merge($groups['資料'], $root) : $root;
  return $groups;
}
// 外注先コメント読み込み
function load_comments($casePath){
  $p = $casePath.'/comments.json';
  if (!is_file($p)) return array();
  $j = json_decode(file_get_contents($p), true);
  return is_array($j) ? $j : array();
}
// 完了報告(progress.json)読み込み
function load_progress($casePath){
  $p = $casePath.'/progress.json';
  if (!is_file($p)) return null;
  $j = json_decode(file_get_contents($p), true);
  return is_array($j) ? $j : null;
}

// 案件を収集（SP完了＝case.json status=done は非公開＝表示しない。データはアプリ側で確認可）
$cases = array('kouji'=>array(), 'nok'=>array(), 'chokoku'=>array());
$openCount = array('kouji'=>0, 'nok'=>0, 'chokoku'=>0); // 未完件数
$newToday  = array('kouji'=>0, 'nok'=>0, 'chokoku'=>0); // 登録1日目（点滅NEW）件数
if (is_dir($CASES_DIR)) {
  $dirs = @scandir($CASES_DIR);
  if ($dirs) foreach ($dirs as $d) {
    if (in_array($d, array('.','..'), true) || is_hidden($d)) continue;
    $cp = $CASES_DIR . '/' . $d;
    if (!is_dir($cp)) continue;
    $jsonPath = $cp . '/case.json';
    if (!is_file($jsonPath)) continue;
    $c = json_decode(file_get_contents($jsonPath), true);
    if (!is_array($c)) continue;
    // SP完了はポータル非公開（スキップ）
    if (isset($c['status']) && $c['status']==='done') continue;
    $type = isset($c['type']) ? $c['type'] : 'kouji';
    if (!isset($cases[$type])) $type = 'kouji';
    $c['_id']     = $d;
    $c['_groups'] = collect_groups($cp, $d);
    $c['_prog']   = load_progress($cp);
    $c['_eff']    = ($c['_prog'] && !empty($c['_prog']['done'])) ? 'done' : 'open'; // 完了報告のみ完了扱い
    // NEWラベル：初回登録(.created)から7日以内は静止、1日目（24時間以内）は点滅＋タブNEW
    // （.createdが無い旧案件は判定しない＝updatecaseでの誤再点灯を防止。updatecase側で.createdを補完）
    $cts  = is_file($cp.'/.created') ? intval(trim(file_get_contents($cp.'/.created'))) : 0;
    $age  = $cts ? (time() - $cts) : PHP_INT_MAX;
    $c['_new']  = ($cts && $age < 7*86400);
    $c['_new1'] = ($cts && $age < 1*86400);
    if ($c['_new1']) $newToday[$type]++;
    // 状態更新New（.statetimeから24時間）
    $sts = is_file($cp.'/.statetime') ? intval(trim(file_get_contents($cp.'/.statetime'))) : 0;
    $c['_stateNew'] = ($sts && (time() - $sts) < 86400);
    if ($c['_eff'] === 'open') $openCount[$type]++;
    $cases[$type][] = $c;
  }
}

// 各タブ内を sortDate 昇順（空は最後）
function sort_cases(&$arr){
  usort($arr, function($a, $b){
    $sa = isset($a['sortDate']) ? $a['sortDate'] : '';
    $sb = isset($b['sortDate']) ? $b['sortDate'] : '';
    if ($sa === '' && $sb === '') return 0;
    if ($sa === '') return 1;
    if ($sb === '') return -1;
    return strcmp($sa, $sb);
  });
}
foreach ($cases as $k => &$arr) sort_cases($arr);
unset($arr);

$total = count($cases['kouji']) + count($cases['nok']) + count($cases['chokoku']);

// 環境変数 GAICHU_NAME があれば「○○ ログイン中」に使う（無ければ表示しない）
$loginName = getenv('GAICHU_NAME');

// ----- 1枚のカードを描画 -----
function render_card($c, $GROUP_ORDER, $IMG_EXT){
  $type   = isset($c['type']) ? $c['type'] : 'kouji';
  $status = (isset($c['status']) && $c['status']==='done') ? 'done' : 'open';
  $temple = isset($c['temple']) ? $c['temple'] : '';
  $family = isset($c['family']) ? $c['family'] : '';
  $extra  = isset($c['titleExtra']) ? $c['titleExtra'] : '';
  $head   = trim($family . ($extra !== '' ? ' ' . $extra : ''));

  global $CASES_DIR;
  $caseDir = $CASES_DIR . '/' . $c['_id'];
  // メモ（現場メモ・彫刻箇所・伝言等）がアプリから更新された直後（24時間以内）はNew
  $memoTs   = is_file($caseDir.'/.memotime') ? intval(trim(@file_get_contents($caseDir.'/.memotime'))) : 0;
  $memoNewB = ($memoTs && (time() - $memoTs) < 86400) ? ' <span class="rnew blink">New</span>' : '';
  $isNok = ($type === 'nok');

  // 完了報告(progress.json)があれば完了扱い（完了タブへ）
  $prog = isset($c['_prog']) ? $c['_prog'] : load_progress($caseDir);
  if ($prog && !empty($prog['done'])) $status = 'done';

  echo '<article class="card" data-st="'.h($status).'">';
  echo '<div class="head">';
  if (!empty($c['_new'])) echo '<span class="newbadge'.(!empty($c['_new1'])?' blink':'').'">🆕 NEW</span>';
  if ($isNok) {
    // 納骨：タイトル＝納骨日・時間・状態、改行して お寺　墓名
    echo '<div class="srow">';
    if ($status === 'done') echo '<span class="pill done">完了</span>';
    echo '<span class="due"><span class="tag">納骨日</span> <b class="tnum">'.h(!empty($c['date'])?$c['date']:'—').'</b>';
    if (!empty($c['time'])) echo ' <b class="tnum">'.h($c['time']).'</b>';
    echo '</span>';
    if (!empty($c['state'])) echo '<span class="chip state">'.h($c['state']).'</span>'.(!empty($c['_stateNew'])?'<span class="rnew blink">New</span>':'');
    echo '</div>';
    echo '<div class="subttl">';
    if ($temple !== '') echo '<span class="temple">'.h($temple).'</span>　';
    echo h($family).'</div>';
    // 伝言・蓋・拝石目地
    $rows = array();
    if (!empty($c['message'])) $rows[] = array('納骨者への伝言', $c['message']);
    if (!empty($c['futa']))    $rows[] = array('蓋の種類', $c['futa']);
    if (!empty($c['meji']))    $rows[] = array('拝石目地', $c['meji']);
    if (count($rows)) {
      echo '<div class="info">';
      $ri = 0;
      foreach ($rows as $r) { echo '<div class="irow"><span class="ilbl">'.h($r[0]).($ri===0?$memoNewB:'').'</span><span class="ival">'.nl2br(h($r[1])).'</span></div>'; $ri++; }
      echo '</div>';
    }
  } else {
    // 工事・彫刻：お寺＋墓名を同じ行
    echo '<h2>';
    if ($temple !== '') echo '<span class="temple">'.h($temple).'</span>　';
    echo h($head).'</h2>';
    echo '<div class="chips">';
    if (!empty($c['category'])) echo '<span class="chip">'.h($c['category']).'</span>';
    if (!empty($c['workStatus'])) echo '<span class="chip work">'.h($c['workStatus']).'</span>'.(!empty($c['_stateNew'])?'<span class="rnew blink">New</span>':'');
    echo '</div>';
    echo '<div class="srow">';
    if ($status === 'done') echo '<span class="pill done">完了</span>';
    if (!empty($c['date'])) {
      echo '<span class="due"><span class="tag">'.h(isset($c['dateLabel'])?$c['dateLabel']:'納期').'</span> <b class="tnum">'.h($c['date']).'</b></span>';
    }
    echo '</div>';
    if (!empty($c['reason'])) echo '<div class="reason"><span class="tag">納期理由</span> '.h($c['reason']).'</div>';
  }
  echo '</div>'; // head

  // 彫刻箇所などのコメント
  if (!empty($c['note'])) {
    echo '<div class="note"><div class="nlbl">'.h(isset($c['noteLabel'])?$c['noteLabel']:'メモ').$memoNewB.'</div>';
    echo '<div class="ntxt">'.nl2br(h($c['note'])).'</div></div>';
  }

  // 資料（報告は除外して別セクションに）
  $groups = isset($c['_groups']) ? $c['_groups'] : array();
  $report = isset($groups['報告']) ? $groups['報告'] : array();
  unset($groups['報告']);
  if (count($groups)) {
    $ordered = array();
    foreach ($GROUP_ORDER as $g) if (isset($groups[$g])) { $ordered[$g] = $groups[$g]; unset($groups[$g]); }
    foreach ($groups as $g => $f) $ordered[$g] = $f;
    echo '<div class="sec">';
    foreach ($ordered as $gname => $files) {
      $dot = ($gname==='地図')?'var(--map)':(($gname==='図面')?'var(--draw)':'var(--photo)');
      echo '<div class="mgroup"><div class="mlabel"><span class="dot" style="background:'.$dot.'"></span>'.h($gname).'</div>';
      $imgs = array(); $docs = array();
      foreach ($files as $f) { if (in_array(ext_of($f['name']), $IMG_EXT, true)) $imgs[]=$f; else $docs[]=$f; }
      if (count($imgs)) {
        echo '<div class="thumbs">';
        foreach ($imgs as $f) {
          $href = 'cases/'.urlseg($c['_id']).'/'.urlseg($f['rel']);
          $fnew = ((@filemtime($caseDir.'/'.$f['rel']) ?: 0) && (time() - @filemtime($caseDir.'/'.$f['rel'])) < 86400);
          echo '<a class="thumb" href="'.h($href).'" style="background-image:url('.h($href).')" '
             . 'data-cap="'.h(pathinfo($f['name'], PATHINFO_FILENAME)).'" onclick="return openLightbox(this)">'
             . ($fnew ? '<span class="filenew blink">New</span>' : '') . '</a>';
        }
        echo '</div>';
      }
      if (count($docs)) {
        echo '<div class="files">';
        foreach ($docs as $f) {
          $href = 'cases/'.urlseg($c['_id']).'/'.urlseg($f['rel']);
          $ico = (ext_of($f['name'])==='pdf') ? '📄' : '📎';
          $fnew = ((@filemtime($caseDir.'/'.$f['rel']) ?: 0) && (time() - @filemtime($caseDir.'/'.$f['rel'])) < 86400);
          echo '<a class="file" href="'.h($href).'" target="_blank" rel="noopener">'
             . '<span class="ico">'.$ico.'</span> '.h($f['name']).($fnew ? ' <span class="rnew blink">New</span>' : '').'</a>';
        }
        echo '</div>';
      }
      echo '</div>';
    }
    echo '</div>';
  }

  // 完了報告（工事・彫刻のみ：外注先が完了日を登録）
  if ($type === 'kouji' || $type === 'chokoku') render_progress($c['_id'], $prog);

  // 外注先からの報告（写真アップ＋コメント）
  render_report($c['_id'], $report, load_comments($caseDir), $IMG_EXT);

  if (!empty($c['updated'])) {
    echo '<div class="cardfoot"><span class="updated tnum">更新 '.h($c['updated']).'</span></div>';
  }
  echo '</article>';
}

// 完了報告セクション（外注先が完了日を登録／取消）
function render_progress($id, $prog){
  echo '<div class="prog" data-case="'.h($id).'">';
  echo '<span class="plbl">🏁 完了報告</span>';
  echo '<span class="pbody">';
  if ($prog && !empty($prog['done'])) {
    $dt = isset($prog['date']) ? $prog['date'] : '';
    echo '<span class="pdone">✅ 完了 '.h($dt).'</span>';
    echo '<button class="pundo" onclick="progSet(\''.h($id).'\',\'\',0)">取消</button>';
  } else {
    echo '<input type="date" class="pdate" id="pg-'.h($id).'" value="'.h(date('Y-m-d')).'">';
    echo '<button class="pbtn" onclick="progSet(\''.h($id).'\',document.getElementById(\'pg-'.h($id).'\').value,1)">完了にする</button>';
  }
  echo '</span></div>';
}
// 報告写真/コメントの「新着」判定：アップロード（または投稿）から24時間以内
function _rep_is_new_ts($ts){ return $ts && (time() - $ts) < 86400; }
// コメントの 'at'（"Y-m-d H:i" ／末尾に"（編集）"が付く場合あり）を時刻に変換
function _rep_comment_ts($at){
  if (!$at) return 0;
  $s = trim(preg_replace('/（.*$/u', '', $at)); // "（編集）" 等を除去
  $t = strtotime($s);
  return $t ? $t : 0;
}
// 報告セクション（外注先が投稿・写真/コメント）
function render_report($id, $files, $comments, $IMG_EXT){
  global $CASES_DIR;
  $caseDir = $CASES_DIR . '/' . $id;
  echo '<div class="report" data-case="'.h($id).'">';
  echo '<div class="rlbl">📮 やりとり（庄司石材）</div>';
  echo '<div class="rphotos">';
  foreach ($files as $f) {
    $href = 'cases/'.urlseg($id).'/'.urlseg($f['rel']);
    $isNew = _rep_is_new_ts(@filemtime($caseDir.'/'.$f['rel']));
    $newB = $isNew ? '<span class="rnew blink">New</span>' : '';
    if (in_array(ext_of($f['name']), $IMG_EXT, true)) {
      echo '<div class="rthumb"><a class="thumb" href="'.h($href).'" style="background-image:url('.h($href).')" data-cap="'.h($f['name']).'" onclick="return openLightbox(this)"></a>'
         . $newB
         . '<button class="rdel" title="削除" onclick="repDel(\''.h($id).'\',\''.h($f['rel']).'\')">🗑</button></div>';
    } else {
      echo '<a class="file" href="'.h($href).'" target="_blank" rel="noopener">📎 '.h($f['name']).' '.$newB.'</a>';
    }
  }
  echo '</div>';
  $total = count($comments); $showFrom = ($total > 2) ? $total - 2 : 0;
  echo '<div class="clist">';
  if ($total > 2) echo '<button type="button" class="cmore" onclick="chatMore(this)">▼ これまでのやり取りを表示（残り'.($total-2).'件）</button>';
  foreach ($comments as $i => $cm) {
    $at = isset($cm['at']) ? $cm['at'] : '';
    $tx = isset($cm['text']) ? $cm['text'] : '';
    $mine = !(isset($cm['side']) && $cm['side']==='shoji'); // ポータル＝外注視点：side未指定/gaichu＝自分（右）
    $cNew = _rep_is_new_ts(_rep_comment_ts($at)) ? '<span class="rnew blink">New</span>' : '';
    $cls = 'cmt '.($mine?'me':'them').($i < $showFrom ? ' old hide' : '');
    echo '<div class="'.$cls.'" data-idx="'.$i.'">';
    echo '<div class="cmeta"><span class="cwho">'.($mine?'自分':'庄司石材').'</span><span>'.h($at).' '.$cNew.'</span>';
    if ($mine) echo '<span class="cact"><button class="cedit" onclick="repEditComment(\''.h($id).'\','.$i.')">✏ 編集</button><button class="cdel" onclick="repDelComment(\''.h($id).'\','.$i.')">🗑 削除</button></span>';
    echo '</div><div class="bubble">'.nl2br(h($tx)).'</div></div>';
  }
  echo '</div>';
  echo '<div class="radd">'
     . '<label class="raddphoto">＋写真・ファイル<input type="file" accept="image/*,application/pdf" multiple hidden onchange="repUpload(this,\''.h($id).'\')"></label>'
     . '<textarea class="rcinput" id="rc-'.h($id).'" rows="2" placeholder="コメントを入力（改行できます）" oninput="repGrow(this)"></textarea>'
     . '<button class="rcsend" onclick="repComment(\''.h($id).'\')">送信</button>'
     . '</div>';
  echo '</div>';
}
?>
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="robots" content="noindex,nofollow">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>外注ポータル — 庄司石材</title>
<style>
  :root {
    --ground:#f3f2ef; --surface:#fff; --surface-2:#faf9f7;
    --ink:#1c1f26; --muted:#6c7078; --faint:#9a9ea6; --line:#e4e2dd;
    --accent:#33507e; --accent-soft:#e9edf5;
    --iron:#a83e30; --amber:#a86a12; --green:#3d7a54;
    --map:#2f6f8f; --draw:#4a4c8a; --photo:#3f7d6b;
    --shadow:0 1px 2px rgba(20,22,28,.06),0 4px 16px rgba(20,22,28,.05);
    --serif:"Hiragino Mincho ProN","Yu Mincho","YuMincho","Noto Serif JP",serif;
    --sans:-apple-system,"Hiragino Kaku Gothic ProN","Yu Gothic","Meiryo",sans-serif;
  }
  @media (prefers-color-scheme: dark){ :root{
    --ground:#101216; --surface:#191c22; --surface-2:#20242c; --ink:#eceef2; --muted:#9aa0ab; --faint:#71767f; --line:#2b3038;
    --accent:#8ea8dd; --accent-soft:#232c3d; --iron:#d9776a; --amber:#d5a04e; --green:#6fb389;
    --map:#6fb0cc; --draw:#9a9ce0; --photo:#74c2ab; --shadow:0 1px 2px rgba(0,0,0,.35),0 6px 20px rgba(0,0,0,.3); } }

  * { box-sizing:border-box; }
  body { margin:0; background:var(--ground); color:var(--ink); font-family:var(--sans); font-size:15px; line-height:1.6; -webkit-font-smoothing:antialiased; }
  .app { max-width:440px; margin:0 auto; min-height:100vh; background:var(--ground); box-shadow:0 0 40px rgba(0,0,0,.06); }
  .pad { padding:0 14px 40px; }
  h2 { font-family:var(--serif); font-weight:600; text-wrap:balance; }
  .tnum { font-variant-numeric:tabular-nums; }

  .topbar { position:sticky; top:0; z-index:20; background:color-mix(in srgb,var(--surface) 92%,transparent); backdrop-filter:blur(8px); border-bottom:1px solid var(--line); }
  .topbar .row { padding:11px 14px; display:flex; align-items:center; gap:10px; }
  .seal { width:32px; height:32px; border-radius:7px; background:var(--iron); color:#fff; font-family:var(--serif); font-size:17px; display:grid; place-items:center; box-shadow:inset 0 0 0 1px rgba(255,255,255,.18); flex-shrink:0; }
  .brand b { font-family:var(--serif); font-size:16px; }
  .login { margin-left:auto; font-size:13px; color:var(--muted); }
  .login b { color:var(--ink); font-family:var(--serif); font-weight:600; }

  .maintabs { display:flex; background:var(--surface); border-bottom:1px solid var(--line); position:sticky; top:54px; z-index:19; }
  .maintab { flex:1; border:none; background:transparent; font-family:var(--serif); font-size:15px; color:var(--muted); padding:12px 4px; cursor:pointer; border-bottom:2.5px solid transparent; margin-bottom:-1px; }
  .maintab.on { color:var(--ink); border-bottom-color:var(--accent); }
  .maintab .n { font-family:var(--sans); font-size:11px; color:var(--faint); margin-left:4px; }

  .toolbar { display:flex; align-items:center; gap:10px; padding:12px 0 6px; }
  .seg { display:inline-flex; background:var(--surface); border:1px solid var(--line); border-radius:22px; padding:3px; }
  .seg button { border:none; background:transparent; color:var(--muted); font-size:14px; font-weight:700; padding:8px 24px; border-radius:20px; cursor:pointer; font-family:var(--sans); }
  .seg button.on { background:var(--accent); color:#fff; }

  .jobs { display:flex; flex-direction:column; gap:14px; margin-top:6px; }
  .card { background:var(--surface); border:1px solid var(--line); border-radius:14px; box-shadow:var(--shadow); overflow:hidden; }
  .card.fhide { display:none; }
  .head { padding:13px 15px 12px; }
  .temple { font-family:var(--serif); font-size:17px; font-weight:700; color:var(--accent); }
  .head h2 { font-size:16px; margin:1px 0 8px; color:var(--ink); line-height:1.3; }
  .chips { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px; }
  .chip { font-size:11px; padding:2px 9px; border-radius:20px; background:var(--surface-2); border:1px solid var(--line); color:var(--muted); }
  .chip.state { color:var(--iron); background:color-mix(in srgb,var(--iron) 10%,transparent); border-color:color-mix(in srgb,var(--iron) 30%,transparent); font-weight:700; }
  .srow { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .newbadge { display:inline-block; background:#e53935; color:#fff; font-family:var(--sans); font-size:10.5px; font-weight:700; padding:2px 9px; border-radius:11px; letter-spacing:.04em; margin-bottom:8px; }
  .tabnew { display:inline-block; background:#e53935; color:#fff; font-family:var(--sans); font-size:8.5px; font-weight:700; padding:1px 5px; border-radius:8px; letter-spacing:.03em; margin-left:3px; vertical-align:top; }
  @keyframes newblink { 0%,100%{opacity:1;} 50%{opacity:.25;} }
  .blink { animation:newblink 1s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) { .blink { animation:none; } }
  .pill { font-size:11.5px; font-weight:700; padding:3px 11px; border-radius:20px; }
  .pill.done { color:var(--green); background:color-mix(in srgb,var(--green) 14%,transparent); }
  .due { font-size:12.5px; color:var(--muted); }
  .due b { font-family:var(--serif); font-size:15px; color:var(--ink); }
  .due .tag { font-size:11px; font-weight:700; }

  .note { border-top:1px solid var(--line); padding:11px 15px; background:color-mix(in srgb,var(--amber) 8%,var(--surface)); }
  .note .nlbl { font-size:10.5px; font-weight:700; letter-spacing:.08em; color:var(--amber); margin-bottom:2px; }
  .note .ntxt { font-size:14px; font-family:var(--serif); }

  .sec { border-top:1px solid var(--line); padding:12px 15px; }
  .mgroup + .mgroup { margin-top:13px; }
  .mlabel { font-size:11px; font-weight:700; letter-spacing:.08em; color:var(--muted); margin-bottom:8px; display:flex; align-items:center; gap:7px; }
  .dot { width:8px; height:8px; border-radius:3px; }
  .files { display:flex; flex-wrap:wrap; gap:8px; }
  .file { display:inline-flex; align-items:center; gap:7px; background:var(--surface-2); border:1px solid var(--line); border-radius:10px; padding:10px 13px; font-size:13.5px; color:var(--ink); text-decoration:none; }
  .file:active { border-color:var(--accent); } .file .ico { font-size:16px; }
  .thumbs { display:flex; flex-wrap:wrap; gap:8px; }
  .thumb { width:88px; height:66px; border-radius:9px; border:1px solid var(--line); position:relative; overflow:hidden; background-size:cover; background-position:center; cursor:pointer; display:block; }
  .thumb::after { content:attr(data-cap); position:absolute; left:0; right:0; bottom:0; font-size:10px; color:#fff; background:linear-gradient(transparent,rgba(0,0,0,.55)); padding:9px 6px 3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

  .cardfoot { border-top:1px solid var(--line); background:var(--surface-2); padding:9px 15px; display:flex; align-items:center; gap:10px; }
  .updated { margin-left:auto; font-size:11px; color:var(--faint); }
  .empty { background:var(--surface); border:1px solid var(--line); border-radius:14px; padding:26px 16px; text-align:center; color:var(--muted); font-size:13.5px; margin-top:16px; box-shadow:var(--shadow); }
  footer { text-align:center; color:var(--faint); font-size:11px; margin-top:22px; }
  .hidden { display:none; }

  #lightbox { display:none; position:fixed; inset:0; z-index:100; background:rgba(0,0,0,.82); align-items:center; justify-content:center; padding:16px; }
  #lightbox.show { display:flex; }
  #lightbox .lb-img { width:100%; max-width:520px; aspect-ratio:4/3; border-radius:12px; background-size:contain; background-position:center; background-repeat:no-repeat; box-shadow:0 10px 40px rgba(0,0,0,.5); }
  #lightbox .lb-cap { position:absolute; bottom:24px; color:#fff; font-size:13px; opacity:.85; }
  /* 納骨タイトル下のお寺・墓名 */
  .subttl { font-family:var(--serif); font-size:16px; color:var(--ink); margin-top:5px; }
  .subttl .temple { font-size:16px; }
  /* 伝言・蓋・目地 */
  .info { margin-top:8px; display:flex; flex-direction:column; gap:5px; }
  .irow { display:flex; gap:8px; font-size:12.5px; }
  .irow .ilbl { flex:0 0 84px; color:var(--muted); font-weight:700; font-size:11px; padding-top:1px; }
  .irow .ival { flex:1; color:var(--ink); font-family:var(--serif); }
  .reason { margin-top:6px; font-size:12.5px; color:var(--muted); }
  .reason .tag { font-size:11px; font-weight:700; margin-right:4px; }
  .chip.work { color:var(--amber); background:color-mix(in srgb,var(--amber) 12%,transparent); border-color:color-mix(in srgb,var(--amber) 35%,transparent); font-weight:700; }
  /* 完了報告 */
  .prog { border-top:1px solid var(--line); padding:11px 15px; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .prog .plbl { font-size:11px; font-weight:700; letter-spacing:.05em; color:var(--muted); }
  .prog .pbody { display:flex; align-items:center; gap:8px; margin-left:auto; flex-wrap:wrap; justify-content:flex-end; }
  .prog .pdate { background:var(--surface); border:1px solid var(--line); border-radius:9px; padding:8px 10px; font-size:14px; color:var(--ink); font-family:var(--sans); }
  .prog .pbtn { background:var(--green); color:#fff; border:none; border-radius:9px; padding:9px 15px; font-size:13px; font-weight:700; cursor:pointer; }
  .prog .pdone { font-size:14px; font-weight:700; color:var(--green); font-family:var(--serif); }
  .prog .pundo { background:transparent; border:1px solid var(--line); color:var(--muted); border-radius:8px; padding:6px 11px; font-size:12px; cursor:pointer; }
  /* 報告セクション */
  .report { border-top:1px solid var(--line); padding:11px 15px; background:color-mix(in srgb,var(--accent) 5%,var(--surface)); }
  .rlbl { font-size:11px; font-weight:700; letter-spacing:.06em; color:var(--accent); margin-bottom:8px; }
  .rphotos { display:flex; flex-wrap:wrap; gap:8px; }
  .rthumb { position:relative; }
  .rthumb .thumb { width:76px; height:58px; }
  .rdel { position:absolute; top:2px; right:2px; background:rgba(255,255,255,.9); color:#c0392b; border:1px solid #e0b4ad; border-radius:6px; width:22px; height:20px; font-size:11px; line-height:1; cursor:pointer; padding:0; }
  .rnew { display:inline-block; background:#e53935; color:#fff; font-family:var(--sans); font-size:8px; font-weight:700; padding:1px 4px; border-radius:6px; letter-spacing:.02em; }
  .rthumb .rnew { position:absolute; top:2px; left:2px; }
  .filenew { position:absolute; top:3px; left:3px; z-index:1; background:#e53935; color:#fff; font-family:var(--sans); font-size:8px; font-weight:700; padding:1px 5px; border-radius:6px; letter-spacing:.02em; }
  .hide { display:none !important; }
  .clist { display:flex; flex-direction:column; gap:8px; margin:9px 0; }
  .cmore { align-self:center; font-size:11px; font-weight:700; color:var(--accent); background:var(--accent-soft); border:1px solid color-mix(in srgb,var(--accent) 24%,transparent); border-radius:20px; padding:4px 14px; cursor:pointer; font-family:var(--sans); }
  .cmt { display:flex; flex-direction:column; max-width:85%; }
  .cmt.them { align-self:flex-start; align-items:flex-start; }
  .cmt.me { align-self:flex-end; align-items:flex-end; }
  .cmt .cmeta { display:flex; gap:6px; align-items:center; font-size:10px; color:var(--faint); margin:0 3px 2px; flex-wrap:wrap; }
  .cmt .cwho { font-weight:700; color:var(--muted); }
  .cmt .cact { display:flex; gap:8px; }
  .cmt .cact button { background:none; border:none; cursor:pointer; font-size:11px; color:var(--muted); font-family:var(--sans); padding:0; }
  .cmt .cact .cdel { color:var(--iron); }
  .cmt .bubble { font-size:13px; line-height:1.55; padding:8px 11px; border-radius:14px; white-space:pre-wrap; }
  .cmt.them .bubble { background:var(--surface-2); border:1px solid var(--line); border-top-left-radius:4px; }
  .cmt.me .bubble { background:color-mix(in srgb,var(--green) 15%,var(--surface)); border:1px solid color-mix(in srgb,var(--green) 34%,transparent); border-top-right-radius:4px; }
  .radd { display:flex; gap:7px; align-items:flex-end; margin-top:8px; }
  .raddphoto { flex-shrink:0; background:var(--accent-soft); color:var(--accent); border:1.5px dashed color-mix(in srgb,var(--accent) 55%,var(--line)); border-radius:9px; padding:9px 10px; font-size:12px; font-weight:700; cursor:pointer; }
  .rcinput { flex:1; min-width:0; background:var(--surface); border:1px solid var(--line); border-radius:9px; padding:9px 11px; font-size:14px; color:var(--ink); font-family:var(--sans); line-height:1.55; resize:vertical; min-height:42px; max-height:200px; overflow-y:auto; }
  .rcsend { flex-shrink:0; background:var(--accent); color:#fff; border:none; border-radius:9px; padding:10px 16px; font-size:13px; font-weight:700; cursor:pointer; }
  .reload { margin-left:auto; background:var(--surface); border:1px solid var(--line); border-radius:20px; padding:7px 14px; font-size:12.5px; font-weight:700; color:var(--accent); cursor:pointer; font-family:var(--sans); }
  @media (prefers-reduced-motion: reduce){ *{transition:none !important;} }
</style>
</head>
<body>
<div class="app">
  <div class="topbar">
    <div class="row">
      <div class="seal">庄</div>
      <div class="brand"><b>庄司石材</b></div>
      <?php if ($loginName): ?><div class="login"><b><?php echo h($loginName); ?></b> ログイン中</div><?php endif; ?>
    </div>
    <div class="maintabs">
      <button class="maintab on" data-t="kouji" onclick="showTab('kouji')">工事 <span class="n tnum"><?php echo $openCount['kouji']; ?></span><?php if ($newToday['kouji']): ?><span class="tabnew blink">NEW</span><?php endif; ?></button>
      <button class="maintab" data-t="nok" onclick="showTab('nok')">納骨 <span class="n tnum"><?php echo $openCount['nok']; ?></span><?php if ($newToday['nok']): ?><span class="tabnew blink">NEW</span><?php endif; ?></button>
      <button class="maintab" data-t="chokoku" onclick="showTab('chokoku')">彫刻 <span class="n tnum"><?php echo $openCount['chokoku']; ?></span><?php if ($newToday['chokoku']): ?><span class="tabnew blink">NEW</span><?php endif; ?></button>
    </div>
  </div>

  <div class="pad">
    <div class="toolbar">
      <div class="seg"><button class="on" data-f="open" onclick="setFilter('open')">未完</button><button data-f="done" onclick="setFilter('done')">完了</button></div>
      <button class="reload" onclick="location.reload()" title="最新に更新">🔄 更新</button>
    </div>

    <?php foreach (array('kouji','nok','chokoku') as $tab): ?>
    <div id="list-<?php echo $tab; ?>"<?php echo $tab==='kouji'?'':' class="hidden"'; ?>>
      <?php if (!count($cases[$tab])): ?>
        <div class="empty">現在、この区分に公開されている案件はありません。</div>
      <?php else: ?>
        <div class="jobs">
          <?php foreach ($cases[$tab] as $c) render_card($c, $GROUP_ORDER, $IMG_EXT); ?>
        </div>
      <?php endif; ?>
    </div>
    <?php endforeach; ?>

    <footer>庄司石材 外注ポータル — 閲覧専用</footer>
  </div>
</div>

<div id="lightbox" onclick="this.classList.remove('show')"><div class="lb-img"></div><div class="lb-cap">タップで閉じる</div></div>

<script>
  function showTab(t){
    document.querySelectorAll('.maintab').forEach(function(b){ b.classList.toggle('on', b.dataset.t===t); });
    ['kouji','nok','chokoku'].forEach(function(k){ document.getElementById('list-'+k).classList.toggle('hidden', k!==t); });
  }
  function setFilter(s){
    document.querySelectorAll('.seg button').forEach(function(b){ b.classList.toggle('on', b.dataset.f===s); });
    document.querySelectorAll('.card').forEach(function(c){ c.classList.toggle('fhide', c.dataset.st!==s); });
  }
  function openLightbox(el){
    var lb=document.getElementById('lightbox'); var img=lb.querySelector('.lb-img');
    img.style.backgroundImage = el.style.backgroundImage || ('url('+el.getAttribute('href')+')');
    lb.classList.add('show');
    return false;
  }
  setFilter('open');

  // ===== 外注先からの報告 =====
  function _esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function repRefresh(id){
    var fd=new FormData(); fd.append('action','list'); fd.append('case',id);
    return fetch('submit.php',{method:'POST',body:fd}).then(function(r){return r.json();}).then(function(res){
      if(!res||!res.ok) return;
      var box=document.querySelector('.report[data-case="'+id+'"]'); if(!box) return;
      var ph=box.querySelector('.rphotos'); var cl=box.querySelector('.clist');
      ph.innerHTML=(res.photos||[]).map(function(f){
        var href='cases/'+encodeURIComponent(id)+'/'+f.rel.split('/').map(encodeURIComponent).join('/');
        if(f.img) return '<div class="rthumb"><a class="thumb" href="'+href+'" style="background-image:url('+href+')" onclick="return openLightbox(this)"></a><button class="rdel" title="削除" onclick="repDel(\''+id+'\',\''+f.rel.replace(/'/g,"\\'")+'\')">🗑</button></div>';
        return '<a class="file" href="'+href+'" target="_blank" rel="noopener">📎 '+_esc(f.name)+'</a>';
      }).join('');
      var cms=res.comments||[]; var total=cms.length; var showFrom=total>2?total-2:0;
      var more=total>2?'<button type="button" class="cmore" onclick="chatMore(this)">▼ これまでのやり取りを表示（残り'+(total-2)+'件）</button>':'';
      cl.innerHTML=more+cms.map(function(cm,i){
        var mine=!(cm.side==='shoji');
        var cls='cmt '+(mine?'me':'them')+(i<showFrom?' old hide':'');
        var acts=mine?'<span class="cact"><button class="cedit" onclick="repEditComment(\''+id+'\','+i+')">✏ 編集</button><button class="cdel" onclick="repDelComment(\''+id+'\','+i+')">🗑 削除</button></span>':'';
        return '<div class="'+cls+'" data-idx="'+i+'"><div class="cmeta"><span class="cwho">'+(mine?'自分':'庄司石材')+'</span><span>'+_esc(cm.at)+'</span>'+acts+'</div><div class="bubble">'+_esc(cm.text)+'</div></div>';
      }).join('');
    }).catch(function(){});
  }
  function chatMore(btn){ var cl=btn.parentNode; var exp=cl.classList.toggle('expanded'); cl.querySelectorAll('.old').forEach(function(m){ m.classList.toggle('hide',!exp); }); var n=cl.querySelectorAll('.old').length; btn.textContent=exp?'▲ 折りたたむ':'▼ これまでのやり取りを表示（残り'+n+'件）'; }
  function repGrow(t){ t.style.height='auto'; t.style.height=Math.min(t.scrollHeight,200)+'px'; }
  function repComment(id){
    var inp=document.getElementById('rc-'+id); var t=(inp.value||'').trim(); if(!t) return;
    var fd=new FormData(); fd.append('action','comment'); fd.append('case',id); fd.append('text',t);
    fetch('submit.php',{method:'POST',body:fd}).then(function(r){return r.json();}).then(function(res){
      if(res&&res.ok){ inp.value=''; inp.style.height='auto'; repRefresh(id); } else alert('送信失敗: '+((res&&res.error)||''));
    }).catch(function(){ alert('送信に失敗しました'); });
  }
  function repEditComment(id, idx){
    var box=document.querySelector('.report[data-case="'+id+'"] .cmt[data-idx="'+idx+'"] .bubble');
    var cur=box?box.textContent:'';
    var t=prompt('コメントを編集', cur); if(t===null) return; t=t.trim(); if(!t) return;
    var fd=new FormData(); fd.append('action','editcomment'); fd.append('case',id); fd.append('idx',idx); fd.append('text',t);
    fetch('submit.php',{method:'POST',body:fd}).then(function(r){return r.json();}).then(function(res){
      if(res&&res.ok) repRefresh(id); else alert('編集失敗: '+((res&&res.error)||''));
    }).catch(function(){ alert('編集に失敗しました'); });
  }
  function repDelComment(id, idx){
    if(!confirm('このコメントを削除しますか？')) return;
    var fd=new FormData(); fd.append('action','delcomment'); fd.append('case',id); fd.append('idx',idx);
    fetch('submit.php',{method:'POST',body:fd}).then(function(r){return r.json();}).then(function(res){
      if(res&&res.ok) repRefresh(id); else alert('削除失敗: '+((res&&res.error)||''));
    }).catch(function(){ alert('削除に失敗しました'); });
  }
  function repUpload(inp, id){
    var files=inp.files; if(!files||!files.length) return; var arr=Array.prototype.slice.call(files); var i=0;
    (function next(){
      if(i>=arr.length){ inp.value=''; repRefresh(id); return; }
      var f=arr[i++]; if(!/^image\//.test(f.type)){ next(); return; }
      var fd=new FormData(); fd.append('action','upload'); fd.append('case',id); fd.append('file',f,f.name);
      fetch('submit.php',{method:'POST',body:fd}).then(function(r){return r.json();}).then(function(){ next(); }).catch(function(){ next(); });
    })();
  }
  function repDel(id, rel){
    if(!confirm('この報告写真を削除しますか？')) return;
    var fd=new FormData(); fd.append('action','del'); fd.append('case',id); fd.append('path',rel);
    fetch('submit.php',{method:'POST',body:fd}).then(function(r){return r.json();}).then(function(res){
      if(res&&res.ok) repRefresh(id); else alert('削除失敗: '+((res&&res.error)||''));
    }).catch(function(){ alert('削除に失敗しました'); });
  }
  // 完了報告の登録／取消
  function progSet(id, date, done){
    if(done && !date){ alert('日付を選んでください'); return; }
    if(!done && !confirm('完了報告を取り消しますか？')) return;
    var fd=new FormData(); fd.append('action','progress'); fd.append('case',id); fd.append('done',done?'1':'0'); if(done) fd.append('date',date);
    fetch('submit.php',{method:'POST',body:fd}).then(function(r){return r.json();}).then(function(res){
      if(!res||!res.ok){ alert('保存失敗: '+((res&&res.error)||'')); return; }
      var prog=document.querySelector('.prog[data-case="'+id+'"]');
      var box=prog?prog.querySelector('.pbody'):null; if(!box) return;
      var card=prog.closest('.card');
      if(res.progress && res.progress.done){
        box.innerHTML='<span class="pdone">✅ 完了 '+_esc(res.progress.date)+'</span><button class="pundo" onclick="progSet(\''+id+'\',\'\',0)">取消</button>';
        if(card) card.dataset.st='done';
      } else {
        var today=new Date().toISOString().slice(0,10);
        box.innerHTML='<input type="date" class="pdate" id="pg-'+id+'" value="'+today+'"><button class="pbtn" onclick="progSet(\''+id+'\',document.getElementById(\'pg-'+id+'\').value,1)">完了にする</button>';
        if(card) card.dataset.st='open';
      }
      // 現在のフィルタで表示/非表示を再適用（完了⇄未完タブへ移動）
      var cur=document.querySelector('.seg button.on'); setFilter(cur?cur.dataset.f:'open');
    }).catch(function(){ alert('保存に失敗しました'); });
  }
</script>
</body>
</html>

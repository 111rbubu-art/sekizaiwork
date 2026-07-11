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
    if (in_array($n, array('.','..','case.json'), true) || is_hidden($n)) continue;
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

// 案件を収集
$cases = array('kouji'=>array(), 'nok'=>array(), 'chokoku'=>array());
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
    $type = isset($c['type']) ? $c['type'] : 'kouji';
    if (!isset($cases[$type])) $type = 'kouji';
    $c['_id']     = $d;
    $c['_groups'] = collect_groups($cp, $d);
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

  echo '<article class="card" data-st="'.h($status).'">';
  // ヘッダー（お寺名＋家名を同じ行）
  echo '<div class="head"><h2>';
  if ($temple !== '') echo '<span class="temple">'.h($temple).'</span>　';
  echo h($head).'</h2>';
  echo '<div class="chips">';
  if (!empty($c['category'])) echo '<span class="chip">'.h($c['category']).'</span>';
  if (!empty($c['state']))    echo '<span class="chip state">'.h($c['state']).'</span>';
  echo '</div>';
  // 日付行
  echo '<div class="srow">';
  if ($status === 'done') echo '<span class="pill done">完了</span>';
  if (!empty($c['date'])) {
    echo '<span class="due"><span class="tag">'.h(isset($c['dateLabel'])?$c['dateLabel']:'納期').'</span> ';
    echo '<b class="tnum">'.h($c['date']).'</b>';
    if (!empty($c['time'])) echo ' <b class="tnum">'.h($c['time']).'</b>';
    echo '</span>';
  }
  echo '</div></div>';

  // 彫刻箇所などのコメント
  if (!empty($c['note'])) {
    echo '<div class="note"><div class="nlbl">'.h(isset($c['noteLabel'])?$c['noteLabel']:'メモ').'</div>';
    echo '<div class="ntxt">'.nl2br(h($c['note'])).'</div></div>';
  }

  // 資料（地図/図面/写真/資料）
  $groups = isset($c['_groups']) ? $c['_groups'] : array();
  if (count($groups)) {
    // 表示順を整える
    $ordered = array();
    foreach ($GROUP_ORDER as $g) if (isset($groups[$g])) { $ordered[$g] = $groups[$g]; unset($groups[$g]); }
    foreach ($groups as $g => $f) $ordered[$g] = $f; // 残り
    echo '<div class="sec">';
    foreach ($ordered as $gname => $files) {
      $dot = ($gname==='地図')?'var(--map)':(($gname==='図面')?'var(--draw)':'var(--photo)');
      echo '<div class="mgroup"><div class="mlabel"><span class="dot" style="background:'.$dot.'"></span>'.h($gname).'</div>';
      // 画像とファイルを分けて描画
      $imgs = array(); $docs = array();
      foreach ($files as $f) { if (in_array(ext_of($f['name']), $IMG_EXT, true)) $imgs[]=$f; else $docs[]=$f; }
      if (count($imgs)) {
        echo '<div class="thumbs">';
        foreach ($imgs as $f) {
          $href = 'cases/'.urlseg($c['_id']).'/'.urlseg($f['rel']);
          echo '<a class="thumb" href="'.h($href).'" style="background-image:url('.h($href).')" '
             . 'data-cap="'.h(pathinfo($f['name'], PATHINFO_FILENAME)).'" onclick="return openLightbox(this)"></a>';
        }
        echo '</div>';
      }
      if (count($docs)) {
        echo '<div class="files">';
        foreach ($docs as $f) {
          $href = 'cases/'.urlseg($c['_id']).'/'.urlseg($f['rel']);
          $ico = (ext_of($f['name'])==='pdf') ? '📄' : '📎';
          echo '<a class="file" href="'.h($href).'" target="_blank" rel="noopener">'
             . '<span class="ico">'.$ico.'</span> '.h($f['name']).'</a>';
        }
        echo '</div>';
      }
      echo '</div>';
    }
    echo '</div>';
  }

  if (!empty($c['updated'])) {
    echo '<div class="cardfoot"><span class="updated tnum">更新 '.h($c['updated']).'</span></div>';
  }
  echo '</article>';
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
      <button class="maintab on" data-t="kouji" onclick="showTab('kouji')">工事 <span class="n tnum"><?php echo count($cases['kouji']); ?></span></button>
      <button class="maintab" data-t="nok" onclick="showTab('nok')">納骨 <span class="n tnum"><?php echo count($cases['nok']); ?></span></button>
      <button class="maintab" data-t="chokoku" onclick="showTab('chokoku')">彫刻 <span class="n tnum"><?php echo count($cases['chokoku']); ?></span></button>
    </div>
  </div>

  <div class="pad">
    <div class="toolbar">
      <div class="seg"><button class="on" data-f="open" onclick="setFilter('open')">未完</button><button data-f="done" onclick="setFilter('done')">完了</button></div>
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
</script>
</body>
</html>

<?php
/*
 * 外注先向け 案件資料 閲覧ページ（さくらのレンタルサーバ / PHP）
 * -------------------------------------------------------------
 * このファイルを各外注先フォルダー（例: /gaichu/a-sha/）に置きます。
 * 同じフォルダーの中に「案件ごとのサブフォルダー」を作り、
 * その中に 地図/図面/写真 などのファイル（またはサブフォルダー）を入れます。
 *
 * 例:
 *   a-sha/
 *     index.php            ← このファイル
 *     .htaccess            ← パスワード（Basic認証）
 *     山田家墓石工事/
 *       info.txt           ← 任意（案件名・納期・メモ）
 *       地図/  *.jpg,pdf
 *       図面/  *.pdf
 *       写真/  *.jpg
 *
 * info.txt の書式（任意・1行1項目）:
 *   案件名: 山田家 墓石工事
 *   納期: 2026/08/10
 *   メモ: 図面は最新版のみ参照してください
 */

mb_internal_encoding('UTF-8');
$BASE = __DIR__;
$SELF = basename(__FILE__);
$HIDE = array('.', '..', $SELF, '.htaccess', '.htpasswd', 'robots.txt', 'index.html', 'info.txt');

$IMG_EXT = array('jpg','jpeg','png','gif','webp','bmp','heic');

function h($s){ return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); }
function urlseg($s){ return implode('/', array_map('rawurlencode', explode('/', $s))); }
function ext_of($f){ return strtolower(pathinfo($f, PATHINFO_EXTENSION)); }
function is_hidden($name){ return (substr($name,0,1) === '.'); }

function parse_info($path){
  $info = array();
  if (is_file($path)) {
    $lines = file($path, FILE_IGNORE_NEW_LINES);
    if ($lines) foreach ($lines as $ln) {
      if (preg_match('/^\s*([^:：]+)[:：]\s*(.*)$/u', $ln, $m)) {
        $info[trim($m[1])] = trim($m[2]);
      }
    }
  }
  return $info;
}

// 案件（直下のサブフォルダー）を収集
$jobs = array();
$entries = scandir($BASE);
if ($entries) foreach ($entries as $name) {
  if (in_array($name, $HIDE) || is_hidden($name)) continue;
  $full = $BASE . '/' . $name;
  if (!is_dir($full)) continue;
  $info = parse_info($full . '/info.txt');
  $jobs[] = array(
    'dir'      => $name,
    'title'    => (isset($info['案件名']) && $info['案件名'] !== '') ? $info['案件名'] : $name,
    'deadline' => isset($info['納期']) ? $info['納期'] : '',
    'note'     => isset($info['メモ']) ? $info['メモ'] : '',
    'path'     => $full,
  );
}

// 納期の昇順（空は最後）
usort($jobs, function($a, $b){
  if ($a['deadline'] === '' && $b['deadline'] === '') return strcmp($a['title'], $b['title']);
  if ($a['deadline'] === '') return 1;
  if ($b['deadline'] === '') return -1;
  return strcmp($a['deadline'], $b['deadline']);
});

// 案件内のファイルを「サブフォルダー名」でグループ化（直下ファイルは「資料」）
function collect_groups($jobPath){
  $groups = array();
  $root = array();
  $items = scandir($jobPath);
  if ($items) foreach ($items as $n) {
    if (in_array($n, array('.','..','info.txt')) || is_hidden($n)) continue;
    $p = $jobPath . '/' . $n;
    if (is_file($p)) { $root[] = $n; }
    else if (is_dir($p)) {
      $sub = array();
      $items2 = scandir($p);
      if ($items2) foreach ($items2 as $n2) {
        if (in_array($n2, array('.','..')) || is_hidden($n2)) continue;
        if (is_file($p . '/' . $n2)) $sub[] = $n . '/' . $n2;
      }
      if (count($sub)) $groups[$n] = $sub;
    }
  }
  if (count($root)) $groups['資料'] = $root;
  return $groups;
}
?>
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="robots" content="noindex,nofollow">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>案件資料</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,"Segoe UI","Hiragino Kaku Gothic ProN",Meiryo,sans-serif;color:#1a2535;background:#f0f2f5}
  header{background:#1a2535;color:#fff;padding:14px 16px;position:sticky;top:0;z-index:5}
  header h1{margin:0;font-size:17px}
  header .sub{font-size:12px;color:rgba(255,255,255,.7);margin-top:2px}
  main{max-width:1000px;margin:0 auto;padding:16px}
  .job{background:#fff;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.08);margin-bottom:16px;overflow:hidden}
  .job h2{margin:0;padding:12px 16px;font-size:16px;background:#eef1f5;border-bottom:1px solid #e2e5ea}
  .meta{padding:8px 16px 0;display:flex;gap:14px;flex-wrap:wrap;align-items:center}
  .deadline{display:inline-block;background:#fff3e6;color:#b45309;border:1px solid #f0c992;border-radius:8px;padding:3px 10px;font-size:13px;font-weight:700}
  .note{font-size:13px;color:#555}
  .group{padding:10px 16px 4px}
  .gname{font-size:13px;font-weight:700;color:#46536b;margin-bottom:8px;border-left:3px solid #d97706;padding-left:8px}
  .files{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:8px}
  .thumb{display:block;width:120px;height:120px;border-radius:8px;overflow:hidden;border:1px solid #ddd;background:#fafafa}
  .thumb img{width:100%;height:100%;object-fit:cover;display:block}
  .file{display:inline-flex;align-items:center;gap:6px;padding:9px 12px;background:#f5f6f8;border:1px solid #dde1e7;border-radius:8px;font-size:13px;color:#1a2535;text-decoration:none;max-width:100%}
  .file:hover,.thumb:hover{opacity:.85}
  .empty{padding:14px 16px;color:#888;font-size:13px}
  footer{max-width:1000px;margin:0 auto;padding:8px 16px 30px;color:#aaa;font-size:11px}
</style>
</head>
<body>
<header>
  <h1>📁 案件資料</h1>
  <div class="sub">閲覧のみ。ダウンロード・印刷は各ファイルから行えます。</div>
</header>
<main>
<?php if (!count($jobs)): ?>
  <div class="job"><div class="empty">現在、閲覧できる案件はありません。</div></div>
<?php else: foreach ($jobs as $job):
  $groups = collect_groups($job['path']);
?>
  <section class="job">
    <h2><?php echo h($job['title']); ?></h2>
    <?php if ($job['deadline'] !== '' || $job['note'] !== ''): ?>
    <div class="meta">
      <?php if ($job['deadline'] !== ''): ?><span class="deadline">納期 <?php echo h($job['deadline']); ?></span><?php endif; ?>
      <?php if ($job['note'] !== ''): ?><span class="note"><?php echo h($job['note']); ?></span><?php endif; ?>
    </div>
    <?php endif; ?>
    <?php if (!count($groups)): ?>
      <div class="empty">（ファイルはまだありません）</div>
    <?php else: foreach ($groups as $gname => $files): ?>
      <div class="group">
        <div class="gname"><?php echo h($gname); ?></div>
        <div class="files">
        <?php foreach ($files as $rel):
          $href = urlseg($job['dir']) . '/' . urlseg($rel);
          $ext = ext_of($rel);
        ?>
          <?php if (in_array($ext, $IMG_EXT)): ?>
            <a class="thumb" href="<?php echo h($href); ?>" target="_blank" rel="noopener"><img loading="lazy" src="<?php echo h($href); ?>" alt=""></a>
          <?php else: ?>
            <a class="file" href="<?php echo h($href); ?>" target="_blank" rel="noopener"><?php echo ($ext==='pdf'?'📄':'📎'); ?> <?php echo h(basename($rel)); ?></a>
          <?php endif; ?>
        <?php endforeach; ?>
        </div>
      </div>
    <?php endforeach; endif; ?>
  </section>
<?php endforeach; endif; ?>
</main>
<footer>外注先専用 / 無断転載・第三者への共有はご遠慮ください。</footer>
</body>
</html>

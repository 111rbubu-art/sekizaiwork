# 引継ぎメモ — 彫刻原稿（chokoku-genko.html）

最終更新: 2026-08-31　**chokoku-genko.html = v3.7**／**index_b.html = v1.9.414**

新しいセッションを始めたら、まずこのファイルを読んでください。
（アプリ全体の古い資料は `HANDOFF.md`。バージョン記述が v1.9.073 のまま古いので注意）

---

## いまの状態

- ブランチ `claude/init-project-setup-smotz-00s2gp` と `main` は同じ内容（`1738eba`）
- 未コミットの変更なし。**すべて GitHub に反映ずみ**
- GitHub Pages に配信ずみ（`.deploy-trigger` 更新まで完了）

## 作業の進め方（毎回この手順）

1. `chokoku-genko.html` を直す
2. `var APP_VER` と `<title>` のバージョンを上げる
3. 中の `<script>` を取り出して `node --check` で構文確認
4. コミット → `git fetch origin main && git rebase origin/main`
5. `git push -u origin claude/init-project-setup-smotz-00s2gp --force-with-lease`
   と `git push origin claude/init-project-setup-smotz-00s2gp:main` の両方
6. `mcp__github__create_or_update_file` で `.deploy-trigger` を更新（Pages の再生成用）
7. `git fetch origin main && git merge --ff-only origin/main && git push -u origin <branch>`

`mcp__github__*` はよく切断されるので、使う直前に ToolSearch で取り直すこと。

## テスト

Playwright のテスト一式がコンテナ内の作業用ディレクトリにありました（t51〜t82、824項目）。
**コンテナが破棄されると消えます。** 新しいセッションでは作り直しになります。

やり方：`python3 -m http.server 8899` でリポジトリを配信し、
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome` を `playwright-core` から起動して
`http://127.0.0.1:8899/chokoku-genko.html` を開く。
SharePoint は `ctx.route('https://graph.microsoft.com/**')` で差し替える。

## 最近直したこと（v3.0〜v3.7）

| 版 | 内容 |
|----|------|
| v3.0 | 作字画面：ダイヤルで拡大・縮小、中ボタンで移動、右クリックメニュー |
| v3.1 | 確認資料に作字が反映されない不具合。実寸mm・横倍率・上下の合わせ方もゴムシートに統一 |
| v3.2 | 確認資料の水色の破線を、ガイドのチェックが入っているときだけ出す |
| v3.3 | 右クリックメニューが作字画面の裏に回っていた（z-index 70→90）／囲んで選ぶ |
| v3.4 | フォントの記憶が消える件。`navigator.storage.persist()` と書き込み失敗の通知 |
| v3.5 | 確認資料に直しが出ない／拓本取込を「SP取込」に／テンプレートの〔追加〕 |
| v3.6 | テンプレートで足したガイドラインが拓本解析に出ない（`centersPx` の数が合っていなかった） |
| v3.7 | 囲んだ枠を残し、四隅で拡大・縮小。画面拡大のボタンは削除 |

## 気をつけるところ

- **`S.rub.centersPx` と `S.centers` は数をそろえる**。拓本解析は centersPx をたどって
  線を描くので、ずれると線が出ない。`padCentersPx()` が面倒を見る
- **出力（プロッター）の線幅**は、縮小して置くパスだと縮尺のぶん細くなる。
  `penAttr()` で打ち消している。赤 `#FF0000`／黒 `#000000`、太さ 0.12mm、塗りなし
- **プロッターの位置ズレ**は「ゴムシート」パネルの位置補正で直す（端末ごとに localStorage）
- **共有フォルダーのファイル名**は濁点の書き方が違うことがある。`sameName()` で比べる
- **テンプレートと作字ライブラリ**は SharePoint の `/業務アプリ/アプリ使用フォント` に置く

## 残っている宿題

- `data_kugayama.js`（264名の氏名）が **git の履歴に残っている**。HEAD からは消したが
  履歴の削除は未実施（本人の明示的な承諾が要る）
- このリポジトリは **公開**。`HANDOFF.md` に運用アカウントのアドレスと
  SharePoint の各種 ID が書かれている
- さくらインターネットへの移設（手動アップロードの方針）。
  移設したら `loadMapDataFromScript` のURLを書き換え、Entra ID にリダイレクトURIを追加
- `gaichu-portal/index.php`(v1.2.2)、`upload.php`(v18)、`submit.php`(v3) のアップロード
- 工事関連データタブの「彫刻記入用紙返却／彫刻校正確定／彫刻納品」ゾーン

## 触ってはいけないもの

- `docker compose down -v`（Dify のデータが消える）
- `tailscale funnel`（インターネット全体に公開される）
- LLMサーバー・管理PCの Tailscale ログアウト

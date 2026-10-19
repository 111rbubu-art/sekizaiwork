# sekizaiwork — 作業の決まり（新しいセッションは まずここを読む）

石材業務の アプリ群（静的 HTML・Netlify）と、拓本AI サーバー（`takuhon-ai/`・社内の GPU 機）。

## 最初に読むもの
- `HANDOFF.md` … ぜんたいの 引継ぎ（業務アプリ index / index_b / map など）
- `HANDOFF-chokoku-genko.md` … 彫刻原稿（`chokoku-genko.html`）と 拓本AI の 引継ぎ。**末尾が いちばん新しい**。3 行目に いまの版
- `takuhon-ai/README.md` … 拓本AI サーバー（学習・API・update.sh）
- `gaichu-portal/SYSTEM.md` … 外注ポータル（さくらの PHP と 業務アプリの［🌐 外注公開］）の しくみ・API・移植の 手引き

## 守ること（いつも）
- **このリポジトリは 公開**。新しく書くもの（コード・コメント・コミット・HANDOFF）に アカウントのアドレス・パスワード・トークン・**個人名**を 入れない
- FTP のパスワードや `.htsecret` は リポジトリにも チャットにも 書かない
- 触ってはいけない：`docker compose down -v`（Dify のデータが消える）・`tailscale funnel`・LLM サーバー／管理 PC の Tailscale ログアウト
- プルリクエストは 頼まれたときだけ
- 給与は チャットに 書かない。メールの署名は `{差出人}`
- コミット・PR・コードに モデル名を 書かない

## 進め方（本人の 好み）
- 返事は 日本語。解析の しくみを 変える 前に、**報告と 図**（PNG を 送る）で 見立てを 見せる
- 新しい 判定・作り方は **「比べる・ためす」の ためし（既定 なし）** で 入れ、本人が 確かめてから 既定に する
- 本人の 画像・数字への 返事では、どれが 正しく どれが まちがいか を はっきり 分けて 言う

## 彫刻原稿（chokoku-genko.html）を 直したときの 配信
1. `var APP_VER = "v5x.x";` を 上げる
2. `sed -i '3s/chokoku-genko.html = v[0-9.]*/chokoku-genko.html = vX/' HANDOFF-chokoku-genko.md`
3. `HANDOFF-chokoku-genko.md` の 末尾に `### vX …` の 項（本人の 言葉・見立て・変えた 所・テスト）、`HANDOFF.md` の 末尾に 1 行
4. 文法の 確かめ：`<script>` の 中身を 抜き出して `node --check`
5. `date +%s > .deploy-trigger`
6. 日本語で コミット → **作業ブランチと main の 両方に push**（main が Netlify に 出る）
   `git push -u origin <作業ブランチ> && git push origin <作業ブランチ>:main`（失敗したら 2・4・8・16 秒 あけて やり直す）

## 拓本AI サーバー（takuhon-ai/）
- 更新は **本人が** GPU 機で `bash /opt/takuhon-ai/update.sh`（**main から** 取る）。クラウドの セッションからは 届かない（社内・Tailscale）
- 夜 02:30 に 学習（`train-nightly.sh`：墨・枠・枠の ためし・読み）。モデルは よくなったときだけ 差し替わる
- サーバーを 変えたら、本人に update.sh を お願いする（いつから 効くか も 言う）

## テストの しかた
- 画面：リポジトリの 根で `(setsid python3 -m http.server 8899 >/dev/null 2>&1 &)`、止めるのは
  `for p in $(pgrep -f "^python3 -m http.server 8899"); do kill $p; done`（`pkill -f` は 使わない）
- Playwright は `/opt/node22/lib/node_modules/playwright`（Chromium は 入っている）。拓本AI は `fetch` を 置きかえた 仮の サーバーで 試す
- 業務アプリを 開くときは `addInitScript` で `window.msal` の 仮を 置く（無いと とちゅうで 止まり、あとの 変数が できない）。外への 通信は `page.route` で 止める
- AI（Ollama）を 使う しくみは `fetch` を 置きかえて `/api/tags`・`/api/chat` に 仮の 答えを 返して 試す。本物の AI の 出来は 本人に 試して もらう
- pdf.js（cdnjs）は ここから 届かない。試すときは scratchpad で `npm pack pdfjs-dist@3.11.174` して `page.route` で 返す
- 拓本AI の 学習を 試すときは scratchpad に venv を 作り `pip install torch`（PyPI。download.pytorch.org は 届かない）。
  仮の 列（raw.png・ink.png・meta.json）を 作って `train_box.py` を 回す

## いまの 状態（2026-10-19。チャットから プロジェクトへ 移る ときの まとめ）
- 版：彫刻原稿 **v54.6**・業務アプリ（index_b / index）**v1.9.538**・撤去見積（tekkyo.html）**v4.1**。どれも main に 出ている
- 彫刻原稿：解析の 既定は 案 c・d・f（案 a・b・e なし）。v54.4〜54.6 は ゴムシート（ダブルクリックで 編集しない・青の 破線を 出さない・入力は ロックの 対象外）、履歴の ステータスに「お客様再提出」「小修正後ゴム切」
- 拓本AI の 枠（作り 2）：本人の 手での 1000 回で いまの モデルを 越えた（重なり平均 0.831 ＞ 0.711）。**差し替わったかを 本人に 確かめて もらう 途中**（`/api/takuhon/status`・`/api/takuhon/box_chars`）。
  夜は 600 回ずつ 続きから。くわしくは `HANDOFF-chokoku-genko.md` の 末尾
- 業務アプリの 新しい しくみ（本物で まだ 試して いない もの）：
  - 納骨・戒切の 新規作成「📧 メール・FAX から 入力（AI）」（v1.9.536〜538）：メール・お寺から 回って くる メール・FAX の 画像／PDF を AI で 読み、見くらべて 入れる。
    戒名・俗名・命日・享年は 依頼明細の 彫刻内容へ、元の 文は 注意事項メモへ。**本人に 実物（手書きの FAX も）で 試して もらい、まちがう 所を 聞く**
  - 工事関連の 手配先を JSON（`MakerJson`）で 何社でも（段階 2 まで。はじめの 2 社は 前の 列にも 写す）。**段階 3（前の データの 一括 移し替え・見本の 一覧つき）は 本人が 実画面で 確かめてから**
- 本人の 返事 待ち：
  - 右の列の 三 が 案 d で 割れないか（v54.1 で 直した）
  - 再提出の 履歴を JSON 1 列（`ResubLogJson` の 案）に する 件：入れたい 項目と 列を 作るか
  - お寺から 1 通で 何家族分も 来る ことが あるか（あれば 選んで 入れる 形に）
  - 撤去見積の 本間様：合計が 明細より 高い（調整が プラス）。v4.1 から アラートが 出る ので 合計を 直して もらう
- このあと（拓本AI）：③ 正解の 枠の そろえ方（墨に 合わせた 枠で 学ぶ）・字ごとに 墨を 分ける AI（作り 2 で 足りなければ）

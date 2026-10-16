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
- 拓本AI の 学習を 試すときは scratchpad に venv を 作り `pip install torch`（PyPI。download.pytorch.org は 届かない）。
  仮の 列（raw.png・ink.png・meta.json）を 作って `train_box.py` を 回す

## いまの 状態（2026-10-15）
- 彫刻原稿 v54.3 まで 配信ずみ。解析の 既定は 案 c・d・f（案 a・b・e なし）
- 枠の AI の 新しい作り（作り 2＝字の はしを 当てる）と 新しい 物差し（きっちり F1・重なりの 平均・はしの ずれ）を main に 入れた（2026-10-15）。
  update.sh 済み（2026-10-16）。1 回目の ためし（120 回）は いまの モデル（重なり平均 0.711）を 越えず。夜ごとに 続きから 学ぶ。くわしくは `HANDOFF-chokoku-genko.md` の 末尾。
  次に 見る：学習ログ・`/api/takuhon/box_chars`（字ごとの 合い方。日 など 登録の 多い字の 高さ・幅の 比）
- 本人の 返事 待ち：右の列の 三 が 案 d で 割れないか（v54.1 で 直した）
- このあと：③ 正解の 枠の そろえ方（墨に 合わせた 枠で 学ぶ）・字ごとに 墨を 分ける AI（作り 2 で 足りなければ）

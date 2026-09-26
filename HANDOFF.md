# 引継ぎ資料 — sekizaiwork（石材業務管理アプリ）

最終更新: 2026-09-19
**index_b.html = v1.9.454**／**index.html = v1.8.235**／**chokoku-genko.html = v23.2**

> 彫刻原稿（chokoku-genko.html）の最近の作業は `HANDOFF-chokoku-genko.md` にまとめています。
> そちらを先に読んでください。

## ファイルの ⋯ メニューに「ダウンロード」（v1.9.436。本人の指示）

データタブのファイルを、そのまま手元に落とせるようにした。

- `downloadFolderFile(filePath, name)`：`/drives/{id}/root:{path}:/content` を
  受け取って `_saveBlobAs()` で保存。**直リンクを `<a download>` に渡さない**。
  よそのアドレスなので download が効かず、画面で開くだけになることがある
- `downloadSpFile(spUrl, name)`：SP添付はドライブではないので `download=1` を付けて開く
- 足した先：フォルダー（`_showFolderItemMenu`。ファイルのときだけ）／
  写真・資料（`_showNokPhotoItemMenu`）／SP添付（`_showAttachmentItemMenu`）／
  写真・図面（`_showHakaSpecItemMenu`）
- 実測：4 つとも ⬇️ダウンロードが並ぶ。呼び先は …/content、保存名はファイル名、
  blob から保存。SP添付は download=1 付きで開く

## 納骨リストの分類「彫刻校正」（v1.9.434／v1.8.234。本人の指示）

業者間の仕事なので、今までの入力とは要るものが違う。**分類で出し入れする**ようにした。

- 新規入力の分類に **彫刻校正** を足した（`#ni-bunrui`）
- `niApplyBunrui()`：彫刻校正のとき **隠す** … 資料郵送先ぜんぶ／納骨グループ／
  フリガナ／電話番号／顧客No／顧客リストID／墓石情報（index_b のみ）。
  **出す** … 戒切納期（`_x6212__x5207__x7d0d__x671f_`。YYYY/MM/DD で保存）
- 隠した欄は**値も空にする**。`niVal()` は隠れている欄を空として読むので、
  打ちかけが残っていても登録されない
- 一覧の札：納骨の札は出さない（`hasNok`）。かわりに**彫刻の進捗の札**を
  「校正」という名前で出す（`bunrui2 === '彫刻校正'` を彫刻進捗の条件に足した）
- 詳細画面：**墓石確認タブを出さない**。資料郵送先の節も出さない
- index.html と index_b.html の両方に同じ手当てを入れてある

### 詳細画面（v1.9.435／v1.8.235。本人が画面を見ての指示）

- 基本情報：フリガナ・電話番号・顧客No・顧客リストID を出さず、**○○家
  （`_x304a__x5893__x306e__x540d__x7f` お墓の名義）**を出す。
  index_b はカードの並びを prefix ごとに覚えるので、`NK_T0B_CARDS_CHO` を
  **'t0bc'** という別の prefix で出し、ふつうの並び（t0b）を壊さない
- 進捗・請求：**彫刻進捗の節をひらいた状態**にする
  （`_NK_SEC_RULES` の `choukoku_progress` と `choukoku` に '彫刻校正' を足した）
- 実測：彫刻校正 → フリガナ無／電話番号無／顧客No無／顧客リストID無／○○家有／
  顧客名有／お寺有／資料郵送先無、彫刻進捗ひらいている。納骨は今までどおり

残り：SharePoint 側の選択肢に「彫刻校正」が要る（本人が追加ずみ）。
モーダルの題は「新規作成（納骨・戒切）」のまま。

> **このリポジトリは公開です。** アカウントのアドレス、SharePoint のサイトURL、
> リストやドライブの ID は、この資料には書きません。値が必要なときは
> アプリのソース内の定数を見るか、管理者に確認してください。

---

## プロジェクト概要

- **リポジトリ**: `111rbubu-art/sekizaiwork`
- **開発ブランチ**: `claude/init-project-setup-smotz-00s2gp`
  （コミット後、このブランチと `main` の両方に push する）
- **GitHub MCP**: セッション内で `mcp__github__*` ツールが使える。よく切断されるので、
  使う直前に ToolSearch で取り直すこと
- **MCP対象リポジトリ**: `111rbubu-art/sekizaiwork`（他リポジトリへのアクセス不可）
- **主なアプリファイル**:
  - `index_b.html` — 本体（約27,000行）
  - `chokoku-genko.html` — 彫刻原稿
  - `map_b.html` / `receipt.html` / `gaikanri.html` / `tekkyo.html` ほか
- **SharePoint**: サイトURL・各リストID・ドライブIDは、`index_b.html` の先頭付近の定数で
  定義しています（`KOUJI_LIST_ID` / `nokListId` / `cusListId` / `DRIVE_ID`）
- **認証アカウント**: 社員用と法人カレンダー用の2つ。アドレスは管理者に確認してください

---

## 主要定数（index_b.html 内）

値は伏せています。行番号は目安です。

| 定数 | 用途 | 行番号付近 |
|------|------|-----------|
| `APP_VERSION` | アプリの版（手動で上げる） | ~4815 |
| `KOUJI_LIST_ID` | 工事関連リスト | ~818 |
| `nokListId` | 納骨リスト | ~1409 |
| `cusListId` | 顧客リスト | ~14315 |
| `DRIVE_ID` | ドキュメントライブラリ | ~14518 |
| `_GCAL_CALENDAR_ID` | Google カレンダー | ~4607 |

---

## 画面構成

- **工事関連リスト** (`renderKoujiList`): 左側カード一覧
- **納骨リスト** (`renderNokList`): 左側カード一覧
- **詳細パネル** (`showKoujiDetail` / `showNokDetail`): 右側詳細
- **ファイル整理パネル** (`_fmgr` オブジェクト): サブウィンドウ
- **資料作成** (テンプレートエンジン): PDF/JSON保存
- **施工計算** (`calcFoundation` / `openFoundCalcAsDoc`): 基礎計算・A4出力
- **彫刻原稿** (`openChokokuGenko`): 納骨リストの資料作成タブから開く別ウィンドウ

---

## 工事関連リストカードのステータスタグ（~行8456付近）

### 石材① (`stoneTag1`)
- **表示条件**: `Creator`入力済み & `ConstructionCompletionDate`（工事完了日）空欄
- 判定（下から順、最進優先）:
  1. `PickUp1 === true` → `石材①: 済`（緑塗り）
  2. `MaterialDelivery`あり → `石材①: MM/DD 納入予定`（緑枠）
  3. `OrderingMaterials`あり → `石材①: 納入未定`（黄枠）
  4. `DrawingCompleted`あり → `石材①: 未発注`（赤枠）
  5. それ以外 → `石材①: 図面製作中`（橙枠）

### 石材② (`stoneTag2`)
- 同じロジック、フィールドが `Creator2` / `DrawingCompleted2` / `OrderingMaterials2` / `MaterialDelivery2` / `PickUp2`

### 彫刻 (`choukokuTag`)
- **表示条件**: `SendingSculptureMaterials`入力済み & 工事完了日空欄
- 判定（下から順、最進優先）:
  1. `DeliveredByEngraver`あり → `彫刻: MM/DD 納品済`（緑枠）
  2. `HandingEngraver`あり → `彫刻: 納品未定`（黄枠）
  3. `DecideSculpture`あり → `彫刻: 引渡待ち`（赤枠）
  4. `ManuscriptSubmission2`あり & `ReturnManuscripts2`なし → `彫刻: ②返却待ち`（橙枠）
  5. `ReturnManuscripts1`あり → `彫刻: 確定待ち`（赤橙枠）
  6. `ManuscriptSubmission1`あり → `彫刻: ①返却待ち`（橙枠）
  7. `ReturnSculptureMaterials`あり → `彫刻: 校正中`（青枠）
  8. それ以外 → `彫刻: 用紙返却待ち`（灰枠）

---

## 詳細パネルの編集システム

- **工事関連**: `toggleKoujiEdit(d, tabIdx)` → `localEdits` → PATCH（~行14431）
  - ブール変換対象: `['PickUp1', 'PickUp2']`（~行14448）
- **納骨・その他**: `toggleEditMode(d, tabIdx)` → `localEdits` → PATCH（~行18442）
  - ブール変換対象: `['_x524a__x9664_', 'check', 'DelRedText', 'FinDelRedText', '_x6731__x6709__x7121_']`（~行18477）
- **チェックボックスフィールド**: `bfld(label, itemId, field, val)` 関数（~行18238）
- **一般フィールド**: `efld(label, itemId, field, val, wide, multiline, span, labelToday)` 関数（~行18256）

### カードグループ定義（~行18900付近）
- `KOUJI_T2A_CARDS`: 部材注文①（手配先①〜引取済①）
- `KOUJI_T2B_CARDS`: 部材注文②（手配先②〜引取済②）
- `KOUJI_T2C_CARDS` 以降: 彫刻関係、契約情報等

---

## ファイル整理パネル（`_fmgr`）

- `openFileMgrPanel(item, listMode)`: 通常のファイル整理パネルを開く
- `openSubmissionFolder(item, listMode)`: 提出資料サブフォルダーを表示して開く
- `_fmgrOpenFile(i)`: ファイルをダブルクリックで開く
- `_fmgrDropOnPanel(event)`: ドロップ処理（アプリ内＋Windowsエクスプローラー外部ファイル対応）

---

## 彫刻原稿への受け渡し（`openChokokuGenko`）

- 納骨リストの「資料作成」タブ →「✒️ 彫刻原稿」で別ウィンドウを開く
- 渡すもの: 工事フォルダのパス、寺名・家名・納骨日、彫刻予定場所、石塔彫刻位置・行目、
  墓誌場所・行目
- **sessionStorage はウィンドウごとに別物**なので、開いた直後に
  `w.__chokokuApplyHandoff(payload)` で直接渡している
- 彫刻原稿側は自前のサインインを持たず、`window.opener._chokokuGenkoToken()` で
  親ウィンドウのトークンを借りる

---

## Google Calendar

- カレンダーID・サインインに使うアカウントは、アプリ内の定数を参照（この資料には書かない）
- 認証: OAuth2 Implicit Flow
- 登録関数: `registerGcalEvent(forceRegister)`
- GCal対象: 納骨リストのみ（`currentListMode === 'noukotsu'`）
- テストユーザー: Google Cloud Console → OAuth同意画面 → ユーザー追加 が必要

---

## 資料作成（PDF保存）のデフォルトファイル名

```
YYYYMMDD_＜テンプレートベース名の__区切り最終グループ＞__〇〇家__工事内容
```
- 工事内容が空欄なら「分類（category）」を使用
- 途中保存(.json)も同じ命名規則

---

## 未着手・将来タスク

- **石材②展開確認**: v1.9.065で追加済み、実データで動作確認
- **引取済①②の動作確認**: SPの`PickUp1`/`PickUp2`フィールドとの疎通確認
- **さくらインターネットへの移設**（手動アップロードの方針）。移設したら
  `loadMapDataFromScript` のURLを書き換え、Entra ID にリダイレクトURIを追加
- `gaichu-portal/index.php`(v1.2.2)、`upload.php`(v18)、`submit.php`(v3) のアップロード
- 工事関連データタブの「彫刻記入用紙返却／彫刻校正確定／彫刻納品」ゾーン

---

## 取り扱いの注意

- **このリポジトリは公開**。新しく書くものに、アカウントのアドレス、パスワード、
  トークン、個人名は入れないこと
- `data_kugayama.js`（264名の氏名）は HEAD から削除ずみだが、**git の履歴には残っている**。
  履歴からの削除は未実施
- `data_*.js` に檀家の姓が約3,200件入っている（姓のみ）
- FTP のパスワードや `.htsecret` は GitHub Secrets か手元の設定ファイルに置く。
  リポジトリにもチャットにも書かない

### 触ってはいけないもの

- `docker compose down -v`（Dify のデータが消える）
- `tailscale funnel`（インターネット全体に公開される）
- LLMサーバー・管理PCの Tailscale ログアウト

---

## 開発メモ

- コミット後は、開発ブランチと `main` の両方に push する
- GitHub Pages の再生成には `.deploy-trigger` の更新が要る
  （`mcp__github__create_or_update_file` で書き換える）
- バージョン番号は手動更新（`index_b.html` は `APP_VERSION`、
  `chokoku-genko.html` は `APP_VER` と `<title>` の両方）
- SP Graph APIの`$expand=fields`で全フィールドを自動取得（`$select`なし）
- ブール型SPフィールドはPATCH時に文字列`"true"`→`boolean true`への変換が必要

## v1.9.442 — AIチャットに［🎤］（声で問い合わせ。2026-09-26）
本人の指示「アプリのAIチャットに音声での問い合わせでテストできませんか」。
- 社内の Ollama の `gemma4:12b` は `ollama show` の Capabilities に **audio** がある（本人の機械で確認）。
- チャットの窓（`openAIChat` の中の文字列）に［🎤］：押すと録音（MediaRecorder）→ もう一度押すと止めて、親の `aiTranscribe(blob)` を呼ぶ。
  文字は **入力欄に入れるだけ**（送るのは人。聞きちがいを直せるように）。
- 親 `aiTranscribe`：`_aiWavB64` で 16kHz・モノラル・16bit の WAV に直し（AudioContext → OfflineAudioContext）、
  Ollama の `/api/chat` に `images:[WAVのbase64]`・`think:false`・`stream:false`・モデルはチャットで選んでいるもの。
  AI の相手が ローカルLLM（provider=`openai`）のときだけ。声は社内の機械から外へ出ない。
- 注意：Ollama v0.30 台で「音声を渡すと考えるモードに入り でたらめを返す」報告があるので think:false にしている。
  マイクは https のページからしか使えない（GitHub Pages は https）。Ollama の口も今のチャットと同じく届くこと。
確かめ（Playwright・偽の Ollama）：WAV は RIFF・16000Hz・1ch・長さそのまま、think:false で届く。
偽のマイクで［🎤］→［⏹］→ 入力欄に文字が入る。実物の聞き取りの具合は未確認。

## v1.9.443 — 声の文字起こしに「ことば帳」（本人の試し：白御影 → 白身影）
読みは合っていて漢字だけ取りちがえる。`aiTranscribe` の指示に「石材店の業務の話。次の言葉がよく出る。音が近ければこの書き方に」と
`AI_VOCAB_BASE`（御影・白御影・黒御影・納骨・戒名・墓誌・棹石・外柵 など）＋ **石材価格表の Title（最大 200）** を付ける。
石材価格表は `_aiVocab()` が画面を開いている間 1 回だけ読む（失敗したら次に読み直す）。3 秒で読めなければ 決まった言葉だけ。
確かめ（偽の Ollama）：指示に 白御影 と 価格表の石の名前 が入る。実物での効き目は未確認。

## v1.9.444 — AIチャットで「○○寺の佐藤家の納骨日」（本人「家を使う事が多いです」）
- 道具 `search_noukotsu`（`_aiSearchNoukotsu`）を足した：`_menuSearchCache.noukotsu_all || noukotsu` から
  顧客名（_x9867__x5ba2__x540d_）か お墓の名義（_x304a__x5893__x306e__x540d__x7f）で探し、寺院（_x304a__x5bfa_）で絞る。
  返すのは 顧客名・お墓（_msHakaLabel）・寺院・納骨日・時間・担当・状態。納骨日の新しい順に 10 件。
- `_aiFamilyQ`：「佐藤家／佐藤家墓／佐藤さん／佐藤様／佐藤家の」→「佐藤」。search_customer・search_noukotsu の両方で使う。
  search_customer は お墓の名前（HakaName）でも当てる。
- 指示（`_aiToolSystemPrompt`）：家・さん・様を外す、寺院は temple に分ける、納骨日は search_noukotsu、の例を足した。
- 声のことば帳に 顧客・納骨データの寺院名（最大 80）を足した。
確かめ（Playwright・作り物のデータ）：慈宏寺の佐藤家 → 2 件（顧客名が佐藤／お墓の名義が佐藤家）、光明院の佐藤は外れる。
実物の LLM がこの道具を選ぶかは 未確認。

## v1.9.445 — 声のお寺の名前・納骨の取りちがえ（本人の試し「じこじの佐藤家の横骨碑について教えて。」）
- `AI_TEMPLE_READ`：地図のお寺（MAP_TEMPLES）の読み（長い「う」を落とした読みも）。`_aiTempleFix` で 聞き取った文の
  ひらがな・カタカナの読みを 漢字の名前に、`_aiTempleName` で AI の検索の temple を 漢字に（search_customer・search_noukotsu）。
  地図に無いお寺は 読みが無いので まだ直らない（足すときは AI_TEMPLE_READ に書く）。
- `AI_HEAR_FIX`：横骨・能骨・脳骨・農骨・膿骨 → 納骨、身影 → 御影。ことば帳に 納骨日・納骨の予定・法要・四十九日 など。
- 指示：「〇〇家の納骨碑について」は 納骨日の質問とみて search_noukotsu（納骨碑は実在の語なので 自動では置きかえない）。
確かめ：「じこじの佐藤家の横骨碑について教えて。」→「慈宏寺の佐藤家の納骨碑について教えて。」、コウミョウイン → 光明院、
temple:"じこじ" でも 慈宏寺の案件 2 件。

## v1.9.446 — 文字起こしは e4b（本人「チャットで e4b は文字変換されるが、12B は音声が添付されていないと言われる」）
Ollama の gemma4:12b は `ollama show` で audio と出るが、音声を受け取れていない。
`_aiSttModel(cfg)`：Ollama の `/api/tags` を 1 回見て、gemma4:e4b → e4b → gemma4:e2b → e2b の順に 入っているものを **文字起こしだけ** に使う
（無ければ チャットのモデル）。localStorage `ai_stt_model` に名前を書けば それを優先。答えるのは チャットで選んだモデルのまま。
確かめ（偽の Ollama：gemma4-gpu・e4b・12b）：チャットが 12b でも 文字起こしは gemma4:e4b に送られる。

## v1.9.447 — 「納骨碑」→「納骨日」（本人「納骨碑は初めて聞きました」）
v1.9.445 で「納骨碑は実在の語なので置きかえない」としたが、ふつう使わない言葉で、業務では 納骨日の聞きちがい。
`AI_HEAR_FIX` に 納骨碑 → 納骨日 を足した。指示の文も「納骨日が別の字（納骨碑など）で聞き取られることがある」に。

## v1.9.448 — お寺の名前の 同じ読み・別の漢字（本人の試し「慈宏寺」→「自校寺」）
`_aiTempleLLMFix(text, model, base, dataTemples)`：文に「〇〇寺・〇〇院・〇〇墓地」があり 知っているお寺と一致しないときだけ、
文字起こしに使ったモデル（e4b）に 文字だけで「このお寺が 下のお寺（読みつき）の聞きちがいなら直す。ほかは変えない」と頼む。
お寺の一覧は AI_TEMPLE_READ（読みつき）＋ ことば帳の寺院名。返りが 元の文と長さが 3 割以上ちがえば 元の文のまま。失敗しても 元の文。
確かめ（偽の Ollama）：「自校寺の佐藤家の納骨日を教えて。」→「慈宏寺の佐藤家の納骨日を教えて。」、知っているお寺だけの文は 頼まない。
実物の e4b が 直せるかは 未確認。

## v1.9.449 — お寺は 読みで照らす（本人の試し「慈宏寺」→「浄因寺」、「浄因寺」→「常人地」）
v1.9.448 の「AI にお寺を選ばせる」（`_aiTempleLLMFix`）は 小さい AI が別のお寺を選んで 逆効果だったので 消した。
- 文字起こしを JSON（`format:'json'`）で返させる：`{text, temple（文に書いた字）, temple_yomi（聞こえたとおりの ひらがな）}`。
  JSON で読めなければ これまでどおり文として扱う。
- `_aiTempleByYomi(yomi)`：AI_TEMPLE_READ の読みと 編集距離（`_aiLev`）で照らす。5 文字以上は 2、それ未満は 1 文字ちがいまで。
  当たれば text の中の temple の字を 正しい名前に置きかえる。そのあと これまでどおり `_aiTempleFix`（かなの読み → 漢字）。
確かめ（偽の Ollama）：{浄因寺, じこうじ} → 慈宏寺、{常人地, じょうじんち} → 浄因寺、光明院 そのまま、お寺なし そのまま。

## v1.9.450 — ことば帳を短く（本人の試し「慈宏寺」→「御影」、浄因寺は正しく出た）
業務の言葉＋寺院名＋価格表の石の名前（最大 200）まで渡していたら、e4b が 聞こえていない言葉まで一覧から選んでいた。
文字起こしの指示に渡すのは お寺（AI_TEMPLE_READ・読みつき）と よく出る言葉 15 個だけ。
「聞こえたとおりに書く。音が一覧の読みとほぼ同じときだけ その書き方。聞こえていない言葉を一覧から入れない」と明記。
石の名前は渡さない（身影 → 御影 は AI_HEAR_FIX）。`_aiVocab` は 文字起こしでは使わなくなった（残してある）。

## v1.9.451 — 文全体の読みから お寺を探す（本人の試し「慈宏寺」→「地蔵地」「自供寺」。安定しない）
- 文字起こしの JSON に `yomi`（文全体の聞こえたとおりの ひらがな）を足した。
- `_aiTempleFromYomi(text, yomi)`：文に登録したお寺の漢字が無いとき、読みの頭 12 文字の中で お寺の読みに近い窓を探し、
  頭（3 文字以内）で当たれば 文の頭の「〇〇の／って／で／は」の 〇〇（6 文字まで）を そのお寺に置きかえる。
- 読みの近さ `_aiYomiDist`：そのままと「ざっくり」（`_aiKanaLoose`：小さい字・ー・う を外す）の 近い方。
  _aiTempleByYomi・_aiTempleFromYomi の両方で使う。
確かめ（偽の Ollama）：地蔵地（じぞうじ）・自供寺（じきょうじ）→ 慈宏寺、常人地 → 浄因寺、ちょうせんじ → 長泉寺、
お寺の無い文・「しんじ」は 変えない。
**小さい AI の聞き取りの限界**：本当に安定させるなら 日本語向けの音声認識（kotoba-whisper など）を GPU の機械に置く案を本人に出した。

## v1.9.452 — AIチャットの 12b は GPU 版（gemma4-gpu）で呼ぶ
本人の `ollama ps`：`gemma4:12b` が **100% CPU / UNTIL Forever**。`gemma4:12b` には `num_gpu` が無く、読み込む瞬間に GPU の空きが
足りないと CPU に載り、そのまま居座る。以前作った `gemma4-gpu` は同じ中身に `PARAMETER num_gpu 99`（全部 GPU）を付けたもの。
しかし チャット右上の切替は `gemma4:12b` を直接呼んでいたので、**gemma4-gpu は誰も呼ばず 起動していなかった**。
- `_ollamaModel(cfg)`：モデルが `gemma4:12b` のとき `/api/tags` を 1 回見て、`gemma4-gpu` があればその名前で呼ぶ（無ければ元のまま）。
  `_ollamaFetch` はこれを通してから `_ollamaFetch2` で送る。設定に保存される名前は `gemma4:12b` のまま（切替の表示は「12b（精・GPU）」）。
- 文字起こしは これまでどおり e4b。
確かめ（偽の Ollama）：12b → `gemma4-gpu:latest`、e4b → そのまま、gemma4-gpu が無い → `gemma4:12b`。

## GPUマシン：Ollama（Docker）が GPU を見失う件（2026-09-26）
症状：`ollama ps` で e4b は 100% GPU なのに、新しく読むモデル（12b など）だけ 100% CPU。GPU の空きは十分（sched.go は「fits」）。
ログに `ggml_cuda_init: failed to initialize CUDA: no CUDA-capable device is detected`、
`docker exec ollama-docker nvidia-smi` → `Failed to initialize NVML: Unknown Error`。
原因：Docker＋NVIDIA の既知の症状。`systemctl daemon-reload`（パッケージ更新などでも起きる）でコンテナが GPU の権利を失う。
すでに GPU をつかんでいた処理は動き続け、後から起動した処理だけ GPU が見えない。
- 直し方：`docker restart ollama-docker`（Dify は別コンテナなので影響なし）。
- 見張り：`/usr/local/bin/ollama-gpu-watch.sh` ＋ `ollama-gpu-watch.timer`（5分おき）。GPU が見えなければ再起動し、
  `journalctl -t ollama-gpu-watch` に記録。入れた直後の daemon-reload で実際に 1 回発動して直った。
- ollama-docker は docker-compose ではなく `docker run` で作られている（作り直すときは元の設定を `docker inspect` で確かめること）。
- 12b を GPU に載せた実際の大きさは 8.4GB（CPU 時の見積もり 13GB）。e4b 4.7GB と拓本AIの学習を足しても 24GB に収まる。
- `num_gpu 99` の gemma4-gpu は原因と無関係だった（v1.9.452 の読み替えは害がないので残してある）。

## v1.9.453 — 声は まず kotoba-whisper（拓本AI のサーバー）で文字にする
e4b に音声を渡す方式は お寺の名前が安定しなかった（慈宏寺→地蔵地・自供寺・御影）。日本語専用の音声認識に替える。
- サーバー：`takuhon-ai/stt.py` ＋ app.py の `POST /api/stt`（JSON `{wav: base64 の WAV, prompt}` → `{text, yomi, sec, ms, model}`）、
  `GET /api/stt/status`。モデル `kotoba-tech/kotoba-whisper-v2.0`（環境変数 `TAKU_STT_MODEL` で替えられる）。
  **初めて呼ばれたときに** Hugging Face から落として読む（約 1.5GB。初回だけ数分）。GPU は半精度で 1.5GB 前後。
  prompt（お寺の名前・業務の言葉）で書き方を寄せる。yomi は pykakasi（寺→じ・〇〇家→け・納骨日→のうこつび に直す）。
  requirements に transformers==4.46.3・pykakasi==2.3.0（update.sh が入れる）。
- 業務アプリ：`aiTranscribe` は ①`ai_stt_url` ②`takuhonAiUrl` ③Ollama が `https://〇〇.ts.net` なら `:8443` の順に
  `/api/stt/status` を確かめ、届いた所へ送る（https の画面から http は候補から外す）。返りを `_aiHearFinish`
  （読みでお寺を照らす・聞きちがい表・読み→漢字）に通す。届かない・失敗なら 今までの Ollama e4b（`_aiTranscribeOllama`）。
  どちらを使ったかは `_aiLastStt`。Ollama でなくても whisper に届けば声を使える。
- 確かめ：偽の whisper（自校寺…納骨碑）→「慈宏寺の佐藤家の納骨日を教えて」、500 → Ollama に回る、届かない → Ollama、
  ts.net → :8443 の候補。本物の app.py を小さい偽モデルで起動し /api/stt が 200・空 wav 400・壊れた wav 400。

## v1.9.454 — whisper の聞き取りを お寺に寄せる（本人の試し）
本人の試し（kotoba-whisper）：「慈宏寺の佐藤家の納骨日を教えて」→「慈宏寺の佐藤家の納骨子」、
「浄因寺の鈴木家の納骨日を教えて」→「上一の鈴木の納骨子」、「白御影の価格を教えて」→ そのまま正しい。
- `納骨子` → `納骨日`（AI_HEAR_FIX）。
- サーバー `stt.head_yomis(text)`：文の頭「〇〇の／って／で／は」の 〇〇 を、漢字 1 字ずつの**ありうる読み**
  （pykakasi の辞書 Kanwa から。3 字までの読み、寺はじ）で組み合わせた一覧を返す（`/api/stt` の `head_yomis`）。
  pykakasi は 1 つの読みしか返さず「上一」→うえいち になるため。
  ただし「〇〇家／さん／様／氏」、辞書に 1 語で載っている言葉（高橋・吉田・福寿…）は 空（人の名前などを お寺にしない）。
- アプリ `_aiTempleFromHead`：その一覧と お寺の読みを照らす（最初の音が同じものだけ、5 字以上は 2・未満は 1 文字ちがいまで、
  同じ近さならそのままの読みで近い方）。`_aiHearFinish` は 頭 → 文全体（`_aiTempleFromYomi`）の順。
- `_aiTempleFromYomi` にも「最初の音が同じものだけ」を足した（ふくじゅ が ざっくり読みで そうふくじ に当たっていた）。
確かめ（33 文）：上一→浄因寺、常人地→浄因寺、地蔵地・自供寺・自校寺→慈宏寺、光明→光明院、福寿→福寿院、甘沼→天沼共同。
高橋家・高橋・中村・吉田・山田・白御影・黒御影 などは そのまま。残り：「久我山の墓地」→「久我山墓地の墓地」（以前から）。

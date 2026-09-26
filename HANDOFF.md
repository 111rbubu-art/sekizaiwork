# 引継ぎ資料 — sekizaiwork（石材業務管理アプリ）

最終更新: 2026-09-19
**index_b.html = v1.9.436**／**index.html = v1.8.235**／**chokoku-genko.html = v23.2**

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

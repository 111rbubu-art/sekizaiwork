# 引継ぎ資料 — sekizaiwork（石材業務管理アプリ）

最終更新: 2026-08-31
**index_b.html = v1.9.414**／**chokoku-genko.html = v3.7**

> 彫刻原稿（chokoku-genko.html）の最近の作業は `HANDOFF-chokoku-genko.md` にまとめています。
> そちらを先に読んでください。

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

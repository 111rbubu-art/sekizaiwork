# 引継ぎ資料 — sekizaiwork（石材業務管理アプリ）
作成日: 2026-06-07　現在バージョン: **v1.9.073**

---

## プロジェクト概要

- **リポジトリ**: `111rbubu-art/sekizaiwork`
- **GitHub URL**: `https://github.com/111rbubu-art/sekizaiwork`
- **開発ブランチ**: `main`
- **git push コマンド**: `git push -u origin main`
- **GitHub MCP**: セッション内で `mcp__github__*` ツールが利用可能（GitHub操作はこれを使う）
- **MCP対象リポジトリ**: `111rbubu-art/sekizaiwork`（他リポジトリへのアクセス不可）
- **唯一のアプリファイル**: `/home/user/sekizaiwork/index_b.html`（約21,000行超）
- **SharePoint サイト**: `https://shojisekizai.sharepoint.com/sites/stoneworks`
- **認証アカウント**: `syojisekizai0808@gmail.com`（社員用）、`shojisekizai@gmail.com`（法人カレンダー用）

---

## 主要定数（index_b.html 内）

| 定数 | 値 | 行番号付近 |
|------|----|-----------|
| `APP_VERSION` | `'v1.9.073'` | ~4815 |
| `KOUJI_LIST_ID` | `'dea1de47-62cc-4216-afb3-7c313485eba4'` | ~818 |
| `nokListId` | `'3ae4bd1d-47b8-4300-aab5-6b828aa0e480'` | ~1409 |
| `cusListId` | `'29524f89-0370-44ea-8d01-161f34e5a1ab'` | ~14315 |
| `DRIVE_ID` | `'b!Kd6bySbVVkOYNZHZNe9p3GY8hGjGqNZAjqUCUF3IbAPj8QAq2YQCTJvsL-ml_Vkp'` | ~14518 |
| `_GCAL_CALENDAR_ID` | `'shojisekizai%40gmail.com'` | ~4607 |

---

## 画面構成

- **工事関連リスト** (`renderKoujiList`): 左側カード一覧
- **納骨リスト** (`renderNokList`): 左側カード一覧
- **詳細パネル** (`showKoujiDetail` / `showNokDetail`): 右側詳細
- **ファイル整理パネル** (`_fmgr` オブジェクト): サブウィンドウ
- **資料作成** (テンプレートエンジン): PDF/JSON保存
- **施工計算** (`calcFoundation` / `openFoundCalcAsDoc`): 基礎計算・A4出力

---

## このセッションで実施した主な変更（v1.9.055〜v1.9.073）

| バージョン | 内容 |
|-----------|------|
| v1.9.055 | 詳細ヘッダのラベル行を左寄せ・順序整理 |
| v1.9.056 | 提出資料ボタン→ファイル整理パネル（提出資料サブフォルダー）に変更、ダブルクリックでファイルを開く |
| v1.9.057 | ラベル行を左寄せ＋固定スペース配置 |
| v1.9.058 | PDF保存デフォルト名を `YYYYMMDD_＜ベース名末尾グループ＞__〇〇家__工事内容` 形式に |
| v1.9.059 | 途中保存(.json)も同じ命名規則に |
| v1.9.060 | 工事・納骨両フィールド対応（`_currentTargetList`非依存） |
| v1.9.061 | 納骨GCal登録強化（編集ゼロでも登録、新規登録時も納骨日があれば登録） |
| v1.9.062 | GCalターゲットを `primary` → `shojisekizai@gmail.com` に変更 |
| v1.9.063 | ファイル整理パネルのドロップゾーンにWindowsエクスプローラーからのドラッグ対応 |
| v1.9.064 | 工事関連リストカードに石材①ステータスタグを右上に追加（枠線スタイル） |
| v1.9.065 | 石材②・彫刻ステータスタグを追加、複数タグを縦積み右上表示 |
| v1.9.066 | データタブ フォルダーサブタブの「📁 フォルダー」セクションヘッダー削除 |
| v1.9.067 | 彫刻タグの判定を下から順（最進段階優先）に変更 |
| v1.9.068 | 施工計算の砕石に20L袋数を追加（RC40密度1500kg/m³、20L=30kg） |
| v1.9.069 | 施工計算A4出力の文字色を印刷向けに濃くする（#888→#444等） |
| v1.9.070 | 施工計算A4出力の計算日・鉄筋切上の文字色をさらに濃くする |
| v1.9.071 | 石材①②タグを下から順（最進段階優先）に変更 |
| v1.9.072 | 工事詳細に引取済①②チェックボックスを追加（`PickUp1`/`PickUp2`、ブール型） |
| v1.9.073 | 引取済チェック時に石材タグを「石材①: 済」（緑塗り）で表示 |

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

## Google Calendar

- カレンダーID: `shojisekizai@gmail.com`（URL用に `%40` エンコード済み）
- 認証: OAuth2 Implicit Flow、`syojisekizai0808@gmail.com` でサインイン
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
- **引取済①②の動作確認**: v1.9.072-073、SPの`PickUp1`/`PickUp2`フィールドとの疎通確認

---

## 開発メモ

- コミット後は必ず `git push -u origin main` でpush
- バージョン番号は `APP_VERSION` 変数（~行4815）を手動更新
- SP Graph APIの`$expand=fields`で全フィールドを自動取得（`$select`なし）
- ブール型SPフィールドはPATCH時に文字列`"true"`→`boolean true`への変換が必要

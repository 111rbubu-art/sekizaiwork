# 外注ポータル システム資料（ほかのプロジェクトへの 共有用）

最終更新：2026-10-16　／　ポータル `index.php` v1.2.2・受信 `upload.php` v18・報告 `submit.php` v3・業務アプリ `index_b.html` v1.9.528

> この資料は、外注ポータルの しくみを **ほかのプロジェクト（別のアプリ・別の Claude のプロジェクト）** で
> 読んで 使ったり まねたり できるように まとめたものです。コードは この フォルダー（`gaichu-portal/`）と
> 業務アプリ `index_b.html`（`_gaichu` で 始まる 関数）に あります。
> 古い 説明 `README.md`・`PHASE3_SPEC.md`・`TODO.md` も ありますが、**いまの 全体は この資料** が 正です。
> 秘密（合言葉・パスワード・サーバーの アカウント）は ここには 書きません。

---

## 1. 何をする システムか

石材店（自社）が、**工事・納骨・彫刻の 案件を 外注先（職人・協力会社）に 見せ、外注先から 報告を もらう** しくみ。

| 人 | すること | 使う 画面 |
|---|---|---|
| 自社 | 案件の 情報と ファイル（地図・図面・写真・資料）を 外注先へ 公開・更新・取り下げ。報告を 見る・返事を 書く・写真を 社内に 保存 | 業務アプリ（`index_b.html` の［🌐 外注公開］） |
| 外注先 | 公開された 案件を スマホで 見る。写真・コメント・完了報告を 送る | 外注ポータル（`index.php`。URL＋パスワード だけ） |

決まり
- **元の データは いつも SharePoint**（自社の 案件リスト・ドキュメントライブラリ）。ポータルの サーバーは「配る 箱」。
- 外注先は **Microsoft の アカウント 不要**。外注先ごとの フォルダーに Basic 認証（URL＋パスワード）。
- 公開は **まるごと 差し替え**（片方向の Push）。外注先からの 報告だけ ポータル側に たまる。

---

## 2. 全体の 構成

```
 ┌──────────────┐  ① 案件・ファイルを 読む（Graph API）          ┌──────────────────┐
 │ SharePoint   │ ───────────────────────────────▶ │ 業務アプリ             │
 │ 案件リスト    │ ◀─────────────────────────────── │ index_b.html（静的）   │
 │ ドキュメント  │  ⑥ 完了日を 書く・報告写真を 保存          │ ［🌐 外注公開］         │
 └──────────────┘                                   └─────────┬────────┘
                                                                  │ ② POST（合言葉＋CORS）
                                                                  ▼
 ┌────────────── レンタルサーバー（PHP・Apache）/gaichu/<外注先>/ ─────────────┐
 │  upload.php  … 自社 → サーバー の 受け口（公開・更新・取り下げ・報告の 読み出し・返事） │
 │  index.php   … 外注先が 見る ポータル（③ 閲覧）                               │
 │  submit.php  … 外注先 → サーバー の 受け口（④ 写真・コメント・完了報告）            │
 │  cases/<案件ID>/ case.json ・ 地図/ 図面/ 写真/ 資料/ 添付/ ・ 報告/ ・ comments.json ・ progress.json │
 └─────────────────────────────────────────────────────────┘
        ▲ ③④ Basic 認証（外注先の URL＋パスワード）                 │ ⑤ listall / summary（新着の 確認）
        │                                                               ▼
     外注先の スマホ                                            業務アプリが 新着バッジ・まとめ画面に 出す
```

1. 自社が 業務アプリで 案件を 開き［🌐 外注公開］→ 種類（工事／納骨／彫刻／追工）と 送る ファイルを 選ぶ
2. アプリが `case.json`（案件の 要点）と ファイルを `upload.php` へ（大きい 写真は 縮めて・1 枚ずつ 追加）
3. 外注先は ポータルで タブ（工事・納骨・彫刻）・未完／完了・日付順に 見る
4. 外注先が 写真・コメント・完了報告を 送る（`submit.php`。Basic 認証の 中なので 合言葉 不要）
5. 業務アプリは 定期的に `upload.php` の `listall`／`summary` で 報告を 読み、新着（24 時間）を 出す
6. 自社は 返事を 書く・完了報告の 日付を SharePoint の 完了日に 入れる・報告写真を SharePoint の 案件フォルダーへ 保存

案件の 情報を アプリで 直すと、公開中なら `updatecase` で ポータルも 自動で 更新される（`_gaichuAutoSync`）。

---

## 3. 置き場所と ファイル

### サーバー（外注先 1 社に 1 フォルダー）
```
www/
  robots.txt                 ← /gaichu/ を Disallow（検索避け）
  gaichu/
    <外注先>/                ← Basic 認証を かける フォルダー（外注先ごと）
      index.php              ← ポータル（外注先が 見る）
      upload.php             ← 自社アプリ → サーバー（合言葉と CORS で 守る。Basic 認証から 外す）
      submit.php             ← 外注先 → サーバー（Basic 認証の 中に 置く）
      .htaccess              ← Basic 認証・noindex・一覧表示 なし（htaccess-sample.txt）
      .htsecret              ← upload.php の 合言葉（1 行。.ht* は Apache が 配らない）
      .user.ini              ← 写真の 上限（user.ini-sample.txt。30MB など）
      cases/                 ← アプリが 作る（手で さわらない）
```

### このリポジトリ（`gaichu-portal/`）
| ファイル | 中身 |
|---|---|
| `index.php` | ポータル画面（PHP で 描く。スマホ向け） |
| `upload.php` | 自社 → サーバーの 受け口（アクションは 5 章） |
| `submit.php` | 外注先 → サーバーの 受け口（アクションは 6 章） |
| `htaccess-sample.txt`・`user.ini-sample.txt`・`robots.txt` | 設置用の ひな形 |
| `README.md`・`PHASE3_SPEC.md`・`TODO.md` | 作った ときの 説明（古い 所あり） |

### 業務アプリ（`index_b.html`）の 主な 関数
| 関数 | 役目 |
|---|---|
| `openGaichuPublish`・`_gaichuOpenManager`・`_gaichuBuildModal` | 案件ごとの「外注公開の 管理」窓（種類ごとの カード・ファイル・報告・返事） |
| `_gaichuBuildCase(d, type)` | SharePoint の 項目 → `case.json`（4 章） |
| `_gaichuLoadFiles`・`_gaichuListFolder`・`_gaichuFetchBlob` | 送る ファイルを 集める（案件フォルダー＋リストの 添付） |
| `_gaichuDoPublish`・`_gaichuPrepareBlob`・`_gaichuShrinkImage`・`_gaichuMaxUpload` | 公開（push → 大きい 物は addfile で 1 枚ずつ・上限に 合わせて 画像を 縮める） |
| `_gaichuUnpublish`・`_gaichuUnpublishType` | 取り下げ |
| `_gaichuAutoSync`・`_gaichuUpdateOne`・`_gaichuUpdateBtn` | 案件を 直したら ポータルも 更新（公開中だけ） |
| `_gaichuLoadSummary`・`_gaichuMarkListNew`・`_gaichuMenuRepBadge`・`_gaichuRepHot` | 新着（外注先の 最後の 報告が 24 時間 以内）を 一覧・トップに 出す |
| `_gaichuOpenSummary`・`_gaichuSumRender` | 📋 外注公開まとめ（公開中 ぜんぶを 1 画面で） |
| `_gaichuTlBuild`・`_gaichuTlHtml` | 報告の 時系列（写真の かたまり＋コメント） |
| `_gaichuChatSend`・`_gaichuChatEdit`・`_gaichuChatDel` | 自社の 返事（comments.json に side=自社 で 書く） |
| `_gaichuTlBulkSave`・`_gaichuPutOne`・`_gaichuSaveDests` | 報告写真を SharePoint の 案件フォルダーへ 保存（保存済みは ✅） |
| `_gaichuSyncCompletion` | 完了報告の 日付を SharePoint の 完了日へ |
| `_gaichuCfg`・`_gaichuEnsureCfg`・`_gaichuResetCfg` | 設定（`upload.php` の URL と 合言葉。端末に 保存し 設定の 同期で SharePoint にも） |

---

## 4. データ

### 案件 ID（フォルダー名）
`<種類の 頭文字>-<SharePoint の アイテム ID>`
| 頭文字 | 種類 | 元の リスト | ポータルの タブ |
|---|---|---|---|
| `k` | 工事 | 工事関連 | 工事 |
| `t` | 追加工事 | 納骨・戒切（追加分） | 工事（`type` は kouji） |
| `n` | 納骨 | 納骨・戒切 | 納骨 |
| `c` | 彫刻 | 納骨・戒切 | 彫刻 |

ID に 使える 字は `[A-Za-z0-9_-]{1,64}`（サーバーで 確かめる）。

### case.json（すべて 文字列。無い 項目は 省く）
| 項目 | 意味 |
|---|---|
| `type` | `kouji`／`nok`／`chokoku` |
| `temple`・`family` | お寺・家名（墓の 名義＋「家」。無ければ 顧客名） |
| `category`・`titleExtra` | 分類・工事内容 |
| `dateLabel`・`date`・`sortDate` | 日付の 名前（納期・納骨日・彫刻完了 など）・表示（7/20）・並べ替え（2026-07-20） |
| `time`・`state` | 納骨の 時間・状態（式あり など） |
| `status` | `open`／`done`（done は ポータルで 完了扱い） |
| `noteLabel`・`note` | メモの 名前と 中身（現場メモ・彫刻箇所 など） |
| `message`・`futa`・`meji` | 納骨：納骨者への 伝言・蓋の 種類・拝石目地 |
| `reason` | 工事：納期の 理由 |
| `workStatus` | 彫刻：いまの 状況（校正中・お客様確認待ち・彫刻待ち・彫刻完了 など） |
| `updated` | 送った 日（表示用） |

SharePoint の 列名との 対応は `_gaichuBuildCase` を 見る（列名は 自社の リスト 固有）。

### 案件フォルダーの 中
| もの | 書く 人 | 中身 |
|---|---|---|
| `case.json` | 自社 | 上の 表 |
| `地図/`・`図面/`・`写真/`・`資料/`・`添付/` | 自社 | 公開した ファイル（名前から 振り分け。公開の 窓で 変えられる） |
| `報告/` | 外注先 | 写真。名前は `<投稿者>_<YYYYMMDD>_<2 桁連番>.<拡張子>` |
| `comments.json` | 両方 | `[{name, at:"YYYY-MM-DD HH:MM", text, side?}]`。自社の 返事は `side:"shoji"`（自社の 印） |
| `progress.json` | 外注先 | 完了報告 `{done:true, date:"YYYY-MM-DD"}`（取消で 消える） |
| `.created`・時刻の 控え | サーバー | 初めて 公開した 時刻（ポータルの 🆕 NEW 用。再公開でも 引き継ぐ） |

---

## 5. 自社 → サーバー：`upload.php`

- `POST multipart/form-data`。毎回 `secret`（`.htsecret` と 同じ 文字列）と `action`。違えば 401
- CORS は 業務アプリの 配信元だけ 許す（`$ALLOW_ORIGINS`）。別の ドメインで 使うなら ここに 足す
- `GET` で 版・上限・アクション一覧を 返す（`{service:"gaichu-upload", version:18, limits, actions}`）
- 受ける 拡張子は `$ALLOW_EXT`（画像・PDF・Office など。実行できる 物は 断る）

| action | 送る もの | すること |
|---|---|---|
| `push` | `id`・`case`（JSON）・`files[]`・`paths[]` | 案件フォルダーを 作り直す（まるごと 差し替え。`.created` は 引き継ぐ） |
| `addfile` | `id`・`path`・`file` | 1 ファイル 追加（大きい 写真を 分けて 送る） |
| `updatecase` | `id`・`case` | `case.json` だけ 差し替え（未公開なら `notPublished`） |
| `delfile` | `id`・`path` | 1 ファイル 削除 |
| `unpublish` | `id` | 案件フォルダーを 消す |
| `status` | `id` | 公開中か・case.json・ファイル一覧（時刻つき）・コメント・完了報告 |
| `getfile` | `id`・`path` | ファイルの 中身（アプリの サムネ・SharePoint へ 保存 用） |
| `list` | — | 公開中の 案件 ID 一覧 |
| `listall` | — | 公開中 ぜんぶの case・ファイル・時刻・コメント・完了報告（まとめ画面・新着 用） |
| `summary` | — | 案件ごとの 報告 件数・完了報告（軽い 新着 確認 用。listall が だめな ときの 予備） |
| `comments` | `id` | comments.json |
| `addcomment`・`editcomment`・`delcomment` | `id`・`text`・`idx` | 自社の 返事（自社の 投稿だけ 直せる・消せる） |

返事は JSON `{ok:true, …}`／`{ok:false, error}`。送る 量が サーバーの 上限を 越えると、合言葉が 消えて 見えるので 先に 413 を 返す。

---

## 6. 外注先 → サーバー：`submit.php`

- ポータルと 同じ フォルダー＝**Basic 認証の 中**。同じ オリジンなので CORS も 合言葉も 要らない
- 書けるのは `報告/`・`comments.json`・`progress.json` だけ。ID と パスは 確かめる（パスの さかのぼりは 不可）
- 拡張子は 画像・PDF（jpg・png・gif・webp・heic・heif・pdf など）。大きさは `.user.ini` の 上限まで

| action | 送る もの | すること |
|---|---|---|
| `list` | `case` | 報告写真・コメント・完了報告 |
| `upload` | `case`・`name`・`file` | 報告写真を 1 枚 保存（名前の 決まりは 4 章） |
| `del` | `case`・`path` | 報告写真を 1 枚 消す |
| `comment`・`editcomment`・`delcomment` | `case`・`name`・`text`・`idx` | コメント（自社の 投稿は 直せない） |
| `progress` | `case`・`done`・`date` | 完了報告の 登録／取消（工事・彫刻） |

---

## 7. ポータル画面（`index.php`）

- タブ：工事・納骨・彫刻（未完の 件数・その日の 新着は 点滅 NEW）。未完／完了の 切りかえ。日付の 早い順
- カード：お寺・家名・分類・日付・メモ／彫刻箇所・ファイル（画像は タップで 拡大）
- 完了の 決め方：`status=done`・完了報告あり・納骨は 納骨日を 過ぎたら
- 🆕 NEW：初めて 公開してから 7 日（1 日目は 点滅）
- 報告：📷 写真（複数・カメラ）・💬 コメント（自社の 返事も 並ぶ）・🏁 完了報告（工事・彫刻）
- 🔄 更新（タブ・位置を 保つ）。画面の 上に 版と、同じ フォルダーの upload／submit の 版（古いと ⚠）。`index.php?ver` で 版だけ
- キャッシュさせない（版の 確かめが 古く 見えないように）

---

## 8. 守っている こと・守れない こと

- 外注先が 見られるのは **自分の フォルダーだけ**（Basic 認証。外注先ごとに パスワード）。やめる ときは パスワードを 変えるか フォルダーを 消す
- 自社 → サーバーは 合言葉（`.htsecret`）＋ CORS。合言葉は リポジトリに 置かず、アプリの 設定（端末＋自社の SharePoint）に だけ 持つ
- `noindex`・`robots.txt`・一覧表示 なしで 検索避け（守りの 本体は パスワード）
- 公開した 中身を 外注先が 保存・印刷するのは 防げない（作業に 要るため）。守れるのは「公開して いない・ほかの 外注先の 案件を 見られない」こと
- 報告は サーバーにだけ たまる（自社が［保存］した 写真だけ SharePoint へ）

---

## 9. 新しい 外注先を 足す（設置）

1. サーバーの `www/gaichu/` に 外注先の フォルダー（英数字）を 作る
2. `index.php`・`upload.php`・`submit.php` を 置く（3 つの 版が 合って いること。ポータルの 上に 出る）
3. `.htsecret` を 作る（長い ランダムな 文字列 1 行）
4. Basic 認証を かける（コントロールパネルの アクセス制限、または `htaccess-sample.txt`）。**`upload.php` だけは 認証から 外す**（アプリから 送るため）。`submit.php` は 外さない
5. 写真が 大きいなら `.user.ini`（`user.ini-sample.txt`）
6. `robots.txt` に `Disallow: /gaichu/`
7. 業務アプリの［🌐 外注公開］の 設定で、その フォルダーの `upload.php` の URL と 合言葉を 入れる
8. 外注先に ポータルの URL と パスワードを 渡す

※ いまの 業務アプリは **設定 1 つ＝外注先 1 フォルダー**（`gaichuCfg` に URL と 合言葉が 1 組）。外注先を 何社も 同時に 使うなら、設定を 外注先ごとに 持つ 手直しが 要る。

---

## 10. ほかの システムで 使う ときに 変える 所（移植の 手引き）

サーバー側の 3 本（PHP）は **元の データが 何でも そのまま 使える**。変えるのは 送る 側だけ。

| 変える 所 | どこ | 中身 |
|---|---|---|
| 送り元の ドメイン | `upload.php` の `$ALLOW_ORIGINS` | 自分の アプリの オリジンを 足す |
| 受ける 拡張子・大きさ | `upload.php` の `$ALLOW_EXT`・`.user.ini` | 必要なら |
| 案件の 種類・タブ | `index.php`（`kouji`／`nok`／`chokoku` と 表示の 文言） | 種類を 変えるなら タブと カードの 描き方 |
| case.json の 作り方 | 送る 側（ここでは `_gaichuBuildCase`） | 自分の データの 列 → 4 章の 項目 |
| ファイルの 集め方 | 送る 側（ここでは SharePoint の Graph API） | 自分の 保存先から 集めて `push`／`addfile` |
| 社名・色 | `index.php` の `<title>`・見出し、`comments.json` の 自社の 名前（`upload.php` の `addcomment`） | 自社の 名前に |

いちばん 小さい 送る 側（例）
```js
const fd = new FormData();
fd.append('secret', SECRET);                 // .htsecret と 同じ（ソースに 書かない）
fd.append('action', 'push');
fd.append('id', 'k-123');
fd.append('case', JSON.stringify({ type:'kouji', temple:'○○寺', family:'○○家', category:'墓石工事',
  dateLabel:'納期', date:'7/20', sortDate:'2026-07-20', status:'open', updated:'7/10' }));
fd.append('files[]', blob, '現場図.jpg'); fd.append('paths[]', '地図/現場図.jpg');
const res = await (await fetch(UPLOAD_URL, { method:'POST', body:fd })).json();   // {ok:true}
```
報告を 読むのは `action=listall`（または `status` に `id`）。

---

## 11. 関連（別の しくみ）

- **外注管理（`gaikanri.html`）**：外注先への 仕事の 台帳（SharePoint の Excel の テーブル `GaiLists`）。ポータルとは 別物。
  業務アプリの［🏭 外注管理］から 開く。彫刻校正の 案件を 台帳へ 入れる 手当ても ある（`HANDOFF.md` の v1.9.500〜501）

## 12. 版と これから

- 版の 履歴：`HANDOFF.md`（「外注」で 探す）。ポータル v1.2.2・upload v18・submit v3 で そろえる（`index.php` が 確かめる）
- 候補：外注先ごとの 設定（何社も 同時に）・報告の 既読を 端末を またいで そろえる（いまは 端末ごと）

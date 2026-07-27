# 庄司石材店 ホームページ リニューアル

Google Sites で運用中の既存サイトを独自の静的HTMLサイトとして作り直し、
さくらのレンタルサーバへ移行するプロジェクト。

- **既存サイト**: https://www.shojisekizai.jp/ （Google Sites）
- **移行先**: さくらのレンタルサーバ スタンダードプラン
- **目的**: 見た目を刷新し、信頼感とスマホでの見やすさを高める

> このリポジトリには石材管理システム（`index.html` / `map.html` など）も同居しています。
> ホームページのファイルはすべて `public/` 以下にまとまっており、
> 管理システムとは互いに影響しません。

---

## 1. 会社情報

| 項目 | 内容 |
|------|------|
| 会社名 | 庄司石材店 |
| 所在地 | 東京都杉並区久我山5-5-12 さざれえにし201 |
| 電話 | 0120-3333-845 |
| FAX | 03-3333-8452 |
| Email | shojisekizai@gmail.com |
| 営業時間 | 8:00〜17:00 |
| 定休 | 毎月14・15日、土日 |
| ブログ | note（外部リンク） |

---

## 2. デザイン方針

**シンプルモダン**（白・グレー・スタイリッシュ）

### カラー（`public/css/style.css` の `:root` に定義）

```css
--bg-base:    #f7f6f3;  /* オフホワイト（ベース） */
--bg-dark:    #1a1a1a;  /* ダークチャコール（ヒーロー・フッター） */
--bg-darker:  #111111;  /* フッター最下部 */
--bg-card:    #ffffff;  /* カード背景 */
--text-main:  #1a1a1a;
--text-sub:   #666666;
--text-mute:  #999999;
--border:     #e8e6df;
```

### タイポグラフィ

- **見出し**: 明朝系 — `Georgia, "Hiragino Mincho ProN", "Yu Mincho", serif`
- **本文**: ゴシック系 — `system-ui, "Hiragino Sans", "Yu Gothic", sans-serif`
- `letter-spacing` は広め（見出し 0.08〜0.1em、小見出し 0.2〜0.3em）
- 英字の小見出し（Services, About など）は極小サイズ＋大きな字間（`.eyebrow`）

### レイアウト原則

- 余白を大きく取る
- 罫線は細く（0.5px〜1px）
- 装飾は最小限。写真と余白で見せる
- 影（box-shadow）は使わない
- ホバー時は写真をわずかに拡大（scale 1.04 / transition 0.4s）

---

## 3. ファイル構成

```
public/                        公開ディレクトリ（この中身をそのままサーバへ）
├── index.html                 トップページ
├── 404.html                   404ページ
├── .htaccess                  Apache 設定（HTTPSリダイレクトは公開後に有効化）
├── robots.txt
├── sitemap.xml
├── css/style.css              全ページ共通のCSS
├── js/main.js                 ハンバーガーメニューのみ
├── images/                    写真（現在はグレーのプレースホルダー）
│   └── works/                 施工例ギャラリー
├── boseki-sinki/index.html    墓石新規
├── jisin/index.html           地震対策・免震パット
├── cleaning/index.html        クリーニング
├── reforme/index.html         リフォーム
├── choukoku/index.html        追加彫刻
├── sekou/index.html           施工例
└── company/index.html         会社概要
deploy.sh                      さくらへの転送スクリプト
```

各ページはディレクトリ＋`index.html` の形にしてあるので、
URL は `/boseki-sinki/` のように拡張子なしで表示されます。

### ページ一覧

| ページ | URL | 主な内容 |
|--------|-----|---------|
| トップ | `/` | ヒーロー、サービス6件、会社紹介、お問い合わせ |
| 墓石新規 | `/boseki-sinki/` | お墓のタイプ（和型／洋型／塔型）、石の選び方（価格重視／石質重視／高級石材）、墓地の種類（公営／寺院／民営）、建立までの流れ |
| 地震対策 | `/jisin/` | 免震ゲルの説明、京都大学防災研究所での振動実験、施工方法、施工価格 |
| クリーニング | `/cleaning/` | 汚れについて、洗浄の効果、承っている作業、ご依頼の流れ |
| リフォーム | `/reforme/` | 花立金具交換、香炉交換、土留交換（施工前後の比較） |
| 追加彫刻 | `/choukoku/` | 承っている彫刻、現地彫刻と工場彫刻、ご依頼の流れ |
| 施工例 | `/sekou/` | 新規／リフォーム／クリーニングの3カテゴリ |
| 会社概要 | `/company/` | 会社情報、アクセス、ブログ |

---

## 4. 写真について

現在 `public/images/` に入っているのは**すべてグレーのプレースホルダー画像**です。
本番の写真に差し替えてください。ファイル名を変えなければHTMLの修正は不要です。

- **Google Sites の画像URLは外部から読み込めない**（ホットリンク不可）
  ので、既存サイトの写真は手元にダウンロードして配置すること
- 画像は幅1200px程度にリサイズして軽量化する
- `loading="lazy"` はすでに設定済み（ヒーローを除く）
- すべての `<img>` に意味のある `alt` を入れてある。写真を差し替えたら
  内容に合わせて `alt` も見直すこと

### 差し替えが必要なファイル

| ファイル | 用途 | 推奨サイズ |
|---------|------|-----------|
| `hero.jpg` | トップのヒーロー背景 | 1600×900 |
| `ogp.jpg` | SNS共有時のサムネイル | 1200×630 |
| `about.jpg` | トップの会社紹介 | 1000×750 |
| `service-new.jpg` ほか6点 | サービスカード | 800×520 |
| `type-wagata.jpg` / `type-yougata.jpg` / `type-tougata.jpg` | 墓石新規のタイプ別 | 800×600 |
| `jisin-test-before.jpg` / `-after.jpg` | 振動実験の比較 | 800×600 |
| `cleaning-before.jpg` / `-after.jpg` | 洗浄の前後比較 | 800×600 |
| `reform-hanatate-*` / `reform-kouro-*` / `reform-dodome-*` | リフォームの前後比較 | 800×600 |
| `works/new-01〜03` / `works/reform-01〜03` / `works/cleaning-01〜03` | 施工例ギャラリー | 800×600 |

---

## 5. 技術要件

- **静的HTML + CSS**。ビルドツールは使わない
- 外部ライブラリ・外部フォントは使わない（表示速度とプライバシーのため）
- JavaScript は最小限（ハンバーガーメニューのみ。スムーススクロールはCSSで実装）
- セマンティックHTML（`header` / `nav` / `main` / `section` / `footer`）
- レスポンシブ対応（スマホ / タブレット / PC）
- **さくらのレンタルサーバは FreeBSD 環境**。サーバサイド処理は前提にしない

### SEO・メタ情報

各ページに `title` / `description` / OGP を設定済み。
トップページには `LocalBusiness` の構造化データ（JSON-LD）を記述してあります。
`sitemap.xml` と `robots.txt` も `public/` 直下に用意済みです。

**ドメインを変更した場合は、以下の絶対URLの書き換えが必要です。**

- 各ページの `<link rel="canonical">` と `og:url` / `og:image`
- `sitemap.xml` の全 `<loc>`
- `robots.txt` の `Sitemap:` 行
- トップページの JSON-LD 内のURL

### バージョン管理

各HTMLファイル末尾に `<!-- APP_VERSION: v1.0.0 -->` を記載。
内容を更新したらこの番号も上げること。

---

## 6. デプロイ（さくらのレンタルサーバ スタンダード）

### 接続情報

- ホスト: `アカウント名.sakura.ne.jp`
- ユーザー: 初期アカウント（FTPアカウント）
- 公開ディレクトリ: `~/www/`（独自ドメイン設定によっては `~/www/ドメイン名/`）
- ※SSHは初期アカウントでのみ利用可能

### 初期設定

```bash
# 接続テスト
ssh アカウント名@アカウント名.sakura.ne.jp

# 公開鍵認証
ssh-keygen -t ed25519 -C "shojisekizai"
ssh-copy-id アカウント名@アカウント名.sakura.ne.jp
```

`~/.ssh/config`:

```
Host sakura
  HostName アカウント名.sakura.ne.jp
  User アカウント名
  IdentityFile ~/.ssh/id_ed25519
```

### 転送

```bash
./deploy.sh --dry   # 転送内容の確認だけ（おすすめ。最初はこれで確認する）
./deploy.sh         # 実際に転送
```

`deploy.sh` は `public/` の中身を `sakura:~/www/` へ `rsync -avz --delete` で送ります。
サーバに `rsync` がない場合は自動的に `scp` に切り替わります。
公開ディレクトリが `~/www/ドメイン名/` の場合は、`deploy.sh` の `DEST` を書き換えてください。

**`--delete` が付いているため、`public/` にないファイルはサーバから消えます。**
サーバ側にだけ置いてあるファイルがないか、初回は `--dry` で必ず確認してください。

---

## 7. 公開までの手順

1. `アカウント名.sakura.ne.jp` にアップして動作確認
2. スマホ・PCで表示、リンク、電話タップを確認
3. 問題なければ DNS を Google Sites からさくらへ切り替え
4. コントロールパネルから無料SSL（Let's Encrypt）を有効化
5. `public/.htaccess` の HTTPS リダイレクト部分のコメントを外して再デプロイ

**注意**: DNS 反映には数時間〜1日かかる。切り替え前に必ず動作確認を済ませること。
SSL証明書が発行される前に手順5を行うと、サイトが表示できなくなります。

---

## 8. Claude Code への依頼メモ

- CSS は共通ファイル `public/css/style.css` にまとめる。ページ個別のCSSは作らない
- 新しいページを足すときは既存ページのヘッダー／フッターをそのままコピーし、
  ナビの `aria-current="page"` の位置だけ変える。あわせて `sitemap.xml` にも追記する
- 変更のたびに `deploy.sh` は実行しない。指示があったときだけデプロイする

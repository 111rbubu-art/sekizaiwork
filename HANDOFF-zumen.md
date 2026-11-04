# 石の 図面（zumen.html）引継ぎ ― 社内アプリ開発へ 移す ための まとめ

zumen.html = v0.6.1（2026-11-04）。**末尾の「版ごとの 記録」が いちばん新しい**。くわしい 版ごとの 中身は `HANDOFF.md` の 末尾（2026-11-02〜）にも ある。

---

## 1. なにを する アプリか
墓石の 図面を ブラウザだけで 見る・直す・製作会社へ 送る ための アプリ（1 ファイル `zumen.html`。サーバーなし・Netlify の 静的 配信）。

- **開ける もの**：DXF（R12〜・Shift_JIS／UTF-8）、**DWG**（LibreDWG を ブラウザで）、**mics の `.mgx`**（立体）、作業 ファイル（`.zumen.json`）
- **できる こと**
  - 寸法（mm／尺・寸・分／寸／mm（尺寸））。つまみ（□）で 点を 直す。文字・矢印の 大きさは 全体と 1 本ずつ
  - 元の DXF／DWG の 寸法線を 直せる 寸法として 読む（元の 文字・小数・矢印の 大きさ・形を 引き継ぐ）
  - 隙間チェック（石＝つながった 線の かたまり）・石の 寸法を 変える（横・上の 石も ずらす）・伸ばす
  - mics の 立体から 隠れ線を 消した 三面図（第三角法）。**目地を 入れる**（mics の 2 次元変換で 消える 件の 対策）
  - **部材図**（部品寸法表・加工指示図・部品詳細図）を 作って 図面と して 直す（案 A の 画面）
  - DXF（R12・Shift_JIS）で 保存、印刷・PDF（A3／A4・表題欄）、PNG
- **画面**：左＝道具（選ぶ・全体・寸法・文字・線・穴・引出線・▲磨き・石の 寸法・伸ばす・隙間チェック・直交・スナップ）、右＝設定・選んだ ものの 欄。右クリック（動かさない）＝メニュー、右／まん中 ドラッグ＝画面を 動かす、ホイール＝拡大縮小

## 2. 本人が 決めた こと（守る）
- 返事・画面の 言葉は 日本語。新しい 作り方は 図（PNG）で 見立てを 見せてから
- 寸法の 矢印は **開いた ∨**（細長い）が 既定。塗った ▲ も 選べる
- 左の［動かす］［測る］は 要らない（マウスの まん中で 動く・長さは 寸法で わかる）
- 才数＝**(縦÷303.03)×(横÷303.03)×(高さ÷303.03)**（1 尺＝303.03mm）
- 目地は データの 中では 6.06mm（2 分）。図では 石の 端を 目地の 分 引っ込める
- 部材図の 画面は **案 A**（ページを 1 枚ずつ。左＝ページ一覧・まん中＝A4・右＝部材の 名前／図／磨き）
- 部材ごとに 図を 選ぶ：**斜め・正面・右側面・左側面・平面**。何も 選んで いなければ **斜めだけ**。選んだ 組み合わせは **同じ 名前の 部材に 覚える**
- 2 次元の 図には **面取り・穴の 位置の 寸法も 自動**で
- DWG の 部品は GPL-3.0。**本人 了承**（売る 予定は ない）

## 3. しくみ
### データ（`D`）
```
D = { ents:[], dims:[], layers:{名前:{name,aci,css,on,gap,dash}}, info:{name,to,stone,note},
      micsParts:{部材の 鍵:{name,pol,use,views,polDirs}}, buhin:[部材図の ページ] }
ent : line{a,b} / pl{v:[{x,y,b(ふくらみ)}],closed} / circle{c,r} / arc{c,r,a0,a1}（反時計回り） / text{p,h,rot,s,ha,va,wf}
      共通 id・layer・css（null＝画層の 色）・aci・fromDim・auto（部材図で 自動）・part（部材の 鍵）
dim : {id,a,b,off,mode:'h'|'v'|'a'|'r',ang, fmt, text（<> が 値）, th（文字の 高さ）, al（矢印の 長さ）,
       at（'open'|'open30'|'fill'）, k（値の 倍率：尺度つきの 図・部材図の 枠）, dec（小数の けた）, layer, auto, part}
```
- 長さは すべて **mm**（読むとき 図面の 単位を mm に 直す）
- 設定 `S`（`localStorage['zumen.settings']`）：表記・小数・尺寸の 細かさ・文字の 高さ・矢印の 長さ／形・元の 寸法を 寸法に する か・`bviews`（部品名称 → 図の 組み合わせ）ほか
- 自動保存 `localStorage['zumen.autosave']`（元の 図。部材図の ページも `D.buhin` に 入る）

### 読む
- DXF：`parseDxf` → RAW（`{hdr, layers, blocks, ents}`。グループコードの rec）→ `buildView('top', 単位)` → `emit`（ブロック・属性・OCS・3DFACE／メッシュ・寸法を 2 次元の ent に）
- DWG：`loadDwgLib`（DWG を 開いた ときだけ CDN から `@mlightcad/libredwg-web@0.8.3`）→ `dwgToRaw`（DwgDatabase を DXF と 同じ RAW に）→ DXF と 同じ 道
  - DWG の 注意：LWPOLYLINE の「閉じる」は **flag 512**（1 は 別の 意味）／角度は ラジアン／回転寸法の 角度は 0 で 返る（向きは 点の 位置から 決める）／多面メッシュ・格子メッシュの POLYLINE は 部品が 変換しない
- MTEXT の 書式：`\H28.5714x;`（倍率）・`\H100;`（値）・`\W`（幅）を 高さ・幅に 入れる
- 寸法：`dimFromRec`（13＝1 つ目・14＝2 つ目・10＝寸法線・70&7＝0 回転／1 平行・42＝測った 値）。半径・直径・角度は 線の まま
- mics：`parseMgx`（`<geometry name="G_BK001">` の 三角形。x＝右・y＝上・z＝−奥）、目地＝`G_MEJI_○○`（両端の 薄い 板）→ `micsCut` で 石の 端を 内側へ

### 描く・作る
- 隠れ線：`micsHlr`（三角形を 深さの 網に 描き、角の 辺・りんかくを 見える／隠れる に 分ける）
- 三面図：`buildMicsViews`（第三角法・目地・隠れ線は 破線で 出せる）
- 部材：`buildBuhin`（同じ 寸法・形の 石を まとめる・才数・面ごとの 磨きの 案 `micsFaces`）
- 部材図の モード：`enterBM` / `exitBM` / `bmShow` / `bmBuildAll` / `bmRegen` / `bmDrawPart`
  - ページは ふつうの 図。部材は 実寸、紙の 枠は 縮尺 N 倍。部材ごとに 自分の 縮尺（`m = N/Np` 倍）で、寸法は `k = 1/m`。手で 足す 寸法も 枠の k（`pg.regions` → `bmRegionK`）
  - 斜めの 図は 投影×√1.5（軸の 長さ＝実長）
  - 自動の もの（auto・part）は 作り直しで 消して 描き直す。手で 足した ものは 残る
  - 面取り・穴：`bmFeatures`（HLR は 同じ 線を 2 本 出す ので 1 本に。穴＝短い 線の 輪で 半径が そろう・すき間 60° 未満、面取り＝外形の 角の 短い 斜めの 線の つながり）
- 書き出し：`exportDxf`（R12・Shift_JIS・寸法は 線と 文字に 分解・開いた 矢印は LINE 2 本）、`makeSheet`（印刷の 紙）、`bmPrintAll`（部材図の 全ページ）

## 4. 業務アプリとの つながり（v0.5・業務アプリ v1.9.569。本人「案件の フォルダから 図面を 開く・保存する、件名を取り込む」「メールで送る。PDFにしてくれればいい」「とりあえず今の場所で」）
- 業務アプリ（index / index_b）の 帳票類［📐 図面］→ `openZumen(currentItem)`：`sessionStorage['zumenFrom'] = { title（件名＝○○家　お寺）, cust, place, folderPass }` を 置いて `window.open('zumen.html', 'zm_' + 案件の ID)`（窓は 案件ごと）
- SharePoint の 読み書きは **親（業務アプリ）の 関数**（見積書・撤去見積と 同じ `*FromTekkyo`）：
  - 前から ある：`fileExistsInFolderPassFromTekkyo`・`uploadPdfToFolderPassFromTekkyo`・`uploadJsonToFolderPassFromTekkyo`
  - v1.9.569 で 足した：`listItemsInFolderPassFromTekkyo`（ファイルと 下の フォルダー）・`downloadBinaryFromFolderPassFromTekkyo`（ArrayBuffer）・`uploadBlobToFolderPassFromTekkyo`（DXF など）
- 図面アプリ：上に［📁 件名］の 札と［☁️ 案件の ファイル］（案件の フォルダーを 下の フォルダーへ たどり、DXF・DWG・`.mgx`・`.zumen.json` を 開く）。件名は 空なら 案件から 入れる（`ensureTitle`）
- 保存先は 毎回 聞く（`chooseDest`）：作業 ファイル・DXF＝案件の フォルダー直下、**PDF＝案件の `提出資料`**（見積書と 同じ）／このパソコン
- **PDF**：jsPDF（cdnjs 2.5.1、使う ときだけ 読む）で 本物の PDF ファイル。図面＝［🖨 印刷・PDF］の 窓の［📄 PDF で 保存］（紙・縮尺・白黒を 選ぶ）、部材図＝上の［📄 PDF］（全ページ A4）。ファイル名＝件名_図面／部材図_年月日.pdf。メールに 付けて 製作会社へ（本人）
- 自動保存は 案件ごと（違う 案件の 前の 作業は 出さない）
- これから（案）：石種・送り先を 案件から、外注ポータルで 送る

## 5. mics の ファイル（見本の 物件で 見た 結果）
| ファイル | 中身 |
|---|---|
| `.mgx` | **立体の 形**（XML。部材ごとの 三角形。目地の 板 `G_MEJI_*`）← これを 使う |
| `.mbl` | 部材の 表（UTF-16 の CSV。形状コード・寸法の 名前と 値・式・置き方・目地 MA1/MA2）。置き方＝配置 2 点の 中点に 部材 2 点の 中点を 合わせ、移動・反転・回転Z。名前・磨きの 列は 空 |
| `.mif` | 見出しだけ（名前・日付・.mbl の 場所） |
| `.mit` | 履歴・使った 形状コード |
| `.emf` | mics が 描いた 隠れ線の 立体の 線画（三面図では ない） |
| `.mgy` | 絵（レンダリング）用の zip |
| `.dib` | 見本画像 256px |

- 紫（基礎）の 部材は `.mgx` に 入らない
- 見本では、踏石と 外柵の 内側の 寸法の 丸め（1575.5 と 1575.756）で 目地が 6.19mm に なる 所が あった

## 6. テストの しかた
- 画面：`CLAUDE.md` の とおり（`python3 -m http.server 8899`・Playwright）
- **DWG**：jsdelivr は ここから 届かない。scratchpad で `npm pack @mlightcad/libredwg-web@0.8.3` して 開き、`page.route(/libredwg-web@0\.8\.3\/(.*)$/ …)` で `dist/`・`wasm/` を 返す（wasm は `application/wasm`）
- **日本語の ファイル名**は Playwright の `setInputFiles` で 渡らない（何も 起きない）→ 英字の 名前に 写して 試す
- `prompt()`（穴の 直径・引出線の 文字・文字）は `page.on('dialog', d => d.accept('…'))`
- 試しの DXF は Python で 作る（2D：Shift_JIS の 文字・ブロック・押し出し 反転・円弧・MTEXT、3D：多面メッシュ・三角形の 3DFACE）。本物の 図面・mics の データは リポジトリに 入れない（個人名・物件名が 入る）
- 部材図：`.mgx` を 開く →［🧱 部材図］→［✏ 図面に して 直す］。`BM.pages`・`bmGroup`・`bmViews`・`bmFeatures` を `page.evaluate` で 見る
- **案件と つなぐ**：`ctx.route` で 同じ オリジンの 仮の 親ページ（`/__parent.html`）を 返し、親に `*FromTekkyo` を メモリの ファイル置き場で 作り、`sessionStorage.zumenFrom` を 置いて `window.open('zumen.html')`。jsPDF は scratchpad で `npm pack jspdf@2.5.1` して cdnjs を route
- Playwright の ダウンロードは **日本語の ファイル名が「download」に なる**（試しの ブラウザだけ。本物の Chrome は 名前どおり）

## 7. 配信
1. `var APP_VER = "v○";` を 上げる
2. この ファイルの 3 行目の 版、末尾に 記録、`HANDOFF.md` の 末尾に 1 行
3. `<script>` の 中身を 抜き出して `node --check`
4. `date +%s > .deploy-trigger` → 日本語で コミット → 作業ブランチと main の 両方に push（main が Netlify）

## 8. まだの こと・本人に 聞く こと
- 部材図：拡大図（丸の 中の 面取り）・穴の 深さ・「左右対称」・寸法表の 幅／奥行の 手直し・ページの 足し引き・磨きの 自動の 案の ずれ（竿石が 6面磨き に なる など）・自動の 寸法の 重なり・部品名称の 自動
- 日本語の 入った DWG を まだ 本物で 試して いない（試した 本人の DWG は 文字・寸法 OK）
- 下線（MTEXT の `\L`）を 描かない
- mics の 図での 隙間チェックは 線が 多く 重なりが 出すぎる → 3D で 調べる 形に
- DWG で 開けない もの：ハッチング・3D ソリッド・表・マルチ引出線・立体の メッシュ（「読まなかった もの」に 出る）
- 案件と つなぐ：本物の 業務アプリ・SharePoint で まだ 試して いない（本人に 試して もらう）

## 9. 部材設計（v0.6〜。墓石設計の 統合システムの 1 歩目）
本人の 決定（2026-11-03〜04）：3D・設計・加工図面は **zumen.html に 組み込む**（別アプリに しない）。保存先は SharePoint。オフラインは 別に 考える（今は 作らない）。mics の 解析は しない。
寸法は **図面の 数字を 押して 直す**（右に 寸法の 一覧を 出さない。幅・奥行・高さも 図面の 数字で）。「前面の 膨らみ」の ような 切り替えは **要らない**（変えるなら 寸法で、または 別の 部材で）。
- 入口：上の［🧊 部材設計］→ 全画面（`#pdv`・`body.pdmode`）。左＝正面図・側面図（1 枚の SVG `#pdSvg`）、右＝3D・才数
- 数字の チップ：濃い青＝params（W・D・H）、薄い青＝dims（押して 直す）、枠なし＝計算で 決まる（直せない）。押すと その 場所が 橙で 光り、ふきだし（`#pdPop`）で 値・比率／固定／式
- 部材 JSON（`schema:'buzai/1'`。見本＝`BZ_KORO` 香炉（筆返し・雲形穴）360×150×270）
  - `params`{W,D,H}、`dims`{id:{name, axis(v/w/d), rule:'ratio'{of,base,value}|'fixed'{value}|'formula'{expr}, min, max, prefix}}
  - `components`[{shape:{type:box|barrel|profile, …式}, at:{y, front}, cuts:[cloudHole], mirror:'x'}]。式は 日本語の 名前（name）で 書く
  - `drawing.dims`＝図の 寸法の 並び（view・dir・pos（left/right/top/bottom か {x|y:式}）・from・chain）、`drawing.sums`＝高さの 並び（ここの 寸法を 直すと H も 変わり、比率の 寸法は いまの 値の まま 土台を 新しい H に）
- `BZ`（部材エンジン・Three なし）：`evalExpr`（自前の 計算機。全角・もし/最大/最小/絶対値/四捨五入/切上/切捨。new Function は 使わない）、`solve`（順番は 自動・ぐるぐるは エラー）、`model`・`view`（線・円弧・円・pl。円弧は 円弧の まま）・`viewDims`・`setValue`・`setRule`
- 3D：`zumen-3d.js`（module）を 開いた ときだけ `import()`。Three.js r160 は `lib/three-0.160.0/`（同梱・MIT。付属品の import は 相対に 書き換えた）。香炉の 試作の 作り方（膨らみの バリ対策・操作中は 粗く）
- ［📐 図面に 入れる］：正面図・側面図・寸法（直せる 寸法）・文字を 今の 図の 右に。画層 `部材_外形`・`部材_隠れ線`（破線）・`寸法`・`文字`。DXF・PDF は いつもの ボタン
- 保存：業務アプリから 開いた とき `/業務アプリ/部材ライブラリ/部材/<id>.json` と `部材/履歴/<id>_v<版>.json`（`uploadJsonToFolderPassFromTekkyo`）。それ以外は ダウンロード。いまの 部材は `localStorage['zumen.part']`
- テスト：`BZ` は scratchpad に 抜き出して node で（360×150×270 で Φ135・ずらし67.5、胴 159→170 で H 281、W 480 で ずらし 112.5）。画面は Playwright（swiftshader）で チップを 押す → 決定 → 図面に 入れる → `exportDxf()` を 読み直して ARC の 半径。SharePoint は 仮の 親ページ（`__parent.html`）で
- まだ：筆返しの 曲線は 近似（DXF が あれば 正確に）、穴の ルールは 式で（既定＝試作の まま）、部材の 追加（竿石・台・花立…）、敷地への 配置・干渉チェック・見積の 連動・テクスチャ、元図面の 管理、本物の SharePoint で 未確認（`部材ライブラリ` フォルダーが 無い ときに 作られるか も）

## 10. 組み立て（kumitate.html v0.1〜。墓所に 部材を 並べる 3D・干渉・見積）
本人の 決定（2026-11-04）：「ひとまず 別ページで 作って、後で 図面アプリに 入れたい」。だから **エンジンと 画面を 分けて** ある（入れる ときは `kumitate-engine.js` を そのまま zumen.html から 読み、画面を モードに する）。
- ファイル：`kumitate.html`（画面）・`kumitate-engine.js`（`KM`。Three なし・node で 動く）・`kumitate-3d.js`（module・Three.js r160 は `lib/three-0.160.0/`）・`kumitate-data.js`（見本の 部材）
- データ：旧 墓石設計シミュレーター（React・Three r128・`gravestone-app.js`）の `gravestone-project.json` から 部材の 寸法・置き方（`joint` の 符号）・ノウハウ式（dim_calc・pos_calc）・基準点（anchors）だけ。**単価（石材・見積の 設定）は 公開リポジトリに 入れない**。画面の［💰 単価を 読む］で 旧の 保存ファイル か `{stones, estimate}` の JSON を 読み、`localStorage['kumitate.tanka']`。旧の ファイルに 部材・ノウハウも あれば それに 置きかえるか 聞く（`kumitate.data`）
- 計算（`KM.compute`）：部材を 集める → dim_calc → 手で 変えた 寸法（`over`。式より 優先）→ pos_calc → 位置（部材の 最小の 角が 原点・+z が 前）→ 干渉（箱の 重なり 1mm 超・つないだ 2 つは 見ない）
- 式：旧と 同じ 順番（敷地の 変数 → `部材名_W幅` など 長い 名前から → 計算）。計算は 自前（new Function を 使わない）。`もし`・`最大`・`最小`・`絶対値`・`四捨五入`・`切上`・`切捨`・全角
- 旧と ちがう 所：才数は 303.03mm（旧は 303）／合計＝各 小計の 合計（旧は 外柵・墓誌が 石材費だけ だった）／土留めは 外柵の 部材 そのもの なので 才数を 足さない（旧は 二重に 足して いた）
- 見積：石塔（石材・金具・運搬・設計・据付）・外柵（石材・金具・据付・残土）・墓誌（石材）。彫刻・耐震・コーティングは まだ
- 保存：`kumitate/1`｛sel, site{W,D,domeH,domeT,adj}, over, stone, name｝を ダウンロード／開く。いまの 状態は `localStorage['kumitate.state']`
- テスト：旧の 関数（gravestone-app.js の 13〜172・557〜606・777〜1177 行）を 抜き出して node で 並べ、石塔 3×外柵 4×塔婆立 3×墓誌 2×納骨室 2×敷地 2＝288 通りで 位置・寸法・干渉の 数が 一致。画面は Playwright（swiftshader）で PC 幅・タブレット縦
- 旧の データの まま 重なる もの：和型 9 寸・洋型・墓誌・塔婆立・納骨室 には 置き方の ルールが 無い（旧で 作り途中）→ 干渉が 出る。和型 8 寸＋デザイン 1 は 収まる
- v0.2：**形の ある 部材を 置く**。左の「形の ある 部材」＝見本（`BZ_KORO`）／図面アプリで いま 作って いる 部材（同じ サイトの `localStorage['zumen.part']`）／読んだ buzai/1 の ファイル（`kumitate.parts`）。押すと 同じ 名前の 石（category が 名前に 入る。香炉→香炉）か 選んだ 石に 入る（`ST.shapes[鍵]`＝部材の JSON）。箱の 大きさ＝部材の params W・D・H（`KM.shapeSize`）、3D は `zumen-3d.js` の `partGroup`（底面の 中心が 原点）。幅・奥行・高さの 数字は 部材の params を 直す（中の 寸法は 部材の 式で ついてくる）。［🧊 図面アプリで 形を 直す］＝zumen.part に 入れて zumen.html を 開く。［箱に 戻す］
- 部材エンジン（BZ・BZ_KORO）は v0.6.1 から `buzai-engine.js`（zumen.html と 共通。`<script src>`）
- まだ：置き方の ルールを 画面で 足す・加工（筆返し・雲形穴）の 単価・SharePoint（案件フォルダー・単価表）・オフライン・テクスチャ・お客様向けの 画面・zumen.html に 入れる

---

## 版ごとの 記録
- v0.1：DXF を 読む・隙間チェック・石の 寸法・尺寸の 寸法・DXF／PDF
- v0.2：mics の `.mgx` → 目地ありの 三面図・部材図（寸法表・加工指示図・部品詳細図）
- v0.3：DWG（LibreDWG・開いた ときだけ 読む）／v0.3.1：MTEXT の `\H`・DWG の 閉じた ポリライン／v0.3.2：動かす・測るを 外す・寸法の つまみ／v0.3.3：寸法の 文字・矢印の 大きさ（全体・1 本ずつ）・開いた 矢印・右クリックの メニュー／v0.3.4：元の 寸法線を 寸法に／v0.3.5：元の 矢印の 大きさ・形
- v0.4：部材図を 直す（案 A）・部材ごとの 図の 選択（斜め・正面・右側面・左側面・平面、名前で 覚える）・面取りと 穴の 寸法・線／穴／引出線／▲磨きの 道具
- 2026-11-03：社内アプリ開発へ 移す ため この まとめを 作った（コードは v0.4 の まま）
- v0.5（業務アプリ v1.9.569）：案件と つなぐ（案件の フォルダーから 開く・保存、件名の 取り込み、PDF ファイル（図面・部材図）を 提出資料 か パソコンへ）
- v0.6：部材設計（［🧊 部材設計］。香炉 1 号。図面の 数字を 押して 直す・3D（Three.js r160 同梱）・図面に 入れる → DXF・部材ライブラリに 保存）
- kumitate.html v0.1（別ページ）：組み立て（旧シミュレーターの 部材を 箱で・敷地の 数字・干渉・石種・見積）
- zumen.html v0.6.1・kumitate.html v0.2：部材エンジンを buzai-engine.js に 分けた（中身は 同じ）・zumen-3d.js に partGroup（組み立てと 共通）。組み立てに 香炉 1 号など 形の ある 部材を 置く

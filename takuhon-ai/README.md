# 拓本クリーン化サーバー（U-Net）

彫刻原稿アプリ（`chokoku-genko.html`）の「拾った墨」を、AI で出すためのサーバー。
石肌のざらつき・紙のふち・となりの字を落として、**墨の白黒マスク**を返す。

- 学習用データは、彫刻原稿アプリの［AI学習］が出す ZIP をそのまま使う
- **学習はサーバーでは回さない**。貯めるだけ。学習は夜間に `train.py` を回し、
  検証を通ったものだけ差し替える（作業中にモデルが変わると原因を追えないため）

想定：Ubuntu ＋ NVIDIA RTX 3090

---

## 0. ファイルを持ってくる（いちばん最初）

このフォルダーは GitHub の `111rbubu-art/sekizaiwork` の中にある。
**パソコンにはまだ無い**ので、まず落としてくる。

```bash
sudo apt update && sudo apt install -y git          # git が無ければ
sudo mkdir -p /opt/takuhon-ai && sudo chown $USER: /opt/takuhon-ai

git clone --depth 1 https://github.com/111rbubu-art/sekizaiwork.git ~/sekizaiwork-tmp
cp -r ~/sekizaiwork-tmp/takuhon-ai/. /opt/takuhon-ai/
rm -rf ~/sekizaiwork-tmp

cd /opt/takuhon-ai && ls
# app.py  train.py  unet.py  data.py  check-env.sh  README.md … が並べば OK
```

あとで新しくするときは、同じ `git clone` → `cp -r` をもう一度やればよい
（`runs/` と `data/` は上書きされない）。

## 0b. 最新にする（2 回目からは これだけ）

```bash
bash /opt/takuhon-ai/update.sh
```

新しいプログラムを取ってきて入れ替え、サーバーを入れ直す。
**貯めたデータ（`dataset/`）・モデル（`runs/`）・置いた書体（`fonts/`）には触らない。**

ふだんの作業でターミナルを使うのは**ここだけ**。あとはブラウザで足りる。

## 1. いま何が入っているかを調べる（触らない）

すでに Gemma や Dify が動いているパソコンに足す場合は、先にこれを実行して結果を見る。

```bash
cd /opt/takuhon-ai
bash check-env.sh
```

見るところ

| 出るもの | 意味 |
|---|---|
| `docker ps` に ollama / dify / open-webui | **Docker で動いている**。このサーバーも Docker で立てるなら `docker-compose.yml` を使う |
| `ollama list` に gemma | Ollama で動いている。ポートは 11434 |
| GPU を使っているプロセス | VRAM の残りを見る。3090 は 24GB |
| 待ち受けポート | **8077 が空いているか**。埋まっていたら別の番号にする |

**いま動いているものは触らない。** とくに Dify の `docker compose down -v` は
データが消えるので絶対に打たない。このサーバーは別のまとまり（`-p takuhon`）で立てる。

### VRAM の目安（3090・24GB）

| | 使う量 |
|---|---|
| Gemma 3 4B（Ollama・4bit） | 4〜6GB |
| Gemma 3 12B（4bit） | 9〜12GB |
| 拓本クリーン化：推論 | 1〜2GB |
| 拓本クリーン化：学習（`--bs 4`） | 4〜6GB |

推論だけなら同居して余裕がある。**学習は夜間に回す**前提なら競合しない。
昼に学習を回したい場合は `--bs 2` に落とすか、Gemma を一度止める。

## 2. 下準備（1 回だけ）

```bash
# ドライバーが入っているか確認。表に RTX 3090 と CUDA Version が出れば OK
nvidia-smi

# 入っていなければ（Ubuntu）
sudo ubuntu-drivers autoinstall && sudo reboot
```

## 3. パッケージ

```bash
cd /opt/takuhon-ai

sudo apt update && sudo apt install -y python3-venv python3-pip
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip

# PyTorch（CUDA 12.4 版）。RTX 3090 はこれで動く
pip install torch --index-url https://download.pytorch.org/whl/cu124
pip install -r requirements.txt

# GPU を掴めているか
python3 -c "import torch;print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
# → True NVIDIA GeForce RTX 3090
```

## 4. 学習用データを入れる

共有フォルダー `/業務アプリ/アプリ使用フォント/拓本学習データ` の ZIP を
このパソコンへ落として、

```bash
# フォルダーごと。10 組を検証用に取り分ける（この分は学習に使わない）
python3 import_pairs.py ~/Downloads/拓本学習データ --val 10
```

- `dataset/pairs/` … 学習用
- `dataset/val/` … 検証用。**一度決めたら動かさない**（毎回同じ物差しで測るため）

## 5. 学習

```bash
python3 train.py --epochs 60
```

- `runs/model_YYYYmmdd-HHMM.pth` … 世代。**上書きしない**
- `runs/current.pth` … サーバーが使う版。**手がかり無しの一致が良くなったときだけ**差し替える
- `runs/history.jsonl` … 毎回の記録（一致・組数・日時）

画面に出る数字は 2 つ。

| 表示 | 意味 |
|---|---|
| 一致（手がかりあり） | フォントの字形を渡したとき |
| **一致（手がかり無し）** | **渡さないとき。本番の最低条件。差し替えの判断はこちらで見る** |

## 5b. 1 文字だけで「動くかどうか」試す

仕組みが通しでつながっているかを確かめるためのもの。**まともなモデルは作れない**。

**画面（`http://…:8077/`）の［操作］からできる**ので、ふだんはターミナルは要らない。
① ZIP を選んで［取り込む］→ ②［試すだけ］に印を付けて回数 200 →［学習を始める］。

コマンドでやる場合：

```bash
cd /opt/takuhon-ai && source .venv/bin/activate
python3 import_pairs.py ~/ダウンロード/takuhon-*.zip          # 1 組だけ入れる
python3 train.py --epochs 200 --bs 1 --min 1 --swap-anyway
```

- `--min 1` … ふだんは **8 組未満で止まる**。その下限を下げる
- `--swap-anyway` … 検証用が無くても `current.pth` を差し替える

**回数は 200 くらい必要**。3090 なら数十秒で終わる。少ないと AI の欄が真っ黒のままで、
「動いていない」のか「まだ学べていない」のか分からない（実測：1 組 12 回では真っ黒）。

そのあと `http://…:8077/` を開いて、**［いまのモデル］があり**・
**貯まったデータの「AI」の欄に字が出る**ことを見る。ここまで出れば、
彫刻原稿アプリ → ZIP → 取り込み → 学習 → サーバー → 画面 が**全部つながっている**。

試したあとの片づけ

```bash
rm -f runs/current.pth && rm -rf dataset/pairs/*
```

**この 2 つの逃げ道は、ふだんは使わない。** 8 組未満で学習しても、
その字を丸暗記するだけで、ほかの字には通用しない。

## 4b. ②「整える」の学習データを、フォントから自動で作る

AI は 2 段に分ける（`SPEC-輪郭と補正.md`）。

```
① 読む      拓本      → 綺麗な墨       （正解＝人が直した拓本の墨。ふだんの学習）
② 整える    綺麗な墨  → 書体らしい形   （正解＝フォントそのもの。**データ不要**）
```

②は**こちらのデータを 1 組も必要としない**。フォントを崩して劣化させれば、
何千組でも自動で作れる。**データが貯まる前に始められる。**

**画面（`http://…:8077/`）の［操作］③からできる**ので、ふだんはターミナルは要らない。
書体のファイルを［置く］→［学習データを作る］→［整えるモデルを学習する］。
置いた書体は `fonts/` に入る。`--base` を変えて回すと前のモデルとかたちが合わないが、
**そのときは、そう言ってはじめから学習する**（落ちないように直した）。

コマンドでやる場合：

```bash
cd /opt/takuhon-ai && source .venv/bin/activate
python3 make_synth.py --font /path/to/彫っている書体.ttf --n 3000 --val 200
python3 train.py --data dataset/shape --valdata dataset/shape_val \
                 --name shape --epochs 40
# → runs/current_shape.pth
```

**必ず「実際に彫っている書体」で作る。** 楷書体の癖を覚えさせたいのだから。

### 作り方（1 組）

| ファイル | 中身 |
|---|---|
| `mask.png` | **正解**。フォントを**崩した**字。**角は立っている** |
| `raw.png` | **入力**。それをさらに劣化させた字（角が丸い・欠け・かすれ・盛り） |
| `hint1.png` | 崩していない、そのままのフォントの字（どの字・どの書体か） |

**正解は「崩れたまま、角が立っている字」。** フォントそのものを正解にすると、
AI は「どの字か当てて、フォントを描き直す」ことを覚え、
**彫った職人の癖（画の位置・長さのずれ）を消す**。それは手で変形させるのと同じ。

### 太さを系統的に変えない（大事）

劣化で細く（または太く）なると、AI は「太さを元に戻す」ことを覚え、
**拓本の太さを無視する**ようになる。そのため

- **丸め**は、ぼかしてから**面積が変わらない高さで切る**（0.5 で切ると細い画が痩せる）
- **欠け**は墨の**内ぶち**、**盛り**は**外ぶち**に置く（内側に置くと釣り合わない）
- 最後に**面積を目標へ合わせ込む**（足りなければ盛り、多ければ削る）

実測（200 組）：入力／正解の面積比 **中央値 0.993・平均 0.994**（直す前は 0.94）。
5〜95% は 0.93〜1.06 で、これは**わざと入れた平均 1 のばらつき**。
入力と正解の一致は中央値 0.82（＝解き甲斐のある差）。

## 5a. 彫刻原稿アプリから直接受け取る（おすすめ）

ZIP を書き出して運ぶ手間を無くす。**アプリで保存した瞬間に、ここへ 1 組届く。**
SharePoint への保存は今までどおり続くので、**控えは二重**になる。

下ごしらえは 1 回だけ。**https にする**（アプリは https なので、http へは送れない）。

```bash
# いま動いている 443 → Ollama には触らない。8443 を足すだけ
sudo tailscale serve --bg --https=8443 http://127.0.0.1:8077
tailscale serve status
```

そのあと、本体アプリの **［🧠 拓本AI］を右クリック**して住所を
`https://＜このPCのts.net名＞:8443/` に変える。**画面もサーバーも同じ住所**になる。

これで、彫刻原稿アプリの［この字を学習用に保存］を押すたびに
`POST /api/takuhon/feedback` が飛び、`dataset/pairs` に入る。
同じ案件・同じ字なら**上書き**（key で見分ける）。

サーバーが止まっていても、アプリ側の保存は成功する（送れなかったことだけ出る）。

## 5c. 画面から動かす（ターミナルを開かない）

`http://…:8077/` の**［操作］**で、取り込みから学習・片づけまでできる。

| ところ | できること |
|---|---|
| ① データを入れる | 彫刻原稿アプリの **ZIP をそのまま**（複数可）。学習用／検証用を選べる。学習用から検証用へ ○ 組移すのもここ |
| ② 学習を回す | 回数・一度に見る枚数・モデルの大きさ／**［試すだけ］**／始める・止める／**画面ログがその場に出る** |
| ③ 書体の癖を覚えさせる | **データ不要**。彫っている書体の .ttf を置いて［学習データを作る］→［整えるモデルを学習する］。①の `current.pth` には触らず、`current_shape.pth` を作る |
| ④ 片づけ | いまのモデルを消す／貯めたデータを消す。**「けす」と入れないと実行しない** |

**受け取るのは数と真偽だけ**。画面から来た文字をそのままコマンドに渡すことはしない。

**学習は 1 つずつしか走らせない。** 始めた時点で `runs/train.pid` に pid を置き、
それが生きている間は 409 を返す。**`progress.json` だけでは足りない**（`train.py` は
torch の読み込みに十数秒かかり、その間は何も書かれていない。実測で二重に走った）。
その間、画面には**［支度中］**と出る。

`runs/train.pid` の pid が居ないのに `progress.json` が「学習中」のままなら、
**落ちたものとして見せる**（パソコンごと落ちたときなど。待ち続けずに済む）。

## 6. サーバーを動かす

```bash
uvicorn app:app --host 0.0.0.0 --port 8077
# 常駐させるなら
sudo cp takuhon-ai.service /etc/systemd/system/
sudo sed -i "s/User=%i/User=$USER/" /etc/systemd/system/takuhon-ai.service
sudo systemctl daemon-reload && sudo systemctl enable --now takuhon-ai
```

夜間学習を自動で回すなら

```bash
sudo cp takuhon-train.service takuhon-train.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now takuhon-train.timer
```

## 6b. Docker で動かす場合

すでに何でも Docker で動かしているなら、こちらでもよい。

```bash
# 先に NVIDIA Container Toolkit（1 回だけ）
sudo apt install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker && sudo systemctl restart docker

cd /opt/takuhon-ai
docker compose -p takuhon up -d --build
docker compose -p takuhon logs -f
```

- **必ず `-p takuhon` を付ける**（Dify などのまとまりと混ぜない）
- `dataset/` と `runs/` はホスト側に置いてある。コンテナを作り直しても消えない
- 学習は `docker compose -p takuhon exec takuhon-ai python train.py --epochs 60`
- **`down -v` は打たない**

## 6c. 状況を見る画面（モニタリング）

サーバーを動かしたまま、ブラウザで **`http://localhost:8077/`**
（別のパソコンからなら `http://<このPCのIP>:8077/`）を開くと、状況が一枚で見える。
**5 秒ごとに自動で読み直す。外の部品は一切使っていない**ので、
インターネットに出ていないパソコンでもそのまま動く。

出るもの

| ところ | 何が分かる |
|---|---|
| 上の札 | いまのモデル（あり／まだ無い・step・日付）、**一致（手がかり無し）＝本番の実力**、貯まった組数、GPU の使われ具合（％・VRAM・温度・W） |
| 学習の様子 | 学習中／終わった／落ちた、いま何回め、誤り・一致、**残り時間の見当**、差し替えたかどうかとその理由 |
| 成績のうつり変わり | 1 回ごとの折れ線。**赤＝誤り（小さいほど良い）／青＝一致・手がかり無し／緑＝一致・手がかりあり** |
| 世代の記録 | `history.jsonl`。前の世代との差を pt で出す（良くなれば緑、悪くなれば朱） |
| 貯まったデータ | 1 組ずつ **拓本／人が直した正解／AI の出す答え** を並べる。押すと拡大。字ごとの数も出る |

**夜に自動で回すので、画面のログは朝には流れて消えている。**
そのため `train.py` は 1 回ごとに `runs/progress.json` と `runs/curve.jsonl` へ
書き出す。**朝この画面を開けば、夜に何が起きたかが分かる**（落ちたことも残る）。

読むだけの画面で、学習にも `current.pth` にも触らない。
「AI」の列だけは**いまのモデルにその組を通した結果**なので、モデルが無いうちは薄く出る。

## 7. 呼び方

```bash
# 生きているか
curl http://localhost:8077/health

# いま使っている版と、貯まった組数
curl http://localhost:8077/api/takuhon/status

# 切り抜きを渡して、墨の白黒マスクをもらう
curl -X POST http://localhost:8077/api/takuhon/clean \
  -F file=@raw.png -F hint1=@hint1.png -F hint2=@hint2.png -o mask.png

# 人が直した正解を貯める（同じ key なら上書き）
curl -X POST http://localhost:8077/api/takuhon/feedback \
  -F raw_image=@raw.png -F corrected_image=@mask.png \
  -F char_hint=日 -F key=pair_宇田川_g1-7_日
```

- `hint1` / `hint2` は**無くてよい**（無い前提で学習してある）
- 返す PNG のヘッダーに `X-Model-Step` / `X-Model-At` / `X-Infer-Ms` が入る
- **学習済みが無いときは 503**。呼ぶ側は、いままでのしきい値処理へ戻すこと

## つまずいたところ（2026-09-10・実際に直した記録）

`nvidia-smi` が **NVIDIA-SMI has failed** としか言わず、GPU が使えなかった。
板（RTX 3090）は `lspci` で見えていて、セキュアブートも切ってあった。

**原因**：22.04 → 24.04 にアップグレードしたときの**置き去りのドライバー**。

- 入っていたのは `nvidia-driver-595-open` の **`595.91.07-0ubuntu0.22.04.1`**
  （＝ CUDA リポジトリの `ubuntu2204` 版）
- そのリポジトリは `cuda-ubuntu2204-x86_64.list**.distUpgrade**` に改名されて
  **無効**になっていた。＝ **後ろ盾を失った荷物**
- ドライバーの部品は「カーネルごとの作り置き」で入っており、**138 用まで**しか無い。
  DKMS が入っていないので誰も作り直さない。カーネルが **139** に上がって置き去りになった
- Ubuntu 純正の部品は **595.84** 用。**版が違うので混ぜられない**
  （`依存: nvidia-kernel-common-595 (<= 595.84-1)` で弾かれる）

**直し方**：置き去りを捨てて、Ubuntu 純正に揃える。リポジトリの差し替えは要らなかった。

```bash
# 消す顔ぶれを先に見る。nvidia-container-toolkit が入っていないことを確かめる
dpkg -l | awk '$3 ~ /22\.04/ && $2 ~ /nvidia/ {print $2, $3}'

# TTY（Ctrl+Alt+F3）から、purge → install → reboot を一気に流す
sudo apt purge -y $(dpkg -l | awk '$3 ~ /22\.04/ && $2 ~ /nvidia/ {print $2}')
sudo apt autoremove -y
sudo apt install -y nvidia-driver-595-open
sudo reboot
```

**結果**：Driver 595.84 / CUDA 13.2 / 3090 24GB が見えるようになった。
`cuda-toolkit-12-4` と `nvidia-container-toolkit`（Docker から GPU を使う部品）は
**purge の対象外**なので、Dify・Ollama 側は無傷。

**次からは起きない**。純正は noble-updates が面倒を見るので、カーネル更新のときに
部品も一緒に付いてくる。

### 見分けかた（また似たことが起きたら）

`bash check-env.sh` が `nvidia-smi` の失敗を見つけると、
**板が見えているか（lspci）／deb が入っているか／カーネルに読まれているか（lsmod・dkms）／
セキュアブート／ヘッダー**を分けて出す。どこで止まっているかはそこで分かる。

## 守ること

1. **推論は学習と同じ切り方で渡す**（512×512・まわりの字を隠す）。
   切り方が違うと、塗りつぶしの境目をモデルが手がかりにしてしまい、本番で外れる
2. **手がかり（hint）は学習中に 4 割ほど白紙にしてある**（`train.py` の `HINT_DROP`）。
   これをやめると、拓本を見ずに手がかりを写すだけのモデルになる
3. **検証用（`dataset/val`）は動かさない**。毎回同じ物差しで測る
4. **悪くなったら差し替えない**。世代は必ず残す

## 目安

- 推論：512×512 で 3090 なら 5〜15ms（HTTP 込みで 30ms 前後）
- 学習：100 組・60 epoch で 5〜10 分
- 使い物になる組数：**50 組から**。安定するのは 200〜300 組

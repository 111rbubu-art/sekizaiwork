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

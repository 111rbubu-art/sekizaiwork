"""拓本クリーン化サーバー（FastAPI）。

  POST /api/takuhon/clean      切り抜きを渡すと、墨の白黒マスク（PNG）を返す
  POST /api/takuhon/feedback   人が直した正解を貯める（学習は回さない。すぐ返す）
                               set=ink なら①「墨出し」用、set=shape なら②「整える」用
  POST /api/takuhon/line       人が直した**列まるごと**を貯める（字の枠と読みつき）
  POST /api/takuhon/boxes      列の切り抜きを渡すと、**1 字ずつの枠**を返す（枠の AI）
  POST /api/takuhon/guess      1 字の切り抜きを渡すと、**読みの候補**を返す（読みの AI）
  POST /api/takuhon/chars      手本帳の 1 字を貯める（読みの学習材料）
  GET  /api/takuhon/lines      貯まった列の一覧
  GET  /api/takuhon/line/{id}  その列の枠と読み（meta.json）
  POST /api/takuhon/line/{id}/off   その列を学習に使う／使わない（消さずに外す）
  DELETE /api/takuhon/line/{id}     その列を消す（間違って登録したとき）
  GET  /api/takuhon/lineimg/.. 列の画像（raw／ink）
  GET  /api/takuhon/status     いま使っているモデルと、貯まった組数
  GET  /api/takuhon/progress   学習の途中経過（train.py が置く runs/progress.json）
  GET  /api/takuhon/curve      1 エポックごとの成績（いまの回）
  GET  /api/takuhon/curves     世代ごとの 1 エポックごとの成績（くらべる用）
  GET  /api/takuhon/history    世代の記録（history.jsonl）
  GET  /api/takuhon/pairs      貯まった組の一覧（字・日付・手がかりの有無）
  GET  /api/takuhon/img/...    組の画像（生／正解／手がかり／AI の出力）
  GET  /                       見るための画面（dash.html）
  POST /api/takuhon/import     ZIP を受け取って dataset へ入れる（画面から）
  POST /api/takuhon/train      学習を始める（画面から。1 つずつしか走らせない）
  POST /api/takuhon/train/stop 学習を止める
  GET  /api/takuhon/trainlog   学習の画面ログ（うしろの方だけ）
  GET  /health                 生きているか

考え方
  ・**学習はここでは回さない**。貯めるだけ。学習は train.py を夜間に回し、
    検証を通ったものだけ current.pth に差し替える。
    作業中にモデルが変わると、原因の切り分けができなくなるため。
  ・返す PNG には、どの版で作ったかを X-Model-Step / X-Model-At で入れる。
  ・**推論は学習と同じ切り方で渡すこと**（まわりの字を隠す・512×512）。
"""
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
import zipfile
from datetime import datetime

import numpy as np
import torch
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from PIL import Image

import boxdata as BD
import chardata as CD
import data as D
import make_synth as MS
from boxnet import find_boxes, load_boxnet
from charnet import guess as char_guess_top
from charnet import load_charnet
from unet import load_model

ROOT = os.path.dirname(os.path.abspath(__file__))
DATASET = os.path.join(ROOT, "dataset", "pairs")
RUNS = os.path.join(ROOT, "runs")
CURRENT = os.path.join(RUNS, "current.pth")
VALDIR = os.path.join(ROOT, "dataset", "val")
SHAPE = os.path.join(ROOT, "dataset", "shape")            # ②「整える」の学習用
SHAPE_VAL = os.path.join(ROOT, "dataset", "shape_val")    # ②「整える」の検証用
# **拓本から取り出した②の材料は、合成と分けて置く**（2026-09-16。本人の指摘
# 「整える方は今までと材料が違うので、分けた方がいい」）。
# 混ぜて学習することも、別々に学習して比べることもできるようにするため。
SHAPE_RUB = os.path.join(ROOT, "dataset", "shape_rub")          # ②・拓本から取り出した学習用
SHAPE_RUB_VAL = os.path.join(ROOT, "dataset", "shape_rub_val")  # ②・拓本から取り出した検証用
# **人が直した列まるごと**（2026-09-21。本人の指示「AIに登録できるように進めましょう」）。
# 1 字ずつの組（dataset/pairs）とは別物。字の切り分け（枠）と読みを教えるための材料で、
# のちに「字の中心を出すモデル」と「字を見分けるモデル」の学習に使う。
LINES = os.path.join(ROOT, "dataset", "lines")
# **手本帳**（彫刻原稿アプリが覚えている 1 字）。読みの学習に混ぜる。
CHARS = os.path.join(ROOT, "dataset", "chars")
FONTS = os.path.join(ROOT, "fonts")                       # 彫っている書体の置き場
TRAINLOG = os.path.join(RUNS, "train.log")
TRAINPID = os.path.join(RUNS, "train.pid")


def _nm(which):
    """画面の①②③④を、ファイルの名前に直す（2026-09-22 に ③枠・④読み を追加）。

    ① 墨出し   … current（progress_current.json / train_current.log）
    ② 整える … shape
    ③ 枠     … box   （train_box.py が progress_box.json を書く）
    ④ 読み   … char  （train_char.py が progress_char.json を書く）
    """
    return {"shape": "shape", "box": "box", "char": "char"}.get(which, "current")


def _retire_old():
    """①②で共用していたころの記録を、わきへどける。

    **①のものとして拾ってはいけない。** 実際に、②の学習（フォントの癖・1850 組）が
    ①「墨出し（拓本）」の欄に「27 / 40 回め」と出て、
    「拓本の学習はしていないはずだが？」と迷わせた（2026-09-12）。
    どちらの学習だったかは記録に残っていないので、**分かる名前にして外す**のが正しい。
    """
    for a, b in (("progress.json", "progress_old.json"),
                 ("curve.jsonl", "curve_old.jsonl"),
                 ("train.log", "train_old.log")):
        src, dst = os.path.join(RUNS, a), os.path.join(RUNS, b)
        if os.path.exists(src) and not os.path.exists(dst):
            try:
                os.rename(src, dst)
                print("①②を分ける前の記録を %s へどけました（どちらの学習か分からないため）" % b)
            except OSError:
                pass


def _progress_path(which):
    """①「墨出し」と②「整える」を**混ぜない**。名前ごとに別のファイル。"""
    return os.path.join(RUNS, "progress_%s.json" % _nm(which))


def _curve_path(which):
    return os.path.join(RUNS, "curve_%s.jsonl" % _nm(which))


def _log_path(which):
    return os.path.join(RUNS, "train_%s.log" % _nm(which))
SYNTHLOG = os.path.join(RUNS, "synth.log")
SYNTHPID = os.path.join(RUNS, "synth.pid")
SAFE = re.compile(r"^[A-Za-z0-9._\-]{1,120}$")


def _keep_name(s):
    """フォルダーの名前を作る。**日本語は残す**（`feedback` と同じ決まり）。

    `/`・`\\`・空白などだけを `_` に替え、`..` は使わせない。
    ここで日本語を潰すと、別の案件どうしが同じ名前になってぶつかる。
    """
    s = "".join(c if (c.isalnum() or c in "-_." or ord(c) > 127) else "_"
                for c in (s or ""))[:120]
    s = s.strip(".") or "zip"
    return s


def _pair_dir(root, pid):
    """組のフォルダーを、名前から安全に引く。無ければ None。

    **日本語の名前を弾かないこと**（2026-09-13 の不具合）。
    ①「墨出し」の組は、彫刻原稿アプリが `pair_<家名>_g0-3_<字>` という名前で
    送ってくる（`feedback` は `ord(c) > 127` を通すので、そのまま保存される）。
    ところが絵を返す口は ASCII だけの `SAFE` で見ていたので、
    **①の組の絵がぜんぶ 400 になって、1 枚も出なかった**。
    ②（合成）の組は `syn_00001` と ASCII なので出ていた。それで
    「②は出るのに①は出ない」という見え方になっていた。

    名前の中身で決めるのはやめて、**出来上がった道が root の中に居るか**で見る。
    こうすれば、どんな字が入っていても通り、`..` や `/` では外へ出られない。
    """
    if not root or not pid or len(pid) > 200:
        return None
    if "/" in pid or "\\" in pid or "\0" in pid or pid in (".", ".."):
        return None
    d = os.path.realpath(os.path.join(root, pid))
    r = os.path.realpath(root)
    if d != r and not d.startswith(r + os.sep):
        return None
    return d if os.path.isdir(d) else None


os.makedirs(DATASET, exist_ok=True)
os.makedirs(RUNS, exist_ok=True)
_retire_old()

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
NET, INFO = load_model(CURRENT, DEVICE)
LOADED_AT = time.time()
# ②「整える」のモデル（書体の癖）。①とは別物なので、別に持つ。
CURRENT2 = os.path.join(RUNS, "current_shape.pth")
NET2, INFO2 = load_model(CURRENT2, DEVICE)
LOADED_AT2 = time.time()
# **枠の AI**（2026-09-21）。列の切り抜きから 1 字ずつの枠を出す。
# 墨のモデルとは別物なので、別に持つ（train_box.py が置く）。
CURRENTB = os.path.join(RUNS, "box_current.pth")
NETB, INFOB = load_boxnet(CURRENTB, DEVICE)
LOADED_ATB = time.time()
# **読みの AI**（2026-09-21）。1 字の切り抜きから、どの字かを当てる。
CURRENTC = os.path.join(RUNS, "char_current.pth")
NETC, INFOC = load_charnet(CURRENTC, DEVICE)
LOADED_ATC = time.time()

app = FastAPI(title="拓本クリーン化")
# 社内のブラウザ（彫刻原稿アプリ）から呼ぶので、同じ LAN からは通す。
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
    expose_headers=["X-Model-Step", "X-Model-At", "X-Model-Loaded",
                    "X-Stage", "X-Soft", "X-Infer-Ms"],
)


# 読めなかったファイルを、要求のたびに読み直さないための覚え書き（path → 日付）。
TRIED = {}


def _reload_if_new():
    """current.pth が新しくなっていたら読み直す（夜間学習のあと）。"""
    global NET, INFO, LOADED_AT
    try:
        m = os.path.getmtime(CURRENT)
    except OSError:
        # モデルを消したのに、覚えている分を手放していなかった（実測）。
        # 画面には「あり」と出たまま、答えも返り続けてしまう。
        if INFO.get("loaded"):
            NET, INFO = load_model(CURRENT, DEVICE)
            LOADED_AT = time.time()
        return
    # **持っていないときは、日付が古くても読む。**
    # cp でしまい直すと日付が元のままのことがあり、
    # 「置いたのに、いつまでも『モデルがありません』」になった。
    if m > LOADED_AT or (not INFO.get("loaded") and TRIED.get(CURRENT) != m):
        TRIED[CURRENT] = m
        NET, INFO = load_model(CURRENT, DEVICE)
        LOADED_AT = max(m, LOADED_AT)


def _reload2_if_new():
    """②のモデルも、新しくなっていたら読み直す。"""
    global NET2, INFO2, LOADED_AT2
    try:
        m = os.path.getmtime(CURRENT2)
    except OSError:
        if INFO2.get("loaded"):
            NET2, INFO2 = load_model(CURRENT2, DEVICE)
            LOADED_AT2 = time.time()
        return
    if m > LOADED_AT2 or (not INFO2.get("loaded") and TRIED.get(CURRENT2) != m):
        TRIED[CURRENT2] = m
        NET2, INFO2 = load_model(CURRENT2, DEVICE)
        LOADED_AT2 = max(m, LOADED_AT2)


def _reloadb_if_new():
    """枠のモデルも、新しくなっていたら読み直す。"""
    global NETB, INFOB, LOADED_ATB
    try:
        m = os.path.getmtime(CURRENTB)
    except OSError:
        if INFOB.get("loaded"):
            NETB, INFOB = load_boxnet(CURRENTB, DEVICE)
            LOADED_ATB = time.time()
        return
    if m > LOADED_ATB or (not INFOB.get("loaded") and TRIED.get(CURRENTB) != m):
        TRIED[CURRENTB] = m
        NETB, INFOB = load_boxnet(CURRENTB, DEVICE)
        LOADED_ATB = max(m, LOADED_ATB)


def _reloadc_if_new():
    """読みのモデルも、新しくなっていたら読み直す。"""
    global NETC, INFOC, LOADED_ATC
    try:
        m = os.path.getmtime(CURRENTC)
    except OSError:
        if INFOC.get("loaded"):
            NETC, INFOC = load_charnet(CURRENTC, DEVICE)
            LOADED_ATC = time.time()
        return
    if m > LOADED_ATC or (not INFOC.get("loaded") and TRIED.get(CURRENTC) != m):
        TRIED[CURRENTC] = m
        NETC, INFOC = load_charnet(CURRENTC, DEVICE)
        LOADED_ATC = max(m, LOADED_ATC)


def _read_gray(b, size=D.N):
    im = Image.open(__import__("io").BytesIO(b)).convert("L")
    if im.size != (size, size):
        im = im.resize((size, size), Image.BILINEAR)
    return np.asarray(im, dtype=np.float32) / 255.0


@app.get("/health")
def health():
    return {"ok": True, "device": str(DEVICE), "model_loaded": INFO["loaded"]}


@app.get("/api/takuhon/status")
def status():
    _reload_if_new()
    _reloadb_if_new()                 # 枠（学習が終わっていれば、ここで拾う）
    _reloadc_if_new()                 # 読み
    n = len(D.list_pairs(DATASET))
    sh = None
    try:
        sh = _read_json(os.path.join(RUNS, "shape_info.json"), None)
    except Exception:
        sh = None
    return {
        "device": str(DEVICE),
        "cuda": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        "model": INFO,
        "pairs": n,
        "val": len(D.list_pairs(VALDIR)),
        "lines": len(_line_ids()),
        "box": {"model": INFOB, "lines": len(_line_ids())},
        "char": {"model": INFOC, "chars": _chars_count()},
        "shape": {"pairs": len(D.list_pairs(SHAPE)), "val": len(D.list_pairs(SHAPE_VAL)),
                  "rub": len(D.list_pairs(SHAPE_RUB)),
                  "rubVal": len(D.list_pairs(SHAPE_RUB_VAL)),
                  "model": _shape_info(), "loaded": bool(INFO2.get("loaded"))},
    }


@app.post("/api/takuhon/clean")
async def clean(
    file: UploadFile = File(...),
    hint1: UploadFile = File(None),
    hint2: UploadFile = File(None),
    thresh: float = Form(0.5),
    stage: str = Form("ink"),
    soft: bool = Form(False),
):
    """拓本の切り抜きを、AI に通して返す。

    stage="ink"   … ① 墨出し（拓本 → 綺麗な墨）
    stage="shape" … ② 整える（綺麗な墨 → 書体らしい形）
    stage="both"  … ①のあと②（本番はこれ）

    soft=true なら **0/1 ではなく濃淡（確からしさ）** を返す。
    0.5 で切ってしまうと、輪郭をたどるときに ます目より細かい情報を捨ててしまう
    （SPEC-輪郭と補正.md）。なぞるときは soft で受け取ること。
    """
    _reload_if_new(); _reload2_if_new()
    want1 = stage in ("ink", "both")
    want2 = stage in ("shape", "both")
    if want1 and not INFO["loaded"]:
        return JSONResponse({"error": "no_model", "detail": "①「墨出し」のモデルがありません"},
                            status_code=503)
    if want2 and not INFO2["loaded"]:
        return JSONResponse({"error": "no_model_shape", "detail": "②「整える」のモデルがありません"},
                            status_code=503)
    raw = _read_gray(await file.read())
    h1 = _read_gray(await hint1.read()) if hint1 is not None else None
    h2 = _read_gray(await hint2.read()) if hint2 is not None else None
    t0 = time.time()
    y = raw
    with torch.no_grad():
        if want1:
            x = D.to_input(raw, h1, h2)
            y = torch.sigmoid(NET(torch.from_numpy(x[None]).to(DEVICE)))[0, 0].cpu().numpy()
        if want2:
            # ②は手がかりを見ない（フォントを描き写す近道を覚えさせないため）
            x2 = D.to_input(y, None, None)
            y = torch.sigmoid(NET2(torch.from_numpy(x2[None]).to(DEVICE)))[0, 0].cpu().numpy()
    ms = int((time.time() - t0) * 1000)
    out = y.astype(np.float32) if soft else (y > float(thresh)).astype(np.float32)
    png = D.png_bytes(out)
    I = INFO2 if want2 else INFO
    return Response(content=png, media_type="image/png", headers={
        "X-Stage": stage,
        "X-Soft": "1" if soft else "0",
        "X-Model-Step": str(I.get("step", 0)),
        "X-Model-At": str(I.get("at") or ""),
        "X-Infer-Ms": str(ms),
    })


@app.post("/api/takuhon/boxes")
async def boxes(
    file: UploadFile = File(...),
    ink: UploadFile = File(None),
    thresh: float = Form(0.3),
    with_ink: bool = Form(True),
):
    """**列の切り抜き**を渡すと、1 字ずつの枠を返す（2026-09-21）。

    返り  {"boxes":[{"x","y","w","h","score"}], "w","h", ...}
          x,y,w,h は **渡した絵の画素**。アプリはそのまま青枠にできる。

    中では
      ① 墨のモデル（①「墨出し」）に通して墨を作る（`ink` を渡せば それを使う）
      ② 枠のモデルに「拓本＋墨」を渡して、中心の山と 幅・高さを出す
      ③ 山の頂を拾って、枠の並びにする
    たての長い絵を **そのまま 1 度**に通す（列を切らないので、上下で食いちがわない）。
    """
    _reloadb_if_new()
    if not INFOB.get("loaded"):
        return JSONResponse({"error": "no_model_box",
                             "detail": "枠のモデルがまだありません（train_box.py で学習してください）",
                             "why": INFOB.get("why")}, status_code=503)
    im = Image.open(__import__("io").BytesIO(await file.read())).convert("L")
    w0, h0 = im.size
    if w0 < 8 or h0 < 8:
        return JSONResponse({"error": "too_small"}, status_code=400)
    # 学習と同じ **横 W_STD** にそろえる（字の大きさをそろえるため）
    sc = BD.W_STD / float(w0)
    W, H = BD.W_STD, max(16, int(round(h0 * sc)))
    raw = np.asarray(im.resize((W, H), Image.BILINEAR), dtype=np.float32) / 255.0
    # **どの墨を使ったかを返す**（2026-09-22。本人の問い「枠の AI は墨を見ていないのか」）。
    #   sent … アプリが送ってきた墨（＝1 字窓で通した、質のよい墨）
    #   made … ここで作った墨（細長い列をそのまま通すので、質は落ちる）
    #   none … 墨なし（拓本だけで枠を出す）
    if ink is not None:
        ik = Image.open(__import__("io").BytesIO(await ink.read())).convert("L")
        ink_a = (np.asarray(ik.resize((W, H), Image.NEAREST), dtype=np.float32) / 255.0 > 0.5)
        ink_a = ink_a.astype(np.float32)
        ink_src = "sent"
    elif with_ink and INFO.get("loaded"):
        _reload_if_new()
        ink_a = _ink_of(raw)
        ink_src = "made"
    else:
        ink_a = np.zeros((H, W), dtype=np.float32)
        ink_src = "none"
    ph = (16 - H % 16) % 16                  # たては 16 の倍数にそろえる
    x = np.stack([raw, ink_a], axis=0)
    if ph:
        x = np.pad(x, ((0, 0), (0, ph), (0, 0)))
    t0 = time.time()
    got = find_boxes(NETB, torch.from_numpy(x[None]).to(DEVICE), thr=float(thresh))
    ms = int((time.time() - t0) * 1000)
    out = []
    for b in got:
        if b["cy"] > H:                      # 継ぎ足した所に出たものは捨てる
            continue
        out.append({"x": round((b["cx"] - b["w"] / 2) / sc, 1),
                    "y": round((b["cy"] - b["h"] / 2) / sc, 1),
                    "w": round(b["w"] / sc, 1), "h": round(b["h"] / sc, 1),
                    "score": round(b["score"], 3)})
    out.sort(key=lambda b: b["y"])           # 上から順に
    return {"boxes": out, "n": len(out), "w": w0, "h": h0, "ms": ms,
            "ink": ink_src, "inkPct": round(float(ink_a.mean()) * 100, 1),
            "model": {"step": INFOB.get("step"), "at": INFOB.get("at"),
                      "f1": INFOB.get("f1"), "lines": INFOB.get("lines")}}


def _ink_of(raw):
    """墨のモデルに通して、墨（0/1）を返す。**512 に切らず、そのままの形で通す**。"""
    with torch.no_grad():
        z = np.zeros_like(raw)
        x = np.stack([raw, z, z], axis=0)
        H, W = raw.shape
        ph, pw = (16 - H % 16) % 16, (16 - W % 16) % 16
        if ph or pw:
            x = np.pad(x, ((0, 0), (0, ph), (0, pw)))
        y = torch.sigmoid(NET(torch.from_numpy(x[None]).to(DEVICE)))[0, 0].cpu().numpy()
    return (y[:H, :W] > 0.5).astype(np.float32)


@app.post("/api/takuhon/guess")
async def guess_char(
    file: UploadFile = File(...),
    top: int = Form(5),
):
    """**1 字の切り抜き**を渡すと、読みの候補を返す（2026-09-21）。

    返り  {"cands":[{"ch":"令","p":0.88}, ...], "model":{...}}

    渡す絵は **枠の 1.15 倍**で切ったもの。縦横の比は変えずにこちらで 64×64 に収める
    （引き伸ばすと 十 と 一 が同じ形になるため。彫刻原稿アプリの手本帳で実際に起きた）。
    """
    _reloadc_if_new()
    if not INFOC.get("loaded") or NETC is None:
        return JSONResponse({"error": "no_model_char",
                             "detail": "読みのモデルがまだありません（train_char.py で学習してください）",
                             "why": INFOC.get("why")}, status_code=503)
    im = Image.open(__import__("io").BytesIO(await file.read())).convert("L")
    a = CD.fit(im)
    if a is None:
        return JSONResponse({"error": "too_small"}, status_code=400)
    t0 = time.time()
    x = torch.from_numpy(a[None][None]).to(DEVICE)
    cands = char_guess_top(NETC, x, top=max(1, min(int(top), 10)))
    return {"cands": cands, "ms": int((time.time() - t0) * 1000),
            "model": {"step": INFOC.get("step"), "at": INFOC.get("at"),
                      "acc": INFOC.get("acc"), "top3": INFOC.get("top3"),
                      "chars": INFOC.get("chars")}}


@app.post("/api/takuhon/chars")
async def put_char(
    file: UploadFile = File(...),
    ch: str = Form(...),
    key: str = Form(""),
):
    """**手本帳の 1 字**を貯める（読みの学習材料）。同じ key なら上書き。

    置き場は dataset/chars/<字>/<key>.png。
    拓本から切り出した字（dataset/lines）の方が効くが、
    拓本に出にくい字の穴うめになる。
    """
    ch = (ch or "").strip()
    if len(ch) != 1:
        return JSONResponse({"error": "bad_char", "detail": "字は 1 文字で渡してください"},
                            status_code=400)
    d = os.path.join(CHARS, ch)
    os.makedirs(d, exist_ok=True)
    name = "".join(c for c in (key.strip() or datetime.now().strftime("t%Y%m%d-%H%M%S%f"))
                   if c.isalnum() or c in "-_.")
    f = os.path.join(d, name + ".png")
    replaced = os.path.exists(f)
    open(f, "wb").write(await file.read())
    return {"status": "saved", "ch": ch, "id": name, "replaced": replaced,
            "n": len([x for x in os.listdir(d) if x.endswith(".png")])}


def _chars_count():
    out = {}
    if not os.path.isdir(CHARS):
        return out
    for c in sorted(os.listdir(CHARS)):
        d = os.path.join(CHARS, c)
        if os.path.isdir(d):
            n = len([x for x in os.listdir(d) if x.lower().endswith(".png")])
            if n:
                out[c] = n
    return out


@app.get("/api/takuhon/chars")
def chars_list(samples: int = 0):
    """貯まった手本の数（字ごと）。

    samples=N … 字ごとに、手本の**ファイル名**を N 枚まで付ける。
    画面（拓本AI の「覚えたもの」）が、その字の見本を並べて出すのに使う。
    絵そのものは /api/takuhon/charimg/<字>/<名前>.png から。
    """
    c = _chars_count()
    out = {"chars": c, "kinds": len(c), "all": sum(c.values()), "model": INFOC}
    if samples > 0:
        n = max(1, min(samples, 12))
        sm = {}
        for ch in c:
            d = os.path.join(CHARS, ch)
            try:
                fs = sorted(x for x in os.listdir(d) if x.lower().endswith(".png"))
            except OSError:
                fs = []
            sm[ch] = fs[:n]
        out["samples"] = sm
    return out


@app.get("/api/takuhon/charimg/{ch}/{name}.png")
def charimg(ch: str, name: str):
    """手本帳の 1 枚。"""
    ch = (ch or "").strip()
    name = "".join(x for x in (name or "") if x.isalnum() or x in "-_.")
    if len(ch) != 1 or not name:
        return JSONResponse({"error": "bad_request"}, status_code=400)
    f = os.path.join(CHARS, ch, name + ".png")
    if not os.path.exists(f):
        return JSONResponse({"error": "not_found"}, status_code=404)
    return FileResponse(f, media_type="image/png")


@app.post("/api/takuhon/feedback")
async def feedback(
    raw_image: UploadFile = File(...),
    corrected_image: UploadFile = File(...),
    hint1: UploadFile = File(None),
    hint2: UploadFile = File(None),
    char_hint: str = Form(""),
    key: str = Form(""),
    set_: str = Form("ink", alias="set"),
    box: str = Form(""),
):
    """人が直した正解を貯める。**同じ key なら上書き**（彫刻原稿アプリと同じ考え方）。

    set="ink"       … ①「墨出し」用（拓本の切り抜き → 人が直した墨）。dataset/pairs
    set="shape_rub" … ②「整える」用で、**拓本から取り出したもの**。dataset/shape_rub
    set="shape"     … ②「整える」用で、合成（フォントを荒らしたもの）。dataset/shape

    **1 つの字から 2 つの学習が取れる**（本人の案）。拓本から縁取りを直して①へ、
    その縁取りを整えて②へ。組の作りはどちらも同じ（raw.png ／ mask.png）なので、
    入れ先を分けるだけでよい。
    """
    # **知らない入れ先は はねる**（2026-09-23）。前は 何でも ①（dataset/pairs）へ入れていたので、
    # サーバーが古くて "shape_rub" を知らなかった頃の ② の組が ① に混ざった（本人の報告）。
    sk = (set_ or "ink").strip() or "ink"
    if sk not in ("ink", "shape", "shape_rub"):
        return JSONResponse({"error": "bad_set", "detail": "入れ先 %s を知りません" % sk},
                            status_code=400)
    root = {"shape": SHAPE, "shape_rub": SHAPE_RUB}.get(sk, DATASET)
    name = key.strip() or datetime.now().strftime("pair_%Y%m%d-%H%M%S")
    name = "".join(c for c in name if c.isalnum() or c in "-_." or ord(c) > 127)
    d = os.path.join(root, name)
    # **前の組を置きかえたのかどうかを、必ず返す**（2026-09-18。本人の指摘
    # 「すでに同じところからの文字があった場合、保存できないのではないですか」）。
    # 同じ key は上書き（それが狙い）だが、黙って消えると気づけない。
    replaced = os.path.isdir(d)
    os.makedirs(d, exist_ok=True)
    open(os.path.join(d, "raw.png"), "wb").write(await raw_image.read())
    open(os.path.join(d, "mask.png"), "wb").write(await corrected_image.read())
    if hint1 is not None:
        open(os.path.join(d, "hint1.png"), "wb").write(await hint1.read())
    if hint2 is not None:
        open(os.path.join(d, "hint2.png"), "wb").write(await hint2.read())
    meta = {"char": char_hint, "key": name, "at": datetime.now().isoformat(timespec="seconds")}
    # **その字の枠**（512 の切り抜きの中の x1,y1,x2,y2）。彫刻原稿アプリが送ってくる。
    # いまは覚えるだけ。あとで「枠の外は採点しない」を入れるときに使う
    # （2026-09-19。本人の指摘「枠外が消えないために縦線になっています」）。
    if box.strip():
        try:
            v = [int(float(t)) for t in box.split(",")]
            if len(v) == 4:
                meta["box"] = v
        except ValueError:
            pass
    with open(os.path.join(d, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    # **上書きしたら、組の時刻も新しくする**（2026-09-23。本人の報告
    # 「①墨出しに登録するを押しても、拓本AIの貯まったデータで確認できず」）。
    # 中のファイルを書きかえても **入れ物（フォルダ）の時刻は変わらない**。
    # 一覧は その時刻で新しい順に並べ、絵の版（mt）にも使っているので、
    # 登録し直した組が 古い位置に埋もれたまま・絵も前のまま だった。
    try:
        os.utime(d, None)
    except OSError:
        pass
    return {"status": "saved", "saved_id": name, "replaced": replaced,
            "set": {SHAPE: "shape", SHAPE_RUB: "shape_rub"}.get(root, "ink"),
            "pairs": len(D.list_pairs(root))}


def _line_dir(pid):
    """dataset/lines の中の 1 つ。変な名前で外へ出られないようにする。"""
    nm = "".join(c for c in (pid or "") if c.isalnum() or c in "-_." or ord(c) > 127)
    if not nm or nm.startswith("."):
        return None
    d = os.path.join(LINES, nm)
    return d if os.path.isdir(d) else None


def _line_boxes(s):
    """枠の並びを読む。[{x,y,w,h,ch,g}, ...]。おかしいものは捨てる。"""
    try:
        v = json.loads(s or "[]")
    except ValueError:
        return []
    if not isinstance(v, list):
        return []
    out = []
    for it in v[:200]:
        if not isinstance(it, dict):
            continue
        try:
            b = {k: float(it.get(k, 0)) for k in ("x", "y", "w", "h")}
        except (TypeError, ValueError):
            continue
        if b["w"] <= 0 or b["h"] <= 0:
            continue
        b = {k: round(v2, 1) for k, v2 in b.items()}
        b["ch"] = str(it.get("ch") or "")[:4]
        b["g"] = str(it.get("g") or "")[:8]
        out.append(b)
    return out


@app.post("/api/takuhon/line")
async def line(
    raw_image: UploadFile = File(...),
    ink_image: UploadFile = File(None),
    boxes: str = Form(""),
    crop: str = Form(""),
    key: str = Form(""),
    char_line: str = Form(""),
    mm_per_px: float = Form(0.0),
    note: str = Form(""),
):
    """人が直した**列まるごと**を貯める。**同じ key なら上書き**（feedback と同じ）。

    raw_image … その列の切り抜き（拓本のまま。まわりを少しつけたもの）
    ink_image … AI が読んだ墨（あれば。答え合わせと、枠の学習の入力に使う）
    boxes     … その切り抜きの画素での [{x,y,w,h,ch,g}, ...]。**人が直したあとの枠**
    char_line … 列の読み（上から順に つなげた字）

    ここでも**学習は回さない**。貯めるだけ。
    """
    os.makedirs(LINES, exist_ok=True)
    name = key.strip() or datetime.now().strftime("line_%Y%m%d-%H%M%S")
    name = "".join(c for c in name if c.isalnum() or c in "-_." or ord(c) > 127)
    d = os.path.join(LINES, name)
    replaced = os.path.isdir(d)
    os.makedirs(d, exist_ok=True)
    open(os.path.join(d, "raw.png"), "wb").write(await raw_image.read())
    if ink_image is not None:
        open(os.path.join(d, "ink.png"), "wb").write(await ink_image.read())
    bx = _line_boxes(boxes)
    # ───── **画面で入れた読みは、枠を登録し直しても消さない**（2026-09-22）─────
    # 拓本AI の画面（［覚えたもの］→ ✎ 読み）で入れた `ch` は、アプリ側には無い。
    # 同じ名前で枠を送り直すと、そのまま上書きされて **読みだけが消えて**いた。
    # 送られてきた枠に読みが無いときだけ、**同じ場所にある前の枠**の読みを引き継ぐ。
    if replaced:
        prev = (_read_json(os.path.join(d, "meta.json"), {}) or {}).get("boxes") or []
        for b in bx:
            if b.get("ch"):
                continue
            cy, lim = b["y"] + b["h"] / 2, max(4.0, b["h"] * 0.5)
            for o in prev:
                if not o.get("ch"):
                    continue
                try:
                    oc = float(o["y"]) + float(o["h"]) / 2
                except (KeyError, TypeError, ValueError):
                    continue
                if abs(oc - cy) <= lim:
                    b["ch"] = o["ch"]
                    break
    meta = {
        "key": name,
        "at": datetime.now().isoformat(timespec="seconds"),
        "n": len(bx),
        "boxes": bx,
        # 読みは **枠から組み立てる**（2026-09-22）。上の引き継ぎで枠に読みが
        # 戻ることがあるので、送られてきた char_line のままだと食いちがう。
        "chars": ("".join((b.get("ch") or "□") for b in bx) if bx else char_line)[:120],
        "mmPerPx": round(float(mm_per_px or 0), 6),
        "note": note[:200],
    }
    # **切り抜きの位置**（拓本の画素での x,y,w,h と縮めた率）。
    # 彫刻原稿アプリが「登録した枠」と「いまの枠」を突き合わせるのに使う。
    try:
        c = json.loads(crop or "{}")
        if isinstance(c, dict) and all(k in c for k in ("x", "y", "w", "h")):
            meta["crop"] = {k: round(float(c.get(k, 0)), 3)
                            for k in ("x", "y", "w", "h", "sc") if k in c}
    except ValueError:
        pass
    with open(os.path.join(d, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    return {"status": "saved", "saved_id": name, "replaced": replaced,
            "n": len(bx), "lines": len(_line_ids())}


def _line_ids():
    try:
        return sorted(x for x in os.listdir(LINES)
                      if os.path.isdir(os.path.join(LINES, x)))
    except OSError:
        return []


@app.get("/api/takuhon/lines")
def lines(limit: int = 60, offset: int = 0, boxes: int = 0,
          only: str = "", order: str = ""):
    """貯まった列の一覧。中身は meta.json だけ読む（画像は開かない）。

    boxes=1 … 1 列ごとの**枠**（と切り抜きの位置）も返す。
              画面（拓本AI の「覚えたもの」）が、絵の上に枠を重ねて出すのに使う。
    only    … "on"（学習に使う）／"off"（外してある）だけに絞る。既定は ぜんぶ。
    order   … "new" で**新しい順**。既定は これまでどおり 名前順。
    """
    ids = _line_ids()
    on_ids = [p for p in ids if not os.path.exists(os.path.join(LINES, p, "off"))]
    off_ids = [p for p in ids if os.path.exists(os.path.join(LINES, p, "off"))]
    sel = on_ids if only == "on" else off_ids if only == "off" else ids
    if order == "new":
        def _mt(p):
            try:
                return os.path.getmtime(os.path.join(LINES, p, "meta.json"))
            except OSError:
                return 0.0
        sel = sorted(sel, key=_mt, reverse=True)
    out = []
    for pid in sel[offset:offset + max(1, min(limit, 300))]:
        m = _read_json(os.path.join(LINES, pid, "meta.json"), {}) or {}
        it = {"id": pid, "n": m.get("n", 0), "at": m.get("at", ""),
              "chars": m.get("chars", ""),
              "off": os.path.exists(os.path.join(LINES, pid, "off")),
              "ink": os.path.exists(os.path.join(LINES, pid, "ink.png"))}
        if boxes:
            it["boxes"] = m.get("boxes", [])
            if m.get("crop"):
                it["crop"] = m["crop"]
            it["mmPerPx"] = m.get("mmPerPx", 0)
            it["note"] = m.get("note", "")
        out.append(it)
    # **学習に使う数は ぜんぶを数える**（2026-09-22 の実測で判明。
    # 1 ページぶん（out）だけ数えていたので、limit=1 で見ると「1 列」と出ていた）。
    return {"all": len(ids), "on": len(on_ids), "off": len(off_ids),
            "shown": len(sel), "offset": offset, "items": out}


@app.get("/api/takuhon/line/{pid}")
def line_one(pid: str):
    """その列の meta.json（枠と読み）。彫刻原稿アプリの［登録したものを見る］が読む。"""
    d = _line_dir(pid)
    if d is None:
        return JSONResponse({"error": "not_found"}, status_code=404)
    m = _read_json(os.path.join(d, "meta.json"), None)
    if m is None:
        return JSONResponse({"error": "no_meta"}, status_code=404)
    m["ink"] = os.path.exists(os.path.join(d, "ink.png"))
    return m


@app.post("/api/takuhon/line/{pid}/chars")
def line_chars(pid: str, chars: str = Form("")):
    """その列の**読み**を、あとから入れる（2026-09-22。本人の指示
    「枠用で学習登録した物に、あとから文字の判別登録を行うことはできますか」
    →「拓本AI の画面で、登録できるようにお願いします」）。

    枠（`boxes`）はさわらない。**`ch` だけ**を入れかえる。
    だから枠の学習（train_box.py）に出した材料は そのまま使え、
    読みの入った枠は 読みの学習（train_char.py）にも入るようになる。

    chars … 枠と同じ数だけ並べた字。JSON の配列でも、字を並べただけでもよい。
            空ける所は「□」か 空白（その枠の読みは消える）。
    """
    d = _line_dir(pid)
    if d is None:
        return JSONResponse({"error": "not_found"}, status_code=404)
    f = os.path.join(d, "meta.json")
    m = _read_json(f, None)
    if m is None:
        return JSONResponse({"error": "no_meta"}, status_code=404)
    arr = None
    t = (chars or "").strip()
    if t.startswith("["):
        try:
            v = json.loads(t)
            if isinstance(v, list):
                arr = [str(x or "") for x in v]
        except ValueError:
            arr = None
    if arr is None:
        arr = list(chars or "")
    bx = m.get("boxes") or []
    n = 0
    for i, b in enumerate(bx):
        c = (arr[i] if i < len(arr) else "").strip()
        if c in ("", "□", "　"):
            b.pop("ch", None)
        else:
            b["ch"] = c[0]
            n += 1
    m["boxes"] = bx
    m["chars"] = "".join((b.get("ch") or "□") for b in bx)
    m["charsAt"] = datetime.now().isoformat(timespec="seconds")
    with open(f, "w", encoding="utf-8") as fp:
        json.dump(m, fp, ensure_ascii=False, indent=1)
    return {"status": "ok", "id": pid, "n": len(bx), "read": n, "chars": m["chars"]}


@app.post("/api/takuhon/line/{pid}/boxes")
def line_setboxes(pid: str, boxes: str = Form("")):
    """その列の**枠**を入れかえる（2026-09-22。本人の問い
    「文字を登録していて、枠の間違いを発見したのですが修正できますか」）。

    絵（raw.png・ink.png）はそのまま。`boxes` だけを入れかえる。
    読み（`ch`）は枠にぶら下がっているので、**送る側が一緒に持ってくる**こと。
    """
    d = _line_dir(pid)
    if d is None:
        return JSONResponse({"error": "not_found"}, status_code=404)
    f = os.path.join(d, "meta.json")
    m = _read_json(f, None)
    if m is None:
        return JSONResponse({"error": "no_meta"}, status_code=404)
    bx = _line_boxes(boxes)
    if not bx:
        return JSONResponse({"error": "no_boxes",
                             "detail": "枠が 1 つもありません（列ごと消すなら DELETE を）"},
                            status_code=400)
    bx.sort(key=lambda b: b["y"] + b["h"] / 2)        # かならず上から順に
    m["boxes"] = bx
    m["n"] = len(bx)
    m["chars"] = "".join((b.get("ch") or "□") for b in bx)[:120]
    m["boxesAt"] = datetime.now().isoformat(timespec="seconds")
    with open(f, "w", encoding="utf-8") as fp:
        json.dump(m, fp, ensure_ascii=False, indent=1)
    return {"status": "ok", "id": pid, "n": len(bx),
            "read": sum(1 for b in bx if b.get("ch")), "chars": m["chars"]}


@app.post("/api/takuhon/line/{pid}/off")
def line_off(pid: str, off: bool = Form(True)):
    """その列を **学習に使わない**（または使う）。消さずに外せる（2026-09-21）。

    印は `off` という**空ファイル**。`boxdata.list_lines` はこれがある列を飛ばす。
    間違って登録した字枠を、消さずに学習から外せるようにしてある
    （あとで見返して「やはり使う」に戻せる）。
    """
    d = _line_dir(pid)
    if d is None:
        return JSONResponse({"error": "not_found"}, status_code=404)
    f = os.path.join(d, "off")
    if off:
        open(f, "w").close()
    elif os.path.exists(f):
        os.remove(f)
    return {"status": "ok", "id": pid, "off": bool(off)}


@app.delete("/api/takuhon/line/{pid}")
def line_del(pid: str):
    """その列を消す。**戻せない**ので、ふだんは /off の方を使うこと。"""
    d = _line_dir(pid)
    if d is None:
        return JSONResponse({"error": "not_found"}, status_code=404)
    shutil.rmtree(d, ignore_errors=True)
    return {"status": "deleted", "id": pid, "lines": len(_line_ids())}


@app.get("/api/takuhon/lineimg/{pid}/{kind}.png")
def lineimg(pid: str, kind: str):
    d = _line_dir(pid)
    if d is None or kind not in ("raw", "ink"):
        return JSONResponse({"error": "bad_request"}, status_code=400)
    f = os.path.join(d, kind + ".png")
    if not os.path.exists(f):
        return JSONResponse({"error": "not_found"}, status_code=404)
    return FileResponse(f, media_type="image/png")


# ----- 見るための口（モニタリング）。読むだけで、学習には触らない ------------

def _read_json(path, dflt=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return dflt


def _read_jsonl(path, limit=None):
    out = []
    try:
        with open(path, encoding="utf-8") as f:
            for ln in f:
                ln = ln.strip()
                if not ln:
                    continue
                try:
                    out.append(json.loads(ln))
                except ValueError:
                    pass
    except OSError:
        return []
    return out[-limit:] if limit else out


def _gpu():
    """GPU の使われ具合。nvidia-smi が無くても黙って None を返す。"""
    try:
        q = "utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw"
        r = subprocess.run(["nvidia-smi", "--query-gpu=" + q,
                            "--format=csv,noheader,nounits"],
                           capture_output=True, text=True, timeout=3)
        v = [x.strip() for x in r.stdout.strip().split("\n")[0].split(",")]
        return {"util": float(v[0]), "usedMB": float(v[1]), "totalMB": float(v[2]),
                "tempC": float(v[3]), "watt": float(v[4])}
    except Exception:
        return None


def _set_dir(which):
    return {"pairs": DATASET, "val": VALDIR,
            "shape": SHAPE, "shape_val": SHAPE_VAL,
            "shape_rub": SHAPE_RUB, "shape_rub_val": SHAPE_RUB_VAL}.get(which)


@app.get("/api/takuhon/progress")
def progress(which: str = "ink"):
    """学習の途中経過。**画面のログは夜に流れて消える**ので、ここから読む。"""
    p = _read_json(_progress_path(which), {"state": "none"})
    # 「学習中」のまま止まっていることがある（強制終了・パソコンの再起動）。
    # pid が居なければ、そう見せる。ずっと「学習中」と出ていると、待ってしまう。
    r = _running()
    if r and r.get("which") and r.get("which") != which:
        r = None                       # いま走っているのは、もう片方
    if r and r.get("state") == "starting" and p.get("state") != "running":
        # 始めたばかり。torch の読み込みで十数秒かかるので、そう見せる
        p = {"state": "starting", "pid": r["pid"], "why": "支度をしています（十数秒かかります）"}
    elif p.get("state") == "running" and not r:
        p["state"] = "failed"
        p["why"] = p.get("why") or "途中で終わっています（止められたか、落ちました）"
    p["gpu"] = _gpu()
    # **途中の保存があるか。** 停電で落ちたあと、続きから回せるかどうかを画面に出す。
    lp = os.path.join(RUNS, "last_%s.pth" % _nm(which))
    if os.path.exists(lp):
        # 中身は軽い覚え書きから読む（.pth は大きいので、5 秒ごとに開かない）
        j = _read_json(lp[:-4] + ".json", {}) or {}
        p["resume"] = {"epoch": j.get("epoch"), "epochs": j.get("epochs"),
                       "base": j.get("base"), "bs": j.get("bs"),
                       "test": bool(j.get("test")), "at": j.get("at")}
    return p


@app.get("/api/takuhon/curve")
def curve(which: str = "ink"):
    return {"points": _read_jsonl(_curve_path(which))}


@app.get("/api/takuhon/curves")
def curves(which: str = "ink", limit: int = 12):
    """**世代ごとの「うつり変わり」**（2026-09-17。本人の指示
    「このグラフを、各検証結果毎で出せませんか？」）。

    `curve_<名前>.jsonl` は走るたびに上書きされるので、train.py が世代を残すとき
    `curve_<名前>_<日時>.jsonl` に控えを取っている。ここではその控えをぜんぶ返す。
    いちばん新しい回（いま走っている分）は file="" で先頭に入れる。
    """
    nm = _nm(which)
    live = _read_jsonl(_curve_path(which))
    out = []
    pre = "curve_%s_" % nm
    for f in sorted(os.listdir(RUNS) if os.path.isdir(RUNS) else []):
        if not (f.startswith(pre) and f.endswith(".jsonl")):
            continue
        stem = f[len("curve_"):-len(".jsonl")]          # <名前>_<日時>
        out.append({"file": "model_%s.pth" % stem,
                    "at": int(os.path.getmtime(os.path.join(RUNS, f))),
                    "points": _read_jsonl(os.path.join(RUNS, f))})
    out.sort(key=lambda x: x["at"])
    out = out[-max(1, int(limit)):]
    if live:
        out.append({"file": "", "at": 0, "live": True, "points": live})
    return {"items": out}


@app.get("/api/takuhon/history")
def history(which: str = "ink"):
    nm = _nm(which)
    got = _read_jsonl(os.path.join(RUNS, "history.jsonl"))
    # 名前が入っていない古い記録は、①のものとして扱う
    got = [x for x in got if (x.get("name") or "current") == nm]
    return {"items": got[-60:]}


def _cur_mark(nm):
    """いま使っている版が、どの世代から来たか（2026-09-16）。

    **日付では見分けられない。** 差し替えは `copyfile` なので日付が新しくなり、
    （日付を元のまま写すと、こんどはサーバーが読み直さなくなる。`_reload_if_new`）。
    そこで、差し替えるたびに名前を控えておく。
    """
    return os.path.join(RUNS, "current_from_%s.json" % nm)


@app.get("/api/takuhon/models")
def models(which: str = "ink"):
    """残っている世代の一覧（2026-09-16。本人の指示「手動で切り替えられるように」）。

    いま使っている版（current）と同じ中身かどうかも返す。
    """
    nm = _nm(which)
    cur = os.path.join(RUNS, "current.pth" if nm == "current" else "current_shape.pth")
    csz = os.path.getsize(cur) if os.path.exists(cur) else -1
    cmt = int(os.path.getmtime(cur)) if os.path.exists(cur) else 0
    from_f = (_read_json(_cur_mark(nm), {}) or {}).get("file", "")
    out = []
    for f in sorted(os.listdir(RUNS) if os.path.isdir(RUNS) else []):
        if not f.startswith("model_") or not f.endswith(".pth"):
            continue
        # ①は model_current_… ／②は model_shape_… の名前で残る
        if not f.startswith("model_%s_" % nm):
            continue
        p2 = os.path.join(RUNS, f)
        out.append({"file": f, "size": os.path.getsize(p2),
                    "at": int(os.path.getmtime(p2)),
                    "now": (f == from_f) if from_f else
                           (os.path.getsize(p2) == csz and abs(int(os.path.getmtime(p2)) - cmt) < 2)})
    out.sort(key=lambda x: -x["at"])
    return {"items": out, "which": which, "current": os.path.basename(cur),
            "currentAt": cmt}


@app.post("/api/takuhon/use_model")
def use_model(which: str = Form("ink"), file: str = Form(...)):
    """世代を、いま使う版にする（手で差し替える）。

    成績で自動に差し替えるのとは別に、**人が選んで戻せる**ようにしておく。
    検証用を増やすと物差しが変わり、前の世代と数字で比べられなくなるため
    （本人の指摘）、そのときは目で見て選ぶしかない。
    """
    nm = _nm(which)
    if not SAFE.match(file) or not file.startswith("model_%s_" % nm) or not file.endswith(".pth"):
        return JSONResponse({"error": "bad_file"}, status_code=400)
    src = os.path.realpath(os.path.join(RUNS, file))
    if not src.startswith(os.path.realpath(RUNS) + os.sep) or not os.path.exists(src):
        return JSONResponse({"error": "not_found"}, status_code=404)
    dst = os.path.join(RUNS, "current.pth" if nm == "current" else "current_shape.pth")
    try:
        # 日付は**新しくして**写す（`_reload_if_new` が日付を見ているため）。
        # どの世代から来たかは、下の控えで分かるようにする。
        shutil.copyfile(src, dst)
        with open(_cur_mark(nm), "w", encoding="utf-8") as f:
            json.dump({"file": file, "at": datetime.now().strftime("%Y-%m-%d %H:%M"),
                       "by": "hand"}, f, ensure_ascii=False)
    except OSError as e:
        return JSONResponse({"error": str(e)}, status_code=500)
    # 次の呼び出しで読み直される（_reload_if_new が日時を見ている）
    return {"ok": True, "file": file, "which": which}


@app.get("/api/takuhon/pairs")
def pairs(which: str = "pairs", limit: int = 60, offset: int = 0, only: str = "all"):
    """貯まった組の一覧。新しいものが先。

    only="all"（既定）… ぜんぶ ／ "on" … 使う分だけ ／ "off" … 使わない分だけ
    """
    root = _set_dir(which)
    if root is None:
        return JSONResponse({"error": "bad_set"}, status_code=400)
    # **「使わない」にした組も出す**（画面で戻せるように）。学習には入らない。
    ds = D.list_pairs(root, keep_off=True)
    ds.sort(key=lambda d: os.path.getmtime(d), reverse=True)
    if only in ("on", "off"):
        ds = [d for d in ds if D.is_off(d) == (only == "off")]
    total = len(ds)
    nOff = sum(1 for d in D.list_pairs(root, keep_off=True) if D.is_off(d))
    out = []
    for d in ds[offset:offset + limit]:
        meta = _read_json(os.path.join(d, "meta.json"), {}) or {}
        out.append({
            "id": os.path.basename(d), "set": which,
            "off": D.is_off(d),
            # どこから作った墨か（彫刻原稿 v21.59 から入る）。
            # "trace" … ［AI お任せ］が拾ったものを人が直した
            # "hand"／無し … しきい値で拾ったものを人が直した
            "inkFrom": meta.get("inkFrom", ""),
            "char": meta.get("char", ""), "at": meta.get("at", ""),
            # 採点する範囲（0〜1。［✂ 範囲］）と その字の枠（512 の切り抜きの画素。あれば）
            "crop": meta.get("crop"), "box": meta.get("box"),
            # **絵の版**。作り直すと同じ名前で中身だけ変わるので、
            # これを絵の住所に付けないと、**ブラウザが古い絵を出し続ける**
            # （実測：作り直したのに、拓本と正解だけ前の字のままだった）。
            "mt": int(os.path.getmtime(d)),
            "hint1": os.path.exists(os.path.join(d, "hint1.png")),
            "hint2": os.path.exists(os.path.join(d, "hint2.png")) or
                     os.path.exists(os.path.join(d, "hint.png")),
        })
    chars = {}
    for d in ds:
        c = (_read_json(os.path.join(d, "meta.json"), {}) or {}).get("char", "")
        if c:
            chars[c] = chars.get(c, 0) + 1
    return {"total": total, "items": out, "only": only,
            "misplaced": len(_misplaced(root)),
            "on": len(D.list_pairs(root)), "off": nOff,
            "chars": sorted(chars.items(), key=lambda kv: -kv[1])[:40]}


# ───── **入れ先をまちがえた組**（2026-09-23。本人の報告
# 「読みのデータに、整える用のデータが多数あります。保管場所ミスですかね」）─────
# 名前が shape_ で始まる組（shape_rub_… と shape_pair_…）は、アプリが ②「整える」（拓本から）として送ったもの。
# サーバーが "shape_rub" を知らなかった頃は ①（dataset/pairs）へ入ってしまっていた。
_MOVE_TO = {DATASET: SHAPE_RUB, VALDIR: SHAPE_RUB_VAL}


def _misplaced(root):
    if root not in _MOVE_TO:
        return []
    return [d for d in D.list_pairs(root, keep_off=True)
            if os.path.basename(d).startswith("shape_")]


@app.post("/api/takuhon/fix_misplaced")
def fix_misplaced():
    """① に混ざった ② の組を、② の入れ物へ移す。**消さない。** 行き先に同じ名前があれば
    名前に _moved を付けて並べる（どちらが正しいか 人が見て決められるように）。"""
    moved, bad = [], []
    for src, dst in _MOVE_TO.items():
        for d in _misplaced(src):
            nm = os.path.basename(d)
            to = os.path.join(dst, nm)
            k = 1
            while os.path.exists(to):
                to = os.path.join(dst, "%s_moved%d" % (nm, k))
                k += 1
            try:
                os.makedirs(dst, exist_ok=True)
                shutil.move(d, to)
                moved.append(os.path.basename(to))
            except OSError as e:
                bad.append("%s（%s）" % (nm, e))
    return {"moved": len(moved), "names": moved[:50], "bad": bad,
            "pairs": len(D.list_pairs(DATASET)), "shape_rub": len(D.list_pairs(SHAPE_RUB))}


@app.post("/api/takuhon/pair_crop")
def pair_crop(which: str = Form("pairs"), id: str = Form(...), crop: str = Form("")):
    """組の **採点する範囲** を決める／消す（2026-09-24。本人の案
    「学習データに編集機能を追加して、トリミングしましょうか。そうすれば枠の有無も気にしなくていい」）。

    crop = "x1,y1,x2,y2"（絵の幅・高さに対する 0〜1）。空なら消す（ぜんぶ採点に戻る）。
    **絵（raw.png・mask.png）は さわらない**。meta.json の crop に書くだけで、
    学習（train.py）が 範囲の外を採点しない。"""
    root = _set_dir(which)
    if root is None:
        return JSONResponse({"error": "bad_set"}, status_code=400)
    d = _pair_dir(root, id)
    if d is None:
        return JSONResponse({"error": "not_found"}, status_code=404)
    mp = os.path.join(d, "meta.json")
    meta = _read_json(mp, {}) or {}
    if crop.strip():
        try:
            v = [float(t) for t in crop.split(",")]
        except ValueError:
            return JSONResponse({"error": "bad_crop"}, status_code=400)
        if len(v) != 4:
            return JSONResponse({"error": "bad_crop"}, status_code=400)
        v = [max(0.0, min(1.0, t)) for t in v]
        x1, x2 = sorted((v[0], v[2]))
        y1, y2 = sorted((v[1], v[3]))
        if x2 - x1 < 0.02 or y2 - y1 < 0.02:
            return JSONResponse({"error": "too_small"}, status_code=400)
        meta["crop"] = [round(x1, 4), round(y1, 4), round(x2, 4), round(y2, 4)]
    else:
        meta.pop("crop", None)
    with open(mp, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    return {"id": id, "crop": meta.get("crop")}


@app.post("/api/takuhon/pair_off")
def pair_off(which: str = Form("pairs"), ids: str = Form(""), off: bool = Form(True)):
    """組を「使わない」にする／戻す（v2026-09-16。本人の指示）。

    **消さない。** 組の中に `off` という空ファイルを置くだけ。
    `D.list_pairs` がそれを外して返すので、学習も数え上げも、
    ほかを何も直さずに その組を外せる。戻したいときは ファイルを消す。
    ids は組の名前を「,」で並べたもの。`*` なら その入れ物ぜんぶ。
    """
    root = _set_dir(which)
    if root is None:
        return JSONResponse({"error": "bad_set"}, status_code=400)
    if ids.strip() == "*":
        want = [os.path.basename(d) for d in D.list_pairs(root, keep_off=True)]
    else:
        want = [x.strip() for x in ids.split(",") if x.strip()]
    done, bad = 0, []
    for pid in want[:5000]:
        d = _pair_dir(root, pid)
        if d is None:
            bad.append(pid)
            continue
        f = os.path.join(d, D.OFF)
        try:
            if off:
                if not os.path.exists(f):
                    open(f, "w").close()
            elif os.path.exists(f):
                os.remove(f)
            done += 1
        except OSError as e:
            bad.append("%s（%s）" % (pid, e))
    return {"changed": done, "bad": bad, "off": bool(off), "which": which,
            "on": len(D.list_pairs(root)),
            "all": len(D.list_pairs(root, keep_off=True))}


@app.get("/api/takuhon/img/{which}/{pid}/{kind}.png")
def img(which: str, pid: str, kind: str):
    """組の画像を 1 枚返す。kind は raw / mask / hint1 / hint2 / ai。

    ai は **いまのモデルにその組を通した結果**。正解と見くらべるためのもの。
    """
    root = _set_dir(which)
    d = _pair_dir(root, pid)
    if d is None or kind not in ("raw", "mask", "hint1", "hint2", "ai"):
        return JSONResponse({"error": "bad_request"}, status_code=400)
    if kind != "ai":
        f = os.path.join(d, kind + ".png")
        if kind == "hint2" and not os.path.exists(f):
            f = os.path.join(d, "hint.png")          # 古い書き出し
        if not os.path.exists(f):
            return JSONResponse({"error": "not_found"}, status_code=404)
        return FileResponse(f, media_type="image/png")
    # **②の組は、②のモデルに通す。** ①のモデルで出していたので、
    # ②の答え合わせ（拓本／正解／AI の 3 枚くらべ）が意味を成していなかった。
    sh = which in ("shape", "shape_val")
    _reload2_if_new() if sh else _reload_if_new()
    net, info = (NET2, INFO2) if sh else (NET, INFO)
    if not info["loaded"]:
        return JSONResponse({"error": "no_model_shape" if sh else "no_model"}, status_code=503)
    it = D.load_pair(d)
    if not it:
        return JSONResponse({"error": "not_found"}, status_code=404)
    # ②は手がかりを見ない（学習のときと同じ渡し方にする）
    x = D.to_input(it["raw"], None, None) if sh else D.to_input(it["raw"], it["hint1"], it["hint2"])
    with torch.no_grad():
        y = torch.sigmoid(net(torch.from_numpy(x[None]).to(DEVICE)))[0, 0].cpu().numpy()
    return Response(content=D.png_bytes((y > 0.5).astype(np.float32)),
                    media_type="image/png")


@app.get("/")
def dash():
    f = os.path.join(ROOT, "dash.html")
    if not os.path.exists(f):
        return JSONResponse({"error": "no_dash"}, status_code=404)
    # **画面は覚えさせない**（2026-09-22。本人の報告「まだ残っているようです」＝
    # ブラウザが古い dash.html を使い続けていた）。毎回 読み直させる。
    return FileResponse(f, media_type="text/html; charset=utf-8", headers={
        "Cache-Control": "no-store, must-revalidate",
        "Pragma": "no-cache",
    })


# ----- 画面から動かすための口（v2）。--------------------------------------
#   ターミナルを開かずに、ZIP の取り込みと学習ができるようにする。
#   **受け取るのは数と真偽だけ**。文字列をそのままコマンドに渡すことはしない。

def _alive(pid):
    try:
        os.kill(int(pid), 0)
        return True
    except Exception:
        return False


def _running():
    """いま学習が走っているか。

    **progress.json だけでは足りない**。train.py は torch の読み込みに
    十数秒かかり、その間 progress.json はまだ無い。そこを見ていなかったので、
    続けて押すと 2 つ走ってしまった（実測）。**始めた時点で pid を置く**。
    """
    pid, which = 0, "ink"
    try:
        t = open(TRAINPID, encoding="utf-8").read().split()
        pid = int(t[0])
        if len(t) > 1:
            which = t[1]
    except (OSError, ValueError, IndexError):
        pid = 0
    if pid and _alive(pid):
        p = _read_json(_progress_path(which), {}) or {}
        if p.get("pid") != pid:
            p = {"state": "starting", "pid": pid}
        p["which"] = which
        return p
    for w in ("ink", "shape", "box", "char"):
        p = _read_json(_progress_path(w), {}) or {}
        if p.get("state") == "running" and p.get("pid") and _alive(p["pid"]):
            p["which"] = w
            return p
    return None


@app.post("/api/takuhon/import")
async def import_zip(files: list[UploadFile] = File(...), which: str = Form("pairs")):
    """彫刻原稿アプリが出した ZIP を受け取って、そのまま dataset へ入れる。

    中身の取り出し方は import_pairs.py と同じ。**ZIP の中の名前は信じない**
    （`../` などで外へ書き出されないよう、末尾の名前だけを使う）。
    """
    root = _set_dir(which)
    if root is None:
        return JSONResponse({"error": "bad_set"}, status_code=400)
    import io as _io
    made, bad = set(), []
    for up in files:
        raw = await up.read()
        stem = _keep_name(os.path.splitext(os.path.basename(up.filename or "zip"))[0])
        try:
            with zipfile.ZipFile(_io.BytesIO(raw)) as z:
                names = [n for n in z.namelist() if not n.endswith("/")]
                flat = [n for n in names if n.startswith("pairs/")]
                if flat:                               # まとめ書き出し
                    for n in flat:
                        b = os.path.basename(n)
                        parts = b.split("_")
                        if len(parts) < 3:
                            continue
                        pid = parts[0] + "_" + parts[1]
                        part = b.split("_", 2)[-1]
                        if part not in ("raw.png", "mask.png", "hint1.png", "hint2.png",
                                        "hint.png", "meta.json"):
                            continue
                        d = os.path.join(root, re.sub(r"[^A-Za-z0-9._-]", "_", pid))
                        os.makedirs(d, exist_ok=True)
                        open(os.path.join(d, part), "wb").write(z.read(n))
                        made.add(pid)
                else:                                  # 1 文字＝1 つ
                    # **名前は meta.json の key を先に見る**（2026-09-14）。
                    # 共有フォルダーに置く ZIP は `pair_<家名>_g0-3_<字>.zip` で、
                    # 日本語が入っている。前はそれを `_` に潰していたので、
                    # 家名の字数と 行・番号が同じなら**別の案件どうしがぶつかって
                    # 上書きし合っていた**（例：久ヶ山の石 と 田中山の大 が同じ名前）。
                    for n in names:
                        if os.path.basename(n) != "meta.json":
                            continue
                        try:
                            k = (json.loads(z.read(n).decode("utf-8")) or {}).get("key", "")
                            if k:
                                stem = _keep_name(k)
                        except Exception:
                            pass
                        break
                    for n in names:
                        b = os.path.basename(n)
                        if b in ("raw.png", "mask.png", "hint1.png", "hint2.png",
                                 "hint.png", "meta.json"):
                            d = os.path.join(root, stem)
                            os.makedirs(d, exist_ok=True)
                            open(os.path.join(d, b), "wb").write(z.read(n))
                            made.add(stem)
        except Exception as e:
            bad.append({"name": up.filename, "why": f"{type(e).__name__}: {e}"})
    # **入れた先の数を返す。** ①の数を返していたので、②へ入れても
    # 「学習 0 組」と出て、入ったのかどうか分からなかった。
    a, b = ((SHAPE, SHAPE_VAL) if which in ("shape", "shape_val") else
            (SHAPE_RUB, SHAPE_RUB_VAL) if which in ("shape_rub", "shape_rub_val") else
            (DATASET, VALDIR))
    return {"added": len(made), "bad": bad, "which": which,
            "pairs": len(D.list_pairs(a)), "val": len(D.list_pairs(b))}


@app.post("/api/takuhon/move_val")
def move_val(n: int = Form(...), which: str = Form("ink")):
    """学習用から検証用へ、○ 組を移す（学習には使わない分を取り分ける）。

    which="ink"       … dataset/pairs → dataset/val
    which="shape"     … dataset/shape → dataset/shape_val（合成）
    which="shape_rub" … dataset/shape_rub → dataset/shape_rub_val（拓本から）
    **画面で見ている側のものを動かす。** 混ざると、どちらの検証か分からなくなる。
    """
    n = max(0, min(500, int(n)))
    src, dst = {"shape": (SHAPE, SHAPE_VAL),
                "shape_rub": (SHAPE_RUB, SHAPE_RUB_VAL)}.get(which, (DATASET, VALDIR))
    have = [d for d in D.list_pairs(src)]
    os.makedirs(dst, exist_ok=True)
    moved = 0
    for d in have:
        if moved >= n:
            break
        try:
            shutil.move(d, os.path.join(dst, os.path.basename(d)))
            moved += 1
        except OSError:
            pass
    return {"moved": moved, "which": which,
            "pairs": len(D.list_pairs(src)), "val": len(D.list_pairs(dst))}


@app.post("/api/takuhon/train")
def train_start(epochs: int = Form(60), bs: int = Form(4), base: int = Form(32),
                test: bool = Form(False), which: str = Form("ink"), size: int = Form(0),
                mix: str = Form("both"), val: str = Form("auto"),
                noswap: bool = Form(False)):
    """学習を始める。**同時に 2 つは走らせない**（モデルが取り合いになる）。

    which="ink"   … ①墨出し（dataset/pairs → current.pth）
    which="shape" … ②書体らしく整える（→ current_shape.pth）

    ②の材料は 2 種類ある（2026-09-16。本人の指摘「整える方は今までと材料が
    違うので分けた方がいい。混ぜたもの／今までの物／拓本から取り出したもの、
    どれが一番成績がいいか分からない」）。

    mix="syn"  … 合成だけ（今までの物。dataset/shape）
    mix="rub"  … 拓本から取り出したものだけ（dataset/shape_rub）
    mix="both" … 混ぜる（既定）

    **比べるときは、物差し（検証用）を同じにすること。** 材料と一緒に検証用まで
    変えると、数字が比べられなくなる（本人の指摘「検証用が少ないときと比べて
    いるので、比較できない」）。

    val="auto"（既定）… 拓本由来の検証があればそれ、無ければ合成
    val="syn" ／ "rub" ／ "both" … 明に選ぶ

    noswap=true … 成績が良くても差し替えない（比べるためだけの回）。
    使う版は、あとから［これを使う］で人が選ぶ。
    """
    if _running():
        return JSONResponse({"error": "already_running"}, status_code=409)
    epochs = max(1, min(2000, int(epochs)))
    bs = max(1, min(32, int(bs)))
    base = max(4, min(64, int(base)))
    if which in ("box", "char"):
        """③ 枠・④ 読み（2026-09-22）。材料はどちらも dataset/lines。
           ①②とは別のプログラム（train_box.py / train_char.py）を回す。
           「試すだけ」は、材料の下限を下げて とにかく通してみるための逃げ道。"""
        prog = "train_box.py" if which == "box" else "train_char.py"
        cmd = [sys.executable, os.path.join(ROOT, prog),
               "--epochs", str(epochs), "--base", str(base)]
        if which == "box":
            cmd += ["--bs", str(bs)]
            if test:
                cmd += ["--min", "2", "--val", "0.2"]
        elif test:
            cmd += ["--min-per-char", "1"]
        if noswap:
            cmd += ["--no-swap"]
        os.makedirs(RUNS, exist_ok=True)
        log = open(_log_path(which), "w", encoding="utf-8")
        pr = subprocess.Popen(cmd, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT,
                              start_new_session=True)
        try:
            with open(TRAINPID, "w", encoding="utf-8") as f:
                f.write("%d %s" % (pr.pid, which))
        except OSError:
            pass
        return {"started": True, "pid": pr.pid, "cmd": " ".join(cmd[1:]),
                "test": bool(test), "which": which}
    cmd = [sys.executable, os.path.join(ROOT, "train.py"),
           "--epochs", str(epochs), "--bs", str(bs), "--base", str(base)]
    if which == "shape":
        # ②では手がかり（フォント）を見せない。見せると「フォントを描けば正解に近い」
        # という近道を覚え、彫った職人の癖を消す動きになる。
        dat = {"syn": [SHAPE], "rub": [SHAPE_RUB]}.get(mix, [SHAPE, SHAPE_RUB])
        if val == "auto":
            vd = [SHAPE_RUB_VAL] if D.list_pairs(SHAPE_RUB_VAL) else [SHAPE_VAL]
        else:
            vd = {"syn": [SHAPE_VAL], "rub": [SHAPE_RUB_VAL]}.get(val, [SHAPE_VAL, SHAPE_RUB_VAL])
        note = "材料：" + {"syn": "合成だけ", "rub": "拓本から取り出したものだけ"}.get(mix, "合成＋拓本")
        note += "／物差し：" + ("拓本" if vd == [SHAPE_RUB_VAL] else
                                "合成" if vd == [SHAPE_VAL] else "合成＋拓本")
        cmd += ["--data", ",".join(dat), "--valdata", ",".join(vd),
                "--name", "shape", "--nohint", "--note", note]
        if noswap:
            cmd += ["--no-swap"]
    if size:
        cmd += ["--size", str(max(64, min(1024, int(size))))]
    if test:                       # 「試すだけ」。8 組未満でも回し、検証なしでも差し替える
        cmd += ["--min", "1", "--swap-anyway"]
    os.makedirs(RUNS, exist_ok=True)
    log = open(_log_path(which), "w", encoding="utf-8")
    pr = subprocess.Popen(cmd, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT,
                          start_new_session=True)
    try:
        with open(TRAINPID, "w", encoding="utf-8") as f:
            f.write("%d %s" % (pr.pid, which))       # どちらを走らせているかも残す
    except OSError:
        pass
    return {"started": True, "pid": pr.pid, "cmd": " ".join(cmd[1:]),
            "test": bool(test), "which": which}


@app.post("/api/takuhon/train/stop")
def train_stop():
    p = _running()
    if not p:
        return {"stopped": False, "why": "走っていません"}
    try:
        os.kill(int(p["pid"]), signal.SIGTERM)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
    try:
        os.remove(TRAINPID)
    except OSError:
        pass
    p2 = dict(p); p2["state"] = "stopped"; p2["why"] = "画面から止めました"
    p2.setdefault("epochs", 0); p2.setdefault("epoch", 0)
    try:
        with open(os.path.join(RUNS, "progress.json"), "w", encoding="utf-8") as f:
            json.dump(p2, f, ensure_ascii=False, indent=1)
    except OSError:
        pass
    return {"stopped": True}


@app.get("/api/takuhon/trainlog")
def trainlog(lines: int = 40, which: str = "ink"):
    """①②で**別々**の画面ログ。

    **無いときに古い train.log を出してはいけない。**
    ②「整える」を回したログが、①「墨出し（拓本）」の欄に出て、
    「拓本の学習はしていないのに 1850 組と出ている」と迷わせた（2026-09-13）。
    """
    p = _log_path(which)
    try:
        with open(p, encoding="utf-8", errors="replace") as f:
            ls = f.read().splitlines()
    except OSError:
        return {"lines": []}
    return {"lines": ls[-max(1, min(300, lines)):]}


@app.post("/api/takuhon/reset")
def reset(what: str = Form(...), confirm: str = Form(""), which: str = Form("ink")):
    """試した分を片づける。**取り消せない**ので、合言葉を求める。

    **①②のどちらを消すのかを受け取る。** モデルも置き場所も別なので、
    言われた側だけを消す（①のつもりで②が残る、の逆をなくす）。
    """
    if confirm != "けす":
        return JSONResponse({"error": "need_confirm"}, status_code=400)
    if _running():
        return JSONResponse({"error": "running"}, status_code=409)
    sh = (which == "shape")
    model = CURRENT2 if sh else CURRENT
    dirs = (SHAPE, SHAPE_VAL) if sh else (DATASET, VALDIR)
    who = "② 整える" if sh else "① 墨出し"
    done = []
    if what in ("model", "all"):
        try:
            os.remove(model); done.append(who + "のモデル")
        except OSError:
            pass
        # 途中の保存も一緒に消す。残っていると、次の学習が勝手に続きから始まる。
        for f in ("last_%s.pth" % _nm(which), "last_%s.json" % _nm(which)):
            try:
                os.remove(os.path.join(RUNS, f))
            except OSError:
                pass
    if what in ("data", "all"):
        for root in dirs:
            # **「使わない」にした組も消す**（keep_off=True）。
            # ここは片づけなので、外してある分だけ残ると かえって迷う。
            for d in D.list_pairs(root, keep_off=True):
                shutil.rmtree(d, ignore_errors=True)
        done.append(who + "の貯めたデータ")
    return {"done": done, "which": which,
            "pairs": len(D.list_pairs(dirs[0])), "val": len(D.list_pairs(dirs[1]))}


# ----- ②「整える」（書体の癖）。フォントから学習データを自動で作る -----------

def _shape_info():
    """②のモデルの様子（読み込みはしない。ファイルを見るだけ）。"""
    p = os.path.join(RUNS, "current_shape.pth")
    if not os.path.exists(p):
        return None
    try:
        ck = torch.load(p, map_location="cpu")
        return {"step": ck.get("step", 0), "at": ck.get("at"), "iou": ck.get("iou"),
                "iou_nohint": ck.get("iou_nohint"), "base": ck.get("base"),
                "size": ck.get("size"), "pairs": ck.get("pairs")}
    except Exception as e:
        return {"why": f"{type(e).__name__}: {e}"}


def _synth_running():
    try:
        pid = int(open(SYNTHPID, encoding="utf-8").read().strip())
    except (OSError, ValueError):
        return 0
    return pid if _alive(pid) else 0


@app.get("/api/takuhon/fonts")
def fonts():
    os.makedirs(FONTS, exist_ok=True)
    out = []
    for n in sorted(os.listdir(FONTS)):
        if n.lower().endswith((".ttf", ".otf", ".ttc", ".otc")):
            p = os.path.join(FONTS, n)
            it = {"name": n, "mb": round(os.path.getsize(p)/1048576, 1), "wght": None}
            # 太さを変えられる書体かどうかを見せる。変えられるなら、
            # 太さは**軸**で変える（輪郭を足して太らせない）。
            try:
                ax = MS.wght_axis(p)
                if ax:
                    it["wght"] = {"name": ax["name"], "min": ax["min"], "max": ax["max"]}
            except Exception:
                pass
            out.append(it)
    return {"items": out}


@app.post("/api/takuhon/font")
async def font_put(file: UploadFile = File(...)):
    """彫っている書体を置く。**この書体の癖を覚えさせる**ので、本物を入れること。"""
    os.makedirs(FONTS, exist_ok=True)
    nm = re.sub(r"[^A-Za-z0-9._\-]", "_", os.path.basename(file.filename or "font.ttf"))[:120]
    if not nm.lower().endswith((".ttf", ".otf", ".ttc", ".otc")):
        return JSONResponse({"error": "bad_kind"}, status_code=400)
    open(os.path.join(FONTS, nm), "wb").write(await file.read())
    return {"saved": nm, "items": fonts()["items"]}


@app.post("/api/takuhon/synth")
def synth_start(font: str = Form(...), n: int = Form(2000), val: int = Form(150),
                fresh: bool = Form(True)):
    """フォントから、②の学習データを作る。**こちらのデータは 1 組も要らない。**"""
    if _synth_running():
        return JSONResponse({"error": "already_running"}, status_code=409)
    if not SAFE.match(font):
        return JSONResponse({"error": "bad_font"}, status_code=400)
    fp = os.path.join(FONTS, font)
    if not os.path.exists(fp):
        return JSONResponse({"error": "no_font"}, status_code=404)
    n = max(10, min(20000, int(n)))
    val = max(0, min(n // 2, int(val)))
    if fresh:                                  # 作り直し。前の分は消す
        for d in (SHAPE, SHAPE_VAL):
            shutil.rmtree(d, ignore_errors=True)
    os.makedirs(RUNS, exist_ok=True)
    log = open(SYNTHLOG, "w", encoding="utf-8")
    pr = subprocess.Popen(
        [sys.executable, os.path.join(ROOT, "make_synth.py"), "--font", fp,
         "--n", str(n), "--val", str(val), "--out", SHAPE],
        cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    try:
        open(SYNTHPID, "w", encoding="utf-8").write(str(pr.pid))
    except OSError:
        pass
    return {"started": True, "pid": pr.pid, "font": font, "n": n, "val": val}


@app.post("/api/takuhon/synth/stop")
def synth_stop():
    pid = _synth_running()
    if not pid:
        return {"stopped": False, "why": "走っていません"}
    try:
        os.kill(pid, signal.SIGTERM)
        os.remove(SYNTHPID)
    except Exception:
        pass
    return {"stopped": True}


@app.get("/api/takuhon/synthstat")
def synth_stat():
    lines = []
    try:
        with open(SYNTHLOG, encoding="utf-8", errors="replace") as f:
            lines = f.read().splitlines()[-6:]
    except OSError:
        pass
    return {"running": bool(_synth_running()),
            "pairs": len(D.list_pairs(SHAPE)), "val": len(D.list_pairs(SHAPE_VAL)),
            "lines": lines}

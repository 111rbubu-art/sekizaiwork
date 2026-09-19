"""拓本クリーン化サーバー（FastAPI）。

  POST /api/takuhon/clean      切り抜きを渡すと、墨の白黒マスク（PNG）を返す
  POST /api/takuhon/feedback   人が直した正解を貯める（学習は回さない。すぐ返す）
                               set=ink なら①「読む」用、set=shape なら②「整える」用
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

import data as D
import make_synth as MS
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
FONTS = os.path.join(ROOT, "fonts")                       # 彫っている書体の置き場
TRAINLOG = os.path.join(RUNS, "train.log")
TRAINPID = os.path.join(RUNS, "train.pid")


def _nm(which):
    """画面の①②を、モデルの名前に直す。"""
    return "shape" if which == "shape" else "current"


def _retire_old():
    """①②で共用していたころの記録を、わきへどける。

    **①のものとして拾ってはいけない。** 実際に、②の学習（フォントの癖・1850 組）が
    ①「読む（拓本）」の欄に「27 / 40 回め」と出て、
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
    """①「読む」と②「整える」を**混ぜない**。名前ごとに別のファイル。"""
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
    ①「読む」の組は、彫刻原稿アプリが `pair_<家名>_g0-3_<字>` という名前で
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

    stage="ink"   … ① 読む（拓本 → 綺麗な墨）
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
        return JSONResponse({"error": "no_model", "detail": "①「読む」のモデルがありません"},
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

    set="ink"       … ①「読む」用（拓本の切り抜き → 人が直した墨）。dataset/pairs
    set="shape_rub" … ②「整える」用で、**拓本から取り出したもの**。dataset/shape_rub
    set="shape"     … ②「整える」用で、合成（フォントを荒らしたもの）。dataset/shape

    **1 つの字から 2 つの学習が取れる**（本人の案）。拓本から縁取りを直して①へ、
    その縁取りを整えて②へ。組の作りはどちらも同じ（raw.png ／ mask.png）なので、
    入れ先を分けるだけでよい。
    """
    root = {"shape": SHAPE, "shape_rub": SHAPE_RUB}.get((set_ or "").strip(), DATASET)
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
    return {"status": "saved", "saved_id": name, "replaced": replaced,
            "set": {SHAPE: "shape", SHAPE_RUB: "shape_rub"}.get(root, "ink"),
            "pairs": len(D.list_pairs(root))}


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
            "on": len(D.list_pairs(root)), "off": nOff,
            "chars": sorted(chars.items(), key=lambda kv: -kv[1])[:40]}


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
    return FileResponse(f, media_type="text/html; charset=utf-8")


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
    for w in ("ink", "shape"):
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

    which="ink"   … ①拓本を読む（dataset/pairs → current.pth）
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
    ②「整える」を回したログが、①「読む（拓本）」の欄に出て、
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
    who = "② 整える" if sh else "① 読む"
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

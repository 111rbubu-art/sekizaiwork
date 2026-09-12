"""拓本クリーン化サーバー（FastAPI）。

  POST /api/takuhon/clean      切り抜きを渡すと、墨の白黒マスク（PNG）を返す
  POST /api/takuhon/feedback   人が直した正解を貯める（学習は回さない。すぐ返す）
  GET  /api/takuhon/status     いま使っているモデルと、貯まった組数
  GET  /api/takuhon/progress   学習の途中経過（train.py が置く runs/progress.json）
  GET  /api/takuhon/curve      1 エポックごとの成績（いまの回）
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
                 ("curve.jsonl", "curve_old.jsonl")):
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
):
    """人が直した正解を貯める。**同じ key なら上書き**（彫刻原稿アプリと同じ考え方）。"""
    name = key.strip() or datetime.now().strftime("pair_%Y%m%d-%H%M%S")
    name = "".join(c for c in name if c.isalnum() or c in "-_." or ord(c) > 127)
    d = os.path.join(DATASET, name)
    os.makedirs(d, exist_ok=True)
    open(os.path.join(d, "raw.png"), "wb").write(await raw_image.read())
    open(os.path.join(d, "mask.png"), "wb").write(await corrected_image.read())
    if hint1 is not None:
        open(os.path.join(d, "hint1.png"), "wb").write(await hint1.read())
    if hint2 is not None:
        open(os.path.join(d, "hint2.png"), "wb").write(await hint2.read())
    meta = {"char": char_hint, "key": name, "at": datetime.now().isoformat(timespec="seconds")}
    with open(os.path.join(d, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    return {"status": "saved", "saved_id": name, "pairs": len(D.list_pairs(DATASET))}


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
            "shape": SHAPE, "shape_val": SHAPE_VAL}.get(which)


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
    return p


@app.get("/api/takuhon/curve")
def curve(which: str = "ink"):
    return {"points": _read_jsonl(_curve_path(which))}


@app.get("/api/takuhon/history")
def history(which: str = "ink"):
    nm = _nm(which)
    got = _read_jsonl(os.path.join(RUNS, "history.jsonl"))
    # 名前が入っていない古い記録は、①のものとして扱う
    got = [x for x in got if (x.get("name") or "current") == nm]
    return {"items": got[-60:]}


@app.get("/api/takuhon/pairs")
def pairs(which: str = "pairs", limit: int = 60, offset: int = 0):
    """貯まった組の一覧。新しいものが先。"""
    root = _set_dir(which)
    if root is None:
        return JSONResponse({"error": "bad_set"}, status_code=400)
    ds = D.list_pairs(root)
    ds.sort(key=lambda d: os.path.getmtime(d), reverse=True)
    total = len(ds)
    out = []
    for d in ds[offset:offset + limit]:
        meta = _read_json(os.path.join(d, "meta.json"), {}) or {}
        out.append({
            "id": os.path.basename(d), "set": which,
            "char": meta.get("char", ""), "at": meta.get("at", ""),
            "hint1": os.path.exists(os.path.join(d, "hint1.png")),
            "hint2": os.path.exists(os.path.join(d, "hint2.png")) or
                     os.path.exists(os.path.join(d, "hint.png")),
        })
    chars = {}
    for d in ds:
        c = (_read_json(os.path.join(d, "meta.json"), {}) or {}).get("char", "")
        if c:
            chars[c] = chars.get(c, 0) + 1
    return {"total": total, "items": out,
            "chars": sorted(chars.items(), key=lambda kv: -kv[1])[:40]}


@app.get("/api/takuhon/img/{which}/{pid}/{kind}.png")
def img(which: str, pid: str, kind: str):
    """組の画像を 1 枚返す。kind は raw / mask / hint1 / hint2 / ai。

    ai は **いまのモデルにその組を通した結果**。正解と見くらべるためのもの。
    """
    root = _set_dir(which)
    ok = root is not None and SAFE.match(pid) and kind in ("raw", "mask", "hint1", "hint2", "ai")
    if not ok:
        return JSONResponse({"error": "bad_request"}, status_code=400)
    d = os.path.join(root, pid)
    if kind != "ai":
        f = os.path.join(d, kind + ".png")
        if kind == "hint2" and not os.path.exists(f):
            f = os.path.join(d, "hint.png")          # 古い書き出し
        if not os.path.exists(f):
            return JSONResponse({"error": "not_found"}, status_code=404)
        return FileResponse(f, media_type="image/png")
    _reload_if_new()
    if not INFO["loaded"]:
        return JSONResponse({"error": "no_model"}, status_code=503)
    it = D.load_pair(d)
    if not it:
        return JSONResponse({"error": "not_found"}, status_code=404)
    x = D.to_input(it["raw"], it["hint1"], it["hint2"])
    with torch.no_grad():
        y = torch.sigmoid(NET(torch.from_numpy(x[None]).to(DEVICE)))[0, 0].cpu().numpy()
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
        stem = re.sub(r"[^A-Za-z0-9._-]", "_", os.path.splitext(os.path.basename(up.filename or "zip"))[0])[:80] or "zip"
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
    return {"added": len(made), "bad": bad,
            "pairs": len(D.list_pairs(DATASET)), "val": len(D.list_pairs(VALDIR))}


@app.post("/api/takuhon/move_val")
def move_val(n: int = Form(...), which: str = Form("ink")):
    """学習用から検証用へ、○ 組を移す（学習には使わない分を取り分ける）。

    which="ink"   … dataset/pairs → dataset/val
    which="shape" … dataset/shape → dataset/shape_val
    **画面で見ている側のものを動かす。** 混ざると、どちらの検証か分からなくなる。
    """
    n = max(0, min(500, int(n)))
    src, dst = (SHAPE, SHAPE_VAL) if which == "shape" else (DATASET, VALDIR)
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
                test: bool = Form(False), which: str = Form("ink"), size: int = Form(0)):
    """学習を始める。**同時に 2 つは走らせない**（モデルが取り合いになる）。

    which="ink"   … ①拓本を読む（dataset/pairs → current.pth）
    which="shape" … ②書体らしく整える（dataset/shape → current_shape.pth）
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
        cmd += ["--data", SHAPE, "--valdata", SHAPE_VAL, "--name", "shape", "--nohint"]
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
    p = _log_path(which)
    if not os.path.exists(p):
        p = TRAINLOG                      # 古い書き方
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
        try:
            os.remove(os.path.join(RUNS, "last_%s.pth" % _nm(which)))
        except OSError:
            pass
    if what in ("data", "all"):
        for root in dirs:
            for d in D.list_pairs(root):
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

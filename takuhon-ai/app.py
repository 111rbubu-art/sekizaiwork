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
import subprocess
import time
from datetime import datetime

import numpy as np
import torch
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from PIL import Image

import data as D
from unet import load_model

ROOT = os.path.dirname(os.path.abspath(__file__))
DATASET = os.path.join(ROOT, "dataset", "pairs")
RUNS = os.path.join(ROOT, "runs")
CURRENT = os.path.join(RUNS, "current.pth")
VALDIR = os.path.join(ROOT, "dataset", "val")
SAFE = re.compile(r"^[A-Za-z0-9._\-]{1,120}$")
os.makedirs(DATASET, exist_ok=True)
os.makedirs(RUNS, exist_ok=True)

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
NET, INFO = load_model(CURRENT, DEVICE)
LOADED_AT = time.time()

app = FastAPI(title="拓本クリーン化")
# 社内のブラウザ（彫刻原稿アプリ）から呼ぶので、同じ LAN からは通す。
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
    expose_headers=["X-Model-Step", "X-Model-At", "X-Model-Loaded"],
)


def _reload_if_new():
    """current.pth が新しくなっていたら読み直す（夜間学習のあと）。"""
    global NET, INFO, LOADED_AT
    try:
        m = os.path.getmtime(CURRENT)
    except OSError:
        return
    if m > LOADED_AT:
        NET, INFO = load_model(CURRENT, DEVICE)
        LOADED_AT = m


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
    return {
        "device": str(DEVICE),
        "cuda": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        "model": INFO,
        "pairs": n,
        "val": len(D.list_pairs(os.path.join(ROOT, "dataset", "val"))),
    }


@app.post("/api/takuhon/clean")
async def clean(
    file: UploadFile = File(...),
    hint1: UploadFile = File(None),
    hint2: UploadFile = File(None),
    thresh: float = Form(0.5),
):
    _reload_if_new()
    if not INFO["loaded"]:
        # まだ学習していない。呼ぶ側は今までのしきい値処理に戻すこと。
        return JSONResponse({"error": "no_model", "detail": "学習済みモデルがありません"}, status_code=503)
    raw = _read_gray(await file.read())
    h1 = _read_gray(await hint1.read()) if hint1 is not None else None
    h2 = _read_gray(await hint2.read()) if hint2 is not None else None
    x = D.to_input(raw, h1, h2)
    t0 = time.time()
    with torch.no_grad():
        y = torch.sigmoid(NET(torch.from_numpy(x[None]).to(DEVICE)))[0, 0].cpu().numpy()
    ms = int((time.time() - t0) * 1000)
    png = D.png_bytes((y > float(thresh)).astype(np.float32))
    return Response(content=png, media_type="image/png", headers={
        "X-Model-Step": str(INFO.get("step", 0)),
        "X-Model-At": str(INFO.get("at") or ""),
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
    return DATASET if which == "pairs" else VALDIR if which == "val" else None


@app.get("/api/takuhon/progress")
def progress():
    """学習の途中経過。**画面のログは夜に流れて消える**ので、ここから読む。"""
    p = _read_json(os.path.join(RUNS, "progress.json"), {"state": "none"})
    p["gpu"] = _gpu()
    return p


@app.get("/api/takuhon/curve")
def curve():
    return {"points": _read_jsonl(os.path.join(RUNS, "curve.jsonl"))}


@app.get("/api/takuhon/history")
def history():
    return {"items": _read_jsonl(os.path.join(RUNS, "history.jsonl"), 60)}


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

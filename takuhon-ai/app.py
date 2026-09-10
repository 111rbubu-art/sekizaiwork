"""拓本クリーン化サーバー（FastAPI）。

  POST /api/takuhon/clean      切り抜きを渡すと、墨の白黒マスク（PNG）を返す
  POST /api/takuhon/feedback   人が直した正解を貯める（学習は回さない。すぐ返す）
  GET  /api/takuhon/status     いま使っているモデルと、貯まった組数
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
import time
from datetime import datetime

import numpy as np
import torch
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from PIL import Image

import data as D
from unet import load_model

ROOT = os.path.dirname(os.path.abspath(__file__))
DATASET = os.path.join(ROOT, "dataset", "pairs")
RUNS = os.path.join(ROOT, "runs")
CURRENT = os.path.join(RUNS, "current.pth")
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

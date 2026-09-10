"""学習用データの読み書き。

置き場（app.py が作る）
  dataset/pairs/<id>/raw.png, mask.png, hint1.png, hint2.png, meta.json   学習に使う
  dataset/val/<id>/...                                                     検証用（学習に使わない）

彫刻原稿アプリが共有フォルダーへ置く ZIP（1 文字＝1 つ）は
import_pairs.py で dataset/pairs へ展開する。中身の並びは同じ。
"""
import io
import json
import os
import random

import numpy as np
from PIL import Image

N = 512


def _png(path, size=N):
    """白黒 1 枚を 0〜1 の配列で読む。無ければ None。"""
    if not os.path.exists(path):
        return None
    im = Image.open(path).convert("L")
    if im.size != (size, size):
        im = im.resize((size, size), Image.NEAREST)
    return np.asarray(im, dtype=np.float32) / 255.0


def load_pair(d, size=N):
    """1 組を読む。raw と mask は必須、hint は無くてよい。"""
    raw = _png(os.path.join(d, "raw.png"), size)
    mask = _png(os.path.join(d, "mask.png"), size)
    if raw is None or mask is None:
        return None
    h1 = _png(os.path.join(d, "hint1.png"), size)
    h2 = _png(os.path.join(d, "hint2.png"), size)
    if h2 is None:                       # 古い書き出し（v20.66 まで）は hint.png 1 枚だけ
        h2 = _png(os.path.join(d, "hint.png"), size)
    meta = {}
    try:
        with open(os.path.join(d, "meta.json"), encoding="utf-8") as f:
            meta = json.load(f)
    except Exception:
        pass
    return {
        "raw": raw,
        "mask": (mask > 0.5).astype(np.float32),
        "hint1": h1, "hint2": h2, "meta": meta, "dir": d,
    }


def list_pairs(root):
    if not os.path.isdir(root):
        return []
    out = []
    for name in sorted(os.listdir(root)):
        d = os.path.join(root, name)
        if os.path.isdir(d) and os.path.exists(os.path.join(d, "raw.png")):
            out.append(d)
    return out


def to_input(raw, h1, h2, drop1=0.0, drop2=0.0, rng=None):
    """3 枚を重ねて入力にする。drop の割合で手がかりを白紙（0）にする。"""
    r = rng or random
    z = np.zeros_like(raw)
    a = z if (h1 is None or r.random() < drop1) else h1
    b = z if (h2 is None or r.random() < drop2) else h2
    return np.stack([raw, a, b], axis=0)


def augment(raw, mask, h1, h2, rng=None):
    """水増し。拓本は向きが決まっているので、左右反転はしない。
    ずらし・明るさ・上下反転しない、の 3 点だけにする（字の形を壊さないため）。"""
    r = rng or random
    dx, dy = r.randint(-16, 16), r.randint(-16, 16)

    def shift(a, fill):
        if a is None:
            return None
        out = np.full_like(a, fill)
        h, w = a.shape
        sx1, sx2 = max(0, dx), min(w, w + dx)
        sy1, sy2 = max(0, dy), min(h, h + dy)
        out[sy1:sy2, sx1:sx2] = a[sy1 - dy:sy2 - dy, sx1 - dx:sx2 - dx]
        return out

    bg = float(np.median(raw))
    raw2 = shift(raw, bg)
    raw2 = np.clip(raw2 * r.uniform(0.9, 1.1) + r.uniform(-0.05, 0.05), 0.0, 1.0)
    return raw2, shift(mask, 0.0), shift(h1, 0.0), shift(h2, 0.0)


def png_bytes(mask01):
    """0〜1 の配列を白黒 PNG のバイト列にする（墨＝白）。"""
    im = Image.fromarray((np.clip(mask01, 0, 1) * 255).astype(np.uint8), mode="L")
    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    return buf.getvalue()

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
        "weight": crop_weight(meta.get("crop"), size),
    }


def crop_weight(crop, size=N):
    """**採点する範囲**（2026-09-24。本人の案「学習データに編集機能を追加して、トリミングしましょうか」）。

    crop = [x1, y1, x2, y2]（絵の幅・高さに対する 0〜1）。拓本AI の画面の［✂ 範囲］で決める。
    **絵は切らない**（切ると字の大きさが変わり、本番の切り抜きと合わなくなる）。
    範囲の中＝1・外＝0 の重みを返し、学習では外を採点しない。
    正解に となりの字を描いていない組（上下の字が 地 のまま）でも、
    外を採点しなければ「となりの字は墨ではない」と教えずに済む。範囲が無ければ None（ぜんぶ採点）。
    """
    try:
        x1, y1, x2, y2 = [float(v) for v in crop]
    except (TypeError, ValueError):
        return None
    x1, x2 = sorted((max(0.0, min(1.0, x1)), max(0.0, min(1.0, x2))))
    y1, y2 = sorted((max(0.0, min(1.0, y1)), max(0.0, min(1.0, y2))))
    if x2 - x1 < 0.02 or y2 - y1 < 0.02:
        return None
    w = np.zeros((size, size), dtype=np.float32)
    w[int(round(y1 * size)):int(round(y2 * size)), int(round(x1 * size)):int(round(x2 * size))] = 1.0
    return w


OFF = "off"                 # この名前の**空ファイル**があれば「使わない」印


def is_off(d):
    """その組が「使わない」にされているか。"""
    return os.path.exists(os.path.join(d, OFF))


def list_pairs(root, keep_off=False):
    """組の一覧。

    **「使わない」にした組は返さない**（keep_off=True のときだけ返す）。
    こうしておけば、学習も数え上げも、何も直さずに 使わない分を外せる。
    消すのとは違い、印のファイルを外せば すぐ戻せる。
    """
    if not os.path.isdir(root):
        return []
    out = []
    for name in sorted(os.listdir(root)):
        d = os.path.join(root, name)
        if not (os.path.isdir(d) and os.path.exists(os.path.join(d, "raw.png"))):
            continue
        if not keep_off and is_off(d):
            continue
        out.append(d)
    return out


def to_input(raw, h1, h2, drop1=0.0, drop2=0.0, rng=None):
    """3 枚を重ねて入力にする。drop の割合で手がかりを白紙（0）にする。"""
    r = rng or random
    z = np.zeros_like(raw)
    a = z if (h1 is None or r.random() < drop1) else h1
    b = z if (h2 is None or r.random() < drop2) else h2
    return np.stack([raw, a, b], axis=0)


def augment(raw, mask, h1, h2, rng=None, weight=None):
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
    if weight is not None:
        return raw2, shift(mask, 0.0), shift(h1, 0.0), shift(h2, 0.0), shift(weight, 0.0)
    return raw2, shift(mask, 0.0), shift(h1, 0.0), shift(h2, 0.0)


def png_bytes(mask01):
    """0〜1 の配列を白黒 PNG のバイト列にする（墨＝白）。"""
    im = Image.fromarray((np.clip(mask01, 0, 1) * 255).astype(np.uint8), mode="L")
    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    return buf.getvalue()

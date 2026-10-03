"""**読み**の学習材料を作る（2026-09-21）。

材料は 2 つ。
  ① `dataset/lines/<id>/` … 彫刻原稿アプリで登録した列。
     `meta.json` の枠に `ch`（あなたが決めた読み）が入っているものを、
     `raw.png` から 1 字ずつ切り出す。**本物の拓本の字**なので、いちばん効く。
  ② `dataset/chars/<字>/*.png` … 手本帳から送られた 1 字（`POST /api/takuhon/chars`）。
     ブラウザが覚えている形。数は少ないが、拓本に出にくい字の穴うめになる。

切り出し方（推論と必ずそろえること）
  枠の 1.15 倍を切り、**縦横の比は変えずに** 長い方を 64 にして、余りは地で埋める。

**墨も見る**（2026-10-03。本人「墨で見たほうが、精度が上がると思う」）
  見せ方（mode）を 3 通り持つ。どれが良いかは `train_char.py --compare` で 同じ検証用の字で比べて決める。
    raw  … 拓本だけ（1 枚。いままで）
    ink  … 墨だけ（1 枚。墨＝1、地＝0）
    both … 拓本＋墨（2 枚）
  墨は 列といっしょに登録された `ink.png`（白＝墨）から、拓本と **同じ所を 同じ大きさで** 切る。
  `ink.png` が無い列は 墨を使う見せ方では使えない（材料に `ink=None` で入れておき、使う側で外す）。
"""
import json
import os
import random

import numpy as np
from PIL import Image

N = 64
PAD = 1.15          # 枠のまわりを少しつける


def fit(im, n=N):
    """縦横の比を保ったまま n×n に収める。余りは**地（まわりの明るさ）**で埋める。"""
    w, h = im.size
    if w < 2 or h < 2:
        return None
    s = n / float(max(w, h))
    w2, h2 = max(1, int(round(w * s))), max(1, int(round(h * s)))
    a = np.asarray(im.resize((w2, h2), Image.BILINEAR), dtype=np.float32) / 255.0
    bg = float(np.median(a))
    out = np.full((n, n), bg, dtype=np.float32)
    y0, x0 = (n - h2) // 2, (n - w2) // 2
    out[y0:y0 + h2, x0:x0 + w2] = a
    return out


def fit_ink(im, n=N):
    """墨（白＝墨）を fit と同じ寸法で収める。余りは 0（墨なし）。返りは 0/1。"""
    w, h = im.size
    if w < 2 or h < 2:
        return None
    s = n / float(max(w, h))
    w2, h2 = max(1, int(round(w * s))), max(1, int(round(h * s)))
    a = (np.asarray(im.resize((w2, h2), Image.BILINEAR), dtype=np.float32) / 255.0 > 0.5)
    out = np.zeros((n, n), dtype=np.float32)
    y0, x0 = (n - h2) // 2, (n - w2) // 2
    out[y0:y0 + h2, x0:x0 + w2] = a
    return out


MODES = ("raw", "ink", "both")


def chans(mode):
    return 2 if mode == "both" else 1


def stack(raw, ink, mode):
    """見せ方に合わせて (C,64,64) にする。墨が要るのに無ければ None。"""
    if mode == "raw":
        return raw[None]
    if ink is None:
        return None
    if mode == "ink":
        return ink[None]
    return np.stack([raw, ink], axis=0)


def _cut(im, b, pad=PAD):
    """枠 b（x,y,w,h）を pad 倍で切り出す。"""
    cx, cy = b["x"] + b["w"] / 2, b["y"] + b["h"] / 2
    s = max(b["w"], b["h"]) * pad
    box = (int(round(cx - s / 2)), int(round(cy - s / 2)),
           int(round(cx + s / 2)), int(round(cy + s / 2)))
    return im.crop(box)


def from_lines(root):
    """登録した列から、読みのついた 1 字を集める。返りは [((拓本 64×64, 墨 64×64 または None), 字)]。"""
    out = []
    if not os.path.isdir(root):
        return out
    for name in sorted(os.listdir(root)):
        d = os.path.join(root, name)
        if not os.path.isdir(d) or os.path.exists(os.path.join(d, "off")):
            continue
        try:
            with open(os.path.join(d, "meta.json"), encoding="utf-8") as f:
                m = json.load(f)
            im = Image.open(os.path.join(d, "raw.png")).convert("L")
        except (OSError, ValueError):
            continue
        ik = None
        try:
            ik = Image.open(os.path.join(d, "ink.png")).convert("L")
            if ik.size != im.size:
                ik = ik.resize(im.size, Image.NEAREST)
        except OSError:
            ik = None
        for b in (m.get("boxes") or []):
            ch = (b.get("ch") or "").strip()
            if len(ch) != 1:
                continue
            try:
                a = fit(_cut(im, b))
                k = fit_ink(_cut(ik, b)) if ik is not None else None
            except (KeyError, TypeError, ValueError):
                continue
            if a is not None:
                out.append(((a, k), ch))
    return out


def from_chars(root):
    """手本帳から送られた 1 字（dataset/chars/<字>/*.png）を集める。"""
    out = []
    if not os.path.isdir(root):
        return out
    for ch in sorted(os.listdir(root)):
        d = os.path.join(root, ch)
        if not os.path.isdir(d) or len(ch) != 1:
            continue
        for f in sorted(os.listdir(d)):
            if not f.lower().endswith(".png"):
                continue
            try:
                im = Image.open(os.path.join(d, f)).convert("L")
                a = fit(im)
                # 手本帳は 黒＝墨 の白黒。墨は 白＝墨 に返して使う
                k = fit_ink(Image.eval(im, lambda v: 255 - v))
            except OSError:
                continue
            if a is not None:
                out.append(((a, k), ch))
    return out


def augment(a, rng=None, mode="raw"):
    """水増し。拓本は向きが決まっているので**反転はしない**。
    少しの ずらし・傾き・大きさ・明るさ だけ（字の形を壊さない範囲で）。
    a は (C,64,64)。傾き・ずらしは **どの面にも同じだけ**、明るさは 拓本の面だけ。"""
    r = rng or random
    a = np.asarray(a, dtype=np.float32)
    if a.ndim == 2:
        a = a[None]
    ang = r.uniform(-6, 6) if r.random() < 0.8 else 0.0
    dx, dy = r.randint(-3, 3), r.randint(-3, 3)
    gain, bias = r.uniform(0.85, 1.15), r.uniform(-0.08, 0.08)
    out = []
    for c in range(a.shape[0]):
        is_ink = (mode == "ink") or (mode == "both" and c == 1)
        p = a[c]
        im = Image.fromarray((np.clip(p, 0, 1) * 255).astype(np.uint8), mode="L")
        if ang:
            im = im.rotate(ang, resample=Image.NEAREST if is_ink else Image.BILINEAR,
                           fillcolor=0 if is_ink else int(np.median(p) * 255))
        b = np.asarray(im, dtype=np.float32) / 255.0
        b = np.roll(np.roll(b, dy, axis=0), dx, axis=1)
        if not is_ink:
            b = np.clip(b * gain + bias, 0.0, 1.0)
        out.append(b)
    return np.stack(out, axis=0).astype(np.float32)

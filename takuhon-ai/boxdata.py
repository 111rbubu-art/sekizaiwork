"""**列まるごと**の学習材料を読む（2026-09-21）。

置き場（app.py の POST /api/takuhon/line が作る）
  dataset/lines/<id>/raw.png    列 1 本の切り抜き（拓本のまま）
  dataset/lines/<id>/ink.png    AI が読んだ墨（あれば）
  dataset/lines/<id>/meta.json  {"boxes":[{x,y,w,h,ch,g}], "crop":{...}, ...}

やること
  ・列の切り抜きを **横 W_STD（既定 128px）** にそろえる。
    拓本ごとに字の大きさは違うが、切り抜きの幅は「字の幅＋のりしろ」なので、
    これでそろえれば、どの拓本でも字は同じくらいの大きさになる。
  ・正解を 3 枚作る
      center … 枠の中心に ガウスの山（1 字 1 つ）
      w, h   … その山のあたりに「幅 ÷ W」「高さ ÷ W」を置く
  ・学習では たてに 窓（既定 384px）で切り出して渡す。
"""
import json
import os
import random

import numpy as np
from PIL import Image

W_STD = 128          # 列の切り抜きをこの幅にそろえる
WIN_H = 384          # 学習で切り出す窓の高さ
SIG = 0.12           # 山の太さ（字の幅に対する割合）


def list_lines(root):
    """列の一覧。raw.png と meta.json（枠つき）がそろっているものだけ。"""
    if not os.path.isdir(root):
        return []
    out = []
    for name in sorted(os.listdir(root)):
        d = os.path.join(root, name)
        if not os.path.isdir(d) or os.path.exists(os.path.join(d, "off")):
            continue
        if not os.path.exists(os.path.join(d, "raw.png")):
            continue
        try:
            with open(os.path.join(d, "meta.json"), encoding="utf-8") as f:
                m = json.load(f)
        except (OSError, ValueError):
            continue
        if m.get("boxes"):
            out.append(d)
    return out


def load_line(d):
    """1 列を読んで、横 W_STD にそろえた絵と枠を返す。"""
    try:
        with open(os.path.join(d, "meta.json"), encoding="utf-8") as f:
            m = json.load(f)
    except (OSError, ValueError):
        return None
    bx = m.get("boxes") or []
    if not bx:
        return None
    im = Image.open(os.path.join(d, "raw.png")).convert("L")
    w0, h0 = im.size
    if w0 < 8 or h0 < 8:
        return None
    sc = W_STD / float(w0)
    W, H = W_STD, max(16, int(round(h0 * sc)))
    raw = np.asarray(im.resize((W, H), Image.BILINEAR), dtype=np.float32) / 255.0
    ip = os.path.join(d, "ink.png")
    if os.path.exists(ip):
        ink = np.asarray(Image.open(ip).convert("L").resize((W, H), Image.NEAREST),
                         dtype=np.float32) / 255.0
        ink = (ink > 0.5).astype(np.float32)
    else:
        ink = np.zeros((H, W), dtype=np.float32)
    boxes, chs = [], []
    for b in bx:
        try:
            x, y = float(b["x"]) * sc, float(b["y"]) * sc
            w, h = float(b["w"]) * sc, float(b["h"]) * sc
        except (KeyError, TypeError, ValueError):
            continue
        if w <= 1 or h <= 1:
            continue
        boxes.append((x + w / 2, y + h / 2, w, h))
        chs.append(str(b.get("ch") or ""))          # 字ごとの 成績を 出すため（2026-10-15。学習には 使わない）
    if not boxes:
        return None
    return {"raw": raw, "ink": ink, "boxes": boxes, "chs": chs, "dir": d, "W": W, "H": H}


def targets(H, W, boxes):
    """正解の 3 枚（center / w / h）を作る。"""
    ctr = np.zeros((H, W), dtype=np.float32)
    siz = np.zeros((2, H, W), dtype=np.float32)
    msk = np.zeros((H, W), dtype=np.float32)
    for cx, cy, w, h in boxes:
        s = max(1.5, SIG * W)
        x0, x1 = int(max(0, cx - 3 * s)), int(min(W, cx + 3 * s + 1))
        y0, y1 = int(max(0, cy - 3 * s)), int(min(H, cy + 3 * s + 1))
        if x1 <= x0 or y1 <= y0:
            continue
        yy, xx = np.mgrid[y0:y1, x0:x1]
        g = np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * s * s)).astype(np.float32)
        ctr[y0:y1, x0:x1] = np.maximum(ctr[y0:y1, x0:x1], g)
        # 大きさは**山の近く**だけで測る（遠くの画素まで覚えさせても意味がない）
        near = g > 0.5
        siz[0][y0:y1, x0:x1][near] = w / W
        siz[1][y0:y1, x0:x1][near] = h / W
        msk[y0:y1, x0:x1][near] = 1.0
    return ctr, siz, msk


def targets2(H, W, boxes):
    """**作り 2 の 正解**（2026-10-15）：center は 作り 1 と 同じ 山。
    ltrb … 字の 中ほど（枠の まん中から 幅・高さの 35% 以内）の 点ごとに、左・上・右・下の はしまでの 長さ ÷ W。
    wt   … その点の 重み（まん中ほど 重い。山の 高さ。0.2 より 軽くしない）。
    2 字の 中ほどが 重なる 点は、まん中に 近い（字の 大きさで 割った 近さ）方の 字に する。"""
    ctr = np.zeros((H, W), dtype=np.float32)
    ltrb = np.zeros((4, H, W), dtype=np.float32)
    wt = np.zeros((H, W), dtype=np.float32)
    near = np.full((H, W), np.inf, dtype=np.float32)
    s = max(1.5, SIG * W)
    for cx, cy, w, h in boxes:
        x0, x1 = int(max(0, cx - 3 * s)), int(min(W, cx + 3 * s + 1))
        y0, y1 = int(max(0, cy - 3 * s)), int(min(H, cy + 3 * s + 1))
        if x1 > x0 and y1 > y0:
            yy, xx = np.mgrid[y0:y1, x0:x1]
            g = np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * s * s)).astype(np.float32)
            ctr[y0:y1, x0:x1] = np.maximum(ctr[y0:y1, x0:x1], g)
        rx, ry = max(1.0, 0.35 * w), max(1.0, 0.35 * h)
        a0, a1 = int(max(0, np.floor(cx - rx))), int(min(W, np.ceil(cx + rx) + 1))
        b0, b1 = int(max(0, np.floor(cy - ry))), int(min(H, np.ceil(cy + ry) + 1))
        if a1 <= a0 or b1 <= b0:
            continue
        yy, xx = np.mgrid[b0:b1, a0:a1]
        px, py = xx + 0.5, yy + 0.5
        inside = (np.abs(px - cx) <= rx) & (np.abs(py - cy) <= ry)
        dn = np.maximum(np.abs(px - cx) / max(w, 1.0), np.abs(py - cy) / max(h, 1.0)).astype(np.float32)
        take = inside & (dn < near[b0:b1, a0:a1])
        if not take.any():
            continue
        near[b0:b1, a0:a1][take] = dn[take]
        x1b, y1b, x2b, y2b = cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2
        for k, v in enumerate((px - x1b, py - y1b, x2b - px, y2b - py)):
            ltrb[k][b0:b1, a0:a1][take] = (v[take] / W).astype(np.float32)
        gw = np.exp(-((px - cx) ** 2 + (py - cy) ** 2) / (2 * s * s)).astype(np.float32)
        wt[b0:b1, a0:a1][take] = np.maximum(gw[take], 0.2)
    return ctr, ltrb, wt


def zoom(it, f, fy=None):
    """**切り抜きの広さのちがい**を作る（2026-09-21 の実測で必要と分かった）。

    学習の材料は「枠ぜんたい＋のりしろ 12%」の切り抜きなので、字は横幅の
    8 割ほどを占める。ところが本番では、帯を 2 割ずつ広げた切り抜きを渡すので、
    字は横幅の 5 割ほどにしかならない。そのままでは**枠を小さく見積もる**
    （実測：高さ 90px の字を 27px と答えた）。
    そこで学習のときに、絵ぜんたいを f 倍に縮めて横を地で埋め、
    「字が小さく写った切り抜き」も見せておく。
    """
    # fy … たてだけ 別の 倍率（作り 2 の 学習で 縦横の 伸び縮みを 見せる。2026-10-15。
    #       字の 形の 見こみ（ふつうは 正方形）では なく、墨の はしを 見て 答える ように）
    fy = f if fy is None else fy
    if abs(f - 1.0) < 0.02 and abs(fy - 1.0) < 0.02:
        return it
    W, H = it["W"], it["H"]
    w2, h2 = max(8, int(round(W * f))), max(8, int(round(H * fy)))
    bg = float(np.median(it["raw"]))

    def z(a, fill, nearest=False):
        im = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8), mode="L")
        im = im.resize((w2, h2), Image.NEAREST if nearest else Image.BILINEAR)
        b = np.asarray(im, dtype=np.float32) / 255.0
        out = np.full((max(h2, 1), W), fill, dtype=np.float32)
        x0 = max(0, (W - w2) // 2)
        out[:, x0:x0 + min(w2, W)] = b[:, :min(w2, W)]
        return out, x0

    raw, x0 = z(it["raw"], bg)
    ink, _ = z(it["ink"], 0.0, nearest=True)
    boxes = [(cx * f + x0, cy * fy, w * f, h * fy) for (cx, cy, w, h) in it["boxes"]]
    return {"raw": raw, "ink": ink, "boxes": boxes, "chs": it.get("chs"), "dir": it["dir"], "W": W, "H": raw.shape[0]}


def window(it, win=WIN_H, rng=None, train=True, zoom_lo=0.45, zoom_hi=1.25, arch=1):
    """（2026-09-22）**縮め方の幅を広げた**。実測で、登録した列は
    「字の幅 ÷ 切り抜きの幅」が 0.43〜0.64 とばらついていた
    （長い列は 戒名と命日で字の幅が違い、切り抜きは その union になるため）。
    描かせるときの切り抜き（帯＋12%）とも食いちがうので、
    そのぶん ここで見せておく。"""
    """たての窓を 1 つ切り出して、入力と正解にする。"""
    r = rng or random
    if train:
        f = r.uniform(zoom_lo, zoom_hi)
        it = zoom(it, f, f * r.uniform(0.82, 1.22) if arch == 2 else None)
    H, W = it["H"], it["W"]
    if H <= win:
        y0 = 0
        pad = win - H
    else:
        y0 = r.randint(0, H - win) if train else max(0, (H - win) // 2)
        pad = 0
    y1 = min(H, y0 + win)
    raw = it["raw"][y0:y1]
    ink = it["ink"][y0:y1]
    bx = [(cx, cy - y0, w, h) for (cx, cy, w, h) in it["boxes"] if y0 - 2 < cy < y1 + 2]
    if arch == 2:
        # 窓の 上下で 切れた 字も はしの 正解には 入れる（中ほどが 窓に 入る 所だけ 学ぶ）
        bx = [(cx, cy - y0, w, h) for (cx, cy, w, h) in it["boxes"] if y0 - h / 2 < cy < y1 + h / 2]
        ctr, siz, msk = targets2(y1 - y0, W, bx)
    else:
        ctr, siz, msk = targets(y1 - y0, W, bx)
    if pad:
        def pd(a, v=0.0):
            return np.pad(a, ((0, pad), (0, 0)), constant_values=v)
        raw, ink = pd(raw, float(np.median(raw))), pd(ink)
        ctr, msk = pd(ctr), pd(msk)
        siz = np.stack([pd(c) for c in siz])
    x = np.stack([raw, ink], axis=0)
    return x, ctr[None], siz, msk[None]


def augment(x, rng=None):
    """水増し。拓本は向きが決まっているので、反転はしない。明るさだけ。"""
    r = rng or random
    x = x.copy()
    x[0] = np.clip(x[0] * r.uniform(0.9, 1.1) + r.uniform(-0.05, 0.05), 0.0, 1.0)
    if r.random() < 0.3:          # 墨が無いときにも耐えられるように
        x[1] = np.zeros_like(x[1])
    return x

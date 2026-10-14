"""範囲ぜんたいの墨を 1 回で（2026-10-14）。

アプリの［拓本AI解析（新しい順）］は、範囲を 字 1 個ぶんの窓で 縦横に ずらして
墨の AI（/api/takuhon/clean）に 1 枚ずつ 通していた（本人の拓本で 520 枚・約 2 分）。
サーバーは 1 枚ずつしか 片付けないので、同時に送っても 速くならなかった。

ここは **範囲の絵を 1 回 受け取り、アプリと同じ窓で 切って、まとめて AI に通し、
濃い方を採って 1 枚に重ねる** ところ。torch を使わない（infer を 渡してもらう）ので、
torch の無い所でも 試せる。

窓の切り方は アプリ（chokoku-genko.html の rubCropPng）と同じ：
  窓（win 画素の 四角）を 512×512 に、いちばん近い画素を拾って 縮める
  （X = round(x + (px + 0.5) * win / 512)。絵の外は fill）。
重ね方も アプリ（rubInkWhole）と同じ：AI の答え（0〜1）を scale 倍の大きさに 縮めて、濃い方を採る。
"""
import numpy as np
from PIL import Image

N = 512


def _round(v):
    """JavaScript の Math.round と同じ（.5 は 大きい方へ）。"""
    return np.floor(v + 0.5).astype(np.int64)


def crop_tile(arr, x, y, win, fill=255, n=N):
    """arr（H×W・uint8）から 窓（左上 x,y・一辺 win）を n×n に 切る。0〜1 の float32。"""
    H, W = arr.shape
    st = win / float(n)
    ix = _round(x + (np.arange(n) + 0.5) * st)
    iy = _round(y + (np.arange(n) + 0.5) * st)
    vx = (ix >= 0) & (ix < W)
    vy = (iy >= 0) & (iy < H)
    t = np.full((n, n), fill, dtype=np.uint8)
    if vx.any() and vy.any():
        t[np.ix_(vy, vx)] = arr[np.ix_(iy[vy], ix[vx])]
    return t.astype(np.float32) / 255.0


def is_flat(arr, x, y, win, fill=255, g=24, lim=10.0):
    """窓の中を g×g 点 見て、明るさの ばらつき（標準偏差）が lim 未満なら のっぺり（紙・拓本の外）。
    アプリの rubInkWhole の flat と同じ見方。"""
    H, W = arr.shape
    pos = (np.arange(g) + 0.5) * win / g
    ix = _round(x + pos)
    iy = _round(y + pos)
    vals = np.full((g, g), float(fill), dtype=np.float64)
    vx = (ix >= 0) & (ix < W)
    vy = (iy >= 0) & (iy < H)
    if vx.any() and vy.any():
        vals[np.ix_(vy, vx)] = arr[np.ix_(iy[vy], ix[vx])]
    return float(vals.std()) < lim


def ink_tiles(arr, xs, ys, win, scale, infer, fill=255, skip_flat=True, batch=8):
    """窓を ぜんぶ AI に通して 1 枚に重ねる。

    arr   … 範囲の拓本（H×W・uint8・グレー）。xs, ys … 窓の左上（arr の中の画素）
    win   … 窓の一辺（arr の画素）。scale … 返す絵の 縮尺（アプリの SC）
    infer … 0〜1 の n×n の並び（list）を受け取り、同じ数の 0〜1 の n×n（墨の濃さ）を返す
    返り … (acc: uint8 の 2 次元・scale 倍の大きさ, 通した数, のっぺりで とばした数)
    """
    H, W = arr.shape
    oh, ow = max(1, int(round(H * scale))), max(1, int(round(W * scale)))
    acc = np.zeros((oh, ow), dtype=np.uint8)
    s = max(1, int(round(win * scale)))
    jobs = []
    n_skip = 0
    for y in ys:
        for x in xs:
            if skip_flat and is_flat(arr, x, y, win, fill):
                n_skip += 1
                continue
            jobs.append((x, y))
    for i in range(0, len(jobs), max(1, batch)):
        part = jobs[i:i + max(1, batch)]
        outs = infer([crop_tile(arr, x, y, win, fill) for (x, y) in part])
        for (x, y), o in zip(part, outs):
            im = Image.fromarray((np.clip(o, 0, 1) * 255 + 0.5).astype(np.uint8), mode="L")
            t = np.asarray(im.resize((s, s), Image.BILINEAR), dtype=np.uint8)
            ox, oy = int(round(x * scale)), int(round(y * scale))
            x0, y0 = max(0, ox), max(0, oy)
            x1, y1 = min(ow, ox + s), min(oh, oy + s)
            if x1 <= x0 or y1 <= y0:
                continue
            sub = t[y0 - oy:y1 - oy, x0 - ox:x1 - ox]
            np.maximum(acc[y0:y1, x0:x1], sub, out=acc[y0:y1, x0:x1])
    return acc, len(jobs), n_skip

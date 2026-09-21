"""**字の枠を出す**ための小さな U-Net（2026-09-21。本人の指示
「今の枠が役に立たないので、登録しても無視されるから AI にしようという結論に
  なったので／AI は何を出してくれるの」を受けて）。

いままでの `unet.py` は **墨を 1 枚**出すだけで、1 字ずつに切るのは
彫刻原稿アプリ側の計算（墨のすき間・覚えた大きさ・手本帳）だった。
そこが当たらないので、**切るところまで AI に出させる**。

入力 2 枚（たての長い切り抜き。列 1 本ぶん）
  0ch  raw   拓本の切り抜き（濃淡 0〜1）
  1ch  ink   AI が読んだ墨（0/1。無ければ 0 で埋める）

出力 3 枚（入力と同じ大きさ）
  0ch  center  **字の中心ほど明るい点の絵**（山の頂 1 つ＝1 字）
  1ch  w       その画素の字の幅  ÷ 入力の幅
  2ch  h       その画素の字の高さ ÷ 入力の幅

使い方（app.py）
  center を sigmoid して、まわりより高い所（山の頂）を拾う → そこが 1 字。
  その画素の w・h を読めば、枠の大きさが決まる。
  つまりアプリへ返すのは `[{x, y, w, h, score}, ...]` の並び。

**字の幅で割って覚える**のが要点。拓本によって字の大きさは違うが、
列の切り抜きの幅は「字の幅＋のりしろ」なので、それで割れば どの拓本でも同じ数になる。
"""
import torch
import torch.nn as nn

from unet import block


class BoxNet(nn.Module):
    def __init__(self, in_ch=2, base=16):
        super().__init__()
        c = [base, base * 2, base * 4, base * 8]
        self.d1, self.d2, self.d3 = block(in_ch, c[0]), block(c[0], c[1]), block(c[1], c[2])
        self.mid = block(c[2], c[3])
        self.pool = nn.MaxPool2d(2)
        self.u3 = nn.ConvTranspose2d(c[3], c[2], 2, 2)
        self.u2 = nn.ConvTranspose2d(c[2], c[1], 2, 2)
        self.u1 = nn.ConvTranspose2d(c[1], c[0], 2, 2)
        self.c3, self.c2, self.c1 = block(c[3], c[2]), block(c[2], c[1]), block(c[1], c[0])
        self.ctr = nn.Conv2d(c[0], 1, 1)        # 中心（ロジット。sigmoid はまだ掛けない）
        self.siz = nn.Conv2d(c[0], 2, 1)        # 幅・高さ（そのままの数）

    def forward(self, x):
        d1 = self.d1(x)
        d2 = self.d2(self.pool(d1))
        d3 = self.d3(self.pool(d2))
        m = self.mid(self.pool(d3))
        y = self.c3(torch.cat([self.u3(m), d3], 1))
        y = self.c2(torch.cat([self.u2(y), d2], 1))
        y = self.c1(torch.cat([self.u1(y), d1], 1))
        return self.ctr(y), self.siz(y)


def load_boxnet(path, device, in_ch=2, base=16):
    """学習済みがあれば読む。無ければ まっさらな重みを返す（`unet.load_model` と同じ作り）。"""
    info = {"loaded": False, "path": str(path), "step": 0, "f1": None, "lines": None,
            "at": None, "base": base, "why": None}
    ck = None
    try:
        ck = torch.load(path, map_location=device)
        base = int(ck.get("base", base))
    except FileNotFoundError:
        info["why"] = "まだ学習していません"
    except Exception as e:                                   # noqa: BLE001
        info["why"] = f"読めませんでした（{type(e).__name__}: {e}）"
    net = BoxNet(in_ch=in_ch, base=base).to(device)
    info["base"] = base
    if ck is not None:
        try:
            net.load_state_dict(ck["model"])
            info.update(loaded=True, step=ck.get("step", 0), f1=ck.get("f1"),
                        lines=ck.get("lines"), at=ck.get("at"), why=None)
        except Exception as e:                               # noqa: BLE001
            info["why"] = f"かたちが合いません（{type(e).__name__}: {str(e)[:120]}）"
    net.eval()
    return net, info


@torch.no_grad()
def find_boxes(net, x, thr=0.3, nms=None, cap=200, iou_nms=0.3):
    """出力から枠を拾う。x は (1,2,H,W) の tensor。返りは画素の並び。

    山の頂の見つけ方：max pool を掛けて、**自分が周りの最大**ならそこが頂。

    **頂を探す窓は、字の大きさに合わせる**（2026-09-21 の実測で判明）。
    9 画素で探していたときは、1 字の中に頂が何十も立ち、
    200 個の枠が同じ字に重なって出ていた（F1 0.08）。
    列の切り抜きの幅 ≒ 字の幅なので、**幅の半分**を窓にする。
    そのうえで、重なった枠は重なり（IoU）で間引く。
    """
    ctr, siz = net(x)
    p = torch.sigmoid(ctr)
    W = p.shape[-1]
    if nms is None:
        nms = max(9, int(W * 0.5) | 1)          # 必ず奇数に
    mx = nn.functional.max_pool2d(p, nms, stride=1, padding=nms // 2)
    peak = (p >= mx) & (p >= thr)
    idx = peak[0, 0].nonzero()
    out = []
    for yx in idx[:cap * 8]:
        y, xx = int(yx[0]), int(yx[1])
        w = float(siz[0, 0, y, xx]) * W
        h = float(siz[0, 1, y, xx]) * W
        if w < 4 or h < 4:
            continue
        out.append({"cx": xx, "cy": y, "w": w, "h": h, "score": float(p[0, 0, y, xx])})
    out.sort(key=lambda b: -b["score"])
    return _nms(out, iou_nms)[:cap]


def _box_iou(a, b):
    ax1, ay1 = a["cx"] - a["w"] / 2, a["cy"] - a["h"] / 2
    ax2, ay2 = a["cx"] + a["w"] / 2, a["cy"] + a["h"] / 2
    bx1, by1 = b["cx"] - b["w"] / 2, b["cy"] - b["h"] / 2
    bx2, by2 = b["cx"] + b["w"] / 2, b["cy"] + b["h"] / 2
    x1, y1 = max(ax1, bx1), max(ay1, by1)
    x2, y2 = min(ax2, bx2), min(ay2, by2)
    if x2 <= x1 or y2 <= y1:
        return 0.0
    i = (x2 - x1) * (y2 - y1)
    return i / (a["w"] * a["h"] + b["w"] * b["h"] - i)


def _nms(boxes, thr=0.3):
    """重なっている枠は、確からしさの高い方だけ残す。"""
    keep = []
    for b in boxes:
        if all(_box_iou(b, k) < thr for k in keep):
            keep.append(b)
    return keep

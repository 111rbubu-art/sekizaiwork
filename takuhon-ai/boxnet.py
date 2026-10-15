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
import torch.nn.functional as F

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


class BoxNet2(nn.Module):
    """**作り 2：字の はしを 当てる**（2026-10-15。本人「学習のと登録数が多い文字の枠の精度が悪いのを改善しないといけません」）。

    作り 1（`BoxNet`）は **字の中心の 1 点** で 幅・高さ を当てていた。
      ・その 1 点から 見える 範囲（受け持ち）は 横 128 ますの 切り抜きで 100 ます ほど。じっさいに よく見えるのは もっと せまく、
        字の 上下の はしまで 見えないので「ふつうの 字の 大きさ」で 答えがちだった（日 が 平たく・墨の 内側に 枠）。
    作り 2 は
      ① 下へ 1 段 ふかくして（4 段）字の ぜんたいが 見えるように
      ② 大きさは **字の 中の 点 それぞれから 上下左右の はしまでの 長さ**（l・t・r・b。入力の幅で 割る）で 当てる。
         字の 中ほど（枠の 7 割）の 点 すべてで 学ぶので、1 点に たよらない。使うときは 頂の まわりの 点の 答えを 平均する
      ③ 損失は 重なり（GIoU）。はしの ずれが そのまま 点に なる
    出力 … center（1ch・ロジット）／ltrb（4ch・0 以上）
    """
    arch = 2

    def __init__(self, in_ch=2, base=16):
        super().__init__()
        c = [base, base * 2, base * 4, base * 8, base * 16]
        self.d1, self.d2 = block(in_ch, c[0]), block(c[0], c[1])
        self.d3, self.d4 = block(c[1], c[2]), block(c[2], c[3])
        self.mid = block(c[3], c[4])
        self.pool = nn.MaxPool2d(2)
        self.u4 = nn.ConvTranspose2d(c[4], c[3], 2, 2)
        self.u3 = nn.ConvTranspose2d(c[3], c[2], 2, 2)
        self.u2 = nn.ConvTranspose2d(c[2], c[1], 2, 2)
        self.u1 = nn.ConvTranspose2d(c[1], c[0], 2, 2)
        self.c4, self.c3 = block(c[4], c[3]), block(c[3], c[2])
        self.c2, self.c1 = block(c[2], c[1]), block(c[1], c[0])
        self.ctr = nn.Conv2d(c[0], 1, 1)
        self.ltrb = nn.Conv2d(c[0], 4, 1)
        nn.init.constant_(self.ctr.bias, -2.19)        # はじめは「字は 少ない」（sigmoid で 0.1）

    def forward(self, x):
        d1 = self.d1(x)
        d2 = self.d2(self.pool(d1))
        d3 = self.d3(self.pool(d2))
        d4 = self.d4(self.pool(d3))
        m = self.mid(self.pool(d4))
        y = self.c4(torch.cat([self.u4(m), d4], 1))
        y = self.c3(torch.cat([self.u3(y), d3], 1))
        y = self.c2(torch.cat([self.u2(y), d2], 1))
        y = self.c1(torch.cat([self.u1(y), d1], 1))
        return self.ctr(y), F.softplus(self.ltrb(y))


BoxNet.arch = 1
ARCHS = {1: BoxNet, 2: BoxNet2}


def make_boxnet(arch=1, in_ch=2, base=16):
    return ARCHS.get(int(arch or 1), BoxNet)(in_ch=in_ch, base=base)


def load_boxnet(path, device, in_ch=2, base=16):
    """学習済みがあれば読む。無ければ まっさらな重みを返す（`unet.load_model` と同じ作り）。"""
    info = {"loaded": False, "path": str(path), "step": 0, "f1": None, "lines": None,
            "at": None, "base": base, "arch": 1, "why": None}
    ck, arch = None, 1
    try:
        ck = torch.load(path, map_location=device)
        base = int(ck.get("base", base))
        arch = int(ck.get("arch", 1) or 1)
    except FileNotFoundError:
        info["why"] = "まだ学習していません"
    except Exception as e:                                   # noqa: BLE001
        info["why"] = f"読めませんでした（{type(e).__name__}: {e}）"
    net = make_boxnet(arch, in_ch=in_ch, base=base).to(device)
    info["base"], info["arch"] = base, arch
    if ck is not None:
        try:
            net.load_state_dict(ck["model"])
            # きっちりの 当たり（f1t・重なり 0.75）・重なりの 平均（miou）・はしの ずれ（edge・字の 大きさに 対する 割合）は 2026-10-15 から
            info.update(loaded=True, step=ck.get("step", 0), f1=ck.get("f1"),
                        f1t=ck.get("f1t"), miou=ck.get("miou"), edge=ck.get("edge"),
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
    H, W = p.shape[-2], p.shape[-1]
    if nms is None:
        nms = max(9, int(W * 0.5) | 1)          # 必ず奇数に
    mx = nn.functional.max_pool2d(p, nms, stride=1, padding=nms // 2)
    peak = (p >= mx) & (p >= thr)
    idx = peak[0, 0].nonzero()
    out = []
    two = getattr(net, "arch", 1) == 2
    if two:
        # 作り 2：頂の まわり（入力の幅の 8%）で、頂の 半分 以上 明るい 点の 答え（はしの 位置）を 明るさで 重みづけ 平均する
        rr = max(2, int(round(W * 0.08)))
        P = p[0, 0]
        # 画素の まん中（+0.5）から はしまで（boxdata.targets2 と 同じ 決め）
        ys = torch.arange(H, device=p.device, dtype=torch.float32).view(H, 1) + 0.5
        xs = torch.arange(W, device=p.device, dtype=torch.float32).view(1, W) + 0.5
        X1 = xs - siz[0, 0] * W
        Y1 = ys - siz[0, 1] * W
        X2 = xs + siz[0, 2] * W
        Y2 = ys + siz[0, 3] * W
    for yx in idx[:cap * 8]:
        y, xx = int(yx[0]), int(yx[1])
        if two:
            y0, y1, x0, x1 = max(0, y - rr), min(H, y + rr + 1), max(0, xx - rr), min(W, xx + rr + 1)
            pp = P[y0:y1, x0:x1]
            wt = pp * (pp >= 0.5 * P[y, xx]).float()
            sw = float(wt.sum())
            if sw <= 0:
                continue
            bx1 = float((X1[y0:y1, x0:x1] * wt).sum()) / sw
            by1 = float((Y1[y0:y1, x0:x1] * wt).sum()) / sw
            bx2 = float((X2[y0:y1, x0:x1] * wt).sum()) / sw
            by2 = float((Y2[y0:y1, x0:x1] * wt).sum()) / sw
            w, h = bx2 - bx1, by2 - by1
            if w < 4 or h < 4:
                continue
            out.append({"cx": (bx1 + bx2) / 2, "cy": (by1 + by2) / 2, "w": w, "h": h, "score": float(P[y, xx])})
            continue
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

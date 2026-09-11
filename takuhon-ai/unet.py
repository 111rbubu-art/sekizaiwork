"""拓本クリーン化の U-Net。

入力 3 枚（512×512）
  0ch  raw    拓本の切り抜き（濃淡 0〜1）
  1ch  hint1  元のフォントの字形（無ければ 0）
  2ch  hint2  **使わない（いつも 0）**。彫刻原稿アプリ v20.88 から渡していない。
              「フォントを寄せた、微妙にずれた形」は正解ではなく、それに引っ張られると
              彫ってある形から離れるため。枠だけ残してあるのは、古い組と
              かたちを合わせておくため（SPEC-輪郭と補正.md）
出力 1 枚
  墨らしさ（0〜1）。0.5 で切って白黒にする。

手がかり（hint）は無い組があるので、学習時にわざと 0 に差し替えて、
「手がかり無しでも読める」ように育てる（train.py の HINT_DROP）。
"""
import torch
import torch.nn as nn


def block(a, b):
    return nn.Sequential(
        nn.Conv2d(a, b, 3, padding=1, bias=False), nn.BatchNorm2d(b), nn.ReLU(inplace=True),
        nn.Conv2d(b, b, 3, padding=1, bias=False), nn.BatchNorm2d(b), nn.ReLU(inplace=True),
    )


class UNet(nn.Module):
    def __init__(self, in_ch=3, base=32):
        super().__init__()
        c = [base, base * 2, base * 4, base * 8, base * 16]
        self.d1, self.d2, self.d3, self.d4 = block(in_ch, c[0]), block(c[0], c[1]), block(c[1], c[2]), block(c[2], c[3])
        self.mid = block(c[3], c[4])
        self.pool = nn.MaxPool2d(2)
        self.u4 = nn.ConvTranspose2d(c[4], c[3], 2, 2)
        self.u3 = nn.ConvTranspose2d(c[3], c[2], 2, 2)
        self.u2 = nn.ConvTranspose2d(c[2], c[1], 2, 2)
        self.u1 = nn.ConvTranspose2d(c[1], c[0], 2, 2)
        self.c4, self.c3, self.c2, self.c1 = block(c[4], c[3]), block(c[3], c[2]), block(c[2], c[1]), block(c[1], c[0])
        self.out = nn.Conv2d(c[0], 1, 1)

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
        return self.out(y)          # ロジット（sigmoid はまだ掛けない）


def load_model(path, device, in_ch=3, base=32):
    """学習済みがあれば読む。無ければまっさらな重みを返す。

    **モデルの大きさ（base）は、しまってある値に従う。**
    `train.py --base 16` のように変えて学習すると、決め打ちで組んだ型とは
    かたちが合わず、黙って「モデルが無い」ことになってしまう（実際になった）。
    読めなかったときは**理由を info["why"] に残す**。
    黙って何も出ないと、原因の見当がつかないため。
    """
    info = {"loaded": False, "path": str(path), "step": 0, "iou": None,
            "iou_nohint": None, "pairs": None, "at": None, "base": base, "why": None}
    ck = None
    try:
        ck = torch.load(path, map_location=device)
        base = int(ck.get("base", base))
    except FileNotFoundError:
        info["why"] = "まだ学習していません"
    except Exception as e:
        info["why"] = f"読めませんでした（{type(e).__name__}: {e}）"
    net = UNet(in_ch=in_ch, base=base).to(device)
    info["base"] = base
    if ck is not None:
        try:
            net.load_state_dict(ck["model"])
            info.update(loaded=True, step=ck.get("step", 0), iou=ck.get("iou"),
                        iou_nohint=ck.get("iou_nohint"), pairs=ck.get("pairs"),
                        at=ck.get("at"), why=None)
        except Exception as e:
            info["why"] = f"かたちが合いません（{type(e).__name__}: {str(e)[:120]}）"
    net.eval()
    return net, info

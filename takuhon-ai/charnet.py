"""**字を見分ける**小さな分類器（2026-09-21）。

墨（`unet.py`）と枠（`boxnet.py`）は「絵 → 絵」なので U-Net だが、
**読みは「絵 → どの字か」**なので、作りが違う。
畳み込みで縮めていき、最後に **その字である確からしさ**を字の数だけ出す。

入力 1 枚（64×64）
  切り抜いた 1 字。**縦横の比は変えない**（長い方を 64 にして、余りは地で埋める）。
  ここが肝で、正方形に引き伸ばすと **十 と 一 が同じ形**になってしまう
  （彫刻原稿アプリの手本帳で、実際に起きていた読み違い）。

出力
  覚えている字の数だけの点数。高い順に候補として返す。

字の一覧（`chars`）は **重みと一緒にしまう**。あとから字が増えても、
古い版を読んで「どの位置がどの字か」が分かるようにするため。
"""
import torch
import torch.nn as nn

N = 64                     # 切り抜きの 1 辺


def _blk(a, b):
    return nn.Sequential(
        nn.Conv2d(a, b, 3, padding=1, bias=False), nn.BatchNorm2d(b), nn.ReLU(inplace=True),
        nn.Conv2d(b, b, 3, padding=1, bias=False), nn.BatchNorm2d(b), nn.ReLU(inplace=True),
        nn.MaxPool2d(2),
    )


class CharNet(nn.Module):
    def __init__(self, n_cls, base=32):
        super().__init__()
        c = [base, base * 2, base * 4, base * 8]
        self.f = nn.Sequential(_blk(1, c[0]), _blk(c[0], c[1]), _blk(c[1], c[2]), _blk(c[2], c[3]))
        self.head = nn.Sequential(nn.AdaptiveAvgPool2d(1), nn.Flatten(),
                                  nn.Dropout(0.2), nn.Linear(c[3], n_cls))

    def forward(self, x):
        return self.head(self.f(x))


def load_charnet(path, device, base=32):
    """学習済みがあれば読む。無ければ None（字の一覧が分からないと組めないため）。"""
    info = {"loaded": False, "path": str(path), "step": 0, "acc": None, "top3": None,
            "chars": 0, "samples": None, "at": None, "base": base, "why": None}
    try:
        ck = torch.load(path, map_location=device)
    except FileNotFoundError:
        info["why"] = "まだ学習していません"
        return None, info
    except Exception as e:                                   # noqa: BLE001
        info["why"] = f"読めませんでした（{type(e).__name__}: {e}）"
        return None, info
    chars = list(ck.get("chars") or [])
    if not chars:
        info["why"] = "字の一覧が入っていません"
        return None, info
    net = CharNet(len(chars), base=int(ck.get("base", base))).to(device)
    try:
        net.load_state_dict(ck["model"])
    except Exception as e:                                   # noqa: BLE001
        info["why"] = f"かたちが合いません（{type(e).__name__}: {str(e)[:120]}）"
        return None, info
    net.eval()
    info.update(loaded=True, step=ck.get("step", 0), acc=ck.get("acc"), top3=ck.get("top3"),
                chars=len(chars), samples=ck.get("samples"), at=ck.get("at"),
                base=int(ck.get("base", base)), why=None, char_list="".join(chars))
    return (net, chars), info


@torch.no_grad()
def guess(pair, x, top=5):
    """候補を高い順に返す。x は (1,1,64,64) の tensor。"""
    net, chars = pair
    p = torch.softmax(net(x), dim=1)[0]
    k = min(top, len(chars))
    v, i = torch.topk(p, k)
    return [{"ch": chars[int(i[j])], "p": round(float(v[j]), 4)} for j in range(k)]

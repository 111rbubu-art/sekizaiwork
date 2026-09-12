"""②「整える」の学習データを、フォントから自動で作る。

  python3 make_synth.py --font /path/to/楷書体.ttf --n 2000

作るもの（1 組）
  mask.png   **正解**。フォントを崩した字。**角は立っている**
  raw.png    **入力**。それをさらに劣化させた字（角が丸い・欠け・かすれ）
  hint1.png  崩していない、そのままのフォントの字（どの字・どの書体かの手がかり）
  meta.json  字・崩しと劣化の中身

大事なこと（SPEC-輪郭と補正.md）
  **正解は「崩れたまま、角が立っている字」**。
  フォントそのものを正解にすると、AI は「どの字か当てて、フォントを描き直す」ことを
  覚えてしまい、**彫った職人の癖（画の位置・長さのずれ）を消す**。それは手で変形させるのと
  同じで、拓本時点の正解ではないので合っているか判断できない。

  **劣化で太さを系統的に変えない**。変えると「太さを元に戻す」ことを覚えてしまい、
  拓本の太さを無視するようになる。太さの違いは**崩しの側**（正解にも効く）でつける。

  **太さが変えられるフォント（可変フォント）なら、太さは軸で変える。**
  輪郭を足して太らせると角が丸くなり、はらい・とめの形まで変わってしまう。
  軸で変えれば、その書体を作った人が持っている**本当の形**を、太さごとに学べる。
"""
import argparse
import json
import os
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFont

N = 512                      # 出す大きさ（学習と同じ）
BIG = 1024                   # いったん大きく描いてから縮める（縁をなめらかに）


# ---- 小道具 --------------------------------------------------------------

def blur(a, r):
    """ぼかす（箱ぼかしを 3 回。丸いぼかしに近づく）。r はます。"""
    if r < 0.5:
        return a
    k = max(1, int(round(r)))
    out = a
    for _ in range(3):
        c = np.cumsum(np.pad(out, ((0, 0), (k + 1, k)), mode="edge"), axis=1)
        out = (c[:, 2*k+1:] - c[:, :-(2*k+1)]) / (2*k + 1)
        c = np.cumsum(np.pad(out, ((k + 1, k), (0, 0)), mode="edge"), axis=0)
        out = (c[2*k+1:, :] - c[:-(2*k+1), :]) / (2*k + 1)
    return out


def smooth_noise(h, w, cells, rng):
    """なだらかな雑音（粗い格子を作って、引き伸ばす）。−1〜1。"""
    g = rng.standard_normal((cells + 1, cells + 1)).astype(np.float32)
    im = Image.fromarray(((g * 0.5 + 0.5) * 255).clip(0, 255).astype(np.uint8))
    im = im.resize((w, h), Image.BICUBIC)
    a = np.asarray(im, dtype=np.float32) / 255.0 * 2 - 1
    return a


def warp(a, dx, dy):
    """ずらす（双一次で拾い直す）。dx, dy は ます単位のずれ。"""
    h, w = a.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    sx = np.clip(xx + dx, 0, w - 1.001)
    sy = np.clip(yy + dy, 0, h - 1.001)
    x0 = sx.astype(np.int32); y0 = sy.astype(np.int32)
    fx = sx - x0; fy = sy - y0
    x1 = np.minimum(x0 + 1, w - 1); y1 = np.minimum(y0 + 1, h - 1)
    return (a[y0, x0]*(1-fx)*(1-fy) + a[y0, x1]*fx*(1-fy) +
            a[y1, x0]*(1-fx)*fy     + a[y1, x1]*fx*fy)


def wght_axis(font):
    """太さを変えられるフォント（可変フォント）なら、その軸を返す。

    楷書体で「太さが変えられる」ものは、**その書体を作った人が太さごとに
    本当の形を持っている**。stroke_width で輪郭を足して太らせるのとは別物で、
    足す方は角が丸くなり、はらい・とめの形も崩れる。
    軸があるなら、そちらを使うこと（＝書体の癖をそのまま学べる）。
    """
    try:
        f = ImageFont.truetype(font, 64)
        for i, ax in enumerate(f.get_variation_axes() or []):
            nm = ax.get("name")
            nm = nm.decode("ascii", "ignore") if isinstance(nm, bytes) else str(nm or "")
            if "weight" in nm.lower() or nm in ("ウエイト", "太さ"):
                return {"i": i, "name": nm, "min": float(ax["minimum"]),
                        "max": float(ax["maximum"]), "def": float(ax["default"]),
                        "all": f.get_variation_axes()}
    except Exception:
        pass
    return None


def render(font, ch, size, stroke=0, wght=None, ax=None):
    """字を 1 枚描く（白が墨）。

    wght … 可変フォントの太さ軸の値（あるときは **stroke は使わない**）
    stroke … 輪郭に足す太さ（可変フォントでないときの代わり。角は立ったまま太る）
    """
    im = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(im)
    f = ImageFont.truetype(font, int(size * 0.78))
    if wght is not None and ax is not None:
        vals = [a["default"] for a in ax["all"]]
        vals[ax["i"]] = wght
        f.set_variation_by_axes(vals)
        stroke = 0
    d.text((size//2, size//2), ch, font=f, fill=255, anchor="mm",
           stroke_width=int(stroke), stroke_fill=255)
    return np.asarray(im, dtype=np.float32) / 255.0


def fit_box(a, target, pad=0.06):
    """字を真ん中に、決めた大きさで置き直す（拓本の切り抜きと同じ見え方にする）。"""
    ys, xs = np.nonzero(a > 0.5)
    if not len(xs):
        return np.zeros((target, target), dtype=np.float32)
    x1, x2, y1, y2 = xs.min(), xs.max(), ys.min(), ys.max()
    cut = a[y1:y2+1, x1:x2+1]
    side = max(cut.shape)
    box = np.zeros((side, side), dtype=np.float32)
    oy = (side - cut.shape[0]) // 2
    ox = (side - cut.shape[1]) // 2
    box[oy:oy+cut.shape[0], ox:ox+cut.shape[1]] = cut
    inner = int(target * (1 - pad*2))
    im = Image.fromarray((box*255).astype(np.uint8)).resize((inner, inner), Image.BILINEAR)
    out = np.zeros((target, target), dtype=np.float32)
    o = (target - inner) // 2
    out[o:o+inner, o:o+inner] = np.asarray(im, dtype=np.float32) / 255.0
    return out


# ---- 崩し（＝正解の側。角は立ったまま） -----------------------------------

def quirk(a, rng):
    """職人の癖の代わり。画を少しずらす・伸ばす。**角は立ったまま**。"""
    h, w = a.shape
    amp = rng.uniform(0.006, 0.030) * w          # 0.6〜3.0%
    cells = rng.integers(2, 5)
    dx = smooth_noise(h, w, int(cells), rng) * amp
    dy = smooth_noise(h, w, int(cells), rng) * amp
    a = warp(a, dx, dy)
    # ゆるい伸び縮み（縦横で別々に）
    sx = rng.uniform(0.96, 1.04); sy = rng.uniform(0.96, 1.04)
    im = Image.fromarray((a*255).clip(0, 255).astype(np.uint8))
    im = im.resize((int(w*sx), int(h*sy)), Image.BILINEAR)
    b = np.zeros((h, w), dtype=np.float32)
    cw, ch2 = min(w, im.size[0]), min(h, im.size[1])
    src = np.asarray(im, dtype=np.float32)[:ch2, :cw] / 255.0
    b[(h-ch2)//2:(h-ch2)//2+ch2, (w-cw)//2:(w-cw)//2+cw] = src
    return (b > 0.5).astype(np.float32), {"amp": round(float(amp), 2),
                                          "sx": round(float(sx), 3), "sy": round(float(sy), 3)}


# ---- 劣化（＝入力の側。太さは系統的に変えない） ---------------------------

def degrade(a, rng):
    """拓本を採ったときの荒れ・石の劣化を真似る。

    **太さは系統的に変えない**。角を丸める・縁を波打たせる・欠けさせる・かすれさせる。
    """
    h, w = a.shape
    rep = {}
    # ① 角を丸める。ぼかしてから切る。
    #    **0.5 で切ってはいけない**。ぼかしてから 0.5 で切ると、細い画ほど痩せて
    #    入力が系統的に細くなる（実測で 6% 細かった）。そうすると AI は
    #    「太さを元に戻す」ことを覚え、拓本の太さを無視するようになる。
    #    **面積が変わらない高さで切る**（二分探索）。角は丸まり、太さは保たれる。
    r = rng.uniform(0.010, 0.035) * w
    rep["round"] = round(float(r), 2)
    b = blur(a, r)
    want = float(a.sum()) * float(rng.uniform(0.94, 1.06))   # 太さのばらつきは平均 1
    lo, hi = 0.0, 1.0
    for _ in range(24):
        t = (lo + hi) / 2
        if float((b > t).sum()) > want:
            lo = t
        else:
            hi = t
    thr = (lo + hi) / 2
    rep["thr"] = round(float(thr), 3)
    # ② 縁を波打たせる（なだらかな雑音を足してから切る）
    amp = rng.uniform(0.05, 0.22)
    b = b + smooth_noise(h, w, int(rng.integers(6, 20)), rng) * amp
    rep["wobble"] = round(float(amp), 3)
    b = (b > thr).astype(np.float32)
    # ③ 欠け（**縁に**小さい丸を彫り取る）
    #    置き場所が肝心。字の内側に置くと丸ごと穴が開き、盛り（⑤）と釣り合わない。
    #    **墨の内ぶち**（外に接している墨）に置けば、半分だけ削れる。
    def edges(mm):
        up = np.zeros_like(mm); up[:-1, :] = mm[1:, :]
        dn = np.zeros_like(mm); dn[1:, :] = mm[:-1, :]
        lf = np.zeros_like(mm); lf[:, :-1] = mm[:, 1:]
        rt = np.zeros_like(mm); rt[:, 1:] = mm[:, :-1]
        nb = up + dn + lf + rt
        return (mm > 0.5) & (nb < 4), (mm < 0.5) & (nb > 0)   # 内ぶち, 外ぶち

    def stamp(mm, n, lo, hi, val, inner):
        yy, xx = np.mgrid[0:h, 0:w]
        for _ in range(n):
            ie, oe = edges(mm)
            ys2, xs2 = np.nonzero(ie if inner else oe)
            if not len(xs2):
                break
            k = rng.integers(0, len(xs2))
            cy, cx = ys2[k], xs2[k]
            rr = rng.uniform(lo, hi) * w
            mm[(yy-cy)**2 + (xx-cx)**2 <= rr*rr] = val
        return mm

    chips = int(rng.integers(0, 9))
    b = stamp(b, chips, 0.008, 0.030, 0, True)
    rep["chips"] = chips
    # ④ かすれ（細い帯を抜く）
    fades = int(rng.integers(0, 4))
    for _ in range(fades):
        ang = rng.uniform(0, np.pi)
        cy = rng.uniform(0, h); cx = rng.uniform(0, w)
        yy, xx = np.mgrid[0:h, 0:w]
        d = np.abs((xx-cx)*np.sin(ang) - (yy-cy)*np.cos(ang))
        b[d < rng.uniform(0.004, 0.012) * w] = 0
    rep["fades"] = fades
    # ⑤ 盛り（**外ぶち**に小さい丸が乗る）。欠け・かすれと釣り合わせるため。
    #    減らす劣化だけだと入力が系統的に細くなり、AI が「太さを元に戻す」ことを
    #    覚えてしまう。それは拓本の太さを無視する動き。
    bumps = int(rng.integers(0, 10))
    b = stamp(b, bumps, 0.008, 0.030, 1, False)
    # ⑥ 最後に**面積を目標へ合わせ込む**。
    #    欠け・かすれ・盛りの数を手で調整して釣り合わせるのは当てにならない
    #    （字によって効き方が違う。実測で 0.94〜0.98 の間をさまよった）。
    #    足りなければ外ぶちに盛り、多ければ内ぶちを削る、を収まるまで繰り返す。
    for _ in range(60):
        cur = float(b.sum())
        if cur < want * 0.98:
            b = stamp(b, 1, 0.010, 0.028, 1, False)
        elif cur > want * 1.02:
            b = stamp(b, 1, 0.010, 0.028, 0, True)
        else:
            break
    rep["area"] = round(float(b.sum()) / max(1.0, float(a.sum())), 3)
    rep["bumps"] = bumps
    return b, rep


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--font", required=True, help="彫っている書体の TTF/OTF")
    ap.add_argument("--n", type=int, default=1000)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                                  "dataset", "shape"))
    ap.add_argument("--val", type=int, default=0, help="検証用へ取り分ける組数")
    ap.add_argument("--chars", default="", help="使う字（既定は墓石でよく使う字）")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--no-wght", action="store_true",
                    help="太さの軸を使わない（可変フォントでも、輪郭を足して太らせる）")
    a = ap.parse_args()

    chars = a.chars or (
        "一二三四五六七八九十百千万年月日時分円上下左右大中小山川田中村上口"
        "本木水火土金銀石岩　之助太郎子女男父母祖先代々家墓碑霊位牌　"
        "令和平成昭和大正明治元　院居士信士信女大姉禅定門禅定尼童子童女"
        "俗名享年行年満歳没　建之施主納骨　仁義礼智信忠孝　遠久誉勘")
    chars = [c for c in chars if c.strip()]

    ax = None if a.no_wght else wght_axis(a.font)
    if ax:
        print("太さを変えられるフォントです（%s：%g〜%g）。"
              "**太さは軸で変えます**（輪郭を足して太らせません）。"
              % (ax["name"], ax["min"], ax["max"]))
    else:
        print("太さの軸はありません。太さの違いは輪郭を足して作ります。")

    rng = np.random.default_rng(a.seed)
    prng = random.Random(a.seed)
    os.makedirs(a.out, exist_ok=True)
    made = 0
    for i in range(a.n):
        ch = prng.choice(chars)
        stroke = prng.choice([0, 0, 0, 1, 2, 3])          # 太さの違いは**崩しの側**
        wg = None
        if ax:
            # 軸があるなら、その書体が本当に持っている太さから選ぶ。
            wg = prng.uniform(ax["min"], ax["max"])
            stroke = 0
        try:
            g = render(a.font, ch, BIG, stroke, wg, ax)
        except Exception as e:
            print("描けません:", ch, e); continue
        if g.max() < 0.5:
            continue
        q, qrep = quirk(g, rng)
        tgt = fit_box(q, N)                                # 正解（角は立っている）
        tgt = (tgt > 0.5).astype(np.float32)
        inp, drep = degrade(tgt, rng)                      # 入力（劣化）
        # 手がかりは**同じ太さの**、崩していない字（②の学習では使っていない）
        hint = fit_box(render(a.font, ch, BIG, 0, wg, ax), N)
        hint = (hint > 0.5).astype(np.float32)
        if tgt.sum() < 200 or inp.sum() < 100:
            continue
        d = os.path.join(a.out, "syn_%05d" % i)
        os.makedirs(d, exist_ok=True)
        Image.fromarray((inp*255).astype(np.uint8)).save(os.path.join(d, "raw.png"))
        Image.fromarray((tgt*255).astype(np.uint8)).save(os.path.join(d, "mask.png"))
        Image.fromarray((hint*255).astype(np.uint8)).save(os.path.join(d, "hint1.png"))
        with open(os.path.join(d, "meta.json"), "w", encoding="utf-8") as f:
            json.dump({"char": ch, "synth": True, "stroke": stroke,
                       "wght": (round(wg, 1) if wg is not None else None),
                       "quirk": qrep, "degrade": drep,
                       "font": os.path.basename(a.font)}, f, ensure_ascii=False, indent=1)
        made += 1
        if made % 100 == 0:
            print("…", made, "組")
    print("%d 組を作りました → %s" % (made, a.out))

    if a.val > 0:
        import shutil
        vdir = a.out + "_val"
        os.makedirs(vdir, exist_ok=True)
        ds = sorted(d for d in os.listdir(a.out) if os.path.isdir(os.path.join(a.out, d)))
        prng.shuffle(ds)
        for d in ds[:a.val]:
            shutil.move(os.path.join(a.out, d), os.path.join(vdir, d))
        print("検証用に %d 組を移しました → %s" % (min(a.val, len(ds)), vdir))


if __name__ == "__main__":
    main()

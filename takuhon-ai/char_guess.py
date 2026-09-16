"""拓本の墨から「どの字か」の候補を出し、当たり具合を測る。

  python3 char_guess.py --font fonts/楷書体.ttf                 貯まった組で測る
  python3 char_guess.py --font ... --set val --topk 8

考え方
  彫ってある字は、持っているフォントの字形と**形が似ている**。
  そこで、フォントに入っている字をぜんぶ同じ大きさで起こし、
  拓本から拾った墨と重ねて、よく合ったものを上位から並べる。

  **OCR は使わない。** 石の地・かすれ・楷書や隷書は印刷とはちがい、
  読み違えたまま静かに登録されるのがいちばん困る。
  こちらは持っている字形と見くらべるだけなので、
  **フォントに入っている旧字・異体字はそのまま候補に出る**。

  当たり具合は「正解が上位 K に入っていた割合」で見る。
  人は候補から 1 つ押すだけなので、**1 位でなくてよい**。
"""
import argparse
import json
import os
import struct
import sys

import numpy as np
from PIL import Image, ImageFont

ROOT = os.path.dirname(os.path.abspath(__file__))
G = 64                        # 見くらべる大きさ（ます）


# ---- フォントに入っている字を拾う（cmap を自分で読む）--------------------
# fontTools を足したくないので、必要な所だけ読む。
# format 4（BMP）と format 12（追加面）で、いまどきのフォントはほぼ足りる。

def _cmap_tables(b):
    if b[:4] == b"ttcf":                       # ttc は 1 つめのフォントを見る
        off = struct.unpack(">I", b[12:16])[0]
    else:
        off = 0
    num = struct.unpack(">H", b[off+4:off+6])[0]
    for i in range(num):
        p = off + 12 + i*16
        tag = b[p:p+4]
        if tag == b"cmap":
            return struct.unpack(">I", b[p+8:p+12])[0]
    return None


def font_chars(path):
    """そのフォントが持っている文字（コードポイント）を返す。"""
    with open(path, "rb") as f:
        b = f.read()
    c0 = _cmap_tables(b)
    if c0 is None:
        return []
    n = struct.unpack(">H", b[c0+2:c0+4])[0]
    best = None
    for i in range(n):
        p = c0 + 4 + i*8
        pid, eid = struct.unpack(">HH", b[p:p+4])
        sub = c0 + struct.unpack(">I", b[p+4:p+8])[0]
        fmt = struct.unpack(">H", b[sub:sub+2])[0]
        # format 12 を優先（追加面まで入る）。次に format 4。
        rank = 2 if fmt == 12 else (1 if fmt == 4 else 0)
        if rank and (best is None or rank > best[0]):
            best = (rank, sub, fmt)
    if not best:
        return []
    _, sub, fmt = best
    out = set()
    if fmt == 4:
        segX2 = struct.unpack(">H", b[sub+6:sub+8])[0]
        seg = segX2 // 2
        endo = sub + 14
        starto = endo + segX2 + 2
        deltao = starto + segX2
        rangeo = deltao + segX2
        for s in range(seg):
            end = struct.unpack(">H", b[endo+s*2:endo+s*2+2])[0]
            sta = struct.unpack(">H", b[starto+s*2:starto+s*2+2])[0]
            delta = struct.unpack(">h", b[deltao+s*2:deltao+s*2+2])[0]
            ro = struct.unpack(">H", b[rangeo+s*2:rangeo+s*2+2])[0]
            if sta == 0xFFFF:
                continue
            for c in range(sta, min(end, 0xFFFE) + 1):
                if ro == 0:
                    gid = (c + delta) & 0xFFFF
                else:
                    gp = rangeo + s*2 + ro + (c - sta)*2
                    if gp + 2 > len(b):
                        continue
                    gid = struct.unpack(">H", b[gp:gp+2])[0]
                    if gid:
                        gid = (gid + delta) & 0xFFFF
                if gid:
                    out.add(c)
    else:
        ng = struct.unpack(">I", b[sub+12:sub+16])[0]
        for i in range(ng):
            p = sub + 16 + i*12
            sta, end, _gid = struct.unpack(">III", b[p:p+12])
            if end - sta > 0x20000:
                continue
            for c in range(sta, end + 1):
                out.add(c)
    return sorted(out)


def is_kanji(c):
    return (0x4E00 <= c <= 0x9FFF or 0x3400 <= c <= 0x4DBF or
            0xF900 <= c <= 0xFAFF or 0x20000 <= c <= 0x2A6DF or
            0x3040 <= c <= 0x30FF)          # かなも入れておく（○○家 の ヶ など）


# ---- 形をそろえる ---------------------------------------------------------

def norm(a):
    """墨を、枠いっぱいの G×G に置き直す（大きさと位置の違いを消す）。"""
    ys, xs = np.nonzero(a > 0.5)
    if not len(ys):
        return None
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    im = Image.fromarray((a[y0:y1+1, x0:x1+1] * 255).astype(np.uint8))
    im = im.resize((G, G), Image.BILINEAR)
    return (np.asarray(im, dtype=np.float32) / 255.0 > 0.5).astype(np.float32)


def render_char(path, ch, size=256):
    im = Image.new("L", (size, size), 0)
    from PIL import ImageDraw
    d = ImageDraw.Draw(im)
    f = ImageFont.truetype(path, int(size * 0.8))
    d.text((size//2, size//2), ch, font=f, fill=255, anchor="mm")
    return np.asarray(im, dtype=np.float32) / 255.0


def build_bank(path, chars):
    """フォントの字を、ぜんぶ同じ形にそろえて並べる。"""
    keep, bank = [], []
    for c in chars:
        a = render_char(path, chr(c))
        n = norm(a)
        if n is None:
            continue
        keep.append(c)
        bank.append(n.reshape(-1))
    return keep, np.asarray(bank, dtype=np.float32)


def guess(mask, keep, bank, topk=8):
    """墨に近い字を、上位から返す。重なり（IoU）で見る。"""
    q = norm(mask)
    if q is None:
        return []
    v = q.reshape(-1)
    inter = bank @ v
    union = bank.sum(1) + v.sum() - inter
    iou = inter / np.maximum(union, 1e-6)
    idx = np.argsort(-iou)[:topk]
    return [(chr(keep[i]), float(iou[i])) for i in idx]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--font", required=True)
    ap.add_argument("--set", default="pairs", help="pairs / val")
    ap.add_argument("--topk", type=int, default=8)
    ap.add_argument("--limit", type=int, default=0, help="この組数だけ見る（0=ぜんぶ）")
    a = ap.parse_args()

    d0 = os.path.join(ROOT, "dataset", a.set)
    if not os.path.isdir(d0):
        print("そんな入れ物はありません:", d0); sys.exit(1)

    chars = [c for c in font_chars(a.font) if is_kanji(c)]
    print("フォントの字：%d 字（漢字・かな）" % len(chars))
    if not chars:
        print("フォントから字を読めませんでした。"); sys.exit(1)
    keep, bank = build_bank(a.font, chars)
    print("見くらべる形：%d 字ぶん 用意しました" % len(keep))

    rows, hit1, hitk, n = [], 0, 0, 0
    for nm in sorted(os.listdir(d0)):
        d = os.path.join(d0, nm)
        mp = os.path.join(d, "mask.png")
        if not os.path.isdir(d) or not os.path.exists(mp):
            continue
        meta = {}
        try:
            meta = json.load(open(os.path.join(d, "meta.json"), encoding="utf-8"))
        except Exception:
            pass
        ans = (meta.get("char") or "").strip()
        if not ans:
            continue                          # 答えが無い組は測れない
        m = np.asarray(Image.open(mp).convert("L"), dtype=np.float32) / 255.0
        got = guess(m, keep, bank, a.topk)
        names = [g[0] for g in got]
        ok1 = bool(names and names[0] == ans)
        okk = ans in names
        hit1 += ok1; hitk += okk; n += 1
        rows.append((nm, ans, names, [round(g[1], 3) for g in got], ok1, okk))
        if a.limit and n >= a.limit:
            break

    if not n:
        print("測れる組がありません（meta.json に char がある組が要ります）。"); return
    print()
    print("組ごとの結果 ------------------------------------------------")
    for nm, ans, names, ious, ok1, okk in rows:
        mark = "◎" if ok1 else ("○" if okk else "×")
        print("%s %-28s 正解 %s ／ 候補 %s" %
              (mark, nm[:28], ans, " ".join("%s(%.2f)" % (c, v) for c, v in zip(names, ious))))
    print()
    print("まとめ ------------------------------------------------------")
    print("測った組        ： %d" % n)
    print("1 位で当たった   ： %d ／ %d （%.0f%%）" % (hit1, n, 100.0*hit1/n))
    print("上位 %d に入った  ： %d ／ %d （%.0f%%）" % (a.topk, hitk, n, 100.0*hitk/n))


if __name__ == "__main__":
    main()

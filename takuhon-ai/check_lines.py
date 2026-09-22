"""**貯まった列（教材）と、枠のモデルを点検する**（2026-09-22）。

  python3 check_lines.py            … 教材を点検して、おかしい列を挙げる
  python3 check_lines.py --sheet    … 1 列ずつ 枠を描いた絵を runs/check_lines/ に書き出す
  python3 check_lines.py --model    … いまの枠モデルで、ぜんぶの列の当たり具合を測る

見るところ
  ・枠が絵からはみ出していないか（登録のときに切り抜きと枠が食いちがうと こうなる）
  ・字の大きさが切り抜きの幅に対して とんでもない割合になっていないか
  ・墨（ink.png）があるか。墨の割合が 0% や 90% になっていないか
  ・列の中で、枠が重なりすぎていないか／字送りがばらばらでないか
  ・同じ絵が二重に入っていないか
"""
import argparse
import hashlib
import json
import os

import numpy as np
from PIL import Image, ImageDraw

import boxdata as B

ROOT = os.path.dirname(os.path.abspath(__file__))
LINES = os.path.join(ROOT, "dataset", "lines")
OUT = os.path.join(ROOT, "runs", "check_lines")


def _med(v):
    return float(np.median(v)) if len(v) else 0.0


def one(d):
    """1 列を点検して、数字と気になる点を返す。"""
    r = {"id": os.path.basename(d), "bad": [], "warn": []}
    try:
        with open(os.path.join(d, "meta.json"), encoding="utf-8") as f:
            m = json.load(f)
    except (OSError, ValueError) as e:
        r["bad"].append("meta.json が読めません（%s）" % e)
        return r
    try:
        im = Image.open(os.path.join(d, "raw.png")).convert("L")
    except OSError as e:
        r["bad"].append("raw.png が読めません（%s）" % e)
        return r
    W, H = im.size
    bx = m.get("boxes") or []
    r.update(w=W, h=H, n=len(bx), chars=m.get("chars", ""), at=m.get("at", ""),
             off=os.path.exists(os.path.join(d, "off")), note=m.get("note", ""))
    if not bx:
        r["bad"].append("枠がありません")
        return r
    # 絵の中身（まっさら／まっくろでないか）
    a = np.asarray(im, dtype=np.float32) / 255.0
    r["imgStd"] = round(float(a.std()), 3)
    if a.std() < 0.03:
        r["bad"].append("絵に濃淡がありません（まっさら／まっくろ）")
    # 枠のはみ出し
    out = 0
    ws, hs, cys = [], [], []
    for b in bx:
        try:
            x, y, w, h = float(b["x"]), float(b["y"]), float(b["w"]), float(b["h"])
        except (KeyError, TypeError, ValueError):
            r["bad"].append("枠の形がおかしい（x,y,w,h が読めない）")
            continue
        if x < -2 or y < -2 or x + w > W + 2 or y + h > H + 2:
            out += 1
        ws.append(w); hs.append(h); cys.append(y + h / 2)
    r["out"] = out
    if out:
        r["bad"].append("%d / %d 枠が 絵からはみ出しています" % (out, len(bx)))
    # 字の大きさ（切り抜きの幅に対する割合）。学習は 0.8 くらいを想定
    r["wRatio"] = round(_med(ws) / max(1, W), 2)
    r["hRatio"] = round(_med(hs) / max(1, W), 2)
    if not (0.35 <= r["wRatio"] <= 1.25):
        r["warn"].append("字の幅が 切り抜きの %.2f 倍（ふつうは 0.6〜1.0）" % r["wRatio"])
    if not (0.3 <= r["hRatio"] <= 1.6):
        r["warn"].append("字の高さが 切り抜きの %.2f 倍" % r["hRatio"])
    # 字送りのばらつき
    cys.sort()
    if len(cys) > 2:
        pit = np.diff(cys)
        r["pitch"] = round(float(np.median(pit)), 1)
        r["pitchSpread"] = round(float(pit.std() / max(1e-6, np.median(pit))), 2)
        if r["pitchSpread"] > 0.5:
            r["warn"].append("字送りがばらばら（ばらつき %.2f）" % r["pitchSpread"])
    # 重なり
    ov = 0
    for i in range(len(bx)):
        for j in range(i + 1, len(bx)):
            a1, b1 = bx[i], bx[j]
            x1 = max(a1["x"], b1["x"]); y1 = max(a1["y"], b1["y"])
            x2 = min(a1["x"] + a1["w"], b1["x"] + b1["w"])
            y2 = min(a1["y"] + a1["h"], b1["y"] + b1["h"])
            if x2 > x1 and y2 > y1:
                inter = (x2 - x1) * (y2 - y1)
                if inter > 0.5 * min(a1["w"] * a1["h"], b1["w"] * b1["h"]):
                    ov += 1
    r["overlap"] = ov
    if ov:
        r["warn"].append("%d 組の枠が半分以上 重なっています" % ov)
    # 墨
    ip = os.path.join(d, "ink.png")
    if os.path.exists(ip):
        ik = np.asarray(Image.open(ip).convert("L"), dtype=np.float32) / 255.0
        r["ink"] = round(float((ik > 0.5).mean()) * 100, 1)
        if r["ink"] < 1:
            r["bad"].append("墨が空です（%.1f%%）。彫刻原稿 v35.3 より前に登録した列は "
                            "墨が入っていません（青い墨を白黒に直せていなかった）。"
                            "登録し直してください" % r["ink"])
        if r["ink"] > 80:
            r["warn"].append("墨が多すぎます（%.1f%%）" % r["ink"])
    else:
        r["ink"] = None
        r["warn"].append("墨（ink.png）がありません")
    # 読み
    r["read"] = sum(1 for b in bx if (b.get("ch") or "").strip())
    # 絵の指紋（二重登録の見つけ用）
    r["sig"] = hashlib.md5(np.asarray(im.resize((32, 96))).tobytes()).hexdigest()[:10]
    return r


def sheet(d, r):
    """枠を描いた絵を書き出す（目で見て確かめる用）。"""
    os.makedirs(OUT, exist_ok=True)
    im = Image.open(os.path.join(d, "raw.png")).convert("RGB")
    dr = ImageDraw.Draw(im)
    try:
        with open(os.path.join(d, "meta.json"), encoding="utf-8") as f:
            bx = (json.load(f).get("boxes") or [])
    except (OSError, ValueError):
        bx = []
    for i, b in enumerate(bx):
        try:
            x, y, w, h = float(b["x"]), float(b["y"]), float(b["w"]), float(b["h"])
        except (KeyError, TypeError, ValueError):
            continue
        dr.rectangle([x, y, x + w, y + h], outline=(255, 0, 160), width=2)
        dr.text((x + 2, y + 2), str(i + 1), fill=(255, 0, 160))
    f = os.path.join(OUT, r["id"] + ".png")
    im.save(f)
    return f


def model_check(items):
    """いまの枠モデルで、ぜんぶの列の当たり具合を測る（学習に使った分も含む）。"""
    import torch
    from boxnet import load_boxnet
    from train_box import val_f1
    pair, info = load_boxnet(os.path.join(ROOT, "runs", "box_current.pth"),
                             torch.device("cuda" if torch.cuda.is_available() else "cpu"))
    if not info.get("loaded"):
        print("枠のモデルがありません（%s）" % info.get("why"))
        return
    print("モデル: F1 %s／%s 列で学習／%s" % (info.get("f1"), info.get("lines"), info.get("at")))
    dev = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    f1, pr, rc = val_f1(pair, items, dev)
    print("いま貯まっている ぜんぶの列での当たり具合: F1 %.3f（当たりの正しさ %.3f／取りこぼしの無さ %.3f）"
          % (f1 or 0, pr or 0, rc or 0))
    print("※ 学習に使った列も混ざっているので、ふつうは検証の数字より良く出ます。"
          "それでも低いなら、教材かモデルに問題があります。")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=LINES)
    ap.add_argument("--sheet", action="store_true", help="枠を描いた絵を書き出す")
    ap.add_argument("--model", action="store_true", help="いまのモデルで当たり具合も測る")
    a = ap.parse_args()

    ds = sorted(os.path.join(a.dir, x) for x in os.listdir(a.dir)
                if os.path.isdir(os.path.join(a.dir, x))) if os.path.isdir(a.dir) else []
    if not ds:
        print("列がありません（%s）" % a.dir)
        return
    rows = [one(d) for d in ds]
    print("＝＝ 貯まった列 %d 本 ＝＝" % len(rows))
    print("%-26s %-11s %6s %5s %4s %6s %6s %6s %5s %s" %
          ("名前", "登録した日", "大きさ", "字数", "読み", "幅比", "高比", "墨%", "はみ出", "気になる点"))
    sig = {}
    for r in rows:
        if "w" not in r:
            print("%-28s  %s" % (r["id"], "／".join(r["bad"])))
            continue
        sig.setdefault(r.get("sig"), []).append(r["id"])
        print("%-26s %-11s %3dx%-4d %4d %4d %6s %6s %6s %5d %s%s" %
              (r["id"][:26], str(r.get("at", ""))[:10], r["w"], r["h"], r["n"], r["read"],
               r.get("wRatio"), r.get("hRatio"),
               ("—" if r.get("ink") is None else r["ink"]), r.get("out", 0),
               "【要確認】" if r["bad"] else "", "／".join(r["bad"] + r["warn"])))
    # **2026-09-22 の朝より前に登録した列は、切り抜きが「回す前の絵」のことがある**
    # （彫刻原稿 v34.8 で直した不具合。絵と枠が食いちがう）。日付で目印を出す。
    old = [r["id"] for r in rows if str(r.get("at", "")) < "2026-09-22T10"]
    if old:
        print("\n■ 2026-09-22 午前より前に登録した列が %d 本あります:" % len(old))
        print("   " + "、".join(old[:12]) + ("…" if len(old) > 12 else ""))
        print("   彫刻原稿 v34.8 より前は、拓本を回していると**切り抜きだけ回す前の絵**")
        print("   （＝絵と枠が食いちがう）ことがありました。［サーバーに貯まった分］で")
        print("   見て、さかさま・ずれているものは 消して 登録し直してください。")
    dup = {k: v for k, v in sig.items() if len(v) > 1}
    if dup:
        print("\n■ 同じ絵が二重に入っています:")
        for v in dup.values():
            print("   " + " ＝ ".join(v))
    nbad = sum(1 for r in rows if r["bad"])
    nwarn = sum(1 for r in rows if r["warn"] and not r["bad"])
    print("\n■ まとめ: 要確認 %d 本／気になる %d 本／よさそう %d 本"
          % (nbad, nwarn, len(rows) - nbad - nwarn))
    if nbad:
        print("   要確認の列は、彫刻原稿アプリの［🔍 登録した字枠を見る］→［サーバーに貯まった分］で")
        print("   見て、おかしければ ⛔（学習から外す）か 🗑（消す）にしてください。")
    if a.sheet:
        n = 0
        for d, r in zip(ds, rows):
            if "w" in r:
                sheet(d, r); n += 1
        print("\n■ 枠を描いた絵を %d 枚 書き出しました: %s" % (n, OUT))
    if a.model:
        items = [x for x in (B.load_line(d) for d in ds) if x]
        print()
        model_check(items)


if __name__ == "__main__":
    main()

"""共有フォルダーの ZIP を dataset/pairs へ展開する。

  python3 import_pairs.py ~/Downloads/拓本学習データ            フォルダーの中の ZIP を全部
  python3 import_pairs.py takuhon_pairs_20260910.zip           まとめ書き出しの ZIP も可
  python3 import_pairs.py <どちらか> --val 10                  10 組を検証用へ取り分ける

彫刻原稿アプリが出す ZIP は 2 通り。どちらも読む。
  ① 1 文字＝1 つ    raw.png / mask.png / hint1.png / hint2.png / meta.json
  ② まとめ書き出し  pairs/pair_00001_raw.png … の並び
"""
import argparse
import json
import os
import random
import shutil
import sys
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
PAIRS = os.path.join(ROOT, "dataset", "pairs")
VAL = os.path.join(ROOT, "dataset", "val")


def put(dst_dir, name, blob):
    os.makedirs(dst_dir, exist_ok=True)
    with open(os.path.join(dst_dir, name), "wb") as f:
        f.write(blob)


def take_zip(path):
    """ZIP を 1 つ読んで、作った組の名前を返す。"""
    made = set()
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        flat = [n for n in names if n.startswith("pairs/") and not n.endswith("/")]
        if flat:                                   # ② まとめ書き出し
            for n in flat:
                base = os.path.basename(n)
                if "_" not in base:
                    continue
                pid, part = base.split("_", 2)[0] + "_" + base.split("_")[1], base.split("_", 2)[-1]
                put(os.path.join(PAIRS, pid), part, z.read(n))
                made.add(pid)
        else:                                      # ① 1 文字＝1 つ
            pid = os.path.splitext(os.path.basename(path))[0]
            for n in names:
                b = os.path.basename(n)
                if b in ("raw.png", "mask.png", "hint1.png", "hint2.png", "meta.json"):
                    put(os.path.join(PAIRS, pid), b, z.read(n))
                    made.add(pid)
    return made


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src", help="ZIP か、ZIP の入ったフォルダー")
    ap.add_argument("--val", type=int, default=0, help="検証用へ取り分ける組数")
    a = ap.parse_args()

    zips = []
    if os.path.isdir(a.src):
        for n in sorted(os.listdir(a.src)):
            if n.lower().endswith(".zip"):
                zips.append(os.path.join(a.src, n))
    elif a.src.lower().endswith(".zip"):
        zips = [a.src]
    if not zips:
        print("ZIP が見つかりません:", a.src); sys.exit(1)

    made = set()
    for z in zips:
        try:
            made |= take_zip(z)
        except Exception as e:
            print("読めませんでした:", z, e)
    print(f"{len(zips)} 個の ZIP から {len(made)} 組を入れました → {PAIRS}")

    if a.val > 0:
        os.makedirs(VAL, exist_ok=True)
        have = [d for d in sorted(os.listdir(PAIRS)) if os.path.isdir(os.path.join(PAIRS, d))]
        rng = random.Random(0)
        rng.shuffle(have)
        moved = 0
        for d in have:
            if moved >= a.val:
                break
            shutil.move(os.path.join(PAIRS, d), os.path.join(VAL, d))
            moved += 1
        print(f"検証用に {moved} 組を移しました → {VAL}（この分は学習に使いません）")

    n = len([d for d in os.listdir(PAIRS) if os.path.isdir(os.path.join(PAIRS, d))]) if os.path.isdir(PAIRS) else 0
    v = len([d for d in os.listdir(VAL) if os.path.isdir(os.path.join(VAL, d))]) if os.path.isdir(VAL) else 0
    print(f"いま 学習 {n} 組 ／ 検証 {v} 組")


if __name__ == "__main__":
    main()

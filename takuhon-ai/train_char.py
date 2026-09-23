"""**読み**の学習（2026-09-21）。

  python3 train_char.py --epochs 60

やっていること
  1. dataset/lines（登録した列の、読みのついた枠）と dataset/chars（手本帳）から集める
  2. **字ごとに 1 枚以上を検証に取り分ける**（学習には使わない）
  3. 当たり具合（いちばん上が合っていた割合＝acc、上位 3 つに入っていた割合＝top3）で測る
  4. 良くなったときだけ runs/char_current.pth を差し替える
  5. 世代は runs/char_YYYYmmdd-HHMM.pth に残す

**2 枚しかない字は学習に入れない**（覚えようがなく、検証も取れないため）。
"""
import argparse
import json
import os
import random
import shutil
import time
from collections import defaultdict
from datetime import datetime

import numpy as np
import torch
import torch.nn as nn

import chardata as C
from charnet import CharNet

ROOT = os.path.dirname(os.path.abspath(__file__))
LINES = os.path.join(ROOT, "dataset", "lines")
CHARS = os.path.join(ROOT, "dataset", "chars")
RUNS = os.path.join(ROOT, "runs")
CURRENT = os.path.join(RUNS, "char_current.pth")
PROGRESS = os.path.join(RUNS, "progress_char.json")
CURVE = os.path.join(RUNS, "curve_char.jsonl")


def put_progress(**kw):
    """いまの様子を runs/progress_*.json に置く。

    **pid と state="running" を必ず入れる**（2026-09-22 の実測で必要と分かった）。
    サーバーの `_running()` は「pid が合っていて state が running」で走行中とみなす。
    これが無いと、画面には いつまでも「はじめています…」としか出なかった。
    """
    try:
        kw.setdefault("pid", os.getpid())
        kw["at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        os.makedirs(RUNS, exist_ok=True)
        with open(PROGRESS, "w", encoding="utf-8") as f:
            json.dump(kw, f, ensure_ascii=False, indent=1)
    except OSError:
        pass


def put_curve(rec, fresh=False):
    try:
        with open(CURVE, "w" if fresh else "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except OSError:
        pass


@torch.no_grad()
def score(net, items, chars, device, bs=64):
    """当たり具合。acc＝いちばん上が合っていた割合、top3＝上位 3 つに入っていた割合。"""
    if not items:
        return None, None
    net.eval()
    idx = {c: i for i, c in enumerate(chars)}
    ok1 = ok3 = 0
    for i in range(0, len(items), bs):
        part = items[i:i + bs]
        x = torch.from_numpy(np.stack([a[None] for a, _ in part])).to(device)
        y = [idx[c] for _, c in part]
        p = net(x)
        t3 = torch.topk(p, min(3, len(chars)), dim=1).indices.cpu().numpy()
        for j, want in enumerate(y):
            if t3[j][0] == want:
                ok1 += 1
            if want in t3[j]:
                ok3 += 1
    n = len(items)
    return ok1 / n, ok3 / n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--bs", type=int, default=32)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--base", type=int, default=32)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--lines", default="", help="列の置き場（既定 dataset/lines）")
    ap.add_argument("--chars", default="", help="手本帳の置き場（既定 dataset/chars）")
    ap.add_argument("--min-per-char", type=int, default=3,
                    help="この枚数に満たない字は学習に入れない")
    ap.add_argument("--note", default="")
    ap.add_argument("--fresh", action="store_true")
    ap.add_argument("--no-swap", dest="no_swap", action="store_true")
    a = ap.parse_args()

    os.makedirs(RUNS, exist_ok=True)
    rng = random.Random(a.seed)
    torch.manual_seed(a.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    got = C.from_lines(a.lines or LINES) + C.from_chars(a.chars or CHARS)
    by = defaultdict(list)
    for img, ch in got:
        by[ch].append(img)
    chars = sorted([c for c, v in by.items() if len(v) >= a.min_per_char])
    if len(chars) < 2:
        print("学習できる字が %d しかありません（1 字につき %d 枚以上が要ります）。"
              "彫刻原稿アプリで［この列を AI に登録］と 手本帳の［控える］を回してください。"
              % (len(chars), a.min_per_char))
        put_progress(state="few", chars=len(chars), need=a.min_per_char,
                     have={c: len(v) for c, v in sorted(by.items())})
        return
    tr, va = [], []
    for c in chars:
        v = by[c][:]
        rng.shuffle(v)
        k = max(1, int(len(v) * 0.15))
        va += [(x, c) for x in v[:k]]
        tr += [(x, c) for x in v[k:]]
    print("字 %d 種／学習 %d 枚・検証 %d 枚　%s" % (len(chars), len(tr), len(va), device))
    print("　" + "・".join("%s%d" % (c, len(by[c])) for c in chars))

    net = CharNet(len(chars), base=a.base).to(device)
    step, best = 0, -1.0
    base0 = None                                     # 前のモデルの 今回の検証用での点
    nswap = 0
    if not a.fresh and os.path.exists(CURRENT):
        try:
            ck = torch.load(CURRENT, map_location=device)
            if list(ck.get("chars") or []) == chars and int(ck.get("base", a.base)) == a.base:
                net.load_state_dict(ck["model"])
                step, old = ck.get("step", 0), float(ck.get("acc") or -1)
                # 前のモデルを **今回の検証用で測り直す**（2026-09-23。枠の学習と同じ直し）
                a0 = score(net, va, chars, device)[0]
                best = -1.0 if a0 is None else a0
                base0 = a0
                print("続きから（step %d・前回の当たり %.3f → 今回の検証用で %s）" %
                      (step, old, "―" if a0 is None else "%.3f" % a0))
            else:
                print("字の顔ぶれが変わったので、はじめから学習します。")
        except Exception as e:                               # noqa: BLE001
            print("前の重みは読めませんでした:", e)
    opt = torch.optim.Adam(net.parameters(), lr=a.lr)
    lossf = nn.CrossEntropyLoss(label_smoothing=0.05)
    idx = {c: i for i, c in enumerate(chars)}
    put_curve({"ep": 0, "start": True, "chars": len(chars), "n": len(tr)}, fresh=True)

    for ep in range(1, a.epochs + 1):
        net.train()
        t0, tot, nb = time.time(), 0.0, 0
        order = list(range(len(tr)))
        rng.shuffle(order)
        for i in range(0, len(order), a.bs):
            part = [tr[j] for j in order[i:i + a.bs]]
            x = torch.from_numpy(np.stack([C.augment(img, rng)[None] for img, _ in part])).to(device)
            y = torch.tensor([idx[c] for _, c in part], device=device)
            loss = lossf(net(x), y)
            opt.zero_grad(); loss.backward(); opt.step()
            tot += float(loss.detach()); nb += 1; step += 1
        acc, top3 = score(net, va, chars, device)
        rec = {"ep": ep, "loss": round(tot / max(1, nb), 4),
               "acc": None if acc is None else round(acc, 4),
               "top3": None if top3 is None else round(top3, 4),
               "sec": round(time.time() - t0, 1)}
        put_curve(rec)
        put_progress(state="running", epochs=a.epochs, step=step, best=round(best, 4),
                     chars=len(chars), n=len(tr), **rec)
        print("ep %3d  loss %.4f  当たり %s  上位3 %s  (%.1fs)" %
              (ep, rec["loss"], rec["acc"], rec["top3"], rec["sec"]))
        if acc is not None and acc > best:
            best = acc
            ck = {"model": net.state_dict(), "base": a.base, "step": step, "chars": chars,
                  "acc": round(acc, 4), "top3": round(top3, 4), "samples": len(tr),
                  "note": a.note, "at": datetime.now().isoformat(timespec="seconds")}
            gen = os.path.join(RUNS, "char_%s.pth" % datetime.now().strftime("%Y%m%d-%H%M"))
            torch.save(ck, gen)
            if not a.no_swap:
                shutil.copyfile(gen, CURRENT)
                print("  → 差し替えました（当たり %.3f）" % acc)
                nswap += 1
    put_progress(state="done", best=round(best, 4), chars=len(chars), epochs=a.epochs,
                 swapped=nswap, base=None if base0 is None else round(base0, 4))
    print("おわり。いちばん良かった 当たり = %.3f" % best)


if __name__ == "__main__":
    main()

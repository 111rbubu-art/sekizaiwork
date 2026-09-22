"""**枠を出す AI** の学習（2026-09-21）。

  python3 train_box.py --epochs 80

やっていること
  1. dataset/lines（彫刻原稿アプリの［この列を AI に登録］で貯めた列）から学習
  2. 1 割（少なくとも 1 列）は**検証用に取り分ける**。学習には使わない
  3. 検証は **枠の当たり具合（F1）** で測る。
     人が直した枠と、AI が出した枠を突き合わせ、重なり（IoU）0.5 以上を「当たり」とする
  4. 良くなったときだけ runs/box_current.pth を差し替える（悪くなったら据え置き）
  5. 世代は runs/box_YYYYmmdd-HHMM.pth として必ず残す

`train.py`（墨の学習）とは**別物**。あちらは触らない。
"""
import argparse
import json
import os
import random
import shutil
import time
from datetime import datetime

import numpy as np
import torch
import torch.nn as nn

import boxdata as B
from boxnet import BoxNet, find_boxes

ROOT = os.path.dirname(os.path.abspath(__file__))
LINES = os.path.join(ROOT, "dataset", "lines")
RUNS = os.path.join(ROOT, "runs")
CURRENT = os.path.join(RUNS, "box_current.pth")
PROGRESS = os.path.join(RUNS, "progress_box.json")
CURVE = os.path.join(RUNS, "curve_box.jsonl")


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


def focal(logit, y):
    """中心の山を当てる損失（CenterNet と同じ考え方の、重み付き交差エントロピー）。

    山のてっぺん（y=1）はごく少ないので、ふつうの交差エントロピーでは
    「どこにも字は無い」と答えるのがいちばん得になってしまう。
    当たっている所ほど軽く、外している所ほど重く見る。
    """
    p = torch.sigmoid(logit).clamp(1e-4, 1 - 1e-4)
    pos = (y >= 0.95).float()
    pos_loss = -((1 - p) ** 2) * torch.log(p) * pos
    neg_loss = -((1 - y) ** 4) * (p ** 2) * torch.log(1 - p) * (1 - pos)
    n = pos.sum().clamp(min=1.0)
    return (pos_loss.sum() + neg_loss.sum()) / n


def size_loss(pred, y, msk):
    """幅・高さ。**山の近くだけ**で測る（それ以外の画素に正解は無い）。"""
    d = (pred - y).abs() * msk
    return d.sum() / msk.sum().clamp(min=1.0)


def _iou(a, b):
    ax1, ay1, ax2, ay2 = a[0] - a[2] / 2, a[1] - a[3] / 2, a[0] + a[2] / 2, a[1] + a[3] / 2
    bx1, by1, bx2, by2 = b[0] - b[2] / 2, b[1] - b[3] / 2, b[0] + b[2] / 2, b[1] + b[3] / 2
    x1, y1 = max(ax1, bx1), max(ay1, by1)
    x2, y2 = min(ax2, bx2), min(ay2, by2)
    if x2 <= x1 or y2 <= y1:
        return 0.0
    i = (x2 - x1) * (y2 - y1)
    return i / (a[2] * a[3] + b[2] * b[3] - i)


@torch.no_grad()
def val_f1(net, items, device, thr=0.3, need=0.5):
    """検証。**列まるごと**を 1 度に通して、枠の当たり具合を測る。"""
    if not items:
        return None, None, None
    net.eval()
    tp = fp = fn = 0
    for it in items:
        H, W = it["H"], it["W"]
        ph = (16 - H % 16) % 16                     # たては 16 の倍数にそろえる
        x = np.stack([it["raw"], it["ink"]], axis=0)
        if ph:
            x = np.pad(x, ((0, 0), (0, ph), (0, 0)))
        got = find_boxes(net, torch.from_numpy(x[None]).to(device), thr=thr)
        want = list(it["boxes"])
        used = set()
        for g in got:
            best, bi = 0.0, -1
            for j, wbox in enumerate(want):
                if j in used:
                    continue
                v = _iou((g["cx"], g["cy"], g["w"], g["h"]), wbox)
                if v > best:
                    best, bi = v, j
            if bi >= 0 and best >= need:
                used.add(bi); tp += 1
            else:
                fp += 1
        fn += len(want) - len(used)
    prec = tp / max(1, tp + fp)
    rec = tp / max(1, tp + fn)
    f1 = 2 * prec * rec / max(1e-9, prec + rec)
    return f1, prec, rec


def batches(items, bs, rng, train=True):
    idx = list(range(len(items)))
    rng.shuffle(idx)
    for i in range(0, len(idx), bs):
        xs, cs, ss, ms = [], [], [], []
        for j in idx[i:i + bs]:
            x, c, s, m = B.window(items[j], rng=rng, train=train)
            if train:
                x = B.augment(x, rng)
            xs.append(x); cs.append(c); ss.append(s); ms.append(m)
        yield (torch.from_numpy(np.stack(xs)), torch.from_numpy(np.stack(cs)),
               torch.from_numpy(np.stack(ss)), torch.from_numpy(np.stack(ms)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=80)
    ap.add_argument("--bs", type=int, default=8)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--base", type=int, default=16)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--data", default="", help="列の置き場（既定 dataset/lines）")
    ap.add_argument("--val", type=float, default=0.1, help="検証に回す割合")
    ap.add_argument("--min", type=int, default=8, help="学習に要る列数の下限")
    ap.add_argument("--note", default="")
    ap.add_argument("--fresh", action="store_true")
    ap.add_argument("--no-swap", dest="no_swap", action="store_true")
    a = ap.parse_args()

    os.makedirs(RUNS, exist_ok=True)
    rng = random.Random(a.seed)
    torch.manual_seed(a.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    dirs = B.list_lines(a.data or LINES)
    items = [x for x in (B.load_line(d) for d in dirs) if x]
    if len(items) < a.min:
        print("列が %d 本しかありません（下限 %d 本）。"
              "彫刻原稿アプリの［この列を AI に登録］で貯めてください。" % (len(items), a.min))
        put_progress(state="few", lines=len(items), need=a.min)
        return
    rng.shuffle(items)
    nv = max(1, int(len(items) * a.val))
    val, tr = items[:nv], items[nv:]
    nch = sum(len(x["boxes"]) for x in tr)
    print("学習 %d 列（%d 字）／検証 %d 列　%s" % (len(tr), nch, len(val), device))

    net = BoxNet(in_ch=2, base=a.base).to(device)
    step, best = 0, -1.0
    if not a.fresh and os.path.exists(CURRENT):
        try:
            ck = torch.load(CURRENT, map_location=device)
            if int(ck.get("base", a.base)) == a.base:
                net.load_state_dict(ck["model"])
                step, best = ck.get("step", 0), float(ck.get("f1") or -1)
                print("続きから（step %d・F1 %.3f）" % (step, best))
        except Exception as e:                               # noqa: BLE001
            print("前の重みは読めませんでした:", e)
    opt = torch.optim.Adam(net.parameters(), lr=a.lr)
    put_curve({"ep": 0, "start": True, "lines": len(tr)}, fresh=True)

    for ep in range(1, a.epochs + 1):
        net.train()
        t0, tot, nb = time.time(), 0.0, 0
        for x, c, s, m in batches(tr, a.bs, rng):
            x, c, s, m = x.to(device), c.to(device), s.to(device), m.to(device)
            lc, ls = net(x)
            loss = focal(lc, c) + 2.0 * size_loss(ls, s, m)
            opt.zero_grad(); loss.backward(); opt.step()
            tot += float(loss.detach()); nb += 1; step += 1
        f1, prec, rec = val_f1(net, val, device)
        rec_line = {"ep": ep, "loss": round(tot / max(1, nb), 4),
                    "f1": None if f1 is None else round(f1, 4),
                    "prec": None if prec is None else round(prec, 4),
                    "rec": None if rec is None else round(rec, 4),
                    "sec": round(time.time() - t0, 1)}
        put_curve(rec_line)
        put_progress(state="running", epochs=a.epochs, step=step, best=round(best, 4),
                     lines=len(tr), **rec_line)
        print("ep %3d  loss %.4f  F1 %s  (%.1fs)" %
              (ep, rec_line["loss"], rec_line["f1"], rec_line["sec"]))
        if f1 is not None and f1 > best:
            best = f1
            ck = {"model": net.state_dict(), "base": a.base, "step": step,
                  "f1": round(f1, 4), "prec": round(prec, 4), "rec": round(rec, 4),
                  "lines": len(tr), "chars": nch, "note": a.note,
                  "at": datetime.now().isoformat(timespec="seconds")}
            gen = os.path.join(RUNS, "box_%s.pth" % datetime.now().strftime("%Y%m%d-%H%M"))
            torch.save(ck, gen)
            if not a.no_swap:
                shutil.copyfile(gen, CURRENT)
                print("  → 差し替えました（F1 %.3f）" % f1)
    put_progress(state="done", best=round(best, 4), lines=len(tr), epochs=a.epochs)
    print("おわり。いちばん良かった F1 = %.3f" % best)


if __name__ == "__main__":
    main()

"""**枠を出す AI** の学習（2026-09-21）。

  python3 train_box.py --epochs 80

やっていること
  1. dataset/lines（彫刻原稿アプリの［この列を AI に登録］で貯めた列）から学習
  2. 1 割（少なくとも 1 列）は**検証用に取り分ける**。学習には使わない
  3. 検証は **枠の当たり具合** で測る。人が直した枠と、AI が出した枠を突き合わせる
       F1    … 重なり（IoU）0.5 以上を「当たり」（前からの 数。画面の「F1」）
       F1t   … 重なり 0.75 以上を「当たり」（きっちり。2026-10-15 から）
       miou  … 人の枠 1 つずつの 重なりの 平均（取りこぼしは 0。2026-10-15 から）
       edge  … 上下左右の はしの ずれの 平均（字の 幅・高さに 対する 割合。2026-10-15 から）
     **差し替えは miou で 決める**（2026-10-15。本人「学習のと登録数が多い文字の枠の精度が悪い」。
     F1 は 重なり 0.5 で 当たりに するので、日 の 10.5×8.5 mm（正しくは 9.3×11.8）も 当たり（0.66）に なり、
     はしの ずれが 点に 出なかった）。F1 が いまの モデルより 0.03 より 下がるときは 差し替えない
  4. 良くなったときだけ runs/box_current.pth を差し替える（悪くなったら据え置き）。
     **いまの モデルを 今回の 検証用で 測った 点** を 越えたときだけ（作りが ちがっても 同じ 物差しで 比べる）
  5. 世代は runs/box_YYYYmmdd-HHMM.pth として必ず残す
  6. 作り（--arch）… 1＝中心の 1 点で 幅・高さ（前から）／2＝字の 中の 点から はしまで（boxnet.BoxNet2。2026-10-15）。
     --challenge … 新しい 作りを ためす（いまの モデルが もう その作りなら 何もしない）。前回の ためし（runs/box_try_a2.pth）の 続きから 学び、
     いまの モデルを 越えたら 差し替える。夜の 学習（train-nightly.sh）で 回す

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
from boxnet import find_boxes, make_boxnet

ROOT = os.path.dirname(os.path.abspath(__file__))
LINES = os.path.join(ROOT, "dataset", "lines")
RUNS = os.path.join(ROOT, "runs")
CURRENT = os.path.join(RUNS, "box_current.pth")
PROGRESS = os.path.join(RUNS, "progress_box.json")
CURVE = os.path.join(RUNS, "curve_box.jsonl")
CHARS = os.path.join(RUNS, "box_chars.json")


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


def ltrb_loss(pred, y, wt):
    """作り 2 の はしの 損失（2026-10-15）：重なり（GIoU）＋ 長さの ずれ。字の 中ほどの 点だけ（wt）。"""
    l1, t1, r1, b1 = pred[:, 0], pred[:, 1], pred[:, 2], pred[:, 3]
    l2, t2, r2, b2 = y[:, 0], y[:, 1], y[:, 2], y[:, 3]
    w = wt[:, 0]
    a1 = (l1 + r1) * (t1 + b1)
    a2 = (l2 + r2) * (t2 + b2)
    iw = torch.min(l1, l2) + torch.min(r1, r2)
    ih = torch.min(t1, t2) + torch.min(b1, b2)
    inter = iw.clamp(min=0) * ih.clamp(min=0)
    union = (a1 + a2 - inter).clamp(min=1e-6)
    iou = inter / union
    cw = torch.max(l1, l2) + torch.max(r1, r2)
    ch = torch.max(t1, t2) + torch.max(b1, b2)
    encl = (cw * ch).clamp(min=1e-6)
    giou = iou - (encl - union) / encl
    n = w.sum().clamp(min=1.0)
    lg = ((1.0 - giou) * w).sum() / n
    ll = ((pred - y).abs().sum(1) * w).sum() / n
    return lg + ll


def _iou(a, b):
    ax1, ay1, ax2, ay2 = a[0] - a[2] / 2, a[1] - a[3] / 2, a[0] + a[2] / 2, a[1] + a[3] / 2
    bx1, by1, bx2, by2 = b[0] - b[2] / 2, b[1] - b[3] / 2, b[0] + b[2] / 2, b[1] + b[3] / 2
    x1, y1 = max(ax1, bx1), max(ay1, by1)
    x2, y2 = min(ax2, bx2), min(ay2, by2)
    if x2 <= x1 or y2 <= y1:
        return 0.0
    i = (x2 - x1) * (y2 - y1)
    return i / (a[2] * a[3] + b[2] * b[3] - i)


def _x(it):
    H = it["H"]
    ph = (16 - H % 16) % 16                     # たては 16 の倍数にそろえる
    x = np.stack([it["raw"], it["ink"]], axis=0)
    if ph:
        x = np.pad(x, ((0, 0), (0, ph), (0, 0)))
    return x


def _match(got, want, need):
    """AI の枠（確からしい順）ごとに、まだ使っていない 人の枠で いちばん 重なる ものを 取る。
    返り … {人の枠の 番号: (AI の枠, 重なり)}（重なりが need 以上の ものだけ）"""
    used = {}
    for g in got:
        best, bi = 0.0, -1
        for j, wbox in enumerate(want):
            if j in used:
                continue
            v = _iou((g["cx"], g["cy"], g["w"], g["h"]), wbox)
            if v > best:
                best, bi = v, j
        if bi >= 0 and best >= need:
            used[bi] = (g, best)
    return used


@torch.no_grad()
def val_score(net, items, device, thr=0.3, per_char=None):
    """検証。**列まるごと**を 1 度に通して、枠の当たり具合を測る（2026-10-15 から 4 つ）。
    per_char … dict を 渡すと 字ごとに {n, iou[], hr[], wr[]} を 足す（高さ・幅の 比 は AI ÷ 人）"""
    if not items:
        return None
    net.eval()
    tp5 = tp7 = ng = nw = 0
    ious, edges = [], []
    for it in items:
        got = find_boxes(net, torch.from_numpy(_x(it)[None]).to(device), thr=thr)
        want = list(it["boxes"])
        chs = it.get("chs") or [""] * len(want)
        ng += len(got); nw += len(want)
        tp5 += len(_match(got, want, 0.5))
        tp7 += len(_match(got, want, 0.75))
        m1 = _match(got, want, 0.1)
        for j, wbox in enumerate(want):
            g, v = m1.get(j, (None, 0.0))
            ious.append(v)
            if g is not None and v >= 0.3:
                wx1, wy1, wx2, wy2 = wbox[0] - wbox[2] / 2, wbox[1] - wbox[3] / 2, wbox[0] + wbox[2] / 2, wbox[1] + wbox[3] / 2
                gx1, gy1, gx2, gy2 = g["cx"] - g["w"] / 2, g["cy"] - g["h"] / 2, g["cx"] + g["w"] / 2, g["cy"] + g["h"] / 2
                edges.append((abs(gx1 - wx1) / wbox[2] + abs(gx2 - wx2) / wbox[2] +
                              abs(gy1 - wy1) / wbox[3] + abs(gy2 - wy2) / wbox[3]) / 4)
            if per_char is not None and chs[j]:
                pc = per_char.setdefault(chs[j], {"n": 0, "iou": [], "hr": [], "wr": []})
                pc["n"] += 1; pc["iou"].append(v)
                if g is not None and v >= 0.3:
                    pc["hr"].append(g["h"] / wbox[3]); pc["wr"].append(g["w"] / wbox[2])

    def f1(tp):
        pr, rc = tp / max(1, ng), tp / max(1, nw)
        return 2 * pr * rc / max(1e-9, pr + rc), pr, rc
    f5, p5, r5 = f1(tp5)
    f7 = f1(tp7)[0]
    return {"f1": f5, "prec": p5, "rec": r5, "f1t": f7,
            "miou": float(np.mean(ious)) if ious else 0.0,
            "edge": float(np.mean(edges)) if edges else None, "n": nw}


def val_f1(net, items, device, thr=0.3, need=0.5):
    """前からの 呼び方（F1・prec・rec）。"""
    r = val_score(net, items, device, thr=thr)
    if r is None:
        return None, None, None
    return r["f1"], r["prec"], r["rec"]


def _r(v, k=4):
    return None if v is None else round(float(v), k)


def char_report(net, items, device):
    """字ごとの 合い方（覚えた 列 ぜんぶで。学習に 使った 列も 入るので 甘めに 出る）。3 回 以上 出る 字だけ・多い順"""
    pc = {}
    val_score(net, items, device, per_char=pc)
    out = []
    for ch, v in pc.items():
        if v["n"] < 3:
            continue
        out.append({"ch": ch, "n": v["n"], "miou": _r(np.mean(v["iou"]), 3),
                    "hr": _r(np.median(v["hr"]), 3) if v["hr"] else None,
                    "wr": _r(np.median(v["wr"]), 3) if v["wr"] else None})
    out.sort(key=lambda z: (-z["n"], z["ch"]))
    return out


def batches(items, bs, rng, train=True, arch=1):
    idx = list(range(len(items)))
    rng.shuffle(idx)
    for i in range(0, len(idx), bs):
        xs, cs, ss, ms = [], [], [], []
        for j in idx[i:i + bs]:
            x, c, s, m = B.window(items[j], rng=rng, train=train, arch=arch)
            if train:
                x = B.augment(x, rng)
            xs.append(x); cs.append(c); ss.append(s); ms.append(m)
        yield (torch.from_numpy(np.stack(xs)), torch.from_numpy(np.stack(cs)),
               torch.from_numpy(np.stack(ss)), torch.from_numpy(np.stack(ms)))


def _better(s, best, base):
    """差し替えて よいか：重なりの 平均（miou）が いちばん 良く、F1 が いまの モデルより 0.03 より 下がらない"""
    if s is None:
        return False
    if base is not None and s["f1"] < base["f1"] - 0.03:
        return False
    return s["miou"] > best


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
    ap.add_argument("--arch", type=int, default=0, help="作り。0＝いまの モデルと 同じ（無ければ 1）／1／2")
    ap.add_argument("--challenge", action="store_true",
                    help="新しい 作りを ためす。いまの モデルが その作りなら 何もしない。前回の ためしの 続きから")
    a = ap.parse_args()

    os.makedirs(RUNS, exist_ok=True)
    rng = random.Random(a.seed)
    torch.manual_seed(a.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    # いまの モデル（作り・太さ）
    ck0 = None
    if os.path.exists(CURRENT):
        try:
            ck0 = torch.load(CURRENT, map_location=device)
        except Exception as e:                               # noqa: BLE001
            print("いまの モデルは 読めませんでした:", e)
            ck0 = None
    arch0 = int((ck0 or {}).get("arch", 1) or 1) if ck0 else 0
    arch = a.arch or arch0 or 1
    if a.challenge and arch0 == arch:
        print("いまの 枠の モデルは もう 作り %d です（ためしは 要りません）" % arch)
        return

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
    print("学習 %d 列（%d 字）／検証 %d 列（%d 字）　作り %d%s　%s" %
          (len(tr), nch, len(val), sum(len(x["boxes"]) for x in val), arch, "（ためし）" if a.challenge else "", device))

    # **いまの モデルを 今回の 検証用で 測り直して、それを越えたら差し替える**
    # （2026-09-23。本人の報告「枠の学習をしたのに、モデルの中身が古いまま」）。
    # 前は 前回の検証用で出た F1（列が少ないと 0.97 などになる）と比べていたので、
    # 材料を足して検証用が変わると、いつまでも越えられず 差し替わらなかった。
    # 2026-10-15 から 作りが ちがっても（ためし・--fresh でも）いまの モデルを 測って 越えたときだけ 差し替える
    # （前は --fresh だと 1 回目で 必ず 差し替わっていた）
    base0, net0 = None, None
    if ck0 is not None:
        try:
            net0 = make_boxnet(arch0, in_ch=2, base=int(ck0.get("base", 16))).to(device)
            net0.load_state_dict(ck0["model"])
            base0 = val_score(net0, val, device)
            print("いまの モデル（作り %d・step %d）を 今回の 検証用で 測ると：F1 %.3f・きっちり %.3f・重なり平均 %.3f・はしの ずれ %s" %
                  (arch0, ck0.get("step", 0), base0["f1"], base0["f1t"], base0["miou"],
                   "―" if base0["edge"] is None else "%.1f%%" % (base0["edge"] * 100)))
        except Exception as e:                               # noqa: BLE001
            print("いまの モデルは 測れませんでした:", e)
            base0, net0 = None, None
    best = -1.0 if base0 is None else base0["miou"]

    net = make_boxnet(arch, in_ch=2, base=a.base).to(device)
    step = 0
    try_path = os.path.join(RUNS, "box_try_a%d.pth" % arch)
    src = None
    if a.challenge:
        if not a.fresh and os.path.exists(try_path):
            src = try_path
    elif not a.fresh and ck0 is not None and arch0 == arch:
        src = CURRENT
    if src:
        try:
            ck = ck0 if src == CURRENT else torch.load(src, map_location=device)
            if int(ck.get("base", a.base)) == a.base and int(ck.get("arch", 1) or 1) == arch:
                net.load_state_dict(ck["model"])
                step = ck.get("step", 0)
                print("続きから（%s・step %d）" % (os.path.basename(src), step))
        except Exception as e:                               # noqa: BLE001
            print("前の重みは読めませんでした:", e)
    opt = torch.optim.Adam(net.parameters(), lr=a.lr)
    put_curve({"ep": 0, "start": True, "lines": len(tr), "arch": arch,
               "base_miou": None if base0 is None else _r(base0["miou"])}, fresh=True)
    nswap = 0

    for ep in range(1, a.epochs + 1):
        net.train()
        t0, tot, nb = time.time(), 0.0, 0
        for x, c, s, m in batches(tr, a.bs, rng, arch=arch):
            x, c, s, m = x.to(device), c.to(device), s.to(device), m.to(device)
            lc, ls = net(x)
            if arch == 2:
                loss = focal(lc, c) + 2.0 * ltrb_loss(ls, s, m)
            else:
                loss = focal(lc, c) + 2.0 * size_loss(ls, s, m)
            opt.zero_grad(); loss.backward(); opt.step()
            tot += float(loss.detach()); nb += 1; step += 1
        sc = val_score(net, val, device)
        rec_line = {"ep": ep, "loss": round(tot / max(1, nb), 4),
                    "f1": _r(sc and sc["f1"]), "prec": _r(sc and sc["prec"]), "rec": _r(sc and sc["rec"]),
                    "f1t": _r(sc and sc["f1t"]), "miou": _r(sc and sc["miou"]), "edge": _r(sc and sc["edge"]),
                    "sec": round(time.time() - t0, 1)}
        put_curve(rec_line)
        put_progress(state="running", epochs=a.epochs, step=step, best=round(best, 4),
                     lines=len(tr), arch=arch, base=None if base0 is None else _r(base0["miou"]), **rec_line)
        print("ep %3d  loss %.4f  F1 %s  きっちり %s  重なり平均 %s  はし %s  (%.1fs)" %
              (ep, rec_line["loss"], rec_line["f1"], rec_line["f1t"], rec_line["miou"], rec_line["edge"], rec_line["sec"]))
        if _better(sc, best, base0):
            best = sc["miou"]
            ck = {"model": net.state_dict(), "base": a.base, "arch": arch, "step": step,
                  "f1": _r(sc["f1"]), "prec": _r(sc["prec"]), "rec": _r(sc["rec"]),
                  "f1t": _r(sc["f1t"]), "miou": _r(sc["miou"]), "edge": _r(sc["edge"]),
                  "lines": len(tr), "chars": nch, "note": a.note,
                  "at": datetime.now().isoformat(timespec="seconds")}
            gen = os.path.join(RUNS, "box_%s.pth" % datetime.now().strftime("%Y%m%d-%H%M"))
            torch.save(ck, gen)
            if not a.no_swap:
                shutil.copyfile(gen, CURRENT)
                print("  → 差し替えました（重なり平均 %.3f・F1 %.3f・作り %d）" % (sc["miou"], sc["f1"], arch))
                nswap += 1
    # ためしは 次の 夜に 続きから 学ぶ（差し替わらなくても）
    if a.challenge:
        try:
            torch.save({"model": net.state_dict(), "base": a.base, "arch": arch, "step": step,
                        "at": datetime.now().isoformat(timespec="seconds")}, try_path)
        except OSError as e:
            print("ためしの 重みを 残せませんでした:", e)
    # 字ごとの 合い方（いまの モデル と 今回 学んだ モデル）。覚えた 列 ぜんぶで
    try:
        rep = {"at": datetime.now().strftime("%Y-%m-%d %H:%M"), "lines": len(items)}
        cur_net = net if nswap else net0
        cur_arch = arch if nswap else arch0
        if cur_net is not None:
            rep["current"] = {"arch": cur_arch, "items": char_report(cur_net, items, device)}
        rep["this"] = {"arch": arch, "challenge": bool(a.challenge), "swapped": bool(nswap),
                       "items": char_report(net, items, device)}
        with open(CHARS, "w", encoding="utf-8") as f:
            json.dump(rep, f, ensure_ascii=False, indent=1)
        top = rep.get("current", rep["this"])["items"][:12]
        print("字ごとの 合い方（いまの モデル・覚えた 列 ぜんぶ）：" +
              "・".join("%s %d 個 重なり %.2f 高さ %s 幅 %s" % (z["ch"], z["n"], z["miou"], z["hr"], z["wr"]) for z in top))
    except Exception as e:                                   # noqa: BLE001
        print("字ごとの 合い方は 出せませんでした:", e)
    put_progress(state="done", best=round(best, 4), lines=len(tr), epochs=a.epochs, arch=arch,
                 swapped=nswap, base=None if base0 is None else _r(base0["miou"]))
    print("おわり。いちばん良かった 重なり平均 = %.3f（いまの モデル %s）%s" %
          (best, "―" if base0 is None else "%.3f" % base0["miou"], "・差し替えました" if nswap else "・差し替えなし"))


if __name__ == "__main__":
    main()

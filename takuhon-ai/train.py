"""学習（夜間に回す）。

  python3 train.py --epochs 60

やっていること
  1. dataset/pairs から学習、dataset/val（学習に使わない）で検証
  2. 検証は **手がかり無し**でも測る。本番で手がかり無しでも動く必要があるため
  3. 良くなったときだけ runs/current.pth を差し替える（**悪くなったら据え置き**）
  4. 世代は runs/model_YYYYmmdd-HHMM.pth として必ず残す（上書きしない）

手がかり（hint1/hint2）は学習中にわざと白紙へ差し替える（HINT_DROP）。
そうしないと、拓本を見ずに手がかりを写すだけのモデルになる。
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

import data as D
from unet import UNet

ROOT = os.path.dirname(os.path.abspath(__file__))
TRAIN_DIR = os.path.join(ROOT, "dataset", "pairs")
VAL_DIR = os.path.join(ROOT, "dataset", "val")
RUNS = os.path.join(ROOT, "runs")
CURRENT = os.path.join(RUNS, "current.pth")

HINT_DROP1 = 0.4     # 元のフォントの字形を白紙にする割合
HINT_DROP2 = 0.4     # 合わせたあとの字形を白紙にする割合


PROGRESS = os.path.join(RUNS, "progress.json")
CURVE = os.path.join(RUNS, "curve.jsonl")


def put_progress(**kw):
    """いまの様子を runs/progress.json に置く（見るための画面が読む）。

    夜に回すと画面のログは流れて消える。**朝に何が起きたか分かる**ように、
    1 エポックごとに上書きする。書けなくても学習は止めない。
    """
    try:
        kw["at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open(PROGRESS, "w", encoding="utf-8") as f:
            json.dump(kw, f, ensure_ascii=False, indent=1)
    except OSError:
        pass


def put_curve(rec, fresh=False):
    """1 エポックぶんの成績を積む。fresh なら新しい回として書き直す。"""
    try:
        with open(CURVE, "w" if fresh else "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except OSError:
        pass


def dice_bce(logit, y):
    bce = nn.functional.binary_cross_entropy_with_logits(logit, y)
    p = torch.sigmoid(logit)
    num = 2 * (p * y).sum((1, 2, 3)) + 1.0
    den = p.sum((1, 2, 3)) + y.sum((1, 2, 3)) + 1.0
    return bce + (1 - (num / den)).mean()


def iou(pred, y):
    p = (pred > 0.5).float()
    inter = (p * y).sum((1, 2, 3))
    union = ((p + y) > 0).float().sum((1, 2, 3))
    return (inter / union.clamp(min=1.0)).mean().item()


def load_all(dirs):
    out = []
    for d in dirs:
        p = D.load_pair(d)
        if p:
            out.append(p)
    return out


def batches(items, bs, rng, aug=True):
    idx = list(range(len(items)))
    rng.shuffle(idx)
    for i in range(0, len(idx), bs):
        xs, ys = [], []
        for j in idx[i:i + bs]:
            it = items[j]
            raw, mask, h1, h2 = it["raw"], it["mask"], it["hint1"], it["hint2"]
            if aug:
                raw, mask, h1, h2 = D.augment(raw, mask, h1, h2, rng)
            xs.append(D.to_input(raw, h1, h2, HINT_DROP1, HINT_DROP2, rng))
            ys.append(mask[None])
        yield (torch.from_numpy(np.stack(xs)), torch.from_numpy(np.stack(ys)))


def val_score(net, items, device, use_hint):
    """検証。use_hint=False なら手がかりを白紙にして測る（本番の最低条件）。"""
    if not items:
        return None
    net.eval()
    tot, n = 0.0, 0
    with torch.no_grad():
        for it in items:
            d1 = 0.0 if use_hint else 1.0
            x = D.to_input(it["raw"], it["hint1"], it["hint2"], d1, d1, random.Random(0))
            y = torch.from_numpy(it["mask"][None][None]).to(device)
            p = torch.sigmoid(net(torch.from_numpy(x[None]).to(device)))
            tot += iou(p, y); n += 1
    return tot / max(1, n)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--bs", type=int, default=4)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--base", type=int, default=32)
    ap.add_argument("--seed", type=int, default=0)
    # 下の 2 つは「動くかどうか試す」ためのもの。ふだんは使わない。
    # 8 組未満で学習しても、まともなモデルにはならない（下限はその歯止め）。
    ap.add_argument("--min", type=int, default=8,
                    help="学習に要る組数の下限（試すときだけ 1 などに下げる）")
    ap.add_argument("--swap-anyway", action="store_true",
                    help="検証用が無くても current.pth を差し替える（試すときだけ）")
    a = ap.parse_args()

    os.makedirs(RUNS, exist_ok=True)
    rng = random.Random(a.seed)
    torch.manual_seed(a.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    tr = load_all(D.list_pairs(TRAIN_DIR))
    va = load_all(D.list_pairs(VAL_DIR))
    print(f"学習 {len(tr)} 組 ／ 検証 {len(va)} 組 ／ {device}")
    started = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    if len(tr) < max(1, a.min):
        print(f"学習用が少なすぎます（{a.min} 組以上ためてください）。やめます。")
        put_progress(state="stopped", why=f"学習用が少なすぎます（{a.min} 組以上）",
                     pairs=len(tr), val=len(va), started=started)
        return
    if len(tr) < 8:
        print(f"※ {len(tr)} 組しかありません。**動くかどうかを試すだけ**の学習です。")

    net = UNet(base=a.base).to(device)
    step0, best_prev = 0, None
    if os.path.exists(CURRENT):
        ck = torch.load(CURRENT, map_location=device)
        net.load_state_dict(ck["model"])
        step0 = ck.get("step", 0)
        best_prev = ck.get("iou_nohint")
        print(f"続きから：step {step0}／前回の一致（手がかり無し） {best_prev}")

    opt = torch.optim.AdamW(net.parameters(), lr=a.lr, weight_decay=1e-4)
    scaler = torch.amp.GradScaler("cuda", enabled=(device.type == "cuda"))
    step = step0
    t0 = time.time()
    put_progress(state="running", epoch=0, epochs=a.epochs, pairs=len(tr), val=len(va),
                 started=started, device=str(device), bs=a.bs, lr=a.lr,
                 prev=best_prev, pid=os.getpid())
    put_curve({"ep": 0}, fresh=True)          # 新しい回。前の回の線は消す
    v1 = v0 = None
    for ep in range(1, a.epochs + 1):
        net.train()
        tot, nb = 0.0, 0
        for x, y in batches(tr, a.bs, rng):
            x, y = x.to(device), y.to(device)
            opt.zero_grad(set_to_none=True)
            with torch.amp.autocast("cuda", enabled=(device.type == "cuda")):
                loss = dice_bce(net(x), y)
            scaler.scale(loss).backward()
            scaler.step(opt); scaler.update()
            tot += loss.item(); nb += 1; step += 1
        avg = tot / max(1, nb)
        if ep % 5 == 0 or ep == a.epochs:
            v1 = val_score(net, va, device, True)
            v0 = val_score(net, va, device, False)
            print(f"epoch {ep:3d}  loss {avg:.4f}  "
                  f"一致(手がかりあり) {v1 if v1 is None else round(v1,3)}  "
                  f"一致(手がかり無し) {v0 if v0 is None else round(v0,3)}")
        sec = (time.time() - t0) / ep
        put_curve({"ep": ep, "loss": round(avg, 5), "iou": v1, "iou_nohint": v0})
        put_progress(state="running", epoch=ep, epochs=a.epochs, loss=round(avg, 5),
                     iou=v1, iou_nohint=v0, pairs=len(tr), val=len(va), step=step,
                     started=started, device=str(device), bs=a.bs, lr=a.lr,
                     prev=best_prev, secPerEpoch=round(sec, 2),
                     etaSec=int(sec * (a.epochs - ep)), pid=os.getpid())

    v1 = val_score(net, va, device, True)
    v0 = val_score(net, va, device, False)
    at = datetime.now().strftime("%Y-%m-%d %H:%M")
    ck = {"model": net.state_dict(), "step": step, "at": at,
          "iou": v1, "iou_nohint": v0, "base": a.base, "pairs": len(tr)}
    gen = os.path.join(RUNS, "model_" + datetime.now().strftime("%Y%m%d-%H%M") + ".pth")
    torch.save(ck, gen)
    print("世代を残しました:", gen)

    # 検証が無い／良くなった ときだけ差し替える。悪くなったら据え置き。
    done = dict(state="done", epoch=a.epochs, epochs=a.epochs, iou=v1, iou_nohint=v0,
                pairs=len(tr), val=len(va), step=step, started=started,
                device=str(device), prev=best_prev, gen=os.path.basename(gen))
    if not va:
        if getattr(a, "swap_anyway", False):
            shutil.copyfile(gen, CURRENT)
            print("検証をしていませんが、試すために current.pth を差し替えました。")
            put_progress(swapped=True,
                         why="検証なしで差し替えました（試すため。--swap-anyway）", **done)
            return
        print("検証用が無いので、差し替えません。dataset/val に 10 組ほど移してください。")
        put_progress(swapped=False,
                     why="検証用が無いので差し替えません（dataset/val に 10 組ほど）", **done)
        return
    if best_prev is None or (v0 is not None and v0 >= best_prev - 1e-4):
        shutil.copyfile(gen, CURRENT)
        print(f"current.pth を差し替えました（手がかり無しの一致 {best_prev} → {round(v0,3)}）")
        put_progress(swapped=True,
                     why="良くなったので差し替えました（%s → %s）" % (best_prev, round(v0, 3)), **done)
    else:
        print(f"悪くなったので据え置きます（{best_prev} → {round(v0,3)}）")
        put_progress(swapped=False,
                     why="悪くなったので据え置きました（%s → %s）" % (best_prev, round(v0, 3)), **done)
    with open(os.path.join(RUNS, "history.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps({"at": at, "step": step, "iou": v1, "iou_nohint": v0,
                            "pairs": len(tr), "file": os.path.basename(gen)},
                           ensure_ascii=False) + "\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:                    # 落ちたことも画面に残す（夜に回すので）
        put_progress(state="failed", why=f"{type(e).__name__}: {e}")
        raise

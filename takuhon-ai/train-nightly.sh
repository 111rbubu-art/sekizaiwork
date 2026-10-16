#!/usr/bin/env bash
# 夜に回す学習（2026-09-21）。3 つを順に回す。
#   ① 墨   train.py       材料 dataset/pairs
#   ② 枠   train_box.py   材料 dataset/lines（彫刻原稿アプリの［字枠を登録］）
#   ③ 読み train_char.py  材料 dataset/lines の読み ＋ dataset/chars（手本帳）
#
# 材料が足りないものは、それぞれのプログラムが「足りません」と言って
# すぐ終わる（**前のモデルは そのまま**）。だから並べて回してよい。
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
PY="$HERE/.venv/bin/python"
[ -x "$PY" ] || PY=python3
cd "$HERE"

echo "===== $(date '+%F %T') 学習をはじめます ====="
echo "--- ① 墨 ---";   "$PY" train.py       --epochs "${EP_INK:-60}"  || echo "（墨：やめました）"
echo "--- ② 枠 ---";   "$PY" train_box.py   --epochs "${EP_BOX:-80}"  || echo "（枠：やめました）"
# ②' 枠の 新しい作り（字の はしを 当てる。2026-10-15）のためし。いまの モデルを 重なりの 平均で 越えたときだけ 差し替わる。
#     前回の ためしの 続きから 学ぶ。いまの モデルが もう 新しい作りなら すぐ 終わる
#     （2026-10-16：GPU で 1 回 0.3 秒・120 回では 重なり平均 0.59 で いまの 0.71 に 届かず → 毎晩 600 回＝3 分ほど）
echo "--- ②' 枠（新しい作りのためし）---"; "$PY" train_box.py --arch 2 --challenge --epochs "${EP_BOX2:-600}" || echo "（枠のためし：やめました）"
echo "--- ③ 読み ---"; "$PY" train_char.py  --epochs "${EP_CHAR:-60}" || echo "（読み：やめました）"
echo "===== $(date '+%F %T') おわり ====="

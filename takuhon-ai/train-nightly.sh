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
echo "--- ③ 読み ---"; "$PY" train_char.py  --epochs "${EP_CHAR:-60}" || echo "（読み：やめました）"
echo "===== $(date '+%F %T') おわり ====="

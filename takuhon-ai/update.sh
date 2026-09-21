#!/usr/bin/env bash
# 拓本AI を最新にする。これ 1 本でよい。
#   bash /opt/takuhon-ai/update.sh
#
# 貯めたデータ（dataset/）・モデル（runs/）・置いた書体（fonts/）には触らない。
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "■ 新しいものを取ってきます…"
git clone --depth 1 -q https://github.com/111rbubu-art/sekizaiwork.git "$TMP/sw"

echo "■ 入れ替えます（データ・モデル・書体は そのまま）…"
# **プログラムは ぜんぶ写す**（2026-09-21）。
# 前は写すファイル名を並べて書いていたので、**新しく足したファイルが写らず**、
# app.py だけ新しくなって「boxnet が無い」で上がらなくなる、という事故になる。
# ここでは *.py と 付き物（画面・設定・説明）をまとめて写す。
# dataset/ runs/ fonts/ .venv/ には触らない。
cp -f "$TMP/sw/takuhon-ai/"*.py "$HERE/" 2>/dev/null || true
for f in dash.html check-env.sh update.sh README.md requirements.txt \
         "SPEC-輪郭と補正.md" Dockerfile docker-compose.yml train-nightly.sh \
         takuhon-ai.service takuhon-train.service takuhon-train.timer; do
  [ -f "$TMP/sw/takuhon-ai/$f" ] && cp -f "$TMP/sw/takuhon-ai/$f" "$HERE/$f"
done
chmod +x "$HERE/update.sh" "$HERE/check-env.sh" "$HERE/train-nightly.sh" 2>/dev/null || true
echo "　写したプログラム: $(ls "$HERE"/*.py | wc -l) 本"

if [ -x "$HERE/.venv/bin/pip" ]; then
  echo "■ 足りない部品があれば入れます…"
  "$HERE/.venv/bin/pip" install -q -r "$HERE/requirements.txt" || true
fi

if systemctl list-unit-files 2>/dev/null | grep -q '^takuhon-ai\.service'; then
  echo "■ サーバーを入れ直します…"
  sudo systemctl restart takuhon-ai
  sleep 2
  systemctl is-active takuhon-ai >/dev/null && echo "→ 動いています" || {
    echo "→ 上がりませんでした。次を見てください:"; sudo journalctl -u takuhon-ai -n 20 --no-pager; exit 1; }
else
  echo "■ サービス登録がないので、手で動かしてください:"
  echo "   cd $HERE && source .venv/bin/activate && python3 -m uvicorn app:app --host 0.0.0.0 --port 8077"
fi

echo "■ 終わりました。ブラウザで画面を開き直してください。"

#!/usr/bin/env bash
# 拓本AI を最新にする。これ 1 本でよい。
#   bash /opt/takuhon-ai/update.sh
#
# 貯めたデータ（dataset/）・モデル（runs/）・置いた書体（fonts/）には触らない。
set -e

# ───── **自分自身を上書きしないように、まず写しへ移る**（2026-09-21）─────
# bash は走らせているファイルを**読みながら**進む。このプログラムは
# 最後に update.sh も新しくするので、上書きした所から続きを読んでしまい、
# 説明書きの途中を命令として実行してしまう（実際に出た
# 「行 21: $'\201\231。': コマンドが見つかりません」がこれ）。
# そこで、いったん /tmp の写しに移ってから続ける。
if [ "${TAKU_SELF:-}" != "1" ]; then
  SELF="$(mktemp /tmp/takuhon-update-XXXXXX.sh)"
  cp "$0" "$SELF"
  TAKU_SELF=1 TAKU_SELF_PATH="$SELF" TAKU_HERE="$(cd "$(dirname "$0")" && pwd)" \
    exec bash "$SELF" "$@"
fi
[ -n "${TAKU_SELF_PATH:-}" ] && trap 'rm -f "$TAKU_SELF_PATH"' EXIT

# ───── **入れ先をまちがえない**（2026-09-22。実機でやらかした）─────
# このプログラムは「自分が置かれている場所」を入れ先とみなす。
# そのため、一時フォルダに落とした写しから走らせると、
# **その一時フォルダを更新して終わり**になり、/opt/takuhon-ai は古いままになる
# （実際にそうなった。そのあと写しを消したので、何も残らなかった）。
# 置き場らしくない所（.venv も dataset も無い）から走らせたときは、
# 決まった置き場に向ける。`TAKU_DIR=…` で名ざしもできる。
HERE="${TAKU_DIR:-${TAKU_HERE:-$(cd "$(dirname "$0")" && pwd)}}"
if [ ! -d "$HERE/.venv" ] && [ ! -d "$HERE/dataset" ] && [ ! -d "$HERE/runs" ]; then
  if [ -d "/opt/takuhon-ai" ]; then
    echo "■ ここは置き場ではないようなので、/opt/takuhon-ai を新しくします"
    HERE="/opt/takuhon-ai"
  fi
fi
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"; [ -n "${TAKU_SELF_PATH:-}" ] && rm -f "$TAKU_SELF_PATH"' EXIT

echo "■ 入れ先: $HERE"
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
  # **cp ではなく mv で差し替える**。cp は同じ入れ物を書きかえるので、
  # いま走っているプログラムを書きかえてしまう。mv なら入れ物ごと入れ替わる。
  if [ -f "$TMP/sw/takuhon-ai/$f" ]; then
    cp -f "$TMP/sw/takuhon-ai/$f" "$HERE/.$f.new" && mv -f "$HERE/.$f.new" "$HERE/$f"
  fi
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

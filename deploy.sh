#!/bin/bash
# ============================================================
# 庄司石材店 サイト デプロイスクリプト
#   さくらのレンタルサーバ スタンダードプラン向け
#
# 使い方:
#   ./deploy.sh          … 実際に転送する
#   ./deploy.sh --dry    … 転送内容の確認のみ（ファイルは変更しない）
#
# 事前準備:
#   ~/.ssh/config に以下を書いておくこと
#     Host sakura
#       HostName アカウント名.sakura.ne.jp
#       User アカウント名
#       IdentityFile ~/.ssh/id_ed25519
# ============================================================
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)/public/"
DEST="sakura:~/www/"

# 独自ドメインの設定によっては ~/www/ドメイン名/ が公開ディレクトリになる。
# その場合は上の DEST を書き換えること。

DRY=""
if [ "${1:-}" = "--dry" ] || [ "${1:-}" = "-n" ]; then
  DRY="--dry-run"
  echo "※ ドライラン（実際には転送しません）"
fi

if [ ! -d "$SRC" ]; then
  echo "エラー: 公開用ディレクトリが見つかりません: $SRC" >&2
  exit 1
fi

# rsync が使えるか確認する
if ssh sakura "command -v rsync" >/dev/null 2>&1; then
  echo "rsync で転送します → $DEST"
  rsync -avz --delete $DRY \
    --exclude '.git' \
    --exclude '.DS_Store' \
    --exclude 'Thumbs.db' \
    "$SRC" "$DEST"
else
  echo "サーバに rsync がないため scp で転送します → $DEST"
  if [ -n "$DRY" ]; then
    echo "（ドライランは rsync がある場合のみ対応しています）"
    exit 0
  fi
  scp -r "$SRC"* "$DEST"
  scp "$SRC.htaccess" "$DEST"
fi

echo "デプロイ完了"

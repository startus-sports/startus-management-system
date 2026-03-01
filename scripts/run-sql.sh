#!/bin/bash
# ============================================================
# Supabase SQL 実行スクリプト
# ============================================================
#
# SQLファイルを Supabase データベースに実行するスクリプトです。
# Supabase Management API を使って直接実行します。
#
# 使い方:
#   bash scripts/run-sql.sh <SQLファイル>
#   bash scripts/run-sql.sh migration-chat.sql
#   bash scripts/run-sql.sh setup-all.sql
#
# --force オプション: 確認なしで実行（Claude Code からの自動実行用）
#   bash scripts/run-sql.sh --force migration-chat.sql
# ============================================================

set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_REF="jfsxywwufwdprqdkyxhr"

# .env ファイルから環境変数を読み込み
if [ -f "$REPO_DIR/.env" ]; then
  export $(grep -v '^#' "$REPO_DIR/.env" | xargs)
fi

# Supabase アクセストークンの取得
get_token() {
  if [ -n "$SUPABASE_ACCESS_TOKEN" ]; then
    echo "$SUPABASE_ACCESS_TOKEN"
    return
  fi
  echo ""
}

# --force オプションの確認
FORCE=false
if [ "$1" = "--force" ]; then
  FORCE=true
  shift
fi

SQL_FILE="$1"

if [ -z "$SQL_FILE" ]; then
  echo "使い方: bash scripts/run-sql.sh <SQLファイル>"
  echo "        bash scripts/run-sql.sh --force <SQLファイル>"
  echo ""
  echo "利用可能なSQLファイル:"
  ls -1 "$REPO_DIR"/*.sql 2>/dev/null | while read f; do
    echo "  $(basename "$f")"
  done
  exit 1
fi

# SQLファイルのパスを解決
if [ ! -f "$SQL_FILE" ]; then
  SQL_FILE="$REPO_DIR/$SQL_FILE"
fi

if [ ! -f "$SQL_FILE" ]; then
  echo "エラー: SQLファイルが見つかりません: $1"
  exit 1
fi

echo "=== SQL実行 ==="
echo "ファイル: $(basename "$SQL_FILE")"
echo ""

# migration ファイルの二重実行警告
BASENAME="$(basename "$SQL_FILE")"
if [[ "$BASENAME" == migration-* ]] || [[ "$BASENAME" == setup-* ]]; then
  if [ "$FORCE" = false ]; then
    echo "⚠  注意: このファイルは一度だけ実行してください。"
    echo "   二重実行するとデータが重複する可能性があります。"
    echo ""
    read -p "実行しますか？ (y/N): " CONFIRM
    if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
      echo "キャンセルしました。"
      exit 0
    fi
  else
    echo "⚠  --force: 確認をスキップして実行します"
  fi
fi

# アクセストークンの取得
TOKEN=$(get_token)

if [ -z "$TOKEN" ]; then
  echo "エラー: Supabase アクセストークンが見つかりません。"
  echo ""
  echo "以下のいずれかで設定してください:"
  echo "  1. npx supabase login --token <トークン>"
  echo "  2. export SUPABASE_ACCESS_TOKEN=<トークン>"
  echo ""
  echo "トークンは以下から取得できます:"
  echo "  https://supabase.com/dashboard/account/tokens"
  exit 1
fi

# SQLファイルの内容を読み込み
SQL_CONTENT=$(cat "$SQL_FILE")

# Supabase Management API で SQL を実行
echo "Supabase API で実行中..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"query": %s}' "$(echo "$SQL_CONTENT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo "$SQL_CONTENT" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g' | awk '{printf "%s\\n", $0}' | sed 's/^/"/; s/$/"/')")" \
  2>&1)

# HTTP ステータスコードとレスポンスを分離
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
  echo ""
  echo "完了しました。"
  # 結果がある場合は表示
  if [ -n "$BODY" ] && [ "$BODY" != "[]" ] && [ "$BODY" != "null" ]; then
    echo "結果: $BODY"
  fi
else
  echo ""
  echo "エラー (HTTP $HTTP_CODE):"
  echo "$BODY"
  exit 1
fi

#!/bin/bash
# ============================================================
# Supabase SQL 実行スクリプト
# ============================================================
#
# SQLファイルを Supabase データベースに実行するスクリプトです。
# マイグレーションファイルやデータ追加を自動化できます。
#
# 使い方:
#   bash scripts/run-sql.sh <SQLファイル>
#   bash scripts/run-sql.sh migration-chat.sql
#   bash scripts/run-sql.sh setup-all.sql
#
# 初回セットアップ:
#   1. Supabase CLI をインストール: npm install -g supabase
#   2. ログイン: supabase login
#   3. プロジェクトをリンク: supabase link --project-ref jfsxywwufwdprqdkyxhr
#
# または直接データベース接続:
#   環境変数 DATABASE_URL を設定してください
#   例: export DATABASE_URL="postgresql://postgres:パスワード@db.jfsxywwufwdprqdkyxhr.supabase.co:5432/postgres"
# ============================================================

set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SQL_FILE="$1"

if [ -z "$SQL_FILE" ]; then
  echo "使い方: bash scripts/run-sql.sh <SQLファイル>"
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
  echo "⚠  注意: このファイルは一度だけ実行してください。"
  echo "   二重実行するとデータが重複する可能性があります。"
  echo ""
  read -p "実行しますか？ (y/N): " CONFIRM
  if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo "キャンセルしました。"
    exit 0
  fi
fi

# 方法1: DATABASE_URL が設定されている場合は psql を使用
if [ -n "$DATABASE_URL" ]; then
  echo "psql で実行中..."
  psql "$DATABASE_URL" -f "$SQL_FILE"
  echo ""
  echo "完了しました。"
  exit 0
fi

# 方法2: Supabase CLI が利用可能な場合
if command -v supabase &> /dev/null; then
  echo "Supabase CLI で実行中..."
  supabase db push --db-url "$(supabase db url 2>/dev/null || echo '')" < "$SQL_FILE" 2>/dev/null || {
    # フォールバック: supabase sql コマンド
    cat "$SQL_FILE" | supabase db execute 2>/dev/null || {
      echo ""
      echo "Supabase CLI での実行に失敗しました。"
      echo "以下を試してください:"
      echo "  1. supabase login"
      echo "  2. supabase link --project-ref jfsxywwufwdprqdkyxhr"
      echo "  3. このスクリプトを再実行"
      exit 1
    }
  }
  echo ""
  echo "完了しました。"
  exit 0
fi

# 方法3: 手動実行のガイド
echo "自動実行ツールが見つかりません。"
echo ""
echo "以下のいずれかの方法でSQLを実行してください:"
echo ""
echo "【方法A】Supabase ダッシュボード (最も簡単)"
echo "  1. https://supabase.com/dashboard にアクセス"
echo "  2. プロジェクトを選択"
echo "  3. 左メニュー「SQL Editor」を開く"
echo "  4. 「New query」をクリック"
echo "  5. SQLファイルの内容を貼り付けて「Run」"
echo ""
echo "【方法B】Supabase CLI をインストール"
echo "  npm install -g supabase"
echo "  supabase login"
echo "  supabase link --project-ref jfsxywwufwdprqdkyxhr"
echo "  bash scripts/run-sql.sh $(basename "$SQL_FILE")"
echo ""
echo "【方法C】psql で直接接続"
echo "  export DATABASE_URL=\"postgresql://postgres:パスワード@db.jfsxywwufwdprqdkyxhr.supabase.co:5432/postgres\""
echo "  bash scripts/run-sql.sh $(basename "$SQL_FILE")"

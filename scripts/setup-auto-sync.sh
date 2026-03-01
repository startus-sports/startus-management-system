#!/bin/bash
# ============================================================
# Claude Code 自動コミット＆プッシュ フック設定スクリプト
# ============================================================
#
# このスクリプトは Claude Code の hooks 設定を作成します。
# 実行すると、Claude Code でコード変更するたびに自動で:
#   1. git commit (変更を記録)
#   2. git push (GitHubに送信)
#   3. Vercel が自動デプロイ (サイト更新)
#
# 使い方:
#   bash scripts/setup-auto-sync.sh
#
# スマホ(Claude Code アプリ)でもPC(Claude Code CLI)でも動作します。
# ============================================================

set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLAUDE_DIR="$REPO_DIR/.claude"
SETTINGS_FILE="$CLAUDE_DIR/settings.local.json"

echo "=== Claude Code 自動同期セットアップ ==="
echo ""

# .claude ディレクトリ作成
mkdir -p "$CLAUDE_DIR"

# 既存の設定ファイルがある場合はバックアップ
if [ -f "$SETTINGS_FILE" ]; then
  BACKUP="$SETTINGS_FILE.backup.$(date +%Y%m%d_%H%M%S)"
  cp "$SETTINGS_FILE" "$BACKUP"
  echo "既存の設定をバックアップしました: $BACKUP"
fi

# hooks 設定を書き込み
cat > "$SETTINGS_FILE" << 'SETTINGS_EOF'
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|NotebookEdit",
        "hooks": [
          {
            "type": "command",
            "command": "cd \"$(git rev-parse --show-toplevel)\" && git add -A && git diff --cached --quiet || git commit -m \"auto: $(date +%Y%m%d_%H%M%S)\" && git push 2>/dev/null || true"
          }
        ]
      }
    ]
  }
}
SETTINGS_EOF

echo "設定ファイルを作成しました: $SETTINGS_FILE"
echo ""
echo "=== セットアップ完了 ==="
echo ""
echo "これで Claude Code でコードを変更するたびに、"
echo "自動で GitHub にプッシュされ、Vercel のサイトが更新されます。"
echo ""
echo "確認方法:"
echo "  1. Claude Code でコードを変更してもらう"
echo "  2. 少し待つ (1-2分)"
echo "  3. https://member-manager-nu.vercel.app で確認"

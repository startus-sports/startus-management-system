# CLAUDE.md - member-manager プロジェクト設定

## プロジェクト概要

STARTUS Sports Academy 会員管理システム。Vanilla JavaScript + Supabase のWebアプリ。
Vercel にデプロイ: https://member-manager-nu.vercel.app

## 重要ルール

- このリポジトリは **Private** です。絶対に Public にしないでください
- `config.js` にはAPIキーが含まれています。外部に公開しないこと
- `migration-*.sql` は一度だけ実行するファイルです。再実行禁止

## 自動コミット＆プッシュ

コード変更後は必ず以下を実行してください:
1. 変更内容を確認 (`git status`)
2. 変更をコミット (`git add` → `git commit`)
3. GitHubにプッシュ (`git push`)

これにより Vercel が自動デプロイし、サイトが更新されます。

## ファイル構成

```
member-admin/          メインアプリ
├── index.html         画面構造
├── style.css          スタイル
└── js/                JavaScript モジュール
    ├── app.js         メインロジック
    ├── config.js      設定・APIキー (★機密)
    ├── supabase.js    DB接続
    ├── schedule.js    スケジュールカレンダー
    ├── calendar.js    スタッフカレンダー
    ├── members.js     会員管理
    ├── applications.js 申請管理
    ├── trials.js      体験管理
    ├── classroom.js   教室管理
    ├── staff.js       スタッフ管理
    ├── fees.js        月謝管理
    └── chat.js        チャット
```

## データベース (Supabase)

主要テーブル: members, classrooms, applications, staff, fees, activity_log, app_config, chat_messages, trials

## コマンド

- デプロイ確認: `npx vercel ls`
- SQL実行: `bash scripts/run-sql.sh <ファイル名.sql>`

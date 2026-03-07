# UI リニューアル計画: ハイブリッド（サイドバー＋ダッシュボード）

## 概要

現在の水平タブバー（10タブ）をサイドバーナビゲーション＋ダッシュボードホーム画面に移行する。
将来の出席簿アプリ・ショップアプリ統合に対応できるスケーラブルな構造にする。

## デザイン仕様

- **アイコン**: Material Icons 28px（大きめ、視認性重視）
- **レイアウト**: アイコン＋テキスト横並び
- **サイドバー幅**: 展開時 220px / 折りたたみ時 60px（アイコンのみ）
- **グループ分け**: カテゴリヘッダー付きのセクション分け

## 完成イメージ

**展開時（デフォルト）:**
```
┌──────────────────────────────────────────────────────────┐
│  ☰  STARTUS Management System    [管理者] user@email ⊘  │
├──────────────┬───────────────────────────────────────────┤
│              │                                           │
│ 🏠 ホーム     │  ダッシュボード / 各画面コンテンツ          │
│              │                                           │
│ ── 会員 ──   │  ┌─通知──────────┐ ┌─今日の予定────┐     │
│ 👥 会員一覧   │  │新規申請 3件    │ │10:00 陸上A   │     │
│ 💰 会費一覧   │  │体験予約 2件    │ │14:00 バレエB │     │
│ 📋 申請  ③  │  └───────────────┘ └──────────────┘     │
│ 🔍 体験  ②  │                                          │
│              │  ┌─会員状況────────┐ ┌─クイックアクセス┐  │
│ ── 予定 ──   │  │在籍: 45名      │ │会員追加        │  │
│ 📅 カレンダー  │  │新規: 3名       │ │申請確認        │  │
│ 📆 スケジュール│  └───────────────┘ └───────────────┘  │
│ ⚙ スケ管理   │                                          │
│              │                                           │
│ ── その他 ── │                                           │
│ 👤 スタッフ   │                                           │
│ 📊 統計      │                                           │
│              │                                           │
│ ────────     │                                           │
│ ⚙ マスタ     │  ← 管理者のみ表示                         │
│              │                                           │
│   [« 折畳]   │  ← サイドバー下部にトグルボタン             │
│ 幅: 220px    │                                           │
└──────────────┴───────────────────────────────────────────┘
```

**折りたたみ時:**
```
┌──────────────────────────────────────────────────────────┐
│  ☰  STARTUS Management System    [管理者] user@email ⊘  │
├─────┬────────────────────────────────────────────────────┤
│     │                                                    │
│ 🏠  │  コンテンツエリア（幅が広がる）                      │
│     │                                                    │
│ ──  │                                                    │
│ 👥  │  ※ホバーでツールチップ表示                          │
│ 💰  │    例: 👥 にホバー → 「会員一覧」                    │
│ 📋③│                                                    │
│ 🔍②│                                                    │
│     │                                                    │
│ ──  │                                                    │
│ 📅  │                                                    │
│ 📆  │                                                    │
│ ⚙  │                                                    │
│     │                                                    │
│ ──  │                                                    │
│ 👤  │                                                    │
│ 📊  │                                                    │
│     │                                                    │
│ ──  │                                                    │
│ ⚙  │                                                    │
│     │                                                    │
│ [»] │  ← 展開ボタン                                      │
│60px │                                                    │
└─────┴────────────────────────────────────────────────────┘
```

**モバイル時（≤768px）:**
```
┌──────────────────────┐
│ ☰  STARTUS     ⊘    │  ← ハンバーガーメニュー
├──────────────────────┤
│  コンテンツエリア      │  サイドバーは非表示
│                      │
│                      │
└──────────────────────┘

☰クリックでサイドバーがオーバーレイ表示（展開状態で表示）
背景は半透明黒のオーバーレイ
```

## サイドバーメニュー構成

| グループ | アイコン | ラベル | 画面ID | バッジ |
|---------|---------|-------|--------|-------|
| — | home | ホーム | dashboard | — |
| 会員 | people | 会員一覧 | members | — |
| 会員 | payments | 会費一覧 | fee-overview | — |
| 会員 | description | 申請 | applications | 未処理件数 |
| 会員 | person_search | 体験管理 | trials | 未処理件数 |
| 予定 | calendar_month | カレンダー | calendar | — |
| 予定 | event_note | スケジュール | schedule | — |
| 予定 | event_available | スケ管理 | sm | — |
| その他 | badge | スタッフ | staff | — |
| その他 | bar_chart | 統計 | stats | — |
| 管理 | tune | マスタ | master | admin-only |
| 管理 | settings | 設定 | settings | admin-only |

※ 将来追加: 「出席簿」グループ、「ショップ」グループ

## 実装ステップ

### Phase 1: サイドバーHTML構造

**変更ファイル:** `startus-admin/index.html`

1. `<nav class="tab-bar">` を `<aside class="sidebar">` に置き換え
2. ヘッダーにハンバーガーボタン（`☰`）と折りたたみトグルを追加
3. サイドバー内の構造:
   ```html
   <aside class="sidebar" id="sidebar">
     <!-- ホーム -->
     <a class="sidebar-item active" data-tab="dashboard">
       <span class="material-icons">home</span>
       <span class="sidebar-label">ホーム</span>
     </a>
     <!-- グループ: 会員 -->
     <div class="sidebar-divider"><span class="sidebar-group-label">会員</span></div>
     <a class="sidebar-item" data-tab="members">
       <span class="material-icons">people</span>
       <span class="sidebar-label">会員一覧</span>
     </a>
     ...
     <!-- 下部: 折りたたみトグル -->
     <div class="sidebar-toggle" id="sidebar-toggle">
       <span class="material-icons">chevron_left</span>
     </div>
   </aside>
   <div class="sidebar-overlay" id="sidebar-overlay"></div>
   ```
4. `#app-screen` 内のレイアウトを `<div class="app-body">` で囲む（サイドバー＋メインコンテンツ）
5. ダッシュボードホーム画面（`#dashboard-screen`）を新規追加

### Phase 2: サイドバーCSS

**変更ファイル:** `startus-admin/style.css`

1. **`.sidebar`** スタイル:
   - 幅: `220px`（展開時）、`60px`（折りたたみ時: `.sidebar.collapsed`）
   - `position: sticky; top: 56px; height: calc(100vh - 56px)`
   - `overflow-y: auto`, `background: white`, `border-right`
   - `transition: width 0.2s ease`（スムーズなアニメーション）

2. **`.sidebar-item`** スタイル:
   - `display: flex; align-items: center; gap: 12px; padding: 12px 16px`
   - アイコン: `font-size: 28px`（大きめ）
   - ラベル: `font-size: 0.9rem; font-weight: 600`
   - ホバー: `background: var(--gray-50)`
   - アクティブ: `background: var(--primary-lighter); color: var(--primary-color); border-right: 3px solid`

3. **`.sidebar.collapsed`** 時:
   - `.sidebar-label` を `display: none`
   - `.sidebar-group-label` を `display: none`
   - アイテムを `justify-content: center; padding: 12px 0`
   - ホバーでツールチップ表示（`title` 属性 or CSS tooltip）

4. **`.sidebar-divider`** / **`.sidebar-group-label`**:
   - セパレーター線 + グループ名（小さいグレーテキスト）

5. **`.sidebar-overlay`**: モバイルオーバーレイ（半透明黒）

6. **レスポンシブ（≤768px）:**
   - サイドバーは `position: fixed; transform: translateX(-100%)`
   - `.sidebar.open` で `transform: translateX(0)` + オーバーレイ表示
   - ハンバーガーボタン表示

7. **`.app-body`**: サイドバー＋コンテンツの `display: flex` ラッパー

8. 既存の `.tab-bar` / `.tab-btn` CSS → 削除

### Phase 3: ダッシュボードホーム画面

**HTML（index.html内に追加）:**

```html
<main class="main-content" id="dashboard-screen">
  <h2>ダッシュボード</h2>
  <div class="dashboard-grid">
    <div class="dashboard-card" id="dash-notifications">通知</div>
    <div class="dashboard-card" id="dash-schedule">今日の予定</div>
    <div class="dashboard-card" id="dash-members">会員状況</div>
    <div class="dashboard-card" id="dash-quick">クイックアクセス</div>
  </div>
</main>
```

**新規JS: `js/dashboard.js`**
- 既存の notifications.js / schedule.js / members.js からデータ取得
- カード形式でサマリー表示

### Phase 4: ナビゲーションJS更新

**変更ファイル: `js/views.js`**

1. `switchTab()` に `'dashboard'` を追加、screens配列に `'dashboard-screen'` 追加
2. サイドバーのアクティブ状態管理（`.sidebar-item.active` の切り替え）
3. サイドバー折りたたみ/展開トグルロジック
4. モバイルでのサイドバー開閉＋オーバーレイ制御
5. 折りたたみ状態を `localStorage` に保存（ユーザーの好みを記憶）

**変更ファイル: `js/app.js`**

1. `initTabs` コールバックに `dashboard` を追加
2. 初期表示を `dashboard` に変更（現在は `members`）
3. `dashboard.js` のインポート追加
4. ハンバーガーボタンのイベントリスナー

### Phase 5: 既存画面のレイアウト調整

**変更ファイル: `style.css`**

1. `.main-content` の `max-width` / `margin` をサイドバー対応に調整
2. カレンダー/スケジュール画面のフル幅表示対応
3. サイドバー折りたたみ時のコンテンツ幅変化に `transition` を追加
4. スケジュール管理のサブタブ（`.sm-subtab-bar`）はそのまま維持

## 変更しないもの

- 各画面のコンテンツ構造（会員一覧、申請、体験など）はそのまま
- チャットのフローティングサイドバーはそのまま（ナビサイドバーとは別）
- スケジュール管理内のサブタブ（リスト/統計/カレンダー）はそのまま
- 全てのJS機能モジュールはそのまま（members.js, applications.js等）
- ログイン画面はそのまま

## ファイル変更サマリー

| ファイル | 変更内容 |
|---------|---------|
| `index.html` | タブバー→サイドバーに置換、app-body wrapper追加、ダッシュボード画面追加、ハンバーガーボタン追加 |
| `style.css` | サイドバーCSS追加（展開/折りたたみ/モバイル）、タブバーCSS削除、レスポンシブ調整 |
| `js/views.js` | サイドバーナビゲーション制御に書き換え（折りたたみ、モバイル開閉、localStorage保存） |
| `js/app.js` | ダッシュボード初期化追加、初期タブを dashboard に変更 |
| `js/dashboard.js` | **新規** - ダッシュボード表示ロジック |

## 将来の拡張

出席簿アプリ・ショップアプリを統合する際は:
1. サイドバーに新しいグループ（「出席簿」「ショップ」）を追加
2. 対応する画面HTMLとJSモジュールを追加
3. views.jsのscreens配列に追加

→ 既存の構造を変更せずに拡張可能

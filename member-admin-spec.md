# STARTUS Management System（STARTUS Admin）仕様書

## 1. プロジェクト概要

スポーツクラブ（インクルーシブ陸上）の会員情報を管理するWebアプリケーション。
事務局スタッフが Excel で管理していた会員データをクラウド（Supabase）に移行し、
ブラウザから会員の登録・編集・検索・Excel取込/出力ができるようにする。

**初版スコープ:**
- 会員一覧・検索・フィルタ・ソート
- 会員の追加・編集・削除
- Excel/CSV からの一括インポート
- CSV への一括エクスポート
- Google アカウントによるログイン（許可メールのみ）

**利用者:** 事務局スタッフのみ（2〜3名）

**将来の拡張予定（今回は対象外）:**
- 保護者/緊急連絡先管理
- 入金・会費管理
- 出欠管理アプリ（別プロジェクト、同じ Supabase に接続）との連携
- 会員向けポータル、スマホアプリ

---

## 2. 技術スタック

| 項目 | 選択 |
|------|------|
| バックエンド/DB | **Supabase**（PostgreSQL + Auth + REST API） |
| フロントエンド | **Vanilla JavaScript**（ES6 modules、バンドラーなし） |
| Supabase SDK | CDN `https://esm.sh/@supabase/supabase-js@2` |
| アイコン | Google Material Icons（CDN） |
| Excel読込 | SheetJS `<script>` タグで読込（xlsx対応） |
| 認証 | Supabase Auth（Google OAuth） |
| ホスティング | 任意（Firebase Hosting / Vercel / Netlify 等の静的サイトホスティング） |

---

## 3. ファイル構成

```
member-admin/
├── index.html            メインページ（ログイン＋アプリ、シングルページ）
├── style.css             スタイルシート
├── js/
│   ├── config.js          Supabase URL + anon key + 許可メール
│   ├── supabase.js        Supabase クライアント初期化
│   ├── auth.js            Google ログイン / ログアウト
│   ├── app.js             メインエントリ（init, toast, modal制御）
│   ├── members.js         会員 CRUD + 一覧表示 + 検索/フィルタ
│   ├── import.js          CSV/Excel インポート
│   ├── export.js          CSV エクスポート
│   └── utils.js           escapeHtml 等の共通ユーティリティ
└── README.md
```

---

## 4. Supabase セットアップ

### 4.1 テーブル作成 SQL

```sql
CREATE TABLE members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  member_number TEXT DEFAULT '',
  name TEXT NOT NULL,
  furigana TEXT DEFAULT '',
  member_type TEXT DEFAULT '会員',
  status TEXT DEFAULT '在籍',
  birthdate DATE,
  gender TEXT DEFAULT '',
  address TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  classes TEXT[] DEFAULT '{}',
  grade TEXT DEFAULT '',
  disability_info TEXT DEFAULT '',
  note TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- updated_at 自動更新トリガー
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON members
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- 検索用インデックス
CREATE INDEX idx_members_name ON members(name);
CREATE INDEX idx_members_status ON members(status);
CREATE INDEX idx_members_member_type ON members(member_type);
```

### 4.2 RLS（Row Level Security）

```sql
ALTER TABLE members ENABLE ROW LEVEL SECURITY;

-- 認証済みユーザーのみ全操作可能
CREATE POLICY "auth_all" ON members
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
```

### 4.3 認証設定

Supabase Dashboard で以下を設定:
1. Authentication > Providers > **Google** を有効化
2. Google Cloud Console で OAuth Client ID / Secret を取得して設定
3. Authentication > URL Configuration > Site URL にデプロイ先URLを設定
4. Redirect URLs にデプロイ先URLを追加

---

## 5. データモデル

### members テーブル

| カラム | 型 | デフォルト | 必須 | 説明 |
|--------|-----|-----------|------|------|
| id | UUID | gen_random_uuid() | auto | 主キー |
| member_number | TEXT | '' | | 会員番号（例: "001"） |
| name | TEXT | - | **必須** | 氏名 |
| furigana | TEXT | '' | | フリガナ |
| member_type | TEXT | '会員' | | 種別: 会員 / 体験 / スタッフ / 指導者 |
| status | TEXT | '在籍' | | 状態: 在籍 / 休会 / 退会 |
| birthdate | DATE | null | | 生年月日 |
| gender | TEXT | '' | | 性別: 男 / 女 / その他 |
| address | TEXT | '' | | 住所 |
| phone | TEXT | '' | | 電話番号 |
| email | TEXT | '' | | メールアドレス |
| classes | TEXT[] | '{}' | | 所属クラス（配列。例: ["Aクラス", "Bクラス"]） |
| grade | TEXT | '' | | 学年（例: "小3", "中1"） |
| disability_info | TEXT | '' | | 障がい・配慮事項 |
| note | TEXT | '' | | メモ |
| created_at | TIMESTAMPTZ | NOW() | auto | 登録日時 |
| updated_at | TIMESTAMPTZ | NOW() | auto | 更新日時（トリガーで自動更新） |

---

## 6. 認証フロー

### 6.1 設定ファイル（js/config.js）

```javascript
export const SUPABASE_URL = 'https://xxxxxxxxxxxx.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOi...';

// アクセス許可メールアドレス一覧（空の場合は全Googleアカウント許可）
export const ALLOWED_EMAILS = [
  'hisashimatsui@startus-kanazawa.org',
  'hisasimatu3117@gmail.com'
];

export const APP_NAME = 'STARTUS 会員管理';
```

### 6.2 フロー

1. ページ読み込み時に `supabase.auth.getSession()` でセッション確認
2. セッションなし → ログイン画面表示
3. 「Googleでログイン」ボタン → `supabase.auth.signInWithOAuth({ provider: 'google' })`
4. OAuth リダイレクト後、セッション取得
5. `ALLOWED_EMAILS` にメールが含まれるか確認
   - 含まれない → サインアウトしてエラー表示
   - 含まれる → アプリ画面表示
6. ログアウト → `supabase.auth.signOut()` → ページリロード

### 6.3 Supabase クライアント初期化（js/supabase.js）

```javascript
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```

---

## 7. 画面設計

### 7.1 ログイン画面

全画面グラデーション背景に白いカードが中央配置。

```
┌─────────────────────────────────┐
│     (グラデーション背景)          │
│                                  │
│   ┌────────────────────────┐    │
│   │  [manage_accounts icon] │    │
│   │      会員管理            │    │
│   │                          │    │
│   │  Googleアカウントで       │    │
│   │  ログインしてください     │    │
│   │                          │    │
│   │  [G] Googleでログイン    │    │
│   │                          │    │
│   │  (エラーメッセージ)       │    │
│   └────────────────────────┘    │
│                                  │
└─────────────────────────────────┘
```

### 7.2 メイン画面

```
┌──────────────────────────────────────────┐
│ [icon] 会員管理    user@email.com [logout]│  ← ヘッダー（グラデーション）
├──────────────────────────────────────────┤
│ 会員一覧                                  │
│ [+ 追加] [インポート] [CSV出力]           │  ← セクションヘッダー
│                                           │
│ [🔍 名前・フリガナ・番号で検索...]        │  ← 検索バー
│                                           │
│ [名前順 ▼] [絞込] [42名]                 │  ← ツールバー
│ ┌─ 絞込パネル ──────────────────────┐    │
│ │ ステータス: [在籍] [休会] [退会]    │    │
│ │ 種別: [会員] [体験] [スタッフ]    │    │
│ │ クラス: [Aクラス] [Bクラス] ...     │    │
│ └────────────────────────────────────┘    │
│                                           │
│ ┌─────────────────────────────────┐      │
│ │ [001] 山田 太郎  ヤマダ タロウ    │      │
│ │ [会員] [Aクラス] [小3] [在籍] →│      │  ← リストアイテム
│ └─────────────────────────────────┘      │
│ ┌─────────────────────────────────┐      │
│ │ [002] 鈴木 花子  スズキ ハナコ    │      │
│ │ [会員] [Bクラス] [小5] [在籍] →│      │
│ └─────────────────────────────────┘      │
│ ...                                       │
└──────────────────────────────────────────┘
```

### 7.3 会員詳細モーダル

リストアイテムをクリックで表示。読み取り専用。

```
┌────────────────────────────────┐
│ 会員詳細                    [×] │
├────────────────────────────────┤
│ 会員番号   001                  │
│ 氏名       山田 太郎            │
│ フリガナ   ヤマダ タロウ         │
│ 種別       会員               │
│ ステータス 在籍                  │
│ 生年月日   2015-04-01           │
│ 学年       小3                  │
│ 性別       男                   │
│ 電話番号   090-1234-5678        │
│ メール     ...                  │
│ 住所       金沢市〇〇            │
│ クラス     [Aクラス]             │
│ 障がい情報 自閉スペクトラム症     │
│ メモ       ...                  │
├────────────────────────────────┤
│      [編集]        [削除]       │
└────────────────────────────────┘
```

### 7.4 会員追加/編集モーダル

```
┌────────────────────────────────┐
│ 会員追加 (or 会員編集)      [×] │
├────────────────────────────────┤
│ [会員番号    ] [種別 ▼       ]  │  ← 横並び
│ [氏名 *                      ]  │
│ [フリガナ                    ]  │
│ [ステータス ▼] [性別 ▼       ]  │  ← 横並び
│ [生年月日    ] [学年          ]  │  ← 横並び
│ [電話番号                    ]  │
│ [メールアドレス              ]  │
│ [住所                        ]  │
│ [クラス（カンマ区切り入力）    ]  │
│ [障がい情報                  ]  │  ← textarea
│ [メモ                        ]  │  ← textarea
├────────────────────────────────┤
│            [キャンセル] [保存]   │
└────────────────────────────────┘
```

### 7.5 インポートモーダル

```
┌────────────────────────────────────┐
│ 会員インポート                  [×] │
├────────────────────────────────────┤
│  ┌──────────────────────────────┐  │
│  │ [cloud_upload]                │  │
│  │ CSV/Excelファイルを選択       │  │  ← ファイル選択エリア
│  └──────────────────────────────┘  │
│                                     │
│ (ファイル選択後 → プレビューテーブル)│
│ ┌───┬────┬────────┬────┬───┐      │
│ │ # │番号│ 氏名   │学年│...│      │  ← 編集可能テーブル
│ ├───┼────┼────────┼────┼───┤      │
│ │ 1 │001 │山田太郎│小3 │...│ [×]  │
│ │ 2 │002 │鈴木花子│小5 │...│ [×]  │
│ └───┴────┴────────┴────┴───┘      │
│                                     │
│ X件のデータが読み込まれました       │
│          [キャンセル] [インポート実行]│
└────────────────────────────────────┘
```

### 7.6 削除確認モーダル

```
┌────────────────────────┐
│ 確認                [×] │
├────────────────────────┤
│ 「山田太郎」を          │
│ 削除しますか？          │
│ この操作は元に戻せません│
│                         │
│   [キャンセル] [削除]   │
└────────────────────────┘
```

---

## 8. 機能仕様

### 8.1 会員一覧表示

- ページ読み込み時に Supabase から全会員を取得してメモリに保持
- **デフォルトフィルタ**: ステータス「在籍」のみ表示
- 検索・フィルタ・ソートはすべてクライアントサイドで実行

### 8.2 検索

- テキスト入力で即時フィルタ（input イベント）
- 対象フィールド: `name`, `furigana`, `member_number`, `email`
- 部分一致（大文字小文字を区別しない）

### 8.3 フィルタ

チェックボックス形式のピルボタン。複数選択可。

| フィルタ | 選択肢 | デフォルト |
|---------|--------|-----------|
| ステータス | 在籍 / 休会 / 退会 | 在籍のみON |
| 種別 | 会員 / 体験 / スタッフ / 指導者 | 全OFF（=全表示） |
| クラス | 会員データから動的生成 | 全OFF（=全表示） |

- フィルタ全OFFの場合 = 全件表示（そのフィルタカテゴリは適用しない）
- クラスフィルタ: 会員の `classes` 配列のいずれかがマッチすれば表示

### 8.4 ソート

セレクトボックス。選択肢:
- 名前順（デフォルト）
- 会員番号順
- クラス順
- 種別順

ソート設定は `localStorage` に保存して次回起動時に復元。

### 8.5 会員追加

1. 「追加」ボタン → 会員追加モーダル表示
2. フォーム入力（氏名のみ必須）
3. 「保存」→ Supabase に INSERT → 一覧リロード → モーダル閉じる → Toast「保存しました」
4. エラー時 → Toast「保存に失敗しました」

### 8.6 会員編集

1. リストアイテムクリック → 詳細モーダル表示
2. 「編集」ボタン → 編集モーダル表示（フォームに既存データを入力済み）
3. 「保存」→ Supabase に UPDATE → 一覧リロード → Toast
4. `classes` の入力: テキストフィールドにカンマ区切りで入力 → 保存時に配列に変換

### 8.7 会員削除

1. 詳細モーダルの「削除」ボタン → 確認モーダル表示
2. 「削除」確認 → Supabase から DELETE → 一覧リロード → Toast

### 8.8 CSV/Excel インポート

**対応フォーマット:** CSV（UTF-8）、Excel（.xlsx, .xls）

**ヘッダーマッピング（柔軟判定）:**

| DBカラム | 受け入れるヘッダー名（大文字小文字を区別しない） |
|---------|------------------------------------------------|
| member_number | 会員番号, memberNumber, No, No., 番号, ID |
| name | 氏名, 名前, name, お名前, フルネーム |
| furigana | フリガナ, ふりがな, 読み, furigana, カナ |
| member_type | 種別, タイプ, type, 会員種別, memberType |
| status | ステータス, 状態, status, 在籍状況 |
| birthdate | 生年月日, 誕生日, birthdate, birthday |
| gender | 性別, gender |
| address | 住所, address |
| phone | 電話番号, 電話, phone, TEL, tel |
| email | メールアドレス, メール, email, Email, E-mail |
| classes | クラス, class, classes |
| grade | 学年, grade |
| disability_info | 障がい情報, 障害, disability, 配慮事項 |
| note | メモ, 備考, note, notes |

**インポートフロー:**

1. 「インポート」ボタン → インポートモーダル表示
2. ファイル選択（.csv or .xlsx）
3. ファイル解析:
   - CSV: 自前のパーサー（ダブルクォート対応）
   - Excel: SheetJS (`XLSX.read()`) で最初のシートを読み込み
4. 1行目をヘッダーとして柔軟マッピング
5. プレビューテーブルを表示（各セル編集可能: `contenteditable`）
   - 各行に削除ボタン（行を除外）
   - 「X件のデータが読み込まれました」と表示
6. 「インポート実行」→ Supabase に一括 INSERT
   - `classes` フィールド: カンマ(,)、読点(、)、中黒(・)で分割して配列化
   - 氏名が空の行はスキップ
7. 完了 → Toast「XX件インポートしました」→ 一覧リロード

**CSVパース仕様:**
- UTF-8（BOM付きも対応）
- ダブルクォートで囲まれたフィールドのカンマ・改行に対応
- 空行はスキップ

### 8.9 CSV エクスポート

1. 「CSV出力」ボタン → 現在の表示中の全会員データをCSVダウンロード
2. UTF-8 + BOM（Excelで文字化けしないように）
3. ファイル名: `会員一覧_YYYY-MM-DD.csv`

**出力列:**
```
会員番号,氏名,フリガナ,種別,ステータス,生年月日,性別,住所,電話番号,メール,クラス,学年,障がい情報,メモ
```
- `classes` 配列は中黒（・）区切りで結合して出力
- 各フィールドはダブルクォートで囲む（カンマ含む場合の安全対策）

---

## 9. Supabase CRUD パターン

```javascript
import { supabase } from './supabase.js';

// 全件取得（名前順）
const { data, error } = await supabase
  .from('members')
  .select('*')
  .order('name');

// 追加
const { error } = await supabase
  .from('members')
  .insert({
    member_number: '001',
    name: '山田太郎',
    furigana: 'ヤマダ タロウ',
    member_type: '会員',
    status: '在籍',
    classes: ['Aクラス'],
    grade: '小3',
    // ... 他フィールド
  });

// 更新
const { error } = await supabase
  .from('members')
  .update({ name: '山田太郎', grade: '小4' })
  .eq('id', memberId);

// 削除
const { error } = await supabase
  .from('members')
  .delete()
  .eq('id', memberId);

// 一括インポート（バッチ INSERT）
const { error } = await supabase
  .from('members')
  .insert(rowsArray);  // 配列を渡せば一括挿入
```

---

## 10. デザインガイドライン

既存の出欠管理アプリ（attendance-app）と統一感を持たせるため、以下のデザインシステムを適用する。

### 10.1 CSS変数（:root）

```css
:root {
  /* メインカラー（グラデーションブルー） */
  --primary-color: #3b82f6;
  --primary-dark: #2563eb;
  --primary-darker: #1d4ed8;
  --primary-light: #dbeafe;
  --primary-lighter: #eff6ff;
  --primary-gradient: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
  --primary-gradient-hover: linear-gradient(135deg, #2563eb 0%, #7c3aed 100%);

  /* アクセントカラー（パープル） */
  --accent-color: #8b5cf6;
  --accent-light: #ede9fe;

  /* 成功（緑） */
  --success-color: #10b981;
  --success-light: #d1fae5;
  --success-dark: #059669;

  /* 危険（赤） */
  --danger-color: #ef4444;
  --danger-light: #fee2e2;
  --danger-dark: #dc2626;

  /* 警告（オレンジ） */
  --warning-color: #f59e0b;
  --warning-light: #fef3c7;
  --warning-dark: #d97706;

  /* ニュートラル */
  --gray-50: #f8fafc;
  --gray-100: #f1f5f9;
  --gray-200: #e2e8f0;
  --gray-300: #cbd5e1;
  --gray-400: #94a3b8;
  --gray-500: #64748b;
  --gray-600: #475569;
  --gray-700: #334155;
  --gray-800: #1e293b;
  --gray-900: #0f172a;

  /* レガシー互換 */
  --gray-light: var(--gray-50);
  --gray: var(--gray-500);
  --gray-dark: var(--gray-800);
  --border-color: var(--gray-200);

  /* シャドウ */
  --shadow-xs: 0 1px 2px 0 rgb(0 0 0 / 0.03);
  --shadow-sm: 0 1px 3px 0 rgb(0 0 0 / 0.05), 0 1px 2px -1px rgb(0 0 0 / 0.05);
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.05);
  --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.05);
  --shadow-xl: 0 20px 25px -5px rgb(0 0 0 / 0.08), 0 8px 10px -6px rgb(0 0 0 / 0.05);
  --shadow-2xl: 0 25px 50px -12px rgb(0 0 0 / 0.15);
  --shadow-colored: 0 4px 14px 0 rgb(59 130 246 / 0.25);

  /* ボーダー半径 */
  --radius-xs: 4px;
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 20px;
  --radius-2xl: 24px;
  --radius-full: 9999px;

  /* トランジション */
  --transition-fast: 0.15s ease;
  --transition-normal: 0.2s ease;
  --transition-slow: 0.3s ease;
  --transition-bounce: 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

### 10.2 フォント

```css
body {
  font-family: 'Segoe UI', 'Hiragino Sans', 'Meiryo', sans-serif;
  background-color: #f5f5f5;
  color: #333;
  line-height: 1.6;
}
```

### 10.3 主要コンポーネントのスタイルガイド

**ヘッダー:**
- `background: var(--primary-gradient)`, `color: white`, `position: sticky`, `top: 0`
- 左: アイコン + タイトル、右: ユーザーメール + ログアウトボタン（丸型、半透明白背景）

**ボタン（プライマリ）: `.add-btn`**
- `background: var(--primary-gradient)`, `color: white`, `border-radius: var(--radius-lg)`
- ホバー: `translateY(-2px)`, `box-shadow: var(--shadow-colored)`
- アイコン + テキスト flex レイアウト

**ボタン（セカンダリ）: `.add-btn.secondary`**
- `background: white`, `color: var(--primary-color)`, `border: 2px solid var(--primary-color)`

**リストアイテム: `.list-item`**
- `background: white`, `border-radius: var(--radius-lg)`, `box-shadow: var(--shadow-sm)`
- 左に4pxのアクセントバー（ホバー時に表示: `var(--primary-gradient)`）
- ホバー: `translateY(-2px)`, `box-shadow: var(--shadow-md)`
- クリッカブル: `cursor: pointer`、右に `>` 矢印アイコン

**リストアイテム内部:**
```
.list-item
├── .list-item-info
│   ├── .list-item-name（名前 + 会員番号バッジ + フリガナ）
│   ├── .list-item-sub（種別バッジ + クラスバッジ + 学年 + ステータス）
│   └── .list-item-classes（クラスバッジ群）
└── .list-item-arrow（> 矢印アイコン）
```

**バッジ:**
- 会員番号: `background: var(--primary-gradient)`, `color: white`, `border-radius: var(--radius-full)`, `font-size: 0.75rem`, `font-weight: 700`
- クラス: `background: linear-gradient(135deg, var(--primary-light) 0%, #c7d2fe 100%)`, `color: var(--primary-dark)`, `font-size: 0.72rem`
- 種別/ステータス: 色分けされたピルバッジ

**ツールバー: `.toolbar`**
- `background: white`, `border-radius: var(--radius-lg)`, `border: 1px solid var(--gray-200)`
- ソートセレクト + 絞込ボタン + 件数バッジが横並び
- 絞込ボタンクリックで `.toolbar-filter-panel` が展開: `display: block`

**フィルタチェックボックス: `.filter-checkboxes label`**
- ピル形状（`border-radius: var(--radius-full)`）
- チェック済み: `background: var(--primary-light)`, `border-color: var(--primary-color)`, `color: var(--primary-dark)`
- `<input type="checkbox">` は `display: none`、label のクリックでトグル

**モーダル: `.modal`**
- オーバーレイ: `background: rgba(15, 23, 42, 0.6)`, `backdrop-filter: blur(4px)`
- コンテンツ: `max-width: 500px`, `max-height: 90vh`, `overflow-y: auto`
- ヘッダー: `background: var(--gray-light)`, `border-bottom`, `padding: 18px 24px`
- アニメーション: fadeIn + slideUp

**フォーム:**
- `.form-group input/select/textarea`: `border: 2px solid var(--gray-200)`, `border-radius: var(--radius-md)`, `padding: 12px 16px`
- フォーカス: `border-color: var(--primary-color)`, `box-shadow: 0 0 0 4px var(--primary-lighter)`
- `.form-row`: 横並び（`display: flex`, `gap: 16px`）
- `.form-actions`: `justify-content: flex-end`, `gap: 12px`, `border-top`

**Toast通知:**
- 画面下部中央に表示（下部ナビがある場合は80px上に）
- 白背景、左に色付きボーダー（4px）
- タイプ: success(緑), error(赤), warning(オレンジ), info(青)
- 3秒後に自動消去
- アニメーション: 下から slideUp

**空の状態:**
- 中央揃え、`padding: 60px`, `color: var(--gray-400)`
- Material Icons の `inbox` アイコン（48px, gray-300）
- テキスト: 「会員データがありません」

### 10.4 レスポンシブ

- モバイルブレークポイント: `max-width: 600px`
- モバイル: ヘッダーのパディング縮小、メインコンテンツ `padding: 12px`
- フォーム `.form-row`: モバイルでは `flex-direction: column`
- モーダル: `width: 95%`
- ボタンテキスト: 必要に応じてアイコンのみに縮小

### 10.5 アクセシビリティ

- `focus-visible`: `outline: 2px solid var(--primary-color)`, `outline-offset: 2px`
- `-webkit-tap-highlight-color: transparent`
- セレクション: `background: var(--primary-light)`, `color: var(--primary-darker)`

---

## 11. エラーハンドリング

| 操作 | 成功時 | 失敗時 |
|------|--------|--------|
| 会員読み込み | 一覧表示 | console.error + 空配列返却 |
| 会員保存 | Toast「保存しました」 | Toast「保存に失敗しました」+ console.error |
| 会員削除 | Toast「削除しました」 | Toast「削除に失敗しました」+ console.error |
| インポート | Toast「XX件インポートしました」 | Toast「インポートに失敗しました」+ 件数表示 |
| CSV出力 | ダウンロード開始 + Toast | Toast「エクスポートに失敗しました」 |

---

## 12. セキュリティ

- **XSS対策**: すべてのユーザー入力は `escapeHtml()` でエスケープしてからDOMに挿入
- **Supabase RLS**: 認証済みユーザーのみデータアクセス可能
- **メール制限**: アプリ側で `ALLOWED_EMAILS` チェック（RLSに加えた二重チェック）
- **Supabase anon key**: 公開鍵（RLSが保護するため安全）

```javascript
// js/utils.js
export function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
```

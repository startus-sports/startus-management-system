# STARTUS システム統合 詳細計画書

**作成日:** 2026-03-05
**作成者:** 松井
**バージョン:** 1.0

---

## 目次

1. [プロジェクト概要](#1-プロジェクト概要)
2. [現状分析](#2-現状分析)
3. [目標アーキテクチャ](#3-目標アーキテクチャ)
4. [Phase 0: 基盤準備](#4-phase-0-基盤準備)
5. [Phase 1: スケジュール入力の統合](#5-phase-1-スケジュール入力の統合)
6. [Phase 2: 教室マスタの移行](#6-phase-2-教室マスタの移行)
7. [Phase 3: フォーム日程取得の移行](#7-phase-3-フォーム日程取得の移行)
8. [Phase 4: HP カレンダー Widget の移行](#8-phase-4-hp-カレンダー-widget-の移行)
9. [Phase 5: 出席管理アプリの開発](#9-phase-5-出席管理アプリの開発)
10. [リスク管理・ロールバック方針](#10-リスク管理ロールバック方針)
11. [アカウント・インフラ管理](#11-アカウントインフラ管理)
12. [開発・デプロイフロー](#12-開発デプロイフロー)

---

## 1. プロジェクト概要

### 1.1 背景

STARTUS スポーツアカデミーの業務システムは、以下の複数サービスに分散している：
- SharePoint（教室マスタ管理）
- Google Calendar + Sgrum（スケジュール入力・表示）
- Google Apps Script（フォーム処理・HP カレンダー表示）
- Microsoft Forms（フォームタグ取得）
- Supabase + Vercel（会員管理アプリ）
- 別 Supabase（スケジュール管理アプリ・開発中）

### 1.2 目的

- 全業務データを **1つの Supabase データベース** に集約
- 管理画面を **1つの Web アプリ（member-manager）** に統合
- **組織アカウント** で運用し、個人依存を解消
- 将来の出席管理アプリの基盤を構築

### 1.3 対象システム

| システム | 現在の役割 | 統合後 |
|----------|-----------|--------|
| member-manager | 会員・申請・体験・月謝管理 | 統合プラットフォーム（拡張） |
| calendar-manager | スケジュール管理（開発中） | member-manager の1タブに統合 |
| attendance app | 未開発 | member-manager の1タブとして新規追加 |
| GAS フォーム | 体験・入会等の申請受付 | 継続利用（データソースのみ Supabase に変更） |
| GAS カレンダー Widget | HP 上のスケジュール表示 | 継続利用（データソースのみ変更） |
| SharePoint ClassList | 教室マスタ管理 | Supabase に移行、廃止 |
| Sgrum | Google Calendar への入力 | member-manager に移行、廃止 |

---

## 2. 現状分析

### 2.1 データフロー図（AS-IS）

```
┌──────────┐    手動入力    ┌───────────────┐
│ Sgrum  │──────────────→│Google Calendar │
└──────────┘               └───────┬───────┘
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
            ┌──────────────┐ ┌─────────┐ ┌──────────────┐
            │GAS Schedule  │ │GAS      │ │GAS Calendar  │
            │API           │ │体験Form │ │Widget(HP)    │
            └──────┬───────┘ └────┬────┘ └──────────────┘
                   │              │
                   ▼              │
            ┌──────────────┐     │
            │member-admin  │     │
            │スケジュールタブ│     │
            └──────────────┘     │
                                 │
┌───────────────────┐            │
│SharePoint         │            │
│ClassList          │────────────┤ 教室一覧取得
│（教室マスタ）      │            │
└───────────────────┘            │
                                 │
┌───────────────────┐            │
│Microsoft Forms    │────────────┘ タグ情報取得
│（フォームタグ）    │
└───────────────────┘
```

### 2.2 データソースの重複状況

| データ | 現在の正本 | コピーが存在する場所 |
|--------|-----------|-------------------|
| 教室マスタ | SharePoint ClassList | Supabase(member) classrooms, Supabase(calendar) classrooms |
| スケジュール | Google Calendar | GAS API キャッシュ, Supabase(calendar) schedules |
| 会員情報 | Supabase(member) members | ― |
| 申請データ | Supabase(member) applications | SharePoint Lists |

### 2.3 現在のサービスアカウント

| サービス | アカウント | 種別 |
|----------|-----------|------|
| GitHub | hisas（松井個人） | 個人 |
| Supabase (member) | 松井個人 | 個人 |
| Supabase (calendar) | 松井個人 | 個人 |
| Vercel | 松井個人 | 個人 |
| Google Workspace | startus-kanazawa.org | 組織 |
| SharePoint/M365 | startus-kanazawa.org | 組織 |

### 2.4 現在の Supabase テーブル（member-manager）

| テーブル | 用途 | レコード規模 |
|----------|------|-------------|
| members | 会員マスタ | 数百件 |
| classrooms | 教室マスタ | ~30件 |
| applications | 各種申請 | 増加中 |
| trials | 体験記録 | 増加中 |
| staff | スタッフ管理 | ~10件 |
| fees | 月謝記録 | 月×会員数 |
| activity_log | 操作ログ | 増加中 |
| app_config | アプリ設定 | 数件 |
| chat_messages | チャット | 増加中 |

### 2.5 現在の Supabase テーブル（calendar-manager・別インスタンス）

| テーブル | 用途 | レコード規模 |
|----------|------|-------------|
| classrooms | 教室マスタ（重複） | ~30件 |
| schedules | スケジュール | 教室数×年間36回 |

### 2.6 カレンダータグの連携構造

現在、以下の3箇所で同じ `calendar_tag` 値が一致している必要がある：

```
Google Calendar イベント説明文: #class=kidsdance
SharePoint ClassList:          CalendarTag = "kidsdance"
Supabase classrooms:           calendar_tag = "kidsdance"
```

この一致が崩れると、フォームの日程表示やスケジュール画面のマッチングが壊れる。

---

## 3. 目標アーキテクチャ

### 3.1 データフロー図（TO-BE）

```
┌──────────────────────────────────────────────────────────┐
│  STARTUS 統合管理アプリ（member-manager 拡張）             │
│                                                          │
│  ┌────────┐ ┌──────────┐ ┌────────┐ ┌────────┐ ┌──────┐ │
│  │会員管理 │ │スケジュール│ │出席管理│ │申請管理 │ │マスタ │ │
│  └────────┘ └──────────┘ └────────┘ └────────┘ └──────┘ │
│                                                          │
└────────────────────┬─────────────────────────────────────┘
                     │ 読み書き
                     ▼
┌──────────────────────────────────────────────────────────┐
│  Supabase（統一 DB・組織アカウント）                        │
│                                                          │
│  members | classrooms | schedules | attendance           │
│  applications | trials | fees | staff                    │
│  activity_log | app_config | chat_messages               │
│                                                          │
└────────────────────┬─────────────────────────────────────┘
                     │ 自動同期（一方向）
                     ▼
              ┌──────────────┐
              │Google Calendar│ ← 公開スケジュールのみ同期
              └──────┬───────┘
                     │ 表示
          ┌──────────┼──────────┐
          ▼          ▼          ▼
     HP カレンダー  GASフォーム   外部表示
     Widget        日程取得
```

### 3.2 統合後のデータソース

| データ | 唯一の正本 | 下流（読み取り専用） |
|--------|-----------|-------------------|
| 教室マスタ | Supabase classrooms | GAS フォーム、HP Widget |
| スケジュール | Supabase schedules | Google Calendar、GAS フォーム、HP Widget |
| 会員情報 | Supabase members | ― |
| 申請データ | Supabase applications | ― |
| 出席データ | Supabase attendance | ― |

### 3.3 廃止されるサービス

| サービス | 廃止時期 | 代替 |
|----------|---------|------|
| SharePoint ClassList | Phase 2 完了後 | Supabase classrooms |
| Sgrum | Phase 1 完了後 | member-admin スケジュール管理タブ |
| Supabase (calendar-manager 別インスタンス) | Phase 0 完了後 | 統一 Supabase に統合 |
| Microsoft Forms タグ取得 | Phase 2 完了後 | Supabase classrooms |

---

## 4. Phase 0: 基盤準備

**目的:** 統合の土台を作る。職員への影響なし。

### 4.0 アカウント移行

#### 4.0.1 GitHub Organization 作成

| 項目 | 内容 |
|------|------|
| 作業 | GitHub Organization を作成（startus-kanazawa 等） |
| 手順 | 1. github.com で Organization 作成<br>2. 松井アカウントを Owner に追加<br>3. member-manager リポジトリを Organization に Transfer<br>4. calendar-manager リポジトリも同様に Transfer |
| 費用 | 無料（Free プランで Private repo 可） |
| リスク | 低（Transfer 機能で URL リダイレクトが自動設定される） |
| 確認事項 | Vercel の GitHub 連携が Transfer 後も動作するか確認 |

#### 4.0.2 Supabase Organization 作成

| 項目 | 内容 |
|------|------|
| 作業 | Supabase Organization を作成、統一プロジェクトを構築 |
| 手順 | 1. Supabase で Organization 作成<br>2. 新プロジェクト作成（本番用）<br>3. 新プロジェクト作成（テスト用）<br>4. 既存テーブルを新プロジェクトに再作成<br>5. 既存データを移行（pg_dump / CSV）<br>6. RLS ポリシーを再設定<br>7. config.js の接続先を新プロジェクトに変更 |
| 費用 | 無料（Free プランで2プロジェクトまで） |
| リスク | 中（データ移行時の欠損に注意。旧プロジェクトは削除せず保持） |
| 確認事項 | Anon Key が変わるため、GAS の Supabase 送信コードも更新が必要 |

#### 4.0.3 Vercel 設定変更

| 項目 | 内容 |
|------|------|
| 作業 | GitHub Organization のリポジトリにデプロイ元を変更 |
| 手順 | 1. Vercel ダッシュボードで Git 連携を更新<br>2. 環境変数（必要に応じて）を設定<br>3. デプロイ確認 |
| 費用 | 当面 Hobby プラン（無料）で継続可。将来 Team 移行を検討 |
| リスク | 低 |

### 4.1 Supabase DB 統合

#### 4.1.1 calendar-manager テーブルの移行

| 項目 | 内容 |
|------|------|
| 作業 | calendar-manager の schedules テーブルを統一 DB に作成 |
| SQL | schedules テーブル定義 + インデックスを統一 DB で実行 |
| データ | calendar-manager に既存スケジュールデータがあれば移行 |

**schedules テーブル定義:**

```sql
CREATE TABLE schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_name TEXT NOT NULL,
  class_id TEXT,
  coach_name TEXT,
  date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  venue TEXT,
  status TEXT NOT NULL DEFAULT 'tentative'
    CHECK (status IN ('tentative', 'confirmed', 'canceled')),
  is_published BOOLEAN NOT NULL DEFAULT false,
  is_trial_ok BOOLEAN NOT NULL DEFAULT true,
  fiscal_year TEXT NOT NULL,
  batch_group_id TEXT,
  google_event_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_schedules_fiscal_year ON schedules(fiscal_year);
CREATE INDEX idx_schedules_class_name ON schedules(class_name);
CREATE INDEX idx_schedules_date ON schedules(date);
CREATE INDEX idx_schedules_class_id ON schedules(class_id);
CREATE INDEX idx_schedules_google_event_id ON schedules(google_event_id);
```

**RLS ポリシー:**

```sql
-- 認証ユーザーは全操作可
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_full_access" ON schedules
  FOR ALL USING (auth.role() = 'authenticated');

-- 匿名ユーザーは公開スケジュールのみ読み取り可
CREATE POLICY "anon_read_published" ON schedules
  FOR SELECT USING (is_published = true);
```

#### 4.1.2 classrooms テーブルの統一

| 項目 | 内容 |
|------|------|
| 作業 | 既存の member-manager classrooms テーブルに不足カラムを追加 |
| 追加カラム | `class_id TEXT UNIQUE`（calendar-manager との紐付け用）<br>`start_time TIME`<br>`end_time TIME`<br>`coach_name TEXT`（main_coach と別名で保持 or 統一）<br>`is_trial_ok BOOLEAN DEFAULT true` |
| データ | calendar-manager の classroom データと突合・統一 |

#### 4.1.3 確認項目

- [ ] 統一 DB で member-admin の全機能が動作すること
- [ ] classrooms テーブルのデータが正しいこと
- [ ] schedules テーブルが作成されていること
- [ ] RLS ポリシーが正しく動作すること

### 4.2 calendar-manager のドッキング

#### 4.2.1 モジュール移植

| 移植元（calendar-manager） | 移植先（member-admin/js/） | 備考 |
|---------------------------|--------------------------|------|
| js/dashboard.js | js/schedule-admin.js | スケジュール管理 UI |
| js/generator.js | js/schedule-generator.js | 一括生成機能 |
| js/calendar-view.js | js/schedule-calendar.js | FullCalendar 表示 |
| js/gcal.js | js/gcal.js | Google Calendar 同期 |
| js/ics-import.js | js/ics-import.js | ICS インポート |
| js/schedules.js | js/schedules-db.js | CRUD 操作 |
| js/classrooms.js | 既存 classroom.js に統合 | 教室データ取得 |
| js/role.js | 既存 auth.js に統合 | 権限管理 |

#### 4.2.2 UI 統合

| 作業 | 内容 |
|------|------|
| タブ追加 | index.html に「スケジュール管理」タブを追加（既存「スケジュール」タブとは別） |
| CSS 統合 | calendar-manager の style.css を member-admin の style.css にマージ |
| FullCalendar | CDN リンクを index.html に追加 |
| 設定 | config.js に Google Calendar API 設定を追加 |

#### 4.2.3 config.js の変更

```javascript
// 追加設定
export const GCAL_CLIENT_ID = '...';  // Google Calendar OAuth
export const GCAL_API_KEY = '...';    // Google Calendar API Key
export const GCAL_CALENDAR_ID = 'kssports@friend.ocn.ne.jp';
export const SCHEDULE_TARGET_COUNT = 36;  // 年間目標回数
```

#### 4.2.4 既存スケジュールタブとの関係

| タブ | 役割 | 対象 |
|------|------|------|
| スケジュール（既存） | 閲覧用カレンダー（GAS API経由） | 全スタッフ |
| スケジュール管理（新） | 入力・編集・生成・GCal同期 | 管理者 |

Phase 1 完了後、既存「スケジュール」タブのデータソースを GAS API → Supabase schedules に切り替え、最終的に2つのタブを統合する。

#### 4.2.5 完了条件

- [ ] member-admin 内で「スケジュール管理」タブが動作
- [ ] スケジュールの CRUD（作成・読取・更新・削除）が可能
- [ ] 年間一括生成が動作
- [ ] FullCalendar でスケジュール表示が可能
- [ ] Google Calendar 同期（公開→GCal作成、非公開→GCal削除）が動作
- [ ] 統一 Supabase の schedules テーブルを使用していること
- [ ] 接続先が config.js の統一 Supabase URL であること

---

## 5. Phase 1: スケジュール入力の統合

**目的:** スケジュールの入力方法を Sgrum → member-admin に移行。
**職員への影響:** あり（入力方法が変わる）

### 5.1 移行手順

| ステップ | 作業 | 詳細 |
|---------|------|------|
| 5.1.1 | 既存スケジュールの移行 | Google Calendar の既存イベントを schedules テーブルにインポート（ICS Import 機能を使用） |
| 5.1.2 | Google Calendar 同期の有効化 | `is_published = true` のスケジュールを GCal に同期 |
| 5.1.3 | 動作検証 | テスト環境で一括生成→GCal同期→HPカレンダー表示の一連フローを確認 |
| 5.1.4 | 職員研修 | スケジュール管理タブの使い方を説明 |
| 5.1.5 | 切り替え | Sgrum での入力を停止、member-admin での入力に移行 |

### 5.2 並行運用期間

切り替え直後の2週間は並行運用を推奨：
- member-admin で入力 → GCal に同期
- HP カレンダーが正しく表示されることを毎日確認
- 問題があれば Sgrum に戻す（ロールバック可能）

### 5.3 GAS Schedule API の扱い

| 段階 | API の状態 |
|------|-----------|
| Phase 1 開始時 | GAS API は稼働中。member-admin「スケジュール」タブはまだ GAS API を使用 |
| Phase 1 完了後 | 「スケジュール」タブのデータソースを Supabase schedules に切り替え |
| 最終 | GAS Schedule API を廃止 |

### 5.4 確認項目

- [ ] member-admin から年間スケジュールを一括生成できる
- [ ] 生成したスケジュールが Google Calendar に同期される
- [ ] HP のカレンダー Widget にスケジュールが正しく表示される
- [ ] 体験フォームの日程表示に影響がないこと（GCal経由で表示されるため）
- [ ] 「スケジュール」タブ（閲覧用）のデータソースを Supabase に切り替え済み
- [ ] Sgrum での入力を停止

---

## 6. Phase 2: 教室マスタの移行

**目的:** 教室マスタの正本を SharePoint → Supabase に移行。
**職員への影響:** あり（教室追加・変更の手順が変わる）

### 6.1 データ移行

#### 6.1.1 SharePoint → Supabase のカラムマッピング

| SharePoint カラム | Supabase カラム | 備考 |
|------------------|----------------|------|
| Title | name | 教室名 |
| Category | category | カテゴリ |
| DayOfWeek | day_of_week | TEXT[] 配列 |
| CalendarTag | calendar_tag | ★ フォーム連携のキー |
| FurikaeGroup | furikae_group | 振替グループ |
| Target | target | 対象年齢 |
| TimeSlot | time_slot | 表示用時間帯 |
| Venue | venue | 会場 |
| MainCoach | main_coach | 担当コーチ |
| Capacity | capacity | 定員 |
| Fee | fee | 月謝 |
| ClassCode | class_code | コード |
| Memo | memo | メモ |
| SortOrder | display_order | 表示順 |

#### 6.1.2 移行手順

| ステップ | 作業 |
|---------|------|
| 6.1.2a | SharePoint ClassList の全データを CSV エクスポート |
| 6.1.2b | Supabase classrooms テーブルのデータと突合 |
| 6.1.2c | 差分があれば Supabase 側を更新 |
| 6.1.2d | CalendarTag の一致を全教室分検証 |

### 6.2 GAS フォームの修正

#### 6.2.1 体験フォーム（STARTUS_taiken_form/code.gs）

**変更箇所:** 教室一覧の取得元

```javascript
// === 変更前 ===
// SharePoint Graph API から教室取得
const url = `https://graph.microsoft.com/v1.0/sites/${SITE_ID_FULL}/lists/${CLASS_LIST_ID}/items?expand=fields(select=Title,Category,SortOrder,CalendarTag)`;
const options = {
  method: 'get',
  headers: { 'Authorization': 'Bearer ' + getAccessToken() }
};
const res = UrlFetchApp.fetch(url, options);

// === 変更後 ===
// Supabase REST API から教室取得
const SUPABASE_URL = 'https://xxxxx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJ...';
const url = `${SUPABASE_URL}/rest/v1/classrooms?is_active=eq.true&order=display_order.asc&select=name,category,calendar_tag,display_order`;
const options = {
  method: 'get',
  headers: {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
  }
};
const res = UrlFetchApp.fetch(url, options);
```

**データ変換:**

```javascript
// 変更前: SharePoint 形式
items.map(item => ({
  name: item.fields.Title,
  category: item.fields.Category,
  id: item.fields.CalendarTag || item.fields.Title
}));

// 変更後: Supabase 形式（そのまま使える）
items.map(item => ({
  name: item.name,
  category: item.category,
  id: item.calendar_tag || item.name
}));
```

#### 6.2.2 その他フォームの修正

以下のフォームでも同様の修正が必要：

| フォーム | ファイル | 修正内容 |
|----------|---------|---------|
| 入会フォーム | STARTUS_join_form/code.gs | 教室取得を Supabase に変更 |
| 振替フォーム | （該当ファイル） | 教室取得を Supabase に変更 |
| 退会フォーム | （該当ファイル） | 教室取得を Supabase に変更 |
| 変更フォーム | （該当ファイル） | 教室取得を Supabase に変更 |

#### 6.2.3 Supabase RLS 設定

```sql
-- 匿名ユーザーが教室一覧を読み取れるようにする
CREATE POLICY "anon_read_classrooms" ON classrooms
  FOR SELECT USING (is_active = true);
```

### 6.3 並行運用期間

| 期間 | 状態 |
|------|------|
| 移行前 | SharePoint が正本。Supabase はコピー |
| 移行直後（2週間） | Supabase が正本。SharePoint も更新を継続（バックアップ） |
| 安定後 | SharePoint の更新を停止。Supabase のみ |

### 6.4 確認項目

- [ ] Supabase classrooms の全教室データが SharePoint と一致
- [ ] 全教室の calendar_tag が正しいこと
- [ ] 体験フォームで教室一覧が正しく表示される
- [ ] 体験フォームで教室選択後のカレンダー表示が正しい
- [ ] 入会・振替・退会・変更フォームでも同様に動作
- [ ] member-admin「マスタ」タブで教室の追加・編集が可能
- [ ] 教室変更がフォームに即反映される

---

## 7. Phase 3: フォーム日程取得の移行

**目的:** フォームの日程表示を Google Calendar → Supabase schedules に移行。
**職員への影響:** なし（裏側の変更のみ）

### 7.1 現在の日程取得フロー（体験フォーム）

```
ユーザーが教室を選択
  ↓
GAS が Google Calendar API で教室の CalendarTag に一致するイベントを取得
  ↓
#class=XXX タグでフィルタ
  ↓
#taiken=NG タグで体験不可日を除外
  ↓
日程一覧をフォームに表示
```

### 7.2 移行後の日程取得フロー

```
ユーザーが教室を選択
  ↓
GAS が Supabase REST API で教室の class_id に一致する公開スケジュールを取得
  ↓
is_trial_ok = false のスケジュールを除外
  ↓
日程一覧をフォームに表示
```

### 7.3 GAS コードの変更

```javascript
// === 変更前 ===
function getCalendarDates(classId, className, startDate, endDate) {
  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  const events = calendar.getEvents(startDate, endDate);
  return events.filter(event => {
    const desc = event.getDescription();
    const tagMatch = desc.match(/#class=([^\s#<]+)/i);
    return tagMatch && tagMatch[1] === classId;
  }).filter(event => {
    const desc = event.getDescription();
    return !desc.includes('#taiken=NG');
  });
}

// === 変更後 ===
function getCalendarDates(classId, className, startDate, endDate) {
  const startStr = Utilities.formatDate(startDate, 'Asia/Tokyo', 'yyyy-MM-dd');
  const endStr = Utilities.formatDate(endDate, 'Asia/Tokyo', 'yyyy-MM-dd');

  const url = `${SUPABASE_URL}/rest/v1/schedules`
    + `?class_id=eq.${encodeURIComponent(classId)}`
    + `&date=gte.${startStr}`
    + `&date=lte.${endStr}`
    + `&is_published=eq.true`
    + `&status=neq.canceled`
    + `&is_trial_ok=eq.true`
    + `&order=date.asc`
    + `&select=date,start_time,end_time,venue,class_name`;

  const options = {
    method: 'get',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    }
  };
  const res = UrlFetchApp.fetch(url, options);
  return JSON.parse(res.getContentText());
}
```

### 7.4 メリット

| 項目 | Google Calendar 方式 | Supabase 方式 |
|------|---------------------|--------------|
| 体験可否の判定 | `#taiken=NG` タグ解析 | `is_trial_ok` フラグ（明確） |
| キャンセル日の除外 | タグ or 手動 | `status = 'canceled'`（明確） |
| クエリ速度 | Calendar API 制限あり | REST API 高速 |
| 定員情報 | `#cap=N` タグ解析 | 将来 attendance と連携可 |

### 7.5 確認項目

- [ ] 体験フォームで教室選択後の日程が正しく表示される
- [ ] 体験不可（is_trial_ok=false）の日が除外されている
- [ ] キャンセル済みの日が除外されている
- [ ] 公開設定されたスケジュールのみ表示される
- [ ] 日時のタイムゾーン（Asia/Tokyo）が正しい
- [ ] 入会・振替フォームでも同様に動作

---

## 8. Phase 4: HP カレンダー Widget の移行

**目的:** HP 上のカレンダー表示を Google Calendar → Supabase schedules に移行。
**職員への影響:** なし（表示は同じ）

### 8.1 現在のカレンダー Widget

| 項目 | 内容 |
|------|------|
| ファイル | STARTUS_calendar_widget/code.gs + index.html |
| パラメータ | `class`（教室ID）, `color`（テーマ色）, `limit`（表示件数）, `taiken_btn`（体験ボタン） |
| データソース | Google Calendar API |
| 埋め込み方法 | iframe で HP の各教室ページに埋め込み |

### 8.2 移行の選択肢

#### 選択肢 A: GAS Widget のデータソースのみ変更（推奨）

| メリット | デメリット |
|----------|----------|
| 最小限の変更 | GAS 依存は残る |
| HP 側の修正不要 | ― |
| iframe URL そのまま | ― |

GAS の `code.gs` 内で、Google Calendar API → Supabase REST API に差し替え。
HP の iframe 埋め込みコードは変更不要。

#### 選択肢 B: 新しい静的カレンダーコンポーネントを作成

| メリット | デメリット |
|----------|----------|
| GAS 完全廃止 | HP 側の iframe URL 変更が必要 |
| 高速表示 | 新規開発コスト |
| 自由なデザイン | ― |

Vercel にホストした HTML/JS コンポーネントを HP に iframe で埋め込み。

### 8.3 推奨：選択肢 A → B の段階的移行

1. まず選択肢 A で GAS のデータソースだけ変更（低リスク）
2. 安定運用後、必要に応じて選択肢 B を開発

### 8.4 確認項目

- [ ] HP の各教室ページでカレンダーが正しく表示される
- [ ] 体験ボタンが正しく動作する
- [ ] カレンダーの日付が Supabase schedules と一致する
- [ ] キャンセル済みスケジュールが適切に表示/非表示される

---

## 9. Phase 5: 出席管理アプリの開発

**目的:** スケジュール × 会員のクロスで出席を記録・管理。
**職員への影響:** 新機能の追加

### 9.1 前提条件（Phase 1-3 完了後に利用可能）

| データ | テーブル | 状態 |
|--------|---------|------|
| 全教室情報 | classrooms | 統一済み |
| 全スケジュール | schedules | Supabase が正本 |
| 全会員情報 | members | 既に Supabase |

### 9.2 テーブル設計

```sql
CREATE TABLE attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES schedules(id),
  member_id UUID NOT NULL REFERENCES members(id),
  status TEXT NOT NULL DEFAULT 'present'
    CHECK (status IN ('present', 'absent', 'late', 'excused', 'makeup')),
  checked_at TIMESTAMPTZ DEFAULT now(),
  checked_by UUID REFERENCES staff(id),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(schedule_id, member_id)
);

CREATE INDEX idx_attendance_schedule ON attendance(schedule_id);
CREATE INDEX idx_attendance_member ON attendance(member_id);
CREATE INDEX idx_attendance_date ON attendance(
  (SELECT date FROM schedules WHERE id = schedule_id)
);
```

### 9.3 出席ステータス

| status | 意味 | 用途 |
|--------|------|------|
| `present` | 出席 | 通常出席 |
| `absent` | 欠席 | 連絡なし欠席 |
| `late` | 遅刻 | 遅刻して参加 |
| `excused` | 欠席（連絡あり） | 事前連絡済み欠席 |
| `makeup` | 振替出席 | 他教室への振替参加 |

### 9.4 UI 設計概要

#### 9.4.1 出席記録画面

```
┌─────────────────────────────────────────┐
│ 出席管理                                 │
├─────────────────────────────────────────┤
│ 日付: [2026-03-05 ▼]                    │
│ 教室: [キッズ陸上 ▼]                     │
├─────────────────────────────────────────┤
│ ┌─────────┬──────┬────────┐             │
│ │ 会員名   │ 状態  │ メモ   │             │
│ ├─────────┼──────┼────────┤             │
│ │ 山田太郎 │ ✅出席 │        │             │
│ │ 田中花子 │ ✅出席 │        │             │
│ │ 佐藤一郎 │ ❌欠席 │ 風邪   │             │
│ │ 鈴木美咲 │ 🔄振替 │ A教室→ │             │
│ └─────────┴──────┴────────┘             │
│                                         │
│ [一括出席] [保存]                         │
└─────────────────────────────────────────┘
```

#### 9.4.2 出席履歴・統計画面

- 会員別の出席率
- 教室別の出席率
- 月次レポート
- 振替の追跡

### 9.5 スケジュール連携

スケジュール管理画面から直接出席記録に遷移できるようにする：

```
スケジュール管理タブ
  → イベントクリック
    → イベント詳細モーダル
      → [出席管理] ボタン
        → 出席記録画面（該当日・該当教室がプリセット）
```

### 9.6 確認項目

- [ ] スケジュール×会員のクロスで出席記録が可能
- [ ] 出席ステータスの切り替えが動作
- [ ] 振替出席の記録が可能
- [ ] 会員別・教室別の出席率が表示される
- [ ] スケジュール管理画面からの導線が動作

---

## 10. リスク管理・ロールバック方針

### 10.1 全フェーズ共通

| 方針 | 内容 |
|------|------|
| Google Calendar 同期の維持 | 全フェーズで GCal への同期を維持。万一の際は GCal ベースに戻せる |
| 旧システム即時削除の禁止 | 移行完了後も最低1ヶ月は旧システムを保持 |
| テスト環境での事前検証 | 本番反映前に必ずテスト環境（develop ブランチ）で検証 |
| データバックアップ | 各フェーズ開始前に Supabase の全テーブルを CSV エクスポート |

### 10.2 フェーズ別ロールバック手順

| Phase | ロールバック方法 | 所要時間 |
|-------|----------------|---------|
| Phase 0 | config.js の接続先を旧 Supabase に戻す | 数分 |
| Phase 1 | Sgrum での入力を再開。GAS API を復活 | 即座 |
| Phase 2 | GAS フォームの教室取得先を SharePoint に戻す | GAS デプロイ（数分） |
| Phase 3 | GAS フォームの日程取得を Google Calendar に戻す | GAS デプロイ（数分） |
| Phase 4 | Widget のデータソースを Google Calendar に戻す | GAS デプロイ（数分） |

### 10.3 リスク一覧

| リスク | 影響度 | 発生可能性 | 対策 |
|--------|-------|-----------|------|
| calendar_tag の不一致 | 高 | 中 | Phase 2 で全教室を突合検証 |
| Supabase 無料枠超過 | 中 | 低 | 使用量モニタリング。必要時有料プラン |
| Google Calendar API 制限 | 中 | 低 | 同期をバッチ処理化 |
| データ移行時の欠損 | 高 | 低 | 移行前バックアップ + 移行後件数確認 |
| GAS デプロイ失敗 | 中 | 低 | テストデプロイで事前確認 |
| 職員の操作ミス | 低 | 中 | 研修実施 + マニュアル作成 |

---

## 11. アカウント・インフラ管理

### 11.1 移行後のアカウント構成

```
STARTUS 組織アカウント
│
├── GitHub Organization: startus-kanazawa
│   ├── member-manager (Private)
│   ├── calendar-manager (Private, Phase 0 後にアーカイブ)
│   └── (将来のリポジトリ)
│
├── Supabase Organization: STARTUS
│   ├── プロジェクト: startus-production (本番)
│   └── プロジェクト: startus-development (テスト)
│
├── Vercel
│   ├── member-manager → Production (main ブランチ)
│   └── member-manager → Preview (develop ブランチ)
│
└── Google Workspace: startus-kanazawa.org
    ├── Google Calendar (スケジュール同期先)
    └── GAS プロジェクト (フォーム・Widget)
```

### 11.2 アクセス権限

| サービス | 松井 | 他スタッフ（管理者） | 他スタッフ（一般） |
|----------|------|-------------------|--------------------|
| GitHub Org | Owner | ― | ― |
| Supabase | Owner | ― | ― |
| Vercel | Owner | ― | ― |
| 管理アプリ（Web） | 全機能 | 全機能 | 閲覧 + 出席記録 |

### 11.3 費用

| サービス | プラン | 月額 |
|----------|-------|------|
| GitHub Organization | Free | $0 |
| Supabase (2 プロジェクト) | Free | $0 |
| Vercel (Hobby) | Free | $0 |
| **合計** | | **$0** |

> ※ 将来的にデータ量やチーム規模が拡大した場合、Supabase Pro ($25/月) や Vercel Pro ($20/月) への移行を検討。

---

## 12. 開発・デプロイフロー

### 12.1 ブランチ戦略

```
main（本番）
  │
  └── develop（テスト）
        │
        └── feature/xxx（機能開発）
```

| ブランチ | 用途 | デプロイ先 |
|----------|------|-----------|
| main | 本番コード | Vercel Production (member-manager.vercel.app) |
| develop | テスト・検証 | Vercel Preview (自動生成URL) |
| feature/* | 個別機能開発 | ローカルのみ |

### 12.2 日常の開発フロー

```
① ローカルで Claude Code を使って開発
   （C:\Users\hisas\AI_Workspace\member-manager）

② feature ブランチで作業
   git checkout -b feature/schedule-admin

③ 開発完了後、develop にマージ
   git checkout develop
   git merge feature/schedule-admin
   git push origin develop

④ Vercel Preview URL でテスト確認
   → 動作OK

⑤ develop → main に Pull Request
   GitHub 上で PR 作成 → レビュー → マージ

⑥ 本番に自動デプロイ
   Vercel が main ブランチの変更を検知 → 自動デプロイ
```

### 12.3 Supabase 環境の切り替え

| ブランチ | Supabase プロジェクト |
|----------|---------------------|
| main | startus-production |
| develop / feature | startus-development |

config.js または Vercel 環境変数で切り替え：

```javascript
// config.js
const IS_PRODUCTION = window.location.hostname === 'member-manager.vercel.app';

export const SUPABASE_URL = IS_PRODUCTION
  ? 'https://xxxxx.supabase.co'   // 本番
  : 'https://yyyyy.supabase.co';  // テスト
```

### 12.4 緊急時の対応

| 状況 | 対応 |
|------|------|
| 本番でバグ発見 | Vercel ダッシュボードで前のデプロイに即座にロールバック |
| DB の問題 | Supabase ダッシュボードで直接修正、または SQL 実行 |
| 松井不在時 | GitHub Org の Owner 権限を持つ別メンバーが対応 |

---

## 付録

### A. 用語集

| 用語 | 説明 |
|------|------|
| Supabase | データベース + 認証 + API を提供するクラウドサービス |
| Vercel | Web アプリのホスティング（デプロイ）サービス |
| GitHub | ソースコードの管理サービス |
| GAS | Google Apps Script。Google サービスの自動化ツール |
| calendar_tag | 教室を識別するためのタグ（例: kidsdance） |
| RLS | Row Level Security。データベースの行単位アクセス制御 |
| REST API | HTTP 経由でデータを取得・更新する仕組み |
| ブランチ | コードの「枝」。本番と開発を分離する仕組み |
| PR (Pull Request) | コード変更を本番に反映する前のレビュー依頼 |
| デプロイ | アプリを本番サーバーに公開すること |

### B. 参考ファイル

| ファイル | 内容 |
|---------|------|
| member-manager/CLAUDE.md | プロジェクト設定 |
| member-manager/member-admin-spec.md | 管理アプリ仕様書 |
| member-manager/application-spec.md | 申請ワークフロー仕様 |
| calendar-manager/requirements.md | スケジュール管理要件定義 |
| member-manager/SECURITY.md | セキュリティ実装 |

---

*本計画書は開発の進捗に応じて更新されます。*
*最終更新: 2026-03-05*

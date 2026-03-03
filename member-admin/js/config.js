// ========================================
// Supabase 接続情報（環境固有、変更不要）
// ========================================
export const SUPABASE_URL = 'https://jfsxywwufwdprqdkyxhr.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impmc3h5d3d1ZndkcHJxZGt5eGhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5NTM4NjUsImV4cCI6MjA4NzUyOTg2NX0.htkbpmzoFkH204wggYTl10YEBalDIDq4gJp-W25fRRQ';

// ========================================
// Google API（環境固有、変更不要）
// ========================================
export const GOOGLE_CALENDAR_API_KEY = 'AIzaSyDFK99ib15lvQ2sTugYQF6sXVaFqLHgXzI';
export const GOOGLE_OAUTH_CLIENT_ID = '692539813382-20e73l8vfc83sqmfgd4hom3umrorf031.apps.googleusercontent.com';

// ========================================
// フォールバック値（DB app_config / staff テーブルから取得できない場合に使用）
// 通常運用時はDBの値が優先される
// ========================================

// ログイン許可メール（フォールバック）
// 本来は staff テーブル（status='在籍'）で管理。
// staff テーブルが空またはアクセスできない場合のみ使用。
export const ALLOWED_EMAILS = [
  'hisashimatsui@startus-kanazawa.org',
  'hisasimatu3117@gmail.com'
];

// アプリ名（フォールバック）→ 本来は app_config テーブルで管理
export const APP_NAME = 'STARTUS 会員管理';

// スタッフカレンダー設定（フォールバック）→ 本来は staff テーブルの email + calendar_color で管理
export const STAFF_CALENDARS = [
  { id: 'imoto@startus-kanazawa.org',    name: '井元', color: '#4285F4' },
  { id: 'matsui@startus-kanazawa.org',   name: '松井', color: '#EA4335' },
  { id: 'matsukura@startus-kanazawa.org', name: '松倉', color: '#FBBC05' },
  { id: 'takei@startus-kanazawa.org',    name: '竹井', color: '#34A853' },
  { id: 'sakurai@startus-kanazawa.org',  name: '櫻井', color: '#8B5CF6' },
];

// カレンダー表示時間帯（フォールバック）→ 本来は app_config テーブルで管理
export const CALENDAR_START_HOUR = 6;
export const CALENDAR_END_HOUR = 23;

// 教室スケジュールAPI（フォールバック）→ 本来は app_config テーブルで管理
export const SCHEDULE_API_URL = 'https://script.google.com/macros/s/AKfycbzSckwINV7p82DXUaUeQNEAyRy2MoWXJfbzeYWffwnKoQZ_inJ_6lAOPZim6N-oBxqF9g/exec';

// スタッフカレンダーAPI（フォールバック）→ 本来は app_config テーブルで管理
// GAS デプロイ後に URL を設定すること
export const CALENDAR_API_URL = '';

-- ========================================================
-- アカウント・設定管理 マイグレーションSQL
-- Supabase SQL Editor にコピペして実行してください
-- ========================================================

-- ========================================
-- 1. staff テーブルにインデックス追加（ログイン時のメール検索高速化）
-- ========================================
CREATE INDEX IF NOT EXISTS idx_staff_email ON staff (email);

-- ========================================
-- 2. staff テーブルにカレンダー色カラムを追加
-- ========================================
ALTER TABLE staff ADD COLUMN IF NOT EXISTS calendar_color TEXT DEFAULT '';

-- 既存スタッフのカレンダー色を設定
UPDATE staff SET calendar_color = '#4285F4' WHERE email = 'imoto@startus-kanazawa.org' AND calendar_color = '';
UPDATE staff SET calendar_color = '#EA4335' WHERE email = 'matsui@startus-kanazawa.org' AND calendar_color = '';
UPDATE staff SET calendar_color = '#FBBC05' WHERE email = 'matsukura@startus-kanazawa.org' AND calendar_color = '';
UPDATE staff SET calendar_color = '#34A853' WHERE email = 'takei@startus-kanazawa.org' AND calendar_color = '';
UPDATE staff SET calendar_color = '#8B5CF6' WHERE email = 'sakurai@startus-kanazawa.org' AND calendar_color = '';

-- ========================================
-- 3. アプリ設定テーブル作成
-- ========================================
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}',
  description TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- updated_at 自動更新トリガー
DROP TRIGGER IF EXISTS app_config_updated_at ON app_config;
CREATE TRIGGER app_config_updated_at
  BEFORE UPDATE ON app_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS ポリシー
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_all_config" ON app_config
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ========================================
-- 4. 初期設定データ投入
-- ========================================
INSERT INTO app_config (key, value, description) VALUES
  ('app_name', '"STARTUS 会員管理"', 'アプリケーション名'),
  ('org_name', '"STARTUS Sports Academy"', '団体名'),
  ('calendar_hours', '{"start": 6, "end": 23}', 'カレンダー表示時間帯（開始/終了時刻）'),
  ('schedule_api_url', '"https://script.google.com/macros/s/AKfycbzSckwINV7p82DXUaUeQNEAyRy2MoWXJfbzeYWffwnKoQZ_inJ_6lAOPZim6N-oBxqF9g/exec"', '教室スケジュールAPI URL（GAS）')
ON CONFLICT (key) DO NOTHING;

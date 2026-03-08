-- ========================================================
-- 出欠管理アプリ用テーブル（Supabase統合）
-- Supabase SQL Editor にコピペして実行してください
-- ========================================================

-- ========================================
-- 1. 会場テーブル（venues）
-- ========================================
CREATE TABLE IF NOT EXISTS venues (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT DEFAULT '',
  address TEXT DEFAULT '',
  note TEXT DEFAULT '',
  is_active BOOLEAN DEFAULT true,
  display_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_venues_display_order ON venues (display_order, name);

ALTER TABLE venues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_venues" ON venues
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS venues_updated_at ON venues;
CREATE TRIGGER venues_updated_at
  BEFORE UPDATE ON venues
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ========================================
-- 2. 出欠イベントテーブル（attendance_events）
-- ========================================
-- ※ Supabase既存の「events」という名前は予約語に近いため attendance_events とする
CREATE TABLE IF NOT EXISTS attendance_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL,
  venue_id UUID REFERENCES venues(id) ON DELETE SET NULL,
  note TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attendance_events_date ON attendance_events (date DESC);

ALTER TABLE attendance_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_attendance_events" ON attendance_events
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS attendance_events_updated_at ON attendance_events;
CREATE TRIGGER attendance_events_updated_at
  BEFORE UPDATE ON attendance_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ========================================
-- 3. 出欠記録テーブル（attendance_records）
-- ========================================
CREATE TABLE IF NOT EXISTS attendance_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES attendance_events(id) ON DELETE CASCADE,
  person_id UUID NOT NULL,
  person_type TEXT DEFAULT 'member'
    CHECK (person_type IN ('member', 'staff')),
  status TEXT NOT NULL DEFAULT 'present'
    CHECK (status IN ('present', 'absent')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(event_id, person_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_records_event ON attendance_records (event_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_person ON attendance_records (person_id);

ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_attendance_records" ON attendance_records
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS attendance_records_updated_at ON attendance_records;
CREATE TRIGGER attendance_records_updated_at
  BEFORE UPDATE ON attendance_records
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

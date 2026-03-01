-- ========================================================
-- 管理者アカウント マイグレーションSQL
-- Supabase SQL Editor にコピペして実行してください
-- ========================================================

-- ========================================
-- 1. staff テーブルに is_admin カラムを追加
-- ========================================
ALTER TABLE staff ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

-- ========================================
-- 2. 既存の事務局スタッフを管理者に設定
--    （必要に応じて対象メールアドレスを変更してください）
-- ========================================
UPDATE staff SET is_admin = true WHERE email = 'hisashimatsui@startus-kanazawa.org' AND is_admin = false;
UPDATE staff SET is_admin = true WHERE email = 'matsui@startus-kanazawa.org' AND is_admin = false;
UPDATE staff SET is_admin = true WHERE email = 'hisasimatu3117@gmail.com' AND is_admin = false;

-- ========================================
-- 3. 管理者用アカウント（システムアカウント）を追加
-- ========================================
INSERT INTO staff (name, furigana, role, email, is_admin, status, note)
VALUES ('管理者', '', '事務局', 'startus@startus-kanazawa.org', true, '在籍', 'システム管理用アカウント')
ON CONFLICT DO NOTHING;

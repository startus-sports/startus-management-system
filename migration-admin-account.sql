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

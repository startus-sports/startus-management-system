-- ============================================================
-- migration-security.sql
-- セキュリティ強化: RLSポリシーの見直し
-- 実行: bash scripts/run-sql.sh migration-security.sql
-- ※ 一度だけ実行すること
-- ============================================================

-- ============================================================
-- 1. SECURITY DEFINER ヘルパー関数
--    RLSポリシー内でstaffテーブルを参照するための関数
--    (循環参照を避けるため SECURITY DEFINER で実行)
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_active_staff()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM staff
    WHERE email = auth.jwt() ->> 'email'
      AND status = '在籍'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin_staff()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM staff
    WHERE email = auth.jwt() ->> 'email'
      AND status = '在籍'
      AND is_admin = true
  );
$$;

-- ============================================================
-- 2. members テーブル - RLS有効化 & ポリシー追加
-- ============================================================

ALTER TABLE members ENABLE ROW LEVEL SECURITY;

-- 既存ポリシーがあれば削除（エラー防止）
DROP POLICY IF EXISTS "auth_all_members" ON members;
DROP POLICY IF EXISTS "staff_select_members" ON members;
DROP POLICY IF EXISTS "staff_insert_members" ON members;
DROP POLICY IF EXISTS "staff_update_members" ON members;
DROP POLICY IF EXISTS "admin_delete_members" ON members;

CREATE POLICY "staff_select_members" ON members
  FOR SELECT TO authenticated
  USING (is_active_staff());

CREATE POLICY "staff_insert_members" ON members
  FOR INSERT TO authenticated
  WITH CHECK (is_active_staff());

CREATE POLICY "staff_update_members" ON members
  FOR UPDATE TO authenticated
  USING (is_active_staff())
  WITH CHECK (is_active_staff());

CREATE POLICY "admin_delete_members" ON members
  FOR DELETE TO authenticated
  USING (is_admin_staff());

-- ============================================================
-- 3. staff テーブル - ポリシー置換
-- ============================================================

DROP POLICY IF EXISTS "auth_all_staff" ON staff;
DROP POLICY IF EXISTS "staff_select_staff" ON staff;
DROP POLICY IF EXISTS "admin_insert_staff" ON staff;
DROP POLICY IF EXISTS "admin_update_staff" ON staff;
DROP POLICY IF EXISTS "admin_delete_staff" ON staff;

CREATE POLICY "staff_select_staff" ON staff
  FOR SELECT TO authenticated
  USING (is_active_staff());

CREATE POLICY "admin_insert_staff" ON staff
  FOR INSERT TO authenticated
  WITH CHECK (is_admin_staff());

CREATE POLICY "admin_update_staff" ON staff
  FOR UPDATE TO authenticated
  USING (is_admin_staff())
  WITH CHECK (is_admin_staff());

CREATE POLICY "admin_delete_staff" ON staff
  FOR DELETE TO authenticated
  USING (is_admin_staff());

-- ============================================================
-- 4. applications テーブル - ポリシー置換
--    ※ anon_insert_applications は維持
-- ============================================================

DROP POLICY IF EXISTS "auth_all_applications" ON applications;
DROP POLICY IF EXISTS "staff_select_applications" ON applications;
DROP POLICY IF EXISTS "staff_insert_applications" ON applications;
DROP POLICY IF EXISTS "staff_update_applications" ON applications;
DROP POLICY IF EXISTS "staff_delete_applications" ON applications;

CREATE POLICY "staff_select_applications" ON applications
  FOR SELECT TO authenticated
  USING (is_active_staff());

CREATE POLICY "staff_insert_applications" ON applications
  FOR INSERT TO authenticated
  WITH CHECK (is_active_staff());

CREATE POLICY "staff_update_applications" ON applications
  FOR UPDATE TO authenticated
  USING (is_active_staff())
  WITH CHECK (is_active_staff());

CREATE POLICY "staff_delete_applications" ON applications
  FOR DELETE TO authenticated
  USING (is_active_staff());

-- anon_insert_applications は既存のまま維持（DROP しない）

-- ============================================================
-- 5. application_comments テーブル - ポリシー置換
-- ============================================================

DROP POLICY IF EXISTS "auth_all_application_comments" ON application_comments;
DROP POLICY IF EXISTS "staff_select_application_comments" ON application_comments;
DROP POLICY IF EXISTS "staff_insert_application_comments" ON application_comments;
DROP POLICY IF EXISTS "staff_update_application_comments" ON application_comments;
DROP POLICY IF EXISTS "staff_delete_application_comments" ON application_comments;

CREATE POLICY "staff_select_application_comments" ON application_comments
  FOR SELECT TO authenticated
  USING (is_active_staff());

CREATE POLICY "staff_insert_application_comments" ON application_comments
  FOR INSERT TO authenticated
  WITH CHECK (is_active_staff());

CREATE POLICY "staff_update_application_comments" ON application_comments
  FOR UPDATE TO authenticated
  USING (is_active_staff())
  WITH CHECK (is_active_staff());

CREATE POLICY "staff_delete_application_comments" ON application_comments
  FOR DELETE TO authenticated
  USING (is_active_staff());

-- ============================================================
-- 6. activity_log テーブル - ポリシー置換
-- ============================================================

DROP POLICY IF EXISTS "auth_all_activity_log" ON activity_log;
DROP POLICY IF EXISTS "staff_select_activity_log" ON activity_log;
DROP POLICY IF EXISTS "staff_insert_activity_log" ON activity_log;
DROP POLICY IF EXISTS "staff_update_activity_log" ON activity_log;
DROP POLICY IF EXISTS "admin_delete_activity_log" ON activity_log;

CREATE POLICY "staff_select_activity_log" ON activity_log
  FOR SELECT TO authenticated
  USING (is_active_staff());

CREATE POLICY "staff_insert_activity_log" ON activity_log
  FOR INSERT TO authenticated
  WITH CHECK (is_active_staff());

CREATE POLICY "staff_update_activity_log" ON activity_log
  FOR UPDATE TO authenticated
  USING (is_active_staff())
  WITH CHECK (is_active_staff());

CREATE POLICY "admin_delete_activity_log" ON activity_log
  FOR DELETE TO authenticated
  USING (is_admin_staff());

-- ============================================================
-- 7. classrooms テーブル - ポリシー置換
-- ============================================================

DROP POLICY IF EXISTS "auth_all_classrooms" ON classrooms;
DROP POLICY IF EXISTS "staff_select_classrooms" ON classrooms;
DROP POLICY IF EXISTS "admin_insert_classrooms" ON classrooms;
DROP POLICY IF EXISTS "admin_update_classrooms" ON classrooms;
DROP POLICY IF EXISTS "admin_delete_classrooms" ON classrooms;

CREATE POLICY "staff_select_classrooms" ON classrooms
  FOR SELECT TO authenticated
  USING (is_active_staff());

CREATE POLICY "admin_insert_classrooms" ON classrooms
  FOR INSERT TO authenticated
  WITH CHECK (is_admin_staff());

CREATE POLICY "admin_update_classrooms" ON classrooms
  FOR UPDATE TO authenticated
  USING (is_admin_staff())
  WITH CHECK (is_admin_staff());

CREATE POLICY "admin_delete_classrooms" ON classrooms
  FOR DELETE TO authenticated
  USING (is_admin_staff());

-- ============================================================
-- 8. chat_channels テーブル - ポリシー置換
-- ============================================================

DROP POLICY IF EXISTS "auth_all_chat_channels" ON chat_channels;
DROP POLICY IF EXISTS "staff_select_chat_channels" ON chat_channels;
DROP POLICY IF EXISTS "staff_insert_chat_channels" ON chat_channels;
DROP POLICY IF EXISTS "staff_update_chat_channels" ON chat_channels;
DROP POLICY IF EXISTS "admin_delete_chat_channels" ON chat_channels;

CREATE POLICY "staff_select_chat_channels" ON chat_channels
  FOR SELECT TO authenticated
  USING (is_active_staff());

CREATE POLICY "staff_insert_chat_channels" ON chat_channels
  FOR INSERT TO authenticated
  WITH CHECK (is_active_staff());

CREATE POLICY "staff_update_chat_channels" ON chat_channels
  FOR UPDATE TO authenticated
  USING (is_active_staff())
  WITH CHECK (is_active_staff());

CREATE POLICY "admin_delete_chat_channels" ON chat_channels
  FOR DELETE TO authenticated
  USING (is_admin_staff());

-- ============================================================
-- 9. chat_channel_members テーブル - ポリシー置換
-- ============================================================

DROP POLICY IF EXISTS "auth_all_chat_channel_members" ON chat_channel_members;
DROP POLICY IF EXISTS "staff_select_chat_channel_members" ON chat_channel_members;
DROP POLICY IF EXISTS "staff_insert_chat_channel_members" ON chat_channel_members;
DROP POLICY IF EXISTS "staff_update_chat_channel_members" ON chat_channel_members;
DROP POLICY IF EXISTS "admin_delete_chat_channel_members" ON chat_channel_members;

CREATE POLICY "staff_select_chat_channel_members" ON chat_channel_members
  FOR SELECT TO authenticated
  USING (is_active_staff());

CREATE POLICY "staff_insert_chat_channel_members" ON chat_channel_members
  FOR INSERT TO authenticated
  WITH CHECK (is_active_staff());

CREATE POLICY "staff_update_chat_channel_members" ON chat_channel_members
  FOR UPDATE TO authenticated
  USING (is_active_staff())
  WITH CHECK (is_active_staff());

CREATE POLICY "admin_delete_chat_channel_members" ON chat_channel_members
  FOR DELETE TO authenticated
  USING (is_admin_staff());

-- ============================================================
-- 10. chat_messages テーブル - ポリシー置換
-- ============================================================

DROP POLICY IF EXISTS "auth_all_chat_messages" ON chat_messages;
DROP POLICY IF EXISTS "staff_select_chat_messages" ON chat_messages;
DROP POLICY IF EXISTS "staff_insert_chat_messages" ON chat_messages;
DROP POLICY IF EXISTS "staff_update_chat_messages" ON chat_messages;
DROP POLICY IF EXISTS "staff_delete_chat_messages" ON chat_messages;

CREATE POLICY "staff_select_chat_messages" ON chat_messages
  FOR SELECT TO authenticated
  USING (is_active_staff());

CREATE POLICY "staff_insert_chat_messages" ON chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (is_active_staff());

CREATE POLICY "staff_update_chat_messages" ON chat_messages
  FOR UPDATE TO authenticated
  USING (is_active_staff())
  WITH CHECK (is_active_staff());

CREATE POLICY "staff_delete_chat_messages" ON chat_messages
  FOR DELETE TO authenticated
  USING (is_active_staff());

-- ============================================================
-- 11. app_config テーブル - ポリシー置換
-- ============================================================

DROP POLICY IF EXISTS "auth_all_config" ON app_config;
DROP POLICY IF EXISTS "staff_select_app_config" ON app_config;
DROP POLICY IF EXISTS "admin_insert_app_config" ON app_config;
DROP POLICY IF EXISTS "admin_update_app_config" ON app_config;
DROP POLICY IF EXISTS "admin_delete_app_config" ON app_config;

CREATE POLICY "staff_select_app_config" ON app_config
  FOR SELECT TO authenticated
  USING (is_active_staff());

CREATE POLICY "admin_insert_app_config" ON app_config
  FOR INSERT TO authenticated
  WITH CHECK (is_admin_staff());

CREATE POLICY "admin_update_app_config" ON app_config
  FOR UPDATE TO authenticated
  USING (is_admin_staff())
  WITH CHECK (is_admin_staff());

CREATE POLICY "admin_delete_app_config" ON app_config
  FOR DELETE TO authenticated
  USING (is_admin_staff());

-- ============================================================
-- 12. member_fees テーブル（存在する場合のみ）
-- ============================================================

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'member_fees'
  ) THEN
    EXECUTE 'ALTER TABLE member_fees ENABLE ROW LEVEL SECURITY';

    -- 既存ポリシー削除
    BEGIN EXECUTE 'DROP POLICY IF EXISTS "auth_all_member_fees" ON member_fees'; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN EXECUTE 'DROP POLICY IF EXISTS "staff_select_member_fees" ON member_fees'; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN EXECUTE 'DROP POLICY IF EXISTS "staff_insert_member_fees" ON member_fees'; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN EXECUTE 'DROP POLICY IF EXISTS "staff_update_member_fees" ON member_fees'; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN EXECUTE 'DROP POLICY IF EXISTS "admin_delete_member_fees" ON member_fees'; EXCEPTION WHEN OTHERS THEN NULL; END;

    EXECUTE 'CREATE POLICY "staff_select_member_fees" ON member_fees FOR SELECT TO authenticated USING (is_active_staff())';
    EXECUTE 'CREATE POLICY "staff_insert_member_fees" ON member_fees FOR INSERT TO authenticated WITH CHECK (is_active_staff())';
    EXECUTE 'CREATE POLICY "staff_update_member_fees" ON member_fees FOR UPDATE TO authenticated USING (is_active_staff()) WITH CHECK (is_active_staff())';
    EXECUTE 'CREATE POLICY "admin_delete_member_fees" ON member_fees FOR DELETE TO authenticated USING (is_admin_staff())';
  END IF;
END $$;

-- ============================================================
-- 完了メッセージ
-- ============================================================

DO $$ BEGIN RAISE NOTICE 'セキュリティマイグレーション完了: 全テーブルのRLSポリシーを強化しました'; END $$;

-- 1. RLSが有効かどうか確認
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND tablename IN ('staff', 'members', 'applications');

-- 2. staffテーブルのポリシー確認
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'staff';

-- 3. is_active_staff関数が存在するか確認
SELECT routine_name, routine_definition
FROM information_schema.routines
WHERE routine_name = 'is_active_staff' AND routine_schema = 'public';

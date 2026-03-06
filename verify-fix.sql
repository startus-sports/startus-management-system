-- 修正後の関数定義を確認
SELECT routine_name, routine_definition
FROM information_schema.routines
WHERE routine_name IN ('is_active_staff', 'is_admin_staff') AND routine_schema = 'public';

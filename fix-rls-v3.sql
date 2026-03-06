-- RLS関数修正: chr() で '在籍' を構築（エンコーディング問題回避）
-- 在 = U+5728 (22312), 籍 = U+7C4D (31821)
CREATE OR REPLACE FUNCTION public.is_active_staff()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM staff
    WHERE email = auth.jwt() ->> 'email'
      AND status = chr(22312) || chr(31821)
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
      AND status = chr(22312) || chr(31821)
      AND is_admin = true
  );
$$;

-- RLS関数修正: バイト列で '在籍' を比較（エンコーディング問題回避）
CREATE OR REPLACE FUNCTION public.is_active_staff()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM staff
    WHERE email = auth.jwt() ->> 'email'
      AND status = convert_from(E'\\xe5\\x9c\\xa8\\xe7\\xb1\\x8d', 'UTF8')
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
      AND status = convert_from(E'\\xe5\\x9c\\xa8\\xe7\\xb1\\x8d', 'UTF8')
      AND is_admin = true
  );
$$;

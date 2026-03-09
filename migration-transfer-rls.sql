-- 振替申請（type='transfer'）のanon INSERT許可
-- 既存のRLSポリシーを更新して、外部フォームから振替申請を直接投入できるようにする

-- 既存ポリシーを削除して再作成
DROP POLICY IF EXISTS "anon_insert_applications" ON applications;

CREATE POLICY "anon_insert_applications" ON applications
  FOR INSERT TO anon
  WITH CHECK (type IN ('join', 'trial', 'transfer'));

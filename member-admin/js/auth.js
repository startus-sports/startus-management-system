import { supabase } from './supabase.js';
import { ALLOWED_EMAILS } from './config.js';

export async function checkSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

/**
 * staff テーブルで email が在籍スタッフとして登録されているか確認する。
 * staff テーブルから取得できない場合は config.js の ALLOWED_EMAILS にフォールバック。
 */
export async function isAllowedEmail(email) {
  if (!email) return false;

  // staff テーブルで在籍スタッフか確認
  const { data, error } = await supabase
    .from('staff')
    .select('id')
    .eq('email', email)
    .eq('status', '在籍')
    .limit(1);

  if (!error && data && data.length > 0) {
    return true;
  }

  // staff テーブルから取得できなかった場合は ALLOWED_EMAILS にフォールバック
  if (ALLOWED_EMAILS && ALLOWED_EMAILS.length > 0) {
    return ALLOWED_EMAILS.includes(email);
  }

  return false;
}

export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
    },
  });
  if (error) {
    console.error('Login error:', error);
    throw error;
  }
}

export async function signOut() {
  await supabase.auth.signOut();
  location.reload();
}

export function onAuthStateChange(callback) {
  supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
}

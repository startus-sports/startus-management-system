// --- タブバッジ通知 ---

import { supabase } from './supabase.js';
import { getStaffByEmail } from './staff.js';
import { loadUnreadCounts, updateUnreadBadge } from './chat.js';

const POLL_INTERVAL = 60000; // 60秒ごとに自動チェック
let pollTimer = null;

/**
 * 未対応の申請・体験件数を取得してタブバッジを更新
 */
export async function updateTabBadges() {
  try {
    // 申請（体験以外）の未対応件数
    const { count: appCount } = await supabase
      .from('applications')
      .select('*', { count: 'exact', head: true })
      .in('type', ['join', 'withdrawal', 'suspension', 'reinstatement', 'change'])
      .eq('status', 'pending');

    // 体験の未対応件数
    const { count: trialCount } = await supabase
      .from('applications')
      .select('*', { count: 'exact', head: true })
      .eq('type', 'trial')
      .eq('status', 'pending');

    // 振替の未対応件数
    const { count: transferCount } = await supabase
      .from('applications')
      .select('*', { count: 'exact', head: true })
      .eq('type', 'transfer')
      .eq('status', 'pending');

    setBadge('app-tab-badge', appCount || 0);
    setBadge('trial-tab-badge', trialCount || 0);
    setBadge('transfer-tab-badge', transferCount || 0);

    // ログインユーザーの担当件数
    const { data: { session } } = await supabase.auth.getSession();
    const staff = session?.user?.email ? getStaffByEmail(session.user.email) : null;

    if (staff) {
      const { count: myAppCount } = await supabase
        .from('applications')
        .select('*', { count: 'exact', head: true })
        .in('type', ['join', 'withdrawal', 'suspension', 'reinstatement', 'change'])
        .in('status', ['pending', 'reviewed'])
        .eq('assigned_to', staff.id);

      const { count: myTrialCount } = await supabase
        .from('applications')
        .select('*', { count: 'exact', head: true })
        .eq('type', 'trial')
        .in('status', ['pending', 'reviewed', 'approved'])
        .eq('assigned_to', staff.id);

      const { count: myTransferCount } = await supabase
        .from('applications')
        .select('*', { count: 'exact', head: true })
        .eq('type', 'transfer')
        .eq('status', 'pending')
        .eq('assigned_to', staff.id);

      setMyBadge('app-my-badge', myAppCount || 0);
      setMyBadge('trial-my-badge', myTrialCount || 0);
      setMyBadge('transfer-my-badge', myTransferCount || 0);
    } else {
      setMyBadge('app-my-badge', 0);
      setMyBadge('trial-my-badge', 0);
      setMyBadge('transfer-my-badge', 0);
    }
    // チャット未読バッジ更新
    await loadUnreadCounts();
    updateUnreadBadge();

  } catch (err) {
    console.error('バッジ更新エラー:', err);
  }
}

function setBadge(elementId, count) {
  const el = document.getElementById(elementId);
  if (!el) return;
  if (count > 0) {
    el.textContent = count > 99 ? '99+' : count;
    el.style.display = 'inline-flex';
  } else {
    el.textContent = '';
    el.style.display = 'none';
  }
}

function setMyBadge(elementId, count) {
  const el = document.getElementById(elementId);
  if (!el) return;
  if (count > 0) {
    el.textContent = count;
    el.style.display = 'inline-flex';
  } else {
    el.textContent = '';
    el.style.display = 'none';
  }
}

/**
 * 定期的なバッジ更新を開始
 */
export function startBadgePolling() {
  updateTabBadges();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(updateTabBadges, POLL_INTERVAL);
}

/**
 * 定期更新を停止
 */
export function stopBadgePolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

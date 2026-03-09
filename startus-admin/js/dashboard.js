// --- ダッシュボード ---
import { supabase } from './supabase.js';

export async function renderDashboard() {
  await Promise.all([
    renderNotifications(),
    renderMemberSummary(),
    renderTodaySchedule()
  ]);
}

async function renderNotifications() {
  const el = document.getElementById('dash-notifications');
  if (!el) return;

  try {
    const [appRes, trialRes, transferRes] = await Promise.all([
      supabase.from('applications').select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'reviewed']),
      supabase.from('trials').select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'reviewed']),
      supabase.from('applications').select('id', { count: 'exact', head: true })
        .eq('type', 'transfer')
        .eq('status', 'pending')
    ]);

    const appCount = appRes.count || 0;
    const trialCount = trialRes.count || 0;
    const transferCount = transferRes.count || 0;

    if (appCount === 0 && trialCount === 0 && transferCount === 0) {
      el.innerHTML = '<p style="color:var(--success-color)">未処理の通知はありません</p>';
      return;
    }

    let html = '<div class="dash-notif-list">';
    if (appCount > 0) {
      html += `<div class="dash-notif-item">
        <span class="material-icons" style="color:var(--warning-color)">description</span>
        <span>未処理の申請 <strong>${appCount}件</strong></span>
      </div>`;
    }
    if (trialCount > 0) {
      html += `<div class="dash-notif-item">
        <span class="material-icons" style="color:var(--accent-color)">person_search</span>
        <span>未処理の体験 <strong>${trialCount}件</strong></span>
      </div>`;
    }
    if (transferCount > 0) {
      html += `<div class="dash-notif-item">
        <span class="material-icons" style="color:var(--primary-color)">swap_horiz</span>
        <span>未処理の振替 <strong>${transferCount}件</strong></span>
      </div>`;
    }
    html += '</div>';
    el.innerHTML = html;
  } catch {
    el.innerHTML = '<p class="text-muted">読み込みに失敗しました</p>';
  }
}

async function renderMemberSummary() {
  const el = document.getElementById('dash-members');
  if (!el) return;

  try {
    const [activeRes, totalRes] = await Promise.all([
      supabase.from('members').select('id', { count: 'exact', head: true })
        .eq('status', '在籍'),
      supabase.from('members').select('id', { count: 'exact', head: true })
    ]);

    const active = activeRes.count || 0;
    const total = totalRes.count || 0;
    const inactive = total - active;

    el.innerHTML = `
      <div class="dash-stat-grid">
        <div class="dash-stat">
          <div class="dash-stat-value" style="color:var(--primary-color)">${active}</div>
          <div class="dash-stat-label">在籍</div>
        </div>
        <div class="dash-stat">
          <div class="dash-stat-value" style="color:var(--gray-400)">${inactive}</div>
          <div class="dash-stat-label">休退会</div>
        </div>
        <div class="dash-stat">
          <div class="dash-stat-value">${total}</div>
          <div class="dash-stat-label">全体</div>
        </div>
      </div>`;
  } catch {
    el.innerHTML = '<p class="text-muted">読み込みに失敗しました</p>';
  }
}

async function renderTodaySchedule() {
  const el = document.getElementById('dash-schedule');
  if (!el) return;

  try {
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase
      .from('schedules')
      .select('title, start_time, end_time, classroom_name, status')
      .eq('date', today)
      .in('status', ['confirmed', 'published'])
      .order('start_time', { ascending: true })
      .limit(10);

    if (error) throw error;

    if (!data || data.length === 0) {
      el.innerHTML = '<p class="text-muted">今日の予定はありません</p>';
      return;
    }

    let html = '<div class="dash-schedule-list">';
    for (const s of data) {
      const time = s.start_time ? s.start_time.slice(0, 5) : '';
      const end = s.end_time ? `〜${s.end_time.slice(0, 5)}` : '';
      html += `<div class="dash-schedule-item">
        <span class="dash-schedule-time">${time}${end}</span>
        <span class="dash-schedule-title">${s.title || s.classroom_name || ''}</span>
      </div>`;
    }
    html += '</div>';
    el.innerHTML = html;
  } catch {
    el.innerHTML = '<p class="text-muted">スケジュール情報を取得できません</p>';
  }
}

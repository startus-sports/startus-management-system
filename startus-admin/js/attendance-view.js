// ============================================
// 出欠履歴表示モジュール
// ============================================
// 会員詳細モーダルに出欠記録を表示する

import { supabase } from './supabase.js';

// ============================================
// 会員の出欠履歴を読み込んで HTML を返す
// ============================================
export async function loadMemberAttendance(memberId) {
  try {
    // 出欠レコードを取得（イベント情報を JOIN）
    const { data: records, error } = await supabase
      .from('attendance_records')
      .select(`
        id,
        status,
        person_type,
        attendance_events (
          id,
          date,
          classroom_id,
          classrooms ( name )
        )
      `)
      .eq('person_id', memberId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!records || records.length === 0) {
      return '<p class="attendance-empty">出欠記録はありません</p>';
    }

    // 集計
    const present = records.filter(r => r.status === 'present').length;
    const absent = records.filter(r => r.status === 'absent').length;
    const total = present + absent;
    const rate = total > 0 ? Math.round((present / total) * 100) : 0;

    // 日付でソート（新しい順）
    records.sort((a, b) => {
      const dateA = a.attendance_events?.date || '';
      const dateB = b.attendance_events?.date || '';
      return dateB.localeCompare(dateA);
    });

    // HTML 構築
    let html = `
      <div class="attendance-summary-mini">
        <span class="att-stat">出席 <strong>${present}</strong>回</span>
        <span class="att-divider">/</span>
        <span class="att-stat">欠席 <strong>${absent}</strong>回</span>
        <span class="att-divider">/</span>
        <span class="att-stat">出席率 <strong class="${getRateClass(rate)}">${rate}%</strong></span>
      </div>
      <div class="attendance-history-list">`;

    for (const r of records) {
      const event = r.attendance_events;
      const date = event?.date || '不明';
      const classroomName = event?.classrooms?.name || '';
      const statusClass = r.status === 'present' ? 'att-present' : 'att-absent';
      const statusLabel = r.status === 'present' ? '出席' : '欠席';

      html += `
        <div class="attendance-history-item">
          <span class="att-date">${formatDateShort(date)}</span>
          ${classroomName ? `<span class="badge badge-class att-classroom">${escapeHtml(classroomName)}</span>` : ''}
          <span class="att-badge ${statusClass}">${statusLabel}</span>
        </div>`;
    }

    html += '</div>';
    return html;
  } catch (error) {
    console.error('出欠履歴の読み込みエラー:', error);
    return '<p class="attendance-error">出欠履歴の読み込みに失敗しました</p>';
  }
}

// ============================================
// 出欠率のクラスを返す
// ============================================
function getRateClass(rate) {
  if (rate >= 80) return 'rate-high';
  if (rate >= 50) return 'rate-mid';
  return 'rate-low';
}

// ============================================
// 日付の短縮フォーマット
// ============================================
function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const w = weekdays[d.getDay()];
  return `${m}/${day}(${w})`;
}

// ============================================
// HTML エスケープ
// ============================================
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================
// 出欠統計モジュール
// ============================================
// 月別・教室別の出欠統計を表示する

import { supabase } from './supabase.js';
import { escapeHtml } from './utils.js';

let initialized = false;
let classrooms = [];

// ============================================
// 初期化
// ============================================
export async function initAttendanceStats() {
  if (initialized) {
    // 再表示時はデータ再読み込み
    await loadAttendanceStats();
    return;
  }
  initialized = true;

  // 教室一覧を取得
  const { data } = await supabase
    .from('classrooms')
    .select('id, name')
    .eq('is_active', true)
    .order('display_order')
    .order('name');
  classrooms = data || [];

  // フィルタ構築
  buildFilters();

  // イベントリスナー
  document.getElementById('att-stats-period').addEventListener('change', loadAttendanceStats);
  document.getElementById('att-stats-classroom').addEventListener('change', loadAttendanceStats);

  // データ読み込み
  await loadAttendanceStats();
}

// ============================================
// フィルタ構築
// ============================================
function buildFilters() {
  // 期間（過去12ヶ月 + 全期間）
  const periodSelect = document.getElementById('att-stats-period');
  const now = new Date();
  let options = '<option value="all">全期間</option>';

  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = `${d.getFullYear()}年${d.getMonth() + 1}月`;
    options += `<option value="${val}">${label}</option>`;
  }

  periodSelect.innerHTML = options;
  // デフォルトで当月を選択
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  periodSelect.value = currentMonth;

  // 教室
  const classroomSelect = document.getElementById('att-stats-classroom');
  classroomSelect.innerHTML = '<option value="">全教室</option>' +
    classrooms.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
}

// ============================================
// 統計データ読み込み & 表示
// ============================================
async function loadAttendanceStats() {
  const period = document.getElementById('att-stats-period').value;
  const classroomId = document.getElementById('att-stats-classroom').value;

  try {
    // イベントを取得
    let eventsQuery = supabase
      .from('attendance_events')
      .select('id, date, classroom_id, classrooms(name)')
      .order('date', { ascending: false });

    if (classroomId) {
      eventsQuery = eventsQuery.eq('classroom_id', classroomId);
    }

    if (period && period !== 'all') {
      const [year, month] = period.split('-').map(Number);
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const endDate = new Date(year, month, 0); // last day of month
      const endStr = `${year}-${String(month).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
      eventsQuery = eventsQuery.gte('date', startDate).lte('date', endStr);
    }

    const { data: events, error: evErr } = await eventsQuery;
    if (evErr) throw evErr;

    if (!events || events.length === 0) {
      renderEmpty();
      return;
    }

    const eventIds = events.map(e => e.id);

    // 出欠レコードを取得
    const { data: records, error: recErr } = await supabase
      .from('attendance_records')
      .select('event_id, person_id, person_type, status')
      .in('event_id', eventIds);

    if (recErr) throw recErr;

    // 会員名を取得
    const personIds = [...new Set((records || []).map(r => r.person_id))];
    const memberMap = {};

    if (personIds.length > 0) {
      // メンバーテーブルから取得
      const { data: members } = await supabase
        .from('members')
        .select('id, name, classes')
        .in('id', personIds);
      for (const m of (members || [])) {
        memberMap[m.id] = { name: m.name, classes: m.classes || [], type: 'member' };
      }

      // staffテーブルからも取得
      const { data: staff } = await supabase
        .from('staff')
        .select('id, name')
        .in('id', personIds);
      for (const s of (staff || [])) {
        if (!memberMap[s.id]) {
          memberMap[s.id] = { name: s.name, classes: [], type: 'staff' };
        }
      }
    }

    // 集計
    const totalEvents = events.length;
    const personStats = {};

    for (const r of (records || [])) {
      if (!personStats[r.person_id]) {
        personStats[r.person_id] = { present: 0, absent: 0, total: 0 };
      }
      personStats[r.person_id].total++;
      if (r.status === 'present') personStats[r.person_id].present++;
      else personStats[r.person_id].absent++;
    }

    // サマリー
    const uniquePersons = Object.keys(personStats).length;
    const totalPresent = Object.values(personStats).reduce((s, p) => s + p.present, 0);
    const totalRecords = Object.values(personStats).reduce((s, p) => s + p.total, 0);
    const avgRate = totalRecords > 0 ? Math.round((totalPresent / totalRecords) * 100) : 0;

    renderSummary(totalEvents, uniquePersons, avgRate);

    // テーブル（出席率でソート）
    const rows = Object.entries(personStats)
      .map(([id, stats]) => ({
        id,
        name: memberMap[id]?.name || '不明',
        type: memberMap[id]?.type || 'member',
        classes: memberMap[id]?.classes || [],
        ...stats,
        rate: stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 0
      }))
      .sort((a, b) => b.rate - a.rate || a.name.localeCompare(b.name, 'ja'));

    renderTable(rows, totalEvents);

  } catch (error) {
    console.error('出欠統計の読み込みエラー:', error);
    document.getElementById('att-stats-table').innerHTML =
      '<p style="color:var(--danger-color);padding:20px">読み込みに失敗しました</p>';
  }
}

// ============================================
// サマリーカード表示
// ============================================
function renderSummary(events, persons, avgRate) {
  document.getElementById('att-stats-summary').innerHTML = `
    <div class="att-stats-card">
      <span class="material-icons">event</span>
      <div>
        <div class="att-stats-card-value">${events}回</div>
        <div class="att-stats-card-label">開催回数</div>
      </div>
    </div>
    <div class="att-stats-card">
      <span class="material-icons">people</span>
      <div>
        <div class="att-stats-card-value">${persons}名</div>
        <div class="att-stats-card-label">対象人数</div>
      </div>
    </div>
    <div class="att-stats-card">
      <span class="material-icons">trending_up</span>
      <div>
        <div class="att-stats-card-value ${getRateClass(avgRate)}">${avgRate}%</div>
        <div class="att-stats-card-label">平均出席率</div>
      </div>
    </div>`;
}

// ============================================
// テーブル表示
// ============================================
function renderTable(rows, totalEvents) {
  if (rows.length === 0) {
    document.getElementById('att-stats-table').innerHTML =
      '<p style="color:var(--gray-400);padding:20px">データがありません</p>';
    return;
  }

  let html = `<table class="att-stats-tbl">
    <thead>
      <tr>
        <th>名前</th>
        <th>教室</th>
        <th>出席</th>
        <th>出席率</th>
      </tr>
    </thead>
    <tbody>`;

  for (const r of rows) {
    const classLabel = r.type === 'staff' ? '<span class="badge badge-staff">スタッフ</span>' :
      (r.classes.length > 0 ? r.classes.map(c => `<span class="badge badge-class">${escapeHtml(c)}</span>`).join(' ') : '-');

    html += `
      <tr>
        <td class="att-tbl-name">${escapeHtml(r.name)}</td>
        <td>${classLabel}</td>
        <td>${r.present}/${r.total}</td>
        <td>
          <span class="att-rate-bar">
            <span class="att-rate-fill ${getRateClass(r.rate)}" style="width:${r.rate}%"></span>
          </span>
          <span class="${getRateClass(r.rate)}">${r.rate}%</span>
        </td>
      </tr>`;
  }

  html += '</tbody></table>';
  document.getElementById('att-stats-table').innerHTML = html;
}

// ============================================
// 空表示
// ============================================
function renderEmpty() {
  document.getElementById('att-stats-summary').innerHTML = '';
  document.getElementById('att-stats-table').innerHTML =
    '<p style="color:var(--gray-400);padding:40px;text-align:center">選択した期間・教室にデータがありません</p>';
}

// ============================================
// 出席率のクラス
// ============================================
function getRateClass(rate) {
  if (rate >= 80) return 'rate-high';
  if (rate >= 50) return 'rate-mid';
  return 'rate-low';
}

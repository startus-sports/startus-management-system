// ============================================
// 出欠統計モジュール
// ============================================
// 月別・教室別の出欠統計を表示する

import { supabase } from './supabase.js';
import { escapeHtml } from './utils.js';
import { tagToName } from './class-utils.js';

let initialized = false;
let classrooms = [];

// ソート・フィルタ状態
let currentSort = { key: 'rate', asc: false };
let allRows = [];        // フィルタ前の全行データ
let allEvents = [];      // イベントデータ（展開行で使用）
let allRecords = [];     // 出欠レコード（展開行で使用）

// ============================================
// 初期化
// ============================================
export async function initAttendanceStats() {
  if (initialized) {
    await loadAttendanceStats();
    return;
  }
  initialized = true;

  // 教室一覧を取得
  const { data } = await supabase
    .from('classrooms')
    .select('id, name, attendance_group')
    .eq('is_active', true)
    .order('display_order')
    .order('name');
  classrooms = data || [];

  // フィルタ構築
  buildFilters();

  // イベントリスナー（データ再読み込み）
  document.getElementById('att-stats-period').addEventListener('change', loadAttendanceStats);
  document.getElementById('att-stats-classroom').addEventListener('change', loadAttendanceStats);

  // クライアントサイドフィルタ（再描画のみ）
  document.getElementById('att-stats-search').addEventListener('input', applyClientFilters);
  document.getElementById('att-stats-rate-filter').addEventListener('change', applyClientFilters);
  document.getElementById('att-stats-type-filter').addEventListener('change', applyClientFilters);

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
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  periodSelect.value = currentMonth;

  // 教室（グループ対応）
  const classroomSelect = document.getElementById('att-stats-classroom');
  const groups = [...new Set(classrooms.filter(c => c.attendance_group).map(c => c.attendance_group))];
  let classroomOpts = '<option value="">全教室</option>';
  if (groups.length > 0) {
    classroomOpts += '<optgroup label="合同グループ">';
    for (const g of groups) {
      classroomOpts += `<option value="group:${escapeHtml(g)}">[合同] ${escapeHtml(g)}</option>`;
    }
    classroomOpts += '</optgroup><optgroup label="教室">';
  }
  classroomOpts += classrooms.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  if (groups.length > 0) classroomOpts += '</optgroup>';
  classroomSelect.innerHTML = classroomOpts;
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
      .select('id, date, classroom_id, attendance_group, classrooms(name)')
      .order('date', { ascending: false });

    if (classroomId && classroomId.startsWith('group:')) {
      eventsQuery = eventsQuery.eq('attendance_group', classroomId.replace('group:', ''));
    } else if (classroomId) {
      eventsQuery = eventsQuery.eq('classroom_id', classroomId);
    }

    if (period && period !== 'all') {
      const [year, month] = period.split('-').map(Number);
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const endDate = new Date(year, month, 0);
      const endStr = `${year}-${String(month).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
      eventsQuery = eventsQuery.gte('date', startDate).lte('date', endStr);
    }

    const { data: events, error: evErr } = await eventsQuery;
    if (evErr) throw evErr;

    if (!events || events.length === 0) {
      renderEmpty();
      return;
    }

    allEvents = events;
    const eventIds = events.map(e => e.id);

    // 出欠レコードを取得
    const { data: records, error: recErr } = await supabase
      .from('attendance_records')
      .select('event_id, person_id, person_type, status')
      .in('event_id', eventIds);

    if (recErr) throw recErr;
    allRecords = records || [];

    // 会員名を取得
    const personIds = [...new Set(allRecords.map(r => r.person_id))];
    const memberMap = {};

    if (personIds.length > 0) {
      const { data: members } = await supabase
        .from('members')
        .select('id, name, classes')
        .in('id', personIds);
      for (const m of (members || [])) {
        memberMap[m.id] = { name: m.name, classes: m.classes || [], type: 'member' };
      }

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

    for (const r of allRecords) {
      if (!personStats[r.person_id]) {
        personStats[r.person_id] = { present: 0, absent: 0, total: 0 };
      }
      personStats[r.person_id].total++;
      if (r.status === 'present') personStats[r.person_id].present++;
      else personStats[r.person_id].absent++;
    }

    // ストリーク計算
    const eventDateMap = {};
    for (const e of events) {
      eventDateMap[e.id] = e.date;
    }

    const streaks = calcStreaks(allRecords, eventDateMap);

    // サマリー
    const uniquePersons = Object.keys(personStats).length;
    const totalPresent = Object.values(personStats).reduce((s, p) => s + p.present, 0);
    const totalRecords = Object.values(personStats).reduce((s, p) => s + p.total, 0);
    const avgRate = totalRecords > 0 ? Math.round((totalPresent / totalRecords) * 100) : 0;

    renderSummary(totalEvents, uniquePersons, avgRate);

    // 行データ構築
    allRows = Object.entries(personStats)
      .map(([id, stats]) => ({
        id,
        name: memberMap[id]?.name || '不明',
        type: memberMap[id]?.type || 'member',
        classes: memberMap[id]?.classes || [],
        ...stats,
        rate: stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 0,
        streak: streaks[id] || { type: 'none', count: 0 }
      }));

    applyClientFilters();

  } catch (error) {
    console.error('出欠統計の読み込みエラー:', error);
    document.getElementById('att-stats-table').innerHTML =
      '<p style="color:var(--danger-color);padding:20px">読み込みに失敗しました</p>';
  }
}

// ============================================
// ストリーク（連続出席/欠席）計算
// ============================================
function calcStreaks(records, eventDateMap) {
  // person_id ごとに records を日付順にグループ化
  const byPerson = {};
  for (const r of records) {
    if (!byPerson[r.person_id]) byPerson[r.person_id] = [];
    byPerson[r.person_id].push({
      date: eventDateMap[r.event_id],
      status: r.status
    });
  }

  const streaks = {};
  for (const [personId, recs] of Object.entries(byPerson)) {
    // 日付昇順でソート
    recs.sort((a, b) => a.date.localeCompare(b.date));

    // 最新から遡って連続カウント
    let streakType = recs[recs.length - 1].status;
    let count = 0;
    for (let i = recs.length - 1; i >= 0; i--) {
      if (recs[i].status === streakType) {
        count++;
      } else {
        break;
      }
    }

    streaks[personId] = {
      type: streakType, // 'present' or 'absent'
      count
    };
  }

  return streaks;
}

// ============================================
// クライアントサイドフィルタ適用
// ============================================
function applyClientFilters() {
  const searchQuery = (document.getElementById('att-stats-search').value || '').toLowerCase();
  const rateFilter = document.getElementById('att-stats-rate-filter').value;
  const typeFilter = document.getElementById('att-stats-type-filter').value;

  let filtered = allRows;

  // 名前検索
  if (searchQuery) {
    filtered = filtered.filter(r => r.name.toLowerCase().includes(searchQuery));
  }

  // 出席率フィルタ
  if (rateFilter === 'high') {
    filtered = filtered.filter(r => r.rate >= 80);
  } else if (rateFilter === 'mid') {
    filtered = filtered.filter(r => r.rate >= 50 && r.rate < 80);
  } else if (rateFilter === 'low') {
    filtered = filtered.filter(r => r.rate < 50);
  }

  // 種別フィルタ
  if (typeFilter === 'member') {
    filtered = filtered.filter(r => r.type === 'member');
  } else if (typeFilter === 'staff') {
    filtered = filtered.filter(r => r.type === 'staff');
  }

  // ソート適用
  const sorted = sortRows(filtered);
  renderTable(sorted);
}

// ============================================
// ソート
// ============================================
function sortRows(rows) {
  const { key, asc } = currentSort;
  const sorted = [...rows];
  const dir = asc ? 1 : -1;

  sorted.sort((a, b) => {
    switch (key) {
      case 'name':
        return dir * a.name.localeCompare(b.name, 'ja');
      case 'present':
        return dir * (a.present - b.present) || a.name.localeCompare(b.name, 'ja');
      case 'absent':
        return dir * (a.absent - b.absent) || a.name.localeCompare(b.name, 'ja');
      case 'rate':
      default:
        return dir * (a.rate - b.rate) || a.name.localeCompare(b.name, 'ja');
    }
  });
  return sorted;
}

function onSortClick(key) {
  if (currentSort.key === key) {
    currentSort.asc = !currentSort.asc;
  } else {
    currentSort.key = key;
    currentSort.asc = key === 'name'; // 名前はデフォルト昇順、他は降順
  }
  applyClientFilters();
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
function renderTable(rows) {
  if (rows.length === 0) {
    document.getElementById('att-stats-table').innerHTML =
      '<p style="color:var(--gray-400);padding:20px;text-align:center">データがありません</p>';
    return;
  }

  const sortIcon = (key) => {
    if (currentSort.key !== key) return '<span class="material-icons att-sort-icon">unfold_more</span>';
    return currentSort.asc
      ? '<span class="material-icons att-sort-icon att-sort-active">arrow_upward</span>'
      : '<span class="material-icons att-sort-icon att-sort-active">arrow_downward</span>';
  };

  let html = `<table class="att-stats-tbl">
    <thead>
      <tr>
        <th class="att-sortable" data-sort="name">名前 ${sortIcon('name')}</th>
        <th>教室</th>
        <th class="att-sortable" data-sort="present">出席 ${sortIcon('present')}</th>
        <th class="att-sortable" data-sort="absent">欠席 ${sortIcon('absent')}</th>
        <th>連続</th>
        <th class="att-sortable" data-sort="rate">出席率 ${sortIcon('rate')}</th>
        <th></th>
      </tr>
    </thead>
    <tbody>`;

  for (const r of rows) {
    const classLabel = r.type === 'staff' ? '<span class="badge badge-staff">スタッフ</span>' :
      (r.classes.length > 0 ? r.classes.map(c => `<span class="badge badge-class">${escapeHtml(tagToName(c))}</span>`).join(' ') : '-');

    // 皆勤・低出席ハイライト
    let nameExtra = '';
    if (r.rate === 100 && r.total > 0) {
      nameExtra = '<span class="material-icons att-highlight-icon att-perfect" title="皆勤">emoji_events</span>';
    } else if (r.rate < 50 && r.total > 0) {
      nameExtra = '<span class="material-icons att-highlight-icon att-warning" title="低出席率">warning</span>';
    }

    // ストリーク表示
    let streakHtml = '-';
    if (r.streak.count >= 2) {
      if (r.streak.type === 'present') {
        streakHtml = `<span class="att-streak att-streak-present" title="連続出席${r.streak.count}回">
          <span class="material-icons">local_fire_department</span>${r.streak.count}
        </span>`;
      } else {
        streakHtml = `<span class="att-streak att-streak-absent" title="連続欠席${r.streak.count}回">
          <span class="material-icons">warning</span>${r.streak.count}
        </span>`;
      }
    }

    html += `
      <tr>
        <td class="att-tbl-name">${nameExtra}${escapeHtml(r.name)}</td>
        <td>${classLabel}</td>
        <td>${r.present}</td>
        <td>${r.absent}</td>
        <td>${streakHtml}</td>
        <td>
          <span class="att-rate-bar">
            <span class="att-rate-fill ${getRateClass(r.rate)}" style="width:${r.rate}%"></span>
          </span>
          <span class="${getRateClass(r.rate)}">${r.rate}%</span>
        </td>
        <td>
          <span class="material-icons att-expand-btn" data-person-id="${r.id}" title="詳細を表示">expand_more</span>
        </td>
      </tr>
      <tr class="att-detail-row" id="att-detail-${r.id}" style="display:none">
        <td colspan="7">
          <div class="att-detail-content" id="att-detail-content-${r.id}"></div>
        </td>
      </tr>`;
  }

  html += '</tbody></table>';
  document.getElementById('att-stats-table').innerHTML = html;

  // ソートヘッダーのイベントリスナー
  document.querySelectorAll('.att-sortable').forEach(th => {
    th.addEventListener('click', () => onSortClick(th.dataset.sort));
  });

  // 展開ボタンのイベントリスナー
  document.querySelectorAll('.att-expand-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleDetail(btn.dataset.personId, btn));
  });
}

// ============================================
// 詳細展開/折りたたみ
// ============================================
function toggleDetail(personId, btn) {
  const detailRow = document.getElementById(`att-detail-${personId}`);
  const contentDiv = document.getElementById(`att-detail-content-${personId}`);

  if (detailRow.style.display !== 'none') {
    // 折りたたむ
    detailRow.style.display = 'none';
    btn.textContent = 'expand_more';
    contentDiv.innerHTML = '';
    return;
  }

  // 展開する
  detailRow.style.display = '';
  btn.textContent = 'expand_less';

  // この人の出欠レコードを日付順で取得
  const personRecords = allRecords.filter(r => r.person_id === personId);
  const eventMap = {};
  for (const e of allEvents) {
    eventMap[e.id] = e;
  }

  // 日付順にソート
  const details = personRecords
    .map(r => ({
      date: eventMap[r.event_id]?.date || '',
      classroomName: eventMap[r.event_id]?.attendance_group || eventMap[r.event_id]?.classrooms?.name || '-',
      status: r.status
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (details.length === 0) {
    contentDiv.innerHTML = '<div class="att-detail-empty">データがありません</div>';
    return;
  }

  let html = '<div class="att-detail-list">';
  for (const d of details) {
    const dateFormatted = formatDate(d.date);
    const statusClass = d.status === 'present' ? 'att-present' : 'att-absent';
    const statusLabel = d.status === 'present' ? '出席' : '欠席';
    const statusIcon = d.status === 'present' ? 'check_circle' : 'cancel';

    html += `
      <div class="att-detail-item">
        <span class="att-detail-date">${dateFormatted}</span>
        <span class="badge badge-class">${escapeHtml(d.classroomName)}</span>
        <span class="att-detail-status ${statusClass}">
          <span class="material-icons">${statusIcon}</span>${statusLabel}
        </span>
      </div>`;
  }
  html += '</div>';
  contentDiv.innerHTML = html;
}

// ============================================
// 空表示
// ============================================
function renderEmpty() {
  allRows = [];
  allEvents = [];
  allRecords = [];
  document.getElementById('att-stats-summary').innerHTML = '';
  document.getElementById('att-stats-table').innerHTML =
    '<p style="color:var(--gray-400);padding:40px;text-align:center">選択した期間・教室にデータがありません</p>';
}

// ============================================
// ユーティリティ
// ============================================
function getRateClass(rate) {
  if (rate >= 80) return 'rate-high';
  if (rate >= 50) return 'rate-mid';
  return 'rate-low';
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

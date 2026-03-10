// ============================================
// 出欠管理モジュール
// ============================================
// イベント作成・出欠記録の CRUD を行う

import { supabase } from './supabase.js';
import { escapeHtml } from './utils.js';
import { showToast, openModal, closeModal, setModalWide } from './app.js';
import { getActiveClassrooms } from './classroom.js';

let initialized = false;
let classrooms = [];
let allEvents = [];
let currentClassroom = ''; // '' = 全教室, 'group:xxx' or classroomId
let currentSort = { key: 'date', asc: false }; // date, classroom, rate

// ============================================
// 初期化
// ============================================
export async function initAttendance() {
  if (initialized) {
    await renderAttendanceList();
    return;
  }
  initialized = true;

  classrooms = getActiveClassrooms();

  buildFilters();
  buildClassroomTabs();

  document.getElementById('att-mgmt-period').addEventListener('change', renderAttendanceList);

  await renderAttendanceList();
}

// ============================================
// フィルタ構築
// ============================================
function buildFilters() {
  const periodSelect = document.getElementById('att-mgmt-period');
  const now = new Date();
  let opts = '<option value="all">全期間</option>';

  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = `${d.getFullYear()}年${d.getMonth() + 1}月`;
    opts += `<option value="${val}">${label}</option>`;
  }
  periodSelect.innerHTML = opts;
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  periodSelect.value = currentMonth;
}

function buildClassroomTabs() {
  const tabsEl = document.getElementById('att-mgmt-tabs');
  const groups = [...new Set(classrooms.filter(c => c.attendance_group).map(c => c.attendance_group))];

  let html = `<button class="att-stats-tab active" data-classroom="">全教室</button>`;
  for (const g of groups) {
    html += `<button class="att-stats-tab" data-classroom="group:${escapeHtml(g)}">${escapeHtml(g)}</button>`;
  }
  for (const c of classrooms) {
    // 合同グループに属する教室はグループタブでカバーされるのでスキップ
    if (c.attendance_group) continue;
    html += `<button class="att-stats-tab" data-classroom="${c.id}">${escapeHtml(c.name)}</button>`;
  }
  tabsEl.innerHTML = html;

  tabsEl.querySelectorAll('.att-stats-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      currentClassroom = tab.dataset.classroom;
      tabsEl.querySelectorAll('.att-stats-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderAttendanceList();
    });
  });
}

// ============================================
// イベント一覧を読み込み＆表示
// ============================================
export async function renderAttendanceList() {
  const period = document.getElementById('att-mgmt-period').value;
  const listEl = document.getElementById('att-event-list');

  try {
    let query = supabase
      .from('attendance_events')
      .select('id, date, classroom_id, attendance_group, note, classrooms(name)')
      .order('date', { ascending: false });

    if (currentClassroom && currentClassroom.startsWith('group:')) {
      query = query.eq('attendance_group', currentClassroom.replace('group:', ''));
    } else if (currentClassroom) {
      query = query.eq('classroom_id', currentClassroom);
    }

    if (period && period !== 'all') {
      const [year, month] = period.split('-').map(Number);
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const endDate = new Date(year, month, 0);
      const endStr = `${year}-${String(month).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
      query = query.gte('date', startDate).lte('date', endStr);
    }

    const { data: events, error } = await query;
    if (error) throw error;

    if (!events || events.length === 0) {
      document.getElementById('att-event-count-text').textContent = '0件';
      listEl.innerHTML = `
        <div class="empty-state">
          <span class="material-icons empty-icon">event_busy</span>
          <p>出欠データがありません</p>
        </div>`;
      return;
    }

    // 出欠レコード数を集計
    const eventIds = events.map(e => e.id);
    const { data: records } = await supabase
      .from('attendance_records')
      .select('event_id, status')
      .in('event_id', eventIds);

    const countMap = {};
    for (const r of (records || [])) {
      if (!countMap[r.event_id]) countMap[r.event_id] = { present: 0, absent: 0 };
      if (r.status === 'present') countMap[r.event_id].present++;
      else countMap[r.event_id].absent++;
    }

    allEvents = events.map(e => ({
      ...e,
      classroomName: e.classrooms?.name || '',
      displayLabel: e.attendance_group ? `[合同] ${e.attendance_group}` : (e.classrooms?.name || ''),
      present: countMap[e.id]?.present || 0,
      absent: countMap[e.id]?.absent || 0
    }));

    sortAndRenderEvents();
  } catch (err) {
    console.error('出欠イベント読み込みエラー:', err);
    listEl.innerHTML = '<p style="color:var(--danger-color);padding:20px">読み込みに失敗しました</p>';
  }
}

// ============================================
// ソート＆描画
// ============================================
function sortAndRenderEvents() {
  const sorted = [...allEvents];

  switch (currentSort.key) {
    case 'date':
      sorted.sort((a, b) => currentSort.asc ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date));
      break;
    case 'classroom':
      sorted.sort((a, b) => {
        const cmp = a.displayLabel.localeCompare(b.displayLabel, 'ja');
        return currentSort.asc ? cmp || a.date.localeCompare(b.date) : -cmp || b.date.localeCompare(a.date);
      });
      break;
    case 'rate':
      sorted.sort((a, b) => {
        const rateA = (a.present + a.absent) > 0 ? a.present / (a.present + a.absent) : 0;
        const rateB = (b.present + b.absent) > 0 ? b.present / (b.present + b.absent) : 0;
        return currentSort.asc ? rateA - rateB : rateB - rateA;
      });
      break;
  }

  document.getElementById('att-event-count-text').textContent = `${sorted.length}件`;

  const listEl = document.getElementById('att-event-list');

  if (sorted.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <span class="material-icons empty-icon">event_busy</span>
        <p>出欠データがありません</p>
      </div>`;
    return;
  }

  const sortIcon = (key) => {
    if (currentSort.key !== key) return `<span class="material-icons att-sort-icon">unfold_more</span>`;
    const icon = currentSort.asc ? 'arrow_upward' : 'arrow_downward';
    return `<span class="material-icons att-sort-icon att-sort-active">${icon}</span>`;
  };

  let html = `
    <div class="att-event-grid-header">
      <span class="att-sortable" data-sort="date">日付${sortIcon('date')}</span>
      <span class="att-sortable" data-sort="classroom">教室${sortIcon('classroom')}</span>
      <span class="att-sortable" data-sort="rate">出欠${sortIcon('rate')}</span>
      <span>メモ</span>
      <span>操作</span>
    </div>`;

  for (const ev of sorted) {
    const dateLabel = formatDateShort(ev.date);
    const total = ev.present + ev.absent;
    const rate = total > 0 ? Math.round((ev.present / total) * 100) : 0;
    const rateClass = rate >= 80 ? 'rate-high' : rate >= 50 ? 'rate-mid' : 'rate-low';

    html += `
      <div class="list-item att-event-row" onclick="window.memberApp.openAttendanceModal('${ev.id}')">
        <span class="att-event-date">${dateLabel}</span>
        <span class="att-event-classroom">${escapeHtml(ev.displayLabel) || '-'}</span>
        <span class="att-count-badge">
          <span class="att-count-present">${ev.present}</span> / <span class="att-count-absent">${ev.absent}</span>
          <span class="att-count-total">(${total}名)</span>
          ${total > 0 ? `<span class="att-event-rate ${rateClass}">${rate}%</span>` : ''}
        </span>
        <span class="att-event-note">${escapeHtml(ev.note) || '-'}</span>
        <span class="att-event-actions" onclick="event.stopPropagation()">
          <button class="btn-icon" title="編集" onclick="window.memberApp.editEvent('${ev.id}')">
            <span class="material-icons" style="font-size:18px">edit</span>
          </button>
          <button class="btn-icon" title="削除" onclick="window.memberApp.confirmDeleteEvent('${ev.id}')">
            <span class="material-icons" style="font-size:18px;color:var(--danger-color)">delete</span>
          </button>
        </span>
      </div>`;
  }

  listEl.innerHTML = html;

  // ソートヘッダーのクリックイベント
  listEl.querySelectorAll('.att-sortable').forEach(el => {
    el.addEventListener('click', () => {
      const key = el.dataset.sort;
      if (currentSort.key === key) {
        currentSort.asc = !currentSort.asc;
      } else {
        currentSort = { key, asc: key === 'classroom' };
      }
      sortAndRenderEvents();
    });
  });
}

// ============================================
// イベント作成モーダル
// ============================================
export function openCreateEventModal() {
  const today = new Date().toISOString().split('T')[0];
  const groups = [...new Set(classrooms.filter(c => c.attendance_group).map(c => c.attendance_group))];

  let selectOptions = '<option value="">選択してください</option>';
  if (groups.length > 0) {
    selectOptions += '<optgroup label="合同グループ">';
    for (const g of groups) {
      selectOptions += `<option value="group:${escapeHtml(g)}">[合同] ${escapeHtml(g)}</option>`;
    }
    selectOptions += '</optgroup><optgroup label="単独教室">';
  }
  selectOptions += classrooms.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  if (groups.length > 0) selectOptions += '</optgroup>';

  const content = `
    <div class="form-group">
      <label>日付</label>
      <input type="date" id="new-event-date" value="${today}" class="form-control">
    </div>
    <div class="form-group">
      <label>教室 / 合同グループ</label>
      <select id="new-event-classroom" class="form-control">
        ${selectOptions}
      </select>
    </div>
    <div class="form-group">
      <label>メモ</label>
      <input type="text" id="new-event-note" class="form-control" placeholder="任意">
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" onclick="window.memberApp.createEventAndOpen()">
        <span class="material-icons">check</span> 作成して出欠入力
      </button>
      <button class="btn btn-secondary" onclick="window.memberApp.createEventOnly()">
        作成のみ
      </button>
    </div>`;

  openModal('イベント作成', content);
}

// ============================================
// イベント作成（共通）
// ============================================
async function createEvent() {
  const date = document.getElementById('new-event-date').value;
  const selection = document.getElementById('new-event-classroom').value;
  const note = document.getElementById('new-event-note').value.trim();

  if (!date) {
    showToast('日付を入力してください', 'error');
    return null;
  }
  if (!selection) {
    showToast('教室を選択してください', 'error');
    return null;
  }

  let classroomId;
  let attendanceGroup = '';

  if (selection.startsWith('group:')) {
    attendanceGroup = selection.replace('group:', '');
    const groupClassrooms = classrooms.filter(c => c.attendance_group === attendanceGroup);
    if (groupClassrooms.length === 0) {
      showToast('グループに教室が見つかりません', 'error');
      return null;
    }
    classroomId = groupClassrooms[0].id;
  } else {
    classroomId = selection;
  }

  const { data, error } = await supabase
    .from('attendance_events')
    .insert({ date, classroom_id: classroomId, attendance_group: attendanceGroup, note })
    .select()
    .single();

  if (error) {
    console.error('イベント作成エラー:', error);
    showToast('イベントの作成に失敗しました', 'error');
    return null;
  }

  showToast('イベントを作成しました', 'success');
  return data;
}

export async function createEventAndOpen() {
  const ev = await createEvent();
  if (!ev) return;
  closeModal();
  await renderAttendanceList();
  await openAttendanceModal(ev.id);
}

export async function createEventOnly() {
  const ev = await createEvent();
  if (!ev) return;
  closeModal();
  await renderAttendanceList();
}

// ============================================
// 出欠入力モーダル
// ============================================
export async function openAttendanceModal(eventId) {
  // イベント情報を取得
  const { data: event, error: evErr } = await supabase
    .from('attendance_events')
    .select('id, date, classroom_id, attendance_group, note, classrooms(name)')
    .eq('id', eventId)
    .single();

  if (evErr || !event) {
    showToast('イベントが見つかりません', 'error');
    return;
  }

  // 対象教室タグのリストとタイトルを決定
  let targetClassroomTags = [];
  let displayTitle = '';

  if (event.attendance_group) {
    const groupClassrooms = classrooms.filter(c => c.attendance_group === event.attendance_group);
    targetClassroomTags = groupClassrooms.map(c => c.calendar_tag).filter(Boolean);
    displayTitle = `[合同] ${event.attendance_group}`;
  } else {
    const matched = classrooms.find(c => c.id === event.classroom_id);
    const tag = matched?.calendar_tag || '';
    targetClassroomTags = tag ? [tag] : [];
    displayTitle = event.classrooms?.name || '';
  }

  // 教室に所属する会員を取得（複数教室対応・重複排除）
  let members = [];
  if (targetClassroomTags.length > 0) {
    const results = await Promise.all(
      targetClassroomTags.map(tag =>
        supabase
          .from('members')
          .select('id, name, classes, status')
          .contains('classes', [tag])
          .eq('status', '在籍')
      )
    );
    const memberMap = {};
    for (const { data } of results) {
      for (const m of (data || [])) {
        memberMap[m.id] = m;
      }
    }
    members = Object.values(memberMap).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  }

  // 指導者・スタッフを取得（show_in_attendance=true かつ教室に所属）
  let staffList = [];
  const { data: allStaff } = await supabase
    .from('staff')
    .select('id, name, role, classes')
    .eq('status', '在籍')
    .eq('show_in_attendance', true)
    .order('display_order')
    .order('name');

  if (allStaff && targetClassroomTags.length > 0) {
    staffList = allStaff.filter(s => {
      const staffClasses = s.classes || [];
      return staffClasses.length === 0 || targetClassroomTags.some(tag => staffClasses.includes(tag));
    });
  } else if (allStaff) {
    staffList = allStaff;
  }

  // 既存の出欠レコードを取得
  const { data: existingRecords } = await supabase
    .from('attendance_records')
    .select('person_id, status')
    .eq('event_id', eventId);

  const recordMap = {};
  for (const r of (existingRecords || [])) {
    recordMap[r.person_id] = r.status;
  }

  // モーダル構築
  setModalWide(true);

  // 会員行の生成
  let memberRows = '';
  for (const m of members) {
    const currentStatus = recordMap[m.id] || 'present';
    memberRows += `
      <div class="att-member-row" data-member-id="${m.id}" data-person-type="member">
        <span class="att-member-name">${escapeHtml(m.name)}</span>
        <div class="att-toggle">
          <button type="button" class="att-toggle-btn present ${currentStatus === 'present' ? 'active' : ''}"
                  onclick="window.memberApp.toggleAttendance(this, 'present')">出席</button>
          <button type="button" class="att-toggle-btn absent ${currentStatus === 'absent' ? 'active' : ''}"
                  onclick="window.memberApp.toggleAttendance(this, 'absent')">欠席</button>
        </div>
      </div>`;
  }

  // スタッフ行の生成
  let staffRows = '';
  for (const s of staffList) {
    const currentStatus = recordMap[s.id] || 'present';
    const roleLabel = s.role || 'スタッフ';
    staffRows += `
      <div class="att-member-row" data-member-id="${s.id}" data-person-type="staff">
        <span class="att-member-name">
          ${escapeHtml(s.name)}
          <span class="att-role-badge">${escapeHtml(roleLabel)}</span>
        </span>
        <div class="att-toggle">
          <button type="button" class="att-toggle-btn present ${currentStatus === 'present' ? 'active' : ''}"
                  onclick="window.memberApp.toggleAttendance(this, 'present')">出席</button>
          <button type="button" class="att-toggle-btn absent ${currentStatus === 'absent' ? 'active' : ''}"
                  onclick="window.memberApp.toggleAttendance(this, 'absent')">欠席</button>
        </div>
      </div>`;
  }

  const totalCount = members.length + staffList.length;

  const content = `
    <div class="att-bulk-actions">
      <button class="btn btn-sm btn-secondary" onclick="window.memberApp.bulkSetAttendance('present')">
        <span class="material-icons" style="font-size:16px">done_all</span> 全員出席
      </button>
      <button class="btn btn-sm btn-secondary" onclick="window.memberApp.bulkSetAttendance('absent')">
        <span class="material-icons" style="font-size:16px">remove_done</span> 全員欠席
      </button>
      <span style="margin-left:auto;font-size:13px;color:var(--gray-500)">${totalCount}名</span>
    </div>
    <div class="att-member-list" id="att-member-list">
      ${members.length > 0 ? `
        <div class="att-section-label">
          <span class="material-icons" style="font-size:16px">people</span>会員（${members.length}名）
        </div>
        ${memberRows}
      ` : ''}
      ${staffList.length > 0 ? `
        <div class="att-section-label att-section-staff">
          <span class="material-icons" style="font-size:16px">badge</span>指導者・スタッフ（${staffList.length}名）
        </div>
        ${staffRows}
      ` : ''}
      ${totalCount === 0 ? '<p style="padding:20px;color:var(--gray-400)">この教室に所属する会員・スタッフがいません</p>' : ''}
    </div>
    ${totalCount > 0 ? `
    <div class="modal-actions" style="margin-top:16px">
      <button class="btn btn-primary" onclick="window.memberApp.saveAttendance('${eventId}')">
        <span class="material-icons" style="font-size:16px">save</span> 保存
      </button>
    </div>` : ''}`;

  const dateLabel = formatDateShort(event.date);
  openModal(`出欠入力 - ${dateLabel} ${displayTitle}`, content);
}

// ============================================
// トグル操作
// ============================================
export function toggleAttendance(btn, status) {
  const row = btn.closest('.att-member-row');
  row.querySelectorAll('.att-toggle-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

export function bulkSetAttendance(status) {
  const rows = document.querySelectorAll('#att-member-list .att-member-row');
  rows.forEach(row => {
    row.querySelectorAll('.att-toggle-btn').forEach(b => b.classList.remove('active'));
    const target = row.querySelector(`.att-toggle-btn.${status}`);
    if (target) target.classList.add('active');
  });
}

// ============================================
// 出欠保存
// ============================================
export async function saveAttendance(eventId) {
  const rows = document.querySelectorAll('#att-member-list .att-member-row');
  const records = [];

  rows.forEach(row => {
    const personId = row.dataset.memberId;
    const personType = row.dataset.personType || 'member';
    const presentBtn = row.querySelector('.att-toggle-btn.present');
    const status = presentBtn && presentBtn.classList.contains('active') ? 'present' : 'absent';
    records.push({
      event_id: eventId,
      person_id: personId,
      person_type: personType,
      status
    });
  });

  if (records.length === 0) return;

  const { error } = await supabase
    .from('attendance_records')
    .upsert(records, { onConflict: 'event_id,person_id' });

  if (error) {
    console.error('出欠保存エラー:', error);
    showToast('保存に失敗しました', 'error');
    return;
  }

  showToast('出欠を保存しました', 'success');
  closeModal();
  await renderAttendanceList();
}

// ============================================
// イベント編集モーダル
// ============================================
export async function editEvent(eventId) {
  const ev = allEvents.find(e => e.id === eventId);
  if (!ev) return;

  const groups = [...new Set(classrooms.filter(c => c.attendance_group).map(c => c.attendance_group))];
  const currentValue = ev.attendance_group ? `group:${ev.attendance_group}` : ev.classroom_id;

  let selectOptions = '<option value="">選択してください</option>';
  if (groups.length > 0) {
    selectOptions += '<optgroup label="合同グループ">';
    for (const g of groups) {
      selectOptions += `<option value="group:${escapeHtml(g)}" ${currentValue === `group:${g}` ? 'selected' : ''}>[合同] ${escapeHtml(g)}</option>`;
    }
    selectOptions += '</optgroup><optgroup label="単独教室">';
  }
  selectOptions += classrooms.map(c =>
    `<option value="${c.id}" ${!ev.attendance_group && c.id === ev.classroom_id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
  ).join('');
  if (groups.length > 0) selectOptions += '</optgroup>';

  const content = `
    <div class="form-group">
      <label>日付</label>
      <input type="date" id="edit-event-date" value="${ev.date}" class="form-control">
    </div>
    <div class="form-group">
      <label>教室 / 合同グループ</label>
      <select id="edit-event-classroom" class="form-control">
        ${selectOptions}
      </select>
    </div>
    <div class="form-group">
      <label>メモ</label>
      <input type="text" id="edit-event-note" value="${escapeHtml(ev.note || '')}" class="form-control">
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" onclick="window.memberApp.saveEventEdit('${eventId}')">
        <span class="material-icons">save</span> 保存
      </button>
    </div>`;

  openModal('イベント編集', content);
}

export async function saveEventEdit(eventId) {
  const date = document.getElementById('edit-event-date').value;
  const selection = document.getElementById('edit-event-classroom').value;
  const note = document.getElementById('edit-event-note').value.trim();

  if (!date || !selection) {
    showToast('日付と教室は必須です', 'error');
    return;
  }

  let classroomId;
  let attendanceGroup = '';

  if (selection.startsWith('group:')) {
    attendanceGroup = selection.replace('group:', '');
    const groupClassrooms = classrooms.filter(c => c.attendance_group === attendanceGroup);
    if (groupClassrooms.length === 0) {
      showToast('グループに教室が見つかりません', 'error');
      return;
    }
    classroomId = groupClassrooms[0].id;
  } else {
    classroomId = selection;
  }

  const { error } = await supabase
    .from('attendance_events')
    .update({ date, classroom_id: classroomId, attendance_group: attendanceGroup, note })
    .eq('id', eventId);

  if (error) {
    console.error('イベント更新エラー:', error);
    showToast('更新に失敗しました', 'error');
    return;
  }

  showToast('イベントを更新しました', 'success');
  closeModal();
  await renderAttendanceList();
}

// ============================================
// イベント削除
// ============================================
export function confirmDeleteEvent(eventId) {
  const ev = allEvents.find(e => e.id === eventId);
  if (!ev) return;

  const dateLabel = formatDateShort(ev.date);
  const content = `
    <p>${dateLabel} ${escapeHtml(ev.displayLabel || ev.classroomName)} のイベントを削除しますか？</p>
    <p style="color:var(--danger-color);font-size:13px">出欠記録もすべて削除されます。</p>
    <div class="modal-actions" style="margin-top:16px">
      <button class="btn btn-danger" onclick="window.memberApp.deleteEvent('${eventId}')">削除</button>
      <button class="btn btn-secondary" onclick="window.memberApp.closeModal()">キャンセル</button>
    </div>`;

  openModal('イベント削除の確認', content);
}

export async function deleteEvent(eventId) {
  const { error } = await supabase
    .from('attendance_events')
    .delete()
    .eq('id', eventId);

  if (error) {
    console.error('イベント削除エラー:', error);
    showToast('削除に失敗しました', 'error');
    return;
  }

  showToast('イベントを削除しました', 'success');
  closeModal();
  await renderAttendanceList();
}

// ============================================
// ヘルパー
// ============================================
function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const w = weekdays[d.getDay()];
  return `${m}/${day}(${w})`;
}

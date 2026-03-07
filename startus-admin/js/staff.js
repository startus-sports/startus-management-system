import { supabase } from './supabase.js';
import { escapeHtml, formatDate } from './utils.js';
import { showToast, openModal, closeModal } from './app.js';
import { isAdmin } from './auth.js';
import { getActiveClassrooms } from './classroom.js';

let allStaff = [];
let filteredStaff = [];

// フィルタ・検索の状態
let searchQuery = '';
let filters = {
  role: [],
  status: ['在籍'],
  classes: []
};
let staffSortKey = 'name';

// --- データ取得 ---

export async function loadStaff() {
  const { data, error } = await supabase
    .from('staff')
    .select('*')
    .order('name');

  if (error) {
    console.error('スタッフデータ読み込みエラー:', error);
    allStaff = [];
  } else {
    allStaff = data || [];
  }
  applyFiltersAndRender();
}

// --- 外部参照用 getter ---

export function getJimukyokuStaff() {
  return allStaff.filter(s => s.role === '事務局' && s.status === '在籍');
}

export function getAllActiveStaff() {
  return allStaff.filter(s => s.status === '在籍');
}

export function getStaffById(id) {
  return allStaff.find(s => s.id === id) || null;
}

export function getStaffByEmail(email) {
  return allStaff.find(s => s.email === email) || null;
}

// --- フィルタ・検索・ソート ---

function applyFiltersAndRender() {
  let result = [...allStaff];

  // 検索フィルタ
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    result = result.filter(s =>
      (s.name || '').toLowerCase().includes(q) ||
      (s.furigana || '').toLowerCase().includes(q) ||
      (s.email || '').toLowerCase().includes(q) ||
      (s.phone || '').includes(q)
    );
  }

  // 役職フィルタ
  if (filters.role.length > 0) {
    result = result.filter(s => filters.role.includes(s.role));
  }

  // ステータスフィルタ
  if (filters.status.length > 0) {
    result = result.filter(s => filters.status.includes(s.status));
  }

  // 教室フィルタ
  if (filters.classes.length > 0) {
    result = result.filter(s => {
      const staffClasses = s.classes || [];
      return filters.classes.some(c => staffClasses.includes(c));
    });
  }

  // ソート
  const ROLE_ORDER = { '事務局': 0, '指導者': 1, 'スタッフ': 2 };
  result.sort((a, b) => {
    switch (staffSortKey) {
      case 'role': return (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || (a.name || '').localeCompare(b.name || '', 'ja');
      case 'name':
      default: return (a.name || '').localeCompare(b.name || '', 'ja');
    }
  });

  filteredStaff = result;
  updateStaffFilterBadge();
  renderStaffList();
  updateStaffClassFilter();
}

function updateStaffFilterBadge() {
  const defaultStatus = filters.status.length === 1 && filters.status[0] === '在籍';
  const count = filters.role.length + (defaultStatus ? 0 : filters.status.length) + filters.classes.length;
  const btn = document.getElementById('staff-filter-toggle');
  if (!btn) return;
  const existing = btn.querySelector('.filter-badge');
  if (existing) existing.remove();
  btn.classList.toggle('has-filters', count > 0);
  if (count > 0) {
    btn.insertAdjacentHTML('beforeend', `<span class="filter-badge">${count}</span>`);
  }
}

export function resetStaffFilters() {
  filters = { role: [], status: ['在籍'], classes: [] };
  searchQuery = '';
  // UIリセット
  document.querySelectorAll('#staff-filter-panel input[type="checkbox"]').forEach(cb => {
    cb.checked = cb.value === '在籍';
  });
  const searchInput = document.getElementById('staff-search-input');
  if (searchInput) searchInput.value = '';
  applyFiltersAndRender();
}

export function initStaffSort() {
  const sel = document.getElementById('staff-sort-select');
  if (sel) {
    sel.value = staffSortKey;
    sel.addEventListener('change', () => {
      staffSortKey = sel.value;
      applyFiltersAndRender();
    });
  }
}

// --- 表示 ---

const STAFF_GRID_HEADER = `
  <div class="staff-grid-header">
    <span>氏名</span>
    <span>役割</span>
    <span>教室</span>
    <span>ステータス</span>
    <span>連絡先</span>
    <span></span>
  </div>`;

function buildStaffGridRow(s) {
  const roleClass = getRoleClass(s.role);
  const adminBadge = s.is_admin ? '<span class="badge badge-admin">管理者</span>' : '';
  const roleBadge = `<span class="badge badge-type badge-type-${roleClass}">${escapeHtml(s.role)}</span>${adminBadge}`;
  const statusBadge = s.status !== '在籍'
    ? `<span class="badge badge-status badge-status-withdrawn">${escapeHtml(s.status)}</span>`
    : `<span class="badge badge-status badge-status-active">${escapeHtml(s.status)}</span>`;
  const classBadges = (s.classes || []).map(c =>
    `<span class="badge badge-class">${escapeHtml(c)}</span>`
  ).join('');

  return `
    <div class="list-item" data-id="${s.id}" onclick="window.memberApp.showStaffDetail('${s.id}')">
      <div class="grid-cell grid-cell-name">
        <strong>${escapeHtml(s.name)}</strong>
      </div>
      <div class="grid-cell">${roleBadge}</div>
      <div class="grid-cell grid-cell-badges">${classBadges}</div>
      <div class="grid-cell">${statusBadge}</div>
      <div class="grid-cell grid-cell-contact">
        ${s.phone ? `<span>${escapeHtml(s.phone)}</span>` : ''}
        ${s.email ? `<span>${escapeHtml(s.email)}</span>` : ''}
      </div>
      <div class="grid-cell grid-cell-arrow">
        <span class="material-icons list-item-arrow">chevron_right</span>
      </div>
    </div>`;
}

function renderStaffList() {
  const container = document.getElementById('staff-list');
  const countEl = document.getElementById('staff-count');
  if (countEl) {
    const total = allStaff.length;
    const shown = filteredStaff.length;
    countEl.textContent = total === shown ? `${shown}名` : `${total}名中 ${shown}名表示`;
  }

  if (!container) return;

  if (filteredStaff.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="material-icons empty-icon">badge</span>
        <p>スタッフデータがありません</p>
      </div>`;
    return;
  }

  container.innerHTML = STAFF_GRID_HEADER + filteredStaff.map(buildStaffGridRow).join('');
}

function getRoleClass(role) {
  switch (role) {
    case '指導者': return 'instructor';
    case '事務局': return 'jimukyoku';
    case 'スタッフ': return 'staff';
    default: return 'staff';
  }
}

// --- 教室フィルタ動的生成 ---

function updateStaffClassFilter() {
  const container = document.getElementById('staff-class-filter');
  if (!container) return;

  const classroomSet = new Set();
  allStaff.forEach(s => {
    (s.classes || []).forEach(c => classroomSet.add(c));
  });

  const classNames = [...classroomSet].sort((a, b) => a.localeCompare(b, 'ja'));
  container.innerHTML = classNames.map(c => {
    const checked = filters.classes.includes(c) ? 'checked' : '';
    return `<label class="filter-pill"><input type="checkbox" value="${escapeHtml(c)}" ${checked}>${escapeHtml(c)}</label>`;
  }).join('');

  container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const checked = [...container.querySelectorAll('input:checked')].map(el => el.value);
      filters.classes = checked;
      applyFiltersAndRender();
    });
  });
}

// --- 詳細モーダル ---

export function showStaffDetail(id) {
  const s = allStaff.find(st => st.id === id);
  if (!s) return;

  const classesDisplay = (s.classes || []).map(c =>
    `<span class="badge badge-class">${escapeHtml(c)}</span>`
  ).join(' ') || '-';

  const photoHtml = s.photo_url
    ? `<img class="detail-photo" src="${escapeHtml(s.photo_url)}" alt="${escapeHtml(s.name)}">`
    : `<span class="detail-photo-default material-icons">account_circle</span>`;

  const phoneCopy = s.phone
    ? `<button class="btn-icon btn-copy" onclick="event.stopPropagation();window.memberApp.copyToClipboard('${escapeHtml(s.phone)}')" title="コピー"><span class="material-icons" style="font-size:16px">content_copy</span></button>`
    : '';
  const emailCopy = s.email
    ? `<button class="btn-icon btn-copy" onclick="event.stopPropagation();window.memberApp.copyToClipboard('${escapeHtml(s.email)}')" title="コピー"><span class="material-icons" style="font-size:16px">content_copy</span></button>`
    : '';

  const content = `
    ${photoHtml}
    <div class="detail-grid">
      <div class="detail-row"><span class="detail-label">氏名</span><span class="detail-value">${escapeHtml(s.name)}</span></div>
      <div class="detail-row"><span class="detail-label">フリガナ</span><span class="detail-value">${escapeHtml(s.furigana) || '-'}</span></div>
      <div class="detail-row"><span class="detail-label">役職</span><span class="detail-value">${escapeHtml(s.role)}</span></div>
      <div class="detail-row"><span class="detail-label">管理者権限</span><span class="detail-value">${s.is_admin ? '<span class="badge badge-admin">管理者</span>' : 'なし'}</span></div>
      <div class="detail-row"><span class="detail-label">ステータス</span><span class="detail-value">${escapeHtml(s.status)}</span></div>
      <div class="detail-row"><span class="detail-label">電話番号</span><span class="detail-value">${escapeHtml(s.phone) || '-'}${phoneCopy}</span></div>
      <div class="detail-row"><span class="detail-label">メール</span><span class="detail-value">${escapeHtml(s.email) || '-'}${emailCopy}</span></div>
      <div class="detail-row"><span class="detail-label">担当教室</span><span class="detail-value">${classesDisplay}</span></div>
      <div class="detail-row"><span class="detail-label">登録日</span><span class="detail-value">${formatDate(s.joined_date) || '-'}</span></div>
      <div class="detail-row"><span class="detail-label">メモ</span><span class="detail-value">${escapeHtml(s.note) || '-'}</span></div>
    </div>
    ${isAdmin() ? `<div class="modal-detail-actions">
      <button class="btn btn-primary" onclick="window.memberApp.openStaffEditForm('${s.id}')">
        <span class="material-icons">edit</span>編集
      </button>
      <button class="btn btn-danger" onclick="window.memberApp.confirmDeleteStaff('${s.id}', '${escapeHtml(s.name)}')">
        <span class="material-icons">delete</span>削除
      </button>
    </div>` : ''}`;

  openModal('スタッフ詳細', content);
}

// --- 追加/編集フォーム ---

export function openStaffAddForm() {
  openStaffForm(null);
}

export function openStaffEditForm(id) {
  const s = allStaff.find(st => st.id === id);
  if (!s) return;
  closeModal();
  setTimeout(() => openStaffForm(s), 200);
}

function openStaffForm(staff) {
  const isEdit = !!staff;
  const title = isEdit ? 'スタッフ編集' : 'スタッフ追加';
  const s = staff || {};

  const classroomCheckboxes = getActiveClassrooms().map(c => {
    const checked = (s.classes || []).includes(c.name) ? 'checked' : '';
    return `<label class="filter-pill"><input type="checkbox" name="staff_classroom_cb" value="${escapeHtml(c.name)}" ${checked}>${escapeHtml(c.name)}</label>`;
  }).join('');

  const content = `
    <form id="staff-form" onsubmit="return false;">
      <div class="form-group">
        <label>氏名 <span class="required">*</span></label>
        <input type="text" name="name" value="${escapeHtml(s.name || '')}" required>
      </div>
      <div class="form-group">
        <label>フリガナ</label>
        <input type="text" name="furigana" value="${escapeHtml(s.furigana || '')}">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>役職</label>
          <select name="role">
            <option value="スタッフ" ${s.role === 'スタッフ' || !s.role ? 'selected' : ''}>スタッフ</option>
            <option value="指導者" ${s.role === '指導者' ? 'selected' : ''}>指導者</option>
            <option value="事務局" ${s.role === '事務局' ? 'selected' : ''}>事務局</option>
          </select>
        </div>
        <div class="form-group">
          <label>ステータス</label>
          <select name="status">
            <option value="在籍" ${s.status === '在籍' || !s.status ? 'selected' : ''}>在籍</option>
            <option value="退職" ${s.status === '退職' ? 'selected' : ''}>退職</option>
          </select>
        </div>
      </div>
      ${isAdmin() ? `
      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" name="is_admin" ${s.is_admin ? 'checked' : ''}>
          管理者権限を付与する
        </label>
        <p class="form-hint">管理者はスタッフ管理・マスタ設定・会員削除などの操作ができます</p>
      </div>` : ''}
      <div class="form-group">
        <label>電話番号</label>
        <input type="tel" name="phone" value="${escapeHtml(s.phone || '')}">
      </div>
      <div class="form-group">
        <label>メールアドレス</label>
        <input type="email" name="email" value="${escapeHtml(s.email || '')}">
      </div>
      <div class="form-group">
        <label>担当教室</label>
        <div class="classroom-checkboxes-scroll" id="staff-classroom-checkboxes">
          ${classroomCheckboxes}
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>登録日</label>
          <input type="date" name="joined_date" value="${s.joined_date || ''}">
        </div>
        <div class="form-group">
          <label>カレンダー色</label>
          <input type="color" name="calendar_color" value="${s.calendar_color || '#3b82f6'}" style="height:40px;padding:4px">
        </div>
      </div>
      <div class="form-group">
        <label>メモ</label>
        <textarea name="note" rows="3">${escapeHtml(s.note || '')}</textarea>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="window.memberApp.closeModal()">キャンセル</button>
        <button type="submit" class="btn btn-primary">
          <span class="material-icons">save</span>保存
        </button>
      </div>
    </form>`;

  openModal(title, content);

  setTimeout(() => {
    const form = document.getElementById('staff-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        saveStaff(form, isEdit ? s.id : null);
      });
    }
  }, 100);
}

async function saveStaff(form, id) {
  const fd = new FormData(form);
  const classesArray = [...document.querySelectorAll('#staff-classroom-checkboxes input[name="staff_classroom_cb"]:checked')]
    .map(cb => cb.value);

  const data = {
    name: fd.get('name'),
    furigana: fd.get('furigana') || '',
    role: fd.get('role') || 'スタッフ',
    status: fd.get('status') || '在籍',
    phone: fd.get('phone') || '',
    email: fd.get('email') || '',
    classes: classesArray,
    joined_date: fd.get('joined_date') || null,
    note: fd.get('note') || '',
    calendar_color: fd.get('calendar_color') || '',
  };

  // admin権限がある場合のみ is_admin を更新
  if (isAdmin()) {
    data.is_admin = !!fd.get('is_admin');
  }

  let error;
  if (id) {
    ({ error } = await supabase.from('staff').update(data).eq('id', id));
  } else {
    ({ error } = await supabase.from('staff').insert(data));
  }

  if (error) {
    console.error('保存エラー:', error);
    showToast('保存に失敗しました', 'error');
    return;
  }

  closeModal();
  showToast('保存しました', 'success');
  await loadStaff();
}

// --- 削除 ---

export function confirmDeleteStaff(id, name) {
  closeModal();
  setTimeout(() => {
    const content = `
      <p>「${escapeHtml(name)}」を削除しますか？</p>
      <p class="text-warning">この操作は元に戻せません</p>
      <div class="form-actions">
        <button class="btn btn-secondary" onclick="window.memberApp.closeModal()">キャンセル</button>
        <button class="btn btn-danger" onclick="window.memberApp.deleteStaff('${id}')">
          <span class="material-icons">delete</span>削除
        </button>
      </div>`;
    openModal('確認', content);
  }, 200);
}

export async function deleteStaff(id) {
  const { error } = await supabase.from('staff').delete().eq('id', id);
  if (error) {
    console.error('削除エラー:', error);
    showToast('削除に失敗しました', 'error');
    return;
  }
  closeModal();
  showToast('削除しました', 'success');
  await loadStaff();
}

// --- 初期化 ---

export function initStaffSearch() {
  const input = document.getElementById('staff-search-input');
  if (input) {
    input.addEventListener('input', () => {
      searchQuery = input.value;
      applyFiltersAndRender();
    });
  }
}

export function initStaffFilters() {
  // 役職フィルタ
  const roleContainer = document.getElementById('staff-role-filter');
  if (roleContainer) {
    roleContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const checked = [...roleContainer.querySelectorAll('input:checked')].map(el => el.value);
        filters.role = checked;
        applyFiltersAndRender();
      });
    });
  }

  // ステータスフィルタ
  const statusContainer = document.getElementById('staff-status-filter');
  if (statusContainer) {
    statusContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const checked = [...statusContainer.querySelectorAll('input:checked')].map(el => el.value);
        filters.status = checked;
        applyFiltersAndRender();
      });
    });
  }
}

export function toggleStaffFilterPanel() {
  const panel = document.getElementById('staff-filter-panel');
  if (panel) panel.classList.toggle('open');
}

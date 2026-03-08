import { supabase } from './supabase.js';
import { escapeHtml, formatDate } from './utils.js';
import { showToast, openModal, closeModal } from './app.js';
import { getActiveClassrooms, getClassrooms } from './classroom.js';
import { renderFeeSection, initFeeSection, loadAllFees, getCurrentFiscalYear } from './fees.js';
import { logActivity } from './history.js';
import { loadMemberAttendance } from './attendance-view.js';

let allMembers = [];
let filteredMembers = [];

// フィルタ・検索の状態
let searchQuery = '';
let filters = {
  status: ['在籍'],
  member_type: [],
  classes: []
};
let sortKey = localStorage.getItem('memberSort') || 'name';


// --- データ取得 ---

export async function loadMembers() {
  const { data, error } = await supabase
    .from('members')
    .select('*')
    .not('member_type', 'in', '("スタッフ","指導者")')
    .order('name');

  if (error) {
    console.error('会員データ読み込みエラー:', error);
    allMembers = [];
  } else {
    allMembers = data || [];
  }
  applyFiltersAndRender();
}

export function getAllMembers() {
  return allMembers;
}

export function getFilteredMembers() {
  return filteredMembers;
}

// --- フィルタ・検索・ソート ---

export function setSearchQuery(query) {
  searchQuery = query;
  applyFiltersAndRender();
}

export function setFilters(newFilters) {
  filters = { ...filters, ...newFilters };
  applyFiltersAndRender();
}

export function setSortKey(key) {
  sortKey = key;
  localStorage.setItem('memberSort', key);
  applyFiltersAndRender();
}

function applyFiltersAndRender() {
  let result = [...allMembers];

  // 検索フィルタ
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    result = result.filter(m =>
      (m.name || '').toLowerCase().includes(q) ||
      (m.furigana || '').toLowerCase().includes(q) ||
      (m.member_number || '').toLowerCase().includes(q) ||
      (m.email || '').toLowerCase().includes(q)
    );
  }

  // ステータスフィルタ
  if (filters.status.length > 0) {
    result = result.filter(m => filters.status.includes(m.status));
  }

  // 種別フィルタ
  if (filters.member_type.length > 0) {
    result = result.filter(m => filters.member_type.includes(m.member_type));
  }

  // クラスフィルタ
  if (filters.classes.length > 0) {
    result = result.filter(m => {
      const memberClasses = m.classes || [];
      return filters.classes.some(c => memberClasses.includes(c));
    });
  }

  // ソート
  result.sort((a, b) => {
    switch (sortKey) {
      case 'member_number':
        return (a.member_number || '').localeCompare(b.member_number || '', 'ja');
      case 'classes':
        const ac = (a.classes || [])[0] || '';
        const bc = (b.classes || [])[0] || '';
        return ac.localeCompare(bc, 'ja');
      case 'member_type':
        return (a.member_type || '').localeCompare(b.member_type || '', 'ja');
      case 'name':
      default:
        return (a.name || '').localeCompare(b.name || '', 'ja');
    }
  });

  filteredMembers = result;
  updateMemberFilterBadge();
  renderMemberList();
  updateClassFilterOptions();
}

function updateMemberFilterBadge() {
  const defaultStatus = filters.status.length === 1 && filters.status[0] === '在籍';
  const count = (defaultStatus ? 0 : filters.status.length) + filters.member_type.length + filters.classes.length;
  const btn = document.getElementById('member-filter-toggle');
  if (!btn) return;
  const existing = btn.querySelector('.filter-badge');
  if (existing) existing.remove();
  btn.classList.toggle('has-filters', count > 0);
  if (count > 0) {
    btn.insertAdjacentHTML('beforeend', `<span class="filter-badge">${count}</span>`);
  }
}

export function resetMemberFilters() {
  filters = { status: ['在籍'], member_type: [], classes: [] };
  searchQuery = '';
  // UIリセット
  document.querySelectorAll('#filter-panel input[type="checkbox"]').forEach(cb => {
    cb.checked = cb.value === '在籍';
  });
  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = '';
  applyFiltersAndRender();
}

// --- 表示 ---

const MEMBER_GRID_HEADER = `
  <div class="member-grid-header">
    <span>氏名</span>
    <span>教室</span>
    <span>学年</span>
    <span>種別</span>
    <span>ステータス</span>
    <span>会員番号</span>
    <span>連絡先</span>
    <span></span>
  </div>`;

function buildMemberGridRow(m) {
  const typeBadge = `<span class="badge badge-type badge-type-${getTypeClass(m.member_type)}">${escapeHtml(m.member_type)}</span>`;
  const statusBadge = `<span class="badge badge-status badge-status-${getStatusClass(m.status)}">${escapeHtml(m.status)}</span>`;
  const classBadges = (m.classes || []).map(c =>
    `<span class="badge badge-class">${escapeHtml(c)}</span>`
  ).join('');

  return `
    <div class="list-item" data-id="${m.id}" onclick="window.memberApp.showDetail('${m.id}')">
      <div class="grid-cell grid-cell-name">
        <strong>${escapeHtml(m.name)}</strong>
      </div>
      <div class="grid-cell grid-cell-badges">${classBadges}</div>
      <div class="grid-cell" style="font-size:0.82rem">${escapeHtml(m.grade || '')}</div>
      <div class="grid-cell">${typeBadge}</div>
      <div class="grid-cell">${statusBadge}</div>
      <div class="grid-cell" style="font-size:0.82rem;color:var(--gray-500)">${escapeHtml(m.member_number || '')}</div>
      <div class="grid-cell grid-cell-contact">
        ${m.phone ? `<span>${escapeHtml(m.phone)}</span>` : ''}
        ${m.email ? `<span>${escapeHtml(m.email)}</span>` : ''}
      </div>
      <div class="grid-cell grid-cell-arrow">
        <span class="material-icons list-item-arrow">chevron_right</span>
      </div>
    </div>`;
}

function renderMemberList() {
  const container = document.getElementById('member-list');
  const countEl = document.getElementById('member-count');
  if (countEl) {
    const total = allMembers.length;
    const shown = filteredMembers.length;
    countEl.textContent = total === shown ? `${shown}名` : `${total}名中 ${shown}名表示`;
  }

  if (filteredMembers.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="material-icons empty-icon">inbox</span>
        <p>会員データがありません</p>
      </div>`;
    return;
  }

  container.innerHTML = MEMBER_GRID_HEADER + filteredMembers.map(buildMemberGridRow).join('');
}

function getTypeClass(type) {
  switch (type) {
    case '会員': return 'regular';
    case 'スタッフ': return 'staff';
    case '指導者': return 'instructor';
    default: return 'regular';
  }
}

function getStatusClass(status) {
  switch (status) {
    case '在籍': return 'active';
    case '休会': return 'inactive';
    case '退会': return 'withdrawn';
    default: return 'active';
  }
}

function updateClassFilterOptions() {
  const container = document.getElementById('class-filter-options');
  if (!container) return;

  // マスタデータから教室フィルタを生成
  const allClassrooms = getClassrooms();
  const options = allClassrooms.map(c => {
    const checked = filters.classes.includes(c.name) ? 'checked' : '';
    return `<label class="filter-pill"><input type="checkbox" value="${escapeHtml(c.name)}" ${checked}>${escapeHtml(c.name)}</label>`;
  });

  // マスタにない旧データもフォールバック表示
  const masterNames = new Set(allClassrooms.map(c => c.name));
  const orphanClasses = new Set();
  allMembers.forEach(m => {
    (m.classes || []).forEach(c => {
      if (!masterNames.has(c)) orphanClasses.add(c);
    });
  });
  [...orphanClasses].sort((a, b) => a.localeCompare(b, 'ja')).forEach(c => {
    const checked = filters.classes.includes(c) ? 'checked' : '';
    options.push(`<label class="filter-pill"><input type="checkbox" value="${escapeHtml(c)}" ${checked}>${escapeHtml(c)}</label>`);
  });

  container.innerHTML = options.join('');

  container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const checked = [...container.querySelectorAll('input:checked')].map(el => el.value);
      setFilters({ classes: checked });
    });
  });
}

// --- 詳細モーダル ---

export function showDetail(id) {
  const m = allMembers.find(mem => mem.id === id);
  if (!m) return;

  const classesDisplay = (m.classes || []).map(c =>
    `<span class="badge badge-class">${escapeHtml(c)}</span>`
  ).join(' ') || '-';

  const photoHtml = m.photo_url
    ? `<img class="detail-photo" src="${escapeHtml(m.photo_url)}" alt="${escapeHtml(m.name)}">`
    : `<span class="detail-photo-default material-icons">account_circle</span>`;

  const phoneCopy = m.phone
    ? `<button class="btn-icon btn-copy" onclick="event.stopPropagation();window.memberApp.copyToClipboard('${escapeHtml(m.phone)}')" title="コピー"><span class="material-icons" style="font-size:16px">content_copy</span></button>`
    : '';
  const emailCopy = m.email
    ? `<button class="btn-icon btn-copy" onclick="event.stopPropagation();window.memberApp.copyToClipboard('${escapeHtml(m.email)}')" title="コピー"><span class="material-icons" style="font-size:16px">content_copy</span></button>`
    : '';

  const content = `
    ${photoHtml}
    <div class="detail-grid">
      <div class="detail-row"><span class="detail-label">会員番号</span><span class="detail-value">${escapeHtml(m.member_number) || '-'}</span></div>
      <div class="detail-row"><span class="detail-label">氏名</span><span class="detail-value">${escapeHtml(m.name)}</span></div>
      <div class="detail-row"><span class="detail-label">フリガナ</span><span class="detail-value">${escapeHtml(m.furigana) || '-'}</span></div>
      <div class="detail-row"><span class="detail-label">種別</span><span class="detail-value">${escapeHtml(m.member_type)}</span></div>
      <div class="detail-row"><span class="detail-label">ステータス</span><span class="detail-value">${escapeHtml(m.status)}</span></div>
      <div class="detail-row"><span class="detail-label">生年月日</span><span class="detail-value">${formatDate(m.birthdate) || '-'}</span></div>
      <div class="detail-row"><span class="detail-label">学年</span><span class="detail-value">${escapeHtml(m.grade) || '-'}</span></div>
      <div class="detail-row"><span class="detail-label">性別</span><span class="detail-value">${escapeHtml(m.gender) || '-'}</span></div>
      <div class="detail-row"><span class="detail-label">電話番号</span><span class="detail-value">${escapeHtml(m.phone) || '-'}${phoneCopy}</span></div>
      <div class="detail-row"><span class="detail-label">メール</span><span class="detail-value">${escapeHtml(m.email) || '-'}${emailCopy}</span></div>
      <div class="detail-row"><span class="detail-label">住所</span><span class="detail-value">${escapeHtml(m.address) || '-'}</span></div>
      <div class="detail-row"><span class="detail-label">教室</span><span class="detail-value">${classesDisplay}</span></div>
      <div class="detail-row"><span class="detail-label">学校</span><span class="detail-value">${escapeHtml(m.school) || '-'}</span></div>
      <div class="detail-row"><span class="detail-label">保護者名</span><span class="detail-value">${escapeHtml(m.guardian_name) || '-'}</span></div>
      <div class="detail-row"><span class="detail-label">障がい情報</span><span class="detail-value">${escapeHtml(m.disability_info) || '-'}</span></div>
      <div class="detail-row"><span class="detail-label">メモ</span><span class="detail-value">${escapeHtml(m.note) || '-'}</span></div>
    </div>
    ${renderFeeSection(m)}
    <div class="detail-section-header"><span class="material-icons">how_to_reg</span>出欠記録</div>
    <div id="member-attendance-content" class="member-attendance-content">
      <p class="attendance-loading">読み込み中...</p>
    </div>
    <div class="modal-detail-actions">
      <button class="btn btn-primary" onclick="window.memberApp.openEditForm('${m.id}')">
        <span class="material-icons">edit</span>編集
      </button>
      <button class="btn btn-secondary" onclick="window.memberApp.openMemberHistory('${m.id}', '${escapeHtml(m.name)}')">
        <span class="material-icons">history</span>履歴
      </button>
      <button class="btn btn-danger" onclick="window.memberApp.confirmDelete('${m.id}', '${escapeHtml(m.name)}')">
        <span class="material-icons">delete</span>削除
      </button>
    </div>`;

  openModal('会員詳細', content);
  setTimeout(() => initFeeSection(m.id), 100);

  // 出欠履歴を非同期で読み込み
  loadMemberAttendance(m.id).then(html => {
    const el = document.getElementById('member-attendance-content');
    if (el) el.innerHTML = html;
  });
}

// --- 追加/編集フォーム ---

export function openAddForm() {
  openMemberForm(null);
}

export function openEditForm(id) {
  const m = allMembers.find(mem => mem.id === id);
  if (!m) return;
  closeModal();
  setTimeout(() => openMemberForm(m), 200);
}

function openMemberForm(member) {
  const isEdit = !!member;
  const title = isEdit ? '会員編集' : '会員追加';
  const m = member || {};

  const classroomCheckboxes = getActiveClassrooms().map(c => {
    const checked = (m.classes || []).includes(c.name) ? 'checked' : '';
    return `<label class="filter-pill"><input type="checkbox" name="classroom_cb" value="${escapeHtml(c.name)}" ${checked}>${escapeHtml(c.name)}</label>`;
  }).join('');

  const photoSection = isEdit ? `
    <div class="photo-upload-area">
      ${m.photo_url
        ? `<img class="photo-upload-preview" src="${escapeHtml(m.photo_url)}" alt="">`
        : `<div class="photo-upload-preview-default"><span class="material-icons">person</span></div>`}
      <div>
        <button type="button" class="fee-edit-btn" onclick="window.memberApp.openPhotoUpload('${m.id}')">
          <span class="material-icons" style="font-size:16px">photo_camera</span>写真変更
        </button>
        ${m.photo_url ? `<button type="button" class="fee-edit-btn" style="margin-left:6px;color:var(--danger-color);border-color:var(--danger-color)" onclick="window.memberApp.removePhoto('${m.id}')">
          <span class="material-icons" style="font-size:16px">delete</span>削除
        </button>` : ''}
      </div>
    </div>` : '';

  const content = `
    <form id="member-form" onsubmit="return false;">
      ${photoSection}
      <div class="form-row">
        <div class="form-group">
          <label>会員番号</label>
          <input type="text" name="member_number" value="${escapeHtml(m.member_number || '')}">
        </div>
        <div class="form-group">
          <label>種別</label>
          <select name="member_type">
            <option value="会員" ${m.member_type === '会員' ? 'selected' : ''}>会員</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>氏名 <span class="required">*</span></label>
        <input type="text" name="name" value="${escapeHtml(m.name || '')}" required>
      </div>
      <div class="form-group">
        <label>フリガナ</label>
        <input type="text" name="furigana" value="${escapeHtml(m.furigana || '')}">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>ステータス</label>
          <select name="status">
            <option value="在籍" ${m.status === '在籍' || !m.status ? 'selected' : ''}>在籍</option>
            <option value="休会" ${m.status === '休会' ? 'selected' : ''}>休会</option>
            <option value="退会" ${m.status === '退会' ? 'selected' : ''}>退会</option>
          </select>
        </div>
        <div class="form-group">
          <label>性別</label>
          <select name="gender">
            <option value="" ${!m.gender ? 'selected' : ''}>--</option>
            <option value="男" ${m.gender === '男' ? 'selected' : ''}>男</option>
            <option value="女" ${m.gender === '女' ? 'selected' : ''}>女</option>
            <option value="その他" ${m.gender === 'その他' ? 'selected' : ''}>その他</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>生年月日</label>
          <input type="date" name="birthdate" value="${m.birthdate || ''}">
        </div>
        <div class="form-group">
          <label>学年</label>
          <input type="text" name="grade" value="${escapeHtml(m.grade || '')}" placeholder="例: 小3">
        </div>
      </div>
      <div class="form-group">
        <label>電話番号</label>
        <input type="tel" name="phone" value="${escapeHtml(m.phone || '')}">
      </div>
      <div class="form-group">
        <label>メールアドレス</label>
        <input type="email" name="email" value="${escapeHtml(m.email || '')}">
      </div>
      <div class="form-group">
        <label>住所</label>
        <input type="text" name="address" value="${escapeHtml(m.address || '')}">
      </div>
      <div class="form-group">
        <label>教室</label>
        <div class="classroom-checkboxes-scroll" id="classroom-checkboxes">
          ${classroomCheckboxes}
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>学校</label>
          <input type="text" name="school" value="${escapeHtml(m.school || '')}">
        </div>
        <div class="form-group">
          <label>保護者名</label>
          <input type="text" name="guardian_name" value="${escapeHtml(m.guardian_name || '')}">
        </div>
      </div>
      <div class="form-group">
        <label>障がい情報</label>
        <textarea name="disability_info" rows="2">${escapeHtml(m.disability_info || '')}</textarea>
      </div>
      <div class="form-group">
        <label>メモ</label>
        <textarea name="note" rows="2">${escapeHtml(m.note || '')}</textarea>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="window.memberApp.closeModal()">キャンセル</button>
        <button type="submit" class="btn btn-primary" id="save-member-btn">
          <span class="material-icons">save</span>保存
        </button>
      </div>
    </form>`;

  openModal(title, content);

  setTimeout(() => {
    const form = document.getElementById('member-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        saveMember(form, isEdit ? m.id : null);
      });
    }
  }, 100);
}

async function saveMember(form, id) {
  const fd = new FormData(form);
  const classesArray = [...document.querySelectorAll('#classroom-checkboxes input[name="classroom_cb"]:checked')]
    .map(cb => cb.value);

  const data = {
    member_number: fd.get('member_number') || '',
    name: fd.get('name'),
    furigana: fd.get('furigana') || '',
    member_type: fd.get('member_type') || '会員',
    status: fd.get('status') || '在籍',
    birthdate: fd.get('birthdate') || null,
    gender: fd.get('gender') || '',
    address: fd.get('address') || '',
    phone: fd.get('phone') || '',
    email: fd.get('email') || '',
    classes: classesArray,
    grade: fd.get('grade') || '',
    disability_info: fd.get('disability_info') || '',
    note: fd.get('note') || '',
    guardian_name: fd.get('guardian_name') || '',
    school: fd.get('school') || '',
  };

  // 変更履歴用に旧データを取得
  const oldMember = id ? allMembers.find(m => m.id === id) : null;

  let error;
  if (id) {
    ({ error } = await supabase.from('members').update(data).eq('id', id));
  } else {
    ({ error } = await supabase.from('members').insert(data));
  }

  if (error) {
    console.error('保存エラー:', error);
    showToast('保存に失敗しました', 'error');
    return;
  }

  // 変更履歴を記録
  if (id && oldMember) {
    for (const key of Object.keys(data)) {
      const oldVal = key === 'classes' ? (oldMember.classes || []).join(', ') : (oldMember[key] ?? '');
      const newVal = key === 'classes' ? classesArray.join(', ') : (data[key] ?? '');
      if (String(oldVal) !== String(newVal)) {
        logActivity(id, 'update', key, oldVal, newVal);
      }
    }
  } else if (!id) {
    // 新規作成の場合、loadMembers後に最新のIDを取得するのは困難なのでスキップ
    // 代わりに名前でログ
    logActivity(null, 'create', 'name', '', data.name);
  }

  closeModal();
  showToast('保存しました', 'success');
  await loadMembers();
}

// --- 削除 ---

export function confirmDelete(id, name) {
  closeModal();
  setTimeout(() => {
    const content = `
      <p>「${escapeHtml(name)}」を削除しますか？</p>
      <p class="text-warning">この操作は元に戻せません</p>
      <div class="form-actions">
        <button class="btn btn-secondary" onclick="window.memberApp.closeModal()">キャンセル</button>
        <button class="btn btn-danger" onclick="window.memberApp.deleteMember('${id}')">
          <span class="material-icons">delete</span>削除
        </button>
      </div>`;
    openModal('確認', content);
  }, 200);
}

export async function deleteMember(id) {
  const m = allMembers.find(mem => mem.id === id);
  const { error } = await supabase.from('members').delete().eq('id', id);
  if (error) {
    console.error('削除エラー:', error);
    showToast('削除に失敗しました', 'error');
    return;
  }
  if (m) logActivity(id, 'delete', 'name', m.name, '');
  closeModal();
  showToast('削除しました', 'success');
  await loadMembers();
}

// --- 写真 ---

export async function openPhotoUpload(memberId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showToast('ファイルサイズは2MB以下にしてください', 'error');
      return;
    }
    const ext = file.name.split('.').pop().toLowerCase();
    const path = `members/${memberId}/${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('member-photos')
      .upload(path, file, { upsert: true });

    if (uploadError) {
      console.error('写真アップロードエラー:', uploadError);
      showToast('写真のアップロードに失敗しました', 'error');
      return;
    }

    const { data: urlData } = supabase.storage
      .from('member-photos')
      .getPublicUrl(path);

    const photoUrl = urlData.publicUrl;
    const { error: updateError } = await supabase
      .from('members')
      .update({ photo_url: photoUrl })
      .eq('id', memberId);

    if (updateError) {
      console.error('写真URL更新エラー:', updateError);
      showToast('写真の保存に失敗しました', 'error');
      return;
    }

    logActivity(memberId, 'update', 'photo_url', '', photoUrl);
    showToast('写真を更新しました', 'success');
    closeModal();
    await loadMembers();
    setTimeout(() => showDetail(memberId), 300);
  };
  input.click();
}

export async function removePhoto(memberId) {
  const m = allMembers.find(mem => mem.id === memberId);
  if (!m || !m.photo_url) return;

  const { error } = await supabase
    .from('members')
    .update({ photo_url: '' })
    .eq('id', memberId);

  if (error) {
    showToast('写真の削除に失敗しました', 'error');
    return;
  }

  logActivity(memberId, 'update', 'photo_url', m.photo_url, '');
  showToast('写真を削除しました', 'success');
  closeModal();
  await loadMembers();
  setTimeout(() => showDetail(memberId), 300);
}

// --- 初期化ヘルパー ---

export function initSortSelect() {
  const sel = document.getElementById('sort-select');
  if (sel) {
    sel.value = sortKey;
    sel.addEventListener('change', () => setSortKey(sel.value));
  }
}

export function initSearchInput() {
  const input = document.getElementById('search-input');
  if (input) {
    input.addEventListener('input', () => setSearchQuery(input.value));
  }
}

export function initStatusFilter() {
  const container = document.getElementById('status-filter-options');
  if (!container) return;
  container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const checked = [...container.querySelectorAll('input:checked')].map(el => el.value);
      setFilters({ status: checked });
    });
  });
}

export function initTypeFilter() {
  const container = document.getElementById('type-filter-options');
  if (!container) return;
  container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const checked = [...container.querySelectorAll('input:checked')].map(el => el.value);
      setFilters({ member_type: checked });
    });
  });
}

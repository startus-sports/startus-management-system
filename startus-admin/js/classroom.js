import { supabase } from './supabase.js';
import { escapeHtml } from './utils.js';
import { showToast, openModal, closeModal, setModalWide } from './app.js';

// --- キャッシュ ---
let classroomCache = [];
let filteredClassrooms = [];

// --- フィルター状態 ---
let classroomFilters = {
  category: [],
  day: [],
  status: ['active'],
  query: '',
};
let classroomSortKey = 'display_order';

// --- 定数 ---
const DAYS_OF_WEEK = ['月', '火', '水', '木', '金', '土', '日'];
const CATEGORIES = ['陸上・マラソン', 'バレエ・ダンス・チア', 'サッカー・フットボール', 'バドミントン', 'テニス', 'キンボールスポーツ', 'その他'];

const DAY_COLORS = {
  '月': '#6b7280', '火': '#ef4444', '水': '#3b82f6',
  '木': '#22c55e', '金': '#f59e0b', '土': '#6366f1', '日': '#ef4444'
};

const CATEGORY_STYLES = {
  '陸上・マラソン':       { bg: '#fef2f2', color: '#dc2626' },
  'バレエ・ダンス・チア':  { bg: '#fdf4ff', color: '#a855f7' },
  'サッカー・フットボール': { bg: '#f0fdf4', color: '#16a34a' },
  'バドミントン':         { bg: '#ecfdf5', color: '#059669' },
  'テニス':              { bg: '#fffbeb', color: '#d97706' },
  'キンボールスポーツ':    { bg: '#fef3c7', color: '#b45309' },
  'その他':              { bg: '#f0f9ff', color: '#0284c7' },
};

// --- データ取得 ---

export async function loadClassrooms() {
  const { data, error } = await supabase
    .from('classrooms')
    .select('*')
    .order('display_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    console.error('教室マスタ読み込みエラー:', error);
    classroomCache = [];
  } else {
    classroomCache = data || [];
  }
  return classroomCache;
}

export function getClassrooms() {
  return classroomCache;
}

export function getActiveClassrooms() {
  return classroomCache.filter(c => c.is_active);
}

/** calendar_tag から教室のサブクラス配列を返す */
export function getSubClassesForTag(tag) {
  if (!tag) return [];
  const c = classroomCache.find(cr => cr.calendar_tag === tag);
  return (c && c.sub_classes) ? c.sub_classes : [];
}

// --- ヘルパー ---

function dayBadgesHtml(days) {
  if (!days || !days.length) return '';
  return days.map(d =>
    `<span class="cr-day" style="background:${DAY_COLORS[d] || '#6b7280'}">${d}</span>`
  ).join('');
}

function categoryHtml(cat) {
  if (!cat) return '';
  const s = CATEGORY_STYLES[cat] || { bg: '#f8fafc', color: '#64748b' };
  return `<span class="cr-cat-badge" style="background:${s.bg};color:${s.color}">${escapeHtml(cat)}</span>`;
}

function feeHtml(fee, fee2) {
  if (fee == null && fee2 == null) return '';
  const parts = [];
  if (fee != null) parts.push(`¥${fee.toLocaleString()}`);
  if (fee2 != null) parts.push(`¥${fee2.toLocaleString()}`);
  return `<span class="cr-fee-val">${parts.join(' / ')}</span>`;
}

function cellText(val) {
  return val ? escapeHtml(val) : '';
}

// --- 教室マスタ画面レンダリング ---

export async function renderClassroomScreen() {
  await loadClassrooms();
  applyClassroomFilters();
  renderClassroomView();
}

function applyClassroomFilters() {
  let result = [...classroomCache];

  // 検索
  if (classroomFilters.query) {
    const q = classroomFilters.query.toLowerCase();
    result = result.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.main_coach || '').toLowerCase().includes(q)
    );
  }

  // カテゴリフィルタ
  if (classroomFilters.category.length > 0) {
    result = result.filter(c => classroomFilters.category.includes(c.category));
  }

  // 曜日フィルタ
  if (classroomFilters.day.length > 0) {
    result = result.filter(c => {
      const days = c.day_of_week || [];
      return classroomFilters.day.some(d => days.includes(d));
    });
  }

  // 状態フィルタ
  if (classroomFilters.status.length > 0) {
    result = result.filter(c => {
      if (classroomFilters.status.includes('active') && c.is_active) return true;
      if (classroomFilters.status.includes('inactive') && !c.is_active) return true;
      return false;
    });
  }

  // ソート
  result.sort((a, b) => {
    switch (classroomSortKey) {
      case 'name': return (a.name || '').localeCompare(b.name || '', 'ja');
      case 'category': return (a.category || '').localeCompare(b.category || '', 'ja') || (a.display_order || 0) - (b.display_order || 0);
      case 'display_order':
      default: return (a.display_order || 0) - (b.display_order || 0);
    }
  });

  filteredClassrooms = result;
  updateClassroomFilterBadge();
}

function updateClassroomFilterBadge() {
  const defaultStatus = classroomFilters.status.length === 1 && classroomFilters.status[0] === 'active';
  const count = classroomFilters.category.length + classroomFilters.day.length + (defaultStatus ? 0 : classroomFilters.status.length);
  const btn = document.getElementById('classroom-filter-toggle');
  if (!btn) return;
  const existing = btn.querySelector('.filter-badge');
  if (existing) existing.remove();
  btn.classList.toggle('has-filters', count > 0);
  if (count > 0) {
    btn.insertAdjacentHTML('beforeend', `<span class="filter-badge">${count}</span>`);
  }
}

export function toggleClassroomFilterPanel() {
  const panel = document.getElementById('classroom-filter-panel');
  if (panel) panel.classList.toggle('open');
}

export function resetClassroomFilters() {
  classroomFilters = { category: [], day: [], status: ['active'], query: '' };
  document.querySelectorAll('#classroom-filter-panel input[type="checkbox"]').forEach(cb => {
    cb.checked = cb.value === 'active';
  });
  const searchInput = document.getElementById('classroom-search-input');
  if (searchInput) searchInput.value = '';
  applyClassroomFilters();
  renderClassroomView();
}

export function initClassroomFilters() {
  // 検索
  const searchInput = document.getElementById('classroom-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      classroomFilters.query = searchInput.value.trim();
      applyClassroomFilters();
      renderClassroomView();
    });
  }

  // ソート
  const sortSel = document.getElementById('classroom-sort-select');
  if (sortSel) {
    sortSel.value = classroomSortKey;
    sortSel.addEventListener('change', () => {
      classroomSortKey = sortSel.value;
      applyClassroomFilters();
      renderClassroomView();
    });
  }

  // カテゴリフィルタ動的生成
  const catContainer = document.getElementById('classroom-category-filter');
  if (catContainer) {
    catContainer.innerHTML = CATEGORIES.map(cat =>
      `<label class="filter-pill"><input type="checkbox" value="${escapeHtml(cat)}">${escapeHtml(cat)}</label>`
    ).join('');
    catContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        classroomFilters.category = Array.from(catContainer.querySelectorAll('input:checked')).map(c => c.value);
        applyClassroomFilters();
        renderClassroomView();
      });
    });
  }

  // 曜日フィルタ
  const dayContainer = document.getElementById('classroom-day-filter');
  if (dayContainer) {
    dayContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        classroomFilters.day = Array.from(dayContainer.querySelectorAll('input:checked')).map(c => c.value);
        applyClassroomFilters();
        renderClassroomView();
      });
    });
  }

  // 状態フィルタ
  const statusContainer = document.getElementById('classroom-status-filter');
  if (statusContainer) {
    statusContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        classroomFilters.status = Array.from(statusContainer.querySelectorAll('input:checked')).map(c => c.value);
        applyClassroomFilters();
        renderClassroomView();
      });
    });
  }
}

function renderClassroomView() {
  const wrap = document.getElementById('classroom-table-wrap');
  if (!wrap) return;

  const classrooms = filteredClassrooms;

  if (classrooms.length === 0) {
    wrap.innerHTML = `
      <div class="empty-state">
        <span class="material-icons empty-icon">meeting_room</span>
        <p>教室が登録されていません</p>
      </div>`;
    // 件数表示を更新（0件でも表示）
    const countEl = document.getElementById('classroom-count');
    if (countEl) {
      const total = classroomCache.length;
      countEl.textContent = total === 0 ? '0教室' : `${total}教室中 0教室表示`;
    }
    return;
  }

  // 件数表示を更新
  const countEl = document.getElementById('classroom-count');
  if (countEl) {
    const total = classroomCache.length;
    const shown = classrooms.length;
    countEl.textContent = total === shown ? `${shown}教室` : `${total}教室中 ${shown}教室表示`;
  }

  const GRID_HEADER = `
    <div class="cr-grid-header">
      <span>#</span>
      <span>教室名</span>
      <span>カテゴリ</span>
      <span>曜日</span>
      <span>時間</span>
      <span>対象</span>
      <span>会場</span>
      <span>コーチ</span>
      <span>定員</span>
      <span>月謝</span>
      <span>状態</span>
      <span></span>
    </div>`;

  const rows = classrooms.map(c => {
    const statusBadge = c.is_active
      ? '<span class="cr-status-on">有効</span>'
      : '<span class="cr-status-off">無効</span>';
    const inactiveClass = c.is_active ? '' : ' cr-row-inactive';
    const capacityText = c.capacity != null ? c.capacity + '名' : '';

    return `
      <div class="list-item cr-row${inactiveClass}" data-id="${c.id}">
        <div class="grid-cell cr-td-order">${c.display_order}</div>
        <div class="grid-cell grid-cell-name"><strong>${escapeHtml(c.name)}</strong></div>
        <div class="grid-cell">${categoryHtml(c.category)}</div>
        <div class="grid-cell grid-cell-badges">${dayBadgesHtml(c.day_of_week)}</div>
        <div class="grid-cell cr-td-time">${cellText(c.time_slot)}</div>
        <div class="grid-cell cr-td-target">${cellText(c.target)}</div>
        <div class="grid-cell cr-td-venue">${cellText(c.venue)}</div>
        <div class="grid-cell cr-td-coach">${cellText(c.main_coach)}</div>
        <div class="grid-cell cr-td-capacity">${capacityText}</div>
        <div class="grid-cell cr-td-fee">${feeHtml(c.fee, c.fee2)}</div>
        <div class="grid-cell cr-td-status">${statusBadge}</div>
        <div class="grid-cell grid-cell-arrow"><span class="material-icons list-item-arrow">chevron_right</span></div>
      </div>`;
  }).join('');

  wrap.innerHTML = GRID_HEADER + rows;

  // 行クリックで編集モーダルを開く
  wrap.querySelectorAll('.cr-row').forEach(row => {
    row.addEventListener('click', () => {
      const id = row.dataset.id;
      if (id) openClassroomEditForm(id);
    });
  });
}

// --- 追加 / 編集フォーム ---

export function openClassroomAddForm() {
  openClassroomForm(null);
}

export function openClassroomEditForm(id) {
  const c = classroomCache.find(cr => cr.id === id);
  if (!c) return;
  openClassroomForm(c);
}

function parseTimeSlot(timeSlot) {
  if (!timeSlot) return { start: '', end: '' };
  const parts = timeSlot.split(/[〜~\-ー]/);
  const start = (parts[0] || '').trim();
  const end = (parts[1] || '').trim();
  return { start, end };
}

function openClassroomForm(classroom) {
  const isEdit = !!classroom;
  const c = classroom || {};
  const title = isEdit ? '教室編集' : '教室追加';
  const days = c.day_of_week || [];
  const time = parseTimeSlot(c.time_slot);

  const categoryOptions = CATEGORIES.map(cat =>
    `<option value="${escapeHtml(cat)}" ${c.category === cat ? 'selected' : ''}>${escapeHtml(cat)}</option>`
  ).join('');

  const dayCheckboxes = DAYS_OF_WEEK.map(d =>
    `<label class="filter-pill"><input type="checkbox" name="day_of_week" value="${d}" ${days.includes(d) ? 'checked' : ''}>${d}</label>`
  ).join('');

  const content = `
    <form id="classroom-form" onsubmit="return false;">
      <fieldset class="cr-fieldset">
        <legend>基本情報</legend>
        <div class="cr-form-grid">
          <div class="form-group">
            <label>教室名 <span class="required">*</span></label>
            <input type="text" name="name" value="${escapeHtml(c.name || '')}" required placeholder="例: かけっこ塾">
          </div>
          <div class="form-group">
            <label>カテゴリ</label>
            <select name="category">
              <option value="">選択してください</option>
              ${categoryOptions}
            </select>
          </div>
          <div class="form-group">
            <label>曜日</label>
            <div class="filter-checkboxes" style="gap:4px">${dayCheckboxes}</div>
          </div>
          <div class="form-group">
            <label>時間帯</label>
            <div style="display:flex;align-items:center;gap:4px">
              <input type="time" name="time_start" value="${time.start}" class="form-control" style="flex:1">
              <span>〜</span>
              <input type="time" name="time_end" value="${time.end}" class="form-control" style="flex:1">
            </div>
          </div>
          <div class="form-group" style="grid-column:1/-1">
            <label>会場</label>
            <input type="text" name="venue" value="${escapeHtml(c.venue || '')}" placeholder="例: 金沢市総合体育館">
          </div>
        </div>
      </fieldset>

      <fieldset class="cr-fieldset">
        <legend>詳細</legend>
        <div class="cr-form-grid">
          <div class="form-group">
            <label>メインコーチ</label>
            <input type="text" name="main_coach" value="${escapeHtml(c.main_coach || '')}" placeholder="例: 山本 勝裕">
          </div>
          <div class="form-group">
            <label>巡回者</label>
            <input type="text" name="patrol_coach" value="${escapeHtml(c.patrol_coach || '')}" placeholder="例: 松井 久">
          </div>
          <div class="form-group">
            <label>対象</label>
            <input type="text" name="target" value="${escapeHtml(c.target || '')}" placeholder="例: 小学1〜6年生">
          </div>
          <div class="form-group">
            <label>定員</label>
            <input type="number" name="capacity" value="${c.capacity ?? ''}" min="0" placeholder="例: 30">
          </div>
          <div class="form-group">
            <label>月謝1（円）</label>
            <input type="number" name="fee" value="${c.fee ?? ''}" min="0" step="1" placeholder="例: 6600">
          </div>
          <div class="form-group">
            <label>月謝2（円）</label>
            <input type="number" name="fee2" value="${c.fee2 ?? ''}" min="0" step="1" placeholder="例: 3300">
          </div>
        </div>
      </fieldset>

      <fieldset class="cr-fieldset">
        <legend>連携・設定</legend>
        <div class="cr-form-grid">
          <div class="form-group">
            <label>表示順</label>
            <input type="number" name="display_order" value="${c.display_order ?? 0}" min="0">
          </div>
          <div class="form-group">
            <label>クラスコード</label>
            <input type="text" name="class_code" value="${escapeHtml(c.class_code || '')}" placeholder="例: kidsdance">
          </div>
          <div class="form-group">
            <label>カレンダータグ</label>
            <input type="text" name="calendar_tag" value="${escapeHtml(c.calendar_tag || '')}" placeholder="例: kidsdance">
          </div>
          <div class="form-group">
            <label>振替グループ</label>
            <input type="text" name="furikae_group" value="${escapeHtml(c.furikae_group || '')}" placeholder="例: dance">
          </div>
          <div class="form-group">
            <label>出欠グループ</label>
            <input type="text" name="attendance_group" value="${escapeHtml(c.attendance_group || '')}" placeholder="例: 中村マラソン合同">
            <small style="color:var(--gray-500);font-size:11px;margin-top:2px;display:block">
              複数の教室に同じ名前を設定すると、出欠管理で一画面にまとめて表示されます
            </small>
          </div>
          <div class="form-group" style="grid-column:1/-1">
            <label>サブクラス</label>
            <div id="sub-classes-manager" class="sc-manager">
              <div id="sc-list" class="sc-list">
                ${(c.sub_classes || []).map((sc, i) => `
                  <div class="sc-item" data-index="${i}">
                    <span class="material-icons sc-drag">drag_indicator</span>
                    <span class="sc-name">${escapeHtml(sc)}</span>
                    <button type="button" class="sc-btn sc-edit-btn" title="編集"><span class="material-icons">edit</span></button>
                    <button type="button" class="sc-btn sc-del-btn" title="削除"><span class="material-icons">close</span></button>
                  </div>
                `).join('')}
              </div>
              <div class="sc-add-row">
                <input type="text" id="sc-add-input" class="sc-add-input" placeholder="サブクラス名を入力">
                <button type="button" id="sc-add-btn" class="btn btn-secondary sc-add-btn">
                  <span class="material-icons">add</span>追加
                </button>
              </div>
            </div>
            <small style="color:var(--gray-500);font-size:11px;margin-top:2px;display:block">
              上から順に並び順になります。会員編集時に選択肢として表示されます
            </small>
          </div>
        </div>
      </fieldset>

      <div class="form-group">
        <label>備考</label>
        <textarea name="memo" rows="2" placeholder="メモ・備考">${escapeHtml(c.memo || '')}</textarea>
      </div>

      <div class="form-group">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" name="is_active" ${c.is_active !== false ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--primary-color)">
          有効（チェックを外すと会員フォームの選択肢に表示されません）
        </label>
      </div>

      <div class="form-actions">
        ${isEdit ? `<button type="button" class="btn btn-danger-outline cr-btn-form-delete" onclick="window.memberApp.confirmDeleteClassroom('${c.id}', '${escapeHtml(c.name)}')">
          <span class="material-icons">delete</span>削除
        </button>` : ''}
        <div class="form-actions-right">
          <button type="button" class="btn btn-secondary" onclick="window.memberApp.closeModal()">キャンセル</button>
          <button type="submit" class="btn btn-primary">
            <span class="material-icons">save</span>保存
          </button>
        </div>
      </div>
    </form>`;

  openModal(title, content);
  setModalWide(true);

  setTimeout(() => {
    const form = document.getElementById('classroom-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        saveClassroom(form, isEdit ? c.id : null);
      });
    }
    initSubClassManager();
  }, 100);
}

async function saveClassroom(form, id) {
  const fd = new FormData(form);
  const dayCheckboxes = form.querySelectorAll('[name="day_of_week"]:checked');
  const dayOfWeek = Array.from(dayCheckboxes).map(cb => cb.value);

  const data = {
    name: fd.get('name').trim(),
    display_order: parseInt(fd.get('display_order'), 10) || 0,
    is_active: form.querySelector('[name="is_active"]').checked,
    category: fd.get('category') || '',
    day_of_week: dayOfWeek,
    time_slot: (fd.get('time_start') && fd.get('time_end')) ? `${fd.get('time_start')}〜${fd.get('time_end')}` : (fd.get('time_start') || fd.get('time_end') || ''),
    venue: fd.get('venue').trim(),
    main_coach: fd.get('main_coach').trim(),
    patrol_coach: fd.get('patrol_coach').trim(),
    target: fd.get('target').trim(),
    capacity: fd.get('capacity') ? parseInt(fd.get('capacity'), 10) : null,
    fee: fd.get('fee') ? parseInt(fd.get('fee'), 10) : null,
    fee2: fd.get('fee2') ? parseInt(fd.get('fee2'), 10) : null,
    calendar_tag: fd.get('calendar_tag').trim(),
    furikae_group: fd.get('furikae_group').trim(),
    attendance_group: fd.get('attendance_group').trim(),
    class_code: fd.get('class_code').trim(),
    sub_classes: getSubClassesFromUI(),
    memo: fd.get('memo').trim(),
  };

  if (!data.name) {
    showToast('教室名を入力してください', 'warning');
    return;
  }

  let error;
  if (id) {
    ({ error } = await supabase.from('classrooms').update(data).eq('id', id));
  } else {
    ({ error } = await supabase.from('classrooms').insert(data));
  }

  if (error) {
    console.error('教室保存エラー:', error);
    if (error.code === '23505') {
      showToast('同じ名前の教室が既に存在します', 'error');
    } else {
      showToast('保存に失敗しました', 'error');
    }
    return;
  }

  showToast('保存しました', 'success');
  closeModal();
  await loadClassrooms();
  renderClassroomView();
}

// --- サブクラスマネージャー ---

function initSubClassManager() {
  const list = document.getElementById('sc-list');
  const addBtn = document.getElementById('sc-add-btn');
  const addInput = document.getElementById('sc-add-input');
  if (!list || !addBtn || !addInput) return;

  // 追加ボタン
  addBtn.addEventListener('click', () => {
    const name = addInput.value.trim();
    if (!name) return;
    // 重複チェック
    const existing = Array.from(list.querySelectorAll('.sc-name')).map(el => el.textContent);
    if (existing.includes(name)) {
      showToast('同じ名前のサブクラスが既にあります', 'warning');
      return;
    }
    appendSubClassItem(list, name);
    addInput.value = '';
    addInput.focus();
  });

  // Enter キーでも追加
  addInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addBtn.click();
    }
  });

  // 既存アイテムにイベント設定
  list.querySelectorAll('.sc-item').forEach(item => bindSubClassItemEvents(item));

  // ドラッグ並び替え
  initSubClassDrag(list);
}

function appendSubClassItem(list, name) {
  const div = document.createElement('div');
  div.className = 'sc-item';
  div.innerHTML = `
    <span class="material-icons sc-drag">drag_indicator</span>
    <span class="sc-name">${escapeHtml(name)}</span>
    <button type="button" class="sc-btn sc-edit-btn" title="編集"><span class="material-icons">edit</span></button>
    <button type="button" class="sc-btn sc-del-btn" title="削除"><span class="material-icons">close</span></button>
  `;
  list.appendChild(div);
  bindSubClassItemEvents(div);
}

function bindSubClassItemEvents(item) {
  // 削除
  const delBtn = item.querySelector('.sc-del-btn');
  if (delBtn) {
    delBtn.addEventListener('click', () => {
      item.style.transition = 'opacity 0.2s, transform 0.2s';
      item.style.opacity = '0';
      item.style.transform = 'translateX(20px)';
      setTimeout(() => item.remove(), 200);
    });
  }

  // 編集（インライン）
  const editBtn = item.querySelector('.sc-edit-btn');
  const nameSpan = item.querySelector('.sc-name');
  if (editBtn && nameSpan) {
    editBtn.addEventListener('click', () => {
      const current = nameSpan.textContent;
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'sc-edit-input';
      input.value = current;
      nameSpan.replaceWith(input);
      input.focus();
      input.select();

      const commit = () => {
        const val = input.value.trim() || current;
        const span = document.createElement('span');
        span.className = 'sc-name';
        span.textContent = val;
        input.replaceWith(span);
        // 再バインド（新しいspan要素のため）
        bindSubClassItemEvents(item);
      };

      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.value = current; input.blur(); }
      });
    });
  }
}

function initSubClassDrag(list) {
  let dragItem = null;
  let dragClone = null;
  let startY = 0;

  const getY = (e) => (e.touches ? e.touches[0].clientY : e.clientY);

  const onStart = (e) => {
    const handle = e.target.closest('.sc-drag');
    if (!handle) return;
    const item = handle.closest('.sc-item');
    if (!item) return;

    e.preventDefault();
    dragItem = item;
    startY = getY(e);

    // クローン作成
    const rect = item.getBoundingClientRect();
    dragClone = item.cloneNode(true);
    dragClone.classList.add('sc-item-clone');
    dragClone.style.width = rect.width + 'px';
    dragClone.style.left = rect.left + 'px';
    dragClone.style.top = rect.top + 'px';
    document.body.appendChild(dragClone);

    item.classList.add('sc-item-placeholder');

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
  };

  const onMove = (e) => {
    if (!dragItem) return;
    e.preventDefault();

    const y = getY(e);
    dragClone.style.top = (parseFloat(dragClone.style.top) + (y - startY)) + 'px';
    startY = y;

    // 挿入位置を検出
    const items = Array.from(list.querySelectorAll('.sc-item:not(.sc-item-placeholder)'));
    let insertTarget = null;
    for (const item of items) {
      const rect = item.getBoundingClientRect();
      if (y < rect.top + rect.height / 2) {
        insertTarget = item;
        break;
      }
    }

    // FLIP animation
    const siblings = Array.from(list.querySelectorAll('.sc-item'));
    const firstRects = new Map();
    for (const el of siblings) {
      firstRects.set(el, el.getBoundingClientRect());
    }

    if (insertTarget) {
      list.insertBefore(dragItem, insertTarget);
    } else {
      list.appendChild(dragItem);
    }

    for (const [el, firstRect] of firstRects) {
      const lastRect = el.getBoundingClientRect();
      const dy = firstRect.top - lastRect.top;
      if (Math.abs(dy) > 1 && el !== dragItem) {
        el.style.transition = 'none';
        el.style.transform = `translateY(${dy}px)`;
        requestAnimationFrame(() => {
          el.style.transition = 'transform 0.25s cubic-bezier(0.25, 1, 0.5, 1)';
          el.style.transform = '';
        });
      }
    }
  };

  const onEnd = () => {
    if (!dragItem) return;
    dragItem.classList.remove('sc-item-placeholder');
    if (dragClone) dragClone.remove();
    dragItem = null;
    dragClone = null;

    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onEnd);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onEnd);
  };

  list.addEventListener('mousedown', onStart);
  list.addEventListener('touchstart', onStart, { passive: false });
}

function getSubClassesFromUI() {
  const list = document.getElementById('sc-list');
  if (!list) return [];
  return Array.from(list.querySelectorAll('.sc-item .sc-name')).map(el => el.textContent.trim()).filter(Boolean);
}

// --- 削除 ---

export function confirmDeleteClassroom(id, name) {
  const content = `
    <p>教室「${escapeHtml(name)}」を削除しますか？</p>
    <p class="text-warning">この教室に所属している会員データには影響しません。</p>
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="window.memberApp.closeModal()">キャンセル</button>
      <button class="btn btn-danger" onclick="window.memberApp.deleteClassroom('${id}')">
        <span class="material-icons">delete</span>削除
      </button>
    </div>`;
  openModal('確認', content);
}

export async function deleteClassroom(id) {
  const { error } = await supabase.from('classrooms').delete().eq('id', id);
  if (error) {
    console.error('教室削除エラー:', error);
    showToast('削除に失敗しました', 'error');
    return;
  }
  showToast('削除しました', 'success');
  closeModal();
  await loadClassrooms();
  renderClassroomView();
}

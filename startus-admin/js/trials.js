import { supabase } from './supabase.js';
import { escapeHtml } from './utils.js';
import { showToast, openModal, closeModal, setModalWide } from './app.js';
import { getClassrooms, getActiveClassrooms } from './classroom.js';
import { updateTabBadges } from './notifications.js';
import { logActivity, openApplicationHistory as openAppHistory } from './history.js';
import { getJimukyokuStaff, getStaffById, getAllActiveStaff } from './staff.js';
import { sendTaskMessage } from './chat.js';

// --- 定数 ---

const TRIAL_STATUS_LABELS = {
  pending: '未対応', reviewed: '受付済み', approved: '体験済み',
  enrolled: '入会済み', rejected: 'キャンセル'
};

const TRIAL_STATUS_BADGE = {
  pending: 'badge-app-pending', reviewed: 'badge-app-reviewed',
  approved: 'badge-app-approved', enrolled: 'badge-enrolled',
  rejected: 'badge-app-rejected'
};

const TRIAL_CHECKLIST_ITEMS = [
  { key: 'receipt',       label: '申込受付確認' },
  { key: 'staff_contact', label: '担当者連絡' },
];

const TRIAL_FIELDS = [
  { key: 'name', label: '氏名' },
  { key: 'furigana', label: 'フリガナ' },
  { key: 'gender', label: '性別' },
  { key: 'age', label: '年齢' },
  { key: 'grade', label: '学年' },
  { key: 'school', label: '学校' },
  { key: 'guardian_name', label: '保護者名' },
  { key: 'phone', label: '電話番号' },
  { key: 'email', label: 'メール' },
  { key: 'desired_date', label: '体験希望日' },
  { key: 'desired_classes', label: '希望教室' },
  { key: 'omoi', label: '期待・思い' },
  { key: 'route', label: '知ったきっかけ' },
  { key: 'route_detail', label: 'きっかけ詳細' },
  { key: 'note', label: '質問・備考' },
];

// フィールドごとの入力タイプ定義
const TRIAL_FIELD_INPUT_TYPES = {
  gender: { type: 'select', options: ['男', '女'] },
  desired_classes: { type: 'checkbox-group' },
  desired_date: { type: 'text' },
  omoi: { type: 'textarea' },
  route_detail: { type: 'textarea' },
  note: { type: 'textarea' },
};

// --- チェックリスト ヘルパー ---

function initializeTrialChecklist() {
  return {
    items: TRIAL_CHECKLIST_ITEMS.map(item => ({
      key: item.key,
      checked: false,
      checked_at: null,
      checked_by: null,
    })),
  };
}

function getTrialChecklistProgress(checklist) {
  if (!checklist || !checklist.items) return null;
  const total = TRIAL_CHECKLIST_ITEMS.length;
  const checked = checklist.items.filter(i => i.checked).length;
  return { checked, total };
}

function formatShortDateTimeTrial(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${m}/${day} ${h}:${mi}`;
}

function extractNameTrial(email) {
  if (!email) return '';
  return email.split('@')[0];
}

// --- データ ---

let allTrials = [];
let filteredTrials = [];
let joinApplications = [];

export function getFilteredTrials() { return filteredTrials; }

let trialFilters = {
  status: [],
  classes: [],
  assignee: [],
  query: '',
};
let trialSortKey = 'created_desc';

// --- データ読み込み ---

async function loadTrialData() {
  const { data, error } = await supabase
    .from('applications')
    .select('*')
    .eq('type', 'trial')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('体験データ取得エラー:', error);
    return;
  }
  allTrials = data || [];

  // 入会申請も取得（転換率計算用）
  const { data: joinData } = await supabase
    .from('applications')
    .select('id, form_data, status, created_at')
    .eq('type', 'join');

  joinApplications = joinData || [];
}

// --- 入会紐付け ---

function getLinkedJoinApplication(trial) {
  if (!trial.linked_application_id) return null;
  return joinApplications.find(j => j.id === trial.linked_application_id) || null;
}

function findJoinCandidates(trial) {
  const email = trial.form_data?.email || '';
  const name = trial.form_data?.name || '';
  if (!email && !name) return [];

  const linkedIds = new Set(
    allTrials.filter(t => t.linked_application_id).map(t => t.linked_application_id)
  );

  return joinApplications.filter(j => {
    if (linkedIds.has(j.id)) return false;
    const jEmail = j.form_data?.email || '';
    const jName = j.form_data?.name || '';
    if (email && jEmail && email === jEmail) return true;
    if (name && jName && name === jName) return true;
    return false;
  });
}

function hasJoinApplication(trial) {
  if (trial.status === 'enrolled') return true;
  if (trial.linked_application_id) return true;
  return findJoinCandidates(trial).length > 0;
}

// --- フィルタ・検索 ---

function applyTrialFilters() {
  let result = [...allTrials];

  // ステータスフィルタ
  if (trialFilters.status.length > 0) {
    result = result.filter(t => trialFilters.status.includes(t.status));
  }

  // 教室フィルタ
  if (trialFilters.classes.length > 0) {
    result = result.filter(t => {
      const classes = t.form_data?.desired_classes || [];
      const classArr = Array.isArray(classes) ? classes : [classes];
      return classArr.some(c => trialFilters.classes.includes(c));
    });
  }

  // 担当者フィルタ
  if (trialFilters.assignee.length > 0) {
    result = result.filter(t => {
      if (trialFilters.assignee.includes('unassigned') && !t.assigned_to) return true;
      if (t.assigned_to && trialFilters.assignee.includes(t.assigned_to)) return true;
      return false;
    });
  }

  // 検索
  if (trialFilters.query) {
    const q = trialFilters.query.toLowerCase();
    result = result.filter(t => {
      const fd = t.form_data || {};
      return (fd.name || '').toLowerCase().includes(q) ||
        (fd.furigana || '').toLowerCase().includes(q) ||
        (fd.school || '').toLowerCase().includes(q) ||
        (fd.email || '').toLowerCase().includes(q);
    });
  }

  // ソート
  const STATUS_ORDER = { pending: 0, reviewed: 1, approved: 2, enrolled: 3, rejected: 4 };
  result.sort((a, b) => {
    switch (trialSortKey) {
      case 'created_asc': return new Date(a.created_at) - new Date(b.created_at);
      case 'desired_date': return ((a.form_data?.desired_date || '').localeCompare(b.form_data?.desired_date || ''));
      case 'name': return ((a.form_data?.name || '').localeCompare((b.form_data?.name || ''), 'ja'));
      case 'status': return (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
      case 'created_desc':
      default: return new Date(b.created_at) - new Date(a.created_at);
    }
  });

  filteredTrials = result;
  updateTrialFilterBadge();
}

function updateTrialFilterBadge() {
  const count = trialFilters.status.length + trialFilters.classes.length + trialFilters.assignee.length;
  const btn = document.getElementById('trial-filter-toggle');
  if (!btn) return;
  const existing = btn.querySelector('.filter-badge');
  if (existing) existing.remove();
  btn.classList.toggle('has-filters', count > 0);
  if (count > 0) {
    btn.insertAdjacentHTML('beforeend', `<span class="filter-badge">${count}</span>`);
  }
}

export function resetTrialFilters() {
  trialFilters = { status: [], classes: [], assignee: [], query: '' };
  document.querySelectorAll('#trial-filter-panel input[type="checkbox"]').forEach(cb => { cb.checked = false; });
  const searchInput = document.getElementById('trial-search-input');
  if (searchInput) searchInput.value = '';
  applyTrialFilters();
  renderTrialListOnly();
}

export function initTrialSort() {
  const sel = document.getElementById('trial-sort-select');
  if (sel) {
    sel.value = trialSortKey;
    sel.addEventListener('change', () => {
      trialSortKey = sel.value;
      applyTrialFilters();
      renderTrialListOnly();
    });
  }
}

// --- グリッドヘッダー ---

const TRIAL_GRID_HEADER = `
  <div class="trial-grid-header">
    <span>氏名</span>
    <span>学校/学年</span>
    <span>教室</span>
    <span>ステータス</span>
    <span>担当</span>
    <span>体験希望日</span>
    <span>受付日</span>
    <span></span>
  </div>`;

function buildTrialGridRow(t) {
  const fd = t.form_data || {};
  const statusLabel = TRIAL_STATUS_LABELS[t.status] || t.status;
  const badgeClass = TRIAL_STATUS_BADGE[t.status] || '';
  const classes = Array.isArray(fd.desired_classes) ? fd.desired_classes.join('・') : fd.desired_classes || '';
  const createdDate = formatShortDate(t.created_at);
  const desiredDate = fd.desired_date || '';
  const isOverdue = t.status === 'approved' && t.follow_up_date &&
    new Date(t.follow_up_date) < new Date(new Date().toDateString());
  const assigneeName = t.assigned_to ? (getStaffById(t.assigned_to)?.name || '') : '';

  // 未割当ハイライト: pending or approved(フォロー中) で担当者なし
  const needsAssignment = !t.assigned_to && (t.status === 'pending' || t.status === 'approved');

  return `
    <div class="list-item ${needsAssignment ? 'needs-assignment' : ''}" data-status="${t.status}"
         onclick="window.memberApp.showTrialDetail('${t.id}')"
         oncontextmenu="window.memberApp.showTrialContextMenu(event, '${t.id}')">
      <div class="grid-cell grid-cell-name">
        <span class="material-icons" style="font-size:18px;color:var(--gray-400);flex-shrink:0">directions_run</span>
        <strong>${escapeHtml(fd.name || '（名前なし）')}</strong>
      </div>
      <div class="grid-cell">${fd.school ? escapeHtml(fd.school) : ''}${fd.grade ? ` ${escapeHtml(fd.grade)}` : ''}</div>
      <div class="grid-cell">
        ${classes ? `<span class="badge badge-class">${escapeHtml(classes)}</span>` : ''}
      </div>
      <div class="grid-cell grid-cell-badges">
        <span class="badge ${badgeClass}">${escapeHtml(statusLabel)}</span>
        ${t.status === 'enrolled' ? '<span class="badge badge-enrolled">入会済</span>' : ''}
        ${t.status !== 'enrolled' && t.linked_application_id ? '<span class="badge badge-info">紐付け中</span>' : ''}
        ${isOverdue ? '<span class="badge badge-followup-overdue">要フォロー</span>' : ''}
      </div>
      <div class="grid-cell grid-cell-assignee">
        ${needsAssignment
          ? '<span class="badge badge-warning-alert">未割当</span>'
          : assigneeName
            ? `<span class="badge badge-assignee">${escapeHtml(assigneeName)}</span>`
            : ''}
      </div>
      <div class="grid-cell grid-cell-date">${escapeHtml(desiredDate)}</div>
      <div class="grid-cell grid-cell-date">${escapeHtml(createdDate)}</div>
      <div class="grid-cell grid-cell-arrow">
        <span class="material-icons list-item-arrow">chevron_right</span>
      </div>
    </div>`;
}

// --- ワークロード表示 ---

function buildTrialWorkloadSummary() {
  const staff = getJimukyokuStaff();
  const active = allTrials.filter(t => t.status !== 'enrolled' && t.status !== 'rejected');

  let unassigned = 0;
  const counts = {};
  staff.forEach(s => { counts[s.id] = 0; });

  active.forEach(t => {
    if (!t.assigned_to) {
      unassigned++;
    } else if (counts[t.assigned_to] !== undefined) {
      counts[t.assigned_to]++;
    }
  });

  const isActive = (val) => trialFilters.assignee.includes(val) ? ' active' : '';
  const countClass = (n) => n > 0 ? 'workload-count' : 'workload-count workload-count-zero';

  let html = `<div class="workload-card${isActive('unassigned')}" onclick="window.memberApp.toggleTrialWorkloadFilter('unassigned')">
    <span class="material-icons" style="font-size:16px;color:var(--gray-400)">person_off</span>
    未割当 <span class="${countClass(unassigned)}">${unassigned}</span>
  </div>`;

  staff.forEach(s => {
    const c = counts[s.id] || 0;
    html += `<div class="workload-card${isActive(s.id)}" onclick="window.memberApp.toggleTrialWorkloadFilter('${s.id}')">
      <span class="material-icons" style="font-size:16px;color:var(--primary-color)">person</span>
      ${escapeHtml(s.name)} <span class="${countClass(c)}">${c}</span>
    </div>`;
  });

  return html;
}

export function toggleTrialWorkloadFilter(value) {
  const container = document.getElementById('trial-assignee-filter');
  if (trialFilters.assignee.includes(value)) {
    trialFilters.assignee = trialFilters.assignee.filter(v => v !== value);
  } else {
    trialFilters.assignee = [value];
  }

  // フィルタパネルのチェックボックスも同期
  if (container) {
    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = trialFilters.assignee.includes(cb.value);
    });
  }

  applyTrialFilters();
  renderTrialListOnly();
}

// --- 一覧レンダリング ---

export async function renderTrialList() {
  await loadTrialData();
  applyTrialFilters();

  const workloadEl = document.getElementById('trial-workload');
  if (workloadEl) workloadEl.innerHTML = buildTrialWorkloadSummary();

  const listEl = document.getElementById('trial-list');
  if (!listEl) return;

  const countEl = document.getElementById('trial-count');
  if (countEl) {
    const total = allTrials.length;
    const shown = filteredTrials.length;
    countEl.textContent = total === shown ? `${shown}件` : `${total}件中 ${shown}件表示`;
  }

  if (filteredTrials.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <span class="material-icons empty-icon">person_search</span>
        <p>体験データがありません</p>
      </div>`;
    return;
  }

  listEl.innerHTML = TRIAL_GRID_HEADER + filteredTrials.map(buildTrialGridRow).join('');
}

// --- ワークフローステッパー ---

function buildTrialWorkflowStepper(status) {
  const steps = [
    { key: 'pending', label: '受付', icon: 'inbox' },
    { key: 'reviewed', label: '確認', icon: 'visibility' },
    { key: 'approved', label: '体験済', icon: 'check_circle' },
    { key: 'enrolled', label: '入会済', icon: 'how_to_reg' },
  ];

  const statusOrder = { pending: 0, reviewed: 1, approved: 2, enrolled: 3, rejected: -1 };
  const currentIndex = statusOrder[status] ?? 0;
  const isRejected = status === 'rejected';

  let html = '<div class="workflow-stepper">';

  steps.forEach((step, i) => {
    if (i > 0) {
      const connDone = !isRejected && currentIndex > i - 1;
      html += `<div class="stepper-connector ${connDone ? 'done' : ''}"></div>`;
    }

    let stepClass = '';
    let circleContent = '';

    if (isRejected && i === 0) {
      stepClass = 'rejected';
      circleContent = '<span class="material-icons" style="font-size:16px">close</span>';
    } else if (!isRejected && i < currentIndex) {
      stepClass = 'completed';
      circleContent = '<span class="material-icons" style="font-size:16px">check</span>';
    } else if (!isRejected && i === currentIndex) {
      stepClass = 'current';
      circleContent = `<span class="material-icons" style="font-size:16px">${step.icon}</span>`;
    } else {
      circleContent = `<span class="material-icons" style="font-size:16px">${step.icon}</span>`;
    }

    html += `
      <div class="stepper-step ${stepClass}">
        <div class="stepper-circle">${circleContent}</div>
        <span class="stepper-label">${step.label}</span>
      </div>`;
  });

  html += '</div>';
  return html;
}

// --- 詳細モーダル ---

export async function showTrialDetail(id) {
  const trial = allTrials.find(t => t.id === id);
  if (!trial) return;

  setModalWide(true);

  const fd = trial.form_data || {};
  const statusLabel = TRIAL_STATUS_LABELS[trial.status] || trial.status;
  const badgeClass = TRIAL_STATUS_BADGE[trial.status] || '';
  const joined = hasJoinApplication(trial);

  // 全幅表示するフィールド（長文テキスト系）
  const fullWidthKeys = new Set(['omoi', 'route_detail', 'note']);

  // フォームデータ表示
  const detailRows = TRIAL_FIELDS.map(f => {
    let val = fd[f.key];
    if (Array.isArray(val)) val = val.join('・');
    if (!val) return '';
    const fullClass = fullWidthKeys.has(f.key) ? ' detail-row-full' : '';
    return `
      <div class="detail-row${fullClass}">
        <span class="detail-label">${escapeHtml(f.label)}</span>
        <span class="detail-value">${escapeHtml(val)}</span>
      </div>`;
  }).filter(Boolean).join('');

  const content = `
    ${buildTrialWorkflowStepper(trial.status)}

    <div class="app-detail-header">
      <div class="detail-row">
        <span class="detail-label">受付日時</span>
        <span class="detail-value">${escapeHtml(formatDateTime(trial.created_at))}</span>
      </div>
      ${trial.processed_at ? `
      <div class="detail-row">
        <span class="detail-label">処理日時</span>
        <span class="detail-value">${escapeHtml(formatDateTime(trial.processed_at))}</span>
      </div>` : ''}
      ${trial.status === 'enrolled' ? `
      <div class="detail-row">
        <span class="detail-label">入会状況</span>
        <span class="detail-value"><span class="badge badge-enrolled">入会済み</span></span>
      </div>` : ''}
      ${trial.status !== 'enrolled' && trial.linked_application_id ? `
      <div class="detail-row">
        <span class="detail-label">入会状況</span>
        <span class="detail-value"><span class="badge badge-info">入会申請紐付け中</span></span>
      </div>` : ''}
      <div class="detail-row">
        <span class="detail-label"><span class="material-icons" style="font-size:16px;vertical-align:middle">person_pin</span> 担当者</span>
        <span class="detail-value">
          <select class="assignee-select" onchange="window.memberApp.assignTrial('${trial.id}', this.value)">
            <option value="">-- 未割当 --</option>
            ${getJimukyokuStaff().map(s =>
              `<option value="${s.id}" ${trial.assigned_to === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
            ).join('')}
          </select>
        </span>
      </div>
    </div>

    <div class="app-detail-section" id="trial-content-section">
      <div class="app-detail-section-header" id="trial-content-header">
        <span class="material-icons" style="font-size:18px">person</span> 体験申込内容
        <span style="margin-left:auto;display:flex;gap:6px">
          <button class="btn btn-secondary btn-xs" onclick="window.memberApp.openTrialEditForm('${trial.id}')">
            <span class="material-icons">edit</span>編集
          </button>
          <button class="btn btn-secondary btn-xs" onclick="window.memberApp.openTrialHistory('${trial.id}', '${escapeHtml(fd.name || '')} 体験申込')">
            <span class="material-icons">history</span>履歴
          </button>
        </span>
      </div>
      <div class="detail-grid" id="trial-content-grid">
        ${detailRows}
      </div>
    </div>

    ${buildTrialChecklistSection(trial)}

    ${trial.status === 'approved' ? buildFollowUpSection(trial) : ''}
    ${trial.status === 'approved' || trial.status === 'enrolled' ? buildJoinLinkingSection(trial) : ''}

    <div class="app-detail-section">
      <div class="app-detail-section-header">
        <span class="material-icons" style="font-size:18px">note</span> メモ
      </div>
      <textarea id="trial-admin-note" rows="2" class="admin-note-textarea" placeholder="事務局メモ...">${escapeHtml(trial.admin_note || '')}</textarea>
      <div style="text-align:right;margin-top:6px">
        <button class="btn btn-secondary btn-sm" onclick="window.memberApp.saveTrialAdminNote('${trial.id}')">
          <span class="material-icons">save</span>メモ保存
        </button>
      </div>
    </div>

    ${buildTrialActionButtons(trial)}

    <div style="text-align:center;margin-top:12px">
      <button class="btn btn-ghost-danger btn-sm" onclick="window.memberApp.deleteTrial('${trial.id}')">
        <span class="material-icons">delete</span>この体験データを削除
      </button>
    </div>`;

  openModal('体験詳細', content);
}

// --- アクションボタン ---

function buildTrialActionButtons(trial) {
  let buttons = '';

  if (trial.status === 'pending') {
    buttons = `
      <button class="btn btn-danger" onclick="window.memberApp.updateTrialStatus('${trial.id}', 'rejected')">
        <span class="material-icons">cancel</span>キャンセルにする
      </button>
      <button class="btn btn-secondary" onclick="window.memberApp.updateTrialStatus('${trial.id}', 'reviewed')">
        <span class="material-icons">visibility</span>受付確認済みにする
      </button>`;
  } else if (trial.status === 'reviewed') {
    buttons = `
      <button class="btn btn-danger" onclick="window.memberApp.updateTrialStatus('${trial.id}', 'rejected')">
        <span class="material-icons">cancel</span>キャンセルにする
      </button>
      <button class="btn btn-primary" onclick="window.memberApp.updateTrialStatus('${trial.id}', 'approved')">
        <span class="material-icons">done_all</span>体験済みにする
      </button>`;
  } else if (trial.status === 'rejected') {
    buttons = `
      <button class="btn btn-secondary" onclick="window.memberApp.updateTrialStatus('${trial.id}', 'pending')">
        <span class="material-icons">undo</span>未対応に戻す
      </button>`;
  } else if (trial.status === 'approved') {
    buttons = `
      <button class="btn btn-secondary" onclick="window.memberApp.updateTrialStatus('${trial.id}', 'reviewed')">
        <span class="material-icons">undo</span>受付済みに戻す
      </button>
      <button class="btn btn-primary" onclick="window.memberApp.markTrialEnrolled('${trial.id}')">
        <span class="material-icons">how_to_reg</span>入会済みにする
      </button>`;
  } else if (trial.status === 'enrolled') {
    buttons = `
      <button class="btn btn-secondary" onclick="window.memberApp.updateTrialStatus('${trial.id}', 'approved')">
        <span class="material-icons">undo</span>体験済みに戻す
      </button>`;
  }

  if (!buttons) return '';
  return `<div class="app-detail-actions">${buttons}</div>`;
}

// --- チェックリスト UI ---

function buildTrialChecklistSection(trial) {
  const cl = trial.checklist || initializeTrialChecklist();
  const progress = getTrialChecklistProgress(cl);
  const progressPct = progress ? Math.round((progress.checked / progress.total) * 100) : 0;
  const allDone = progress && progress.checked === progress.total;

  const checkItems = TRIAL_CHECKLIST_ITEMS.map(def => {
    const item = cl.items?.find(i => i.key === def.key) || { checked: false };
    const checkedClass = item.checked ? 'checklist-item-done' : '';
    const checkedIcon = item.checked ? 'check_box' : 'check_box_outline_blank';
    const checkedInfo = item.checked && item.checked_at
      ? `<span class="checklist-item-info">${formatShortDateTimeTrial(item.checked_at)} ${escapeHtml(extractNameTrial(item.checked_by))}</span>`
      : '';
    return `
      <div class="checklist-item ${checkedClass}" onclick="window.memberApp.toggleTrialChecklistItem('${trial.id}', '${def.key}')">
        <span class="material-icons checklist-checkbox">${checkedIcon}</span>
        <span class="checklist-item-label">${escapeHtml(def.label)}</span>
        ${checkedInfo}
      </div>`;
  }).join('');

  return `
    <div class="app-detail-section">
      <div class="app-detail-section-header">
        <span class="material-icons" style="font-size:18px">checklist</span> 事務局チェック
        <span class="checklist-progress-badge ${allDone ? 'checklist-complete' : ''}">${progress ? progress.checked : 0}/${progress ? progress.total : 0}</span>
      </div>
      <div class="checklist-progress-bar">
        <div class="checklist-progress-fill" style="width:${progressPct}%"></div>
      </div>
      <div class="checklist-items">
        ${checkItems}
      </div>
    </div>`;
}

export async function toggleTrialChecklistItem(trialId, itemKey) {
  const trial = allTrials.find(t => t.id === trialId);
  if (!trial) return;

  let cl = trial.checklist || initializeTrialChecklist();

  const item = cl.items.find(i => i.key === itemKey);
  if (!item) return;

  const { data: { session } } = await supabase.auth.getSession();
  const userEmail = session?.user?.email || '';

  if (item.checked) {
    item.checked = false;
    item.checked_at = null;
    item.checked_by = null;
  } else {
    item.checked = true;
    item.checked_at = new Date().toISOString();
    item.checked_by = userEmail;
  }

  const { error } = await supabase
    .from('applications')
    .update({ checklist: cl })
    .eq('id', trialId);

  if (error) {
    console.error('チェックリスト更新エラー:', error);
    showToast('チェックリストの更新に失敗しました', 'error');
    return;
  }

  trial.checklist = cl;

  const modalBody = document.getElementById('modal-body');
  const scrollPos = modalBody?.scrollTop || 0;
  showTrialDetail(trialId);
  requestAnimationFrame(() => {
    if (modalBody) modalBody.scrollTop = scrollPos;
  });
}

// --- ステータス変更 ---

export async function updateTrialStatus(id, newStatus) {
  const statusLabel = TRIAL_STATUS_LABELS[newStatus] || newStatus;

  const trial = allTrials.find(t => t.id === id);
  const oldStatus = trial?.status;

  const updateData = { status: newStatus };
  if (newStatus === 'approved' || newStatus === 'rejected' || newStatus === 'enrolled') {
    updateData.processed_at = new Date().toISOString();
    const { data: { session } } = await supabase.auth.getSession();
    updateData.processed_by = session?.user?.email || '';
  }

  // enrolled から戻す場合は紐付けもクリア
  if (oldStatus === 'enrolled' && newStatus !== 'enrolled') {
    updateData.linked_application_id = null;
  }

  const { error } = await supabase
    .from('applications')
    .update(updateData)
    .eq('id', id);

  if (error) {
    console.error('ステータス変更エラー:', error);
    showToast('更新に失敗しました', 'error');
    return;
  }

  showToast(`ステータスを「${statusLabel}」に変更しました`, 'success');
  closeModal();
  await renderTrialList();
  updateTabBadges();
}

// --- メモ保存 ---

export async function saveTrialAdminNote(id) {
  const input = document.getElementById('trial-admin-note');
  if (!input) return;

  const { error } = await supabase
    .from('applications')
    .update({ admin_note: input.value.trim() })
    .eq('id', id);

  if (error) {
    console.error('メモ保存エラー:', error);
    showToast('メモの保存に失敗しました', 'error');
    return;
  }

  showToast('メモを保存しました', 'success');
  const idx = allTrials.findIndex(t => t.id === id);
  if (idx >= 0) allTrials[idx].admin_note = input.value.trim();
}

// --- 削除 ---

export async function deleteTrial(id) {
  const trial = allTrials.find(t => t.id === id);
  if (!trial) return;

  const name = trial.form_data?.name || '（名前なし）';

  const content = `
    <div style="padding:8px 0">
      <p>「${escapeHtml(name)}」の体験データを削除しますか？</p>
      <p style="color:var(--danger-color);font-size:0.85rem">この操作は元に戻せません</p>
      <div class="form-actions" style="margin-top:24px">
        <button class="btn btn-secondary" onclick="window.memberApp.closeModal()">キャンセル</button>
        <button class="btn btn-danger" onclick="window.memberApp.executeDeleteTrial('${id}')">
          <span class="material-icons">delete</span>削除
        </button>
      </div>
    </div>`;

  openModal('体験データの削除', content);
}

export async function executeDeleteTrial(id) {
  const { error } = await supabase
    .from('applications')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('削除エラー:', error);
    showToast('削除に失敗しました', 'error');
    return;
  }

  showToast('削除しました', 'success');
  closeModal();
  await renderTrialList();
  updateTabBadges();
}

// --- フォローアップセクション ---

function buildFollowUpSection(trial) {
  const followUpDate = trial.follow_up_date || '';
  const isOverdue = followUpDate && new Date(followUpDate) < new Date(new Date().toDateString());

  return `
    <div class="app-detail-section">
      <div class="app-detail-section-header">
        <span class="material-icons" style="font-size:18px">event</span> フォローアップ
        ${isOverdue ? '<span class="badge badge-followup-overdue">期限超過</span>' : ''}
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <input type="date" id="trial-follow-up-date" value="${followUpDate}" class="form-control" style="flex:1">
        <button class="btn btn-secondary btn-sm"
                onclick="window.memberApp.saveTrialFollowUp('${trial.id}')">
          <span class="material-icons">save</span>保存
        </button>
      </div>
      <p class="form-hint">
        体験後の入会フォローアップ期限を設定できます
      </p>
    </div>`;
}

export async function saveTrialFollowUp(trialId) {
  const input = document.getElementById('trial-follow-up-date');
  if (!input) return;

  const followUpDate = input.value || null;

  const { error } = await supabase
    .from('applications')
    .update({ follow_up_date: followUpDate })
    .eq('id', trialId);

  if (error) {
    showToast('フォローアップ日の保存に失敗しました', 'error');
    return;
  }

  const idx = allTrials.findIndex(t => t.id === trialId);
  if (idx >= 0) allTrials[idx].follow_up_date = followUpDate;

  showToast('フォローアップ日を保存しました', 'success');
  renderTrialListOnly();
}

// --- 入会紐付けセクション ---

function buildJoinLinkingSection(trial) {
  const linked = getLinkedJoinApplication(trial);
  if (linked) {
    return `
      <div class="app-detail-section">
        <div class="app-detail-section-header">
          <span class="material-icons" style="font-size:18px">link</span> 紐付けされた入会申請
        </div>
        <div class="detail-grid">
          <div class="detail-row">
            <span class="detail-label">氏名</span>
            <span class="detail-value">${escapeHtml(linked.form_data?.name || '')}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">申請日</span>
            <span class="detail-value">${escapeHtml(formatDateTime(linked.created_at))}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">ステータス</span>
            <span class="detail-value"><span class="badge badge-app-${linked.status}">${escapeHtml(linked.status)}</span></span>
          </div>
        </div>
        <button class="btn btn-secondary btn-sm" style="margin-top:8px"
                onclick="window.memberApp.unlinkJoinApplication('${trial.id}')">
          <span class="material-icons">link_off</span>紐付け解除
        </button>
      </div>`;
  }

  const candidates = findJoinCandidates(trial);
  let candidateHtml = '';
  if (candidates.length > 0) {
    candidateHtml = candidates.map(c => `
      <div class="join-candidate-row">
        <div>
          <strong>${escapeHtml(c.form_data?.name || '')}</strong>
          <span style="font-size:0.8rem;color:var(--gray-400);margin-left:8px">${escapeHtml(c.form_data?.email || '')}</span>
          <span style="font-size:0.78rem;color:var(--gray-400);margin-left:8px">${formatShortDate(c.created_at)}</span>
        </div>
        <button class="btn btn-secondary btn-xs"
                onclick="window.memberApp.linkJoinApplication('${trial.id}', '${c.id}')">
          <span class="material-icons">link</span>紐付け
        </button>
      </div>`).join('');
  } else {
    candidateHtml = '<p class="text-muted" style="font-size:0.82rem">一致する入会申請が見つかりません</p>';
  }

  return `
    <div class="app-detail-section">
      <div class="app-detail-section-header">
        <span class="material-icons" style="font-size:18px">link</span> 入会申請の紐付け
      </div>
      ${candidateHtml}
    </div>`;
}

export async function linkJoinApplication(trialId, joinId) {
  const { error } = await supabase
    .from('applications')
    .update({ linked_application_id: joinId })
    .eq('id', trialId);

  if (error) {
    showToast('紐付けに失敗しました', 'error');
    return;
  }

  const idx = allTrials.findIndex(t => t.id === trialId);
  if (idx >= 0) allTrials[idx].linked_application_id = joinId;

  showToast('入会申請を紐付けました', 'success');

  const modalBody = document.getElementById('modal-body');
  const scrollPos = modalBody?.scrollTop || 0;
  showTrialDetail(trialId);
  requestAnimationFrame(() => {
    if (modalBody) modalBody.scrollTop = scrollPos;
  });
}

export async function unlinkJoinApplication(trialId) {
  const trial = allTrials.find(t => t.id === trialId);
  if (!trial) return;

  const revertStatus = trial.status === 'enrolled' ? 'approved' : trial.status;

  const { error } = await supabase
    .from('applications')
    .update({ linked_application_id: null, status: revertStatus })
    .eq('id', trialId);

  if (error) {
    showToast('紐付け解除に失敗しました', 'error');
    return;
  }

  const idx = allTrials.findIndex(t => t.id === trialId);
  if (idx >= 0) {
    allTrials[idx].linked_application_id = null;
    allTrials[idx].status = revertStatus;
  }

  showToast('紐付けを解除しました', 'success');

  const modalBody = document.getElementById('modal-body');
  const scrollPos = modalBody?.scrollTop || 0;
  showTrialDetail(trialId);
  requestAnimationFrame(() => {
    if (modalBody) modalBody.scrollTop = scrollPos;
  });
  renderTrialListOnly();
}

export async function markTrialEnrolled(trialId) {
  const trial = allTrials.find(t => t.id === trialId);
  if (!trial) return;

  if (!trial.linked_application_id) {
    const candidates = findJoinCandidates(trial);
    const content = `
      <div style="padding:8px 0">
        <p>入会申請が紐付けされていません。</p>
        ${candidates.length > 0 ? `
        <p style="font-size:0.85rem;color:var(--gray-500);margin-top:4px">
          入会申請の候補が${candidates.length}件あります。先に紐付けすることを推奨します。
        </p>` : ''}
        <p style="font-size:0.85rem;color:var(--gray-500);margin-top:4px">
          紐付けなしで入会済みにしますか？
        </p>
        <div class="form-actions" style="margin-top:24px">
          <button class="btn btn-secondary" onclick="window.memberApp.showTrialDetail('${trialId}')">戻る</button>
          <button class="btn btn-primary" onclick="window.memberApp.updateTrialStatus('${trialId}', 'enrolled')">
            <span class="material-icons">how_to_reg</span>入会済みにする
          </button>
        </div>
      </div>`;
    openModal('入会済みの確認', content);
    return;
  }

  await updateTrialStatus(trialId, 'enrolled');
}

// --- フィルタUI初期化 ---

export function initTrialFilters() {
  // 検索
  const searchInput = document.getElementById('trial-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      trialFilters.query = searchInput.value.trim();
      applyTrialFilters();
      renderTrialListOnly();
    });
  }

  // ステータスフィルタ
  const statusContainer = document.getElementById('trial-status-filter');
  if (statusContainer) {
    statusContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        trialFilters.status = Array.from(statusContainer.querySelectorAll('input:checked')).map(c => c.value);
        applyTrialFilters();
        renderTrialListOnly();
      });
    });
  }

  // 教室フィルタ
  updateTrialClassFilter();

  // 担当者フィルタ
  updateTrialAssigneeFilter();
}

function updateTrialAssigneeFilter() {
  const container = document.getElementById('trial-assignee-filter');
  if (!container) return;

  const staff = getJimukyokuStaff();
  let html = '<label class="filter-pill"><input type="checkbox" value="unassigned">未割当</label>';
  html += staff.map(s =>
    `<label class="filter-pill"><input type="checkbox" value="${s.id}">${escapeHtml(s.name)}</label>`
  ).join('');
  container.innerHTML = html;

  container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      trialFilters.assignee = Array.from(container.querySelectorAll('input:checked')).map(c => c.value);
      applyTrialFilters();
      renderTrialListOnly();
    });
  });
}

function updateTrialClassFilter() {
  const container = document.getElementById('trial-class-filter');
  if (!container) return;

  const classrooms = getClassrooms();
  container.innerHTML = classrooms
    .filter(c => c.is_active)
    .map(c => `<label class="filter-pill"><input type="checkbox" value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</label>`)
    .join('');

  container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      trialFilters.classes = Array.from(container.querySelectorAll('input:checked')).map(c => c.value);
      applyTrialFilters();
      renderTrialListOnly();
    });
  });
}

// リストだけ再描画（データ再取得なし）
function renderTrialListOnly() {
  const workloadEl = document.getElementById('trial-workload');
  if (workloadEl) workloadEl.innerHTML = buildTrialWorkloadSummary();

  const listEl = document.getElementById('trial-list');
  if (!listEl) return;

  const countEl = document.getElementById('trial-count');
  if (countEl) {
    const total = allTrials.length;
    const shown = filteredTrials.length;
    countEl.textContent = total === shown ? `${shown}件` : `${total}件中 ${shown}件表示`;
  }

  if (filteredTrials.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <span class="material-icons empty-icon">person_search</span>
        <p>条件に一致する体験データがありません</p>
      </div>`;
    return;
  }

  listEl.innerHTML = TRIAL_GRID_HEADER + filteredTrials.map(buildTrialGridRow).join('');
}

export function toggleTrialFilterPanel() {
  const panel = document.getElementById('trial-filter-panel');
  if (panel) panel.classList.toggle('open');
}

// --- ユーティリティ ---

function formatShortDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${m}/${day}`;
}

function formatDateTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${day} ${h}:${mi}`;
}

// --- 編集機能 ---

function buildTrialFormField(field, value, classrooms) {
  const inputDef = TRIAL_FIELD_INPUT_TYPES[field.key] || { type: 'text' };
  const label = escapeHtml(field.label);
  const key = field.key;

  if (inputDef.type === 'select') {
    const options = inputDef.options.map(opt => {
      const selected = value === opt ? ' selected' : '';
      return `<option value="${escapeHtml(opt)}"${selected}>${escapeHtml(opt)}</option>`;
    }).join('');
    return `
      <div class="form-group">
        <label>${label}</label>
        <select name="${key}">
          <option value="">--</option>
          ${options}
        </select>
      </div>`;
  }

  if (inputDef.type === 'checkbox-group') {
    const valArr = Array.isArray(value) ? value : (value ? [value] : []);
    const checkboxes = classrooms.map(c => {
      const checked = valArr.includes(c.name) ? ' checked' : '';
      return `<label class="filter-pill"><input type="checkbox" name="${key}_cb" value="${escapeHtml(c.name)}"${checked}>${escapeHtml(c.name)}</label>`;
    }).join('');
    return `
      <div class="form-group">
        <label>${label}</label>
        <div class="classroom-checkboxes-scroll" id="trial-edit-${key}-checkboxes">
          ${checkboxes}
        </div>
      </div>`;
  }

  if (inputDef.type === 'textarea') {
    return `
      <div class="form-group">
        <label>${label}</label>
        <textarea name="${key}" rows="2">${escapeHtml(value || '')}</textarea>
      </div>`;
  }

  // デフォルト: text
  return `
    <div class="form-group">
      <label>${label}</label>
      <input type="text" name="${key}" value="${escapeHtml(value || '')}">
    </div>`;
}

export function openTrialEditForm(id) {
  const trial = allTrials.find(t => t.id === id);
  if (!trial) return;

  const fd = trial.form_data || {};
  const classrooms = getActiveClassrooms();

  // ヘッダーを編集モードに切り替え
  const section = document.getElementById('trial-content-section');
  if (section) section.classList.add('editing');

  const header = document.getElementById('trial-content-header');
  if (header) {
    header.innerHTML = `
      <span class="material-icons" style="font-size:18px">edit</span> 体験申込内容を編集中
      <span style="margin-left:auto;display:flex;gap:8px">
        <button class="btn btn-ghost btn-sm" onclick="window.memberApp.showTrialDetail('${id}')">
          <span class="material-icons">close</span>キャンセル
        </button>
        <button class="btn btn-primary btn-sm" onclick="window.memberApp.saveTrialEdit('${id}')">
          <span class="material-icons">save</span>保存
        </button>
      </span>`;
  }

  // コンテンツをフォームフィールドに置き換え
  const grid = document.getElementById('trial-content-grid');
  if (grid) {
    grid.innerHTML = TRIAL_FIELDS.map(f => buildTrialFormField(f, fd[f.key], classrooms)).join('');
  }
}

export async function saveTrialEdit(id) {
  const trial = allTrials.find(t => t.id === id);
  if (!trial) return;

  const oldFormData = trial.form_data || {};
  const newFormData = { ...oldFormData };

  const grid = document.getElementById('trial-content-grid');
  if (!grid) return;

  for (const field of TRIAL_FIELDS) {
    const inputDef = TRIAL_FIELD_INPUT_TYPES[field.key] || { type: 'text' };

    if (inputDef.type === 'checkbox-group') {
      const checkboxes = grid.querySelectorAll(`#trial-edit-${field.key}-checkboxes input[name="${field.key}_cb"]:checked`);
      newFormData[field.key] = [...checkboxes].map(cb => cb.value);
    } else {
      const input = grid.querySelector(`[name="${field.key}"]`);
      newFormData[field.key] = input ? input.value : (oldFormData[field.key] || '');
    }
  }

  const { error } = await supabase
    .from('applications')
    .update({ form_data: newFormData, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    console.error('体験編集保存エラー:', error);
    showToast('保存に失敗しました', 'error');
    return;
  }

  // 変更履歴を記録
  for (const field of TRIAL_FIELDS) {
    const oldVal = Array.isArray(oldFormData[field.key]) ? oldFormData[field.key].join(', ') : (oldFormData[field.key] ?? '');
    const newVal = Array.isArray(newFormData[field.key]) ? newFormData[field.key].join(', ') : (newFormData[field.key] ?? '');
    if (String(oldVal) !== String(newVal)) {
      logActivity(null, 'trial_edit', field.key, oldVal, newVal, id);
    }
  }

  // ローカルデータ更新
  const idx = allTrials.findIndex(t => t.id === id);
  if (idx >= 0) allTrials[idx].form_data = newFormData;

  showToast('体験内容を更新しました', 'success');

  // モーダル内で詳細を再表示（スクロール位置維持）
  const modalBody = document.getElementById('modal-body');
  const scrollPos = modalBody?.scrollTop || 0;
  showTrialDetail(id);
  requestAnimationFrame(() => {
    if (modalBody) modalBody.scrollTop = scrollPos;
  });
  renderTrialListOnly();
}

// --- 担当者割り当て ---

export async function assignTrial(id, staffId) {
  const trial = allTrials.find(t => t.id === id);
  if (!trial) return;

  const oldStaffName = trial.assigned_to ? (getStaffById(trial.assigned_to)?.name || '') : '';
  const assignValue = staffId || null;
  const newStaffName = assignValue ? (getStaffById(assignValue)?.name || '') : '';

  const { error } = await supabase
    .from('applications')
    .update({ assigned_to: assignValue })
    .eq('id', id);

  if (error) {
    console.error('担当者割り当てエラー:', error);
    showToast('担当者の設定に失敗しました', 'error');
    return;
  }

  // ローカルデータ更新
  const idx = allTrials.findIndex(t => t.id === id);
  if (idx >= 0) allTrials[idx].assigned_to = assignValue;

  // 履歴記録
  logActivity(null, 'trial_edit', 'assigned_to', oldStaffName, newStaffName, id);

  showToast(assignValue ? '担当者を設定しました' : '担当者を解除しました', 'success');

  // チャットにタスクメッセージ送信
  if (assignValue) {
    const fd = trial.form_data || {};
    const refLabel = `${fd.name || '（名前なし）'} 体験申請`;
    sendTaskMessage(assignValue, 'trial', id, refLabel, `${refLabel}の担当に割り当てられました`);
  }

  // モーダル再描画（スクロール位置維持）
  const modalBody = document.getElementById('modal-body');
  const scrollPos = modalBody?.scrollTop || 0;
  showTrialDetail(id);
  requestAnimationFrame(() => {
    if (modalBody) modalBody.scrollTop = scrollPos;
  });
  renderTrialListOnly();
}

// --- 右クリックコンテキストメニュー ---

export function showTrialContextMenu(event, trialId) {
  event.preventDefault();
  event.stopPropagation();
  const trial = allTrials.find(t => t.id === trialId);
  if (!trial) return;

  // enrolled/rejected は編集不可
  if (trial.status === 'enrolled' || trial.status === 'rejected') return;

  const menu = document.getElementById('app-context-menu');
  if (!menu) return;
  const header = menu.querySelector('.context-menu-header');
  const items = menu.querySelector('.context-menu-items');

  header.textContent = '担当者を変更';
  const staffList = getAllActiveStaff();
  items.innerHTML = `
    <div class="context-menu-item" onclick="window.memberApp.contextAssignTrial('${trialId}', '')">
      <span class="material-icons" style="font-size:16px">person_off</span> 未割当にする
    </div>
    ${staffList.map(s => `
      <div class="context-menu-item ${trial.assigned_to === s.id ? 'active' : ''}"
           onclick="window.memberApp.contextAssignTrial('${trialId}', '${s.id}')">
        <span class="material-icons" style="font-size:16px">person</span>
        ${escapeHtml(s.name)}${s.role !== 'スタッフ' ? ` <span style="font-size:0.75rem;color:var(--gray-400)">(${escapeHtml(s.role)})</span>` : ''}
      </div>`).join('')}`;

  menu.style.display = 'block';
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;

  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 8}px`;
    if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 8}px`;
  });
}

export async function contextAssignTrial(trialId, staffId) {
  const menu = document.getElementById('app-context-menu');
  if (menu) menu.style.display = 'none';
  await assignTrial(trialId, staffId || null);
}

export function openTrialHistory(id, label) {
  openAppHistory(id, label);
}

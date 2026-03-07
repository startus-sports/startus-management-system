// --- 申請管理 ---

import { supabase } from './supabase.js';
import { escapeHtml } from './utils.js';
import { showToast, openModal, closeModal, setModalWide } from './app.js';
import { getClassrooms, getActiveClassrooms } from './classroom.js';
import { updateTabBadges } from './notifications.js';
import { logActivity, openApplicationHistory as openAppHistory } from './history.js';
import { getJimukyokuStaff, getStaffById, getAllActiveStaff } from './staff.js';
import { sendTaskMessage } from './chat.js';

// --- 定数 ---

const APP_TYPE_LABELS = {
  join: '入会', withdrawal: '退会', suspension: '休会',
  reinstatement: '復会', change: '変更',
};

const APP_TYPE_ICONS = {
  join: 'person_add', withdrawal: 'person_remove', suspension: 'pause_circle',
  reinstatement: 'play_circle', change: 'edit_note',
};

const APP_STATUS_LABELS = {
  pending: '未対応', reviewed: '確認済み', approved: '承認', rejected: '却下',
};

const APP_STATUS_BADGE = {
  pending: 'badge-app-pending', reviewed: 'badge-app-reviewed',
  approved: 'badge-app-approved', rejected: 'badge-app-rejected',
};

// 申請タイプ別のフォームデータ表示フィールド（GASフォーム送信内容に合わせた定義）
const APP_FIELDS = {
  join: [
    { key: 'name', label: '氏名' },
    { key: 'furigana', label: 'フリガナ' },
    { key: 'birthdate', label: '生年月日' },
    { key: 'gender', label: '性別' },
    { key: 'grade', label: '学年' },
    { key: 'school', label: '学校' },
    { key: 'guardian_name', label: '保護者名' },
    { key: 'guardian_kana', label: '保護者フリガナ' },
    { key: 'phone', label: '電話番号①' },
    { key: 'phone_relation', label: '電話番号①続柄' },
    { key: 'phone2', label: '電話番号②' },
    { key: 'phone2_relation', label: '電話番号②続柄' },
    { key: 'email', label: 'メール' },
    { key: 'zipcode', label: '郵便番号' },
    { key: 'address', label: '住所' },
    { key: 'desired_classes', label: '入会教室' },
    { key: 'trial_date', label: '体験日' },
    { key: 'first_date', label: '初回参加予定日' },
    { key: 'family_status', label: '家族の入会状況' },
    { key: 'disability_info', label: '身体状況' },
    { key: 'note', label: '備考' },
  ],
  withdrawal: [
    { key: 'name', label: '氏名' },
    { key: 'furigana', label: 'フリガナ' },
    { key: 'guardian_name', label: '保護者名' },
    { key: 'guardian_kana', label: '保護者フリガナ' },
    { key: 'email', label: 'メール' },
    { key: 'desired_classes', label: '退会教室' },
    { key: 'last_date', label: '最終参加予定日' },
    { key: 'reason', label: '退会理由' },
    { key: 'note', label: '備考' },
  ],
  suspension: [
    { key: 'name', label: '氏名' },
    { key: 'furigana', label: 'フリガナ' },
    { key: 'guardian_name', label: '保護者名' },
    { key: 'email', label: 'メール' },
    { key: 'desired_classes', label: '対象教室' },
    { key: 'start_date', label: '休会開始予定日' },
    { key: 'return_date', label: '復会予定日' },
    { key: 'reason', label: '休会理由' },
    { key: 'note', label: '備考' },
  ],
  reinstatement: [
    { key: 'name', label: '氏名' },
    { key: 'furigana', label: 'フリガナ' },
    { key: 'guardian_name', label: '保護者名' },
    { key: 'email', label: 'メール' },
    { key: 'desired_classes', label: '対象教室' },
    { key: 'start_date', label: '休会開始予定日' },
    { key: 'return_date', label: '復会予定日' },
    { key: 'reason', label: '理由' },
    { key: 'note', label: '備考' },
  ],
  change: [
    { key: 'name', label: '氏名' },
    { key: 'furigana', label: 'フリガナ' },
    { key: 'guardian_name', label: '保護者名' },
    { key: 'email', label: 'メール' },
    { key: 'phone', label: '電話番号' },
    { key: 'desired_classes', label: '教室' },
    { key: 'change_content', label: '変更内容' },
    { key: 'note', label: '備考' },
  ],
};

// 申請タイプ別チェック項目（2段階: reception=受付, approval=承認）
const APP_CHECKLIST_ITEMS = {
  join: {
    reception: [
      { key: 'info_confirm',    label: '申請情報確認' },
      { key: 'contact_confirm', label: '連絡先確認' },
      { key: 'receipt',         label: '届出受付' },
      { key: 'trial_confirm',   label: '体験参加確認' },
    ],
    approval: [
      { key: 'member_register',  label: '会員情報登録', action: 'register_member' },
      { key: 'class_add',        label: '教室追加',     action: 'add_to_class' },
      { key: 'staff_contact',    label: '担当者連絡' },
      { key: 'attendance',       label: '出席簿登録' },
      { key: 'sugram',           label: 'スグラム登録' },
      { key: 'sports_insurance', label: 'スポ安登録' },
    ],
  },
  withdrawal: {
    reception: [
      { key: 'info_confirm',    label: '申請情報確認' },
      { key: 'contact_confirm', label: '連絡先確認' },
      { key: 'receipt',         label: '届出受付' },
      { key: 'reason_confirm',  label: '退会理由確認' },
    ],
    approval: [
      { key: 'member_status_update', label: '会員ステータス変更', action: 'update_member_status' },
      { key: 'class_remove',         label: '教室解除',           action: 'remove_from_class' },
      { key: 'staff_contact',        label: '担当者連絡' },
      { key: 'attendance',           label: '出席簿登録/解除' },
      { key: 'sugram',               label: 'スグラム登録/解除' },
      { key: 'sports_insurance',     label: 'スポ安登録/解除' },
    ],
  },
  suspension: {
    reception: [
      { key: 'info_confirm',    label: '申請情報確認' },
      { key: 'contact_confirm', label: '連絡先確認' },
      { key: 'receipt',         label: '届出受付' },
      { key: 'reason_confirm',  label: '休会理由確認' },
    ],
    approval: [
      { key: 'member_status_update', label: '会員ステータス変更', action: 'update_member_status' },
      { key: 'staff_contact',        label: '担当者連絡' },
      { key: 'attendance',           label: '出席簿登録/解除' },
      { key: 'sugram',               label: 'スグラム登録/解除' },
      { key: 'sports_insurance',     label: 'スポ安登録/解除' },
    ],
  },
  reinstatement: {
    reception: [
      { key: 'info_confirm',    label: '申請情報確認' },
      { key: 'contact_confirm', label: '連絡先確認' },
      { key: 'receipt',         label: '届出受付' },
    ],
    approval: [
      { key: 'member_status_update', label: '会員ステータス変更', action: 'update_member_status' },
      { key: 'class_add',            label: '教室追加',           action: 'add_to_class' },
      { key: 'staff_contact',        label: '担当者連絡' },
      { key: 'attendance',           label: '出席簿登録/解除' },
      { key: 'sugram',               label: 'スグラム登録/解除' },
      { key: 'sports_insurance',     label: 'スポ安登録/解除' },
    ],
  },
  change: {
    reception: [
      { key: 'info_confirm',    label: '申請情報確認' },
      { key: 'contact_confirm', label: '連絡先確認' },
      { key: 'receipt',         label: '届出受付' },
    ],
    approval: [
      { key: 'member_info_update',   label: '会員情報更新',       action: 'update_member_info' },
      { key: 'staff_contact',        label: '担当者連絡' },
      { key: 'attendance',           label: '出席簿登録' },
      { key: 'sugram',               label: 'スグラム登録' },
      { key: 'sports_insurance',     label: 'スポ安登録' },
    ],
  },
};

// フィールドごとの入力タイプ定義（GASフォーム送信内容に合わせた定義）
const FIELD_INPUT_TYPES = {
  gender: { type: 'select', options: ['男', '女'] },
  birthdate: { type: 'date' },
  desired_classes: { type: 'checkbox-group' },
  note: { type: 'textarea' },
  reason: { type: 'textarea' },
  disability_info: { type: 'textarea' },
  change_content: { type: 'textarea' },
};

// 対象タイプ（体験は trials.js が担当）
const TARGET_TYPES = ['join', 'withdrawal', 'suspension', 'reinstatement', 'change'];

// --- チェックリスト ヘルパー ---

// 全フェーズの定義を1つの配列に展開
function getAllChecklistDefs(type) {
  const phases = APP_CHECKLIST_ITEMS[type];
  if (!phases) return [];
  const defs = [];
  for (const [phase, items] of Object.entries(phases)) {
    for (const item of items) {
      defs.push({ ...item, phase });
    }
  }
  return defs;
}

// 特定フェーズの定義を取得
function getPhaseChecklistDefs(type, phase) {
  return APP_CHECKLIST_ITEMS[type]?.[phase] || [];
}

function initializeChecklist(type) {
  const defs = getAllChecklistDefs(type);
  if (defs.length === 0) return null;
  return {
    items: defs.map(def => ({
      key: def.key,
      phase: def.phase,
      checked: false,
      checked_at: null,
      checked_by: null,
    })),
  };
}

// フェーズ指定なし: 全体の進捗
function getChecklistProgress(checklist, type, phase) {
  const defs = phase ? getPhaseChecklistDefs(type, phase) : getAllChecklistDefs(type);
  if (defs.length === 0 || !checklist || !checklist.items) return null;
  const total = defs.length;
  const defKeys = new Set(defs.map(d => d.key));
  const checked = checklist.items.filter(i => defKeys.has(i.key) && i.checked).length;
  return { checked, total };
}

// フェーズを取得（互換性: phaseがないアイテムは'approval'扱い）
function getItemPhase(item) {
  return item.phase || 'approval';
}

function formatShortDateTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${m}/${day} ${h}:${mi}`;
}

function extractName(email) {
  if (!email) return '';
  return email.split('@')[0];
}

function buildChecklistProgressBadge(app) {
  const defs = getAllChecklistDefs(app.type);
  const cl = app.checklist;
  if (defs.length === 0 || !cl || !cl.items) return '';
  const checked = cl.items.filter(i => i.checked).length;
  const total = defs.length;
  if (checked === 0) return '';
  if (checked < total) {
    return `<span class="badge badge-checklist-partial"><span class="material-icons" style="font-size:12px">checklist</span>${checked}/${total}</span>`;
  }
  return `<span class="badge badge-checklist-done"><span class="material-icons" style="font-size:12px">task_alt</span>${checked}/${total}</span>`;
}

// --- データ ---

let allApplications = [];
let filteredApplications = [];

export function getFilteredApplications() { return filteredApplications; }

let appFilters = {
  types: [],
  status: [],
  classes: [],
  assignee: [],
  query: '',
};
let appSortKey = 'created_desc';

// --- データ読み込み ---

async function loadApplicationData() {
  const { data, error } = await supabase
    .from('applications')
    .select('*')
    .in('type', TARGET_TYPES)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('申請データ取得エラー:', error);
    return;
  }
  allApplications = data || [];
}

// --- フィルタ ---

function applyAppFilters() {
  let result = [...allApplications];

  if (appFilters.types.length > 0) {
    result = result.filter(a => appFilters.types.includes(a.type));
  }

  if (appFilters.status.length > 0) {
    result = result.filter(a => appFilters.status.includes(a.status));
  }

  if (appFilters.classes.length > 0) {
    result = result.filter(a => {
      const fd = a.form_data || {};
      const cls = Array.isArray(fd.desired_classes) ? fd.desired_classes : (fd.desired_classes || fd.classroom || '').split(/[,・]/).filter(Boolean);
      return cls.some(c => appFilters.classes.includes(c));
    });
  }

  if (appFilters.assignee.length > 0) {
    result = result.filter(a => {
      if (appFilters.assignee.includes('unassigned') && !a.assigned_to) return true;
      if (a.assigned_to && appFilters.assignee.includes(a.assigned_to)) return true;
      return false;
    });
  }

  if (appFilters.query) {
    const q = appFilters.query.toLowerCase();
    result = result.filter(a => {
      const fd = a.form_data || {};
      return (fd.name || '').toLowerCase().includes(q) ||
        (fd.furigana || '').toLowerCase().includes(q) ||
        (fd.member_number || '').toLowerCase().includes(q) ||
        (fd.email || '').toLowerCase().includes(q);
    });
  }

  // ソート
  const STATUS_ORDER = { pending: 0, reviewed: 1, approved: 2, rejected: 3 };
  result.sort((a, b) => {
    switch (appSortKey) {
      case 'created_asc': return new Date(a.created_at) - new Date(b.created_at);
      case 'name': return ((a.form_data?.name || '').localeCompare((b.form_data?.name || ''), 'ja'));
      case 'type': return (a.type || '').localeCompare(b.type || '');
      case 'status': return (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
      case 'created_desc':
      default: return new Date(b.created_at) - new Date(a.created_at);
    }
  });

  filteredApplications = result;
  updateAppFilterBadge();
}

function updateAppFilterBadge() {
  const count = appFilters.types.length + appFilters.status.length + appFilters.classes.length + appFilters.assignee.length;
  const btn = document.getElementById('app-filter-toggle');
  if (!btn) return;
  const existing = btn.querySelector('.filter-badge');
  if (existing) existing.remove();
  btn.classList.toggle('has-filters', count > 0);
  if (count > 0) {
    btn.insertAdjacentHTML('beforeend', `<span class="filter-badge">${count}</span>`);
  }
}

export function resetAppFilters() {
  appFilters = { types: [], status: [], classes: [], assignee: [], query: '' };
  // UIのチェックボックスをリセット
  document.querySelectorAll('#app-filter-panel input[type="checkbox"]').forEach(cb => { cb.checked = false; });
  const searchInput = document.getElementById('app-search-input');
  if (searchInput) searchInput.value = '';
  applyAppFilters();
  renderAppListOnly();
}

export function initAppSort() {
  const sel = document.getElementById('app-sort-select');
  if (sel) {
    sel.value = appSortKey;
    sel.addEventListener('change', () => {
      appSortKey = sel.value;
      applyAppFilters();
      renderAppListOnly();
    });
  }
}

// --- グリッドヘッダー ---

const APP_GRID_HEADER = `
  <div class="app-grid-header">
    <span>氏名</span>
    <span>種別</span>
    <span>教室/会員番号</span>
    <span>ステータス</span>
    <span>担当</span>
    <span>連絡先</span>
    <span>受付日</span>
    <span></span>
  </div>`;

function buildAppGridRow(a) {
  const fd = a.form_data || {};
  const typeLabel = APP_TYPE_LABELS[a.type] || a.type;
  const typeIcon = APP_TYPE_ICONS[a.type] || 'description';
  const statusLabel = APP_STATUS_LABELS[a.status] || a.status;
  const badgeClass = APP_STATUS_BADGE[a.status] || '';
  const createdDate = formatShortDate(a.created_at);
  const classes = Array.isArray(fd.desired_classes) ? fd.desired_classes.join('・') : fd.desired_classes || '';
  const assigneeName = a.assigned_to ? (getStaffById(a.assigned_to)?.name || '') : '';

  return `
    <div class="list-item" data-status="${a.status}" onclick="window.memberApp.showApplicationDetail('${a.id}')">
      <div class="grid-cell grid-cell-name">
        <span class="material-icons" style="font-size:18px;color:var(--gray-400);flex-shrink:0">${typeIcon}</span>
        <strong>${escapeHtml(fd.name || '（名前なし）')}</strong>
      </div>
      <div class="grid-cell">
        <span class="badge badge-app-type">${escapeHtml(typeLabel)}</span>
      </div>
      <div class="grid-cell">
        ${classes ? `<span class="badge badge-class">${escapeHtml(classes)}</span>` : ''}
        ${fd.member_number ? `<span style="font-size:0.82rem;color:var(--gray-500)">${escapeHtml(fd.member_number)}</span>` : ''}
      </div>
      <div class="grid-cell grid-cell-badges">
        <span class="badge ${badgeClass}">${escapeHtml(statusLabel)}</span>
        ${buildChecklistProgressBadge(a)}
      </div>
      <div class="grid-cell grid-cell-assignee">
        ${assigneeName ? `<span class="badge badge-assignee">${escapeHtml(assigneeName)}</span>` : ''}
      </div>
      <div class="grid-cell grid-cell-contact">
        ${fd.phone ? `<span>${escapeHtml(fd.phone)}</span>` : ''}
        ${fd.email ? `<span>${escapeHtml(fd.email)}</span>` : ''}
      </div>
      <div class="grid-cell grid-cell-date">${escapeHtml(createdDate)}</div>
      <div class="grid-cell grid-cell-arrow">
        <span class="material-icons list-item-arrow">chevron_right</span>
      </div>
    </div>`;
}

// --- ワークロード表示 ---

function buildAppWorkloadSummary() {
  const allStaff = getAllActiveStaff();
  const active = allApplications.filter(a => a.status !== 'approved' && a.status !== 'rejected');

  let unassigned = 0;
  const counts = {};
  allStaff.forEach(s => { counts[s.id] = 0; });

  active.forEach(a => {
    if (!a.assigned_to) {
      unassigned++;
    } else if (counts[a.assigned_to] !== undefined) {
      counts[a.assigned_to]++;
    }
  });

  const isActive = (val) => appFilters.assignee.includes(val) ? ' active' : '';
  const countClass = (n) => n > 0 ? 'workload-count' : 'workload-count workload-count-zero';

  let html = `<div class="workload-card${isActive('unassigned')}" onclick="window.memberApp.toggleAppWorkloadFilter('unassigned')">
    <span class="material-icons" style="font-size:16px;color:var(--gray-400)">person_off</span>
    未割当 <span class="${countClass(unassigned)}">${unassigned}</span>
  </div>`;

  // ワークロードがあるスタッフのみ表示（ゼロ件の事務局は常時表示）
  allStaff.forEach(s => {
    const c = counts[s.id] || 0;
    if (c === 0 && s.role !== '事務局') return;
    const roleIcon = s.role === '事務局' ? 'admin_panel_settings' : 'person';
    html += `<div class="workload-card${isActive(s.id)}" onclick="window.memberApp.toggleAppWorkloadFilter('${s.id}')">
      <span class="material-icons" style="font-size:16px;color:var(--primary-color)">${roleIcon}</span>
      ${escapeHtml(s.name)} <span class="${countClass(c)}">${c}</span>
    </div>`;
  });

  return html;
}

export function toggleAppWorkloadFilter(value) {
  const container = document.getElementById('app-assignee-filter');
  if (appFilters.assignee.includes(value)) {
    appFilters.assignee = appFilters.assignee.filter(v => v !== value);
  } else {
    appFilters.assignee = [value];
  }

  // フィルタパネルのチェックボックスも同期
  if (container) {
    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = appFilters.assignee.includes(cb.value);
    });
  }

  applyAppFilters();
  renderAppListOnly();
}

// --- 一覧レンダリング ---

export async function renderApplicationList() {
  await loadApplicationData();
  applyAppFilters();

  const workloadEl = document.getElementById('app-workload');
  if (workloadEl) workloadEl.innerHTML = buildAppWorkloadSummary();

  const listEl = document.getElementById('app-list');
  if (!listEl) return;

  const countEl = document.getElementById('app-count');
  if (countEl) {
    const total = allApplications.length;
    const shown = filteredApplications.length;
    countEl.textContent = total === shown ? `${shown}件` : `${total}件中 ${shown}件表示`;
  }

  if (filteredApplications.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <span class="material-icons empty-icon">description</span>
        <p>申請データがありません</p>
      </div>`;
    return;
  }

  listEl.innerHTML = APP_GRID_HEADER + filteredApplications.map(buildAppGridRow).join('');
}

// --- ワークフローステッパー ---

function buildWorkflowStepper(app) {
  const status = typeof app === 'string' ? app : app.status;
  const steps = [
    { key: 'pending',    label: '申込',       icon: 'inbox' },
    { key: 'reception',  label: '受付',       icon: 'fact_check' },
    { key: 'processing', label: '事務局処理', icon: 'settings' },
    { key: 'approved',   label: '承認',       icon: 'check_circle' },
  ];

  // ステータスからステップインデックスを決定
  let currentIndex = 0;
  const isRejected = status === 'rejected';
  if (!isRejected) {
    if (status === 'pending') currentIndex = 1;       // 受付フェーズ
    else if (status === 'reviewed') currentIndex = 2;  // 事務局処理フェーズ
    else if (status === 'approved') currentIndex = 4;  // 全完了
  }

  let html = '<div class="workflow-stepper">';

  steps.forEach((step, i) => {
    if (i > 0) {
      const connDone = !isRejected && currentIndex > i;
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

export async function showApplicationDetail(id) {
  const app = allApplications.find(a => a.id === id);
  if (!app) return;

  setModalWide(true);

  const fd = app.form_data || {};
  const typeLabel = APP_TYPE_LABELS[app.type] || app.type;
  const statusLabel = APP_STATUS_LABELS[app.status] || app.status;
  const badgeClass = APP_STATUS_BADGE[app.status] || '';
  const fields = APP_FIELDS[app.type] || [];

  // 全幅表示するフィールド（長文テキスト系）
  const fullWidthKeys = new Set(['address', 'disability_info', 'note', 'reason', 'omoi', 'route_detail', 'change_content', 'family_status']);

  // フォームデータ表示
  const detailRows = fields.map(f => {
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

  // form_data内の未定義フィールドも表示
  const definedKeys = new Set(fields.map(f => f.key));
  const extraRows = Object.entries(fd)
    .filter(([key]) => !definedKeys.has(key) && fd[key])
    .map(([key, val]) => {
      if (Array.isArray(val)) val = val.join('・');
      return `
        <div class="detail-row detail-row-full">
          <span class="detail-label">${escapeHtml(key)}</span>
          <span class="detail-value">${escapeHtml(String(val))}</span>
        </div>`;
    }).join('');

  // 受付担当者名
  const receptionStaffId = app.reception_staff_id || (app.status === 'pending' ? app.assigned_to : null);
  const receptionStaffName = receptionStaffId ? (getStaffById(receptionStaffId)?.name || '') : '';

  const content = `
    ${buildWorkflowStepper(app)}

    <div class="app-detail-header">
      <div class="detail-row">
        <span class="detail-label">申請種別</span>
        <span class="detail-value"><span class="badge badge-app-type">${escapeHtml(typeLabel)}</span></span>
      </div>
      <div class="detail-row">
        <span class="detail-label">受付日時</span>
        <span class="detail-value">${escapeHtml(formatDateTime(app.created_at))}</span>
      </div>
      ${app.reviewed_at ? `
      <div class="detail-row">
        <span class="detail-label">受付完了日時</span>
        <span class="detail-value">${escapeHtml(formatDateTime(app.reviewed_at))}${app.reviewed_by ? ` (${escapeHtml(extractName(app.reviewed_by))})` : ''}</span>
      </div>` : ''}
      ${app.processed_at ? `
      <div class="detail-row">
        <span class="detail-label">承認日時</span>
        <span class="detail-value">${escapeHtml(formatDateTime(app.processed_at))}${app.processed_by ? ` (${escapeHtml(extractName(app.processed_by))})` : ''}</span>
      </div>` : ''}
      <div class="detail-row">
        <span class="detail-label"><span class="material-icons" style="font-size:16px;vertical-align:middle">person_pin</span> 受付担当</span>
        <span class="detail-value">
          ${app.status === 'pending' ? `
          <select class="assignee-select" onchange="window.memberApp.assignApplication('${app.id}', this.value)">
            <option value="">-- 未割当 --</option>
            ${getAllActiveStaff().map(s =>
              `<option value="${s.id}" ${app.assigned_to === s.id ? 'selected' : ''}>${escapeHtml(s.name)}${s.role !== 'スタッフ' ? ` (${escapeHtml(s.role)})` : ''}</option>`
            ).join('')}
          </select>` : `
          <span class="badge badge-assignee">${receptionStaffName ? escapeHtml(receptionStaffName) : '未割当'}</span>`}
        </span>
      </div>
      ${app.status !== 'pending' ? `
      <div class="detail-row">
        <span class="detail-label"><span class="material-icons" style="font-size:16px;vertical-align:middle">admin_panel_settings</span> 承認担当</span>
        <span class="detail-value">
          ${app.status === 'reviewed' ? `
          <select class="assignee-select" onchange="window.memberApp.assignApplication('${app.id}', this.value)">
            <option value="">-- 未割当 --</option>
            ${getJimukyokuStaff().map(s =>
              `<option value="${s.id}" ${app.assigned_to === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
            ).join('')}
          </select>` : `
          <span class="badge badge-assignee">${app.assigned_to ? escapeHtml(getStaffById(app.assigned_to)?.name || '') : '未割当'}</span>`}
        </span>
      </div>` : ''}
    </div>

    <div class="app-detail-section" id="app-content-section">
      <div class="app-detail-section-header" id="app-content-header">
        <span class="material-icons" style="font-size:18px">description</span> 申請内容
        <span style="margin-left:auto;display:flex;gap:4px">
          <button class="btn btn-secondary" style="padding:2px 8px;font-size:0.75rem" onclick="window.memberApp.openApplicationEditForm('${app.id}')">
            <span class="material-icons" style="font-size:14px">edit</span>編集
          </button>
          <button class="btn btn-secondary" style="padding:2px 8px;font-size:0.75rem" onclick="window.memberApp.openApplicationHistory('${app.id}', '${escapeHtml(fd.name || '')} ${escapeHtml(typeLabel)}申請')">
            <span class="material-icons" style="font-size:14px">history</span>履歴
          </button>
        </span>
      </div>
      <div class="detail-grid" id="app-content-grid">
        ${detailRows}
        ${extraRows}
      </div>
    </div>

    ${buildPhaseChecklistSection(app, 'reception', '受付チェック', 'fact_check')}
    ${app.status === 'pending' ? buildReceptionCompleteButton(app) : ''}
    ${app.status !== 'pending' ? buildPhaseChecklistSection(app, 'approval', '承認チェック（事務局）', 'admin_panel_settings') : ''}

    <div class="app-detail-section">
      <div class="app-detail-section-header">
        <span class="material-icons" style="font-size:18px">note</span> メモ
      </div>
      <textarea id="app-admin-note" rows="2" class="admin-note-textarea" placeholder="事務局メモ...">${escapeHtml(app.admin_note || '')}</textarea>
      <div style="text-align:right;margin-top:6px">
        <button class="btn btn-secondary" style="padding:4px 12px;font-size:0.8rem" onclick="window.memberApp.saveApplicationAdminNote('${app.id}')">
          <span class="material-icons" style="font-size:16px">save</span>メモ保存
        </button>
      </div>
    </div>

    ${buildActionButtons(app)}

    <div style="text-align:center;margin-top:12px">
      <button class="btn" style="color:var(--gray-400);font-size:0.8rem" onclick="window.memberApp.deleteApplication('${app.id}')">
        <span class="material-icons" style="font-size:16px">delete</span>この申請データを削除
      </button>
    </div>`;

  openModal(`${typeLabel}申請 詳細`, content);
}

// --- チェックリスト UI ---

// アクションボタンのアイコンマッピング
const ACTION_ICONS = {
  register_member: 'person_add',
  add_to_class: 'school',
  update_member_status: 'swap_horiz',
  remove_from_class: 'remove_circle_outline',
  update_member_info: 'open_in_new',
};

function buildPhaseChecklistSection(app, phase, title, icon) {
  const defs = getPhaseChecklistDefs(app.type, phase);
  if (defs.length === 0) return '';

  const cl = app.checklist || initializeChecklist(app.type);
  const progress = getChecklistProgress(cl, app.type, phase);
  const progressPct = progress ? Math.round((progress.checked / progress.total) * 100) : 0;
  const allDone = progress && progress.checked === progress.total;

  const checkItems = defs.map(def => {
    const item = cl.items?.find(i => i.key === def.key) || { checked: false };
    const checkedClass = item.checked ? 'checklist-item-done' : '';
    const checkedIcon = item.checked ? 'check_box' : 'check_box_outline_blank';
    const checkedInfo = item.checked && item.checked_at
      ? `<span class="checklist-item-info">${formatShortDateTime(item.checked_at)} ${escapeHtml(extractName(item.checked_by))}</span>`
      : '';
    const actionBtn = def.action && !item.checked
      ? `<button class="btn btn-action-auto" onclick="event.stopPropagation();window.memberApp.executeChecklistAction('${app.id}','${def.action}','${def.key}')">
          <span class="material-icons" style="font-size:14px">${ACTION_ICONS[def.action] || 'play_arrow'}</span>実行
        </button>`
      : '';
    return `
      <div class="checklist-item ${checkedClass}" onclick="window.memberApp.toggleChecklistItem('${app.id}', '${def.key}')">
        <span class="material-icons checklist-checkbox">${checkedIcon}</span>
        <span class="checklist-item-label">${escapeHtml(def.label)}</span>
        ${checkedInfo}
        ${actionBtn}
      </div>`;
  }).join('');

  return `
    <div class="app-detail-section">
      <div class="app-detail-section-header">
        <span class="material-icons" style="font-size:18px">${icon}</span> ${title}
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

function buildReceptionCompleteButton(app) {
  if (app.status !== 'pending') return '';

  const cl = app.checklist || initializeChecklist(app.type);
  const progress = getChecklistProgress(cl, app.type, 'reception');
  const allChecked = progress && progress.checked === progress.total;

  return `
    <div class="reception-complete-section">
      <button class="btn btn-primary btn-reception-complete"
              ${allChecked ? '' : 'disabled'}
              onclick="window.memberApp.completeReception('${app.id}')">
        <span class="material-icons">fact_check</span>
        受付完了 → 事務局に引き継ぐ
      </button>
      ${!allChecked ? '<p class="hint-text">全ての受付チェック項目を完了してください</p>' : ''}
    </div>`;
}

function buildActionButtons(app) {
  const cl = app.checklist || initializeChecklist(app.type);
  const progress = getChecklistProgress(cl, app.type, 'approval');
  const hasUnchecked = progress && progress.checked < progress.total;

  let buttons = '';

  if (app.status === 'pending') {
    buttons = `
      <button class="btn btn-danger" onclick="window.memberApp.updateApplicationStatus('${app.id}', 'rejected')">
        <span class="material-icons">cancel</span>却下する
      </button>`;
  } else if (app.status === 'reviewed') {
    buttons = `
      <button class="btn btn-danger" onclick="window.memberApp.updateApplicationStatus('${app.id}', 'rejected')">
        <span class="material-icons">cancel</span>却下する
      </button>
      <button class="btn btn-primary" onclick="window.memberApp.approveWithChecklistWarning('${app.id}', ${!!hasUnchecked})">
        <span class="material-icons">done_all</span>承認する
      </button>`;
  } else if (app.status === 'rejected') {
    buttons = `
      <button class="btn btn-secondary" onclick="window.memberApp.updateApplicationStatus('${app.id}', 'pending')">
        <span class="material-icons">undo</span>未対応に戻す
      </button>`;
  } else if (app.status === 'approved') {
    buttons = `
      <button class="btn btn-secondary" onclick="window.memberApp.updateApplicationStatus('${app.id}', 'reviewed')">
        <span class="material-icons">undo</span>確認済みに戻す
      </button>`;
  }

  if (!buttons) return '';
  return `<div class="app-detail-actions">${buttons}</div>`;
}

// --- チェックリスト操作 ---

export async function toggleChecklistItem(appId, itemKey) {
  const app = allApplications.find(a => a.id === appId);
  if (!app) return;

  let cl = app.checklist || initializeChecklist(app.type);
  if (!cl) return;

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
    .eq('id', appId);

  if (error) {
    console.error('チェックリスト更新エラー:', error);
    showToast('チェックリストの更新に失敗しました', 'error');
    return;
  }

  app.checklist = cl;

  // モーダル再描画（スクロール位置を維持）
  const modalBody = document.getElementById('modal-body');
  const scrollPos = modalBody?.scrollTop || 0;
  showApplicationDetail(appId);
  requestAnimationFrame(() => {
    if (modalBody) modalBody.scrollTop = scrollPos;
  });
}

export function approveWithChecklistWarning(appId, hasUnchecked) {
  if (hasUnchecked) {
    const content = `
      <div style="padding:8px 0">
        <p><span class="material-icons" style="font-size:20px;vertical-align:middle;color:var(--warning-color)">warning</span> 承認チェック未完了の項目があります。</p>
        <p style="font-size:0.85rem;color:var(--gray-500);margin-top:8px">すべてのチェック項目を完了せずに承認しますか？</p>
        <div class="form-actions" style="margin-top:24px">
          <button class="btn btn-secondary" onclick="window.memberApp.showApplicationDetail('${appId}')">戻る</button>
          <button class="btn btn-primary" onclick="window.memberApp.updateApplicationStatus('${appId}', 'approved')">
            <span class="material-icons">done_all</span>承認する
          </button>
        </div>
      </div>`;
    openModal('承認の確認', content);
  } else {
    updateApplicationStatus(appId, 'approved');
  }
}

// --- ステータス変更 ---

export async function updateApplicationStatus(id, newStatus) {
  const statusLabel = APP_STATUS_LABELS[newStatus] || newStatus;

  const updateData = { status: newStatus };
  if (newStatus === 'approved' || newStatus === 'rejected') {
    updateData.processed_at = new Date().toISOString();
    const { data: { session } } = await supabase.auth.getSession();
    updateData.processed_by = session?.user?.email || '';
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
  await renderApplicationList();
  updateTabBadges();
}

// --- メモ保存 ---

export async function saveApplicationAdminNote(id) {
  const input = document.getElementById('app-admin-note');
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
  const idx = allApplications.findIndex(a => a.id === id);
  if (idx >= 0) allApplications[idx].admin_note = input.value.trim();
}

// --- 削除 ---

export function deleteApplication(id) {
  const app = allApplications.find(a => a.id === id);
  if (!app) return;

  const fd = app.form_data || {};
  const name = fd.name || '（名前なし）';
  const typeLabel = APP_TYPE_LABELS[app.type] || app.type;

  const content = `
    <div style="padding:8px 0">
      <p>「${escapeHtml(name)}」の${escapeHtml(typeLabel)}申請を削除しますか？</p>
      <p style="color:var(--danger-color);font-size:0.85rem">この操作は元に戻せません</p>
      <div class="form-actions" style="margin-top:24px">
        <button class="btn btn-secondary" onclick="window.memberApp.closeModal()">キャンセル</button>
        <button class="btn btn-danger" onclick="window.memberApp.executeDeleteApplication('${id}')">
          <span class="material-icons">delete</span>削除
        </button>
      </div>
    </div>`;

  openModal('申請データの削除', content);
}

export async function executeDeleteApplication(id) {
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
  await renderApplicationList();
  updateTabBadges();
}

// --- フィルタUI初期化 ---

export function initAppFilters() {
  // 検索
  const searchInput = document.getElementById('app-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      appFilters.query = searchInput.value.trim();
      applyAppFilters();
      renderAppListOnly();
    });
  }

  // 種別フィルタ
  const typeContainer = document.getElementById('app-type-filter');
  if (typeContainer) {
    typeContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        appFilters.types = Array.from(typeContainer.querySelectorAll('input:checked')).map(c => c.value);
        applyAppFilters();
        renderAppListOnly();
      });
    });
  }

  // ステータスフィルタ
  const statusContainer = document.getElementById('app-status-filter');
  if (statusContainer) {
    statusContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        appFilters.status = Array.from(statusContainer.querySelectorAll('input:checked')).map(c => c.value);
        applyAppFilters();
        renderAppListOnly();
      });
    });
  }

  // 教室フィルタ
  updateAppClassFilter();

  // 担当者フィルタ
  updateAppAssigneeFilter();
}

function updateAppClassFilter() {
  const container = document.getElementById('app-class-filter');
  if (!container) return;

  const classrooms = getActiveClassrooms();
  container.innerHTML = classrooms.map(c =>
    `<label class="filter-pill"><input type="checkbox" value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</label>`
  ).join('');

  container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      appFilters.classes = Array.from(container.querySelectorAll('input:checked')).map(c => c.value);
      applyAppFilters();
      renderAppListOnly();
    });
  });
}

function updateAppAssigneeFilter() {
  const container = document.getElementById('app-assignee-filter');
  if (!container) return;

  const staff = getAllActiveStaff();
  let html = '<label class="filter-pill"><input type="checkbox" value="unassigned">未割当</label>';
  html += staff.map(s =>
    `<label class="filter-pill"><input type="checkbox" value="${s.id}">${escapeHtml(s.name)}</label>`
  ).join('');
  container.innerHTML = html;

  container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      appFilters.assignee = Array.from(container.querySelectorAll('input:checked')).map(c => c.value);
      applyAppFilters();
      renderAppListOnly();
    });
  });
}

// リストだけ再描画（データ再取得なし）
function renderAppListOnly() {
  const workloadEl = document.getElementById('app-workload');
  if (workloadEl) workloadEl.innerHTML = buildAppWorkloadSummary();

  const listEl = document.getElementById('app-list');
  if (!listEl) return;

  const countEl = document.getElementById('app-count');
  if (countEl) {
    const total = allApplications.length;
    const shown = filteredApplications.length;
    countEl.textContent = total === shown ? `${shown}件` : `${total}件中 ${shown}件表示`;
  }

  if (filteredApplications.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <span class="material-icons empty-icon">description</span>
        <p>条件に一致する申請データがありません</p>
      </div>`;
    return;
  }

  listEl.innerHTML = APP_GRID_HEADER + filteredApplications.map(buildAppGridRow).join('');
}

export function toggleAppFilterPanel() {
  const panel = document.getElementById('app-filter-panel');
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

function buildAppFormField(field, value, classrooms) {
  const inputDef = FIELD_INPUT_TYPES[field.key] || { type: 'text' };
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
        <div class="classroom-checkboxes-scroll" id="app-edit-${key}-checkboxes">
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

  if (inputDef.type === 'date') {
    return `
      <div class="form-group">
        <label>${label}</label>
        <input type="date" name="${key}" value="${escapeHtml(value || '')}">
      </div>`;
  }

  if (inputDef.type === 'month') {
    return `
      <div class="form-group">
        <label>${label}</label>
        <input type="month" name="${key}" value="${escapeHtml(value || '')}">
      </div>`;
  }

  // デフォルト: text
  return `
    <div class="form-group">
      <label>${label}</label>
      <input type="text" name="${key}" value="${escapeHtml(value || '')}">
    </div>`;
}

export function openApplicationEditForm(id) {
  const app = allApplications.find(a => a.id === id);
  if (!app) return;

  const fd = app.form_data || {};
  const fields = APP_FIELDS[app.type] || [];
  const classrooms = getActiveClassrooms();

  // ヘッダーを編集モードに切り替え
  const header = document.getElementById('app-content-header');
  if (header) {
    header.innerHTML = `
      <span class="material-icons" style="font-size:18px">edit</span> 申請内容を編集
      <span style="margin-left:auto;display:flex;gap:4px">
        <button class="btn btn-secondary" style="padding:2px 8px;font-size:0.75rem" onclick="window.memberApp.showApplicationDetail('${id}')">
          キャンセル
        </button>
        <button class="btn btn-primary" style="padding:2px 8px;font-size:0.75rem" onclick="window.memberApp.saveApplicationEdit('${id}')">
          <span class="material-icons" style="font-size:14px">save</span>保存
        </button>
      </span>`;
  }

  // コンテンツをフォームフィールドに置き換え
  const grid = document.getElementById('app-content-grid');
  if (grid) {
    grid.innerHTML = fields.map(f => buildAppFormField(f, fd[f.key], classrooms)).join('');
  }
}

export async function saveApplicationEdit(id) {
  const app = allApplications.find(a => a.id === id);
  if (!app) return;

  const oldFormData = app.form_data || {};
  const type = app.type;
  const fields = APP_FIELDS[type] || [];
  const newFormData = { ...oldFormData };

  const grid = document.getElementById('app-content-grid');
  if (!grid) return;

  for (const field of fields) {
    const inputDef = FIELD_INPUT_TYPES[field.key] || { type: 'text' };

    if (inputDef.type === 'checkbox-group') {
      const checkboxes = grid.querySelectorAll(`#app-edit-${field.key}-checkboxes input[name="${field.key}_cb"]:checked`);
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
    console.error('申請編集保存エラー:', error);
    showToast('保存に失敗しました', 'error');
    return;
  }

  // 変更履歴を記録
  for (const field of fields) {
    const oldVal = Array.isArray(oldFormData[field.key]) ? oldFormData[field.key].join(', ') : (oldFormData[field.key] ?? '');
    const newVal = Array.isArray(newFormData[field.key]) ? newFormData[field.key].join(', ') : (newFormData[field.key] ?? '');
    if (String(oldVal) !== String(newVal)) {
      logActivity(null, 'app_edit', field.key, oldVal, newVal, id);
    }
  }

  // ローカルデータ更新
  const idx = allApplications.findIndex(a => a.id === id);
  if (idx >= 0) allApplications[idx].form_data = newFormData;

  showToast('申請内容を更新しました', 'success');

  // モーダル内で詳細を再表示（スクロール位置維持）
  const modalBody = document.getElementById('modal-body');
  const scrollPos = modalBody?.scrollTop || 0;
  showApplicationDetail(id);
  requestAnimationFrame(() => {
    if (modalBody) modalBody.scrollTop = scrollPos;
  });
  renderAppListOnly();
}

// --- 担当者割り当て ---

export async function assignApplication(id, staffId) {
  const app = allApplications.find(a => a.id === id);
  if (!app) return;

  const oldStaffName = app.assigned_to ? (getStaffById(app.assigned_to)?.name || '') : '';
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
  const idx = allApplications.findIndex(a => a.id === id);
  if (idx >= 0) allApplications[idx].assigned_to = assignValue;

  // 履歴記録
  logActivity(null, 'app_edit', 'assigned_to', oldStaffName, newStaffName, id);

  showToast(assignValue ? '担当者を設定しました' : '担当者を解除しました', 'success');

  // チャットにタスクメッセージ送信
  if (assignValue) {
    const fd = app.form_data || {};
    const typeLabel = APP_TYPE_LABELS[app.type] || app.type;
    const refLabel = `${fd.name || '（名前なし）'} ${typeLabel}申請`;
    sendTaskMessage(assignValue, 'application', id, refLabel, `${refLabel}の担当に割り当てられました`);
  }

  // モーダル再描画（スクロール位置維持）
  const modalBody = document.getElementById('modal-body');
  const scrollPos = modalBody?.scrollTop || 0;
  showApplicationDetail(id);
  requestAnimationFrame(() => {
    if (modalBody) modalBody.scrollTop = scrollPos;
  });
  renderAppListOnly();
}

// --- 受付完了フロー ---

function autoAssignToJimukyoku() {
  const jimukyoku = getJimukyokuStaff();
  if (jimukyoku.length === 0) return null;

  // reviewed状態の申請数が最も少ない事務局スタッフに割り当て
  const counts = {};
  jimukyoku.forEach(s => { counts[s.id] = 0; });

  allApplications
    .filter(a => a.status === 'reviewed')
    .forEach(a => {
      if (a.assigned_to && counts[a.assigned_to] !== undefined) {
        counts[a.assigned_to]++;
      }
    });

  let minId = jimukyoku[0].id;
  let minCount = counts[minId] ?? 0;

  for (const s of jimukyoku) {
    const c = counts[s.id] ?? 0;
    if (c < minCount) {
      minId = s.id;
      minCount = c;
    }
  }

  return minId;
}

export async function completeReception(appId) {
  const app = allApplications.find(a => a.id === appId);
  if (!app || app.status !== 'pending') return;

  // 受付チェック完了確認
  const cl = app.checklist || initializeChecklist(app.type);
  const progress = getChecklistProgress(cl, app.type, 'reception');
  if (!progress || progress.checked < progress.total) {
    showToast('受付チェック項目を全て完了してください', 'error');
    return;
  }

  // 事務局スタッフ自動選定
  const assigneeId = autoAssignToJimukyoku();
  if (!assigneeId) {
    showToast('事務局スタッフが見つかりません', 'error');
    return;
  }

  const { data: { session } } = await supabase.auth.getSession();
  const updateData = {
    status: 'reviewed',
    assigned_to: assigneeId,
    reception_staff_id: app.assigned_to || null,
    reviewed_at: new Date().toISOString(),
    reviewed_by: session?.user?.email || '',
  };

  const { error } = await supabase
    .from('applications')
    .update(updateData)
    .eq('id', appId);

  if (error) {
    console.error('受付完了エラー:', error);
    showToast('受付完了処理に失敗しました', 'error');
    return;
  }

  // ローカルデータ更新
  const idx = allApplications.findIndex(a => a.id === appId);
  if (idx >= 0) Object.assign(allApplications[idx], updateData);

  // 履歴記録
  logActivity(null, 'app_edit', 'status', '未対応', '確認済み（受付完了）', appId);

  // 事務局担当者にチャット通知
  const fd = app.form_data || {};
  const typeLabel = APP_TYPE_LABELS[app.type] || app.type;
  const refLabel = `${fd.name || '（名前なし）'} ${typeLabel}申請`;
  sendTaskMessage(assigneeId, 'application', appId, refLabel,
    `${refLabel}の受付が完了しました。承認処理をお願いします。`);

  showToast('受付完了。事務局に引き継ぎました。', 'success');
  closeModal();
  await renderApplicationList();
  updateTabBadges();
}

// --- 自動化ボタン ---

export async function executeChecklistAction(appId, action, itemKey) {
  const app = allApplications.find(a => a.id === appId);
  if (!app) return;

  try {
    switch (action) {
      case 'register_member':
        await actionRegisterMember(app);
        break;
      case 'add_to_class':
        await actionAddToClass(app);
        break;
      case 'update_member_status':
        await actionUpdateMemberStatus(app);
        break;
      case 'remove_from_class':
        await actionRemoveFromClass(app);
        break;
      case 'update_member_info':
        actionOpenMemberInfo(app);
        return; // チェック自動化しない（手動確認が必要）
      default:
        showToast('不明なアクションです', 'error');
        return;
    }

    // 成功したらチェックリストを自動チェック
    await toggleChecklistItem(appId, itemKey);
  } catch (err) {
    console.error('アクション実行エラー:', err);
    showToast(`処理に失敗しました: ${err.message}`, 'error');
  }
}

async function actionRegisterMember(app) {
  const fd = app.form_data || {};

  // 既に紐づいている場合はスキップ
  if (app.member_id) {
    showToast('既に会員が紐づいています', 'info');
    return;
  }

  const memberData = {
    name: fd.name || '',
    furigana: fd.furigana || '',
    member_type: '会員',
    status: '在籍',
    birthdate: fd.birthdate || null,
    gender: fd.gender || '',
    phone: fd.phone || '',
    email: fd.email || '',
    address: fd.address ? `${fd.zipcode ? fd.zipcode + ' ' : ''}${fd.address}` : '',
    classes: Array.isArray(fd.desired_classes) ? fd.desired_classes : (fd.desired_classes ? [fd.desired_classes] : []),
    grade: fd.grade || '',
    school: fd.school || '',
    guardian_name: fd.guardian_name || '',
    disability_info: fd.disability_info || '',
  };

  const { data, error } = await supabase.from('members').insert(memberData).select();
  if (error) throw new Error('会員登録に失敗: ' + error.message);

  if (data?.[0]) {
    await supabase.from('applications').update({ member_id: data[0].id }).eq('id', app.id);
    const idx = allApplications.findIndex(a => a.id === app.id);
    if (idx >= 0) allApplications[idx].member_id = data[0].id;
  }

  showToast('会員を登録しました', 'success');
}

async function actionAddToClass(app) {
  const fd = app.form_data || {};
  const targetClasses = Array.isArray(fd.desired_classes) ? fd.desired_classes : (fd.desired_classes ? [fd.desired_classes] : []);

  if (targetClasses.length === 0) {
    showToast('教室情報がありません', 'error');
    return;
  }

  const memberId = app.member_id;
  if (!memberId) {
    showToast('会員が紐づいていません。先に会員情報登録を実行してください。', 'error');
    return;
  }

  const { data: member, error: fetchErr } = await supabase.from('members').select('classes').eq('id', memberId).single();
  if (fetchErr) throw new Error('会員情報の取得に失敗');

  const currentClasses = member?.classes || [];
  const newClasses = [...new Set([...currentClasses, ...targetClasses])];

  const { error } = await supabase.from('members').update({ classes: newClasses }).eq('id', memberId);
  if (error) throw new Error('教室追加に失敗: ' + error.message);

  showToast('教室を追加しました', 'success');
}

async function actionUpdateMemberStatus(app) {
  const statusMap = {
    withdrawal: '退会',
    suspension: '休会',
    reinstatement: '在籍',
  };
  const newStatus = statusMap[app.type];
  if (!newStatus) {
    showToast('この申請種別ではステータス変更できません', 'error');
    return;
  }

  const memberId = app.member_id;
  if (!memberId) {
    // member_idがない場合、form_dataの名前で検索を試みる
    const fd = app.form_data || {};
    const { data: members } = await supabase.from('members')
      .select('id, name')
      .eq('name', fd.name)
      .limit(1);

    if (!members || members.length === 0) {
      showToast('対象の会員が見つかりません。会員を検索して手動で変更してください。', 'error');
      return;
    }

    // 見つかった会員を紐づけ
    await supabase.from('applications').update({ member_id: members[0].id }).eq('id', app.id);
    const idx = allApplications.findIndex(a => a.id === app.id);
    if (idx >= 0) allApplications[idx].member_id = members[0].id;

    const { error } = await supabase.from('members').update({ status: newStatus }).eq('id', members[0].id);
    if (error) throw new Error('ステータス変更に失敗: ' + error.message);
  } else {
    const { error } = await supabase.from('members').update({ status: newStatus }).eq('id', memberId);
    if (error) throw new Error('ステータス変更に失敗: ' + error.message);
  }

  showToast(`会員ステータスを「${newStatus}」に変更しました`, 'success');
}

async function actionRemoveFromClass(app) {
  const fd = app.form_data || {};
  const targetClasses = Array.isArray(fd.desired_classes) ? fd.desired_classes : (fd.desired_classes ? [fd.desired_classes] : []);

  const memberId = app.member_id;
  if (!memberId) {
    showToast('会員が紐づいていません', 'error');
    return;
  }

  const { data: member, error: fetchErr } = await supabase.from('members').select('classes').eq('id', memberId).single();
  if (fetchErr) throw new Error('会員情報の取得に失敗');

  const currentClasses = member?.classes || [];
  const newClasses = currentClasses.filter(c => !targetClasses.includes(c));

  const { error } = await supabase.from('members').update({ classes: newClasses }).eq('id', memberId);
  if (error) throw new Error('教室解除に失敗: ' + error.message);

  showToast('教室を解除しました', 'success');
}

function actionOpenMemberInfo(app) {
  // 変更申請の場合、会員画面に遷移するよう促す
  showToast('会員管理画面で対象会員の情報を手動で更新してください', 'info');
}

export { openAppHistory as openApplicationHistory };

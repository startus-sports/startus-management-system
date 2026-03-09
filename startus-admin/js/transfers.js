import { supabase } from './supabase.js';
import { escapeHtml } from './utils.js';
import { showToast, openModal, closeModal, setModalWide } from './app.js';
import { getActiveClassrooms } from './classroom.js';
import { updateTabBadges } from './notifications.js';
import { logActivity, openApplicationHistory as openAppHistory } from './history.js';
import { getJimukyokuStaff, getStaffById } from './staff.js';
import { sendTaskMessage } from './chat.js';

// --- 定数 ---

const TRANSFER_STATUS_LABELS = {
  pending: '申請中',
  approved: '確定',
  rejected: '却下'
};

const TRANSFER_STATUS_BADGE = {
  pending: 'badge-app-pending',
  approved: 'badge-app-approved',
  rejected: 'badge-app-rejected'
};

const TRANSFER_CHECKLIST_ITEMS = [
  { key: 'receipt',        label: '申請受付確認' },
  { key: 'staff_contact',  label: '担当者連絡' },
  { key: 'capacity_check', label: '定員確認' },
];

const TRANSFER_FIELDS = [
  { key: 'member_name',     label: '会員名' },
  { key: 'member_furigana', label: 'フリガナ' },
  { key: 'guardian_name',   label: '保護者名' },
  { key: 'email',           label: 'メール' },
  { key: 'phone',           label: '電話番号' },
  { key: 'source_class',    label: '所属教室' },
  { key: 'absent_class',    label: '休んだ教室' },
  { key: 'absent_date',     label: '休んだ日' },
  { key: 'transfer_class',  label: '振替先教室' },
  { key: 'transfer_date',   label: '振替希望日' },
  { key: 'note',            label: '備考' },
];

const TRANSFER_FIELD_INPUT_TYPES = {
  absent_date:    { type: 'date' },
  transfer_date:  { type: 'date' },
  note:           { type: 'textarea' },
};

// ビジネスルール: 振替元として不可の教室（月会費6,600円以下）
const INELIGIBLE_SOURCE_CLASSES = [
  '大人のマラソン塾',
  'インクルーシブ陸上',
  'キンボール',
  'ソーシャルフットボール',
  '春風クラブ',
];

// ビジネスルール: 振替先として不可の教室
const INELIGIBLE_DEST_CLASSES = [
  'キッズダンス', 'ヒップホップ',
  'キッズバレエ',
  'チアリーディング',
  'るぶげる親子陸上塾',
  'アイススケート',
];

const TRANSFER_DEADLINE_DAYS = 30;
const WARNING_DAYS_BEFORE = 7;

// --- チェックリスト ヘルパー ---

function initializeTransferChecklist() {
  return {
    items: TRANSFER_CHECKLIST_ITEMS.map(item => ({
      key: item.key,
      checked: false,
      checked_at: null,
      checked_by: null,
    })),
  };
}

function getTransferChecklistProgress(checklist) {
  if (!checklist || !checklist.items) return null;
  const total = TRANSFER_CHECKLIST_ITEMS.length;
  const checked = checklist.items.filter(i => i.checked).length;
  return { checked, total };
}

function formatShortDateTimeTransfer(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${m}/${day} ${h}:${mi}`;
}

function extractNameTransfer(email) {
  if (!email) return '';
  return email.split('@')[0];
}

function formatDateTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatShortDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// --- 日付パーサー ---
// GASフォーム: "2026/03/09 (月) 14:00" 形式
// 手動入力: "2026-03-09" 形式
// どちらからもDateオブジェクトを返す
function parseTransferDate(dateStr) {
  if (!dateStr) return null;
  // "YYYY/MM/DD" or "YYYY-MM-DD" を抽出
  const match = dateStr.match(/(\d{4})[\/\-](\d{2})[\/\-](\d{2})/);
  if (!match) return null;
  return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
}

// グリッド用の短い日付表示: "3/9(月)" 形式
function formatTransferDateShort(dateStr) {
  if (!dateStr) return '';
  const d = parseTransferDate(dateStr);
  if (!d) return dateStr;
  const dayMap = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getMonth() + 1}/${d.getDate()}(${dayMap[d.getDay()]})`;
}

// --- バリデーション警告 ---

function getTransferWarnings(fd) {
  const warnings = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 直前申請チェック: 振替希望日まで7日未満
  if (fd.transfer_date) {
    const transferDate = parseTransferDate(fd.transfer_date);
    if (transferDate) {
      transferDate.setHours(0, 0, 0, 0);
      const daysUntil = Math.ceil((transferDate - today) / (1000 * 60 * 60 * 24));
      if (daysUntil >= 0 && daysUntil < WARNING_DAYS_BEFORE) {
        warnings.push({ type: 'warning', label: '直前申請', detail: `振替日まで${daysUntil}日` });
      }
      if (daysUntil < 0) {
        warnings.push({ type: 'info', label: '振替日経過', detail: `振替日を過ぎています` });
      }
    }
  }

  // 期限チェック: 欠席日から振替日まで30日超
  if (fd.absent_date && fd.transfer_date) {
    const absentDate = parseTransferDate(fd.absent_date);
    const transferDate = parseTransferDate(fd.transfer_date);
    if (absentDate && transferDate) {
      absentDate.setHours(0, 0, 0, 0);
      transferDate.setHours(0, 0, 0, 0);
      const daysDiff = Math.ceil((transferDate - absentDate) / (1000 * 60 * 60 * 24));
      if (daysDiff > TRANSFER_DEADLINE_DAYS) {
        warnings.push({ type: 'danger', label: '期限超過', detail: `欠席日から${daysDiff}日経過（上限${TRANSFER_DEADLINE_DAYS}日）` });
      }
    }
  }

  // 振替元が対象外教室
  if (fd.absent_class && INELIGIBLE_SOURCE_CLASSES.some(c => fd.absent_class.includes(c))) {
    warnings.push({ type: 'danger', label: '振替不可教室', detail: `${fd.absent_class}は振替対象外です` });
  }

  // 振替先が不可教室
  if (fd.transfer_class && INELIGIBLE_DEST_CLASSES.some(c => fd.transfer_class.includes(c))) {
    warnings.push({ type: 'danger', label: '振替先不可', detail: `${fd.transfer_class}は振替先に指定できません` });
  }

  return warnings;
}

// --- データ ---

let allTransfers = [];
let filteredTransfers = [];

export function getFilteredTransfers() { return filteredTransfers; }

let transferFilters = {
  status: [],
  classes: [],
  assignee: [],
  query: '',
};
let transferSortKey = 'created_desc';

// --- データ読み込み ---

async function loadTransferData() {
  const { data, error } = await supabase
    .from('applications')
    .select('*')
    .eq('type', 'transfer')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('振替データ取得エラー:', error);
    return;
  }
  allTransfers = data || [];
}

// --- フィルタ・検索 ---

function applyTransferFilters() {
  let result = [...allTransfers];

  // ステータスフィルタ
  if (transferFilters.status.length > 0) {
    result = result.filter(t => transferFilters.status.includes(t.status));
  }

  // 教室フィルタ（休んだ教室 or 振替先教室にマッチ）
  if (transferFilters.classes.length > 0) {
    result = result.filter(t => {
      const fd = t.form_data || {};
      return transferFilters.classes.includes(fd.absent_class) ||
             transferFilters.classes.includes(fd.transfer_class);
    });
  }

  // 担当者フィルタ
  if (transferFilters.assignee.length > 0) {
    result = result.filter(t => {
      if (transferFilters.assignee.includes('unassigned') && !t.assigned_to) return true;
      if (t.assigned_to && transferFilters.assignee.includes(t.assigned_to)) return true;
      return false;
    });
  }

  // 検索
  if (transferFilters.query) {
    const q = transferFilters.query.toLowerCase();
    result = result.filter(t => {
      const fd = t.form_data || {};
      return (fd.member_name || '').toLowerCase().includes(q) ||
        (fd.member_furigana || '').toLowerCase().includes(q) ||
        (fd.email || '').toLowerCase().includes(q) ||
        (fd.absent_class || '').toLowerCase().includes(q) ||
        (fd.transfer_class || '').toLowerCase().includes(q);
    });
  }

  // ソート
  const STATUS_ORDER = { pending: 0, approved: 1, rejected: 2 };
  result.sort((a, b) => {
    switch (transferSortKey) {
      case 'created_asc': return new Date(a.created_at) - new Date(b.created_at);
      case 'transfer_date': {
        const da = parseTransferDate(a.form_data?.transfer_date);
        const db = parseTransferDate(b.form_data?.transfer_date);
        return (da?.getTime() || 0) - (db?.getTime() || 0);
      }
      case 'absent_date': {
        const da = parseTransferDate(a.form_data?.absent_date);
        const db = parseTransferDate(b.form_data?.absent_date);
        return (da?.getTime() || 0) - (db?.getTime() || 0);
      }
      case 'name': return ((a.form_data?.member_name || '').localeCompare((b.form_data?.member_name || ''), 'ja'));
      case 'status': return (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
      case 'created_desc':
      default: return new Date(b.created_at) - new Date(a.created_at);
    }
  });

  filteredTransfers = result;
  updateTransferFilterBadge();
}

function updateTransferFilterBadge() {
  const count = transferFilters.status.length + transferFilters.classes.length + transferFilters.assignee.length;
  const btn = document.getElementById('transfer-filter-toggle');
  if (!btn) return;
  const existing = btn.querySelector('.filter-badge');
  if (existing) existing.remove();
  btn.classList.toggle('has-filters', count > 0);
  if (count > 0) {
    btn.insertAdjacentHTML('beforeend', `<span class="filter-badge">${count}</span>`);
  }
}

export function resetTransferFilters() {
  transferFilters = { status: [], classes: [], assignee: [], query: '' };
  document.querySelectorAll('#transfer-filter-panel input[type="checkbox"]').forEach(cb => { cb.checked = false; });
  const searchInput = document.getElementById('transfer-search-input');
  if (searchInput) searchInput.value = '';
  applyTransferFilters();
  renderTransferListOnly();
}

export function initTransferSort() {
  const sel = document.getElementById('transfer-sort-select');
  if (sel) {
    sel.value = transferSortKey;
    sel.addEventListener('change', () => {
      transferSortKey = sel.value;
      applyTransferFilters();
      renderTransferListOnly();
    });
  }
}

// --- グリッドヘッダー ---

const TRANSFER_GRID_HEADER = `
  <div class="transfer-grid-header">
    <span>会員名</span>
    <span>休んだ教室</span>
    <span>振替先教室</span>
    <span>ステータス</span>
    <span>担当</span>
    <span>振替希望日</span>
    <span>受付日</span>
    <span></span>
  </div>`;

function buildTransferGridRow(t) {
  const fd = t.form_data || {};
  const statusLabel = TRANSFER_STATUS_LABELS[t.status] || t.status;
  const badgeClass = TRANSFER_STATUS_BADGE[t.status] || '';
  const createdDate = formatShortDate(t.created_at);
  const transferDate = formatTransferDateShort(fd.transfer_date);
  const assigneeName = t.assigned_to ? (getStaffById(t.assigned_to)?.name || '') : '';
  const needsAssignment = !t.assigned_to && t.status === 'pending';
  const warnings = getTransferWarnings(fd);

  const warningBadges = warnings.map(w => {
    const cls = w.type === 'danger' ? 'badge-app-rejected' : 'badge-followup-overdue';
    return `<span class="badge ${cls}">${escapeHtml(w.label)}</span>`;
  }).join('');

  return `
    <div class="list-item ${needsAssignment ? 'needs-assignment' : ''}" data-status="${t.status}"
         onclick="window.memberApp.showTransferDetail('${t.id}')"
         oncontextmenu="window.memberApp.showTransferContextMenu(event, '${t.id}')">
      <div class="grid-cell grid-cell-name">
        <span class="material-icons" style="font-size:18px;color:var(--gray-400);flex-shrink:0">swap_horiz</span>
        <strong>${escapeHtml(fd.member_name || '（名前なし）')}</strong>
      </div>
      <div class="grid-cell">${escapeHtml(fd.absent_class || '')}</div>
      <div class="grid-cell">${escapeHtml(fd.transfer_class || '')}</div>
      <div class="grid-cell grid-cell-badges">
        <span class="badge ${badgeClass}">${escapeHtml(statusLabel)}</span>
        ${warningBadges}
      </div>
      <div class="grid-cell grid-cell-assignee">
        ${needsAssignment
          ? '<span class="badge badge-warning-alert">未割当</span>'
          : assigneeName
            ? `<span class="badge badge-assignee">${escapeHtml(assigneeName)}</span>`
            : ''}
      </div>
      <div class="grid-cell grid-cell-date">${escapeHtml(transferDate)}</div>
      <div class="grid-cell grid-cell-date">${escapeHtml(createdDate)}</div>
      <div class="grid-cell grid-cell-arrow">
        <span class="material-icons list-item-arrow">chevron_right</span>
      </div>
    </div>`;
}

// --- ワークロード表示 ---

function buildTransferWorkloadSummary() {
  const staff = getJimukyokuStaff();
  const active = allTransfers.filter(t => t.status === 'pending');

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

  const isActive = (val) => transferFilters.assignee.includes(val) ? ' active' : '';
  const countClass = (n) => n > 0 ? 'workload-count' : 'workload-count workload-count-zero';

  let html = `<div class="workload-card${isActive('unassigned')}" onclick="window.memberApp.toggleTransferWorkloadFilter('unassigned')">
    <span class="material-icons" style="font-size:16px;color:var(--gray-400)">person_off</span>
    未割当 <span class="${countClass(unassigned)}">${unassigned}</span>
  </div>`;

  staff.forEach(s => {
    const c = counts[s.id] || 0;
    html += `<div class="workload-card${isActive(s.id)}" onclick="window.memberApp.toggleTransferWorkloadFilter('${s.id}')">
      <span class="material-icons" style="font-size:16px;color:var(--primary-color)">person</span>
      ${escapeHtml(s.name)} <span class="${countClass(c)}">${c}</span>
    </div>`;
  });

  return html;
}

export function toggleTransferWorkloadFilter(value) {
  const container = document.getElementById('transfer-assignee-filter');
  if (transferFilters.assignee.includes(value)) {
    transferFilters.assignee = transferFilters.assignee.filter(v => v !== value);
  } else {
    transferFilters.assignee = [value];
  }

  if (container) {
    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = transferFilters.assignee.includes(cb.value);
    });
  }

  applyTransferFilters();
  renderTransferListOnly();
}

// --- 一覧レンダリング ---

export async function renderTransferList() {
  await loadTransferData();
  applyTransferFilters();

  const workloadEl = document.getElementById('transfer-workload');
  if (workloadEl) workloadEl.innerHTML = buildTransferWorkloadSummary();

  const listEl = document.getElementById('transfer-list');
  if (!listEl) return;

  const countEl = document.getElementById('transfer-count');
  if (countEl) {
    const total = allTransfers.length;
    const shown = filteredTransfers.length;
    countEl.textContent = total === shown ? `${shown}件` : `${total}件中 ${shown}件表示`;
  }

  if (filteredTransfers.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <span class="material-icons empty-icon">swap_horiz</span>
        <p>振替データがありません</p>
      </div>`;
    return;
  }

  listEl.innerHTML = TRANSFER_GRID_HEADER + filteredTransfers.map(buildTransferGridRow).join('');
}

// --- ワークフローステッパー ---

function buildTransferWorkflowStepper(status) {
  const steps = [
    { key: 'pending',  label: '申請', icon: 'inbox' },
    { key: 'approved', label: '確定', icon: 'check_circle' },
  ];

  const statusOrder = { pending: 0, approved: 1, rejected: -1 };
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

export async function showTransferDetail(id) {
  const transfer = allTransfers.find(t => t.id === id);
  if (!transfer) return;

  setModalWide(true);

  const fd = transfer.form_data || {};
  const statusLabel = TRANSFER_STATUS_LABELS[transfer.status] || transfer.status;
  const badgeClass = TRANSFER_STATUS_BADGE[transfer.status] || '';

  const fullWidthKeys = new Set(['note']);

  const detailRows = TRANSFER_FIELDS.map(f => {
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

  // 警告セクション
  const warnings = getTransferWarnings(fd);
  const warningSection = warnings.length > 0 ? `
    <div class="app-detail-section" style="background:#fffbeb;border:1px solid #f59e0b;border-radius:var(--radius-lg);padding:12px 16px;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:6px;font-weight:600;margin-bottom:8px;color:#b45309">
        <span class="material-icons" style="font-size:18px">warning</span> 確認事項
      </div>
      ${warnings.map(w => {
        const cls = w.type === 'danger' ? 'badge-app-rejected' : w.type === 'warning' ? 'badge-followup-overdue' : 'badge-info';
        return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0">
          <span class="badge ${cls}">${escapeHtml(w.label)}</span>
          <span style="font-size:0.85rem">${escapeHtml(w.detail)}</span>
        </div>`;
      }).join('')}
    </div>` : '';

  // 担当者セレクト
  const staff = getJimukyokuStaff();
  const assigneeOptions = staff.map(s =>
    `<option value="${s.id}" ${transfer.assigned_to === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
  ).join('');

  const content = `
    ${buildTransferWorkflowStepper(transfer.status)}

    <div class="app-detail-header">
      <div class="detail-row">
        <span class="detail-label">受付日時</span>
        <span class="detail-value">${escapeHtml(formatDateTime(transfer.created_at))}</span>
      </div>
      ${transfer.processed_at ? `
      <div class="detail-row">
        <span class="detail-label">処理日時</span>
        <span class="detail-value">${escapeHtml(formatDateTime(transfer.processed_at))}</span>
      </div>` : ''}
      <div class="detail-row">
        <span class="detail-label">担当者</span>
        <span class="detail-value">
          <select class="inline-select" onchange="window.memberApp.assignTransfer('${transfer.id}', this.value)">
            <option value="">未割当</option>
            ${assigneeOptions}
          </select>
        </span>
      </div>
    </div>

    ${warningSection}

    <div class="app-detail-section">
      <div class="app-detail-section-header" id="transfer-detail-header">
        <span class="material-icons" style="font-size:18px">info</span> 申請内容
        <div style="margin-left:auto;display:flex;gap:4px">
          <button class="btn btn-sm btn-ghost" onclick="window.memberApp.openTransferEditForm('${transfer.id}')">
            <span class="material-icons" style="font-size:16px">edit</span>編集
          </button>
          <button class="btn btn-sm btn-ghost" onclick="window.memberApp.openTransferHistory('${transfer.id}', '${escapeHtml(fd.member_name || '')}')">
            <span class="material-icons" style="font-size:16px">history</span>履歴
          </button>
        </div>
      </div>
      <div class="detail-grid" id="transfer-detail-content">
        ${detailRows}
      </div>
    </div>

    ${buildTransferChecklistSection(transfer)}

    <div class="app-detail-section">
      <div class="app-detail-section-header">
        <span class="material-icons" style="font-size:18px">note</span> 管理メモ
      </div>
      <textarea id="transfer-admin-note" class="admin-note-textarea" rows="3"
        placeholder="内部メモを入力...">${escapeHtml(transfer.admin_note || '')}</textarea>
      <div style="text-align:right;margin-top:8px">
        <button class="btn btn-sm btn-secondary" onclick="window.memberApp.saveTransferAdminNote('${transfer.id}')">
          <span class="material-icons" style="font-size:14px">save</span>メモ保存
        </button>
      </div>
    </div>

    ${buildTransferActionButtons(transfer)}

    <div style="text-align:right;margin-top:24px;padding-top:16px;border-top:1px solid var(--gray-200)">
      <button class="btn btn-sm btn-danger-outline" onclick="window.memberApp.deleteTransfer('${transfer.id}')">
        <span class="material-icons" style="font-size:14px">delete</span>削除
      </button>
    </div>
  `;

  openModal(`
    <span class="badge ${badgeClass}" style="margin-right:8px">${escapeHtml(statusLabel)}</span>
    振替申請 - ${escapeHtml(fd.member_name || '（名前なし）')}
  `, content);
}

// --- チェックリストセクション ---

function buildTransferChecklistSection(transfer) {
  const checklist = transfer.checklist || initializeTransferChecklist();
  const progress = getTransferChecklistProgress(checklist);

  const pct = progress ? Math.round((progress.checked / progress.total) * 100) : 0;
  const isDone = progress && progress.checked === progress.total;

  let itemsHtml = '';
  TRANSFER_CHECKLIST_ITEMS.forEach(def => {
    const item = checklist.items?.find(i => i.key === def.key) || { checked: false };
    const icon = item.checked ? 'check_circle' : 'radio_button_unchecked';
    const iconColor = item.checked ? 'var(--success-color)' : 'var(--gray-300)';
    const checkedInfo = item.checked
      ? `<span style="font-size:0.75rem;color:var(--gray-400);margin-left:8px">${formatShortDateTimeTransfer(item.checked_at)} ${extractNameTransfer(item.checked_by)}</span>`
      : '';

    itemsHtml += `
      <div class="checklist-item" onclick="window.memberApp.toggleTransferChecklistItem('${transfer.id}', '${def.key}')" style="cursor:pointer">
        <span class="material-icons" style="font-size:20px;color:${iconColor}">${icon}</span>
        <span>${escapeHtml(def.label)}</span>
        ${checkedInfo}
      </div>`;
  });

  return `
    <div class="app-detail-section">
      <div class="app-detail-section-header">
        <span class="material-icons" style="font-size:18px">${isDone ? 'task_alt' : 'checklist'}</span>
        チェックリスト
        <span class="badge ${isDone ? 'badge-checklist-done' : 'badge-checklist-partial'}" style="margin-left:8px">
          ${progress ? `${progress.checked}/${progress.total}` : ''}
        </span>
      </div>
      <div class="checklist-progress-bar">
        <div class="checklist-progress-fill" style="width:${pct}%"></div>
      </div>
      ${itemsHtml}
    </div>`;
}

// --- アクションボタン ---

function buildTransferActionButtons(transfer) {
  let buttons = '';

  if (transfer.status === 'pending') {
    buttons = `
      <button class="btn btn-danger" onclick="window.memberApp.updateTransferStatus('${transfer.id}', 'rejected')">
        <span class="material-icons">cancel</span>却下する
      </button>
      <button class="btn btn-primary" onclick="window.memberApp.updateTransferStatus('${transfer.id}', 'approved')">
        <span class="material-icons">check_circle</span>確定する
      </button>`;
  } else if (transfer.status === 'approved') {
    buttons = `
      <button class="btn btn-secondary" onclick="window.memberApp.updateTransferStatus('${transfer.id}', 'pending')">
        <span class="material-icons">undo</span>申請中に戻す
      </button>`;
  } else if (transfer.status === 'rejected') {
    buttons = `
      <button class="btn btn-secondary" onclick="window.memberApp.updateTransferStatus('${transfer.id}', 'pending')">
        <span class="material-icons">undo</span>申請中に戻す
      </button>`;
  }

  if (!buttons) return '';
  return `<div class="app-detail-actions">${buttons}</div>`;
}

// --- ステータス更新 ---

export async function updateTransferStatus(id, newStatus) {
  const updateData = { status: newStatus };

  if (newStatus === 'approved' || newStatus === 'rejected') {
    const { data: { session } } = await supabase.auth.getSession();
    updateData.processed_at = new Date().toISOString();
    updateData.processed_by = session?.user?.email || '';
  }

  const { error } = await supabase
    .from('applications')
    .update(updateData)
    .eq('id', id);

  if (error) {
    showToast('ステータス更新に失敗しました', 'error');
    console.error(error);
    return;
  }

  // ローカルデータ更新
  const t = allTransfers.find(x => x.id === id);
  if (t) Object.assign(t, updateData);

  showToast(`ステータスを「${TRANSFER_STATUS_LABELS[newStatus]}」に更新しました`, 'success');

  closeModal();
  applyTransferFilters();
  renderTransferListOnly();
  updateTabBadges();
}

// --- チェックリスト操作 ---

export async function toggleTransferChecklistItem(transferId, itemKey) {
  const transfer = allTransfers.find(t => t.id === transferId);
  if (!transfer) return;

  const checklist = transfer.checklist || initializeTransferChecklist();
  const item = checklist.items?.find(i => i.key === itemKey);
  if (!item) return;

  const { data: { session } } = await supabase.auth.getSession();
  const userEmail = session?.user?.email || '';

  item.checked = !item.checked;
  item.checked_at = item.checked ? new Date().toISOString() : null;
  item.checked_by = item.checked ? userEmail : null;

  const { error } = await supabase
    .from('applications')
    .update({ checklist })
    .eq('id', transferId);

  if (error) {
    showToast('チェックリスト更新に失敗しました', 'error');
    console.error(error);
    return;
  }

  transfer.checklist = checklist;

  // モーダル再描画（スクロール位置維持）
  const modal = document.querySelector('.modal-body');
  const scrollTop = modal?.scrollTop || 0;
  await showTransferDetail(transferId);
  const newModal = document.querySelector('.modal-body');
  if (newModal) newModal.scrollTop = scrollTop;
}

// --- 管理メモ ---

export async function saveTransferAdminNote(id) {
  const textarea = document.getElementById('transfer-admin-note');
  const note = textarea?.value || '';

  const { error } = await supabase
    .from('applications')
    .update({ admin_note: note })
    .eq('id', id);

  if (error) {
    showToast('メモ保存に失敗しました', 'error');
    console.error(error);
    return;
  }

  const t = allTransfers.find(x => x.id === id);
  if (t) t.admin_note = note;

  showToast('メモを保存しました', 'success');
}

// --- 削除 ---

export function deleteTransfer(id) {
  const t = allTransfers.find(x => x.id === id);
  if (!t) return;
  const name = t.form_data?.member_name || '（名前なし）';

  openModal('振替申請の削除', `
    <p>「<strong>${escapeHtml(name)}</strong>」の振替申請を削除しますか？</p>
    <p style="color:var(--danger-color);font-size:0.9rem">この操作は元に戻せません。</p>
    <div class="app-detail-actions" style="margin-top:16px">
      <button class="btn btn-secondary" onclick="window.memberApp.closeModal()">キャンセル</button>
      <button class="btn btn-danger" onclick="window.memberApp.executeDeleteTransfer('${id}')">削除する</button>
    </div>
  `);
}

export async function executeDeleteTransfer(id) {
  const { error } = await supabase
    .from('applications')
    .delete()
    .eq('id', id);

  if (error) {
    showToast('削除に失敗しました', 'error');
    console.error(error);
    return;
  }

  allTransfers = allTransfers.filter(t => t.id !== id);
  closeModal();
  applyTransferFilters();
  renderTransferListOnly();
  updateTabBadges();
  showToast('振替申請を削除しました', 'success');
}

// --- 担当者アサイン ---

export async function assignTransfer(id, staffId) {
  const transfer = allTransfers.find(t => t.id === id);
  if (!transfer) return;

  const oldStaffId = transfer.assigned_to;
  const newStaffId = staffId || null;

  const { error } = await supabase
    .from('applications')
    .update({ assigned_to: newStaffId })
    .eq('id', id);

  if (error) {
    showToast('担当者変更に失敗しました', 'error');
    console.error(error);
    return;
  }

  // 履歴記録
  const oldName = oldStaffId ? (getStaffById(oldStaffId)?.name || '') : '未割当';
  const newName = newStaffId ? (getStaffById(newStaffId)?.name || '') : '未割当';
  await logActivity(null, 'transfer_edit', 'assigned_to', oldName, newName, id);

  // タスクメッセージ
  if (newStaffId && newStaffId !== oldStaffId) {
    const fd = transfer.form_data || {};
    const msg = `振替申請の担当になりました：${fd.member_name || '（名前なし）'}（${fd.absent_class || ''} → ${fd.transfer_class || ''}）`;
    await sendTaskMessage(newStaffId, msg);
  }

  transfer.assigned_to = newStaffId;

  // モーダル再描画
  const modal = document.querySelector('.modal-body');
  const scrollTop = modal?.scrollTop || 0;
  await showTransferDetail(id);
  const newModal = document.querySelector('.modal-body');
  if (newModal) newModal.scrollTop = scrollTop;

  renderTransferListOnly();
}

// --- コンテキストメニュー ---

export function showTransferContextMenu(event, transferId) {
  event.preventDefault();
  event.stopPropagation();

  const transfer = allTransfers.find(t => t.id === transferId);
  if (!transfer || transfer.status === 'approved' || transfer.status === 'rejected') return;

  const staff = getJimukyokuStaff();
  const menu = document.getElementById('app-context-menu');
  if (!menu) return;

  let html = '<div class="context-menu-header">担当者を変更</div>';
  html += `<div class="context-menu-item" onclick="window.memberApp.contextAssignTransfer('${transferId}', '')">
    <span class="material-icons" style="font-size:16px">person_off</span>未割当
  </div>`;

  staff.forEach(s => {
    const isCurrent = transfer.assigned_to === s.id;
    html += `<div class="context-menu-item ${isCurrent ? 'current' : ''}" onclick="window.memberApp.contextAssignTransfer('${transferId}', '${s.id}')">
      <span class="material-icons" style="font-size:16px">person</span>${escapeHtml(s.name)}
      ${isCurrent ? '<span class="material-icons" style="font-size:14px;margin-left:auto">check</span>' : ''}
    </div>`;
  });

  menu.innerHTML = html;
  menu.style.display = 'block';
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;

  const hideMenu = () => {
    menu.style.display = 'none';
    document.removeEventListener('click', hideMenu);
  };
  setTimeout(() => document.addEventListener('click', hideMenu), 0);
}

export function contextAssignTransfer(transferId, staffId) {
  const menu = document.getElementById('app-context-menu');
  if (menu) menu.style.display = 'none';
  assignTransfer(transferId, staffId);
}

// --- 編集 ---

export function openTransferEditForm(id) {
  const transfer = allTransfers.find(t => t.id === id);
  if (!transfer) return;
  const fd = transfer.form_data || {};
  const classrooms = getActiveClassrooms();

  const header = document.getElementById('transfer-detail-header');
  if (header) {
    header.innerHTML = `
      <span class="material-icons" style="font-size:18px">edit</span> 申請内容を編集中
      <div style="margin-left:auto;display:flex;gap:4px">
        <button class="btn btn-sm btn-ghost" onclick="window.memberApp.showTransferDetail('${id}')">
          <span class="material-icons" style="font-size:16px">close</span>キャンセル
        </button>
        <button class="btn btn-sm btn-primary" onclick="window.memberApp.saveTransferEdit('${id}')">
          <span class="material-icons" style="font-size:16px">save</span>保存
        </button>
      </div>`;
  }

  const content = document.getElementById('transfer-detail-content');
  if (content) {
    content.innerHTML = TRANSFER_FIELDS.map(f => buildTransferFormField(f, fd[f.key], classrooms)).join('');
  }
}

function buildTransferFormField(field, value, classrooms) {
  const inputType = TRANSFER_FIELD_INPUT_TYPES[field.key] || {};
  const displayVal = Array.isArray(value) ? value.join('・') : (value || '');

  let inputHtml = '';

  if (inputType.type === 'date') {
    inputHtml = `<input type="date" class="form-input" data-field="${field.key}" value="${escapeHtml(displayVal)}">`;
  } else if (inputType.type === 'textarea') {
    inputHtml = `<textarea class="form-input" data-field="${field.key}" rows="2">${escapeHtml(displayVal)}</textarea>`;
  } else {
    inputHtml = `<input type="text" class="form-input" data-field="${field.key}" value="${escapeHtml(displayVal)}">`;
  }

  return `
    <div class="detail-row">
      <span class="detail-label">${escapeHtml(field.label)}</span>
      <span class="detail-value">${inputHtml}</span>
    </div>`;
}

export async function saveTransferEdit(id) {
  const transfer = allTransfers.find(t => t.id === id);
  if (!transfer) return;

  const oldFd = { ...transfer.form_data };
  const newFd = { ...transfer.form_data };

  TRANSFER_FIELDS.forEach(f => {
    const el = document.querySelector(`[data-field="${f.key}"]`);
    if (el) {
      newFd[f.key] = el.value;
    }
  });

  const { error } = await supabase
    .from('applications')
    .update({ form_data: newFd, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    showToast('保存に失敗しました', 'error');
    console.error(error);
    return;
  }

  // 変更履歴記録
  TRANSFER_FIELDS.forEach(f => {
    const oldVal = oldFd[f.key] || '';
    const newVal = newFd[f.key] || '';
    if (String(oldVal) !== String(newVal)) {
      logActivity(null, 'transfer_edit', f.key, oldVal, newVal, id);
    }
  });

  transfer.form_data = newFd;

  showToast('振替申請を更新しました', 'success');

  // モーダル再描画
  const modal = document.querySelector('.modal-body');
  const scrollTop = modal?.scrollTop || 0;
  await showTransferDetail(id);
  const newModal = document.querySelector('.modal-body');
  if (newModal) newModal.scrollTop = scrollTop;

  renderTransferListOnly();
}

// --- 新規作成 ---

export function openTransferAddForm() {
  setModalWide(true);
  const classrooms = getActiveClassrooms();

  const classOptions = classrooms.map(c =>
    `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`
  ).join('');

  const content = `
    <div class="app-detail-section">
      <div class="app-detail-section-header">
        <span class="material-icons" style="font-size:18px">info</span> 振替申請情報
      </div>
      <div class="detail-grid">
        <div class="detail-row">
          <span class="detail-label">会員名 <span style="color:var(--danger-color)">*</span></span>
          <span class="detail-value"><input type="text" class="form-input" id="new-transfer-member_name" placeholder="例: 山田 太郎"></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">フリガナ</span>
          <span class="detail-value"><input type="text" class="form-input" id="new-transfer-member_furigana" placeholder="例: ヤマダ タロウ"></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">保護者名</span>
          <span class="detail-value"><input type="text" class="form-input" id="new-transfer-guardian_name"></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">メール</span>
          <span class="detail-value"><input type="email" class="form-input" id="new-transfer-email"></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">電話番号</span>
          <span class="detail-value"><input type="tel" class="form-input" id="new-transfer-phone"></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">所属教室</span>
          <span class="detail-value">
            <select class="form-input" id="new-transfer-source_class">
              <option value="">選択してください</option>
              ${classOptions}
            </select>
          </span>
        </div>
        <div class="detail-row">
          <span class="detail-label">休んだ教室 <span style="color:var(--danger-color)">*</span></span>
          <span class="detail-value">
            <select class="form-input" id="new-transfer-absent_class">
              <option value="">選択してください</option>
              ${classOptions}
            </select>
          </span>
        </div>
        <div class="detail-row">
          <span class="detail-label">休んだ日 <span style="color:var(--danger-color)">*</span></span>
          <span class="detail-value"><input type="date" class="form-input" id="new-transfer-absent_date"></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">振替先教室 <span style="color:var(--danger-color)">*</span></span>
          <span class="detail-value">
            <select class="form-input" id="new-transfer-transfer_class">
              <option value="">選択してください</option>
              ${classOptions}
            </select>
          </span>
        </div>
        <div class="detail-row">
          <span class="detail-label">振替希望日 <span style="color:var(--danger-color)">*</span></span>
          <span class="detail-value"><input type="date" class="form-input" id="new-transfer-transfer_date"></span>
        </div>
        <div class="detail-row detail-row-full">
          <span class="detail-label">備考</span>
          <span class="detail-value"><textarea class="form-input" id="new-transfer-note" rows="2" placeholder="任意"></textarea></span>
        </div>
      </div>
    </div>

    <div class="app-detail-actions" style="margin-top:16px">
      <button class="btn btn-secondary" onclick="window.memberApp.closeModal()">キャンセル</button>
      <button class="btn btn-primary" onclick="window.memberApp.saveNewTransfer()">
        <span class="material-icons">add</span>登録する
      </button>
    </div>
  `;

  openModal('<span class="material-icons" style="vertical-align:middle;margin-right:4px">swap_horiz</span> 振替申請を新規作成', content);
}

export async function saveNewTransfer() {
  const getValue = (id) => document.getElementById(id)?.value?.trim() || '';

  const memberName = getValue('new-transfer-member_name');
  const absentClass = getValue('new-transfer-absent_class');
  const absentDate = getValue('new-transfer-absent_date');
  const transferClass = getValue('new-transfer-transfer_class');
  const transferDate = getValue('new-transfer-transfer_date');

  // バリデーション
  if (!memberName || !absentClass || !absentDate || !transferClass || !transferDate) {
    showToast('必須項目（*）を入力してください', 'error');
    return;
  }

  const formData = {
    member_name: memberName,
    member_furigana: getValue('new-transfer-member_furigana'),
    guardian_name: getValue('new-transfer-guardian_name'),
    email: getValue('new-transfer-email'),
    phone: getValue('new-transfer-phone'),
    source_class: getValue('new-transfer-source_class'),
    absent_class: absentClass,
    absent_date: absentDate,
    transfer_class: transferClass,
    transfer_date: transferDate,
    note: getValue('new-transfer-note'),
  };

  const record = {
    type: 'transfer',
    status: 'pending',
    form_data: formData,
    checklist: initializeTransferChecklist(),
  };

  const { error } = await supabase
    .from('applications')
    .insert(record);

  if (error) {
    showToast('登録に失敗しました', 'error');
    console.error(error);
    return;
  }

  showToast('振替申請を登録しました', 'success');
  closeModal();
  await renderTransferList();
  updateTabBadges();
}

// --- 履歴 ---

export function openTransferHistory(id, label) {
  openAppHistory(id, `振替: ${label}`);
}

// --- フィルタ初期化 ---

export function initTransferFilters() {
  // 検索入力
  const searchInput = document.getElementById('transfer-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      transferFilters.query = searchInput.value;
      applyTransferFilters();
      renderTransferListOnly();
    });
  }

  // ステータスフィルタ
  const statusFilter = document.getElementById('transfer-status-filter');
  if (statusFilter) {
    statusFilter.addEventListener('change', () => {
      transferFilters.status = [...statusFilter.querySelectorAll('input:checked')].map(cb => cb.value);
      applyTransferFilters();
      renderTransferListOnly();
    });
  }

  updateTransferClassFilter();
  updateTransferAssigneeFilter();
}

function updateTransferClassFilter() {
  const container = document.getElementById('transfer-class-filter');
  if (!container) return;

  const classrooms = getActiveClassrooms();
  container.innerHTML = classrooms.map(c =>
    `<label class="filter-pill"><input type="checkbox" value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</label>`
  ).join('');

  container.addEventListener('change', () => {
    transferFilters.classes = [...container.querySelectorAll('input:checked')].map(cb => cb.value);
    applyTransferFilters();
    renderTransferListOnly();
  });
}

function updateTransferAssigneeFilter() {
  const container = document.getElementById('transfer-assignee-filter');
  if (!container) return;

  const staff = getJimukyokuStaff();
  let html = '<label class="filter-pill"><input type="checkbox" value="unassigned">未割当</label>';
  staff.forEach(s => {
    html += `<label class="filter-pill"><input type="checkbox" value="${s.id}">${escapeHtml(s.name)}</label>`;
  });
  container.innerHTML = html;

  container.addEventListener('change', () => {
    transferFilters.assignee = [...container.querySelectorAll('input:checked')].map(cb => cb.value);
    applyTransferFilters();
    renderTransferListOnly();
  });
}

export function toggleTransferFilterPanel() {
  const panel = document.getElementById('transfer-filter-panel');
  if (panel) panel.classList.toggle('open');
}

function renderTransferListOnly() {
  applyTransferFilters();

  const workloadEl = document.getElementById('transfer-workload');
  if (workloadEl) workloadEl.innerHTML = buildTransferWorkloadSummary();

  const countEl = document.getElementById('transfer-count');
  if (countEl) {
    const total = allTransfers.length;
    const shown = filteredTransfers.length;
    countEl.textContent = total === shown ? `${shown}件` : `${total}件中 ${shown}件表示`;
  }

  const listEl = document.getElementById('transfer-list');
  if (!listEl) return;

  if (filteredTransfers.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <span class="material-icons empty-icon">swap_horiz</span>
        <p>振替データがありません</p>
      </div>`;
    return;
  }

  listEl.innerHTML = TRANSFER_GRID_HEADER + filteredTransfers.map(buildTransferGridRow).join('');
}

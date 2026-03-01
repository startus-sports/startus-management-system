import { APP_NAME } from './config.js';
import { checkSession, isAllowedEmail, signInWithGoogle, signOut, onAuthStateChange } from './auth.js';
import {
  loadMembers, showDetail, openAddForm, openEditForm,
  confirmDelete, deleteMember, initSortSelect, initSearchInput,
  initStatusFilter, initTypeFilter, resetMemberFilters
} from './members.js';
import { openImportModal, removeImportRow, executeImport } from './import.js';
import { exportCSV, exportApplicationsCSV, exportTrialsCSV } from './export.js';
import { openFeeEditForm, onFiscalYearChange, cancelFeeEdit } from './fees.js';
import { initTabs, switchTab, getCurrentTab } from './views.js';
import { renderFeeOverview, onFeeOverviewYearChange } from './fee-overview.js';
import { openGradeUpdateModal, executeGradeUpdate } from './grade-update.js';
import { renderStats, changeStatsFY } from './stats.js';
import { openBulkFeeCheck, onBulkMonthChange, toggleBulkFeeAll, saveBulkFee } from './bulk-fee.js';
import { openGlobalHistory, openMemberHistory } from './history.js';
import { openEmailListModal, copyEmailList } from './email-list.js';
import {
  loadClassrooms, renderClassroomScreen, openClassroomAddForm,
  openClassroomEditForm, confirmDeleteClassroom, deleteClassroom,
  initClassroomFilters, toggleClassroomFilterPanel, resetClassroomFilters
} from './classroom.js';
import {
  renderApplicationList, showApplicationDetail, updateApplicationStatus,
  saveApplicationAdminNote, deleteApplication,
  executeDeleteApplication, initAppFilters, toggleAppFilterPanel,
  toggleChecklistItem, approveWithChecklistWarning,
  openApplicationEditForm, saveApplicationEdit, openApplicationHistory,
  assignApplication, toggleAppWorkloadFilter,
  initAppSort, resetAppFilters
} from './applications.js';
import {
  renderTrialList, showTrialDetail, updateTrialStatus,
  saveTrialAdminNote, deleteTrial,
  executeDeleteTrial, initTrialFilters, toggleTrialFilterPanel,
  toggleTrialChecklistItem,
  openTrialEditForm, saveTrialEdit, openTrialHistory,
  linkJoinApplication, unlinkJoinApplication, markTrialEnrolled,
  saveTrialFollowUp, assignTrial, toggleTrialWorkloadFilter,
  initTrialSort, resetTrialFilters
} from './trials.js';
import { renderCalendar, navigateCalendarDay, goToToday, refreshCalendar, authorizeCalendar } from './calendar.js';
import {
  renderSchedule, navigateSchedule, goToScheduleToday,
  refreshSchedule, changeScheduleView, showScheduleEventDetail,
  navigateScheduleToDate
} from './schedule.js';
import {
  loadStaff, showStaffDetail, openStaffAddForm, openStaffEditForm,
  confirmDeleteStaff, deleteStaff, initStaffSearch, initStaffFilters,
  toggleStaffFilterPanel, getJimukyokuStaff, getStaffById, getStaffByEmail,
  initStaffSort, resetStaffFilters
} from './staff.js';
import { updateTabBadges, startBadgePolling } from './notifications.js';
import {
  initChat, toggleChat, sendTaskMessage, openRefFromChat,
  openDmWithStaff, chatOpenChannel, chatBackToList, chatSendMessage,
  loadUnreadCounts, updateUnreadBadge
} from './chat.js';

// --- Toast ---

export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="material-icons toast-icon">${getToastIcon(type)}</span>
    <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-hide');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function getToastIcon(type) {
  switch (type) {
    case 'success': return 'check_circle';
    case 'error': return 'error';
    case 'warning': return 'warning';
    default: return 'info';
  }
}

// --- Modal ---

export function openModal(title, content) {
  const modal = document.getElementById('modal');
  const modalTitle = document.getElementById('modal-title');
  const modalBody = document.getElementById('modal-body');

  modalTitle.textContent = title;
  modalBody.innerHTML = content;
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

export function closeModal() {
  const modal = document.getElementById('modal');
  modal.classList.remove('active');
  document.body.style.overflow = '';
  setModalWide(false);
}

export function setModalWide(wide) {
  const content = document.querySelector('.modal-content');
  if (content) {
    content.classList.toggle('modal-wide', wide);
  }
}

// --- クリップボード ---

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('コピーしました', 'success');
  } catch (e) {
    showToast('コピーに失敗しました', 'error');
  }
}

// --- フィルタパネル ---

function toggleFilterPanel() {
  const panel = document.getElementById('filter-panel');
  if (panel) panel.classList.toggle('open');
}

// --- 検索バートグル ---

const SEARCH_BAR_MAP = {
  member: { barId: 'member-search-bar', inputId: 'search-input' },
  app: { barId: 'app-search-bar', inputId: 'app-search-input' },
  trial: { barId: 'trial-search-bar', inputId: 'trial-search-input' },
  staff: { barId: 'staff-search-bar', inputId: 'staff-search-input' },
  classroom: { barId: 'classroom-search-bar', inputId: 'classroom-search-input' },
};

function toggleSearchBar(key) {
  const cfg = SEARCH_BAR_MAP[key];
  if (!cfg) return;
  const bar = document.getElementById(cfg.barId);
  if (!bar) return;
  const isOpen = bar.classList.toggle('open');
  // ボタンのactive状態
  const btn = bar.previousElementSibling?.querySelector?.(`.btn-search-toggle`) ||
    document.querySelector(`[onclick*="toggleSearchBar('${key}')"]`);
  if (btn) btn.classList.toggle('active', isOpen);
  if (isOpen) {
    const input = document.getElementById(cfg.inputId);
    if (input) input.focus();
  }
}

// --- 初期化 ---

async function init() {
  // タイトル設定
  const titleEl = document.getElementById('app-title');
  if (titleEl) titleEl.textContent = APP_NAME;
  document.title = APP_NAME;

  const session = await checkSession();

  if (session && session.user) {
    const email = session.user.email;
    if (!isAllowedEmail(email)) {
      showLoginError('このアカウントではアクセスできません');
      await signOut();
      return;
    }
    showApp(email);
  } else {
    showLogin();
  }

  onAuthStateChange(async (session) => {
    if (session && session.user) {
      const email = session.user.email;
      if (!isAllowedEmail(email)) {
        showLoginError('このアカウントではアクセスできません');
        await signOut();
        return;
      }
      showApp(email);
    }
  });
}

function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-screen').style.display = 'none';
}

async function showApp(email) {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = 'block';

  const userEmail = document.getElementById('user-email');
  if (userEmail) userEmail.textContent = email;

  // イベント初期化
  initSortSelect();
  initSearchInput();
  initStatusFilter();
  initTypeFilter();

  // タブ初期化
  initTabs((tabName) => {
    if (tabName === 'fee-overview') renderFeeOverview();
    if (tabName === 'applications') renderApplicationList();
    if (tabName === 'trials') renderTrialList();
    if (tabName === 'stats') renderStats();
    if (tabName === 'staff') loadStaff();
    if (tabName === 'calendar') renderCalendar();
    if (tabName === 'schedule') renderSchedule();
    if (tabName === 'master') renderClassroomScreen();
  });

  // 申請フィルタ・ソート初期化
  initAppFilters();
  initAppSort();

  // 体験フィルタ・ソート初期化
  initTrialFilters();
  initTrialSort();

  // スタッフフィルタ・ソート初期化
  initStaffSearch();
  initStaffFilters();
  initStaffSort();

  // 教室マスタフィルタ初期化
  initClassroomFilters();

  // データ読み込み
  await loadClassrooms();
  await loadStaff();
  loadMembers();

  // 未対応バッジ更新（60秒ごと自動更新）
  startBadgePolling();

  // チャット初期化
  const chatStaff = getStaffByEmail(email);
  console.log('chat init: email=', email, 'staff=', chatStaff);
  if (chatStaff) {
    await initChat(chatStaff);
  } else {
    console.warn('chat init: スタッフが見つかりません。staffテーブルにメールが登録されているか確認してください');
  }
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  if (el) {
    el.textContent = msg;
    el.style.display = 'block';
  }
}

// --- グローバル公開（onclick用） ---

window.memberApp = {
  signInWithGoogle,
  signOut,
  showDetail,
  openAddForm,
  openEditForm,
  confirmDelete,
  deleteMember,
  openImportModal,
  removeImportRow,
  executeImport,
  exportCSV,
  exportApplicationsCSV,
  exportTrialsCSV,
  closeModal,
  toggleFilterPanel,
  openFeeEditForm,
  onFiscalYearChange,
  cancelFeeEdit,
  switchTab,
  renderFeeOverview,
  onFeeOverviewYearChange,
  openGradeUpdateModal,
  executeGradeUpdate,
  openBulkFeeCheck,
  onBulkMonthChange,
  toggleBulkFeeAll,
  saveBulkFee,
  openGlobalHistory,
  openMemberHistory,
  openEmailListModal,
  copyEmailList,
  copyToClipboard,
  renderClassroomScreen,
  openClassroomAddForm,
  openClassroomEditForm,
  confirmDeleteClassroom,
  deleteClassroom,
  toggleClassroomFilterPanel,
  resetClassroomFilters,
  renderApplicationList,
  showApplicationDetail,
  updateApplicationStatus,
  saveApplicationAdminNote,
  deleteApplication,
  executeDeleteApplication,
  toggleAppFilterPanel,
  resetAppFilters,
  toggleChecklistItem,
  approveWithChecklistWarning,
  openApplicationEditForm,
  saveApplicationEdit,
  openApplicationHistory,
  renderTrialList,
  showTrialDetail,
  updateTrialStatus,
  saveTrialAdminNote,
  deleteTrial,
  executeDeleteTrial,
  toggleTrialFilterPanel,
  resetTrialFilters,
  toggleTrialChecklistItem,
  openTrialEditForm,
  saveTrialEdit,
  openTrialHistory,
  linkJoinApplication,
  unlinkJoinApplication,
  markTrialEnrolled,
  saveTrialFollowUp,
  changeStatsFY,
  assignApplication,
  assignTrial,
  toggleAppWorkloadFilter,
  toggleTrialWorkloadFilter,
  showStaffDetail,
  openStaffAddForm,
  openStaffEditForm,
  confirmDeleteStaff,
  deleteStaff,
  toggleStaffFilterPanel,
  resetStaffFilters,
  resetMemberFilters,
  navigateCalendarDay,
  goToToday,
  refreshCalendar,
  authorizeCalendar,
  renderSchedule,
  navigateSchedule,
  goToScheduleToday,
  refreshSchedule,
  changeScheduleView,
  showScheduleEventDetail,
  navigateScheduleToDate,
  toggleChat,
  openRefFromChat,
  openDmWithStaff,
  chatOpenChannel,
  chatBackToList,
  chatSendMessage,
  toggleSearchBar,
};

// --- キーボードショートカット ---

const TAB_SEARCH_KEY_MAP = {
  members: 'member',
  applications: 'app',
  trials: 'trial',
  staff: 'staff',
  master: 'classroom',
};

document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !isInputFocused()) {
    e.preventDefault();
    const key = TAB_SEARCH_KEY_MAP[getCurrentTab()];
    if (key) {
      const cfg = SEARCH_BAR_MAP[key];
      if (cfg) {
        const bar = document.getElementById(cfg.barId);
        if (bar && !bar.classList.contains('open')) {
          toggleSearchBar(key);
        } else {
          const input = document.getElementById(cfg.inputId);
          if (input) input.focus();
        }
      }
    }
  }
});

function isInputFocused() {
  const tag = document.activeElement?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable;
}

// DOM Ready
document.addEventListener('DOMContentLoaded', init);

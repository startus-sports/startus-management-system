// --- サイドバーナビゲーション ---

let currentTab = 'dashboard';
let onTabChange = null;

const screens = [
  'dashboard-screen', 'members-screen', 'fee-overview-screen',
  'applications-screen', 'trials-screen', 'transfers-screen', 'stats-screen',
  'attendance-stats-screen', 'attendance-screen', 'app-preview-screen',
  'staff-screen', 'calendar-screen', 'schedule-screen',
  'sm-screen', 'master-screen', 'settings-screen',
  'shop-orders-screen', 'shop-products-screen', 'shop-preview-screen',
  'shop-inventory-screen', 'shop-customers-screen'
];

export function initTabs(callback) {
  onTabChange = callback;

  // PC: サイドバー表示状態をlocalStorageから復元
  const wasHidden = localStorage.getItem('sidebar-hidden') === 'true';
  const sidebar = document.getElementById('sidebar');
  if (sidebar && wasHidden) {
    sidebar.classList.add('hidden');
  }
}

export function switchTab(tabName) {
  if (currentTab === tabName) {
    // モバイル: 同じタブクリック → サイドバーを閉じるだけ
    if (isMobile()) closeMobileSidebar();
    return;
  }
  currentTab = tabName;

  // サイドバーのアクティブ状態を更新
  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.classList.toggle('active', item.dataset.tab === tabName);
  });

  // 画面の切り替え
  screens.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  const target = document.getElementById(`${tabName}-screen`);
  if (target) target.style.display = 'block';

  // モバイル: サイドバーを閉じる
  if (isMobile()) closeMobileSidebar();

  if (onTabChange) onTabChange(tabName);
}

export function getCurrentTab() { return currentTab; }

// --- サイドバー開閉 ---
export function toggleSidebar() {
  if (isMobile()) {
    toggleMobileSidebar();
  } else {
    toggleDesktopSidebar();
  }
}

// PC: 表示/非表示を切り替え（コンテンツを押しのける）
function toggleDesktopSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  sidebar.classList.toggle('hidden');
  const isHidden = sidebar.classList.contains('hidden');
  localStorage.setItem('sidebar-hidden', isHidden);
}

// モバイル: オーバーレイ方式で開閉
function toggleMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (!sidebar) return;

  const isOpen = sidebar.classList.contains('open');
  if (isOpen) {
    closeMobileSidebar();
  } else {
    sidebar.classList.remove('hidden');
    sidebar.classList.add('open');
    if (overlay) overlay.classList.add('active');
  }
}

function closeMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar) sidebar.classList.remove('open');
  if (overlay) overlay.classList.remove('active');
}

function isMobile() {
  return window.innerWidth <= 600;
}

// 互換性のため残す
export function toggleSidebarCollapse() {
  toggleSidebar();
}

// --- サイドバーナビゲーション ---

let currentTab = 'dashboard';
let onTabChange = null;

const screens = [
  'dashboard-screen', 'members-screen', 'fee-overview-screen',
  'applications-screen', 'trials-screen', 'stats-screen',
  'staff-screen', 'calendar-screen', 'schedule-screen',
  'sm-screen', 'master-screen'
];

export function initTabs(callback) {
  onTabChange = callback;

  // サイドバー折りたたみ状態をlocalStorageから復元
  const collapsed = localStorage.getItem('sidebar-collapsed') === 'true';
  if (collapsed) {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.add('collapsed');
    const icon = document.getElementById('sidebar-toggle-icon');
    if (icon) icon.textContent = 'chevron_right';
  }
}

export function switchTab(tabName) {
  if (currentTab === tabName) return;
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
  closeSidebarMobile();

  if (onTabChange) onTabChange(tabName);
}

export function getCurrentTab() { return currentTab; }

// --- サイドバー開閉（モバイル用） ---
export function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  sidebar.classList.toggle('open');
}

function closeSidebarMobile() {
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.classList.remove('open');
}

// --- サイドバー折りたたみ/展開（PC用） ---
export function toggleSidebarCollapse() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  sidebar.classList.toggle('collapsed');
  const isCollapsed = sidebar.classList.contains('collapsed');

  const icon = document.getElementById('sidebar-toggle-icon');
  if (icon) icon.textContent = isCollapsed ? 'chevron_right' : 'chevron_left';

  localStorage.setItem('sidebar-collapsed', isCollapsed);
}

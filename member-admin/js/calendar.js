// --- スタッフカレンダー（Google Calendar iframe 埋め込み） ---

import { getStaffCalendars } from './app-settings.js';

// --- State ---

let currentMode = 'DAY'; // DAY or WEEK

// --- Embed URL Builder ---

function buildEmbedUrl() {
  const staffCalendars = getStaffCalendars();

  const params = new URLSearchParams();

  // Add each staff calendar as a src
  staffCalendars.forEach(staff => {
    params.append('src', staff.id);
    // Google embed uses specific color codes (hex without #)
    params.append('color', staff.color);
  });

  params.set('mode', currentMode);
  params.set('ctz', 'Asia/Tokyo');
  params.set('showTitle', '0');
  params.set('showNav', '1');
  params.set('showDate', '1');
  params.set('showPrint', '0');
  params.set('showTabs', '0');
  params.set('showCalendars', '0');
  params.set('showTz', '0');
  params.set('wkst', '2'); // Monday start

  return `https://calendar.google.com/calendar/embed?${params.toString()}`;
}

// --- Public API ---

export async function renderCalendar(resetMode = true) {
  const container = document.getElementById('calendar-content');
  if (!container) return;

  // タブ切り替え時は常に日表示をデフォルトにする
  if (resetMode) currentMode = 'DAY';

  const toolbar = `
    <div class="cal-toolbar">
      <div class="cal-mode-toggle">
        <button class="btn ${currentMode === 'DAY' ? 'btn-primary' : 'btn-secondary'}" onclick="window.memberApp.changeCalendarMode('DAY')">日</button>
        <button class="btn ${currentMode === 'WEEK' ? 'btn-primary' : 'btn-secondary'}" onclick="window.memberApp.changeCalendarMode('WEEK')">週</button>
      </div>
      <div style="margin-left:auto;display:flex;align-items:center;gap:4px">
        <button class="btn-icon" onclick="window.memberApp.refreshCalendar()" title="再読込">
          <span class="material-icons">refresh</span>
        </button>
        <button class="btn-icon" onclick="window.memberApp.openGoogleCalendar()" title="Googleカレンダーで開く">
          <span class="material-icons">open_in_new</span>
        </button>
      </div>
    </div>`;

  const embedUrl = buildEmbedUrl();

  container.innerHTML = `
    ${toolbar}
    <div class="cal-embed-wrapper">
      <iframe
        id="cal-embed-iframe"
        src="${embedUrl}"
        frameborder="0"
        scrolling="auto"
        class="cal-embed-iframe"
      ></iframe>
      <div class="cal-embed-hint">
        <span class="material-icons">info</span>
        予定が表示されない場合は、ブラウザで組織のGoogleアカウント（@startus-kanazawa.org）にログインしてください
      </div>
    </div>`;
}

export function changeCalendarMode(mode) {
  currentMode = mode;
  renderCalendar(false);
}

export function refreshCalendar() {
  const iframe = document.getElementById('cal-embed-iframe');
  if (iframe) {
    iframe.src = buildEmbedUrl();
  }
}

export function openGoogleCalendar() {
  window.open('https://calendar.google.com/calendar/u/0/r', '_blank');
}

// Keep these exports for backward compatibility (no-ops)
export function authorizeCalendar() {}
export function switchCalendarAccount() {}
export function navigateCalendarDay() {}
export function goToToday() {}

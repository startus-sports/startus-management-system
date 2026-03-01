// --- スタッフカレンダー ---

import {
  GOOGLE_CALENDAR_API_KEY,
  GOOGLE_OAUTH_CLIENT_ID,
} from './config.js';
import { getStaffCalendars, getCalendarStartHour, getCalendarEndHour } from './app-settings.js';
import { showToast } from './app.js';
import { escapeHtml } from './utils.js';

// --- State ---

let currentDate = new Date();
let cachedEvents = {};  // { 'YYYY-MM-DD': { calendarId: [events] } }
let accessToken = null;
let tokenClient = null;
let gisReady = false;
let pendingRender = false;

// --- Constants ---

const API_BASE = 'https://www.googleapis.com/calendar/v3/calendars';
const HOUR_HEIGHT = 60; // px per hour
const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

// --- OAuth (Google Identity Services) ---

function initGIS() {
  if (gisReady || !window.google?.accounts?.oauth2) return false;

  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    scope: CALENDAR_SCOPE,
    callback: (tokenResponse) => {
      if (tokenResponse.error) {
        console.error('OAuth error:', tokenResponse);
        showToast('カレンダーの認証に失敗しました', 'error');
        return;
      }
      accessToken = tokenResponse.access_token;
      // Token received, now fetch events
      if (pendingRender) {
        pendingRender = false;
        renderCalendar();
      }
    },
  });

  gisReady = true;
  return true;
}

function requestCalendarAccess() {
  if (!tokenClient) return;
  pendingRender = true;
  tokenClient.requestAccessToken({ prompt: '' });
}

// --- Public API ---

export async function renderCalendar() {
  const container = document.getElementById('calendar-content');
  if (!container) return;

  // Check if GIS library is loaded
  if (!gisReady) {
    if (!window.google?.accounts?.oauth2) {
      // GIS not yet loaded, retry after short delay
      container.innerHTML = `
        <div class="cal-setup-message">
          <span class="material-icons cal-spinner" style="font-size:32px;color:var(--gray-300)">sync</span>
          <p>Google認証を読み込み中...</p>
        </div>`;
      setTimeout(() => {
        initGIS();
        renderCalendar();
      }, 500);
      return;
    }
    initGIS();
  }

  // Check if we have an access token
  if (!accessToken) {
    container.innerHTML = `
      <div class="cal-setup-message">
        <span class="material-icons" style="font-size:48px;color:var(--gray-300)">calendar_month</span>
        <h3>カレンダーへのアクセス許可が必要です</h3>
        <p>Googleカレンダーの予定を表示するには、アクセスを許可してください。</p>
        <button class="btn btn-primary" onclick="window.memberApp.authorizeCalendar()" style="margin-top:16px">
          <span class="material-icons">login</span>カレンダーへのアクセスを許可
        </button>
      </div>`;
    return;
  }

  const dateStr = formatDateJP(currentDate);
  const gridHeight = (getCalendarEndHour() - getCalendarStartHour()) * HOUR_HEIGHT;

  // Toolbar
  const toolbar = `
    <div class="cal-toolbar">
      <button class="btn btn-secondary" onclick="window.memberApp.goToToday()">
        <span class="material-icons">today</span>今日
      </button>
      <button class="btn-icon" onclick="window.memberApp.navigateCalendarDay(-1)" title="前日">
        <span class="material-icons">chevron_left</span>
      </button>
      <button class="btn-icon" onclick="window.memberApp.navigateCalendarDay(1)" title="翌日">
        <span class="material-icons">chevron_right</span>
      </button>
      <span class="cal-date-label">${escapeHtml(dateStr)}</span>
      <button class="btn-icon" onclick="window.memberApp.refreshCalendar()" title="更新" style="margin-left:auto">
        <span class="material-icons">refresh</span>
      </button>
    </div>`;

  // Time labels
  let timeLabelsHtml = '';
  for (let h = getCalendarStartHour(); h < getCalendarEndHour(); h++) {
    const top = (h - getCalendarStartHour()) * HOUR_HEIGHT;
    timeLabelsHtml += `<div class="cal-time-label" style="top:${top}px">${String(h).padStart(2, '0')}:00</div>`;
  }

  // Hour lines
  let hourLinesHtml = '';
  for (let h = 0; h < (getCalendarEndHour() - getCalendarStartHour()); h++) {
    hourLinesHtml += `<div class="cal-hour-line" style="top:${h * HOUR_HEIGHT}px"></div>`;
  }

  // Staff columns
  const columnsHtml = getStaffCalendars().map(staff => `
    <div class="cal-column" data-calendar-id="${escapeHtml(staff.id)}">
      <div class="cal-column-header" style="border-top:3px solid ${staff.color}">
        ${escapeHtml(staff.name)}
      </div>
      <div class="cal-column-body" style="height:${gridHeight}px">
        ${hourLinesHtml}
      </div>
    </div>`).join('');

  container.innerHTML = `
    ${toolbar}
    <div class="cal-grid-wrapper">
      <div class="cal-grid-container">
        <div class="cal-time-column">
          <div class="cal-column-header">&nbsp;</div>
          <div class="cal-time-labels" style="height:${gridHeight}px">
            ${timeLabelsHtml}
          </div>
        </div>
        <div class="cal-columns-scroll">
          ${columnsHtml}
        </div>
      </div>
    </div>`;

  await fetchAndRenderEvents();
  renderNowLine();
  autoScrollToNow();
}

export function authorizeCalendar() {
  requestCalendarAccess();
}

export function navigateCalendarDay(offset) {
  const newDate = new Date(currentDate);
  newDate.setDate(newDate.getDate() + offset);
  currentDate = newDate;
  renderCalendar();
}

export function goToToday() {
  currentDate = new Date();
  renderCalendar();
}

export function refreshCalendar() {
  const isoDate = toISODate(currentDate);
  delete cachedEvents[isoDate];
  renderCalendar();
}

// --- Data Fetching ---

async function fetchAndRenderEvents() {
  const isoDate = toISODate(currentDate);

  // Check cache
  if (cachedEvents[isoDate]) {
    renderEvents(cachedEvents[isoDate]);
    return;
  }

  // Show loading state on columns
  document.querySelectorAll('.cal-column-body').forEach(body => {
    const existing = body.querySelector('.cal-column-loading');
    if (!existing) {
      const loader = document.createElement('div');
      loader.className = 'cal-column-loading';
      loader.innerHTML = '<span class="material-icons cal-spinner">sync</span>';
      body.appendChild(loader);
    }
  });

  // Build time range for the day (JST)
  const timeMin = `${isoDate}T00:00:00+09:00`;
  const timeMax = `${isoDate}T23:59:59+09:00`;

  try {
    const results = await Promise.allSettled(
      getStaffCalendars().map(async (staff) => {
        const url = new URL(`${API_BASE}/${encodeURIComponent(staff.id)}/events`);
        url.searchParams.set('timeMin', timeMin);
        url.searchParams.set('timeMax', timeMax);
        url.searchParams.set('singleEvents', 'true');
        url.searchParams.set('orderBy', 'startTime');
        url.searchParams.set('timeZone', 'Asia/Tokyo');

        const resp = await fetch(url.toString(), {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (resp.status === 401 || resp.status === 403) {
          // Token expired or insufficient permissions
          accessToken = null;
          throw new Error('TOKEN_EXPIRED');
        }

        if (!resp.ok) {
          const errText = await resp.text().catch(() => '');
          console.error(`Calendar API error for ${staff.name} (${resp.status}):`, errText);
          return { calendarId: staff.id, events: [], error: true };
        }
        const data = await resp.json();
        return { calendarId: staff.id, events: data.items || [] };
      })
    );

    // Check if token expired
    const tokenExpired = results.some(r =>
      r.status === 'rejected' && r.reason?.message === 'TOKEN_EXPIRED'
    );
    if (tokenExpired) {
      showToast('認証の有効期限が切れました。再認証してください。', 'warning');
      renderCalendar(); // Will show the authorize button
      return;
    }

    const eventsByCalendar = {};
    let hasError = false;
    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        eventsByCalendar[result.value.calendarId] = result.value.events;
        if (result.value.error) hasError = true;
      } else {
        hasError = true;
      }
    });

    if (hasError) {
      showToast('一部のカレンダーの読み込みに失敗しました', 'warning');
    }

    cachedEvents[isoDate] = eventsByCalendar;
    renderEvents(eventsByCalendar);
  } catch (err) {
    console.error('Calendar fetch error:', err);
    showToast('カレンダーの読み込みに失敗しました', 'error');
  } finally {
    document.querySelectorAll('.cal-column-loading').forEach(el => el.remove());
  }
}

// --- Event Rendering ---

function renderEvents(eventsByCalendar) {
  getStaffCalendars().forEach((staff) => {
    const column = document.querySelector(
      `.cal-column[data-calendar-id="${CSS.escape(staff.id)}"] .cal-column-body`
    );
    if (!column) return;

    // Clear existing event blocks
    column.querySelectorAll('.cal-event').forEach(el => el.remove());

    const events = eventsByCalendar[staff.id] || [];
    events.forEach((event) => {
      const startStr = event.start?.dateTime;
      const endStr = event.end?.dateTime;

      // Skip all-day events
      if (!startStr || !endStr) return;

      const start = new Date(startStr);
      const end = new Date(endStr);

      const startMinutes = (start.getHours() - getCalendarStartHour()) * 60 + start.getMinutes();
      const endMinutes = (end.getHours() - getCalendarStartHour()) * 60 + end.getMinutes();

      // Skip if outside visible range
      if (endMinutes <= 0 || startMinutes >= (getCalendarEndHour() - getCalendarStartHour()) * 60) return;

      const clampedStart = Math.max(0, startMinutes);
      const clampedEnd = Math.min(endMinutes, (getCalendarEndHour() - getCalendarStartHour()) * 60);
      const topPx = clampedStart * (HOUR_HEIGHT / 60);
      const heightPx = Math.max(20, (clampedEnd - clampedStart) * (HOUR_HEIGHT / 60));

      const eventEl = document.createElement('div');
      eventEl.className = 'cal-event';
      eventEl.style.top = `${topPx}px`;
      eventEl.style.height = `${heightPx}px`;
      eventEl.style.backgroundColor = staff.color + '18';
      eventEl.style.borderLeft = `3px solid ${staff.color}`;

      const timeLabel = `${formatTime(start)}〜${formatTime(end)}`;
      const title = event.summary || '（タイトルなし）';

      eventEl.innerHTML = `
        <div class="cal-event-title">${escapeHtml(title)}</div>
        <div class="cal-event-time">${escapeHtml(timeLabel)}</div>
        ${event.location ? `<div class="cal-event-location">${escapeHtml(event.location)}</div>` : ''}`;

      eventEl.title = [title, timeLabel, event.location].filter(Boolean).join('\n');

      column.appendChild(eventEl);
    });
  });
}

// --- Current Time Indicator ---

function renderNowLine() {
  if (toISODate(currentDate) !== toISODate(new Date())) return;

  const now = new Date();
  const nowMinutes = (now.getHours() - getCalendarStartHour()) * 60 + now.getMinutes();
  if (nowMinutes < 0 || nowMinutes >= (getCalendarEndHour() - getCalendarStartHour()) * 60) return;

  const topPx = nowMinutes * (HOUR_HEIGHT / 60);

  document.querySelectorAll('.cal-column-body').forEach(body => {
    const line = document.createElement('div');
    line.className = 'cal-now-line';
    line.style.top = `${topPx}px`;
    body.appendChild(line);
  });

  const timeLabels = document.querySelector('.cal-time-labels');
  if (timeLabels) {
    const line = document.createElement('div');
    line.className = 'cal-now-line';
    line.style.top = `${topPx}px`;
    timeLabels.appendChild(line);
  }
}

function autoScrollToNow() {
  if (toISODate(currentDate) !== toISODate(new Date())) return;

  const now = new Date();
  const scrollTo = ((now.getHours() - getCalendarStartHour() - 1) * HOUR_HEIGHT);
  const wrapper = document.querySelector('.cal-grid-wrapper');
  if (wrapper && scrollTo > 0) {
    wrapper.scrollTop = scrollTo;
  }
}

// --- Helpers ---

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDateJP(date) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const dow = DAY_NAMES[date.getDay()];
  return `${y}年${m}月${d}日（${dow}）`;
}

function formatTime(date) {
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
}

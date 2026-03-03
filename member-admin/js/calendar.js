// --- スタッフカレンダー（独自日表示UI + GAS API） ---

import { getStaffCalendars, getCalendarApiUrl, getCalendarStartHour, getCalendarEndHour } from './app-settings.js';

// --- State ---

let currentDate = new Date();
let eventsCache = {};       // { "2026-03-03": { "email": [events] } }
let isFetching = false;

const HOUR_HEIGHT = 60;     // px per hour
const SS_KEY = 'cal_events';
const SS_TS_KEY = 'cal_ts';
const SS_TTL = 10 * 60 * 1000; // 10 min

// --- Helpers ---

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDateLabel(d) {
  const dow = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${dow[d.getDay()]}）`;
}

function isToday(d) {
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
         d.getMonth() === now.getMonth() &&
         d.getDate() === now.getDate();
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function timeToMinutes(isoStr) {
  const d = new Date(isoStr);
  return d.getHours() * 60 + d.getMinutes();
}

function formatTime(isoStr) {
  const d = new Date(isoStr);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// --- Session Storage Cache ---

function loadCacheFromStorage() {
  try {
    const ts = sessionStorage.getItem(SS_TS_KEY);
    if (ts && Date.now() - parseInt(ts, 10) < SS_TTL) {
      const data = sessionStorage.getItem(SS_KEY);
      if (data) {
        eventsCache = JSON.parse(data);
        return;
      }
    }
  } catch (e) { /* ignore */ }
  eventsCache = {};
}

function saveCacheToStorage() {
  try {
    sessionStorage.setItem(SS_KEY, JSON.stringify(eventsCache));
    sessionStorage.setItem(SS_TS_KEY, String(Date.now()));
  } catch (e) { /* ignore */ }
}

// --- API Fetch ---

async function fetchCalendarEvents(dateStr, staffCalendars, forceRefresh = false) {
  // Check cache
  if (!forceRefresh && eventsCache[dateStr]) {
    return eventsCache[dateStr];
  }

  const apiUrl = getCalendarApiUrl();
  if (!apiUrl) return null;

  const emails = staffCalendars.map(s => s.id).join(',');
  const url = `${apiUrl}?date=${dateStr}&emails=${encodeURIComponent(emails)}`;

  isFetching = true;

  try {
    // Try fetch first
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    eventsCache[dateStr] = data.results || {};
    saveCacheToStorage();
    return eventsCache[dateStr];
  } catch (fetchErr) {
    console.warn('Calendar API fetch failed, trying JSONP:', fetchErr.message);

    // JSONP fallback
    return new Promise((resolve, reject) => {
      const cbName = `_calJsonp_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('JSONP timeout'));
      }, 15000);

      function cleanup() {
        clearTimeout(timeout);
        delete window[cbName];
        const el = document.getElementById(cbName);
        if (el) el.remove();
      }

      window[cbName] = (data) => {
        cleanup();
        eventsCache[dateStr] = data.results || {};
        saveCacheToStorage();
        resolve(eventsCache[dateStr]);
      };

      const script = document.createElement('script');
      script.id = cbName;
      script.src = `${url}&callback=${cbName}`;
      script.onerror = () => { cleanup(); reject(new Error('JSONP error')); };
      document.body.appendChild(script);
    });
  } finally {
    isFetching = false;
  }
}

// --- Render ---

export async function renderCalendar() {
  const container = document.getElementById('calendar-content');
  if (!container) return;

  loadCacheFromStorage();

  const apiUrl = getCalendarApiUrl();
  const staffCalendars = getStaffCalendars();

  // API URL 未設定の場合はセットアップ画面を表示
  if (!apiUrl) {
    renderSetupMessage(container);
    return;
  }

  const dateStr = formatDate(currentDate);
  const startHour = getCalendarStartHour();
  const endHour = getCalendarEndHour();
  const totalHours = endHour - startHour;

  // ツールバー
  const todayClass = isToday(currentDate) ? ' disabled' : '';
  const toolbar = `
    <div class="cal-toolbar">
      <div style="display:flex;align-items:center;gap:8px">
        <button class="btn btn-secondary" onclick="window.memberApp.goToCalendarToday()"${todayClass ? ' disabled' : ''}>今日</button>
        <button class="btn-icon" onclick="window.memberApp.navigateCalendarDay(-1)" title="前日">
          <span class="material-icons">chevron_left</span>
        </button>
        <button class="btn-icon" onclick="window.memberApp.navigateCalendarDay(1)" title="翌日">
          <span class="material-icons">chevron_right</span>
        </button>
        <span class="cal-date-label">${formatDateLabel(currentDate)}</span>
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

  // ローディング状態で先にUIを描画
  container.innerHTML = `
    ${toolbar}
    <div class="cal-day-container">
      <div class="cal-day-loading">
        <span class="material-icons spin">sync</span>読み込み中...
      </div>
    </div>`;

  // イベント取得
  let results;
  try {
    results = await fetchCalendarEvents(dateStr, staffCalendars);
  } catch (err) {
    console.error('Calendar API error:', err);
    container.querySelector('.cal-day-container').innerHTML = `
      <div class="cal-day-error">
        <span class="material-icons">error_outline</span>
        <p>カレンダーの読み込みに失敗しました</p>
        <button class="btn btn-secondary" onclick="window.memberApp.refreshCalendar()">再試行</button>
      </div>`;
    return;
  }

  if (!results) {
    container.querySelector('.cal-day-container').innerHTML = `
      <div class="cal-day-error">
        <span class="material-icons">error_outline</span>
        <p>データが取得できませんでした</p>
      </div>`;
    return;
  }

  // ヘッダー: スタッフ名
  const headerCells = staffCalendars.map(s => {
    const hasError = results[s.id]?.error;
    return `<div class="cal-staff-header" style="border-bottom: 3px solid ${s.color}">
      <span class="cal-staff-dot" style="background:${s.color}"></span>
      <span class="cal-staff-name">${escapeHtml(s.name)}</span>
      ${hasError ? '<span class="material-icons" style="font-size:14px;color:var(--warning-color)" title="取得エラー">warning</span>' : ''}
    </div>`;
  }).join('');

  // 時刻ラベル
  const timeLabels = [];
  for (let h = startHour; h <= endHour; h++) {
    timeLabels.push(`<div class="cal-time-label" style="top:${(h - startHour) * HOUR_HEIGHT}px">
      ${String(h).padStart(2, '0')}:00
    </div>`);
  }

  // スタッフカラム + イベント
  const staffColumns = staffCalendars.map(s => {
    const staffEvents = results[s.id]?.events || [];

    // 終日イベントと時間イベントを分離
    const allDayEvents = staffEvents.filter(e => e.isAllDay);
    const timedEvents = staffEvents.filter(e => !e.isAllDay);

    // 時間イベントのブロック
    const eventBlocks = timedEvents.map(ev => {
      const startMin = timeToMinutes(ev.start);
      const endMin = timeToMinutes(ev.end);
      const topPx = ((startMin / 60) - startHour) * HOUR_HEIGHT;
      const heightPx = Math.max(((endMin - startMin) / 60) * HOUR_HEIGHT, 20);

      return `<div class="cal-event" style="top:${topPx}px;height:${heightPx}px;background:${s.color}20;border-left:3px solid ${s.color}" title="${escapeHtml(ev.title)}&#10;${formatTime(ev.start)}〜${formatTime(ev.end)}${ev.location ? '&#10;' + escapeHtml(ev.location) : ''}" onclick="window.memberApp.showCalendarEvent(this)" data-event='${JSON.stringify({ title: ev.title, start: ev.start, end: ev.end, location: ev.location, description: ev.description }).replace(/'/g, '&#39;')}'>
        <div class="cal-event-title">${escapeHtml(ev.title)}</div>
        <div class="cal-event-time">${formatTime(ev.start)}〜${formatTime(ev.end)}</div>
        ${ev.location ? `<div class="cal-event-location">${escapeHtml(ev.location)}</div>` : ''}
      </div>`;
    }).join('');

    // 終日イベント
    const allDayHtml = allDayEvents.map(ev =>
      `<div class="cal-allday-event" style="background:${s.color};color:white">${escapeHtml(ev.title)}</div>`
    ).join('');

    // 時間グリッド線
    const gridLines = [];
    for (let h = startHour; h <= endHour; h++) {
      gridLines.push(`<div class="cal-hour-line" style="top:${(h - startHour) * HOUR_HEIGHT}px"></div>`);
    }

    return `<div class="cal-staff-col">
      ${allDayHtml ? `<div class="cal-allday-area">${allDayHtml}</div>` : ''}
      <div class="cal-col-body" style="height:${totalHours * HOUR_HEIGHT}px">
        ${gridLines.join('')}
        ${eventBlocks}
      </div>
    </div>`;
  }).join('');

  // 現在時刻インジケーター
  let nowIndicator = '';
  if (isToday(currentDate)) {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const nowTop = ((nowMin / 60) - startHour) * HOUR_HEIGHT;
    if (nowTop >= 0 && nowTop <= totalHours * HOUR_HEIGHT) {
      nowIndicator = `<div class="cal-now-line" style="top:${nowTop}px"></div>`;
    }
  }

  // 組み立て
  const dayView = `
    <div class="cal-day-container">
      <div class="cal-day-header">
        <div class="cal-time-gutter-header"></div>
        <div class="cal-staff-headers">${headerCells}</div>
      </div>
      <div class="cal-day-body">
        <div class="cal-time-gutter" style="height:${totalHours * HOUR_HEIGHT}px">
          ${timeLabels.join('')}
        </div>
        <div class="cal-staff-columns">
          ${staffColumns}
          ${nowIndicator}
        </div>
      </div>
    </div>`;

  container.innerHTML = `${toolbar}${dayView}`;

  // 現在時刻付近にスクロール
  if (isToday(currentDate)) {
    requestAnimationFrame(() => {
      const body = container.querySelector('.cal-day-body');
      if (body) {
        const now = new Date();
        const scrollTo = ((now.getHours() - startHour - 1) * HOUR_HEIGHT);
        body.scrollTop = Math.max(0, scrollTo);
      }
    });
  }
}

// --- セットアップ画面 ---

function renderSetupMessage(container) {
  container.innerHTML = `
    <div class="cal-setup-message">
      <span class="material-icons" style="font-size:48px;color:var(--gray-300)">calendar_month</span>
      <h3>スタッフカレンダーの設定が必要です</h3>
      <p>Google Calendar からスタッフの予定を取得するために、GAS スクリプトのデプロイが必要です。</p>
      <ol style="text-align:left;max-width:500px;margin:0 auto">
        <li><code>startus@startus-kanazawa.org</code> で <a href="https://script.google.com" target="_blank">script.google.com</a> にアクセス</li>
        <li>新規プロジェクト作成 → <code>scripts/gas-calendar-api.js</code> のコードを貼り付け</li>
        <li>デプロイ → ウェブアプリ（実行: 自分、アクセス: 全員）</li>
        <li>生成された URL を下記から設定画面に登録</li>
      </ol>
      <div style="margin-top:20px">
        <button class="btn btn-primary" onclick="window.memberApp.switchTab('settings')">
          <span class="material-icons">settings</span>設定画面を開く
        </button>
      </div>
    </div>`;
}

// --- Navigation ---

export function navigateCalendarDay(offset) {
  currentDate = new Date(currentDate.getTime() + offset * 86400000);
  renderCalendar();
}

export function goToCalendarToday() {
  currentDate = new Date();
  renderCalendar();
}

export async function refreshCalendar() {
  const dateStr = formatDate(currentDate);
  delete eventsCache[dateStr];
  try {
    sessionStorage.removeItem(SS_KEY);
    sessionStorage.removeItem(SS_TS_KEY);
  } catch (e) { /* ignore */ }
  await renderCalendar();
}

export function openGoogleCalendar() {
  window.open('https://calendar.google.com/calendar/u/0/r/day', '_blank');
}

// --- Event Detail ---

export function showCalendarEvent(el) {
  try {
    const data = JSON.parse(el.dataset.event);
    const { openModal } = window.memberApp;
    if (!openModal) return;

    const content = `
      <div style="padding:8px 0">
        <h3 style="margin:0 0 12px;font-size:1.1rem">${escapeHtml(data.title)}</h3>
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;color:var(--gray-600)">
          <span class="material-icons" style="font-size:18px">schedule</span>
          ${formatTime(data.start)} 〜 ${formatTime(data.end)}
        </div>
        ${data.location ? `<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;color:var(--gray-600)">
          <span class="material-icons" style="font-size:18px">location_on</span>
          ${escapeHtml(data.location)}
        </div>` : ''}
        ${data.description ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--gray-200);color:var(--gray-600);font-size:0.9rem;white-space:pre-wrap">${escapeHtml(data.description)}</div>` : ''}
      </div>`;

    openModal('予定の詳細', content);
  } catch (e) {
    console.error('Event detail error:', e);
  }
}

// Keep backward compatibility exports
export function changeCalendarMode() {}
export function authorizeCalendar() {}
export function switchCalendarAccount() {}

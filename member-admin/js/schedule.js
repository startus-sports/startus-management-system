// --- 開催スケジュールカレンダー ---

import { SCHEDULE_API_URL, CALENDAR_START_HOUR, CALENDAR_END_HOUR } from './config.js';
import { supabase } from './supabase.js';
import { escapeHtml } from './utils.js';
import { showToast, openModal, closeModal, setModalWide } from './app.js';
import { getClassrooms } from './classroom.js';

// --- State ---

let currentDate = new Date();
let currentView = 'week'; // 'week' | 'month' | 'year'

// 日付ベース統合キャッシュ
let eventsByDate = {};         // { "2026-03-01": [event, ...], ... }
let fetchedDateSet = new Set(); // 取得済み日付のセット
let allFetchedEvents = [];     // flat array of all fetched events (for detail modal)

// アプリデータキャッシュ（範囲管理付き）
let cachedAppData = null;      // { trials, joins, withdrawals, suspensions, reinstatements }
let appDataRange = null;       // { start: "YYYY-MM-DD", end: "YYYY-MM-DD" }

// 教室インデックスキャッシュ
let classroomIndex = null;     // { calendarTag: classroom }

// sessionStorageキー
const SS_EVENTS_KEY = 'sch_events';
const SS_DATES_KEY = 'sch_dates';
const SS_TS_KEY = 'sch_timestamp';
const SS_TTL = 10 * 60 * 1000; // 10分

// --- Constants ---

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
const HOUR_HEIGHT = 60;
const TOTAL_HOURS = CALENDAR_END_HOUR - CALENDAR_START_HOUR;
const VIEW_LABELS = { week: '週', month: '月', year: '年' };

// --- Description Parser ---

function parseEventDescription(desc) {
  if (!desc) return { taikenOk: true, furikaeOk: true, capacity: null, memo: '' };

  let taikenOk = true;
  let furikaeOk = true;
  let capacity = null;
  const memoLines = [];

  const lines = desc.split(/\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#class=/i.test(trimmed)) continue;
    if (/^#taiken=/i.test(trimmed)) {
      taikenOk = !/NG/i.test(trimmed);
      continue;
    }
    if (/^#furikae=/i.test(trimmed)) {
      furikaeOk = !/N[OG]/i.test(trimmed);
      continue;
    }
    if (/^#cap=/i.test(trimmed)) {
      const m = trimmed.match(/#cap=(\d+)/i);
      if (m) capacity = parseInt(m[1], 10);
      continue;
    }
    if (trimmed) memoLines.push(trimmed);
  }

  return { taikenOk, furikaeOk, capacity, memo: memoLines.join('\n') };
}

// --- 教室インデックス ---

function getClassroomIndex() {
  if (!classroomIndex) {
    classroomIndex = {};
    for (const c of getClassrooms()) {
      if (c.calendar_tag) classroomIndex[c.calendar_tag] = c;
    }
  }
  return classroomIndex;
}

function invalidateClassroomIndex() {
  classroomIndex = null;
}

// --- 日付ヘルパー ---

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** 指定範囲内の全日付文字列を生成 */
function getDatesBetween(start, end) {
  const dates = [];
  const d = new Date(start);
  d.setHours(0, 0, 0, 0);
  const endDate = new Date(end);
  endDate.setHours(0, 0, 0, 0);
  while (d <= endDate) {
    dates.push(toISODate(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

/** 指定範囲の全日付がキャッシュ済みか */
function isRangeCached(start, end) {
  const dates = getDatesBetween(start, end);
  return dates.every(d => fetchedDateSet.has(d));
}

/** キャッシュから指定範囲のイベントを取得 */
function getEventsFromCache(start, end) {
  const dates = getDatesBetween(start, end);
  const events = [];
  for (const d of dates) {
    if (eventsByDate[d]) {
      events.push(...eventsByDate[d]);
    }
  }
  return events;
}

/** イベントを日付マップに格納 */
function storeEventsInCache(items, start, end) {
  // 範囲内の全日付をマーク（イベントなしの日も取得済みとする）
  const dates = getDatesBetween(start, end);
  for (const d of dates) {
    if (!eventsByDate[d]) eventsByDate[d] = [];
    fetchedDateSet.add(d);
  }
  // イベントを日付別に振り分け
  for (const item of items) {
    const dateKey = item.start ? toISODate(new Date(item.start)) : null;
    if (dateKey && eventsByDate[dateKey] !== undefined) {
      // 重複チェック
      if (!eventsByDate[dateKey].some(e => e.id === item.id)) {
        eventsByDate[dateKey].push(item);
      }
    } else if (dateKey) {
      eventsByDate[dateKey] = [item];
      fetchedDateSet.add(dateKey);
    }
  }
  // allFetchedEvents を更新（モーダル用）
  const allIds = new Set(allFetchedEvents.map(e => e.id));
  for (const item of items) {
    if (!allIds.has(item.id)) {
      allFetchedEvents.push(item);
    }
  }
}

// --- Data Fetching: GAS API ---

async function fetchScheduleEvents(startDate, endDate) {
  const startStr = toISODate(startDate);
  const endStr = toISODate(endDate);

  // 既にキャッシュ済みならローカルから返す
  if (isRangeCached(startDate, endDate)) {
    return getEventsFromCache(startDate, endDate);
  }

  const url = `${SCHEDULE_API_URL}?start_date=${startStr}&end_date=${endStr}`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const items = data.items || [];
    storeEventsInCache(items, startDate, endDate);
    return getEventsFromCache(startDate, endDate);
  } catch (fetchErr) {
    // Fallback to JSONP
    try {
      const data = await fetchViaJsonp(url);
      const items = data.items || [];
      storeEventsInCache(items, startDate, endDate);
      return getEventsFromCache(startDate, endDate);
    } catch (jsonpErr) {
      console.error('Schedule API error:', fetchErr, jsonpErr);
      showToast('スケジュールの読み込みに失敗しました', 'error');
      return getEventsFromCache(startDate, endDate);
    }
  }
}

function fetchViaJsonp(url) {
  return new Promise((resolve, reject) => {
    const callbackName = `_schJsonp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const script = document.createElement('script');

    const cleanup = () => {
      delete window[callbackName];
      if (script.parentNode) script.remove();
    };

    window[callbackName] = (data) => {
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error('JSONP request failed'));
    };

    const sep = url.includes('?') ? '&' : '?';
    script.src = `${url}${sep}callback=${callbackName}`;
    document.head.appendChild(script);

    setTimeout(() => {
      if (window[callbackName]) {
        cleanup();
        reject(new Error('JSONP timeout'));
      }
    }, 15000);
  });
}

// --- Data Fetching: Application Counts ---

async function fetchApplicationCounts(startDate, endDate) {
  const startStr = toISODate(startDate);
  const endStr = toISODate(endDate);

  // 既にカバーされている範囲ならキャッシュを返す
  if (cachedAppData && appDataRange &&
      appDataRange.start <= startStr && appDataRange.end >= endStr) {
    return cachedAppData;
  }

  // 範囲を拡大（既存キャッシュとマージ）
  const fetchStart = appDataRange ? (startStr < appDataRange.start ? startStr : appDataRange.start) : startStr;
  const fetchEnd = appDataRange ? (endStr > appDataRange.end ? endStr : appDataRange.end) : endStr;

  const [trialsRes, joinsRes, withdrawalsRes, suspensionsRes, reinstatementsRes] = await Promise.all([
    supabase
      .from('applications')
      .select('id, type, status, form_data, created_at')
      .eq('type', 'trial')
      .gte('created_at', `${fetchStart}T00:00:00`)
      .lte('created_at', `${fetchEnd}T23:59:59`),
    supabase
      .from('applications')
      .select('id, type, status, form_data, created_at')
      .eq('type', 'join')
      .gte('created_at', `${fetchStart}T00:00:00`)
      .lte('created_at', `${fetchEnd}T23:59:59`),
    supabase
      .from('applications')
      .select('id, type, status, form_data, created_at')
      .eq('type', 'withdrawal')
      .gte('created_at', `${fetchStart}T00:00:00`)
      .lte('created_at', `${fetchEnd}T23:59:59`),
    supabase
      .from('applications')
      .select('id, type, status, form_data, created_at')
      .eq('type', 'suspension')
      .gte('created_at', `${fetchStart}T00:00:00`)
      .lte('created_at', `${fetchEnd}T23:59:59`),
    supabase
      .from('applications')
      .select('id, type, status, form_data, created_at')
      .eq('type', 'reinstatement')
      .gte('created_at', `${fetchStart}T00:00:00`)
      .lte('created_at', `${fetchEnd}T23:59:59`),
  ]);

  cachedAppData = {
    trials: trialsRes.data || [],
    joins: joinsRes.data || [],
    withdrawals: withdrawalsRes.data || [],
    suspensions: suspensionsRes.data || [],
    reinstatements: reinstatementsRes.data || [],
  };
  appDataRange = { start: fetchStart, end: fetchEnd };

  return cachedAppData;
}

// --- Enrichment ---

function enrichEvent(event) {
  const idx = getClassroomIndex();
  const classroom = idx[event.class] || null;
  const parsed = parseEventDescription(event.description);

  return {
    ...event,
    classroom,
    classroomName: classroom?.name || '',
    eventTitle: event.title || '',
    venue: event.location || classroom?.venue || '',
    mainCoach: classroom?.main_coach || '',
    patrolCoach: classroom?.patrol_coach || '',
    timeSlot: formatTimeRange(new Date(event.start), new Date(event.end)),
    taikenOk: parsed.taikenOk,
    furikaeOk: parsed.furikaeOk,
    capacity: parsed.capacity ?? classroom?.capacity ?? null,
    memo: parsed.memo,
  };
}

function getTrialsForEvent(enrichedEvent, appData) {
  if (!appData || !enrichedEvent.classroom) return [];
  const eventDate = toISODate(new Date(enrichedEvent.start));
  const classroomName = enrichedEvent.classroomName;

  return appData.trials.filter(t => {
    const fd = t.form_data || {};
    const desiredDate = fd.desired_date || '';
    const desiredClasses = Array.isArray(fd.desired_classes)
      ? fd.desired_classes
      : [fd.desired_classes].filter(Boolean);

    const dateMatch = desiredDate === eventDate ||
      desiredDate.replace(/\//g, '-') === eventDate;
    const classMatch = classroomName && desiredClasses.some(c =>
      c === classroomName || c.includes(classroomName) || classroomName.includes(c)
    );

    return dateMatch && classMatch;
  });
}

function getJoinsForClass(enrichedEvent, appData) {
  if (!appData || !enrichedEvent.classroom) return [];
  const classroomName = enrichedEvent.classroomName;

  return appData.joins.filter(j => {
    const fd = j.form_data || {};
    const desiredClasses = Array.isArray(fd.desired_classes)
      ? fd.desired_classes
      : [fd.desired_classes].filter(Boolean);
    return classroomName && desiredClasses.some(c =>
      c === classroomName || c.includes(classroomName) || classroomName.includes(c)
    );
  });
}

function getWithdrawalsForClass(enrichedEvent, appData) {
  if (!appData || !enrichedEvent.classroom) return [];
  const classroomName = enrichedEvent.classroomName;

  return appData.withdrawals.filter(w => {
    const fd = w.form_data || {};
    const classes = fd.classes || fd.desired_classes || [];
    const classList = Array.isArray(classes) ? classes : [classes].filter(Boolean);
    return classroomName && classList.some(c =>
      c === classroomName || c.includes(classroomName) || classroomName.includes(c)
    );
  });
}

function getSuspensionsForClass(enrichedEvent, appData) {
  if (!appData || !appData.suspensions || !enrichedEvent.classroom) return [];
  const classroomName = enrichedEvent.classroomName;

  return appData.suspensions.filter(s => {
    const fd = s.form_data || {};
    const desiredClasses = Array.isArray(fd.desired_classes)
      ? fd.desired_classes
      : [fd.desired_classes].filter(Boolean);
    return classroomName && desiredClasses.some(c =>
      c === classroomName || c.includes(classroomName) || classroomName.includes(c)
    );
  });
}

function getReinstatementsForClass(enrichedEvent, appData) {
  if (!appData || !appData.reinstatements || !enrichedEvent.classroom) return [];
  const classroomName = enrichedEvent.classroomName;

  return appData.reinstatements.filter(r => {
    const fd = r.form_data || {};
    const desiredClasses = Array.isArray(fd.desired_classes)
      ? fd.desired_classes
      : [fd.desired_classes].filter(Boolean);
    return classroomName && desiredClasses.some(c =>
      c === classroomName || c.includes(classroomName) || classroomName.includes(c)
    );
  });
}

// --- Main Render ---

export async function renderSchedule() {
  const container = document.getElementById('schedule-content');
  if (!container) return;

  const { start, end } = getDateRange(currentDate, currentView);
  // Extend range a bit for month boundary events
  const fetchStart = new Date(start);
  fetchStart.setDate(fetchStart.getDate() - 7);
  const fetchEnd = new Date(end);
  fetchEnd.setDate(fetchEnd.getDate() + 7);

  const hasCachedData = isRangeCached(fetchStart, fetchEnd);

  if (hasCachedData) {
    // キャッシュヒット: ローディング表示なしで即座にレンダリング
    const events = getEventsFromCache(fetchStart, fetchEnd);
    const appData = cachedAppData || null;
    renderView(container, events, appData);
  } else {
    // キャッシュミス: ツールバーを先に表示し、コンテンツ部分のみローディング
    const toolbar = renderScheduleToolbar();
    container.innerHTML = toolbar + `
      <div id="schedule-view-content">
        <div class="sch-loading">
          <span class="material-icons cal-spinner" style="font-size:32px;color:var(--gray-300)">sync</span>
          <p>スケジュールを読み込み中...</p>
        </div>
      </div>`;

    try {
      const [events, appData] = await Promise.all([
        fetchScheduleEvents(fetchStart, fetchEnd),
        fetchApplicationCounts(fetchStart, fetchEnd),
      ]);

      renderView(container, events, appData);
    } catch (err) {
      console.error('Schedule render error:', err);
      const viewContent = document.getElementById('schedule-view-content');
      if (viewContent) {
        viewContent.innerHTML = `
          <div class="sch-loading">
            <span class="material-icons" style="font-size:48px;color:var(--gray-300)">error_outline</span>
            <p>スケジュールの読み込みに失敗しました</p>
            <button class="btn btn-primary" onclick="window.memberApp.refreshSchedule()" style="margin-top:12px">
              <span class="material-icons">refresh</span>再試行
            </button>
          </div>`;
      }
    }
  }

  // 隣接期間をバックグラウンドでプリフェッチ
  prefetchAdjacentRange(currentDate, currentView);
}

/** ビューをレンダリング（キャッシュ済みでもフェッチ後でも共通） */
function renderView(container, events, appData) {
  const toolbar = renderScheduleToolbar();
  let viewHtml = '';

  switch (currentView) {
    case 'week':
      viewHtml = renderWeekView(events, appData);
      break;
    case 'month':
      viewHtml = renderMonthView(events, appData);
      break;
    case 'year':
      viewHtml = renderYearView(events);
      break;
  }

  container.innerHTML = toolbar + `<div id="schedule-view-content">${viewHtml}</div>`;
}

// --- プリフェッチ ---

function prefetchAdjacentRange(date, view) {
  const ranges = [];

  switch (view) {
    case 'week': {
      const prevWeekStart = new Date(getWeekStart(date));
      prevWeekStart.setDate(prevWeekStart.getDate() - 7);
      const prevWeekEnd = new Date(prevWeekStart);
      prevWeekEnd.setDate(prevWeekEnd.getDate() + 6);
      const nextWeekStart = new Date(getWeekStart(date));
      nextWeekStart.setDate(nextWeekStart.getDate() + 7);
      const nextWeekEnd = new Date(nextWeekStart);
      nextWeekEnd.setDate(nextWeekEnd.getDate() + 6);
      ranges.push({ start: prevWeekStart, end: prevWeekEnd }, { start: nextWeekStart, end: nextWeekEnd });
      break;
    }
    case 'month': {
      const prevMonth = new Date(date.getFullYear(), date.getMonth() - 1, 1);
      const prevMonthEnd = new Date(date.getFullYear(), date.getMonth(), 0);
      const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1);
      const nextMonthEnd = new Date(date.getFullYear(), date.getMonth() + 2, 0);
      ranges.push({ start: prevMonth, end: prevMonthEnd }, { start: nextMonth, end: nextMonthEnd });
      break;
    }
    // year: プリフェッチ不要（範囲が広すぎる）
  }

  for (const range of ranges) {
    if (!isRangeCached(range.start, range.end)) {
      // fire-and-forget: バックグラウンドでフェッチ
      fetchScheduleEvents(range.start, range.end).catch(() => {});
    }
  }
}

// --- Toolbar ---

function renderScheduleToolbar() {
  const dateLabel = getDateLabel(currentDate, currentView);
  const viewBtns = Object.entries(VIEW_LABELS).map(([key, label]) =>
    `<button class="sch-view-btn ${currentView === key ? 'active' : ''}"
      onclick="window.memberApp.changeScheduleView('${key}')">${label}</button>`
  ).join('');

  return `
    <div class="sch-toolbar">
      <div class="sch-toolbar-left">
        <button class="btn btn-secondary" onclick="window.memberApp.goToScheduleToday()">
          <span class="material-icons">today</span>今日
        </button>
        <button class="btn-icon" onclick="window.memberApp.navigateSchedule(-1)" title="前へ">
          <span class="material-icons">chevron_left</span>
        </button>
        <button class="btn-icon" onclick="window.memberApp.navigateSchedule(1)" title="次へ">
          <span class="material-icons">chevron_right</span>
        </button>
        <span class="sch-date-label">${escapeHtml(dateLabel)}</span>
      </div>
      <div class="sch-toolbar-right">
        <div class="sch-view-toggle">${viewBtns}</div>
        <button class="btn-icon" onclick="window.memberApp.refreshSchedule()" title="更新">
          <span class="material-icons">refresh</span>
        </button>
      </div>
    </div>`;
}

// --- Week View ---

function renderWeekView(events, appData) {
  const weekStart = getWeekStart(currentDate);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  const columnsHtml = days.map(day => {
    const dayEvents = events
      .filter(e => isSameDay(new Date(e.start), day))
      .map(e => enrichEvent(e))
      .sort((a, b) => new Date(a.start) - new Date(b.start));

    const isToday = isSameDay(day, new Date());
    const dayLabel = `${day.getMonth() + 1}/${day.getDate()}`;
    const dowLabel = DAY_NAMES[day.getDay()];

    const eventCards = dayEvents.map(e => {
      const trials = getTrialsForEvent(e, appData);
      const joins = getJoinsForClass(e, appData);
      const withdrawals = getWithdrawalsForClass(e, appData);
      const suspensions = getSuspensionsForClass(e, appData);
      const reinstatements = getReinstatementsForClass(e, appData);

      return `
        <div class="sch-week-card" onclick="window.memberApp.showScheduleEventDetail('${escapeHtml(e.id)}')">
          <div class="sch-week-card-title">${escapeHtml(e.eventTitle)}</div>
          <div class="sch-week-card-time">${escapeHtml(e.timeSlot)}</div>
          ${e.venue ? `<div class="sch-week-card-venue">${escapeHtml(e.venue)}</div>` : ''}
          <div class="sch-week-card-meta">
            ${e.mainCoach ? `<span class="sch-meta-coach">${escapeHtml(e.mainCoach)}</span>` : ''}
            ${!e.taikenOk ? '<span class="sch-tag-ng-sm">体験NG</span>' : ''}
            ${!e.furikaeOk ? '<span class="sch-tag-ng-sm">振替NG</span>' : ''}
          </div>
          <div class="sch-event-counts">
            ${trials.length > 0 ? `<span class="sch-count sch-count-trial">体験${trials.length}</span>` : ''}
            ${joins.length > 0 ? `<span class="sch-count sch-count-join">入会${joins.length}</span>` : ''}
            ${withdrawals.length > 0 ? `<span class="sch-count sch-count-withdrawal">退会${withdrawals.length}</span>` : ''}
            ${suspensions.length > 0 ? `<span class="sch-count sch-count-suspension">休会${suspensions.length}</span>` : ''}
            ${reinstatements.length > 0 ? `<span class="sch-count sch-count-reinstatement">復会${reinstatements.length}</span>` : ''}
          </div>
          ${e.memo ? `<div class="sch-week-card-memo">${escapeHtml(e.memo)}</div>` : ''}
        </div>`;
    }).join('');

    return `
      <div class="sch-week-col ${isToday ? 'sch-week-today' : ''}">
        <div class="sch-week-header">
          <span class="sch-week-dow">${dowLabel}</span>
          <span class="sch-week-date ${isToday ? 'sch-today-circle' : ''}">${dayLabel}</span>
        </div>
        <div class="sch-week-body">
          ${eventCards || '<div class="sch-week-empty"></div>'}
        </div>
      </div>`;
  }).join('');

  return `<div class="sch-week-grid">${columnsHtml}</div>`;
}

// --- Month View ---

function renderMonthView(events, appData) {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1);

  // Start from Monday
  const startOffset = (firstDay.getDay() + 6) % 7;
  const gridStart = new Date(firstDay);
  gridStart.setDate(gridStart.getDate() - startOffset);

  let cellsHtml = '';
  for (let i = 0; i < 42; i++) {
    const cellDate = new Date(gridStart);
    cellDate.setDate(cellDate.getDate() + i);
    const isCurrentMonth = cellDate.getMonth() === month;
    const isToday = isSameDay(cellDate, new Date());

    const dayEvents = events
      .filter(e => isSameDay(new Date(e.start), cellDate))
      .map(e => enrichEvent(e));

    const chips = dayEvents.slice(0, 3).map(e =>
      `<div class="sch-month-chip" onclick="event.stopPropagation();window.memberApp.showScheduleEventDetail('${escapeHtml(e.id)}')" title="${escapeHtml(e.eventTitle)} ${escapeHtml(e.timeSlot)}">
        ${escapeHtml(truncate(e.eventTitle, 10))}
      </div>`
    ).join('');
    const more = dayEvents.length > 3
      ? `<div class="sch-month-more">+${dayEvents.length - 3}件</div>`
      : '';

    const dateNum = cellDate.getDate();
    const dateStr = toISODate(cellDate);

    cellsHtml += `
      <div class="sch-month-cell ${isCurrentMonth ? '' : 'sch-month-other'} ${isToday ? 'sch-month-today' : ''}"
           onclick="window.memberApp.navigateScheduleToDate('${dateStr}','week')">
        <div class="sch-month-date">${dateNum}</div>
        ${chips}${more}
      </div>`;
  }

  const headerHtml = ['月', '火', '水', '木', '金', '土', '日'].map(d =>
    `<div class="sch-month-header-cell">${d}</div>`
  ).join('');

  return `
    <div class="sch-month-grid">
      <div class="sch-month-header-row">${headerHtml}</div>
      <div class="sch-month-body">${cellsHtml}</div>
    </div>`;
}

// --- Year View ---

function renderYearView(events) {
  const year = currentDate.getFullYear();

  const monthsHtml = Array.from({ length: 12 }, (_, m) => {
    const lastDay = new Date(year, m + 1, 0).getDate();

    // Day of week offset for first day (Monday = 0)
    const firstDow = (new Date(year, m, 1).getDay() + 6) % 7;
    const blanks = Array.from({ length: firstDow }, () =>
      '<div class="sch-year-day sch-year-blank"></div>'
    ).join('');

    const dayCells = Array.from({ length: lastDay }, (_, d) => {
      const date = new Date(year, m, d + 1);
      const count = events.filter(e => isSameDay(new Date(e.start), date)).length;
      const intensity = count === 0 ? '' : count <= 2 ? 'sch-year-low' : count <= 5 ? 'sch-year-mid' : 'sch-year-high';
      const isToday = isSameDay(date, new Date());
      const dateStr = toISODate(date);

      return `<div class="sch-year-day ${intensity} ${isToday ? 'sch-year-today' : ''}"
        title="${m + 1}/${d + 1}: ${count}件"
        onclick="window.memberApp.navigateScheduleToDate('${dateStr}','week')">${d + 1}</div>`;
    }).join('');

    // Weekday header
    const dowHeader = ['月', '火', '水', '木', '金', '土', '日'].map(d =>
      `<div class="sch-year-dow-header">${d}</div>`
    ).join('');

    return `
      <div class="sch-year-month" onclick="window.memberApp.navigateScheduleToDate('${year}-${String(m + 1).padStart(2, '0')}-01','month')">
        <div class="sch-year-month-label">${m + 1}月</div>
        <div class="sch-year-dow-row">${dowHeader}</div>
        <div class="sch-year-days">${blanks}${dayCells}</div>
      </div>`;
  }).join('');

  return `<div class="sch-year-grid">${monthsHtml}</div>`;
}

// --- Event Detail Modal ---

// タイプ別の概要表示フィールド（プライバシー保護: 住所・電話・メール等は除外）
const SUMMARY_FIELDS = {
  trial: [
    { key: 'desired_date', label: '希望日' },
    { key: 'desired_classes', label: '希望教室' },
    { key: 'omoi', label: '想い' },
  ],
  join: [
    { key: 'grade', label: '学年' },
    { key: 'school', label: '学校' },
    { key: 'desired_classes', label: '希望教室' },
  ],
  withdrawal: [
    { key: 'desired_classes', label: '退会教室' },
    { key: 'last_date', label: '最終参加予定日' },
    { key: 'reason', label: '退会理由' },
  ],
  suspension: [
    { key: 'desired_classes', label: '対象教室' },
    { key: 'start_date', label: '休会開始予定日' },
    { key: 'return_date', label: '復会予定日' },
    { key: 'reason', label: '休会理由' },
  ],
  reinstatement: [
    { key: 'desired_classes', label: '対象教室' },
    { key: 'return_date', label: '復会予定日' },
  ],
};

const TYPE_LABELS = {
  trial: '体験', join: '入会', withdrawal: '退会',
  suspension: '休会', reinstatement: '復会',
};

function renderAppSummaryCard(app, type) {
  const fd = app.form_data || {};
  const fields = SUMMARY_FIELDS[type] || [];
  const detailFunc = type === 'trial' ? 'showTrialDetail' : 'showApplicationDetail';

  const fieldsHtml = fields.map(f => {
    let value = fd[f.key];
    if (Array.isArray(value)) value = value.join('、');
    if (!value) return '';
    return `<div class="sch-summary-field">
      <span class="sch-summary-label">${escapeHtml(f.label)}</span>
      <span class="sch-summary-value">${escapeHtml(String(value))}</span>
    </div>`;
  }).filter(Boolean).join('');

  return `
    <div class="sch-summary-card" id="sch-summary-${app.id}">
      ${fieldsHtml || '<p class="text-muted" style="margin:0;font-size:0.8rem">概要情報なし</p>'}
      <button class="sch-summary-btn" onclick="event.stopPropagation();window.memberApp.${detailFunc}('${app.id}')">
        <span class="material-icons" style="font-size:16px">open_in_new</span>
        詳細を見る
      </button>
    </div>`;
}

function renderAppRow(app, type) {
  return `
    <div class="sch-detail-app-wrapper">
      <div class="sch-detail-app-row" onclick="window.memberApp.toggleAppSummary('${app.id}', '${type}')">
        <span>${escapeHtml(app.form_data?.name || '---')}</span>
        <div class="sch-detail-app-row-right">
          <span class="badge badge-app-${app.status}">${escapeHtml(statusLabel(app.status))}</span>
          <span class="material-icons sch-detail-app-chevron" id="sch-chevron-${app.id}" style="font-size:18px;color:var(--gray-400)">expand_more</span>
        </div>
      </div>
      <div class="sch-summary-slot" id="sch-slot-${app.id}"></div>
    </div>`;
}

export function toggleAppSummary(appId, type) {
  const slot = document.getElementById(`sch-slot-${appId}`);
  const chevron = document.getElementById(`sch-chevron-${appId}`);
  if (!slot) return;

  if (slot.innerHTML.trim()) {
    // 閉じる
    slot.innerHTML = '';
    if (chevron) chevron.textContent = 'expand_more';
  } else {
    // 開く: アプリデータを探す
    const allApps = cachedAppData
      ? [...(cachedAppData.trials || []), ...(cachedAppData.joins || []),
         ...(cachedAppData.withdrawals || []), ...(cachedAppData.suspensions || []),
         ...(cachedAppData.reinstatements || [])]
      : [];
    const app = allApps.find(a => a.id === appId);
    if (!app) return;

    slot.innerHTML = renderAppSummaryCard(app, type);
    if (chevron) chevron.textContent = 'expand_less';
  }
}

export function showScheduleEventDetail(eventId) {
  const event = allFetchedEvents.find(e => e.id === eventId);
  if (!event) return;

  const e = enrichEvent(event);
  const trials = cachedAppData ? getTrialsForEvent(e, cachedAppData) : [];
  const joins = cachedAppData ? getJoinsForClass(e, cachedAppData) : [];
  const withdrawals = cachedAppData ? getWithdrawalsForClass(e, cachedAppData) : [];
  const suspensions = cachedAppData ? getSuspensionsForClass(e, cachedAppData) : [];
  const reinstatements = cachedAppData ? getReinstatementsForClass(e, cachedAppData) : [];

  const eventDate = new Date(e.start);
  const dateLabel = `${eventDate.getFullYear()}年${eventDate.getMonth() + 1}月${eventDate.getDate()}日（${DAY_NAMES[eventDate.getDay()]}）`;

  const trialRows = trials.length > 0
    ? trials.map(t => renderAppRow(t, 'trial')).join('')
    : '<p class="text-muted">なし</p>';

  const joinRows = joins.length > 0
    ? joins.map(j => renderAppRow(j, 'join')).join('')
    : '<p class="text-muted">なし</p>';

  const withdrawalRows = withdrawals.length > 0
    ? withdrawals.map(w => renderAppRow(w, 'withdrawal')).join('')
    : '<p class="text-muted">なし</p>';

  const suspensionRows = suspensions.length > 0
    ? suspensions.map(s => renderAppRow(s, 'suspension')).join('')
    : '<p class="text-muted">なし</p>';

  const reinstatementRows = reinstatements.length > 0
    ? reinstatements.map(r => renderAppRow(r, 'reinstatement')).join('')
    : '<p class="text-muted">なし</p>';

  const content = `
    <div class="sch-detail">
      <div class="sch-detail-header">
        <h3>${escapeHtml(e.eventTitle)}</h3>
        <p class="text-muted">${escapeHtml(dateLabel)}</p>
      </div>

      <div class="detail-grid">
        ${e.classroomName ? `<div class="detail-row"><span class="detail-label">教室</span><span class="detail-value"><strong>${escapeHtml(e.classroomName)}</strong></span></div>` : ''}
        <div class="detail-row"><span class="detail-label">時間</span><span class="detail-value">${escapeHtml(e.timeSlot)}</span></div>
        <div class="detail-row"><span class="detail-label">会場</span><span class="detail-value">${escapeHtml(e.venue || '---')}</span></div>
        <div class="detail-row"><span class="detail-label">担当コーチ</span><span class="detail-value">${escapeHtml(e.mainCoach || '---')}</span></div>
        <div class="detail-row"><span class="detail-label">巡回者</span><span class="detail-value">${escapeHtml(e.patrolCoach || '---')}</span></div>
        <div class="detail-row"><span class="detail-label">体験</span><span class="detail-value">${e.taikenOk ? '<span class="sch-tag-ok">OK</span>' : '<span class="sch-tag-ng">NG</span>'}</span></div>
        <div class="detail-row"><span class="detail-label">振替</span><span class="detail-value">${e.furikaeOk ? '<span class="sch-tag-ok">OK</span>' : '<span class="sch-tag-ng">NG</span>'}</span></div>
        ${e.capacity != null ? `<div class="detail-row"><span class="detail-label">定員</span><span class="detail-value">${e.capacity}名</span></div>` : ''}
      </div>

      ${e.memo ? `
        <div class="sch-detail-section">
          <h4>メモ</h4>
          <p class="sch-detail-memo-text">${escapeHtml(e.memo)}</p>
        </div>` : ''}

      <div class="sch-detail-section">
        <h4>体験申込 (${trials.length}件)</h4>
        ${trialRows}
      </div>

      <div class="sch-detail-section">
        <h4>入会申請 (${joins.length}件)</h4>
        ${joinRows}
      </div>

      <div class="sch-detail-section">
        <h4>退会申請 (${withdrawals.length}件)</h4>
        ${withdrawalRows}
      </div>

      <div class="sch-detail-section">
        <h4>休会申請 (${suspensions.length}件)</h4>
        ${suspensionRows}
      </div>

      <div class="sch-detail-section">
        <h4>復会申請 (${reinstatements.length}件)</h4>
        ${reinstatementRows}
      </div>
    </div>`;

  openModal('スケジュール詳細', content);
  setModalWide(false);
}

// --- Navigation ---

export function navigateSchedule(offset) {
  switch (currentView) {
    case 'week':
      currentDate.setDate(currentDate.getDate() + offset * 7);
      break;
    case 'month':
      currentDate.setMonth(currentDate.getMonth() + offset);
      break;
    case 'year':
      currentDate.setFullYear(currentDate.getFullYear() + offset);
      break;
  }
  renderSchedule();
}

export function goToScheduleToday() {
  currentDate = new Date();
  renderSchedule();
}

export function refreshSchedule() {
  eventsByDate = {};
  fetchedDateSet.clear();
  allFetchedEvents = [];
  cachedAppData = null;
  appDataRange = null;
  classroomIndex = null;
  renderSchedule();
}

export function changeScheduleView(view) {
  if (currentView === view) return;
  currentView = view;
  renderSchedule();
}

export function navigateScheduleToDate(dateStr, view) {
  currentDate = new Date(dateStr + 'T00:00:00');
  if (view) currentView = view;
  renderSchedule();
}

// --- Helpers ---

function formatTimeRange(start, end) {
  return `${formatTime(start)}〜${formatTime(end)}`;
}

function formatTime(date) {
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function getDateLabel(date, view) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;

  switch (view) {
    case 'week': {
      const ws = getWeekStart(date);
      const we = new Date(ws);
      we.setDate(we.getDate() + 6);
      const wsm = ws.getMonth() + 1;
      const wem = we.getMonth() + 1;
      if (wsm === wem) {
        return `${ws.getFullYear()}年${wsm}月${ws.getDate()}日〜${we.getDate()}日`;
      }
      return `${ws.getFullYear()}年${wsm}月${ws.getDate()}日〜${wem}月${we.getDate()}日`;
    }
    case 'month':
      return `${y}年${m}月`;
    case 'year':
      return `${y}年`;
  }
}

function getDateRange(date, view) {
  switch (view) {
    case 'week': {
      const start = getWeekStart(date);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      return { start, end };
    }
    case 'month': {
      const start = new Date(date.getFullYear(), date.getMonth(), 1);
      const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
      return { start, end };
    }
    case 'year': {
      const start = new Date(date.getFullYear(), 0, 1);
      const end = new Date(date.getFullYear(), 11, 31);
      return { start, end };
    }
  }
}

function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
}

function statusLabel(status) {
  const labels = {
    pending: '未対応',
    reviewed: '確認済み',
    approved: '承認',
    rejected: '却下',
    enrolled: '入会済み',
  };
  return labels[status] || status;
}

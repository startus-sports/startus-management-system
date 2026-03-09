// sm-calendar-view.js
// スケジュール管理タブ カレンダービュー（FullCalendar v6）

import { escapeHtml, formatTime, formatDateJP } from './sm-utils.js';
import { smGetSchedules, smUpdateSchedule, smPatchCache } from './sm-store.js';
import {
  smRenderFromCache,
  getSmCalendarClassFilter,
  getSmCalendarStatusFilters,
  smIsAdmin,
} from './sm-manager.js';
import { openSmScheduleDetail } from './sm-views.js';
import { showToast, openModal } from './app.js';
import { isGCalReady } from './sm-gcal-stub.js';

// --- FullCalendar インスタンス ---
let calendar = null;

// --- 初期化 ---

export function initSmCalendar() {
  const calendarEl = document.getElementById('sm-fullcalendar');
  if (!calendarEl) return;

  const editable = smIsAdmin();

  calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    locale: 'ja',
    height: 'auto',
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'dayGridWeek,dayGridMonth,multiMonthYear',
    },
    buttonText: {
      today: '今日',
      week: '週',
      month: '月',
      year: '年',
    },
    editable,
    eventStartEditable: editable,
    eventDurationEditable: false,
    dayMaxEvents: 4,

    // ドラッグ&ドロップ（管理者のみ）
    eventDrop: async (info) => {
      const id = info.event.id;
      const newDate = formatFCDate(info.event.start);
      const schedule = smGetSchedules().find(s => s.id === id);
      const prevDate = schedule?.date;

      smPatchCache(id, { date: newDate });
      smRenderFromCache();

      const { error } = await smUpdateSchedule(id, { date: newDate });
      if (error) {
        smPatchCache(id, { date: prevDate });
        smRenderFromCache();
        showToast('日付変更に失敗しました', 'error');
        info.revert();
        return;
      }
      showToast('日付を変更しました', 'success');
    },

    // イベントクリック
    eventClick: (info) => {
      info.jsEvent.preventDefault();
      if (!smIsAdmin()) {
        openSmReadonlyDetail(info.event.id);
      } else {
        openSmScheduleDetail(info.event.id);
      }
    },

    // 空日付クリック（管理者のみ新規追加）
    dateClick: (info) => {
      if (!smIsAdmin()) return;
      window.app.openSmAddScheduleForm(info.dateStr);
    },

    eventDidMount: (info) => {
      const props = info.event.extendedProps;
      info.el.title = `${props.className} ${props.timeStr || ''}`;
    },
  });

  calendar.render();

  // FullCalendarのfciconsフォントが読み込めない場合の対策:
  // prev/nextボタンのアイコンをMaterial Iconsに差し替え
  fixCalendarNavIcons(calendarEl);
}

function fixCalendarNavIcons(el) {
  const prevBtn = el.querySelector('.fc-prev-button');
  const nextBtn = el.querySelector('.fc-next-button');
  if (prevBtn) prevBtn.innerHTML = '<span class="material-icons" style="font-size:20px">chevron_left</span>';
  if (nextBtn) nextBtn.innerHTML = '<span class="material-icons" style="font-size:20px">chevron_right</span>';
}

// --- 日付フォーマット ---

function formatFCDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// --- イベントリフレッシュ ---

export function refreshSmCalendarEvents() {
  if (!calendar) return;

  const schedules    = smGetSchedules();
  const classFilter  = getSmCalendarClassFilter();
  const statusFilters = getSmCalendarStatusFilters();

  let filtered = schedules;
  if (classFilter) {
    filtered = filtered.filter(s => s.class_name === classFilter);
  }
  if (statusFilters.size < 4) {
    filtered = filtered.filter(s => {
      const key = s.status === 'confirmed' && s.is_published ? 'published' : s.status;
      return statusFilters.has(key);
    });
  }

  const events = filtered.map(s => {
    const color   = getSmEventColor(s.status, s.is_published);
    const timeStr = s.start_time ? formatTime(s.start_time) : '';
    const lockIcon = !s.is_published ? '\u{1F512} ' : '';

    return {
      id:          s.id,
      title:       `${lockIcon}${s.class_name}${timeStr ? ' ' + timeStr : ''}`,
      start:       s.date,
      allDay:      true,
      backgroundColor: color.bg,
      borderColor:     color.border,
      textColor:       color.text,
      classNames:      [color.className],
      extendedProps: {
        className:   s.class_name,
        status:      s.status,
        isPublished: s.is_published,
        coachName:   s.coach_name,
        timeStr,
      },
    };
  });

  calendar.removeAllEvents();
  calendar.addEventSource(events);
}

// --- イベント色分け ---

function getSmEventColor(status, isPublished) {
  if (status === 'canceled') {
    return { bg: '#f3f4f6', border: '#9ca3af', text: '#6b7280', className: 'fc-event-canceled' };
  }
  if (status === 'confirmed' && isPublished) {
    return { bg: '#22c55e', border: '#16a34a', text: '#ffffff', className: 'fc-event-published' };
  }
  if (status === 'confirmed') {
    return { bg: '#3b82f6', border: '#2563eb', text: '#ffffff', className: 'fc-event-confirmed' };
  }
  return { bg: '#fefce8', border: '#eab308', text: '#854d0e', className: 'fc-event-tentative' };
}

// --- 読み取り専用詳細（スタッフ用） ---

function openSmReadonlyDetail(id) {
  const s = smGetSchedules().find(s => s.id === id);
  if (!s) return;

  const timeStr = s.start_time && s.end_time
    ? `${formatTime(s.start_time)} 〜 ${formatTime(s.end_time)}`
    : formatTime(s.start_time) || '未設定';

  const content = `
    <div class="detail-grid">
      <div class="detail-item">
        <label>教室名</label>
        <p>${escapeHtml(s.class_name)}</p>
      </div>
      <div class="detail-item">
        <label>担当コーチ</label>
        <p>${escapeHtml(s.coach_name || '未設定')}</p>
      </div>
      <div class="detail-item">
        <label>日付</label>
        <p>${formatDateJP(s.date)}</p>
      </div>
      <div class="detail-item">
        <label>時間</label>
        <p>${timeStr}</p>
      </div>
      <div class="detail-item">
        <label>会場</label>
        <p>${escapeHtml(s.venue || '未設定')}</p>
      </div>
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="window.app.closeModal()">閉じる</button>
    </div>`;

  openModal('スケジュール詳細', content);
}

// --- カレンダー日付移動 ---

export function setSmCalendarDate(date) {
  if (calendar) calendar.gotoDate(date);
}

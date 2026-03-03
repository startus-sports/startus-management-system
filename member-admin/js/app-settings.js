/**
 * アプリ設定管理モジュール
 * app_config テーブルから設定を読み込み、アプリ全体で参照可能にする。
 * config.js のハードコード値をフォールバックとして使用する。
 */
import { supabase } from './supabase.js';
import {
  APP_NAME as DEFAULT_APP_NAME,
  STAFF_CALENDARS as DEFAULT_STAFF_CALENDARS,
  CALENDAR_START_HOUR as DEFAULT_CALENDAR_START_HOUR,
  CALENDAR_END_HOUR as DEFAULT_CALENDAR_END_HOUR,
  SCHEDULE_API_URL as DEFAULT_SCHEDULE_API_URL,
  CALENDAR_API_URL as DEFAULT_CALENDAR_API_URL,
} from './config.js';

// キャッシュ
let settingsCache = null;
let staffCalendarsCache = null;

/**
 * app_config テーブルから全設定を読み込みキャッシュに保持
 */
export async function loadAppSettings() {
  const { data, error } = await supabase
    .from('app_config')
    .select('key, value');

  if (error) {
    console.warn('app_config 読み込みエラー（config.js のフォールバックを使用）:', error.message);
    settingsCache = {};
    return;
  }

  settingsCache = {};
  for (const row of (data || [])) {
    settingsCache[row.key] = row.value;
  }
}

/**
 * 設定値を取得する。DB設定があればそれを返し、なければフォールバック値を返す。
 */
function getSetting(key, fallback) {
  if (settingsCache && key in settingsCache) {
    return settingsCache[key];
  }
  return fallback;
}

// --- 各設定の getter ---

export function getAppName() {
  return getSetting('app_name', DEFAULT_APP_NAME);
}

export function getOrgName() {
  return getSetting('org_name', '');
}

export function getCalendarStartHour() {
  const hours = getSetting('calendar_hours', null);
  return hours && typeof hours.start === 'number' ? hours.start : DEFAULT_CALENDAR_START_HOUR;
}

export function getCalendarEndHour() {
  const hours = getSetting('calendar_hours', null);
  return hours && typeof hours.end === 'number' ? hours.end : DEFAULT_CALENDAR_END_HOUR;
}

export function getScheduleApiUrl() {
  return getSetting('schedule_api_url', DEFAULT_SCHEDULE_API_URL);
}

export function getCalendarApiUrl() {
  return getSetting('calendar_api_url', DEFAULT_CALENDAR_API_URL);
}

/**
 * staff テーブルからカレンダー設定を取得する。
 * calendar_color が設定されている在籍スタッフのみ返す。
 * DB から取得できない場合は config.js の STAFF_CALENDARS にフォールバック。
 */
export async function loadStaffCalendars() {
  const { data, error } = await supabase
    .from('staff')
    .select('name, email, calendar_color')
    .eq('status', '在籍')
    .neq('calendar_color', '');

  if (error || !data || data.length === 0) {
    // フォールバック: config.js のハードコード値
    staffCalendarsCache = DEFAULT_STAFF_CALENDARS;
    return staffCalendarsCache;
  }

  staffCalendarsCache = data.map(s => ({
    id: s.email,
    name: s.name.split(' ')[0], // 姓のみ
    color: s.calendar_color,
  }));

  return staffCalendarsCache;
}

export function getStaffCalendars() {
  return staffCalendarsCache || DEFAULT_STAFF_CALENDARS;
}

// --- 設定の保存 ---

/**
 * app_config テーブルの設定を更新する。
 */
export async function saveSetting(key, value) {
  const { error } = await supabase
    .from('app_config')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });

  if (error) {
    throw new Error(`設定の保存に失敗しました: ${error.message}`);
  }

  // キャッシュ更新
  if (settingsCache) {
    settingsCache[key] = value;
  }
}

/**
 * 全設定のキャッシュを返す（設定画面用）
 */
export function getAllSettings() {
  return { ...settingsCache };
}

// --- 設定画面 UI ---

import { escapeHtml } from './utils.js';

/**
 * アプリ設定画面をレンダリングする
 */
export function renderAppSettings() {
  const container = document.getElementById('app-settings-content');
  if (!container) return;

  const appName = getAppName();
  const orgName = getOrgName();
  const calStartHour = getCalendarStartHour();
  const calEndHour = getCalendarEndHour();
  const scheduleUrl = getScheduleApiUrl();
  const calendarApiUrl = getCalendarApiUrl();

  // 時間セレクトオプション生成
  const hourOptions = (selected) => {
    let html = '';
    for (let h = 0; h <= 24; h++) {
      html += `<option value="${h}" ${h === selected ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`;
    }
    return html;
  };

  container.innerHTML = `
    <form id="app-settings-form" class="app-settings-form" onsubmit="return false;">
      <div class="settings-card">
        <div class="form-group">
          <label>アプリケーション名</label>
          <input type="text" name="app_name" value="${escapeHtml(appName)}" placeholder="例: STARTUS 会員管理">
        </div>
        <div class="form-group">
          <label>団体名</label>
          <input type="text" name="org_name" value="${escapeHtml(orgName)}" placeholder="例: STARTUS Sports Academy">
        </div>
      </div>
      <div class="settings-card">
        <h3 class="settings-card-title">カレンダー設定</h3>
        <div class="form-row">
          <div class="form-group">
            <label>表示開始時刻</label>
            <select name="cal_start">${hourOptions(calStartHour)}</select>
          </div>
          <div class="form-group">
            <label>表示終了時刻</label>
            <select name="cal_end">${hourOptions(calEndHour)}</select>
          </div>
        </div>
      </div>
      <div class="settings-card">
        <h3 class="settings-card-title">外部連携</h3>
        <div class="form-group">
          <label>スケジュールAPI URL（GAS）</label>
          <input type="url" name="schedule_api_url" value="${escapeHtml(scheduleUrl)}" placeholder="https://script.google.com/macros/s/...">
        </div>
        <div class="form-group">
          <label>カレンダーAPI URL（GAS）</label>
          <input type="url" name="calendar_api_url" value="${escapeHtml(calendarApiUrl)}" placeholder="https://script.google.com/macros/s/...">
          <small style="color:var(--gray-400)">スタッフカレンダー日表示用。未設定時はカレンダータブに設定案内が表示されます。</small>
        </div>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary" id="settings-save-btn">
          <span class="material-icons">save</span>保存
        </button>
      </div>
    </form>`;

  // イベントリスナー
  const form = document.getElementById('app-settings-form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      saveAppSettingsForm(form);
    });
  }
}

async function saveAppSettingsForm(form) {
  const { showToast } = await import('./app.js');
  const fd = new FormData(form);
  const btn = document.getElementById('settings-save-btn');

  try {
    if (btn) btn.disabled = true;

    await saveSetting('app_name', fd.get('app_name') || '');
    await saveSetting('org_name', fd.get('org_name') || '');
    await saveSetting('calendar_hours', {
      start: parseInt(fd.get('cal_start'), 10) || 0,
      end: parseInt(fd.get('cal_end'), 10) || 24,
    });
    await saveSetting('schedule_api_url', fd.get('schedule_api_url') || '');

    // タイトル即時反映
    const newAppName = fd.get('app_name') || '';
    const titleEl = document.getElementById('app-title');
    if (titleEl) titleEl.textContent = newAppName;
    document.title = newAppName;

    showToast('設定を保存しました', 'success');
  } catch (err) {
    console.error('設定保存エラー:', err);
    showToast('設定の保存に失敗しました', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

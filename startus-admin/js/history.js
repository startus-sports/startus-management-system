import { supabase } from './supabase.js';
import { getAllMembers } from './members.js';
import { escapeHtml } from './utils.js';
import { openModal, setModalWide } from './app.js';

const ACTION_LABELS = {
  create: { label: '作成', icon: 'add_circle', color: 'var(--success-color)' },
  update: { label: '変更', icon: 'edit', color: 'var(--primary-color)' },
  delete: { label: '削除', icon: 'delete', color: 'var(--danger-color)' },
  fee_update: { label: '会費変更', icon: 'payments', color: 'var(--warning-color)' },
  grade_update: { label: '学年更新', icon: 'school', color: 'var(--accent-color)' },
  app_edit: { label: '申請編集', icon: 'edit_note', color: 'var(--primary-color)' },
  trial_edit: { label: '体験編集', icon: 'edit_note', color: 'var(--primary-color)' },
  transfer_edit: { label: '振替編集', icon: 'edit_note', color: 'var(--primary-color)' },
};

const FIELD_LABELS = {
  name: '氏名', furigana: 'フリガナ', member_number: '会員番号',
  member_type: '種別', status: 'ステータス', birthdate: '生年月日',
  gender: '性別', address: '住所', phone: '電話番号', email: 'メール',
  classes: '教室', grade: '学年', school: '学校', guardian_name: '保護者名',
  disability_info: '身体状況', note: 'メモ', photo_url: '写真',
  monthly_fee_amount: '月謝金額', enrollment_fee: '入会金',
  annual_fee: '年会費', insurance_payment: '保険料',
  // 申請・体験フィールド
  desired_classes: '希望教室', desired_date: '体験希望日',
  age: '年齢', reason: '理由',
  omoi: '期待・思い', route: '知ったきっかけ', route_detail: 'きっかけ詳細',
  // 入会フォーム追加フィールド
  guardian_kana: '保護者フリガナ', phone_relation: '電話番号①続柄',
  phone2: '電話番号②', phone2_relation: '電話番号②続柄',
  zipcode: '郵便番号', trial_date: '体験日', first_date: '初回参加予定日',
  family_status: '家族の入会状況',
  // 退会・休会・復会フォームフィールド
  last_date: '最終参加予定日', start_date: '休会開始予定日',
  return_date: '復会予定日',
  // 変更フォームフィールド
  change_content: '変更内容',
  // 振替フィールド
  member_name: '会員名', member_furigana: 'フリガナ',
  absent_class: '休んだ教室', absent_date: '休んだ日',
  transfer_class: '振替先教室', transfer_date: '振替希望日',
  // 担当者
  assigned_to: '担当者',
};

export async function logActivity(memberId, action, fieldName, oldValue, newValue, applicationId = null) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const email = session?.user?.email || '';

    const record = {
      member_id: memberId,
      action,
      field_name: fieldName || '',
      old_value: String(oldValue ?? ''),
      new_value: String(newValue ?? ''),
      changed_by: email,
    };
    if (applicationId) record.application_id = applicationId;

    await supabase.from('activity_log').insert(record);
  } catch (err) {
    console.error('履歴記録エラー:', err);
  }
}

export async function openGlobalHistory() {
  const { data, error } = await supabase
    .from('activity_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('履歴読み込みエラー:', error);
    return;
  }

  const members = getAllMembers();
  const nameMap = {};
  members.forEach(m => { nameMap[m.id] = m.name; });

  const html = renderHistoryList(data || [], nameMap, true);
  openModal('変更履歴', html);
  setModalWide(true);
}

export async function openMemberHistory(memberId, memberName) {
  const { data, error } = await supabase
    .from('activity_log')
    .select('*')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('履歴読み込みエラー:', error);
    return;
  }

  const html = renderHistoryList(data || [], {}, false, memberName);
  openModal(`${escapeHtml(memberName)} の変更履歴`, html);
}

export async function openApplicationHistory(applicationId, label) {
  const { data, error } = await supabase
    .from('activity_log')
    .select('*')
    .eq('application_id', applicationId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('履歴読み込みエラー:', error);
    // application_idカラムが未追加の場合もエラーメッセージを表示
    openModal(`${escapeHtml(label)} の変更履歴`,
      '<p class="text-muted">履歴の読み込みに失敗しました。<br>migration-app-edit.sql が実行済みか確認してください。</p>');
    return;
  }

  const html = renderHistoryList(data || [], {}, false, label);
  openModal(`${escapeHtml(label)} の変更履歴`, html);
}

function renderHistoryList(entries, nameMap, showMemberName, fixedName) {
  if (entries.length === 0) {
    return '<p class="text-muted">履歴がありません</p>';
  }

  let html = '<div class="history-list">';

  entries.forEach(entry => {
    const info = ACTION_LABELS[entry.action] || { label: entry.action, icon: 'info', color: 'var(--gray-500)' };
    const time = new Date(entry.created_at);
    const timeStr = `${time.getFullYear()}/${String(time.getMonth()+1).padStart(2,'0')}/${String(time.getDate()).padStart(2,'0')} ${String(time.getHours()).padStart(2,'0')}:${String(time.getMinutes()).padStart(2,'0')}`;

    const memberName = showMemberName
      ? (nameMap[entry.member_id] || '(削除済み)')
      : '';

    const fieldLabel = FIELD_LABELS[entry.field_name] || entry.field_name;

    let detail = '';
    if (entry.action === 'create') {
      detail = '新規作成';
    } else if (entry.action === 'delete') {
      detail = '削除';
    } else if (entry.field_name) {
      const oldVal = entry.old_value || '(空)';
      const newVal = entry.new_value || '(空)';
      detail = `${fieldLabel}: ${escapeHtml(oldVal)} → ${escapeHtml(newVal)}`;
    }

    html += `<div class="history-item">
      <div class="history-item-time">${timeStr}　${escapeHtml(entry.changed_by || '')}</div>
      <div class="history-item-action">
        <span class="material-icons" style="font-size:16px;color:${info.color};vertical-align:middle">${info.icon}</span>
        <strong>${info.label}</strong>
        ${showMemberName ? ` - ${escapeHtml(memberName)}` : ''}
      </div>
      ${detail ? `<div class="history-item-detail">${detail}</div>` : ''}
    </div>`;
  });

  html += '</div>';
  return html;
}

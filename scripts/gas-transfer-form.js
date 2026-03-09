/**
 * STARTUS 振替申請フォーム → Supabase 連携スクリプト
 *
 * 使い方:
 * 1. Google Apps Script (https://script.google.com/) で新しいプロジェクトを作成
 * 2. このコードをコピペ
 * 3. SUPABASE_URL と SUPABASE_ANON_KEY を設定
 * 4. 「デプロイ」→「新しいデプロイ」→ ウェブアプリとしてデプロイ
 *    - 実行ユーザー: 自分
 *    - アクセス: 全員
 * 5. デプロイURLをフォームのaction先に設定
 *
 * 注意: migration-transfer-rls.sql を先にSupabaseで実行してください
 */

// === Supabase接続設定 ===
const SUPABASE_URL = 'https://jfsxywwufwdprqdkyxhr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impmc3h5d3d1ZndkcHJxZGt5eGhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5NTM4NjUsImV4cCI6MjA4NzUyOTg2NX0.htkbpmzoFkH204wggYTl10YEBalDIDq4gJp-W25fRRQ';

/**
 * フォーム送信を受け取り、Supabaseに振替申請を登録
 *
 * 期待するフォームフィールド:
 * - member_name (必須): 会員名
 * - member_furigana: フリガナ
 * - guardian_name: 保護者名
 * - email: メールアドレス
 * - phone: 電話番号
 * - absent_class (必須): 休んだ教室名
 * - absent_date (必須): 休んだ日 (YYYY-MM-DD)
 * - transfer_class (必須): 振替先教室名
 * - transfer_date (必須): 振替希望日 (YYYY-MM-DD)
 * - note: 備考
 */
function doPost(e) {
  try {
    const params = e.parameter;

    // 必須チェック
    const required = ['member_name', 'absent_class', 'absent_date', 'transfer_class', 'transfer_date'];
    for (const field of required) {
      if (!params[field]) {
        return createJsonResponse({ success: false, error: `${field} は必須です` }, 400);
      }
    }

    // フォームデータ構築
    const formData = {
      member_name: params.member_name || '',
      member_furigana: params.member_furigana || '',
      guardian_name: params.guardian_name || '',
      email: params.email || '',
      phone: params.phone || '',
      absent_class: params.absent_class || '',
      absent_date: params.absent_date || '',
      transfer_class: params.transfer_class || '',
      transfer_date: params.transfer_date || '',
      note: params.note || '',
    };

    // チェックリスト初期値
    const checklist = {
      items: [
        { key: 'receipt', checked: false, checked_at: null, checked_by: null },
        { key: 'staff_contact', checked: false, checked_at: null, checked_by: null },
        { key: 'capacity_check', checked: false, checked_at: null, checked_by: null },
      ]
    };

    // Supabaseに挿入
    const record = {
      type: 'transfer',
      status: 'pending',
      form_data: formData,
      checklist: checklist,
    };

    const response = UrlFetchApp.fetch(`${SUPABASE_URL}/rest/v1/applications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'return=minimal',
      },
      payload: JSON.stringify(record),
      muteHttpExceptions: true,
    });

    const status = response.getResponseCode();

    if (status === 201 || status === 200) {
      // 成功 → 自動返信メール送信
      if (formData.email) {
        sendConfirmationEmail(formData);
      }
      return createJsonResponse({ success: true, message: '振替申請を受け付けました' });
    } else {
      const body = response.getContentText();
      Logger.log(`Supabase error: ${status} - ${body}`);
      return createJsonResponse({ success: false, error: '登録に失敗しました' }, 500);
    }

  } catch (error) {
    Logger.log(`Error: ${error}`);
    return createJsonResponse({ success: false, error: 'サーバーエラーが発生しました' }, 500);
  }
}

/**
 * GETリクエスト（フォーム画面表示用）
 * 既存のGASフォームがある場合はそちらを使用
 */
function doGet(e) {
  // 必要に応じてフォームHTMLを返す
  return HtmlService.createHtmlOutput('<p>振替申請フォームはLPページからご利用ください。</p>');
}

/**
 * 振替申請の自動返信メール送信
 */
function sendConfirmationEmail(formData) {
  try {
    const subject = '【STARTUS】振替申請を受け付けました';
    const body = `
${formData.member_name} 様（保護者 ${formData.guardian_name} 様）

振替申請を受け付けました。
担当者からの確定連絡をお待ちください。

【申請内容】
休んだ教室: ${formData.absent_class}
休んだ日: ${formData.absent_date}
振替先教室: ${formData.transfer_class}
振替希望日: ${formData.transfer_date}
${formData.note ? `備考: ${formData.note}` : ''}

※このメールは自動送信です。
※振替の確定は、担当者からの連絡をもちまして完了となります。

STARTUS Sports Academy
    `.trim();

    MailApp.sendEmail({
      to: formData.email,
      subject: subject,
      body: body,
    });

    Logger.log(`確認メール送信完了: ${formData.email}`);
  } catch (error) {
    Logger.log(`メール送信エラー: ${error}`);
    // メール送信失敗してもデータ登録は成功扱い
  }
}

/**
 * JSONレスポンス生成
 */
function createJsonResponse(data, statusCode) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

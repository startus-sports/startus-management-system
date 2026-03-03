/**
 * Google Calendar Events API - GAS Web App
 *
 * スタッフのGoogleカレンダーからイベントを取得するAPIエンドポイント。
 * startus@startus-kanazawa.org アカウントでデプロイすること。
 *
 * ★ 事前準備:
 *   1. GASエディタ左側「サービス」→「Google Calendar API」を追加
 *   2. setupSubscriptions() を一度だけ実行（スタッフカレンダーを購読）
 *   3. testDoGet() を実行して動作確認
 *
 * デプロイ手順:
 * 1. https://script.google.com で新規プロジェクト作成
 * 2. このコードを貼り付け
 * 3. 左側「サービス」→「Google Calendar API」を追加
 * 4. setupSubscriptions を実行（初回のみ）
 * 5. testDoGet を実行して動作確認
 * 6. デプロイ → 新しいデプロイ → ウェブアプリ
 *    - 実行: 自分 (startus@startus-kanazawa.org)
 *    - アクセス: 全員
 * 7. 生成された URL をアプリ設定の「カレンダーAPI URL」に登録
 */

/**
 * ★ 初回セットアップ: スタッフカレンダーを購読リストに追加
 * この関数を一度だけ実行すること。
 * Calendar API でイベントを取得するには、カレンダーが購読リストに
 * 追加されている必要がある。
 */
function setupSubscriptions() {
  var emails = [
    'hiroshiinomoto@startus-kanazawa.org',
    'hisashimatsui@startus-kanazawa.org',
    'junkomatsukura@startus-kanazawa.org',
    'sayokotakei@startus-kanazawa.org',
    'asuka.sakurai@startus-kanazawa.org'
  ];

  for (var i = 0; i < emails.length; i++) {
    var email = emails[i];
    try {
      Calendar.CalendarList.insert({ id: email });
      Logger.log('OK: ' + email + ' を購読リストに追加しました');
    } catch (e) {
      if (e.message.indexOf('Already Exists') >= 0) {
        Logger.log('SKIP: ' + email + ' は既に購読済みです');
      } else {
        Logger.log('ERROR: ' + email + ' - ' + e.message);
      }
    }
  }

  Logger.log('セットアップ完了。testDoGet を実行して確認してください。');
}

// --- メイン API ---

function doGet(e) {
  var params = e.parameter;

  // 日付パラメータ（デフォルト: 今日）
  var dateStr = params.date || Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');

  // スタッフメールアドレス（カンマ区切り）
  var emailsStr = params.emails || '';
  var emails = emailsStr ? emailsStr.split(',').map(function(s) { return s.trim(); }) : [];

  if (emails.length === 0) {
    return respond_({ error: 'emails parameter is required' }, params.callback);
  }

  // 当日の開始・終了（JST）
  var timeMin = dateStr + 'T00:00:00+09:00';
  var timeMax = dateStr + 'T23:59:59+09:00';

  var results = {};

  for (var i = 0; i < emails.length; i++) {
    var email = emails[i];
    try {
      var response = Calendar.Events.list(email, {
        timeMin: timeMin,
        timeMax: timeMax,
        singleEvents: true,
        orderBy: 'startTime',
        timeZone: 'Asia/Tokyo'
      });

      var eventList = [];
      var items = response.items || [];

      for (var j = 0; j < items.length; j++) {
        var ev = items[j];
        var isAllDay = !!ev.start.date;

        eventList.push({
          title: ev.summary || '(タイトルなし)',
          start: isAllDay ? ev.start.date + 'T00:00:00+09:00' : ev.start.dateTime,
          end: isAllDay ? ev.end.date + 'T00:00:00+09:00' : ev.end.dateTime,
          location: ev.location || '',
          description: ev.description || '',
          isAllDay: isAllDay,
          color: ev.colorId || ''
        });
      }

      results[email] = { events: eventList };
    } catch (err) {
      results[email] = { error: err.message, events: [] };
    }
  }

  return respond_({ date: dateStr, results: results }, params.callback);
}

/**
 * JSON または JSONP でレスポンスを返す
 */
function respond_(data, callback) {
  var json = JSON.stringify(data);

  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * テスト用: ログにサンプルレスポンスを出力
 */
function testDoGet() {
  var result = doGet({
    parameter: {
      date: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd'),
      emails: 'imoto@startus-kanazawa.org,matsui@startus-kanazawa.org'
    }
  });
  Logger.log(result.getContent());
}

import { supabase } from './supabase.js';
import { escapeHtml } from './utils.js';
import { showToast, openModal, closeModal } from './app.js';
import { loadMembers, getAllMembers } from './members.js';
import { namesToTags } from './class-utils.js';

// ヘッダーマッピング（柔軟判定）
const HEADER_MAP = {
  member_number: ['会員番号', 'membernumber', 'no', 'no.', '番号', 'id', '会員数', '会員no通し'],
  name: ['氏名', '名前', 'name', 'お名前', 'フルネーム', '参加者名'],
  furigana: ['フリガナ', 'ふりがな', '読み', 'furigana', 'カナ'],
  member_type: ['種別', 'タイプ', 'type', '会員種別', 'membertype', '入会区分'],
  status: ['ステータス', '状態', 'status', '在籍状況'],
  birthdate: ['生年月日', '誕生日', 'birthdate', 'birthday'],
  gender: ['性別', 'gender'],
  address: ['住所', '住 所', 'address'],
  phone: ['電話番号', '電話', 'phone', 'tel', '連絡先電話', '携帯'],
  email: ['メールアドレス', 'メール', 'email', 'e-mail', 'e-メールアドレス', '携帯アドレス'],
  classes: ['教室', 'クラス', 'class', 'classes', '種目名'],
  grade: ['学年', 'grade'],
  disability_info: ['障がい情報', '障害', 'disability', '配慮事項'],
  note: ['メモ', '備考', 'note', 'notes'],
  guardian_name: ['保護者名', '保護者', 'guardian', '保護者氏名'],
  school: ['学校', '学校名', 'school'],
};

const COL_LABELS = {
  member_number: '番号', name: '氏名', furigana: 'フリガナ',
  member_type: '種別', status: 'ステータス', birthdate: '生年月日',
  gender: '性別', address: '住所', phone: '電話', email: 'メール',
  classes: '教室', grade: '学年', disability_info: '障がい情報', note: 'メモ',
  guardian_name: '保護者名', school: '学校'
};

let importData = [];
let duplicateFlags = []; // 各行の重複情報

// Excelシリアル値 → YYYY-MM-DD 変換
function parseBirthdate(value) {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  // 既に YYYY-MM-DD or YYYY/MM/DD 形式
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(v)) return v.replace(/\//g, '-');
  // Excelシリアル値（数値のみ）
  const num = Number(v);
  if (!isNaN(num) && num > 1 && num < 100000) {
    const ms = (num - 25569) * 86400000; // 25569 = 1899-12-30 → 1970-01-01
    const date = new Date(ms);
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

export function openImportModal() {
  importData = [];
  duplicateFlags = [];
  const content = `
    <div id="import-dropzone" class="import-dropzone">
      <span class="material-icons import-icon">cloud_upload</span>
      <p>CSV/Excelファイルを選択</p>
      <input type="file" id="import-file" accept=".csv,.xlsx,.xls" style="display:none">
      <button class="btn btn-secondary" onclick="document.getElementById('import-file').click()">
        ファイルを選択
      </button>
    </div>
    <div id="import-preview" style="display:none">
      <div id="import-dup-warning" class="import-dup-warning" style="display:none"></div>
      <div id="import-preview-table-wrap" class="import-table-wrap"></div>
      <p id="import-count" class="import-count"></p>
      <div class="form-actions">
        <button class="btn btn-secondary" onclick="window.memberApp.closeModal()">キャンセル</button>
        <button class="btn btn-primary" onclick="window.memberApp.executeImport()">
          <span class="material-icons">upload</span>インポート実行
        </button>
      </div>
    </div>`;

  openModal('会員インポート', content);

  setTimeout(() => {
    const fileInput = document.getElementById('import-file');
    if (fileInput) {
      fileInput.addEventListener('change', handleFileSelect);
    }
  }, 100);
}

async function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  const ext = file.name.split('.').pop().toLowerCase();
  let rows;

  try {
    if (ext === 'csv') {
      const text = await file.text();
      rows = parseCSV(text);
    } else if (ext === 'xlsx' || ext === 'xls') {
      rows = await parseExcel(file);
    } else {
      showToast('対応していないファイル形式です', 'error');
      return;
    }
  } catch (err) {
    console.error('ファイル解析エラー:', err);
    showToast('ファイルの読み込みに失敗しました', 'error');
    return;
  }

  if (!rows || rows.length < 2) {
    showToast('データが見つかりません', 'warning');
    return;
  }

  const headers = rows[0];
  const columnMap = mapHeaders(headers);
  const dataRows = rows.slice(1).filter(row => row.some(cell => cell.trim() !== ''));

  importData = dataRows.map(row => {
    const obj = {};
    for (const [dbCol, idx] of Object.entries(columnMap)) {
      obj[dbCol] = (row[idx] || '').trim();
    }
    return obj;
  });

  checkDuplicates();
  renderPreview(columnMap);
}

// --- 重複チェック ---

function checkDuplicates() {
  const existing = getAllMembers();
  const existingNames = new Set(existing.map(m => (m.name || '').trim()));
  const existingNumbers = new Set(
    existing.map(m => (m.member_number || '').trim()).filter(Boolean)
  );

  duplicateFlags = importData.map(row => {
    const reasons = [];
    const name = (row.name || '').trim();
    const num = (row.member_number || '').trim();

    if (name && existingNames.has(name)) {
      reasons.push('氏名');
    }
    if (num && existingNumbers.has(num)) {
      reasons.push('会員番号');
    }
    return reasons;
  });
}

function mapHeaders(headers) {
  const map = {};
  headers.forEach((header, idx) => {
    const h = header.trim().toLowerCase();
    for (const [dbCol, aliases] of Object.entries(HEADER_MAP)) {
      if (aliases.some(a => a.toLowerCase() === h)) {
        map[dbCol] = idx;
        break;
      }
    }
  });
  return map;
}

function renderPreview(columnMap) {
  const dropzone = document.getElementById('import-dropzone');
  const preview = document.getElementById('import-preview');
  const tableWrap = document.getElementById('import-preview-table-wrap');
  const countEl = document.getElementById('import-count');
  const dupWarning = document.getElementById('import-dup-warning');

  if (dropzone) dropzone.style.display = 'none';
  if (preview) preview.style.display = 'block';

  const columns = columnMap ? Object.keys(columnMap) : Object.keys(importData[0] || {});

  // 重複警告
  const dupCount = duplicateFlags.filter(f => f.length > 0).length;
  if (dupWarning) {
    if (dupCount > 0) {
      dupWarning.style.display = 'block';
      dupWarning.innerHTML = `
        <span class="material-icons">warning</span>
        <span>${dupCount}件の重複が見つかりました（黄色の行）。重複行を除外するか、そのままインポートできます。</span>`;
    } else {
      dupWarning.style.display = 'none';
    }
  }

  let html = '<table class="import-table"><thead><tr><th>#</th>';
  columns.forEach(col => {
    html += `<th>${escapeHtml(COL_LABELS[col] || col)}</th>`;
  });
  html += '<th></th></tr></thead><tbody>';

  importData.forEach((row, i) => {
    const isDup = duplicateFlags[i] && duplicateFlags[i].length > 0;
    const rowClass = isDup ? ' class="import-row-dup"' : '';
    const dupLabel = isDup ? `<span class="badge-dup" title="重複: ${duplicateFlags[i].join('・')}">重複</span>` : '';

    html += `<tr data-row="${i}"${rowClass}><td>${i + 1}${dupLabel}</td>`;
    columns.forEach(col => {
      html += `<td contenteditable="true" data-col="${col}">${escapeHtml(row[col] || '')}</td>`;
    });
    html += `<td><button class="btn-icon btn-remove-row" onclick="window.memberApp.removeImportRow(${i})">
      <span class="material-icons">close</span></button></td></tr>`;
  });

  html += '</tbody></table>';
  tableWrap.innerHTML = html;
  countEl.textContent = `${importData.length}件のデータが読み込まれました` +
    (dupCount > 0 ? `（うち${dupCount}件重複）` : '');

  // contenteditable の変更を反映
  tableWrap.querySelectorAll('td[contenteditable]').forEach(td => {
    td.addEventListener('blur', () => {
      const rowIdx = parseInt(td.closest('tr').dataset.row, 10);
      const col = td.dataset.col;
      if (importData[rowIdx]) {
        importData[rowIdx][col] = td.textContent.trim();
      }
    });
  });
}

export function removeImportRow(index) {
  importData.splice(index, 1);
  duplicateFlags.splice(index, 1);
  const tableWrap = document.getElementById('import-preview-table-wrap');
  const countEl = document.getElementById('import-count');
  if (importData.length === 0) {
    tableWrap.innerHTML = '<p class="text-muted">データがありません</p>';
    countEl.textContent = '';
    const dupWarning = document.getElementById('import-dup-warning');
    if (dupWarning) dupWarning.style.display = 'none';
    return;
  }
  renderPreview(null);
}

export async function executeImport() {
  // 氏名が空の行をスキップ
  const validRows = importData.filter(row => row.name && row.name.trim() !== '');
  if (validRows.length === 0) {
    showToast('インポートするデータがありません', 'warning');
    return;
  }

  const insertData = validRows.map(row => ({
    member_number: row.member_number || '',
    name: row.name,
    furigana: row.furigana || '',
    member_type: row.member_type || '会員',
    status: row.status || '在籍',
    birthdate: parseBirthdate(row.birthdate),
    gender: row.gender || '',
    address: row.address || '',
    phone: row.phone || '',
    email: row.email || '',
    classes: row.classes
      ? namesToTags(row.classes.split(/[,、・]/).map(s => s.trim()).filter(Boolean))
      : [],
    grade: row.grade || '',
    disability_info: row.disability_info || '',
    note: row.note || '',
    guardian_name: row.guardian_name || '',
    school: row.school || '',
  }));

  // まず一括挿入を試行
  const { error } = await supabase.from('members').insert(insertData);
  if (!error) {
    closeModal();
    showToast(`${insertData.length}件インポートしました`, 'success');
    await loadMembers();
    return;
  }

  console.error('一括インポートエラー:', error);

  // 一括失敗時は1件ずつ挿入して部分成功を許容
  let successCount = 0;
  const errors = [];
  for (let i = 0; i < insertData.length; i++) {
    const { error: rowError } = await supabase.from('members').insert([insertData[i]]);
    if (rowError) {
      console.error(`行${i + 1}エラー (${insertData[i].name}):`, rowError);
      errors.push(`${insertData[i].name}: ${rowError.message || rowError.code || 'エラー'}`);
    } else {
      successCount++;
    }
  }

  if (successCount > 0) {
    closeModal();
    const msg = errors.length > 0
      ? `${successCount}件インポート、${errors.length}件失敗`
      : `${successCount}件インポートしました`;
    showToast(msg, errors.length > 0 ? 'warning' : 'success');
    await loadMembers();
  } else {
    showToast(`インポートに失敗しました: ${errors[0] || error.message || '不明なエラー'}`, 'error');
  }

  if (errors.length > 0) {
    console.error('インポート失敗の詳細:', errors);
  }
}

// --- CSV パーサー ---

function parseCSV(text) {
  // BOM除去
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }

  const rows = [];
  let current = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        current.push(field);
        field = '';
        i++;
      } else if (ch === '\r') {
        current.push(field);
        field = '';
        if (i + 1 < text.length && text[i + 1] === '\n') i++;
        i++;
        if (current.some(c => c.trim() !== '')) rows.push(current);
        current = [];
      } else if (ch === '\n') {
        current.push(field);
        field = '';
        i++;
        if (current.some(c => c.trim() !== '')) rows.push(current);
        current = [];
      } else {
        field += ch;
        i++;
      }
    }
  }

  // 最後のフィールド/行
  current.push(field);
  if (current.some(c => c.trim() !== '')) rows.push(current);

  return rows;
}

// --- Excel パーサー (SheetJS) ---

async function parseExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });
        resolve(json.map(row => row.map(cell => String(cell))));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

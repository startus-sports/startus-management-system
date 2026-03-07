import { shopSupabase } from './shop-supabase.js';
import { escapeHtml, formatDateTime, formatCurrency } from './utils.js';
import { showToast, openModal, closeModal, setModalWide } from './app.js';

// --- State ---
let allCustomers = [];
let filteredCustomers = [];
let searchQuery = '';

// --- Load ---
export async function loadShopCustomers() {
  try {
    const { data, error } = await shopSupabase
      .from('orders')
      .select('buyerName, buyerEmail, buyerPhone, studentClass, totalAmount, status, createdAt')
      .order('createdAt', { ascending: false });

    if (error) { console.error('顧客読み込みエラー:', error); allCustomers = []; }
    else { allCustomers = aggregateCustomers(data || []); }
  } catch (e) {
    console.error('顧客読み込みエラー:', e);
    allCustomers = [];
  }
  applyAndRender();
}

function aggregateCustomers(orders) {
  const map = {};
  for (const o of orders) {
    if (!o.buyerEmail) continue;
    if (!map[o.buyerEmail]) {
      map[o.buyerEmail] = {
        email: o.buyerEmail,
        name: o.buyerName,
        phone: o.buyerPhone,
        studentClass: o.studentClass,
        orderCount: 0,
        totalSpent: 0,
        lastOrderDate: o.createdAt,
      };
    }
    map[o.buyerEmail].orderCount++;
    if (o.status !== 'cancelled') {
      map[o.buyerEmail].totalSpent += o.totalAmount || 0;
    }
    // Keep latest info
    if (new Date(o.createdAt) > new Date(map[o.buyerEmail].lastOrderDate)) {
      map[o.buyerEmail].lastOrderDate = o.createdAt;
      map[o.buyerEmail].name = o.buyerName;
      map[o.buyerEmail].phone = o.buyerPhone;
      map[o.buyerEmail].studentClass = o.studentClass;
    }
  }
  return Object.values(map).sort((a, b) => new Date(b.lastOrderDate) - new Date(a.lastOrderDate));
}

function applyAndRender() {
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filteredCustomers = allCustomers.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.studentClass || '').toLowerCase().includes(q)
    );
  } else {
    filteredCustomers = allCustomers;
  }
  renderSummary();
  renderCustomerList();
}

// --- Summary ---
function renderSummary() {
  const container = document.getElementById('shop-customer-summary');
  if (!container) return;

  const totalOrders = allCustomers.reduce((s, c) => s + c.orderCount, 0);
  const totalRevenue = allCustomers.reduce((s, c) => s + c.totalSpent, 0);

  container.innerHTML = `
    <div class="shop-summary-card">
      <div class="shop-summary-label">顧客数</div>
      <div class="shop-summary-value">${allCustomers.length}<span class="shop-summary-unit">名</span></div>
    </div>
    <div class="shop-summary-card">
      <div class="shop-summary-label">総注文数</div>
      <div class="shop-summary-value">${totalOrders}<span class="shop-summary-unit">件</span></div>
    </div>
    <div class="shop-summary-card">
      <div class="shop-summary-label">総売上</div>
      <div class="shop-summary-value">${formatCurrency(totalRevenue)}</div>
    </div>`;
}

// --- Customer list ---
function renderCustomerList() {
  const container = document.getElementById('shop-customer-list');
  const countEl = document.getElementById('shop-customer-count');
  if (!container) return;

  if (countEl) countEl.textContent = `${filteredCustomers.length}名`;

  if (filteredCustomers.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="material-icons empty-icon">storefront</span>
        <p>顧客データがありません</p>
      </div>`;
    return;
  }

  const header = `
    <div class="shop-grid-header shop-customer-grid">
      <span>氏名</span><span>メール</span><span>電話</span>
      <span>クラス</span><span>注文数</span><span>合計金額</span><span>最終注文</span>
    </div>`;

  const rows = filteredCustomers.map(c => `
    <div class="list-item shop-customer-grid" onclick="window.memberApp.showCustomerDetail('${escapeHtml(c.email)}')">
      <span style="font-weight:600">${escapeHtml(c.name)}</span>
      <span>${escapeHtml(c.email)}</span>
      <span>${escapeHtml(c.phone || '-')}</span>
      <span>${escapeHtml(c.studentClass || '-')}</span>
      <span style="text-align:center">${c.orderCount}</span>
      <span class="shop-cell-amount">${formatCurrency(c.totalSpent)}</span>
      <span class="shop-cell-date">${formatDateTime(c.lastOrderDate)}</span>
    </div>
  `).join('');

  container.innerHTML = header + rows;
}

// --- Customer detail ---
export async function showCustomerDetail(email) {
  const { data: orders, error } = await shopSupabase
    .from('orders')
    .select('*, order_items(*)')
    .eq('buyerEmail', email)
    .order('createdAt', { ascending: false });

  if (error || !orders || orders.length === 0) {
    showToast('顧客データの取得に失敗しました', 'error');
    return;
  }

  const STATUS_MAP = {
    pending: '現金待ち', pending_payment: '決済待ち',
    paid: '支払済', cancelled: 'キャンセル', refunded: '返金済',
  };

  const customer = orders[0];
  const totalSpent = orders.filter(o => o.status !== 'cancelled').reduce((s, o) => s + (o.totalAmount || 0), 0);

  const orderRows = orders.map(o => {
    const items = (o.order_items || []).map(i =>
      `${escapeHtml(i.productNameSnapshot)}(${escapeHtml(i.variantSizeSnapshot)}) x${i.quantity}`
    ).join(', ');
    return `
      <tr>
        <td class="shop-cell-mono">${escapeHtml(o.orderNumber)}</td>
        <td>${STATUS_MAP[o.status] || o.status}</td>
        <td>${items}</td>
        <td style="text-align:right">${formatCurrency(o.totalAmount)}</td>
        <td>${formatDateTime(o.createdAt)}</td>
      </tr>`;
  }).join('');

  const content = `
    <div class="shop-detail">
      <div class="shop-detail-row"><label>氏名</label><span>${escapeHtml(customer.buyerName)}</span></div>
      <div class="shop-detail-row"><label>メール</label><span>${escapeHtml(customer.buyerEmail)}</span></div>
      <div class="shop-detail-row"><label>電話</label><span>${escapeHtml(customer.buyerPhone || '-')}</span></div>
      <div class="shop-detail-row"><label>クラス</label><span>${escapeHtml(customer.studentClass || '-')}</span></div>
      <div class="shop-detail-row"><label>注文回数</label><span>${orders.length}回</span></div>
      <div class="shop-detail-row"><label>累計金額</label><span style="font-weight:700">${formatCurrency(totalSpent)}</span></div>

      <h4 style="margin:16px 0 8px">注文履歴</h4>
      <div class="shop-table-wrap">
        <table class="shop-table">
          <thead><tr><th>注文番号</th><th>ステータス</th><th>商品</th><th>金額</th><th>日時</th></tr></thead>
          <tbody>${orderRows}</tbody>
        </table>
      </div>
    </div>`;

  setModalWide(true);
  openModal(`顧客詳細: ${customer.buyerName}`, content);
}

// --- Search ---
export function initShopCustomerSearch() {
  const input = document.getElementById('shop-customer-search-input');
  if (input) {
    let timer;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        searchQuery = input.value.trim().toLowerCase();
        applyAndRender();
      }, 300);
    });
  }
}

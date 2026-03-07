import { shopSupabase } from './shop-supabase.js';
import { escapeHtml, formatDateTime, formatCurrency } from './utils.js';
import { showToast, openModal, closeModal, setModalWide } from './app.js';

// --- State ---
let allOrders = [];
let filteredOrders = [];
let orderCounts = {};
let searchQuery = '';
let statusFilter = 'all';

// --- Status definitions ---
const STATUS_MAP = {
  pending:         { label: '現金待ち',   cssClass: 'badge-shop-warning' },
  pending_payment: { label: '決済待ち',   cssClass: 'badge-shop-orange' },
  paid:            { label: '支払済',     cssClass: 'badge-shop-success' },
  cancelled:       { label: 'キャンセル', cssClass: 'badge-shop-danger' },
  refunded:        { label: '返金済',     cssClass: 'badge-shop-danger' },
};

const PAYMENT_LABELS = { stripe: 'カード', cash: '現金' };

// --- Data loading ---
export async function loadShopOrders() {
  try {
    let query = shopSupabase
      .from('orders')
      .select('*, order_items(*)')
      .order('createdAt', { ascending: false })
      .limit(200);

    if (statusFilter && statusFilter !== 'all') {
      query = query.eq('status', statusFilter);
    }

    if (searchQuery) {
      query = query.or(
        `buyerName.ilike.%${searchQuery}%,buyerEmail.ilike.%${searchQuery}%,orderNumber.ilike.%${searchQuery}%,studentClass.ilike.%${searchQuery}%`
      );
    }

    const { data, error } = await query;
    if (error) { console.error('注文読み込みエラー:', error); allOrders = []; }
    else { allOrders = data || []; }

    // Get counts
    await loadOrderCounts();

    applyAndRender();
  } catch (e) {
    console.error('注文読み込みエラー:', e);
    allOrders = [];
    applyAndRender();
  }
}

async function loadOrderCounts() {
  const { data, error } = await shopSupabase
    .from('orders')
    .select('status');
  if (error || !data) { orderCounts = {}; return; }

  orderCounts = {};
  data.forEach(o => { orderCounts[o.status] = (orderCounts[o.status] || 0) + 1; });
}

function applyAndRender() {
  filteredOrders = allOrders;
  renderStatusTabs();
  renderOrderList();
  updatePendingBadge();
}

// --- Status tabs ---
function renderStatusTabs() {
  const container = document.getElementById('shop-order-tabs');
  if (!container) return;

  const total = Object.values(orderCounts).reduce((s, v) => s + v, 0);
  const tabs = [
    { key: 'all',             label: '全て',     count: total },
    { key: 'pending',         label: '現金待ち', count: orderCounts.pending || 0 },
    { key: 'pending_payment', label: '決済待ち', count: orderCounts.pending_payment || 0 },
    { key: 'paid',            label: '支払済',   count: orderCounts.paid || 0 },
    { key: 'cancelled',       label: 'キャンセル', count: orderCounts.cancelled || 0 },
  ];

  container.innerHTML = tabs.map(t => `
    <button class="shop-tab-btn ${statusFilter === t.key ? 'active' : ''}"
            onclick="window.memberApp.setOrderStatusFilter('${t.key}')">
      ${escapeHtml(t.label)}<span class="shop-tab-count">${t.count}</span>
    </button>
  `).join('');
}

// --- Order list ---
function renderOrderList() {
  const container = document.getElementById('shop-order-list');
  const countEl = document.getElementById('shop-order-count');
  if (!container) return;

  if (countEl) countEl.textContent = `${filteredOrders.length}件`;

  if (filteredOrders.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="material-icons empty-icon">receipt_long</span>
        <p>注文データがありません</p>
      </div>`;
    return;
  }

  const header = `
    <div class="shop-grid-header shop-order-grid">
      <span>注文番号</span>
      <span>ステータス</span>
      <span>購入者</span>
      <span>クラス</span>
      <span>商品</span>
      <span>金額</span>
      <span>支払</span>
      <span>日時</span>
    </div>`;

  const rows = filteredOrders.map(o => {
    const st = STATUS_MAP[o.status] || { label: o.status, cssClass: '' };
    const items = (o.order_items || []).map(i =>
      `${escapeHtml(i.productNameSnapshot)}${i.variantSizeSnapshot ? '(' + escapeHtml(i.variantSizeSnapshot) + ')' : ''} x${i.quantity}`
    ).join(', ');
    return `
      <div class="list-item shop-order-grid" onclick="window.memberApp.showOrderDetail('${o.id}')">
        <span class="shop-cell-mono">${escapeHtml(o.orderNumber)}</span>
        <span><span class="badge ${st.cssClass}">${st.label}</span></span>
        <span>${escapeHtml(o.buyerName)}</span>
        <span>${escapeHtml(o.studentClass || '')}</span>
        <span class="shop-cell-items">${items || '-'}</span>
        <span class="shop-cell-amount">${formatCurrency(o.totalAmount)}</span>
        <span>${PAYMENT_LABELS[o.paymentMethod] || o.paymentMethod}</span>
        <span class="shop-cell-date">${formatDateTime(o.createdAt)}</span>
      </div>`;
  }).join('');

  container.innerHTML = header + rows;
}

// --- Order detail modal ---
export function showOrderDetail(orderId) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order) return;

  const st = STATUS_MAP[order.status] || { label: order.status, cssClass: '' };
  const items = order.order_items || [];

  const itemRows = items.map(i => `
    <tr>
      <td>${escapeHtml(i.productNameSnapshot)}</td>
      <td>${escapeHtml(i.variantSizeSnapshot)}${i.variantColorSnapshot ? ' / ' + escapeHtml(i.variantColorSnapshot) : ''}</td>
      <td>${escapeHtml(i.variantSkuSnapshot)}</td>
      <td style="text-align:right">${formatCurrency(i.unitPrice)}</td>
      <td style="text-align:center">${i.quantity}</td>
      <td style="text-align:right">${formatCurrency(i.lineTotal)}</td>
    </tr>
  `).join('');

  let actions = '';
  if (order.status === 'pending' && order.paymentMethod === 'cash') {
    actions += `<button class="btn btn-primary" onclick="window.memberApp.confirmOrderPayment('${order.id}')">
      <span class="material-icons">check_circle</span>入金確認
    </button>`;
  }
  if (order.status === 'pending' || order.status === 'pending_payment') {
    actions += `<button class="btn btn-secondary btn-danger-text" onclick="window.memberApp.cancelOrder('${order.id}')">
      <span class="material-icons">cancel</span>キャンセル
    </button>`;
  }

  const content = `
    <div class="shop-detail">
      <div class="shop-detail-row"><label>注文番号</label><span class="shop-cell-mono">${escapeHtml(order.orderNumber)}</span></div>
      <div class="shop-detail-row"><label>ステータス</label><span class="badge ${st.cssClass}">${st.label}</span></div>
      <div class="shop-detail-row"><label>支払方法</label><span>${PAYMENT_LABELS[order.paymentMethod] || order.paymentMethod}</span></div>
      <div class="shop-detail-row"><label>購入者</label><span>${escapeHtml(order.buyerName)}</span></div>
      <div class="shop-detail-row"><label>メール</label><span>${escapeHtml(order.buyerEmail)}</span></div>
      <div class="shop-detail-row"><label>電話</label><span>${escapeHtml(order.buyerPhone || '-')}</span></div>
      <div class="shop-detail-row"><label>クラス</label><span>${escapeHtml(order.studentClass || '-')}</span></div>
      ${order.notes ? `<div class="shop-detail-row"><label>備考</label><span>${escapeHtml(order.notes)}</span></div>` : ''}
      <div class="shop-detail-row"><label>注文日時</label><span>${formatDateTime(order.createdAt)}</span></div>
      ${order.paidAt ? `<div class="shop-detail-row"><label>支払日時</label><span>${formatDateTime(order.paidAt)}</span></div>` : ''}

      <h4 style="margin:16px 0 8px">注文明細</h4>
      <div class="shop-table-wrap">
        <table class="shop-table">
          <thead><tr><th>商品</th><th>サイズ/色</th><th>SKU</th><th>単価</th><th>数量</th><th>小計</th></tr></thead>
          <tbody>${itemRows}</tbody>
          <tfoot>
            <tr><td colspan="5" style="text-align:right;font-weight:600">合計</td><td style="text-align:right;font-weight:700">${formatCurrency(order.totalAmount)}</td></tr>
          </tfoot>
        </table>
      </div>

      ${actions ? `<div class="shop-detail-actions">${actions}</div>` : ''}
    </div>`;

  setModalWide(true);
  openModal(`注文詳細 ${order.orderNumber}`, content);
}

// --- Actions ---
export async function confirmOrderPayment(orderId) {
  if (!confirm('この注文の入金を確認しますか？')) return;

  const { data, error } = await shopSupabase.rpc('shop_confirm_cash_payment', {
    p_order_id: orderId,
    p_admin_email: document.getElementById('user-email')?.textContent || '',
  });

  if (error) {
    showToast('入金確認に失敗しました: ' + error.message, 'error');
    return;
  }
  if (data && data.error) {
    const msgs = { ORDER_NOT_FOUND: '注文が見つかりません', ORDER_NOT_PENDING: '既に処理済みです', NOT_CASH_ORDER: '現金注文ではありません' };
    showToast(msgs[data.error] || data.error, 'error');
    return;
  }

  showToast('入金を確認しました', 'success');
  closeModal();
  await loadShopOrders();
}

export async function cancelOrder(orderId) {
  if (!confirm('この注文をキャンセルしますか？在庫が元に戻ります。')) return;

  const { data, error } = await shopSupabase.rpc('shop_cancel_order', {
    p_order_id: orderId,
  });

  if (error) {
    showToast('キャンセルに失敗しました: ' + error.message, 'error');
    return;
  }
  if (data && data.error) {
    const msgs = { ORDER_NOT_FOUND: '注文が見つかりません', CANNOT_CANCEL: 'この注文はキャンセルできません' };
    showToast(msgs[data.error] || data.error, 'error');
    return;
  }

  showToast('注文をキャンセルしました', 'success');
  closeModal();
  await loadShopOrders();
}

// --- Pending badge ---
function updatePendingBadge() {
  const badge = document.getElementById('shop-orders-badge');
  if (!badge) return;
  const pending = (orderCounts.pending || 0) + (orderCounts.pending_payment || 0);
  badge.textContent = pending > 0 ? pending : '';
  badge.style.display = pending > 0 ? '' : 'none';
}

// --- Filter/Search ---
export function setOrderStatusFilter(status) {
  statusFilter = status;
  loadShopOrders();
}

export function initShopOrderSearch() {
  const input = document.getElementById('shop-order-search-input');
  if (input) {
    let timer;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        searchQuery = input.value.trim().toLowerCase();
        loadShopOrders();
      }, 300);
    });
  }
}

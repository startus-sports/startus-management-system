// STARTUS Shop - Order Confirmation
import { shopSupabase, escapeHtml, formatCurrency } from './shop-app.js';

export async function renderConfirmation(container, orderNumber) {
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const paymentStatus = params.get('payment');

  // Stripe cancellation
  if (paymentStatus === 'cancelled') {
    container.innerHTML = `
      <div class="confirmation-page">
        <span class="material-icons confirmation-icon warning">warning</span>
        <div class="confirmation-title">決済がキャンセルされました</div>
        <div class="confirmation-subtitle">注文は保留中です。再度決済するか、注文をキャンセルしてください。</div>
        <div class="confirmation-order-number">${escapeHtml(orderNumber)}</div>
        <div class="confirmation-actions">
          <a href="#/" class="btn-outline">
            <span class="material-icons">storefront</span>ショップに戻る
          </a>
        </div>
      </div>`;
    return;
  }

  // Load order details
  const { data: order, error } = await shopSupabase
    .from('orders')
    .select('*, order_items(*)')
    .eq('orderNumber', orderNumber)
    .single();

  if (error || !order) {
    container.innerHTML = `
      <div class="confirmation-page">
        <span class="material-icons confirmation-icon warning">error_outline</span>
        <div class="confirmation-title">注文が見つかりません</div>
        <div class="confirmation-subtitle">注文番号をご確認ください</div>
        <div class="confirmation-actions">
          <a href="#/" class="btn-outline">
            <span class="material-icons">storefront</span>ショップに戻る
          </a>
        </div>
      </div>`;
    return;
  }

  const isPaid = order.status === 'paid';
  const isCash = order.paymentMethod === 'cash';

  let paymentMessage = '';
  if (isPaid) {
    paymentMessage = 'カード決済が完了しました';
  } else if (isCash) {
    paymentMessage = '次回の練習時に現金でお支払いください';
  } else {
    paymentMessage = '決済の確認中です';
  }

  const itemsHtml = (order.order_items || []).map(item => `
    <div class="checkout-item">
      <span class="checkout-item-name">${escapeHtml(item.productNameSnapshot)} (${escapeHtml(item.variantSizeSnapshot)}${item.variantColorSnapshot ? '/' + escapeHtml(item.variantColorSnapshot) : ''})</span>
      <span class="checkout-item-qty">x${item.quantity}</span>
      <span>${formatCurrency(item.lineTotal)}</span>
    </div>
  `).join('');

  container.innerHTML = `
    <div class="confirmation-page">
      <span class="material-icons confirmation-icon success">check_circle</span>
      <div class="confirmation-title">ご注文ありがとうございます</div>
      <div class="confirmation-subtitle">${paymentMessage}</div>
      <div class="confirmation-order-number">${escapeHtml(order.orderNumber)}</div>

      <div class="confirmation-details">
        <h4>注文内容</h4>
        ${itemsHtml}
        <div class="checkout-total">
          <span>合計</span>
          <span>${formatCurrency(order.totalAmount)}</span>
        </div>
      </div>

      <div class="confirmation-details">
        <h4>お客様情報</h4>
        <div class="checkout-item"><span>お名前</span><span>${escapeHtml(order.buyerName)}</span></div>
        <div class="checkout-item"><span>メール</span><span>${escapeHtml(order.buyerEmail)}</span></div>
        ${order.buyerPhone ? `<div class="checkout-item"><span>電話番号</span><span>${escapeHtml(order.buyerPhone)}</span></div>` : ''}
        <div class="checkout-item"><span>クラス</span><span>${escapeHtml(order.studentClass)}</span></div>
        <div class="checkout-item"><span>支払方法</span><span>${isCash ? '現金' : 'カード'}</span></div>
      </div>

      <div class="confirmation-actions">
        <a href="#/" class="btn-primary-shop">
          <span class="material-icons">storefront</span>ショップに戻る
        </a>
      </div>
    </div>`;
}

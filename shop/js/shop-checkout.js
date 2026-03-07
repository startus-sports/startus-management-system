// STARTUS Shop - Checkout
import { shopSupabase, escapeHtml, formatCurrency, showToast } from './shop-app.js';
import { getCart, getCartTotal, clearCart } from './shop-cart.js';
import { STUDENT_CLASSES, STRIPE_PUBLISHABLE_KEY } from './shop-config.js';

let isSubmitting = false;

export function renderCheckout(container) {
  const cart = getCart();

  if (cart.length === 0) {
    container.innerHTML = `
      <div class="shop-empty">
        <span class="material-icons">shopping_cart</span>
        <p>カートが空です</p>
        <a href="#/" class="btn-outline" style="margin-top:16px">ショップに戻る</a>
      </div>`;
    return;
  }

  const total = getCartTotal();

  const itemsHtml = cart.map(item => `
    <div class="checkout-item">
      <span class="checkout-item-name">${escapeHtml(item.productName)} (${escapeHtml(item.variantSize)}${item.variantColor ? '/' + escapeHtml(item.variantColor) : ''})</span>
      <span class="checkout-item-qty">x${item.quantity}</span>
      <span>${formatCurrency(item.unitPrice * item.quantity)}</span>
    </div>
  `).join('');

  const classOptions = STUDENT_CLASSES.map(c =>
    `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`
  ).join('');

  container.innerHTML = `
    <div class="checkout-page">
      <a href="#/" class="back-link">
        <span class="material-icons">arrow_back</span>ショップに戻る
      </a>
      <h2>ご注文手続き</h2>
      <div class="checkout-layout">
        <div>
          <div class="checkout-section">
            <h3>注文内容</h3>
            ${itemsHtml}
            <div class="checkout-total">
              <span>合計</span>
              <span>${formatCurrency(total)}</span>
            </div>
          </div>
        </div>
        <div>
          <form id="checkout-form" onsubmit="window.shopCheckout.submit(event)">
            <div class="checkout-section">
              <h3>お客様情報</h3>
              <div class="form-group">
                <label>お名前 <span class="required">*</span></label>
                <input type="text" class="form-input" id="co-name" required placeholder="例: 山田 太郎">
              </div>
              <div class="form-group">
                <label>メールアドレス <span class="required">*</span></label>
                <input type="email" class="form-input" id="co-email" required placeholder="example@email.com">
              </div>
              <div class="form-group">
                <label>電話番号</label>
                <input type="tel" class="form-input" id="co-phone" placeholder="090-1234-5678">
              </div>
              <div class="form-group">
                <label>お子様の所属クラス <span class="required">*</span></label>
                <select class="form-input" id="co-class" required>
                  <option value="">選択してください</option>
                  ${classOptions}
                </select>
              </div>
              <div class="form-group">
                <label>備考</label>
                <textarea class="form-input" id="co-notes" rows="2" placeholder="ご要望があればご記入ください"></textarea>
              </div>
            </div>

            <div class="checkout-section">
              <h3>お支払い方法</h3>
              <div class="payment-options">
                <label class="payment-option selected" onclick="window.shopCheckout.selectPayment('cash', this)">
                  <input type="radio" name="payment" value="cash" checked>
                  <span class="material-icons">payments</span>
                  <div>
                    <div class="payment-option-label">現金払い</div>
                    <div class="payment-option-desc">次回の練習時にお支払いください</div>
                  </div>
                </label>
                <label class="payment-option" onclick="window.shopCheckout.selectPayment('stripe', this)">
                  <input type="radio" name="payment" value="stripe">
                  <span class="material-icons">credit_card</span>
                  <div>
                    <div class="payment-option-label">カード決済</div>
                    <div class="payment-option-desc">クレジットカード・デビットカードでお支払い</div>
                  </div>
                </label>
              </div>
            </div>

            <button type="submit" class="checkout-submit-btn" id="checkout-submit-btn">
              <span class="material-icons">check_circle</span>
              注文を確定する
            </button>
          </form>
        </div>
      </div>
    </div>`;
}

function selectPayment(method, el) {
  document.querySelectorAll('.payment-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  el.querySelector('input[type="radio"]').checked = true;
}

async function submitOrder(event) {
  event.preventDefault();
  if (isSubmitting) return;
  isSubmitting = true;

  const btn = document.getElementById('checkout-submit-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="material-icons" style="animation:spin 1s linear infinite">sync</span> 処理中...';

  try {
    const name = document.getElementById('co-name').value.trim();
    const email = document.getElementById('co-email').value.trim();
    const phone = document.getElementById('co-phone').value.trim();
    const studentClass = document.getElementById('co-class').value;
    const notes = document.getElementById('co-notes').value.trim();
    const paymentMethod = document.querySelector('input[name="payment"]:checked').value;

    if (!name || !email || !studentClass) {
      showToast('必須項目を入力してください', 'error');
      btn.disabled = false;
      btn.innerHTML = '<span class="material-icons">check_circle</span>注文を確定する';
      isSubmitting = false;
      return;
    }

    const cart = getCart();
    const items = cart.map(item => ({
      variantId: item.variantId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      productName: item.productName,
      variantSize: item.variantSize,
      variantColor: item.variantColor || '',
      variantSku: item.variantSku,
    }));

    // Call RPC to place order
    const { data, error } = await shopSupabase.rpc('shop_place_order', {
      p_buyer_name: name,
      p_buyer_email: email,
      p_buyer_phone: phone,
      p_student_class: studentClass,
      p_payment_method: paymentMethod,
      p_notes: notes || null,
      p_items: items,
    });

    if (error) {
      showToast('注文の処理に失敗しました: ' + error.message, 'error');
      btn.disabled = false;
      btn.innerHTML = '<span class="material-icons">check_circle</span>注文を確定する';
      isSubmitting = false;
      return;
    }

    if (data && data.error) {
      if (data.error === 'INSUFFICIENT_STOCK') {
        showToast(`在庫不足です（残り${data.available}点）。数量を調整してください。`, 'error');
      } else {
        showToast('注文エラー: ' + data.error, 'error');
      }
      btn.disabled = false;
      btn.innerHTML = '<span class="material-icons">check_circle</span>注文を確定する';
      isSubmitting = false;
      return;
    }

    // Order created successfully
    const orderNumber = data.orderNumber;
    const orderId = data.orderId;
    clearCart();

    if (paymentMethod === 'stripe' && STRIPE_PUBLISHABLE_KEY) {
      // Redirect to Stripe Checkout
      try {
        const response = await fetch('/api/create-checkout-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId,
            orderNumber,
            items: cart,
            totalAmount: data.totalAmount,
            buyerEmail: email,
          }),
        });

        const session = await response.json();
        if (session.url) {
          window.location.href = session.url;
          return;
        } else {
          showToast('決済ページへの遷移に失敗しました', 'error');
          // Fall through to confirmation page
        }
      } catch (e) {
        console.error('Stripe redirect error:', e);
        showToast('決済ページへの遷移に失敗しました', 'error');
      }
    }

    // Cash or Stripe fallback: go to confirmation
    window.location.hash = `#/confirmation/${orderNumber}`;

  } catch (e) {
    console.error('Order submit error:', e);
    showToast('注文の処理に失敗しました', 'error');
  } finally {
    isSubmitting = false;
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-icons">check_circle</span>注文を確定する';
    }
  }
}

// Global
window.shopCheckout = {
  submit: submitOrder,
  selectPayment,
};

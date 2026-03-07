// STARTUS Shop - Cart (localStorage-based)
import { escapeHtml, formatCurrency } from './shop-app.js';

const CART_KEY = 'startus-shop-cart';

// --- Cart data ---
export function getCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY) || '[]');
  } catch { return []; }
}

function setCart(items) {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
  updateCartBadge();
  renderCartDrawer();
}

export function addToCart(item) {
  const cart = getCart();
  const existing = cart.find(c => c.variantId === item.variantId);
  if (existing) {
    existing.quantity += item.quantity;
  } else {
    cart.push(item);
  }
  setCart(cart);
}

export function removeFromCart(variantId) {
  setCart(getCart().filter(c => c.variantId !== variantId));
}

export function updateQuantity(variantId, qty) {
  const cart = getCart();
  const item = cart.find(c => c.variantId === variantId);
  if (item) {
    if (qty <= 0) {
      setCart(cart.filter(c => c.variantId !== variantId));
    } else {
      item.quantity = qty;
      setCart(cart);
    }
  }
}

export function getCartTotal() {
  return getCart().reduce((s, c) => s + c.unitPrice * c.quantity, 0);
}

export function getCartCount() {
  return getCart().reduce((s, c) => s + c.quantity, 0);
}

export function clearCart() {
  localStorage.removeItem(CART_KEY);
  updateCartBadge();
  renderCartDrawer();
}

// --- Badge ---
export function updateCartBadge() {
  const badge = document.getElementById('cart-badge');
  if (!badge) return;
  const count = getCartCount();
  badge.textContent = count;
  badge.style.display = count > 0 ? '' : 'none';
}

// --- Toggle drawer ---
export function toggleCart(forceOpen) {
  const drawer = document.getElementById('cart-drawer');
  const overlay = document.getElementById('cart-overlay');
  if (!drawer || !overlay) return;

  const shouldOpen = forceOpen !== undefined ? forceOpen : !drawer.classList.contains('open');

  drawer.classList.toggle('open', shouldOpen);
  overlay.classList.toggle('open', shouldOpen);
  document.body.style.overflow = shouldOpen ? 'hidden' : '';
}

// --- Render drawer ---
export function renderCartDrawer() {
  const body = document.getElementById('cart-drawer-body');
  const footer = document.getElementById('cart-drawer-footer');
  if (!body || !footer) return;

  const cart = getCart();

  if (cart.length === 0) {
    body.innerHTML = `
      <div class="cart-empty">
        <span class="material-icons">shopping_cart</span>
        <p>カートは空です</p>
      </div>`;
    footer.innerHTML = '';
    return;
  }

  body.innerHTML = cart.map(item => `
    <div class="cart-item">
      ${item.imageUrl
        ? `<img class="cart-item-img" src="${item.imageUrl}" alt="" loading="lazy">`
        : '<div class="cart-item-img" style="display:flex;align-items:center;justify-content:center"><span class="material-icons" style="color:#ccc">image</span></div>'
      }
      <div class="cart-item-info">
        <div class="cart-item-name">${escapeHtml(item.productName)}</div>
        <div class="cart-item-variant">${escapeHtml(item.variantSize)}${item.variantColor ? ' / ' + escapeHtml(item.variantColor) : ''}</div>
        <div class="cart-item-price">${formatCurrency(item.unitPrice)}</div>
        <div class="cart-item-actions">
          <button class="cart-item-qty-btn" onclick="window.shopCart.updateQty('${item.variantId}', ${item.quantity - 1})">−</button>
          <span class="cart-item-qty">${item.quantity}</span>
          <button class="cart-item-qty-btn" onclick="window.shopCart.updateQty('${item.variantId}', ${item.quantity + 1})">+</button>
          <button class="cart-item-remove" onclick="window.shopCart.remove('${item.variantId}')" title="削除">
            <span class="material-icons" style="font-size:18px">delete</span>
          </button>
        </div>
      </div>
    </div>
  `).join('');

  footer.innerHTML = `
    <div class="cart-total">
      <span>合計</span>
      <span>${formatCurrency(getCartTotal())}</span>
    </div>
    <a class="cart-checkout-btn" href="#/checkout" onclick="window.shopApp.toggleCart(false)">
      <span class="material-icons">payment</span>
      レジに進む
    </a>`;
}

// Global
window.shopCart = {
  updateQty: (variantId, qty) => updateQuantity(variantId, qty),
  remove: (variantId) => removeFromCart(variantId),
};

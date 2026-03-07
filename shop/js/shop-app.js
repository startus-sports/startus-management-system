// STARTUS Shop - Main App (Router + Init)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SHOP_SUPABASE_URL, SHOP_SUPABASE_ANON_KEY } from './shop-config.js';
import { initCatalog, renderCatalog } from './shop-catalog.js';
import { renderProductDetail } from './shop-detail.js';
import { renderCartDrawer, updateCartBadge, toggleCart } from './shop-cart.js';
import { renderCheckout } from './shop-checkout.js';
import { renderConfirmation } from './shop-confirmation.js';

export const shopSupabase = createClient(SHOP_SUPABASE_URL, SHOP_SUPABASE_ANON_KEY);
export const isPreview = new URLSearchParams(window.location.search).get('preview') === 'admin';

// --- Router ---
function route() {
  const hash = window.location.hash || '#/';
  const main = document.getElementById('shop-main');

  if (hash === '#/' || hash === '#' || hash === '') {
    renderCatalog(main);
  } else if (hash.startsWith('#/product/')) {
    const id = hash.replace('#/product/', '');
    renderProductDetail(main, id);
  } else if (hash === '#/cart') {
    renderCatalog(main); // cart is a drawer, show catalog behind
    toggleCart(true);
  } else if (hash === '#/checkout') {
    renderCheckout(main);
  } else if (hash.startsWith('#/confirmation/')) {
    const rest = hash.replace('#/confirmation/', '');
    const orderNumber = rest.split('?')[0];
    renderConfirmation(main, orderNumber);
  } else {
    renderCatalog(main);
  }

  window.scrollTo(0, 0);
}

// --- Toast ---
export function showToast(message, type = 'info') {
  const container = document.getElementById('shop-toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `shop-toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => { el.remove(); }, 3000);
}

// --- Escape HTML ---
export function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// --- Format currency ---
export function formatCurrency(amount) {
  return '¥' + (amount || 0).toLocaleString('ja-JP');
}

// --- Init ---
async function init() {
  if (isPreview) {
    const banner = document.getElementById('preview-banner');
    if (banner) banner.style.display = 'flex';
  }

  await initCatalog();
  updateCartBadge();
  renderCartDrawer();
  route();

  window.addEventListener('hashchange', route);
}

// --- Global ---
window.shopApp = { toggleCart };
document.addEventListener('DOMContentLoaded', init);

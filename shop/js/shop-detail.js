// STARTUS Shop - Product Detail
import { escapeHtml, formatCurrency, showToast } from './shop-app.js';
import { getProduct } from './shop-catalog.js';
import { addToCart, toggleCart } from './shop-cart.js';

let selectedVariant = null;
let selectedQty = 1;
let currentProduct = null;

export function renderProductDetail(container, productId) {
  const p = getProduct(productId);
  if (!p) {
    container.innerHTML = `
      <div class="shop-empty">
        <span class="material-icons">error_outline</span>
        <p>商品が見つかりません</p>
        <a href="#/" class="btn-outline" style="margin-top:16px">ショップに戻る</a>
      </div>`;
    return;
  }

  currentProduct = p;
  selectedVariant = null;
  selectedQty = 1;

  const variants = (p.product_variants || []).filter(v => !v.deletedAt && v.isActive);
  const images = (p.product_images || []).sort((a, b) => a.sortOrder - b.sortOrder);
  const mainImg = images[0];

  // Build gallery
  const galleryMain = mainImg
    ? `<img src="${mainImg.url}" alt="${escapeHtml(p.name)}" id="gallery-main-img">`
    : '<div class="product-card-img-empty" style="height:100%"><span class="material-icons" style="font-size:64px">image</span></div>';

  const thumbs = images.length > 1
    ? `<div class="product-gallery-thumbs">
        ${images.map((img, i) => `
          <div class="product-gallery-thumb ${i === 0 ? 'active' : ''}" onclick="window.shopDetail.selectImage('${img.url}', this)">
            <img src="${img.url}" alt="" loading="lazy">
          </div>
        `).join('')}
      </div>`
    : '';

  // Group variants by color (if colors exist)
  const hasColors = variants.some(v => v.color);
  const colors = [...new Set(variants.map(v => v.color || '').filter(Boolean))];

  // Size buttons
  const sizeButtons = variants.map(v => {
    const avail = (v.inventory || {}).quantityAvailable || 0;
    const label = v.size + (v.color ? ` / ${v.color}` : '');
    return `
      <button class="variant-btn ${avail <= 0 ? 'disabled' : ''}"
              data-variant-id="${v.id}"
              onclick="window.shopDetail.selectVariant('${v.id}')"
              ${avail <= 0 ? 'disabled' : ''}>
        ${escapeHtml(label)}
      </button>`;
  }).join('');

  container.innerHTML = `
    <a href="#/" class="back-link">
      <span class="material-icons">arrow_back</span>商品一覧に戻る
    </a>
    <div class="product-detail">
      <div class="product-detail-top">
        <div class="product-gallery">
          <div class="product-gallery-main">${galleryMain}</div>
          ${thumbs}
        </div>
        <div class="product-info">
          <div class="product-info-name">${escapeHtml(p.name)}</div>
          <div class="product-info-price" id="detail-price">${formatCurrency(p.price)}</div>
          ${p.description ? `<div class="product-info-desc">${escapeHtml(p.description)}</div>` : ''}

          <div class="variant-section">
            <div class="variant-label">サイズ${hasColors ? ' / 色' : ''}を選択</div>
            <div class="variant-options" id="variant-options">${sizeButtons}</div>
          </div>

          <div class="qty-section" id="qty-section" style="display:none">
            <span class="qty-label">数量</span>
            <div class="qty-control">
              <button class="qty-btn" onclick="window.shopDetail.changeQty(-1)">−</button>
              <span class="qty-value" id="qty-value">1</span>
              <button class="qty-btn" onclick="window.shopDetail.changeQty(1)">+</button>
            </div>
          </div>
          <div class="stock-info" id="stock-info"></div>

          <button class="add-to-cart-btn" id="add-to-cart-btn" disabled
                  onclick="window.shopDetail.addToCartClick()">
            <span class="material-icons">add_shopping_cart</span>
            カートに追加
          </button>
        </div>
      </div>
    </div>`;

  // Auto-select if only one variant with stock
  const availVariants = variants.filter(v => (v.inventory || {}).quantityAvailable > 0);
  if (availVariants.length === 1) {
    selectVariant(availVariants[0].id);
  }
}

function selectVariant(variantId) {
  const p = currentProduct;
  if (!p) return;

  const variants = (p.product_variants || []).filter(v => !v.deletedAt && v.isActive);
  const v = variants.find(x => x.id === variantId);
  if (!v) return;

  selectedVariant = v;
  selectedQty = 1;

  // Update UI
  document.querySelectorAll('.variant-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.variantId === variantId);
  });

  const avail = (v.inventory || {}).quantityAvailable || 0;
  const price = v.priceOverride != null ? v.priceOverride : p.price;

  document.getElementById('detail-price').textContent = formatCurrency(price);
  document.getElementById('qty-section').style.display = avail > 0 ? 'flex' : 'none';
  document.getElementById('qty-value').textContent = '1';
  document.getElementById('stock-info').textContent = avail > 0 ? `在庫: ${avail}点` : '在庫切れ';
  document.getElementById('add-to-cart-btn').disabled = avail <= 0;
}

function changeQty(delta) {
  if (!selectedVariant) return;
  const avail = (selectedVariant.inventory || {}).quantityAvailable || 0;
  selectedQty = Math.max(1, Math.min(selectedQty + delta, avail));
  document.getElementById('qty-value').textContent = selectedQty;
}

function selectImage(url, thumbEl) {
  const mainImg = document.getElementById('gallery-main-img');
  if (mainImg) mainImg.src = url;
  document.querySelectorAll('.product-gallery-thumb').forEach(t => t.classList.remove('active'));
  if (thumbEl) thumbEl.classList.add('active');
}

function addToCartClick() {
  if (!selectedVariant || !currentProduct) return;

  const p = currentProduct;
  const v = selectedVariant;
  const img = (p.product_images || []).sort((a, b) => a.sortOrder - b.sortOrder)[0];
  const price = v.priceOverride != null ? v.priceOverride : p.price;

  addToCart({
    variantId: v.id,
    productId: p.id,
    productName: p.name,
    variantSize: v.size,
    variantColor: v.color || null,
    variantSku: v.sku,
    unitPrice: price,
    quantity: selectedQty,
    imageUrl: img ? img.url : null,
  });

  showToast('カートに追加しました', 'success');
  toggleCart(true);
}

// Global
window.shopDetail = { selectVariant, changeQty, selectImage, addToCartClick };

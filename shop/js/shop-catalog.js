// STARTUS Shop - Product Catalog
import { shopSupabase, isPreview, escapeHtml, formatCurrency } from './shop-app.js';

let allProducts = [];

export async function initCatalog() {
  let query = shopSupabase
    .from('products')
    .select('*, product_variants(*, inventory(*)), product_images(*)')
    .is('deletedAt', null)
    .order('sortOrder', { ascending: true });

  if (!isPreview) {
    query = query.eq('isActive', true);
  }

  const { data, error } = await query;
  if (error) {
    console.error('商品読み込みエラー:', error);
    allProducts = [];
  } else {
    allProducts = data || [];
  }
}

export function getProduct(id) {
  return allProducts.find(p => p.id === id);
}

export function getAllProducts() {
  return allProducts;
}

export function renderCatalog(container) {
  if (!container) return;

  if (allProducts.length === 0) {
    container.innerHTML = `
      <div class="shop-empty">
        <span class="material-icons">storefront</span>
        <p>現在、商品はありません</p>
      </div>`;
    return;
  }

  const cards = allProducts.map(p => {
    const variants = (p.product_variants || []).filter(v => !v.deletedAt);
    const totalStock = variants.reduce((s, v) => s + ((v.inventory || {}).quantityAvailable || 0), 0);
    const img = (p.product_images || []).sort((a, b) => a.sortOrder - b.sortOrder)[0];
    const isActive = p.isActive;

    let badge = '';
    if (!isActive && isPreview) {
      badge = '<span class="product-card-badge badge-inactive">非公開</span>';
    } else if (totalStock <= 0) {
      badge = '<span class="product-card-badge badge-soldout">品切れ</span>';
    }

    return `
      <a class="product-card" href="#/product/${p.id}">
        <div class="product-card-img-wrap">
          ${img
            ? `<img class="product-card-img" src="${img.url}" alt="${escapeHtml(p.name)}" loading="lazy">`
            : '<div class="product-card-img-empty"><span class="material-icons">image</span></div>'
          }
          ${badge}
        </div>
        <div class="product-card-body">
          <div class="product-card-name">${escapeHtml(p.name)}</div>
          <div class="product-card-price">${formatCurrency(p.price)}</div>
        </div>
      </a>`;
  }).join('');

  container.innerHTML = `
    <h2 class="shop-section-title">商品一覧</h2>
    <div class="product-grid">${cards}</div>`;
}

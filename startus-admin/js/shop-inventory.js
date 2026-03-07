import { shopSupabase } from './shop-supabase.js';
import { escapeHtml, formatCurrency } from './utils.js';

// --- State ---
let inventoryData = [];

// --- Load ---
export async function loadShopInventory() {
  try {
    const { data, error } = await shopSupabase
      .from('products')
      .select('*, product_variants(*, inventory(*)), product_images(*)')
      .is('deletedAt', null)
      .order('sortOrder', { ascending: true });

    if (error) { console.error('在庫読み込みエラー:', error); inventoryData = []; }
    else { inventoryData = data || []; }
  } catch (e) {
    console.error('在庫読み込みエラー:', e);
    inventoryData = [];
  }
  renderInventory();
}

// --- Render ---
function renderInventory() {
  const container = document.getElementById('shop-inventory-list');
  if (!container) return;

  if (inventoryData.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="material-icons empty-icon">warehouse</span>
        <p>在庫データがありません</p>
      </div>`;
    return;
  }

  const html = inventoryData.map(product => {
    const variants = (product.product_variants || []).filter(v => !v.deletedAt);
    if (variants.length === 0) return '';

    const variantRows = variants.map(v => {
      const inv = v.inventory || {};
      const avail = inv.quantityAvailable || 0;
      const threshold = inv.lowStockThreshold || 3;
      const badge = getStockBadge(avail, threshold);

      return `
        <div class="shop-inv-row">
          <span class="shop-cell-mono">${escapeHtml(v.sku)}</span>
          <span>${escapeHtml(v.size)}</span>
          <span>${v.color ? escapeHtml(v.color) : '-'}${v.colorCode ? ` <span class="shop-color-dot" style="background:${v.colorCode}"></span>` : ''}</span>
          <span style="text-align:center">${inv.quantityTotal || 0}</span>
          <span style="text-align:center;font-weight:600">${avail}</span>
          <span style="text-align:center">${inv.quantityReserved || 0}</span>
          <span style="text-align:center">${inv.quantitySold || 0}</span>
          <span><span class="badge ${badge.cssClass}">${badge.label}</span></span>
        </div>`;
    }).join('');

    const img = (product.product_images || []).sort((a, b) => a.sortOrder - b.sortOrder)[0];

    return `
      <div class="shop-inv-product">
        <div class="shop-inv-product-header">
          ${img ? `<img src="${img.url}" alt="" class="shop-inv-thumb">` : ''}
          <div>
            <strong>${escapeHtml(product.name)}</strong>
            <span class="shop-inv-price">${formatCurrency(product.price)}</span>
            ${!product.isActive ? '<span class="badge badge-shop-danger">非公開</span>' : ''}
          </div>
        </div>
        <div class="shop-inv-grid-header">
          <span>SKU</span><span>サイズ</span><span>色</span>
          <span>総数</span><span>購入可</span><span>取置</span><span>販売済</span><span>状態</span>
        </div>
        ${variantRows}
      </div>`;
  }).join('');

  container.innerHTML = html || `
    <div class="empty-state">
      <span class="material-icons empty-icon">warehouse</span>
      <p>在庫データがありません</p>
    </div>`;
}

function getStockBadge(available, threshold) {
  if (available <= 0) return { label: '品切れ', cssClass: 'badge-shop-danger' };
  if (available <= threshold) return { label: '在庫少', cssClass: 'badge-shop-warning' };
  return { label: '在庫あり', cssClass: 'badge-shop-success' };
}

import { shopSupabase } from './shop-supabase.js';
import { SHOP_STORAGE_BUCKET } from './shop-config.js';
import { escapeHtml, formatCurrency } from './utils.js';
import { showToast, openModal, closeModal, setModalWide } from './app.js';

// --- State ---
let allProducts = [];
let filteredProducts = [];
let searchQuery = '';

// Size presets
const SIZE_PRESETS = {
  'ウェア（キッズ〜大人）': ['130', '140', '150', 'SS', 'S', 'M', 'L', 'XL'],
  'ウェア（大人のみ）': ['SS', 'S', 'M', 'L', 'XL', '2XL'],
  'シューズ': ['22.0', '22.5', '23.0', '23.5', '24.0', '24.5', '25.0', '25.5', '26.0', '26.5', '27.0', '27.5', '28.0'],
  'フリーサイズ': ['FREE'],
  'なし（サイズなし）': ['ONE'],
};

// --- Load ---
export async function loadShopProducts() {
  try {
    const { data, error } = await shopSupabase
      .from('products')
      .select('*, product_variants(*, inventory(*)), product_images(*)')
      .is('deletedAt', null)
      .order('sortOrder', { ascending: true });

    if (error) { console.error('商品読み込みエラー:', error); allProducts = []; }
    else { allProducts = data || []; }
  } catch (e) {
    console.error('商品読み込みエラー:', e);
    allProducts = [];
  }
  applyAndRender();
}

function applyAndRender() {
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filteredProducts = allProducts.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.product_variants || []).some(v => (v.sku || '').toLowerCase().includes(q))
    );
  } else {
    filteredProducts = allProducts;
  }
  renderProductList();
}

// --- Product list ---
function renderProductList() {
  const container = document.getElementById('shop-product-list');
  const countEl = document.getElementById('shop-product-count');
  if (!container) return;

  if (countEl) countEl.textContent = `${filteredProducts.length}件`;

  if (filteredProducts.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="material-icons empty-icon">inventory_2</span>
        <p>商品データがありません</p>
      </div>`;
    return;
  }

  const rows = filteredProducts.map(p => {
    const variants = (p.product_variants || []).filter(v => !v.deletedAt);
    const totalStock = variants.reduce((s, v) => s + ((v.inventory || {}).quantityAvailable || 0), 0);
    const img = (p.product_images || []).sort((a, b) => a.sortOrder - b.sortOrder)[0];

    const variantBadges = variants.slice(0, 5).map(v => {
      const avail = (v.inventory || {}).quantityAvailable || 0;
      return `<span class="badge ${avail > 0 ? 'badge-shop-outline' : 'badge-shop-danger-outline'}">${escapeHtml(v.size)}${v.color ? '/' + escapeHtml(v.color) : ''}: ${avail}</span>`;
    }).join(' ');

    return `
      <div class="list-item shop-product-card" onclick="window.memberApp.showProductDetail('${p.id}')">
        <div class="shop-product-card-left">
          ${img ? `<img src="${img.url}" alt="" class="shop-product-thumb">` : '<div class="shop-product-thumb-empty"><span class="material-icons">image</span></div>'}
          <div class="shop-product-info">
            <div class="shop-product-name">
              ${escapeHtml(p.name)}
              ${!p.isActive ? '<span class="badge badge-shop-danger">非公開</span>' : '<span class="badge badge-shop-success">公開中</span>'}
            </div>
            <div class="shop-product-meta">
              ${formatCurrency(p.price)} / ${variants.length}バリアント / 在庫合計: ${totalStock}
            </div>
            <div class="shop-product-variants">${variantBadges}${variants.length > 5 ? ` +${variants.length - 5}` : ''}</div>
          </div>
        </div>
        <span class="material-icons list-item-arrow">chevron_right</span>
      </div>`;
  }).join('');

  container.innerHTML = rows;
}

// --- Product detail ---
export function showProductDetail(productId) {
  const p = allProducts.find(x => x.id === productId);
  if (!p) return;

  const variants = (p.product_variants || []).filter(v => !v.deletedAt);
  const images = (p.product_images || []).sort((a, b) => a.sortOrder - b.sortOrder);

  const imageGallery = images.length > 0
    ? `<div class="shop-image-gallery">${images.map(img => `<img src="${img.url}" alt="${escapeHtml(img.altText || '')}" class="shop-gallery-img">`).join('')}</div>`
    : '';

  const variantRows = variants.map(v => {
    const inv = v.inventory || {};
    return `
      <tr>
        <td class="shop-cell-mono">${escapeHtml(v.sku)}</td>
        <td>${escapeHtml(v.size)}</td>
        <td>${v.color ? escapeHtml(v.color) : '-'}${v.colorCode ? ` <span class="shop-color-dot" style="background:${v.colorCode}"></span>` : ''}</td>
        <td style="text-align:right">${v.priceOverride != null ? formatCurrency(v.priceOverride) : '-'}</td>
        <td style="text-align:center">${inv.quantityAvailable || 0}</td>
        <td style="text-align:center">${inv.quantityTotal || 0}</td>
        <td>${v.isActive ? '<span class="badge badge-shop-success">有効</span>' : '<span class="badge badge-shop-danger">無効</span>'}</td>
      </tr>`;
  }).join('');

  const content = `
    <div class="shop-detail">
      ${imageGallery}
      <div class="shop-detail-row"><label>商品名</label><span style="font-weight:600">${escapeHtml(p.name)}</span></div>
      <div class="shop-detail-row"><label>価格</label><span>${formatCurrency(p.price)}</span></div>
      <div class="shop-detail-row"><label>状態</label><span>${p.isActive ? '<span class="badge badge-shop-success">公開中</span>' : '<span class="badge badge-shop-danger">非公開</span>'}</span></div>
      ${p.description ? `<div class="shop-detail-row"><label>説明</label><span>${escapeHtml(p.description)}</span></div>` : ''}

      <h4 style="margin:16px 0 8px">バリアント (${variants.length}件)</h4>
      <div class="shop-table-wrap">
        <table class="shop-table">
          <thead><tr><th>SKU</th><th>サイズ</th><th>色</th><th>価格上書</th><th>在庫</th><th>総数</th><th>状態</th></tr></thead>
          <tbody>${variantRows}</tbody>
        </table>
      </div>

      <div class="shop-detail-actions">
        <button class="btn btn-primary" onclick="window.memberApp.openProductEditForm('${p.id}')">
          <span class="material-icons">edit</span>編集
        </button>
        <button class="btn btn-secondary btn-danger-text" onclick="window.memberApp.deleteProduct('${p.id}')">
          <span class="material-icons">delete</span>削除
        </button>
      </div>
    </div>`;

  setModalWide(true);
  openModal(`商品詳細: ${p.name}`, content);
}

// --- Product add/edit form ---
export function openProductAddForm() {
  openProductForm(null);
}

export function openProductEditForm(productId) {
  const p = allProducts.find(x => x.id === productId);
  closeModal();
  setTimeout(() => openProductForm(p), 100);
}

function openProductForm(product) {
  const isEdit = !!product;
  const variants = isEdit ? (product.product_variants || []).filter(v => !v.deletedAt) : [];

  const presetOptions = Object.keys(SIZE_PRESETS).map(k => `<option value="${k}">${k}</option>`).join('');

  const variantRowsHtml = variants.map((v, i) => buildVariantRowHtml(v, i)).join('');

  const content = `
    <form id="shop-product-form" onsubmit="window.memberApp.saveProduct(event, ${isEdit ? `'${product.id}'` : 'null'})">
      <div class="form-group">
        <label>商品名 <span class="required">*</span></label>
        <input type="text" id="sp-name" class="form-input" value="${isEdit ? escapeHtml(product.name) : ''}" required>
      </div>
      <div class="form-group">
        <label>説明</label>
        <textarea id="sp-description" class="form-input" rows="3">${isEdit ? escapeHtml(product.description || '') : ''}</textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>基本価格 (円) <span class="required">*</span></label>
          <input type="number" id="sp-price" class="form-input" value="${isEdit ? product.price : ''}" min="0" required>
        </div>
        <div class="form-group">
          <label>公開</label>
          <select id="sp-isActive" class="form-input">
            <option value="true" ${!isEdit || product.isActive ? 'selected' : ''}>公開</option>
            <option value="false" ${isEdit && !product.isActive ? 'selected' : ''}>非公開</option>
          </select>
        </div>
      </div>

      <h4 style="margin:16px 0 8px">バリアント</h4>
      <div class="form-group">
        <label>サイズプリセット</label>
        <select id="sp-preset" class="form-input" onchange="window.memberApp.applyPreset()">
          <option value="">選択してください...</option>
          ${presetOptions}
        </select>
      </div>
      <div id="sp-variants">${variantRowsHtml}</div>
      <button type="button" class="btn btn-secondary" onclick="window.memberApp.addVariantRow()" style="margin-bottom:16px">
        <span class="material-icons">add</span>バリアント追加
      </button>

      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="window.memberApp.closeModal()">キャンセル</button>
        <button type="submit" class="btn btn-primary">${isEdit ? '更新' : '保存'}</button>
      </div>
    </form>`;

  setModalWide(true);
  openModal(isEdit ? '商品編集' : '商品追加', content);
}

function buildVariantRowHtml(v, idx) {
  v = v || {};
  const inv = v.inventory || {};
  return `
    <div class="shop-variant-row" data-idx="${idx}">
      <div class="form-row">
        <div class="form-group" style="flex:1">
          <label>サイズ</label>
          <input type="text" class="form-input sp-v-size" value="${escapeHtml(v.size || '')}" required>
        </div>
        <div class="form-group" style="flex:1">
          <label>色</label>
          <input type="text" class="form-input sp-v-color" value="${escapeHtml(v.color || '')}">
        </div>
        <div class="form-group" style="flex:1">
          <label>SKU</label>
          <input type="text" class="form-input sp-v-sku" value="${escapeHtml(v.sku || '')}" required>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group" style="flex:1">
          <label>在庫数</label>
          <input type="number" class="form-input sp-v-stock" value="${inv.quantityAvailable || 0}" min="0">
        </div>
        <div class="form-group" style="flex:1">
          <label>価格上書 (円)</label>
          <input type="number" class="form-input sp-v-price" value="${v.priceOverride != null ? v.priceOverride : ''}" min="0">
        </div>
        <div class="form-group" style="flex:0 0 auto;align-self:flex-end">
          <button type="button" class="btn btn-icon-sm btn-danger-text" onclick="this.closest('.shop-variant-row').remove()">
            <span class="material-icons">delete</span>
          </button>
        </div>
      </div>
      ${v.id ? `<input type="hidden" class="sp-v-id" value="${v.id}">` : ''}
    </div>`;
}

// --- Add variant row dynamically ---
export function addVariantRow() {
  const container = document.getElementById('sp-variants');
  if (!container) return;
  const idx = container.children.length;
  container.insertAdjacentHTML('beforeend', buildVariantRowHtml(null, idx));
}

// --- Apply size preset ---
export function applyPreset() {
  const sel = document.getElementById('sp-preset');
  if (!sel || !sel.value) return;
  const sizes = SIZE_PRESETS[sel.value];
  if (!sizes) return;

  const container = document.getElementById('sp-variants');
  if (!container) return;

  sizes.forEach(size => {
    const idx = container.children.length;
    container.insertAdjacentHTML('beforeend', buildVariantRowHtml({ size }, idx));
  });
  sel.value = '';
}

// --- Save product ---
export async function saveProduct(event, productId) {
  event.preventDefault();

  const name = document.getElementById('sp-name').value.trim();
  const description = document.getElementById('sp-description').value.trim();
  const price = parseInt(document.getElementById('sp-price').value);
  const isActive = document.getElementById('sp-isActive').value === 'true';

  if (!name || isNaN(price) || price < 0) {
    showToast('商品名と価格を正しく入力してください', 'error');
    return;
  }

  // Collect variants
  const variantRows = document.querySelectorAll('.shop-variant-row');
  const variants = [];
  for (const row of variantRows) {
    const size = row.querySelector('.sp-v-size')?.value.trim();
    const color = row.querySelector('.sp-v-color')?.value.trim() || null;
    const sku = row.querySelector('.sp-v-sku')?.value.trim();
    const stock = parseInt(row.querySelector('.sp-v-stock')?.value || '0');
    const priceOverride = row.querySelector('.sp-v-price')?.value ? parseInt(row.querySelector('.sp-v-price').value) : null;
    const existingId = row.querySelector('.sp-v-id')?.value || null;

    if (!size || !sku) {
      showToast('バリアントのサイズとSKUは必須です', 'error');
      return;
    }
    variants.push({ size, color, sku, stock, priceOverride, existingId });
  }

  if (variants.length === 0) {
    showToast('少なくとも1つのバリアントが必要です', 'error');
    return;
  }

  try {
    if (productId) {
      await updateProduct(productId, { name, description, price, isActive }, variants);
    } else {
      await createProduct({ name, description, price, isActive }, variants);
    }
    showToast(productId ? '商品を更新しました' : '商品を追加しました', 'success');
    closeModal();
    await loadShopProducts();
  } catch (e) {
    console.error('商品保存エラー:', e);
    showToast('商品の保存に失敗しました: ' + e.message, 'error');
  }
}

async function createProduct(productData, variants) {
  // 1. Create product
  const maxSort = allProducts.reduce((m, p) => Math.max(m, p.sortOrder || 0), 0);
  const { data: product, error: pErr } = await shopSupabase
    .from('products')
    .insert({
      name: productData.name,
      description: productData.description || null,
      price: productData.price,
      isActive: productData.isActive,
      sortOrder: maxSort + 1,
      metadata: {},
    })
    .select()
    .single();

  if (pErr) throw new Error(pErr.message);

  // 2. Create variants + inventory
  for (const v of variants) {
    const { data: variant, error: vErr } = await shopSupabase
      .from('product_variants')
      .insert({
        productId: product.id,
        size: v.size,
        color: v.color,
        sku: v.sku,
        priceOverride: v.priceOverride,
        isActive: true,
        sortOrder: 0,
        metadata: {},
      })
      .select()
      .single();

    if (vErr) throw new Error(vErr.message);

    const { error: iErr } = await shopSupabase
      .from('inventory')
      .insert({
        variantId: variant.id,
        quantityTotal: v.stock,
        quantityAvailable: v.stock,
        quantityReserved: 0,
        quantitySold: 0,
        lowStockThreshold: 3,
      });

    if (iErr) throw new Error(iErr.message);
  }
}

async function updateProduct(productId, productData, variants) {
  // 1. Update product
  const { error: pErr } = await shopSupabase
    .from('products')
    .update({
      name: productData.name,
      description: productData.description || null,
      price: productData.price,
      isActive: productData.isActive,
    })
    .eq('id', productId);

  if (pErr) throw new Error(pErr.message);

  // 2. Get existing variants
  const { data: existingVariants } = await shopSupabase
    .from('product_variants')
    .select('id')
    .eq('productId', productId)
    .is('deletedAt', null);

  const existingIds = new Set((existingVariants || []).map(v => v.id));
  const updatedIds = new Set();

  // 3. Update/create variants
  for (const v of variants) {
    if (v.existingId && existingIds.has(v.existingId)) {
      // Update existing
      updatedIds.add(v.existingId);
      const { error: vErr } = await shopSupabase
        .from('product_variants')
        .update({ size: v.size, color: v.color, sku: v.sku, priceOverride: v.priceOverride })
        .eq('id', v.existingId);
      if (vErr) throw new Error(vErr.message);

      // Update inventory
      const { error: iErr } = await shopSupabase
        .from('inventory')
        .update({ quantityAvailable: v.stock, quantityTotal: v.stock })
        .eq('variantId', v.existingId);
      if (iErr) throw new Error(iErr.message);
    } else {
      // Create new variant
      const { data: variant, error: vErr } = await shopSupabase
        .from('product_variants')
        .insert({
          productId, size: v.size, color: v.color, sku: v.sku,
          priceOverride: v.priceOverride, isActive: true, sortOrder: 0, metadata: {},
        })
        .select()
        .single();
      if (vErr) throw new Error(vErr.message);

      const { error: iErr } = await shopSupabase
        .from('inventory')
        .insert({
          variantId: variant.id, quantityTotal: v.stock, quantityAvailable: v.stock,
          quantityReserved: 0, quantitySold: 0, lowStockThreshold: 3,
        });
      if (iErr) throw new Error(iErr.message);
    }
  }

  // 4. Soft-delete removed variants
  for (const id of existingIds) {
    if (!updatedIds.has(id)) {
      await shopSupabase
        .from('product_variants')
        .update({ deletedAt: new Date().toISOString(), isActive: false })
        .eq('id', id);
    }
  }
}

// --- Delete product ---
export async function deleteProduct(productId) {
  if (!confirm('この商品を削除しますか？')) return;

  try {
    const now = new Date().toISOString();
    await shopSupabase
      .from('products')
      .update({ deletedAt: now, isActive: false })
      .eq('id', productId);

    await shopSupabase
      .from('product_variants')
      .update({ deletedAt: now, isActive: false })
      .eq('productId', productId);

    showToast('商品を削除しました', 'success');
    closeModal();
    await loadShopProducts();
  } catch (e) {
    showToast('削除に失敗しました', 'error');
  }
}

// --- Search ---
export function initShopProductSearch() {
  const input = document.getElementById('shop-product-search-input');
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

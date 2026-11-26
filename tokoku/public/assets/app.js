(() => {
  const API = '../api/index.php';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = {
    customerPage: 1,
    reportPage: 1,
    reportFrom: '',
    reportTo: '',
    chart: null,
    logTimer: null,
    orderTimer: null,
    walletTimer: null,
    walletAdminTimer: null,
    calcTimer: null,
    calcSequence: 0,
    csrfToken: '',
    authRole: 'admin',
    authMode: 'login',
    user: null,
    storeProducts: [],
    productRows: [],
    storeCart: {},
    onlinePaymentRows: [],
    storeCartOpen: false,
    posCart: {},
    selectedVariants: { store: {}, pos: {} },
    expandedProducts: new Set(),
    cartPreviewTimers: {},
    cartPreviewSequence: { store: 0, pos: 0 },
    productTimer: null
  };

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const money = value => new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0
  }).format(Number(value) || 0);
  const dateTime = value => {
    if (!value) return '—';
    const date = new Date(String(value).replace(' ', 'T'));
    if (Number.isNaN(date.getTime())) return escapeHtml(value);
    return new Intl.DateTimeFormat('id-ID', String(value).length === 10
      ? { dateStyle: 'medium' }
      : { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  };

  async function request(route, options = {}) {
    const [endpoint, ...queryParts] = route.split('&');
    const params = new URLSearchParams({ route: endpoint });
    queryParts.forEach(part => {
      const separator = part.indexOf('=');
      if (separator > -1) params.set(part.slice(0, separator), part.slice(separator + 1));
    });
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (['POST', 'PUT', 'DELETE'].includes(String(options.method || 'GET').toUpperCase())) {
      headers['X-CSRF-Token'] = state.csrfToken;
    }
    const response = await fetch(`${API}?${params}`, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Permintaan gagal (${response.status}).`);
    return payload;
  }

  function toast(message, type = 'success') {
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.textContent = message;
    $('#toastRegion').append(node);
    window.setTimeout(() => node.remove(), 3900);
  }

  function setBusy(element, busy) {
    if (element) element.classList.toggle('loading', busy);
  }

  function showAuth(message = '') {
    $('#authScreen').hidden = false;
    $('#adminApp').hidden = true;
    $('#customerPortal').hidden = true;
    $('#authError').textContent = message;
    $('#authError').hidden = !message;
  }

  function updateAuthForm() {
    const registering = state.authMode === 'register';
    const roleLabel = state.authRole === 'admin' ? 'Admin' : state.authRole === 'cashier' ? 'Kasir' : 'Pelanggan';
    $$('[data-auth-role]').forEach(button => {
      const active = button.dataset.authRole === state.authRole;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    $('#authModeLabel').textContent = registering
      ? 'Buat akun pelanggan baru'
      : `Masuk sebagai ${roleLabel}`;
    $('#showRegister').hidden = state.authRole !== 'customer' || registering;
    $('#showLogin').hidden = !registering;
    $('#registerFields').hidden = !registering;
    $('#authName').required = registering;
    $('#authPassword').minLength = registering ? 10 : 0;
    $('#authPassword').autocomplete = registering ? 'new-password' : 'current-password';
    $('#authSubmit').innerHTML = registering ? 'Buat akun <span>→</span>' : 'Masuk <span>→</span>';
    $('#authError').hidden = true;
    $('#authPassword').value = '';
  }

  async function enterApp(user) {
    state.user = user;
    window.clearInterval(state.walletTimer);
    window.clearInterval(state.walletAdminTimer);
    $('#authScreen').hidden = true;
    $('#adminApp').hidden = user.role === 'customer';
    $('#customerPortal').hidden = user.role !== 'customer';
    if (user.role === 'admin' || user.role === 'cashier') {
      const email = user.email || 'Administrator';
      $('#adminName').textContent = user.role === 'cashier' ? 'Kasir' : 'Admin Toko';
      $('#adminEmail').textContent = email;
      $('#adminAvatar').textContent = email.slice(0, 2).toUpperCase();
      $$('[data-admin-only]').forEach(node => { node.hidden = user.role !== 'admin'; });
      $('#reportAudience').textContent = user.role === 'cashier'
        ? 'Laporan hanya menampilkan transaksi POS yang diproses oleh akun kasir Anda.'
        : 'Lihat seluruh transaksi toko dan ekspor laporan berdasarkan rentang tanggal.';
      $('#page-dashboard').classList.toggle('active', user.role === 'admin');
      if (user.role === 'cashier') showPage('pos');
      else loadDashboard();
      if (user.role === 'admin') loadCustomerOptions();
      loadPosProducts();
      $('#posCustomerField').hidden = user.role === 'cashier';
      window.clearInterval(state.productTimer);
      state.productTimer = window.setInterval(() => {
        if (!$('#adminApp').hidden && $('#page-pos').classList.contains('active')) loadPosProducts(true);
      }, 20000);
      return;
    }
    $('#portalName').textContent = user.nama || 'Pelanggan';
    $('#portalGreeting').textContent = user.nama || 'Pelanggan';
    $('#portalEmail').textContent = user.email || '';
    $('#portalAvatar').textContent = String(user.nama || 'PL').split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase();
    await loadCustomerPortal();
    loadStoreProducts();
    window.clearInterval(state.productTimer);
    state.productTimer = window.setInterval(() => {
      if (!$('#customerPortal').hidden) loadStoreProducts(true);
    }, 20000);
    state.walletTimer = window.setInterval(() => {
      if (!$('#customerPortal').hidden) refreshCustomerWallet(true);
    }, 20000);
  }

  async function initializeAuth() {
    $('#authSubmit').disabled = true;
    try {
      const session = await request('auth/session');
      state.csrfToken = session.csrf_token;
      if (session.authenticated) {
        await enterApp(session.user);
      } else {
        showAuth();
        updateAuthForm();
      }
    } catch (error) {
      showAuth(`${error.message} Pastikan migrasi database autentikasi sudah dijalankan.`);
    }
    $('#authSubmit').disabled = !state.csrfToken;
  }

  async function loadCustomerPortal() {
    try {
      const [profile, history, wallet] = await Promise.all([
        request('my-profile'),
        request('orders'),
        request('wallet')
      ]);
      const customer = profile.data;
      $('#portalName').textContent = customer.nama;
      $('#portalGreeting').textContent = customer.nama;
      $('#portalEmail').textContent = customer.email;
      const initials = customer.nama.split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase();
      $('#portalAvatar').textContent = initials;
      $('#profileAvatar').textContent = initials;
      $('#profileName').textContent = customer.nama;
      $('#profileEmail').textContent = customer.email;
      $('#profileCity').textContent = customer.kota || '—';
      $('#profileId').textContent = `#${customer.id_pelanggan}`;
      $('#customerCategoryBadge').textContent = customer.kategori || 'Reguler';
      $('#customerCategoryBadge').className = `category-badge ${String(customer.kategori || '').toLowerCase().includes('gold') ? 'gold' : String(customer.kategori || '').toLowerCase().includes('silver') ? 'silver' : 'reguler'}`;
      renderCustomerWallet(wallet.data);
      $('#portalTransactionCount').textContent = history.data.length;
      $('#portalTransactionRows').innerHTML = history.data.length ? history.data.map(row => `
        <tr><td><b>${row.id_pesanan ? `#ORD-${escapeHtml(row.id_pesanan)}` : `#TRX-${escapeHtml(row.id_transaksi)}`}</b></td><td>${dateTime(row.created_at || row.tanggal)}</td>
        <td>${Number(row.jumlah_item)} barang</td><td>${escapeHtml(row.metode_pembayaran ? paymentLabel(row.metode_pembayaran) : 'Data lama')}
          ${row.metode_pembayaran === 'duitku' && row.status === 'pending' && row.payment_url
            ? `<button class="button button-small button-quiet" data-payment-url="${escapeHtml(row.payment_url)}">Lanjut bayar</button>`
            : row.metode_pembayaran === 'qris' && ['pending', 'paying'].includes(row.status)
            ? `<button class="button button-small button-quiet" data-show-qris="${Number(row.id_pesanan)}" data-qris-total="${Number(row.total_belanja)}" data-qris-reference="${escapeHtml(row.payment_reference || `QRIS-${Number(row.id_pesanan)}`)}">Lihat QRIS</button>`
              : ''}</td>
        <td><span class="status-badge ${escapeHtml(row.status)}">${escapeHtml(statusLabel(row.status))}</span></td>
        <td class="right"><b>${money(row.total_belanja)}</b></td></tr>`).join('')
        : '<tr><td colspan="6" class="empty-state">Belum ada pesanan. Pilih produk dari katalog untuk mulai berbelanja.</td></tr>';
    } catch (error) {
      $('#portalTransactionRows').innerHTML = `<tr><td colspan="4" class="empty-state">${escapeHtml(error.message)}</td></tr>`;
      toast(error.message, 'error');
    }
  }

  function renderCustomerWallet(wallet) {
    const balance = money(wallet.saldo);
    $('#walletBalance').textContent = balance;
    $('#storeWalletBalanceHint').textContent = balance;
    const latestTopup = wallet.topups[0];
    const status = $('#walletTopupStatus');
    status.textContent = '';
    if (!latestTopup) {
      status.textContent = 'Top up akan masuk setelah pembayaran dikonfirmasi.';
      return;
    }

    status.append(document.createTextNode(
      `Top up #${latestTopup.id_topup} ${topupStatusLabel(latestTopup.status).toLowerCase()} · ${money(latestTopup.nominal)}`
    ));
  }

  async function refreshCustomerWallet(silent = false) {
    try {
      const wallet = await request('wallet');
      renderCustomerWallet(wallet.data);
    } catch (error) {
      if (silent) console.error('Gagal memperbarui saldo pelanggan:', error);
      else toast(error.message, 'error');
    }
  }

  const paymentLabel = value => ({
    cash: 'Tunai', cod: 'COD', bank: 'Transfer bank', debit: 'Debit', ovo: 'OVO',
    dana: 'DANA', gopay: 'GoPay', qris: 'QRIS', wallet: 'Saldo Tokoku',
    duitku: 'Duitku'
  })[value] || 'Metode lain';
  const topupStatusLabel = value => ({
    pending: 'Menunggu konfirmasi',
    approved: 'Disetujui',
    rejected: 'Ditolak',
    expired: 'Kedaluwarsa',
    failed: 'Gagal'
  })[value] || value;
  const statusLabel = value => ({
    pending: 'Pending', paying: 'Membayar', processing: 'Diproses',
    completed: 'Selesai', cancelled: 'Dibatalkan'
  })[value] || value;

  function productCard(product, kind) {
    const id = Number(product.id_produk);
    const variants = product.variants || [];
    const selectedId = Number(state.selectedVariants[kind][id]) || Number(variants[0]?.id_produk);
    const selectedVariant = variants.find(variant => Number(variant.id_produk) === selectedId);
    const quantity = selectedVariant
      ? (kind === 'store' ? state.storeCart : state.posCart)[selectedId] || 0
      : 0;
    const discounted = Number(product.diskon_aktif) === 1 && Number(product.diskon_persen) > 0;
    const currentPrice = Number(product.harga) * (1 - (discounted ? Number(product.diskon_persen) / 100 : 0));
    const image = product.gambar_url
      ? `<img src="${escapeHtml(product.gambar_url)}" alt="${escapeHtml(product.nama_produk)}" loading="lazy">`
      : '<span aria-hidden="true">◈</span>';
    const sizes = variants.filter(variant => Number(variant.aktif) === 1);
    const variantOptions = sizes.map(variant =>
      `<option value="${Number(variant.id_produk)}" ${Number(variant.id_produk) === selectedId ? 'selected' : ''} ${Number(variant.stok) < 1 ? 'disabled' : ''}>${escapeHtml(variant.ukuran || 'Reguler')} · stok ${Number(variant.stok)}</option>`
    ).join('');
    return `<article class="product-card ${kind === 'store' ? 'store-product-card' : ''}">
      <div class="product-image ${kind === 'store' ? 'store-product-image' : ''}">${image}${discounted ? `<span class="product-discount">−${escapeHtml(product.diskon_persen)}%</span>` : ''}</div>
      <div class="product-copy"><small>${escapeHtml(product.kategori)}</small><h3>${escapeHtml(product.nama_produk)}</h3>
        <div class="product-price">${discounted ? `<del>${money(product.harga)}</del>` : ''}<b>${money(currentPrice)}</b></div>
        <label class="product-size-label">Pilih varian<select class="form-control product-size-select" data-product-variant="${id}" data-kind="${kind}" ${sizes.length ? '' : 'disabled'}>${variantOptions || '<option value="">Stok habis</option>'}</select></label>
        <div class="product-card-foot"><span class="${Number(product.stok) < 5 ? 'stock-low' : ''}">Total stok ${Number(product.stok)}</span>
          ${quantity ? `<span class="product-quantity">Di keranjang ${quantity}</span>` : ''}
        </div><button class="button button-primary product-add" type="button" data-add-product="${id}" data-kind="${kind}" ${!sizes.some(variant => Number(variant.stok) > 0) ? 'disabled' : ''}>${!sizes.some(variant => Number(variant.stok) > 0) ? 'Stok habis' : '＋ Tambah'}</button>
      </div></article>`;
  }

  function renderProducts(products, container, kind) {
    container.innerHTML = products.length
      ? products.map(product => productCard(product, kind)).join('')
      : '<div class="empty-state product-empty">Katalog belum memiliki produk aktif. Silakan kembali setelah admin menambahkan barang.</div>';
  }

  async function loadStoreProducts(silent = false) {
    try {
      const response = await fetch(`${API}?route=products`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Katalog gagal dimuat.');
      state.storeProducts = payload.data;
      const search = $('#storeSearch').value.trim().toLowerCase();
      const selectedCategory = $('#storeCategory').value;
      const visible = payload.data.filter(product => (!search
        || `${product.nama_produk} ${product.kategori}`.toLowerCase().includes(search))
        && (!selectedCategory || product.kategori === selectedCategory));
      $('#storeProductCount').textContent = `${visible.length} ${visible.length === 1 ? 'produk' : 'produk'}`;
      const category = $('#storeCategory');
      const selected = category.value;
      category.innerHTML = '<option value="">Semua kategori</option>' +
        payload.categories.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
      category.value = selected;
      renderProducts(visible, $('#storeProducts'), 'store');
      renderCart('store');
    } catch (error) {
      if (!silent) toast(error.message, 'error');
      $('#storeProducts').innerHTML = `<div class="empty-state product-empty">${escapeHtml(error.message)}</div>`;
    }
  }

  async function loadPosProducts(silent = false) {
    try {
      const response = await fetch(`${API}?route=products`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Katalog gagal dimuat.');
      state.posProducts = payload.data;
      const search = $('#posSearch').value.trim().toLowerCase();
      const visible = payload.data.filter(product => !search
        || `${product.nama_produk} ${product.kategori}`.toLowerCase().includes(search));
      renderProducts(visible, $('#posProducts'), 'pos');
      renderCart('pos');
    } catch (error) {
      if (!silent) toast(error.message, 'error');
      $('#posProducts').innerHTML = `<div class="empty-state product-empty">${escapeHtml(error.message)}</div>`;
    }
  }

  function renderCart(kind) {
    const cart = kind === 'store' ? state.storeCart : state.posCart;
    const products = kind === 'store' ? state.storeProducts : (state.posProducts || []);
    const root = kind === 'store' ? $('#storeCartItems') : $('#posCartItems');
    window.clearTimeout(state.cartPreviewTimers[kind]);
    state.cartPreviewSequence[kind]++;
    const ids = Object.keys(cart);
    const count = ids.reduce((sum, id) => sum + cart[id], 0);
    $(`#${kind === 'store' ? 'storeCartCount' : 'posCartCount'}`).textContent = count;
    if (kind === 'store') {
      $('#storeCartHeaderCount').textContent = count;
      $('#storeFloatingCartCount').textContent = count;
      $('#storeCartToggle').setAttribute('aria-label', `Buka keranjang, ${count} barang`);
      $('#storeFloatingCart').setAttribute('aria-label', `Buka keranjang, ${count} barang`);
      $('#storeCheckout').disabled = count === 0;
    }
    if (!ids.length) {
      root.innerHTML = '<div class="empty-state">Keranjang masih kosong.</div>';
      if (kind === 'store') $('#storeCartTotal').textContent = money(0);
      else {
        $('#posSubtotal').textContent = money(0);
        $('#posDiscount').textContent = `− ${money(0)}`;
        $('#posTax').textContent = money(0);
        $('#posTotal').textContent = money(0);
        updateCashChangePreview(0);
      }
      return;
    }
    root.innerHTML = ids.map(id => {
      const product = products.find(item => item.variants?.some(variant => Number(variant.id_produk) === Number(id)));
      const variant = product?.variants.find(item => Number(item.id_produk) === Number(id));
      if (!product || !variant) return '';
      return `<div class="cart-line"><div><b>${escapeHtml(product.nama_produk)} · ${escapeHtml(variant.ukuran || 'Reguler')}</b><small>${money(product.harga)} · stok ${Number(variant.stok)}</small></div>
        <div class="quantity-controls"><button type="button" aria-label="Kurangi" data-cart-change="${id}" data-kind="${kind}" data-delta="-1">−</button><span>${cart[id]}</span><button type="button" aria-label="Tambah" data-cart-change="${id}" data-kind="${kind}" data-delta="1">+</button></div></div>`;
    }).join('');
    updateCartSummary(kind);
  }

  function setStoreCartOpen(open) {
    state.storeCartOpen = open;
    $('#storeCartDrawer').classList.toggle('open', open);
    $('#storeCartDrawer').setAttribute('aria-hidden', String(!open));
    $('#storeCartDrawer').setAttribute('aria-modal', String(open));
    $('#storeCartOverlay').hidden = !open;
    document.body.classList.toggle('store-cart-open', open);
    if (open) $('#storeCartClose').focus();
    else $('#storeCartToggle').focus();
  }

  function setWalletTopupOpen(open) {
    $('#walletTopupModal').classList.toggle('open', open);
    $('#walletTopupModal').setAttribute('aria-hidden', String(!open));
    if (open) $('#walletTopupAmount').focus();
    else $('#openWalletTopup').focus();
  }

  function openOnlineQrisPayment(orderId, amount, reference = '') {
    $('#onlineQrisOrder').textContent = `#ORD-${Number(orderId)}`;
    $('#onlineQrisAmount').textContent = money(amount);
    $('#onlineQrisReference').textContent = reference || `QRIS-${Number(orderId)}`;
    $('#onlineQrisModal').classList.add('open');
    $('#onlineQrisModal').setAttribute('aria-hidden', 'false');
  }

  function closeOnlineQrisPayment() {
    $('#onlineQrisModal').classList.remove('open');
    $('#onlineQrisModal').setAttribute('aria-hidden', 'true');
  }

  function updateCartSummary(kind) {
    const cart = kind === 'store' ? state.storeCart : state.posCart;
    const items = Object.entries(cart).map(([id_produk, jumlah]) => ({ id_produk: Number(id_produk), jumlah }));
    const sequence = ++state.cartPreviewSequence[kind];
    window.clearTimeout(state.cartPreviewTimers[kind]);
    state.cartPreviewTimers[kind] = window.setTimeout(async () => {
      try {
        const query = new URLSearchParams({ route: 'calculate-cart', items: JSON.stringify(items) });
        const response = await fetch(`${API}?${query}`);
        const payload = await response.json();
        if (sequence !== state.cartPreviewSequence[kind]) return;
        if (!response.ok) throw new Error(payload.error || 'Keranjang perlu diperbarui.');
        const totals = payload.data;
        if (kind === 'store') {
          $('#storeCartTotal').textContent = money(totals.total_belanja);
        } else {
          $('#posSubtotal').textContent = money(totals.subtotal);
          $('#posDiscount').textContent = `− ${money(totals.diskon)}`;
          $('#posTax').textContent = money(totals.pajak);
          $('#posTotal').textContent = money(totals.total_belanja);
          updateCashChangePreview(totals.total_belanja);
        }
      } catch (error) {
        if (sequence !== state.cartPreviewSequence[kind]) return;
        toast(error.message, 'error');
      }
    }, 140);
  }

  function addProductToCart(id, kind, delta = 1) {
    const cart = kind === 'store' ? state.storeCart : state.posCart;
    const products = kind === 'store' ? state.storeProducts : (state.posProducts || []);
    const product = products.find(item => item.variants?.some(variant => Number(variant.id_produk) === Number(id)));
    const variant = product?.variants.find(item => Number(item.id_produk) === Number(id));
    if (!product || !variant) return;
    const next = (cart[id] || 0) + delta;
    if (next > Number(variant.stok)) {
      toast(`Stok ${product.nama_produk} ukuran ${variant.ukuran} hanya ${variant.stok}.`, 'error');
      return;
    }
    if (next <= 0) delete cart[id];
    else cart[id] = next;
    renderProducts(products, kind === 'store' ? $('#storeProducts') : $('#posProducts'), kind);
    renderCart(kind);
  }

  function updateCashChangePreview(total = Number($('#posTotal').dataset.total) || 0) {
    const totalValue = Number(total) || 0;
    $('#posTotal').dataset.total = String(totalValue);
    const received = Number($('#posCashTendered').value) || 0;
    $('#posChangePreview').textContent = money(Math.max(0, received - totalValue));
  }

  function renderVariantRows(variants = []) {
    $('#productVariantRows').innerHTML = variants.map(variant => `
      <div class="variant-edit-row" data-variant-row>
        <input type="hidden" data-variant-id value="${Number(variant.id_produk) || ''}">
        <label><span>Nama varian</span><input class="form-control" data-variant-size maxlength="30" value="${escapeHtml(variant.ukuran || 'Reguler')}" required></label>
        <label><span>Stok</span><input class="form-control" data-variant-stock type="number" min="0" step="1" value="${Number(variant.stok) || 0}" required></label>
        <label class="switch-label"><input type="checkbox" data-variant-active ${Number(variant.aktif ?? 1) ? 'checked' : ''}><span>Aktif</span></label>
        <label><span>Kode barcode fisik</span><input class="form-control" data-variant-barcode name="variant_barcode[]" type="text" maxlength="64" value="${escapeHtml(variant.barcode || '')}" placeholder="Scan atau masukkan barcode..."></label>
        ${variant.id_produk ? '' : '<button type="button" class="action-button" data-remove-variant title="Hapus baris varian">×</button>'}
      </div>`).join('');
  }

  async function checkoutCart(kind) {
    const cart = kind === 'store' ? state.storeCart : state.posCart;
    const items = Object.entries(cart).map(([id_produk, jumlah]) => ({ id_produk: Number(id_produk), jumlah }));
    if (!items.length) {
      toast('Tambahkan produk ke keranjang terlebih dahulu.', 'error');
      return;
    }
    const payment = kind === 'store' ? $('#storePayment').value : $('#posPayment').value;
    if (kind === 'pos' && payment === 'qris' && !$('#posQrisPaid').checked) {
      toast('Pastikan pembayaran QRIS sudah masuk sebelum menyelesaikan transaksi.', 'error');
      return;
    }
    const button = kind === 'store' ? $('#storeCheckout') : $('#posCheckout');
    const receiptWindow = kind === 'pos' ? window.open('', '_blank', 'width=420,height=700') : null;
    button.disabled = true;
    try {
      const result = await request('checkout', {
        method: 'POST',
        body: JSON.stringify({
          items,
          source: kind === 'store' ? 'online' : 'pos',
          metode_pembayaran: payment,
          id_pelanggan: kind === 'pos' ? $('#posCustomer').value : null,
          cash_diterima: kind === 'pos' && payment === 'cash'
            ? Number($('#posCashTendered').value)
            : null,
          payment_confirmed: kind === 'pos' && payment === 'qris' && $('#posQrisPaid').checked
        })
      });
      const remainingBalance = result.data.saldo_tersisa === null
        ? ''
        : ` Sisa saldo ${money(result.data.saldo_tersisa)}.`;
      const qrisOnline = kind === 'store' && payment === 'qris';
      const duitkuOnline = kind === 'store' && payment === 'duitku';
      toast(`${result.message} Total ${money(result.data.total_belanja)}.${remainingBalance}${qrisOnline ? ' Selesaikan pembayaran dan tunggu verifikasi admin.' : ''}`);
      if (kind === 'store') state.storeCart = {};
      else {
        state.posCart = {};
        $('#posCashTendered').value = '';
        $('#posQrisPaid').checked = false;
        updateCashChangePreview(0);
      }
      renderCart(kind);
      if (kind === 'store') {
        setStoreCartOpen(false);
        await Promise.all([loadStoreProducts(), loadCustomerPortal()]);
        if (qrisOnline) openOnlineQrisPayment(result.data.id_pesanan, result.data.total_belanja, result.data.payment_reference);
        if (duitkuOnline && result.data.payment_url) window.location.assign(result.data.payment_url);
      } else {
        const refreshes = [loadPosProducts(), loadOrders()];
        if (state.user?.role === 'admin') refreshes.push(loadDashboard());
        if ($('#page-reports').classList.contains('active')) refreshes.push(loadReports());
        await Promise.all(refreshes);
      }
      if (kind === 'pos' || (!qrisOnline && !duitkuOnline)) printReceipt(result.data, receiptWindow);
    } catch (error) {
      if (receiptWindow && !receiptWindow.closed) receiptWindow.close();
      toast(error.message, 'error');
      if (kind === 'store') loadStoreProducts(true);
      else loadPosProducts(true);
    } finally {
      if (kind === 'pos') updatePosPaymentFields();
      else button.disabled = Object.keys(state.storeCart).length === 0;
    }
  }

  function printReceipt(receipt, windowReceipt = null) {
    const receiptWindow = windowReceipt || window.open('', '_blank', 'width=420,height=700');
    if (!receiptWindow) {
      toast('Popup nota diblokir browser. Izinkan popup untuk mencetak atau menyimpan PDF.', 'error');
      return;
    }
    const itemRows = (receipt.items || []).map(item =>
      `<div class="receipt-item">
        <div class="receipt-item-name">${escapeHtml(item.nama_produk)}${item.ukuran ? ` <small>(${escapeHtml(item.ukuran)})</small>` : ''}</div>
        <div class="receipt-item-detail"><span>${Number(item.jumlah)} × ${money(item.harga_satuan)}</span><b>${money(item.subtotal)}</b></div>
      </div>`
    ).join('');
    const cashDetails = receipt.cash_diterima === null || receipt.cash_diterima === undefined ? '' : `
      <p><span>Uang diterima</span><b>${money(receipt.cash_diterima)}</b></p>
      <p><span>Kembalian</span><b>${money(receipt.kembalian)}</b></p>`;
    const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Nota #${Number(receipt.id_transaksi)} · Toko Tita</title>
      <style>
        @page{size:80mm auto;margin:4mm}
        *{box-sizing:border-box}body{width:72mm;margin:0 auto;color:#111;font:12px/1.4 Arial,sans-serif}
        h1{font-size:19px;letter-spacing:.3px;margin:0 0 3px;text-align:center}
        .store-info,.thanks{text-align:center}.store-info{font-size:10px}.thanks{margin-top:13px;font-weight:700}
        hr{border:0;border-top:1px dashed #777;margin:10px 0}
        p{display:flex;justify-content:space-between;gap:8px;margin:4px 0}.meta span,.muted{color:#444}
        .receipt-item{padding:5px 0;border-bottom:1px dotted #bbb}.receipt-item-name{font-weight:700;overflow-wrap:anywhere}
        .receipt-item-name small{font-weight:400}.receipt-item-detail{display:flex;justify-content:space-between;gap:8px;margin-top:3px}
        .totals .grand-total{font-size:15px;font-weight:700;padding-top:7px;border-top:1px dashed #777}
        @media print{body{width:auto;margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
      </style></head><body>
      <header class="store-info"><h1>Toko Tita</h1><div>Campursari, Sambit, Ponorogo</div></header>
      <hr><section class="meta">
        <p><span>No. Struk</span><b>#${Number(receipt.id_transaksi)}</b></p>
        <p><span>Tanggal &amp; Jam</span><b>${escapeHtml(dateTime(receipt.created_at))}</b></p>
        <p><span>Kasir</span><b>${escapeHtml(receipt.nama_kasir || 'Kasir')}</b></p>
        <p><span>Pelanggan</span><b>${escapeHtml(receipt.nama_pelanggan || 'Pelanggan umum')}</b></p>
      </section><hr><section>${itemRows || '<p>Tidak ada rincian barang.</p>'}</section><hr>
      <section class="totals">
        <p><span>Subtotal</span><b>${money(receipt.subtotal)}</b></p>
        <p><span>Diskon</span><b>− ${money(receipt.diskon)}</b></p>
        <p><span>Pajak (11%)</span><b>${money(receipt.pajak)}</b></p>
        <p class="grand-total"><span>Total belanja</span><b>${money(receipt.total_belanja)}</b></p>
        <p><span>Metode pembayaran</span><b>${escapeHtml(paymentLabel(receipt.metode_pembayaran))}</b></p>${cashDetails}
      </section><hr><footer class="thanks">Terima kasih sudah berbelanja di Toko Tita!</footer>
      <script>window.onload=()=>window.print()<\/script></body></html>`;
    receiptWindow.document.write(html);
    receiptWindow.document.close();
  }

  async function loadAdminProducts() {
    try {
      const includeArchived = $('#includeArchivedProducts').checked;
      const payload = await request(`products${includeArchived ? '&include_archived=1' : ''}`);
      state.productRows = payload.data;
      $('#productCount').textContent = payload.data.length;
      const query = $('#productSearch').value.trim().toLowerCase();
      const rows = payload.data.filter(item => `${item.nama_produk} ${item.kategori}`.toLowerCase().includes(query));
      $('#productRows').innerHTML = rows.length ? rows.map(item => {
        const variants = item.variants || [];
        const sizes = variants.map(variant => variant.ukuran).filter(Boolean);
        const numericSizes = sizes.every(size => /^\d+(?:\.\d+)?$/.test(size));
        sizes.sort(numericSizes ? (a, b) => Number(a) - Number(b) : (a, b) => a.localeCompare(b, 'id'));
        const sizeSummary = sizes.length
          ? numericSizes && sizes.length > 1 ? `${escapeHtml(sizes[0])}–${escapeHtml(sizes[sizes.length - 1])}` : sizes.map(escapeHtml).join(', ')
          : 'Reguler';
        const expanded = state.expandedProducts?.has(Number(item.id_produk));
        const detail = variants.map(variant => `<tr><td>${escapeHtml(variant.ukuran || 'Reguler')}</td><td>${escapeHtml(variant.barcode || '—')}</td><td><span class="${Number(variant.stok) < 5 ? 'stock-low' : ''}">${Number(variant.stok)}</span></td><td>${Number(variant.aktif) ? 'Aktif' : 'Diarsipkan'}</td></tr>`).join('');
        return `<tr class="product-master-row" data-product-row="${Number(item.id_produk)}">
          <td><div class="customer-name">${item.gambar_url ? `<img class="table-product-image" src="${escapeHtml(item.gambar_url)}" alt="">` : '<span class="customer-avatar">◈</span>'}<div><b>${escapeHtml(item.nama_produk)}</b><small class="table-subtext">${Number(item.aktif) ? 'Aktif' : 'Diarsipkan'}</small></div></div></td>
          <td>${escapeHtml(item.kategori)}<small class="table-subtext">Varian ${sizeSummary}</small></td>
          <td><b>${money(item.harga)}</b></td><td><b class="${Number(item.stok) < 5 ? 'stock-low' : ''}">${Number(item.stok)}</b><small class="table-subtext">${variants.length} varian</small></td>
          <td>${Number(item.diskon_persen)}%</td><td><label class="switch-label compact-switch"><input type="checkbox" data-discount-toggle="${Number(item.id_produk)}" ${Number(item.diskon_aktif) ? 'checked' : ''}><span>Diskon</span></label></td>
          <td class="right"><button class="action-button" data-product-variants="${Number(item.id_produk)}" aria-expanded="${expanded ? 'true' : 'false'}" title="Detail varian">⌄</button><button class="action-button" data-product-edit="${Number(item.id_produk)}" title="Ubah produk dan stok">✎</button>${Number(item.aktif) ? `<button class="action-button" data-product-delete="${Number(item.id_produk)}" title="Arsipkan produk">×</button>` : ''}</td></tr>
          ${expanded ? `<tr class="variant-detail-row"><td colspan="7"><div class="variant-detail-panel"><b>Stok dan barcode per varian</b><table><thead><tr><th>NAMA VARIAN</th><th>BARCODE</th><th>STOK</th><th>STATUS</th></tr></thead><tbody>${detail || '<tr><td colspan="4">Belum ada varian.</td></tr>'}</tbody></table><button class="button button-small button-secondary" type="button" data-product-edit="${Number(item.id_produk)}">Edit varian</button></div></td></tr>` : ''}`;
      }).join('')
        : '<tr><td colspan="7" class="empty-state">Belum ada produk. Tambahkan produk untuk mulai menerima pesanan.</td></tr>';
    } catch (error) {
      $('#productRows').innerHTML = `<tr><td colspan="7" class="empty-state">${escapeHtml(error.message)}</td></tr>`;
      toast(error.message, 'error');
    }
  }

  function openProductModal(product = null) {
    $('#productForm').reset();
    $('#productId').value = product?.id_produk || '';
    $('#productName').value = product?.nama_produk || '';
    $('#productCategory').value = product?.kategori || '';
    $('#productPrice').value = product?.harga || '';
    renderVariantRows(product?.variants || []);
    $('#productVariantSizes').value = '';
    $('#productVariantDefaultStock').value = '10';
    $('#productImage').value = product?.gambar_url || '';
    $('#productImageFile').value = '';
    if (state.productPreviewUrl) URL.revokeObjectURL(state.productPreviewUrl);
    state.productPreviewUrl = '';
    $('#productImagePreviewBox').hidden = !product?.gambar_url;
    $('#productImagePreview').src = product?.gambar_url || '';
    $('#productImagePreviewLabel').textContent = product?.gambar_url ? 'Gambar saat ini' : '';
    $('#productDiscount').value = product?.diskon_persen || 0;
    $('#productDiscountActive').checked = Number(product?.diskon_aktif) === 1;
    $('#productActive').checked = product ? Number(product.aktif) === 1 : true;
    $('#productModalTitle').textContent = product ? 'Ubah produk & varian' : 'Tambah produk';
    $('#productModal').classList.add('open');
    $('#productModal').setAttribute('aria-hidden', 'false');
  }

  function closeProductModal() {
    $('#productModal').classList.remove('open');
    $('#productModal').setAttribute('aria-hidden', 'true');
  }

  async function loadOrders() {
    try {
      const status = $('#ordersFilter').value;
      const payload = await request(`orders${status ? `&status=${encodeURIComponent(status)}` : ''}`);
      $('#ordersCount').textContent = payload.data.length;
      $('#ordersRows').innerHTML = payload.data.length ? payload.data.map(order => {
        let next = order.status === 'pending' ? 'paying'
          : order.status === 'paying' ? 'processing'
            : order.status === 'processing' ? 'completed' : '';
        if (order.metode_pembayaran === 'duitku' && order.status === 'pending') next = '';
        const actionLabel = next === 'paying' ? 'Konfirmasi' : next === 'processing' ? 'Proses' : 'Selesaikan';
        return `<tr><td><b>#ORD-${escapeHtml(order.id_pesanan)}</b><small class="table-subtext">${escapeHtml(order.ringkasan_item || `${Number(order.jumlah_item)} item`)}</small></td>
          <td>${escapeHtml(order.nama_pelanggan || 'Pelanggan umum')}</td><td>${escapeHtml(paymentLabel(order.metode_pembayaran))}</td>
          <td><span class="status-badge ${escapeHtml(order.status)}">${escapeHtml(statusLabel(order.status))}</span></td><td>${dateTime(order.created_at)}</td>
          <td class="right"><b>${money(order.total_belanja)}</b></td><td class="right">${next ? `<button class="button button-small button-secondary" data-order-action="${Number(order.id_pesanan)}" data-next-status="${next}" data-payment-method="${escapeHtml(order.metode_pembayaran)}">${actionLabel}</button>` : ''}${order.metode_pembayaran !== 'duitku' && ['pending','paying','processing'].includes(order.status) ? `<button class="action-button" data-order-action="${Number(order.id_pesanan)}" data-next-status="cancelled" title="Batalkan pesanan">×</button>` : ''}</td></tr>`;
      }).join('') : '<tr><td colspan="7" class="empty-state">Belum ada pesanan online.</td></tr>';
    } catch (error) {
      $('#ordersRows').innerHTML = `<tr><td colspan="7" class="empty-state">${escapeHtml(error.message)}</td></tr>`;
      toast(error.message, 'error');
    }
  }

  function renderOnlinePayments() {
    const method = $('#onlinePaymentMethodFilter').value;
    const status = $('#onlinePaymentStatusFilter').value;
    const rows = state.onlinePaymentRows;
    const pendingQris = rows.filter(order => order.metode_pembayaran === 'qris' && order.status === 'pending');
    $('#onlinePaymentTotalCount').textContent = rows.length;
    $('#onlineQrisPendingCount').textContent = pendingQris.length;
    $('#onlineQrisPendingAmount').textContent = money(pendingQris.reduce((total, order) => total + Number(order.total_belanja || 0), 0));
    $('#onlineQrisVerifiedCount').textContent = rows.filter(order => order.metode_pembayaran === 'qris' && order.status === 'paying').length;
    const visible = rows.filter(order => (!method || order.metode_pembayaran === method)
      && (!status || order.status === status));
    $('#onlinePaymentCount').textContent = visible.length;
    $('#onlinePaymentRows').innerHTML = visible.length ? visible.map(order => {
      let next = order.status === 'pending' ? 'paying'
        : order.status === 'paying' ? 'processing'
          : order.status === 'processing' ? 'completed' : '';
      if (order.metode_pembayaran === 'duitku' && order.status === 'pending') next = '';
      const statusText = order.metode_pembayaran === 'qris' && order.status === 'pending'
        ? 'Belum diverifikasi'
        : order.metode_pembayaran === 'qris' && order.status === 'paying'
          ? 'Dana terverifikasi'
          : statusLabel(order.status);
      const actionLabel = next === 'paying'
        ? (order.metode_pembayaran === 'qris' ? 'Konfirmasi dana' : 'Konfirmasi')
        : next === 'processing' ? 'Proses' : 'Selesaikan';
      return `<tr><td><b>#ORD-${escapeHtml(order.id_pesanan)}</b><small class="table-subtext">${escapeHtml(order.ringkasan_item || `${Number(order.jumlah_item)} item`)}</small></td>
        <td>${escapeHtml(order.nama_pelanggan || 'Pelanggan')}</td>
        <td><b>${escapeHtml(paymentLabel(order.metode_pembayaran))}</b>${order.metode_pembayaran === 'qris' ? '<small class="table-subtext">QRIS statis</small>' : ''}</td>
        <td><span class="status-badge ${escapeHtml(order.status)}">${escapeHtml(statusText)}</span></td>
        <td>${dateTime(order.created_at)}</td><td class="right"><b>${money(order.total_belanja)}</b></td>
        <td class="right">${next ? `<button class="button button-small button-secondary" data-order-action="${Number(order.id_pesanan)}" data-next-status="${next}" data-payment-method="${escapeHtml(order.metode_pembayaran)}">${actionLabel}</button>` : ''}${order.metode_pembayaran !== 'duitku' && ['pending', 'paying', 'processing'].includes(order.status) ? `<button class="action-button" data-order-action="${Number(order.id_pesanan)}" data-next-status="cancelled" title="Batalkan pesanan">×</button>` : ''}</td></tr>`;
    }).join('') : '<tr><td colspan="7" class="empty-state">Tidak ada pembayaran online sesuai filter.</td></tr>';
  }

  async function loadOnlinePayments(silent = false) {
    try {
      const payload = await request('orders');
      state.onlinePaymentRows = payload.data;
      renderOnlinePayments();
    } catch (error) {
      $('#onlinePaymentRows').innerHTML = `<tr><td colspan="7" class="empty-state">${escapeHtml(error.message)}</td></tr>`;
      if (!silent) toast(error.message, 'error');
    }
  }

  async function handleOrderAction(event) {
    const button = event.target.closest('[data-order-action]');
    if (!button) return;
    const paymentConfirmed = button.dataset.nextStatus === 'paying'
      && button.dataset.paymentMethod === 'qris';
    if (paymentConfirmed && !window.confirm('Pastikan dana QRIS benar-benar sudah masuk ke rekening/merchant dan nominalnya cocok sebelum mengonfirmasi. Lanjutkan?')) {
      return;
    }
    button.disabled = true;
    try {
      const result = await request(`order-status&id=${Number(button.dataset.orderAction)}`, {
        method: 'PUT',
        body: JSON.stringify({
          status: button.dataset.nextStatus,
          payment_confirmed: paymentConfirmed
        })
      });
      toast(result.message);
      await Promise.all([loadOrders(), loadOnlinePayments(), loadPosProducts(true)]);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function logout() {
    try {
      await request('auth/logout', { method: 'POST' });
      const session = await request('auth/session');
      state.csrfToken = session.csrf_token;
      state.authRole = 'admin';
      state.authMode = 'login';
      window.clearInterval(state.productTimer);
      window.clearInterval(state.logTimer);
      window.clearInterval(state.orderTimer);
      window.clearInterval(state.walletTimer);
      window.clearInterval(state.walletAdminTimer);
      state.storeCart = {};
      state.posCart = {};
      setStoreCartOpen(false);
      showAuth();
      updateAuthForm();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function setToday() {
    const now = new Date();
    const pretty = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }).format(now);
    const weekday = new Intl.DateTimeFormat('id-ID', { weekday: 'long' }).format(now).toUpperCase();
    $('#todayLabel').textContent = pretty;
    $('#headingDate').textContent = `${weekday}, ${pretty.toUpperCase()}`;
  }

  function showPage(page) {
    $$('.page-section').forEach(section => section.classList.toggle('active', section.id === `page-${page}`));
    $$('.nav-item[data-page]').forEach(item => item.classList.toggle('active', item.dataset.page === page));
    const active = $(`.nav-item[data-page="${page}"]`);
    $('#pageBreadcrumb').textContent = active ? active.innerText.trim() : 'Overview';
    $('#sidebar').classList.remove('open');
    if (page === 'dashboard') loadDashboard();
    if (page === 'customers') loadCustomers();
    if (page === 'pos') {
      if (state.user?.role === 'admin') loadCustomerOptions();
      loadPosProducts();
      window.setTimeout(() => $('#posBarcodeInput').focus(), 0);
    }
    if (page === 'products') loadAdminProducts();
    if (page === 'orders') loadOrders();
    if (page === 'payments') loadOnlinePayments();
    if (page === 'wallets') {
      loadWalletAdmin();
      window.clearInterval(state.walletAdminTimer);
      state.walletAdminTimer = window.setInterval(() => {
        if ($('#page-wallets').classList.contains('active')) loadWalletAdmin(true);
      }, 20000);
    } else {
      window.clearInterval(state.walletAdminTimer);
    }
    if (page === 'reports') loadReports();
    if (page === 'audit') {
      loadLogs();
      window.clearInterval(state.logTimer);
      state.logTimer = window.setInterval(() => {
        if ($('#page-audit').classList.contains('active')) loadLogs(true);
      }, 30000);
    } else {
      window.clearInterval(state.logTimer);
    }
    if (page === 'orders' || page === 'payments') {
      window.clearInterval(state.orderTimer);
      state.orderTimer = window.setInterval(() => {
        if ($('#page-orders').classList.contains('active')) loadOrders();
        else if ($('#page-payments').classList.contains('active')) loadOnlinePayments(true);
      }, 20000);
    } else {
      window.clearInterval(state.orderTimer);
    }
  }

  async function loadDashboard() {
    try {
      const [dashboard, recent] = await Promise.all([
        request('dashboard'),
        request('transactions&limit=5')
      ]);
      const metrics = dashboard.metrics;
      $('#metricTransactions').textContent = new Intl.NumberFormat('id-ID').format(metrics.total_transaksi);
      $('#metricCustomers').textContent = new Intl.NumberFormat('id-ID').format(metrics.total_pelanggan);
      $('#metricSales').textContent = money(metrics.total_belanja);
      $('#insightTransactions').textContent = new Intl.NumberFormat('id-ID').format(metrics.total_transaksi);
      $('#insightCustomers').textContent = new Intl.NumberFormat('id-ID').format(metrics.total_pelanggan);
      renderChart(dashboard.sales || []);
      $('#recentTransactions').innerHTML = recent.data.length ? recent.data.map(row => `
        <tr><td><b>#TRX-${escapeHtml(row.id_transaksi)}</b></td>
        <td>${escapeHtml(row.nama_pelanggan || 'Pelanggan umum')}</td>
        <td>${dateTime(row.tanggal)}</td>
        <td class="right"><b>${money(row.total_belanja)}</b></td></tr>`).join('')
        : '<tr><td colspan="4" class="empty-state">Belum ada transaksi.</td></tr>';
    } catch (error) {
      $('#recentTransactions').innerHTML = `<tr><td colspan="5" class="empty-state">${escapeHtml(error.message)}</td></tr>`;
      toast(error.message, 'error');
    }
  }

  async function loadWalletAdmin(silent = false) {
    try {
      const payload = await request('wallet-admin');
      const summary = payload.data.summary;
      $('#walletTotalBalance').textContent = money(summary.total_saldo);
      $('#walletSalesTotal').textContent = money(summary.penjualan_wallet);
      $('#walletPendingCount').textContent = new Intl.NumberFormat('id-ID').format(summary.pending_topup);
      $('#walletTopupCount').textContent = payload.data.topups.length;
      $('#walletTopupRows').innerHTML = payload.data.topups.length
        ? payload.data.topups.map(topup => `
          <tr>
            <td><b>#TOP-${Number(topup.id_topup)}</b></td>
            <td><b>${escapeHtml(topup.nama_pelanggan)}</b><small class="table-subtext">${escapeHtml(topup.email)}</small></td>
            <td><b>${money(topup.nominal)}</b></td>
            <td>${escapeHtml(paymentLabel(topup.metode_pembayaran))}</td>
            <td><span class="status-badge ${escapeHtml(topup.status)}">${escapeHtml(topupStatusLabel(topup.status))}</span></td>
            <td>${topup.referensi_pembayaran ? escapeHtml(topup.referensi_pembayaran) : '—'}</td>
            <td>${dateTime(topup.created_at)}</td>
            <td class="right">${topup.status === 'pending'
              ? `<button class="button button-small button-secondary wallet-review-approve" data-wallet-topup="${Number(topup.id_topup)}" data-wallet-decision="approved">Setujui</button>
                 <button class="button button-small button-quiet wallet-review-reject" data-wallet-topup="${Number(topup.id_topup)}" data-wallet-decision="rejected">Tolak</button>`
              : '—'}</td>
          </tr>`).join('')
        : '<tr><td colspan="8" class="empty-state">Belum ada permintaan top up.</td></tr>';
    } catch (error) {
      $('#walletTopupRows').innerHTML = `<tr><td colspan="8" class="empty-state">${escapeHtml(error.message)}</td></tr>`;
      if (silent) console.error('Gagal memperbarui monitoring dompet:', error);
      else toast(error.message, 'error');
    }
  }

  function renderChart(rows) {
    const canvas = $('#salesChart');
    const hasSales = rows.some(row => Number(row.total) > 0);
    if (!hasSales) {
      if (state.chart) state.chart.destroy();
      state.chart = null;
      canvas.hidden = true;
      $('#salesChartEmpty').hidden = false;
      return;
    }
    canvas.hidden = false;
    $('#salesChartEmpty').hidden = true;
    if (!window.Chart) return;
    const labels = [];
    const values = [];
    const byDate = new Map(rows.map(row => [String(row.tanggal).slice(0, 10), Number(row.total)]));
    for (let offset = 6; offset >= 0; offset--) {
      const day = new Date();
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() - offset);
      const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      labels.push(new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric' }).format(day));
      values.push(byDate.get(key) || 0);
    }
    if (state.chart) state.chart.destroy();
    const context = canvas.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, 0, 230);
    gradient.addColorStop(0, 'rgba(39,131,95,.18)');
    gradient.addColorStop(1, 'rgba(39,131,95,0)');
    state.chart = new Chart(context, {
      type: 'line',
      data: { labels, datasets: [{
        data: values, borderColor: '#27835f', borderWidth: 2, backgroundColor: gradient, fill: true,
        tension: .38, pointRadius: 3, pointHoverRadius: 5, pointBackgroundColor: '#fff',
        pointBorderColor: '#27835f', pointBorderWidth: 2
      }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: {
          backgroundColor: '#fff', titleColor: '#52635a', bodyColor: '#203229',
          borderColor: '#dce9df', borderWidth: 1,
          callbacks: { label: item => ` ${money(item.raw)}` }
        } },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: '#68776e', font: { size: 9 } } },
          y: { beginAtZero: true, grid: { color: 'rgba(39,71,51,.1)' }, border: { display: false },
            ticks: { color: '#68776e', font: { size: 8 }, maxTicksLimit: 5, callback: value => value >= 1000000 ? `${value / 1000000} jt` : value >= 1000 ? `${value / 1000} rb` : value } }
        }
      }
    });
  }

  async function loadCustomers() {
    const body = $('#customerRows');
    setBusy($('.table-panel', $('#page-customers')), true);
    try {
      const query = new URLSearchParams({
        route: 'customers',
        q: $('#customerSearch').value.trim(),
        page: String(state.customerPage),
        limit: '10'
      });
      const response = await fetch(`${API}?${query}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Gagal memuat pelanggan.');
      $('#customerCount').textContent = payload.pagination.total;
      body.innerHTML = payload.data.length ? payload.data.map(customer => {
        const initials = customer.nama.split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase();
        const categoryName = String(customer.kategori || 'Pelanggan Reguler');
        const category = categoryName.toLowerCase().includes('gold') ? 'gold'
          : categoryName.toLowerCase().includes('silver') ? 'silver' : 'reguler';
        return `<tr><td><div class="customer-name"><span class="customer-avatar">${escapeHtml(initials)}</span><b>${escapeHtml(customer.nama)}</b></div></td>
          <td>${escapeHtml(customer.kota || '—')}</td><td>${Number(customer.jumlah_transaksi)}</td>
          <td><b>${money(customer.total_belanja)}</b></td><td><span class="category-badge ${escapeHtml(category)}">${escapeHtml(customer.kategori)}</span></td>
          <td class="right"><button class="action-button" data-edit="${Number(customer.id_pelanggan)}" title="Ubah pelanggan">✎</button>
          <button class="action-button" data-delete="${Number(customer.id_pelanggan)}" title="Hapus pelanggan">×</button></td></tr>`;
      }).join('') : '<tr><td colspan="6" class="empty-state">Pelanggan tidak ditemukan.</td></tr>';
      renderPagination($('#customerPagination'), payload.pagination, page => {
        state.customerPage = page;
        loadCustomers();
      });
    } catch (error) {
      body.innerHTML = `<tr><td colspan="6" class="empty-state">${escapeHtml(error.message)}</td></tr>`;
      toast(error.message, 'error');
    } finally {
      setBusy($('.table-panel', $('#page-customers')), false);
    }
  }

  function renderPagination(container, pagination, onSelect) {
    if (!pagination || pagination.pages <= 1) {
      container.innerHTML = `<span>${pagination ? `${pagination.total} data` : ''}</span>`;
      return;
    }
    const { page, pages, total } = pagination;
    container.innerHTML = `<span style="margin-right:auto">${total} data · Halaman ${page}/${pages}</span>
      <button class="page-button" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹</button>
      ${Array.from({ length: Math.min(5, pages) }, (_, index) => {
        const number = Math.max(1, Math.min(pages - 4, page - 2)) + index;
        return number <= pages ? `<button class="page-button ${number === page ? 'active' : ''}" data-page="${number}">${number}</button>` : '';
      }).join('')}
      <button class="page-button" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>›</button>`;
    container.onclick = event => {
      const button = event.target.closest('[data-page]');
      if (button && !button.disabled) onSelect(Number(button.dataset.page));
    };
  }

  async function loadCustomerOptions() {
    const select = $('#posCustomer');
    const selected = select.value;
    try {
      const payload = await request('customers&limit=50');
      select.innerHTML = '<option value="">Pelanggan umum</option>' +
        payload.data.map(customer => `<option value="${Number(customer.id_pelanggan)}">${escapeHtml(customer.nama)} — ${escapeHtml(customer.kota || '—')}</option>`).join('');
      if (selected) select.value = selected;
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function fetchReportPage(page, limit) {
    const params = new URLSearchParams({
      route: 'sales-report', page: String(page), limit: String(limit)
    });
    if (state.reportFrom) params.set('from', state.reportFrom);
    if (state.reportTo) params.set('to', state.reportTo);
    const response = await fetch(`${API}?${params}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Gagal memuat laporan.');
    return payload;
  }

  async function fetchAllReportData() {
    const rows = [];
    let firstPage;
    for (let page = 1; ; page++) {
      const payload = await fetchReportPage(page, 100);
      if (!firstPage) firstPage = payload;
      rows.push(...payload.data);
      if (page >= payload.pagination.pages) {
        return { rows, summary: payload.summary, pagination: firstPage.pagination };
      }
    }
  }

  function reportSourceLabel(source) {
    return ({ pos: 'POS', online: 'Online', legacy: 'Data lama' })[source] || '—';
  }

  function reportPaymentLabel(method) {
    return ({
      cash: 'Tunai', cod: 'COD', bank: 'Transfer bank', debit: 'Debit', ovo: 'OVO',
      dana: 'DANA', gopay: 'GoPay', qris: 'QRIS'
    })[method] || '—';
  }

  function reportStatusLabel(status) {
    return ({
      pending: 'Menunggu', paying: 'Pembayaran', processing: 'Diproses',
      completed: 'Selesai', cancelled: 'Dibatalkan'
    })[status] || '—';
  }

  async function loadReports() {
    const body = $('#reportRows');
    setBusy($('#page-reports .table-panel'), true);
    try {
      const payload = await fetchReportPage(state.reportPage, 10);
      $('#reportCount').textContent = payload.pagination.total;
      $('#reportSalesTotal').textContent = money(payload.summary.total_belanja);
      $('#reportAverage').textContent = money(payload.summary.rata_rata);
      body.innerHTML = payload.data.length ? payload.data.map(row => `
        <tr><td><b>#TRX-${escapeHtml(row.id_transaksi)}</b></td><td>${dateTime(row.tanggal)}</td>
        <td>${escapeHtml(reportSourceLabel(row.sumber))}</td><td>${escapeHtml(row.nama_kasir || '—')}</td>
        <td>${escapeHtml(row.nama_pelanggan || 'Pelanggan umum')}</td>
        <td>${escapeHtml(reportPaymentLabel(row.metode_pembayaran))}</td>
        <td><span class="status-badge ${escapeHtml(row.status)}">${escapeHtml(reportStatusLabel(row.status))}</span></td>
        <td class="right"><b>${money(row.total_belanja)}</b></td></tr>`).join('')
        : '<tr><td colspan="8" class="empty-state">Tidak ada transaksi pada rentang tanggal ini.</td></tr>';
      renderPagination($('#reportPagination'), payload.pagination, page => {
        state.reportPage = page;
        loadReports();
      });
    } catch (error) {
      body.innerHTML = `<tr><td colspan="8" class="empty-state">${escapeHtml(error.message)}</td></tr>`;
      toast(error.message, 'error');
    } finally {
      setBusy($('#page-reports .table-panel'), false);
    }
  }

  async function loadLogs(silent = false) {
    try {
      const payload = await request('logs&limit=100');
      $('#auditCount').textContent = payload.data.length;
      $('#auditRows').innerHTML = payload.data.length ? payload.data.map(log => {
        const source = log.sumber === 'pelanggan' ? 'log_pelanggan' : 'log_perubahan_pelanggan';
        const detail = log.sumber === 'perubahan'
          ? `${escapeHtml(log.nama_lama || '—')} → ${escapeHtml(log.nama_baru || '—')}`
          : 'Perubahan data pelanggan';
        return `<tr><td>${dateTime(log.waktu_log)}</td>
          <td><span class="status-badge ${String(log.aksi).toLowerCase()}">${escapeHtml(log.aksi)}</span></td>
          <td>#${escapeHtml(log.id_pelanggan ?? '—')}</td><td>${detail}</td><td><code>${source}</code></td></tr>`;
      }).join('') : '<tr><td colspan="5" class="empty-state">Belum ada aktivitas pelanggan.</td></tr>';
      if (!silent) toast('Audit log berhasil diperbarui.');
    } catch (error) {
      $('#auditRows').innerHTML = `<tr><td colspan="5" class="empty-state">${escapeHtml(error.message)}</td></tr>`;
      if (!silent) toast(error.message, 'error');
    }
  }

  function openCustomerModal(customer = null) {
    $('#customerForm').reset();
    $('#customerId').value = customer?.id_pelanggan || '';
    $('#customerName').value = customer?.nama || customer?.nama_pelanggan || '';
    $('#customerCity').value = customer?.kota || '';
    $('#modalTitle').textContent = customer ? 'Ubah pelanggan' : 'Tambah pelanggan';
    $('#customerModal').classList.add('open');
    $('#customerModal').setAttribute('aria-hidden', 'false');
    window.setTimeout(() => $('#customerName').focus(), 50);
  }

  function closeCustomerModal() {
    $('#customerModal').classList.remove('open');
    $('#customerModal').setAttribute('aria-hidden', 'true');
  }

  function updateAccountFormRole() {
    const isCustomer = $('#accountRole').value === 'customer';
    $('#accountCustomerFields').hidden = !isCustomer;
    $('#accountName').required = isCustomer;
    $('#accountPassword').minLength = isCustomer ? 10 : 12;
    $('#accountPasswordHint').textContent = isCustomer
      ? 'Minimal 10 karakter untuk akun pelanggan.'
      : 'Minimal 12 karakter untuk akun kasir.';
  }

  function openAccountModal() {
    $('#accountForm').reset();
    updateAccountFormRole();
    $('#accountModal').classList.add('open');
    $('#accountModal').setAttribute('aria-hidden', 'false');
    window.setTimeout(() => $('#accountRole').focus(), 50);
  }

  function closeAccountModal() {
    $('#accountModal').classList.remove('open');
    $('#accountModal').setAttribute('aria-hidden', 'true');
  }

  async function exportCsv() {
    const button = $('#exportCsv');
    button.disabled = true;
    try {
      const { rows } = await fetchAllReportData();
      const columns = [
        ['ID Transaksi', 'id_transaksi'], ['Tanggal', 'tanggal'], ['Sumber', 'sumber'],
        ['Kasir', 'nama_kasir'], ['Pelanggan', 'nama_pelanggan'], ['Kota', 'kota'],
        ['Pembayaran', 'metode_pembayaran'], ['Status', 'status'], ['Total Belanja', 'total_belanja']
      ];
      const csvValue = (row, key) => {
        const values = {
          sumber: reportSourceLabel(row.sumber),
          metode_pembayaran: reportPaymentLabel(row.metode_pembayaran),
          status: reportStatusLabel(row.status)
        };
        const value = String(values[key] ?? row[key] ?? '');
        return /^[=+\-@]/.test(value) ? `'${value}` : value;
      };
      const csv = [columns.map(([label]) => label), ...rows.map(row => columns.map(([, key]) => csvValue(row, key)))]
        .map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n');
      const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `laporan-tokoku-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast(`${rows.length} transaksi berhasil diekspor.`);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function printReportPdf() {
    const button = $('#printReport');
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast('Izinkan pop-up untuk membuat PDF laporan.', 'error');
      return;
    }

    button.disabled = true;
    printWindow.document.write('<!doctype html><title>Menyiapkan laporan</title><p>Menyiapkan laporan transaksi…</p>');
    try {
      const { rows, summary, pagination } = await fetchAllReportData();
      const tableRows = rows.map(row => `<tr>
        <td>#TRX-${escapeHtml(row.id_transaksi)}</td>
        <td>${dateTime(row.tanggal)}</td>
        <td>${escapeHtml(reportSourceLabel(row.sumber))}</td>
        <td>${escapeHtml(row.nama_kasir || '—')}</td>
        <td>${escapeHtml(row.nama_pelanggan || 'Pelanggan umum')}</td>
        <td>${escapeHtml(reportPaymentLabel(row.metode_pembayaran))}</td>
        <td>${escapeHtml(reportStatusLabel(row.status))}</td>
        <td class="amount">${money(row.total_belanja)}</td>
      </tr>`).join('');
      const generatedAt = new Intl.DateTimeFormat('id-ID', {
        dateStyle: 'long', timeStyle: 'short'
      }).format(new Date());
      const audience = state.user?.role === 'cashier' ? 'Laporan transaksi kasir' : 'Laporan seluruh transaksi';
      const dateRange = state.reportFrom && state.reportTo
        ? `${state.reportFrom} s.d. ${state.reportTo}`
        : state.reportFrom
          ? `${state.reportFrom} s.d. Hari ini`
          : state.reportTo
            ? `Sampai ${state.reportTo}`
            : 'Semua tanggal';
      const html = `<!doctype html>
        <html lang="id"><head><meta charset="utf-8"><title>${audience} - Tokoku</title>
        <style>
          @page{size:A4 landscape;margin:14mm}
          *{box-sizing:border-box}
          body{font:11px Arial,sans-serif;color:#182230;margin:0}
          h1{font-size:20px;margin:0 0 5px}
          .subtitle,.meta{color:#596579}
          .meta{display:flex;justify-content:space-between;margin:16px 0}
          .summary{display:flex;gap:32px;padding:12px 0;border-top:1px solid #ccd3de;border-bottom:1px solid #ccd3de;margin-bottom:16px}
          .summary span{display:block;color:#596579;font-size:10px;margin-bottom:4px}
          .summary strong{font-size:14px}
          table{width:100%;border-collapse:collapse;font-size:9px}
          thead{display:table-header-group}
          tr{break-inside:avoid}
          th,td{border-bottom:1px solid #dfe4eb;padding:7px 6px;text-align:left;vertical-align:top}
          th{background:#f2f4f7;font-size:8px;letter-spacing:.04em}
          .amount{text-align:right;white-space:nowrap}
          .empty{text-align:center;color:#596579;padding:24px}
          footer{margin-top:16px;color:#596579;font-size:9px}
        </style></head><body>
        <h1>${audience}</h1>
        <div class="subtitle">Tokoku · Dicetak ${escapeHtml(generatedAt)}</div>
        <div class="meta"><span>Periode: ${escapeHtml(dateRange)}</span><span>Pengguna: ${escapeHtml(state.user?.email || '—')}</span></div>
        <div class="summary">
          <div><span>Jumlah transaksi</span><strong>${pagination.total}</strong></div>
          <div><span>Total nilai transaksi</span><strong>${money(summary.total_belanja)}</strong></div>
          <div><span>Rata-rata transaksi</span><strong>${money(summary.rata_rata)}</strong></div>
        </div>
        <table><thead><tr><th>ID TRANSAKSI</th><th>TANGGAL / WAKTU</th><th>SUMBER</th><th>KASIR</th><th>PELANGGAN</th><th>PEMBAYARAN</th><th>STATUS</th><th class="amount">TOTAL BELANJA</th></tr></thead>
        <tbody>${tableRows || '<tr><td class="empty" colspan="8">Tidak ada transaksi pada rentang tanggal ini.</td></tr>'}</tbody></table>
        <footer>Laporan ini memuat seluruh transaksi pada rentang tanggal terpilih. Gunakan opsi “Simpan sebagai PDF” pada dialog cetak.</footer>
        <script>window.addEventListener('load',function(){window.print();},{once:true});<\/script>
        </body></html>`;
      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
    } catch (error) {
      printWindow.close();
      toast(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  $$('[data-auth-role]').forEach(button => button.addEventListener('click', () => {
    state.authRole = button.dataset.authRole;
    state.authMode = 'login';
    $$('[data-auth-role]').forEach(item => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
    });
    updateAuthForm();
  }));
  $('#showRegister').addEventListener('click', () => {
    state.authMode = 'register';
    updateAuthForm();
  });
  $('#showLogin').addEventListener('click', () => {
    state.authMode = 'login';
    updateAuthForm();
  });
  $('#authForm').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = $('#authSubmit');
    submit.disabled = true;
    $('#authError').hidden = true;
    $('#authError').textContent = '';
    try {
      const registering = state.authMode === 'register';
      const result = await request(registering ? 'auth/register' : 'auth/login', {
        method: 'POST',
        body: JSON.stringify(registering ? {
          nama: $('#authName').value.trim(),
          kota: $('#authCity').value.trim(),
          email: $('#authEmail').value.trim(),
          password: $('#authPassword').value
        } : {
          email: $('#authEmail').value.trim(),
          password: $('#authPassword').value,
          role: state.authRole
        })
      });
      state.csrfToken = result.csrf_token;
      toast(result.message);
      await enterApp(result.user);
    } catch (error) {
      $('#authError').textContent = error.message;
      $('#authError').hidden = false;
    } finally {
      submit.disabled = false;
    }
  });
  $('#adminLogout').addEventListener('click', logout);
  $('#portalLogout').addEventListener('click', logout);
  $('#refreshPortalHistory').addEventListener('click', loadCustomerPortal);
  $('#portalTransactionRows').addEventListener('click', event => {
    const paymentButton = event.target.closest('[data-payment-url]');
    if (paymentButton) {
      window.location.assign(paymentButton.dataset.paymentUrl);
      return;
    }
    const button = event.target.closest('[data-show-qris]');
    if (button) openOnlineQrisPayment(button.dataset.showQris, button.dataset.qrisTotal, button.dataset.qrisReference);
  });
  $('#storeCheckout').addEventListener('click', () => checkoutCart('store'));
  const updateStoreQrisPanel = () => {
    $('#storeQrisPanel').hidden = $('#storePayment').value !== 'qris';
    $('#storeDuitkuPanel').hidden = $('#storePayment').value !== 'duitku';
  };
  $('#storePayment').addEventListener('change', updateStoreQrisPanel);
  updateStoreQrisPanel();
  $$('.online-qris-close').forEach(button => button.addEventListener('click', closeOnlineQrisPayment));
  $('#onlineQrisModal').addEventListener('click', event => {
    if (event.target === $('#onlineQrisModal')) closeOnlineQrisPayment();
  });
  $('#openWalletTopup').addEventListener('click', () => setWalletTopupOpen(true));
  $$('.wallet-topup-close').forEach(button => button.addEventListener('click', () => setWalletTopupOpen(false)));
  $('#walletTopupModal').addEventListener('click', event => {
    if (event.target === $('#walletTopupModal')) setWalletTopupOpen(false);
  });
  $$('.quick-topup-amounts [data-topup-amount]').forEach(button => {
    button.addEventListener('click', () => {
      $('#walletTopupAmount').value = button.dataset.topupAmount;
    });
  });
  $('#walletTopupForm').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = $('button[type="submit"]', event.currentTarget);
    submit.disabled = true;
    try {
      const result = await request('wallet-topups', {
        method: 'POST',
        body: JSON.stringify({
          nominal: Number($('#walletTopupAmount').value)
        })
      });
      toast(result.message);
      setWalletTopupOpen(false);
      await refreshCustomerWallet();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      submit.disabled = false;
    }
  });
  $('#storeCartToggle').addEventListener('click', () => setStoreCartOpen(!state.storeCartOpen));
  $('#storeFloatingCart').addEventListener('click', () => setStoreCartOpen(!state.storeCartOpen));
  $('#storeCartClose').addEventListener('click', () => setStoreCartOpen(false));
  $('#storeCartOverlay').addEventListener('click', () => setStoreCartOpen(false));
  $('#storeProfileToggle').addEventListener('click', () => $('#storeHistory').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.storeCartOpen) setStoreCartOpen(false);
    if (event.key === 'Escape' && $('#walletTopupModal').classList.contains('open')) setWalletTopupOpen(false);
    if (event.key === 'Escape' && $('#onlineQrisModal').classList.contains('open')) closeOnlineQrisPayment();
  });
  $('#refreshWalletAdmin').addEventListener('click', loadWalletAdmin);
  $('#walletTopupRows').addEventListener('click', async event => {
    const button = event.target.closest('[data-wallet-topup][data-wallet-decision]');
    if (!button) return;
    let paymentReference = '';
    if (button.dataset.walletDecision === 'approved') {
      paymentReference = window.prompt(
        'Masukkan ID mutasi atau referensi transaksi yang terlihat pada rekening tujuan (bukan nomor/bukti dari pelanggan).'
      );
      if (paymentReference === null || paymentReference.trim().length < 3) return;
      if (!window.confirm('Pastikan dana dan nominal top up benar-benar sudah masuk pada mutasi rekening tujuan. Lanjutkan persetujuan?')) return;
    }
    button.disabled = true;
    try {
      const result = await request(`wallet-topups&id=${button.dataset.walletTopup}`, {
        method: 'PUT',
        body: JSON.stringify({
          status: button.dataset.walletDecision,
          referensi_pembayaran: paymentReference.trim()
        })
      });
      toast(result.message);
      await loadWalletAdmin();
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
    }
  });
  $('#posCheckout').addEventListener('click', () => checkoutCart('pos'));
  $('#storeProducts').addEventListener('click', event => {
    const button = event.target.closest('[data-add-product]');
    if (button) {
      const card = button.closest('.product-card');
      const variantId = Number($('.product-size-select', card)?.value);
      if (variantId) addProductToCart(variantId, 'store');
    }
  });
  $('#posProducts').addEventListener('click', event => {
    const button = event.target.closest('[data-add-product]');
    if (button) {
      const card = button.closest('.product-card');
      const variantId = Number($('.product-size-select', card)?.value);
      if (variantId) addProductToCart(variantId, 'pos');
    }
  });
  [['storeProducts', 'store'], ['posProducts', 'pos']].forEach(([containerId, kind]) => {
    $(`#${containerId}`).addEventListener('change', event => {
      const select = event.target.closest('[data-product-variant]');
      if (!select) return;
      state.selectedVariants[kind][Number(select.dataset.productVariant)] = Number(select.value);
    });
  });
  ['storeCartItems', 'posCartItems'].forEach(id => $(`#${id}`).addEventListener('click', event => {
    const button = event.target.closest('[data-cart-change]');
    if (button) addProductToCart(Number(button.dataset.cartChange), button.dataset.kind, Number(button.dataset.delta));
  }));
  let storefrontSearchTimer;
  $('#storeSearch').addEventListener('input', () => {
    window.clearTimeout(storefrontSearchTimer);
    storefrontSearchTimer = window.setTimeout(() => loadStoreProducts(), 250);
  });
  $('#storeCategory').addEventListener('change', loadStoreProducts);
  let posSearchTimer;
  $('#posSearch').addEventListener('input', () => {
    window.clearTimeout(posSearchTimer);
    posSearchTimer = window.setTimeout(() => loadPosProducts(), 250);
  });
  const posBarcodeInput = $('#posBarcodeInput');
  let posBarcodeScanTimer;
  const processPosBarcode = async () => {
    const scannerInput = posBarcodeInput;
    const barcode = scannerInput.value.trim().toLowerCase();
    scannerInput.value = '';
    if (!barcode) return;
    if (!state.posProducts?.length) await loadPosProducts(true);
    const match = (state.posProducts || []).flatMap(product =>
      (product.variants || []).map(variant => ({ product, variant }))
    ).find(({ variant }) => String(variant.barcode || '').trim().toLowerCase() === barcode);
    if (!match) {
      toast(`Barcode "${barcode}" tidak ditemukan di katalog aktif.`, 'error');
    } else {
      addProductToCart(Number(match.variant.id_produk), 'pos', 1);
    }
    scannerInput.focus();
  };
  posBarcodeInput.addEventListener('input', () => {
    window.clearTimeout(posBarcodeScanTimer);
    posBarcodeScanTimer = window.setTimeout(processPosBarcode, 150);
  });
  posBarcodeInput.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    window.clearTimeout(posBarcodeScanTimer);
    processPosBarcode();
  });
  const updatePosPaymentFields = () => {
    const isCash = $('#posPayment').value === 'cash';
    const isQris = $('#posPayment').value === 'qris';
    $('#posCashField').hidden = !isCash;
    $('#posCashTendered').required = isCash;
    $('#posQrisPanel').hidden = !isQris;
    $('#posCheckout').disabled = isQris && !$('#posQrisPaid').checked;
    updateCashChangePreview();
  };
  $('#posPayment').addEventListener('change', updatePosPaymentFields);
  $('#posQrisPaid').addEventListener('change', updatePosPaymentFields);
  $('#posCashTendered').addEventListener('input', () => updateCashChangePreview());
  updatePosPaymentFields();
  $('#productSearch').addEventListener('input', loadAdminProducts);
  $('#includeArchivedProducts').addEventListener('change', loadAdminProducts);
  $('#addProduct').addEventListener('click', () => openProductModal());
  $$('.product-modal-close').forEach(button => button.addEventListener('click', closeProductModal));
  $('#productModal').addEventListener('click', event => {
    if (event.target === $('#productModal')) closeProductModal();
  });
  $('#productImageFile').addEventListener('change', event => {
    const file = event.currentTarget.files?.[0];
    if (state.productPreviewUrl) URL.revokeObjectURL(state.productPreviewUrl);
    state.productPreviewUrl = '';
    if (!file) {
      $('#productImagePreviewBox').hidden = !$('#productImage').value;
      $('#productImagePreview').src = $('#productImage').value;
      $('#productImagePreviewLabel').textContent = $('#productImage').value ? 'Gambar saat ini' : '';
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      event.currentTarget.value = '';
      $('#productImagePreviewBox').hidden = true;
      toast('Pilih gambar JPG, PNG, atau WebP dengan ukuran maksimal 5 MB.', 'error');
      return;
    }
    state.productPreviewUrl = URL.createObjectURL(file);
    $('#productImagePreview').src = state.productPreviewUrl;
    $('#productImagePreviewLabel').textContent = file.name;
    $('#productImagePreviewBox').hidden = false;
  });
  $('#generateVariants').addEventListener('click', () => {
    const sizes = $('#productVariantSizes').value.split(/[,\n]+/).map(size => size.trim()).filter(Boolean);
    const existing = [...$('#productVariantRows').querySelectorAll('[data-variant-row]')].map(row => ({
      id_produk: $('[data-variant-id]', row).value,
      ukuran: $('[data-variant-size]', row).value,
      stok: $('[data-variant-stock]', row).value,
      aktif: $('[data-variant-active]', row).checked
    }));
    const existingKeys = new Set(existing.map(variant => variant.ukuran.toLowerCase()));
    const additional = sizes.filter(size => !existingKeys.has(size.toLowerCase())).map(size => ({
      ukuran: size,
      stok: Number($('#productVariantDefaultStock').value) || 0,
      aktif: true
    }));
    if (!sizes.length || sizes.some(size => size.length > 30)) {
      toast('Masukkan nama varian yang valid, pisahkan dengan koma atau baris baru.', 'error');
      return;
    }
    if (!additional.length) {
      toast('Semua ukuran tersebut sudah ada.', 'error');
      return;
    }
    renderVariantRows([...existing, ...additional]);
    $('#productVariantSizes').value = '';
  });
  $('#productVariantRows').addEventListener('click', event => {
    const remove = event.target.closest('[data-remove-variant]');
    if (remove) remove.closest('[data-variant-row]').remove();
  });
  $('#productVariantRows').addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target.closest('[data-variant-barcode]')) {
      event.preventDefault();
    }
  });
  $('#productForm').addEventListener('submit', async event => {
    event.preventDefault();
    const id = $('#productId').value;
    const button = $('button[type="submit"]', event.currentTarget);
    const name = $('#productName').value.trim();
    const category = $('#productCategory').value.trim();
    const priceValue = $('#productPrice').value.trim();
    const variantRows = [...$('#productVariantRows').querySelectorAll('[data-variant-row]')];
    if (!name) {
      toast('Nama produk wajib diisi.', 'error');
      $('#productName').focus();
      return;
    }
    if (!category) {
      toast('Kategori wajib diisi. Admin bebas menulis nama kategori sendiri.', 'error');
      $('#productCategory').focus();
      return;
    }
    if (name.length > 150 || category.length > 80) {
      toast('Nama produk maksimal 150 karakter dan kategori maksimal 80 karakter.', 'error');
      return;
    }
    if (!priceValue || !Number.isFinite(Number(priceValue)) || Number(priceValue) < 0) {
      toast('Harga harus berupa angka nol atau lebih.', 'error');
      $('#productPrice').focus();
      return;
    }
    if (!variantRows.length) {
      toast('Tambahkan minimal satu varian beserta nama dan stok.', 'error');
      $('#productVariantSizes').focus();
      return;
    }
    if (variantRows.some(row => !$('[data-variant-size]', row).value.trim()
      || !$('[data-variant-stock]', row).value.trim()
      || !Number.isInteger(Number($('[data-variant-stock]', row).value))
      || Number($('[data-variant-stock]', row).value) < 0)) {
      toast('Pastikan setiap varian memiliki nama dan stok berupa angka nol atau lebih.', 'error');
      return;
    }
    button.disabled = true;
    try {
      const imageFile = $('#productImageFile').files?.[0];
      if (imageFile) {
        const formData = new FormData();
        formData.append('gambar', imageFile);
        const response = await fetch(`${API}?route=product-image`, {
          method: 'POST',
          headers: { 'X-CSRF-Token': state.csrfToken },
          body: formData
        });
        const upload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(upload.error || `Gambar gagal diunggah (${response.status}).`);
        $('#productImage').value = upload.gambar_url;
      }
      const result = await request(id ? `products&id=${encodeURIComponent(id)}` : 'products', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify({
          nama_produk: name,
          kategori: category,
          harga: Number($('#productPrice').value),
          gambar_url: $('#productImage').value.trim(),
          diskon_persen: Number($('#productDiscount').value),
          diskon_aktif: $('#productDiscountActive').checked,
          aktif: $('#productActive').checked,
          variants: [...$('#productVariantRows').querySelectorAll('[data-variant-row]')].map(row => ({
            id_produk: $('[data-variant-id]', row).value || null,
            ukuran: $('[data-variant-size]', row).value.trim(),
            barcode: $('[data-variant-barcode]', row).value.trim(),
            stok: Number($('[data-variant-stock]', row).value),
            aktif: $('[data-variant-active]', row).checked
          }))
        })
      });
      toast(result.message);
      closeProductModal();
      await Promise.all([loadAdminProducts(), loadPosProducts(true)]);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  });
  $('#productRows').addEventListener('click', async event => {
    const edit = event.target.closest('[data-product-edit]');
    const remove = event.target.closest('[data-product-delete]');
    const toggle = event.target.closest('[data-discount-toggle]');
    const variantsButton = event.target.closest('[data-product-variants]');
    if (variantsButton) {
      const id = Number(variantsButton.dataset.productVariants);
      if (state.expandedProducts.has(id)) state.expandedProducts.delete(id);
      else state.expandedProducts.add(id);
      loadAdminProducts();
      return;
    }
    if (edit) openProductModal(state.productRows.find(product => Number(product.id_produk) === Number(edit.dataset.productEdit)));
    if (toggle) {
      try {
        const result = await request(`product-discount&id=${Number(toggle.dataset.discountToggle)}`, {
          method: 'PUT',
          body: JSON.stringify({ aktif: toggle.checked })
        });
        toast(result.message);
        await Promise.all([loadAdminProducts(), loadPosProducts(true)]);
      } catch (error) {
        toggle.checked = !toggle.checked;
        toast(error.message, 'error');
      }
    }
    if (remove && window.confirm('Arsipkan produk ini? Produk tidak akan tampil untuk transaksi baru.')) {
      try {
        const result = await request(`products&id=${Number(remove.dataset.productDelete)}`, { method: 'DELETE' });
        toast(result.message);
        await loadAdminProducts();
      } catch (error) {
        toast(error.message, 'error');
      }
    }
  });
  $('#refreshOrders').addEventListener('click', loadOrders);
  $('#ordersFilter').addEventListener('change', loadOrders);
  $('#ordersRows').addEventListener('click', handleOrderAction);
  $('#refreshOnlinePayments').addEventListener('click', () => loadOnlinePayments());
  $('#onlinePaymentMethodFilter').addEventListener('change', renderOnlinePayments);
  $('#onlinePaymentStatusFilter').addEventListener('change', renderOnlinePayments);
  $('#onlinePaymentRows').addEventListener('click', handleOrderAction);

  $$('.nav-item[data-page]').forEach(button => button.addEventListener('click', () => showPage(button.dataset.page)));
  $$('[data-go]').forEach(button => button.addEventListener('click', () => showPage(button.dataset.go)));
  $('#menuToggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#addCustomer').addEventListener('click', () => openCustomerModal());
  $$('.modal-close').forEach(button => button.addEventListener('click', closeCustomerModal));
  $('#customerModal').addEventListener('click', event => {
    if (event.target === $('#customerModal')) closeCustomerModal();
  });
  $('#addUserAccount').addEventListener('click', openAccountModal);
  $$('.account-modal-close').forEach(button => button.addEventListener('click', closeAccountModal));
  $('#accountModal').addEventListener('click', event => {
    if (event.target === $('#accountModal')) closeAccountModal();
  });
  $('#accountRole').addEventListener('change', updateAccountFormRole);

  $('#accountForm').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = $('button[type="submit"]', event.currentTarget);
    const role = $('#accountRole').value;
    submit.disabled = true;
    try {
      const result = await request('admin-accounts', {
        method: 'POST',
        body: JSON.stringify({
          role,
          nama: $('#accountName').value.trim(),
          kota: $('#accountCity').value.trim(),
          email: $('#accountEmail').value.trim(),
          password: $('#accountPassword').value
        })
      });
      closeAccountModal();
      toast(`${result.message} Email: ${$('#accountEmail').value.trim()}`);
      if (role === 'customer') {
        loadCustomers();
        loadDashboard();
      }
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      submit.disabled = false;
    }
  });

  $('#customerForm').addEventListener('submit', async event => {
    event.preventDefault();
    const id = $('#customerId').value;
    const submit = $('button[type="submit"]', event.currentTarget);
    submit.disabled = true;
    try {
      const result = await request(id ? `customers&id=${encodeURIComponent(id)}` : 'customers', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify({ nama: $('#customerName').value.trim(), kota: $('#customerCity').value.trim() })
      });
      closeCustomerModal();
      toast(result.message);
      loadCustomers();
      loadDashboard();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      submit.disabled = false;
    }
  });

  $('#customerRows').addEventListener('click', async event => {
    const edit = event.target.closest('[data-edit]');
    const remove = event.target.closest('[data-delete]');
    if (edit) {
      try {
        const result = await request(`customer-detail&id=${encodeURIComponent(edit.dataset.edit)}`);
        openCustomerModal(result.data);
      } catch (error) {
        toast(error.message, 'error');
      }
    }
    if (remove && window.confirm('Hapus pelanggan ini? Histori transaksi akan tetap tersimpan.')) {
      try {
        const result = await request(`customers&id=${encodeURIComponent(remove.dataset.delete)}`, { method: 'DELETE' });
        toast(result.message);
        loadCustomers();
        loadDashboard();
      } catch (error) {
        toast(error.message, 'error');
      }
    }
  });

  let searchTimer;
  $('#customerSearch').addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      state.customerPage = 1;
      loadCustomers();
    }, 250);
  });

  $('#applyDateFilter').addEventListener('click', () => {
    state.reportFrom = $('#dateFrom').value;
    state.reportTo = $('#dateTo').value;
    if (state.reportFrom && state.reportTo && state.reportFrom > state.reportTo) {
      toast('Tanggal awal tidak boleh melewati tanggal akhir.', 'error');
      return;
    }
    state.reportPage = 1;
    loadReports();
  });
  $('#exportCsv').addEventListener('click', exportCsv);
  $('#printReport').addEventListener('click', printReportPdf);
  $('#refreshLogs').addEventListener('click', () => loadLogs());

  setToday();
  initializeAuth();
})();

/* BOPOIL boutique. Live products come from Square; the unconnected catalog is
   an explicitly labelled preview. Carts stay on this device, separately by mode. */
(function () {
  'use strict';
  var grid = document.querySelector('[data-shop-grid]');
  if (!grid) return;
  var fallbackHTML = grid.innerHTML;
  var filtersEl = document.querySelector('[data-shop-filters]');
  var fallbackFilters = filtersEl.innerHTML;
  var countEl = document.querySelector('[data-shop-count]');
  var notice = document.querySelector('[data-catalog-notice]');
  var emptyEl = document.querySelector('[data-shop-empty]');
  var searchEl = document.querySelector('[data-shop-search]');
  var sortEl = document.querySelector('[data-shop-sort]');
  var statusEl = document.querySelector('[data-order-status]');
  var overlay = document.querySelector('[data-cart-overlay]');
  var drawer = document.querySelector('[data-cart-drawer]');
  var itemsEl = document.querySelector('[data-cart-items]');
  var footEl = document.querySelector('[data-cart-foot]');
  var subtotalEl = document.querySelector('[data-cart-subtotal]');
  var confirmEl = document.querySelector('[data-cart-confirm]');
  var noteEl = document.querySelector('[data-cart-note]');
  var checkoutBtn = document.querySelector('[data-cart-checkout]');
  var toast = document.querySelector('[data-shop-toast]');
  var announcement = document.querySelector('[data-shop-announcement]');
  var productOverlay = document.querySelector('[data-product-overlay]');
  var sheet = document.querySelector('[data-product-sheet]');
  var sheetMedia = document.querySelector('[data-product-media]');
  var sheetCategory = document.querySelector('[data-product-category]');
  var sheetTitle = document.querySelector('[data-product-title]');
  var sheetPrice = document.querySelector('[data-product-price]');
  var sheetDesc = document.querySelector('[data-product-desc]');
  var sheetQty = document.querySelector('[data-product-qty]');
  var sheetAdd = document.querySelector('[data-product-add]');
  var mode = 'loading';
  var products = Object.create(null);
  var cart = Object.create(null);
  var cards = [];
  var activeCategory = 'tous';
  var lastFocus;
  var inerted = [];
  var toastTimer;
  var checkoutBusy = false;
  var checkoutAttempt = null;
  var productQty = 1;
  var openProductId = '';
  var CAT_PHOTOS = [
    'images/chien-toilettage-complet-900.jpg',
    'images/chien-brossage-900.jpg',
    'images/chiots-endormis-800.jpg',
    'images/chat-cache-griffes-900.jpg',
    'images/boutique-interieur-800.jpg',
    'images/chat-toilettage-complet-900.jpg',
    'images/chien-traitement-mue-900.jpg',
    'images/approche-chat-chien-800.jpg'
  ];
  var PLUS = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function money(cents, currency) {
    return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: currency || 'CAD' }).format(cents / 100);
  }
  function normalized(value) {
    return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  function slug(value) { return normalized(value).replace(/[^a-z0-9]+/g, '-') || 'boutique'; }
  function paw() {
    return '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="6" cy="10" r="2"/><circle cx="10" cy="6" r="2"/><circle cx="15" cy="6" r="2"/><circle cx="19" cy="10" r="2"/><path d="M8 16c1-2 2-3 4-3s3 1 4 3c2 4-2 4-4 3-2 1-6 1-4-3Z"/></svg>';
  }
  function reduceMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function storageKey() { return mode === 'square' ? 'bopoil_cart_v1' : 'bopoil_cart_preview_v1'; }
  function readCart() {
    var clean = Object.create(null);
    try {
      var data = JSON.parse(localStorage.getItem(storageKey()) || '{}');
      if (!data || typeof data !== 'object' || Array.isArray(data)) return clean;
      Object.keys(data).forEach(function (id) {
        var qty = Number(data[id]);
        if (products[id] && Number.isInteger(qty) && qty > 0) clean[id] = Math.min(99, qty);
      });
    } catch (e) { /* Shopping remains available without browser storage. */ }
    return clean;
  }
  function saveCart() {
    try { localStorage.setItem(storageKey(), JSON.stringify(cart)); } catch (e) { /* Device storage is optional. */ }
  }
  function itemCount() { return Object.keys(cart).reduce(function (n, id) { return n + cart[id]; }, 0); }
  function subtotal() { return Object.keys(cart).reduce(function (n, id) { return n + products[id].price * cart[id]; }, 0); }
  function announce(message) {
    clearTimeout(toastTimer);
    announcement.textContent = message;
    toast.hidden = false;
    toastTimer = setTimeout(function () { if (!toast.contains(document.activeElement)) toast.hidden = true; }, 5000);
  }
  function showMessage(message, error) {
    confirmEl.hidden = !message;
    confirmEl.className = 'cart-confirm' + (error ? ' cart-confirm--error' : '');
    confirmEl.textContent = message;
  }
  function chromeHidden(hidden) {
    document.querySelectorAll('[data-shop-chrome]').forEach(function (el) { el.hidden = hidden; });
  }
  function renderCart() {
    var ids = Object.keys(cart);
    var count = itemCount();
    document.querySelectorAll('[data-cart-count]').forEach(function (el) { el.textContent = count; el.hidden = !count; });
    document.querySelector('.cart-btn').setAttribute('aria-label', 'Ouvrir le panier, ' + count + ' article' + (count > 1 ? 's' : ''));
    if (!ids.length) {
      itemsEl.innerHTML = '<li class="cart-empty">' + paw() + '<p><strong>Votre panier est vide.</strong></p><p>Trouvez les petits essentiels de votre compagnon.</p><button class="btn btn--filled btn--small" type="button" data-cart-close>Explorer la boutique</button></li>';
    } else {
      itemsEl.innerHTML = ids.map(function (id) {
        var p = products[id], key = escapeHtml(id), name = escapeHtml(p.name);
        return '<li class="cart-line"><span class="cart-line__thumb">' + p.media + '</span><div class="cart-line__info"><p class="cart-line__name">' + name + '</p><p class="cart-line__unit">' + money(p.price, p.currency) + ' l’unité</p><div class="qty-stepper" role="group" aria-label="Quantité : ' + name + '"><button type="button" data-dec="' + key + '" aria-label="Retirer un : ' + name + '"' + (checkoutBusy ? ' disabled' : '') + '>−</button><span class="qty-stepper__val">' + cart[id] + '</span><button type="button" data-inc="' + key + '" aria-label="Ajouter un : ' + name + '"' + (cart[id] >= 99 || checkoutBusy ? ' disabled' : '') + '>+</button></div></div><div class="cart-line__end"><span class="cart-line__price">' + money(p.price * cart[id], p.currency) + '</span><button class="cart-line__remove" type="button" data-remove="' + key + '" aria-label="Retirer du panier : ' + name + '"' + (checkoutBusy ? ' disabled' : '') + '>Retirer</button></div></li>';
      }).join('');
    }
    footEl.hidden = !ids.length;
    subtotalEl.textContent = money(subtotal(), ids.length ? products[ids[0]].currency : 'CAD');
    checkoutBtn.disabled = mode !== 'square' || checkoutBusy || !ids.length;
    checkoutBtn.textContent = checkoutBusy ? 'Ouverture du paiement…' : mode === 'square' ? 'Continuer vers le paiement' : 'Paiement bientôt disponible';
    noteEl.textContent = mode === 'square' ? 'Taxes et total confirmés sur Square. Cueillette au 38 avenue Gatineau après confirmation du salon.' : 'Panier d’aperçu : aucune commande ni réservation n’est envoyée. Contactez le salon pour acheter un produit.';
  }
  function setQty(id, qty) {
    if (!products[id] || checkoutBusy || (mode !== 'square' && mode !== 'preview')) return;
    if (qty <= 0) delete cart[id]; else cart[id] = Math.min(99, qty);
    checkoutAttempt = null;
    saveCart();
    showMessage('');
    renderCart();
  }
  function lockPage(except) {
    lastFocus = document.activeElement;
    inerted = Array.prototype.filter.call(document.body.children, function (el) {
      return except.indexOf(el) === -1 && el.tagName !== 'SCRIPT' && !el.inert;
    });
    inerted.forEach(function (el) { el.inert = true; });
  }
  function unlockPage(restore) {
    inerted.forEach(function (el) { el.inert = false; });
    inerted = [];
    if (restore !== false && lastFocus && lastFocus.isConnected) lastFocus.focus();
  }
  function openCart() {
    if (sheet.dataset.open === 'true') closeProduct({ restore: false });
    toast.hidden = true;
    overlay.dataset.open = 'true';
    drawer.dataset.open = 'true';
    drawer.inert = false;
    drawer.setAttribute('aria-hidden', 'false');
    document.body.dataset.cartOpen = 'true';
    lockPage([overlay, drawer, toast]);
    drawer.querySelector('.cart-close').focus();
  }
  function closeCart(opts) {
    overlay.dataset.open = 'false';
    drawer.dataset.open = 'false';
    drawer.inert = true;
    drawer.setAttribute('aria-hidden', 'true');
    document.body.dataset.cartOpen = 'false';
    unlockPage(!opts || opts.restore !== false);
  }
  function requestedProductId() {
    return new URLSearchParams(window.location.search).get('produit') || '';
  }
  function setProductParam(id) {
    var params = new URLSearchParams(window.location.search);
    if (id) params.set('produit', id); else params.delete('produit');
    var next = window.location.pathname + (params.toString() ? '?' + params.toString() : '') + window.location.hash;
    var current = window.location.pathname + window.location.search + window.location.hash;
    if (next !== current) history.pushState({ produit: id || '' }, '', next);
  }
  function renderProductQty() {
    if (!sheetQty) return;
    sheetQty.textContent = String(productQty);
    var dec = sheet.querySelector('[data-product-dec]');
    var inc = sheet.querySelector('[data-product-inc]');
    if (dec) dec.disabled = productQty <= 1 || checkoutBusy;
    if (inc) inc.disabled = productQty >= 99 || checkoutBusy;
    if (sheetAdd) sheetAdd.disabled = checkoutBusy || (mode !== 'square' && mode !== 'preview');
  }
  function fillProductSheet(id) {
    var p = products[id];
    if (!p || !sheet) return false;
    openProductId = id;
    productQty = 1;
    sheetMedia.innerHTML = p.media || paw();
    sheetCategory.textContent = p.category || '';
    sheetTitle.textContent = p.name;
    sheetPrice.textContent = money(p.price, p.currency);
    sheetDesc.textContent = p.description || 'Demandez conseil à l’équipe du salon pour les détails de ce produit.';
    sheetAdd.dataset.add = id;
    renderProductQty();
    return true;
  }
  function openProduct(id, opts) {
    if (!products[id] || !sheet) return;
    if (drawer.dataset.open === 'true') closeCart({ restore: false });
    if (!fillProductSheet(id)) return;
    if (!opts || opts.updateUrl !== false) setProductParam(id);
    toast.hidden = true;
    productOverlay.dataset.open = 'true';
    sheet.dataset.open = 'true';
    sheet.inert = false;
    sheet.setAttribute('aria-hidden', 'false');
    document.body.dataset.productOpen = 'true';
    lockPage([productOverlay, sheet, toast]);
    sheet.querySelector('[data-product-close]').focus();
  }
  function closeProduct(opts) {
    if (!sheet || sheet.dataset.open !== 'true') {
      if (!opts || opts.updateUrl !== false) setProductParam('');
      return;
    }
    productOverlay.dataset.open = 'false';
    sheet.dataset.open = 'false';
    sheet.inert = true;
    sheet.setAttribute('aria-hidden', 'true');
    document.body.dataset.productOpen = 'false';
    openProductId = '';
    if (!opts || opts.updateUrl !== false) setProductParam('');
    unlockPage(!opts || opts.restore !== false);
  }
  function syncProductFromUrl() {
    var id = requestedProductId();
    if (id && products[id]) {
      if (openProductId !== id) openProduct(id, { updateUrl: false });
      return;
    }
    if (sheet && sheet.dataset.open === 'true') closeProduct({ updateUrl: false });
  }
  function filterProducts() {
    if (mode !== 'square' && mode !== 'preview') return;
    var query = normalized(searchEl.value.trim());
    var sorted = cards.slice();
    if (sortEl.value === 'price-asc') sorted.sort(function (a, b) { return Number(a.dataset.price) - Number(b.dataset.price); });
    if (sortEl.value === 'price-desc') sorted.sort(function (a, b) { return Number(b.dataset.price) - Number(a.dataset.price); });
    if (sortEl.value === 'name') sorted.sort(function (a, b) { return a.dataset.name.localeCompare(b.dataset.name, 'fr'); });
    var count = 0;
    var shown = 0;
    sorted.forEach(function (card) {
      var haystack = normalized([card.dataset.name, card.dataset.cat, card.dataset.desc].join(' '));
      var match = (activeCategory === 'tous' || card.dataset.cat === activeCategory) && haystack.includes(query);
      card.hidden = !match;
      if (match) {
        card.style.setProperty('--i', String(shown));
        count++;
        shown++;
      }
      grid.appendChild(card);
    });
    filtersEl.querySelectorAll('[data-filter]').forEach(function (el) { el.setAttribute('aria-pressed', String(el.dataset.filter === activeCategory)); });
    countEl.textContent = count + (count > 1 ? ' produits' : ' produit');
    emptyEl.hidden = count !== 0 || mode === 'error' || !cards.length;
  }
  function cardHTML(p, index) {
    var id = escapeHtml(p.id);
    var name = escapeHtml(p.name);
    var category = escapeHtml(p.category || 'Boutique');
    var cat = escapeHtml(p.cat || slug(p.category));
    var desc = escapeHtml(p.description || '');
    var image = p.imageHtml || paw();
    return '<article class="product-card" style="--i:' + index + (p.tint ? ';--tint:' + escapeHtml(p.tint) + ';--tint-ink:' + escapeHtml(p.ink || '') : '') + '" data-product data-id="' + id + '" data-name="' + name + '" data-price="' + p.priceCents + '" data-currency="' + escapeHtml(p.currency || 'CAD') + '" data-cat="' + cat + '" data-desc="' + desc + '">' +
      '<button class="product-card__hit" type="button" data-open-product="' + id + '" aria-haspopup="dialog" aria-controls="product-sheet" aria-label="Voir le produit : ' + name + '">' +
        '<span class="product-card__media">' +
          '<span class="product-card__badge">' + category + '</span>' + image +
          '<span class="product-card__view">Voir le produit</span>' +
        '</span>' +
        '<span class="product-card__body">' +
          '<span class="product-card__title">' + name + '</span>' +
          '<span class="product-card__price">' + money(p.priceCents, p.currency) + '</span>' +
        '</span>' +
      '</button>' +
      '<button class="product-card__quick" type="button" data-add="' + id + '" aria-label="Ajouter au panier : ' + name + '">' + PLUS + '</button>' +
    '</article>';
  }
  function renderFilters(categories) {
    var html = '<li><button class="shop-cat shop-cat--all" type="button" data-filter="tous" aria-pressed="true"><span class="shop-cat__label">Tous les produits</span></button></li>';
    var i = 0;
    categories.forEach(function (entry) {
      var photo = CAT_PHOTOS[i++ % CAT_PHOTOS.length];
      html += '<li><button class="shop-cat" type="button" data-filter="' + escapeHtml(entry[0]) + '" aria-pressed="false">' +
        '<span class="shop-cat__media"><img src="' + photo + '" alt="" width="480" height="360" loading="lazy" decoding="async"></span>' +
        '<span class="shop-cat__label">' + escapeHtml(entry[1]) + '</span></button></li>';
    });
    filtersEl.innerHTML = html;
  }
  function hydrate() {
    products = Object.create(null);
    cards = Array.prototype.slice.call(grid.querySelectorAll('[data-product]'));
    cards.forEach(function (card, index) {
      var media = card.querySelector('.product-card__media > svg, .product-card__media > img');
      var badge = card.querySelector('.product-card__badge');
      products[card.dataset.id] = {
        name: card.dataset.name,
        price: Number(card.dataset.price),
        currency: card.dataset.currency || 'CAD',
        media: media ? media.outerHTML : paw(),
        description: card.dataset.desc || '',
        category: badge ? badge.textContent.trim() : ''
      };
      card.style.setProperty('--i', String(index));
      var btn = card.querySelector('[data-add]');
      if (btn) {
        btn.disabled = false;
        btn.setAttribute('aria-label', 'Ajouter au panier : ' + card.dataset.name);
      }
    });
    cart = readCart();
    renderCart();
    filterProducts();
    syncProductFromUrl();
  }
  function renderSquareCatalog(list) {
    var categories = new Map();
    grid.innerHTML = list.map(function (p, index) {
      var category = slug(p.category);
      categories.set(category, p.category);
      var image = /^https:\/\//i.test(p.imageUrl || '') ? '<img src="' + escapeHtml(p.imageUrl) + '" alt="' + escapeHtml(p.name) + '" loading="lazy" decoding="async">' : paw();
      return cardHTML({
        id: p.id,
        name: p.name,
        description: p.description || '',
        priceCents: p.priceCents,
        currency: p.currency,
        category: p.category,
        cat: category,
        imageHtml: image
      }, index);
    }).join('');
    renderFilters(categories);
    grid.querySelectorAll('.product-card__media img').forEach(function (img) {
      img.addEventListener('error', function () { img.outerHTML = paw(); });
    });
  }
  function markAdded(btn) {
    btn.dataset.added = 'true';
    var label = btn.querySelector('.product-card__add-label');
    var original = label ? label.textContent : '';
    if (label) label.textContent = 'Ajouté ✓';
    setTimeout(function () {
      delete btn.dataset.added;
      if (label) label.textContent = original;
    }, 1400);
  }
  function addToCart(id, qty, btn) {
    if (checkoutBusy || !products[id] || (mode !== 'square' && mode !== 'preview')) return;
    var next = (cart[id] || 0) + (qty || 1);
    if (next > 99) { announce('La limite est de 99 articles par produit.'); return; }
    setQty(id, next);
    announce(products[id].name + (qty > 1 ? ' ajoutés au panier.' : ' ajouté au panier.'));
    if (btn) markAdded(btn);
  }
  async function loadCatalog() {
    mode = 'loading';
    grid.setAttribute('aria-busy', 'true');
    notice.textContent = 'Chargement de la boutique…';
    grid.querySelectorAll('[data-add]').forEach(function (btn) { btn.disabled = true; });
    renderCart();
    try {
      var res = await fetch('/api/public/shop', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
      if (!res.ok) throw new Error('catalog');
      var data = await res.json();
      if (!data || data.error || typeof data.configured !== 'boolean' || !Array.isArray(data.products)) throw new Error('catalog');
      activeCategory = 'tous';
      if (data.configured) {
        mode = 'square';
        renderSquareCatalog(data.products);
        notice.textContent = data.products.length ? 'Paiement sécurisé avec Square · Cueillette au salon' : 'La boutique se prépare. Aucun produit n’est disponible en ligne pour le moment. Contactez le salon pour être conseillé.';
      } else {
        mode = 'preview';
        grid.innerHTML = fallbackHTML;
        filtersEl.innerHTML = fallbackFilters;
        notice.textContent = 'Aperçu de la boutique — produits et prix à confirmer. Vous pouvez essayer le panier; les commandes en ligne ne sont pas encore ouvertes.';
      }
      grid.hidden = false;
      hydrate();
    } catch (e) {
      mode = 'error';
      grid.hidden = true;
      emptyEl.hidden = true;
      countEl.textContent = 'Catalogue indisponible';
      notice.innerHTML = 'La boutique est temporairement indisponible. Votre panier enregistré est conservé.<button type="button" data-catalog-retry>Réessayer</button>';
      closeProduct({ restore: false, updateUrl: false });
      renderCart();
    } finally {
      chromeHidden(mode === 'error' || !cards.length);
      grid.setAttribute('aria-busy', 'false');
    }
  }
  async function checkout() {
    if (mode !== 'square' || checkoutBusy || !itemCount()) return;
    var items = Object.keys(cart).map(function (id) { return { id: id, quantity: cart[id] }; });
    var fingerprint = JSON.stringify(items);
    if (!checkoutAttempt || checkoutAttempt.fingerprint !== fingerprint) checkoutAttempt = { fingerprint: fingerprint, key: crypto.randomUUID() };
    checkoutBusy = true;
    showMessage('');
    renderCart();
    renderProductQty();
    try {
      var res = await fetch('/api/public/shop/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ items: items, idempotencyKey: checkoutAttempt.key }), signal: AbortSignal.timeout(20000)
      });
      var data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || 'Le paiement est indisponible. Veuillez réessayer.');
      var url = new URL(data.url);
      if (url.protocol !== 'https:' || !/(^|\.)(square\.link|squareup\.com|squareupsandbox\.com)$/.test(url.hostname)) throw new Error('Le lien de paiement est invalide. Veuillez contacter le salon.');
      window.location.assign(url.href);
    } catch (e) {
      showMessage(e.name === 'TimeoutError' ? 'Le paiement prend trop de temps à répondre. Votre panier est conservé; veuillez réessayer.' : e.message || 'Le paiement est indisponible. Votre panier est conservé.', true);
    } finally {
      checkoutBusy = false;
      renderCart();
      renderProductQty();
    }
  }
  function trapTab(e, dialog) {
    var focusables = Array.prototype.filter.call(dialog.querySelectorAll('button:not(:disabled), a[href]'), function (el) { return el.getClientRects().length; });
    if (!focusables.length) return;
    var first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  document.addEventListener('click', function (e) {
    var openHit = e.target.closest('[data-open-product]');
    if (openHit) {
      e.preventDefault();
      openProduct(openHit.dataset.openProduct);
      return;
    }
    var btn = e.target.closest('button');
    if (!btn) return;
    if (btn.hasAttribute('data-cart-open')) openCart();
    if (btn.hasAttribute('data-cart-close')) closeCart();
    if (btn.hasAttribute('data-product-close')) closeProduct();
    if (btn.hasAttribute('data-catalog-retry')) loadCatalog();
    if (btn.hasAttribute('data-add')) addToCart(btn.dataset.add, btn.hasAttribute('data-product-add') ? productQty : 1, btn);
    if (btn.hasAttribute('data-product-inc')) { productQty = Math.min(99, productQty + 1); renderProductQty(); }
    if (btn.hasAttribute('data-product-dec')) { productQty = Math.max(1, productQty - 1); renderProductQty(); }
    var attr = ['inc', 'dec', 'remove'].find(function (key) { return btn.hasAttribute('data-' + key); });
    if (attr) {
      var productId = btn.dataset[attr];
      var lineIndex = Object.keys(cart).indexOf(productId);
      setQty(productId, attr === 'remove' ? 0 : cart[productId] + (attr === 'inc' ? 1 : -1));
      var replacement = Array.prototype.find.call(itemsEl.querySelectorAll('[data-' + attr + ']'), function (el) { return el.dataset[attr] === productId && !el.disabled; });
      if (!replacement) replacement = itemsEl.querySelectorAll('li')[Math.max(0, lineIndex - 1)]?.querySelector('button:not(:disabled)');
      (replacement || drawer.querySelector('.cart-close')).focus();
    }
    if (btn.hasAttribute('data-filter')) { activeCategory = btn.dataset.filter; filterProducts(); }
    if (btn.hasAttribute('data-shop-reset')) { activeCategory = 'tous'; searchEl.value = ''; sortEl.value = 'selection'; filterProducts(); searchEl.focus(); }
  });
  overlay.addEventListener('click', closeCart);
  productOverlay.addEventListener('click', function () { closeProduct(); });
  sheet.addEventListener('click', function (e) { if (e.target === sheet) closeProduct(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (drawer.dataset.open === 'true') closeCart();
      else if (sheet.dataset.open === 'true') closeProduct();
      return;
    }
    if (e.key !== 'Tab') return;
    if (drawer.dataset.open === 'true') trapTab(e, drawer);
    else if (sheet.dataset.open === 'true') trapTab(e, sheet);
  });
  grid.addEventListener('pointermove', function (e) {
    if (reduceMotion() || e.pointerType !== 'mouse') return;
    var card = e.target.closest('.product-card');
    if (!card) return;
    var r = card.getBoundingClientRect();
    var x = (e.clientX - r.left) / r.width;
    var y = (e.clientY - r.top) / r.height;
    card.style.setProperty('--mx', (x * 100).toFixed(2) + '%');
    card.style.setProperty('--my', (y * 100).toFixed(2) + '%');
    card.style.setProperty('--rx', ((0.5 - y) * 6).toFixed(2) + 'deg');
    card.style.setProperty('--ry', ((x - 0.5) * 8).toFixed(2) + 'deg');
  });
  grid.addEventListener('pointerout', function (e) {
    var card = e.target.closest('.product-card');
    if (!card || (e.relatedTarget && card.contains(e.relatedTarget))) return;
    card.style.setProperty('--rx', '0deg');
    card.style.setProperty('--ry', '0deg');
  });
  searchEl.addEventListener('input', filterProducts);
  sortEl.addEventListener('change', filterProducts);
  checkoutBtn.addEventListener('click', checkout);
  window.addEventListener('popstate', syncProductFromUrl);
  window.addEventListener('storage', function (e) { if (e.key === storageKey() && (mode === 'square' || mode === 'preview') && !checkoutBusy) { cart = readCart(); renderCart(); } });
  window.addEventListener('pageshow', function (e) { if (e.persisted) { checkoutBusy = false; renderCart(); renderProductQty(); } });
  var params = new URLSearchParams(window.location.search);
  if (params.has('commande')) {
    statusEl.hidden = false;
    statusEl.textContent = 'De retour de Square ? Consultez votre reçu Square pour confirmer le paiement. Votre panier est conservé; ne payez pas une seconde fois si vous avez déjà reçu un reçu.';
    params.delete('commande');
    history.replaceState(null, '', window.location.pathname + (params.size ? '?' + params.toString() : '') + window.location.hash);
  }
  renderCart();
  loadCatalog();
})();

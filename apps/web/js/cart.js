/* BOPOIL cart, on every page. The boutique (js/boutique.js) hands it the live
   catalog; the other pages list what the boutique last saw, kept on this
   device with the quantities. Square confirms prices and stock at checkout.
   Carts stay on this device, separately for the preview and Square modes. */
(function () {
  'use strict';
  var drawer = document.querySelector('[data-cart-drawer]');
  if (!drawer) return;
  var overlay = document.querySelector('[data-cart-overlay]');
  var itemsEl = drawer.querySelector('[data-cart-items]');
  var footEl = drawer.querySelector('[data-cart-foot]');
  var subtotalEl = drawer.querySelector('[data-cart-subtotal]');
  var confirmEl = drawer.querySelector('[data-cart-confirm]');
  var noteEl = drawer.querySelector('[data-cart-note]');
  var checkoutBtn = drawer.querySelector('[data-cart-checkout]');
  var toast = document.querySelector('[data-shop-toast]');
  var announcement = document.querySelector('[data-shop-announcement]');
  // Name, price and photo of each product in the cart, for the pages without the catalog.
  var LINES_KEY = 'bopoil_cart_lines_v1';
  var onBoutique = !!document.querySelector('[data-shop-grid]');
  var mode = '';
  var catalogLoaded = false;
  var products = Object.create(null);
  var cart = Object.create(null);
  var lastFocus;
  var inerted = [];
  var toastTimer;
  var checkoutBusy = false;
  var checkoutAttempt = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function money(cents, currency) {
    return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: currency || 'CAD' }).format(cents / 100);
  }
  function paw() {
    return '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="6" cy="10" r="2"/><circle cx="10" cy="6" r="2"/><circle cx="15" cy="6" r="2"/><circle cx="19" cy="10" r="2"/><path d="M8 16c1-2 2-3 4-3s3 1 4 3c2 4-2 4-4 3-2 1-6 1-4-3Z"/></svg>';
  }
  function allowedImageUrl(url) {
    url = String(url || '').trim();
    if (/^https:\/\//i.test(url)) return true;
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return false;
    return /^[\w][\w./-]*\.(jpg|jpeg|png|webp|gif)$/i.test(url);
  }
  // Square keeps the original upload of every photo, often 2 000 to 3 000
  // pixels a side. Decoded, the catalog's photos weighed over 2 GB, and iOS
  // Safari reloaded the boutique over and over («Un problème est survenu à
  // répétition»). Next.js resizes the photos of the Square bucket named in
  // apps/coat-care/next.config.ts and caches the result; the site's own
  // photos are used as they are.
  var SQUARE_PHOTOS = /^https:\/\/items-images-production\.s3\.us-west-2\.amazonaws\.com\/files\//i;
  function imageSrc(url, width) {
    url = String(url || '').trim();
    return SQUARE_PHOTOS.test(url) ? '/_next/image?url=' + encodeURIComponent(url) + '&w=' + width + '&q=75' : url;
  }
  // The src, srcset and sizes attributes of a photo offered at these widths
  // (ones Next.js accepts: 256, 384, 640, 1080…); `sizes` as on an <img>.
  function imageAttrs(url, widths, sizes) {
    url = String(url || '').trim();
    var src = imageSrc(url, widths[0]);
    if (src === url) return ' src="' + escapeHtml(url) + '"';
    var srcset = widths.length > 1
      ? ' srcset="' + widths.map(function (w) { return escapeHtml(imageSrc(url, w)) + ' ' + w + 'w'; }).join(', ') + '" sizes="' + escapeHtml(sizes) + '"'
      : '';
    return ' src="' + escapeHtml(src) + '"' + srcset + ' data-original="' + escapeHtml(url) + '"';
  }
  // A photo Next.js could not resize is shown from its original address.
  document.addEventListener('error', function (e) {
    var img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.dataset.original) return;
    e.stopPropagation();
    var original = img.dataset.original;
    delete img.dataset.original;
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    img.src = original;
  }, true);
  function ready() { return mode === 'square' || mode === 'preview'; }
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
  // Away from the boutique, the cart is listed from what the boutique saved last.
  function readLines() {
    try {
      var data = JSON.parse(localStorage.getItem(LINES_KEY) || 'null');
      if (!data || (data.mode !== 'square' && data.mode !== 'preview') || !data.lines || typeof data.lines !== 'object') return;
      var known = Object.create(null);
      Object.keys(data.lines).forEach(function (id) {
        var line = data.lines[id];
        if (!line || typeof line.name !== 'string' || !Number.isInteger(line.price) || line.price < 0) return;
        var image = allowedImageUrl(line.image) ? String(line.image).trim() : '';
        known[id] = {
          name: line.name,
          price: line.price,
          currency: /^[A-Z]{3}$/.test(line.currency) ? line.currency : 'CAD',
          media: image ? '<img' + imageAttrs(image, [256]) + ' alt="">' : paw(),
          images: image ? [image] : []
        };
      });
      mode = data.mode;
      products = known;
    } catch (e) { /* Device storage is optional. */ }
  }
  function saveLines() {
    var lines = {};
    Object.keys(cart).forEach(function (id) {
      var p = products[id];
      lines[id] = { name: p.name, price: p.price, currency: p.currency, image: (p.images || []).filter(allowedImageUrl)[0] || '' };
    });
    try { localStorage.setItem(LINES_KEY, JSON.stringify({ mode: mode, lines: lines })); } catch (e) { /* Device storage is optional. */ }
  }
  function saveCart() {
    try { localStorage.setItem(storageKey(), JSON.stringify(cart)); } catch (e) { /* Device storage is optional. */ }
    saveLines();
  }
  function itemCount() { return Object.keys(cart).reduce(function (n, id) { return n + cart[id]; }, 0); }
  function subtotal() { return Object.keys(cart).reduce(function (n, id) { return n + products[id].price * cart[id]; }, 0); }
  function announce(message) {
    if (!toast) return;
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
  function renderCart() {
    var ids = Object.keys(cart);
    var count = itemCount();
    document.querySelectorAll('[data-cart-count]').forEach(function (el) { el.textContent = count; el.hidden = !count; });
    document.querySelectorAll('.cart-btn').forEach(function (el) { el.setAttribute('aria-label', 'Ouvrir le panier, ' + count + ' article' + (count > 1 ? 's' : '')); });
    if (!ids.length) {
      var explore = onBoutique
        ? '<button class="btn btn--filled btn--small" type="button" data-cart-close>Explorer la boutique</button>'
        : '<a class="btn btn--filled btn--small" href="boutique.html">Explorer la boutique</a>';
      itemsEl.innerHTML = '<li class="cart-empty">' + paw() + '<p><strong>Votre panier est vide.</strong></p><p>Trouvez les petits essentiels de votre compagnon.</p>' + explore + '</li>';
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
    if (!products[id] || checkoutBusy || !ready()) return;
    if (qty <= 0) delete cart[id]; else cart[id] = Math.min(99, qty);
    checkoutAttempt = null;
    saveCart();
    showMessage('');
    renderCart();
  }
  function addToCart(id, qty) {
    if (checkoutBusy || !products[id] || !ready()) return false;
    var next = (cart[id] || 0) + (qty || 1);
    if (next > 99) { announce('La limite est de 99 articles par produit.'); return false; }
    setQty(id, next);
    announce(products[id].name + (qty > 1 ? ' ajoutés au panier.' : ' ajouté au panier.'));
    return true;
  }
  // Only the open dialog stays reachable; the rest of the page is inert until it closes.
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
  function isOpen() { return drawer.dataset.open === 'true'; }
  function openCart() {
    if (isOpen()) return;
    // The boutique closes its product sheet first.
    document.dispatchEvent(new CustomEvent('bopoil:cart-opening'));
    if (toast) toast.hidden = true;
    overlay.dataset.open = 'true';
    drawer.dataset.open = 'true';
    drawer.inert = false;
    drawer.setAttribute('aria-hidden', 'false');
    document.body.dataset.cartOpen = 'true';
    lockPage([overlay, drawer, toast]);
    drawer.querySelector('.cart-close').focus();
  }
  function closeCart(opts) {
    if (!isOpen()) return;
    overlay.dataset.open = 'false';
    drawer.dataset.open = 'false';
    drawer.inert = true;
    drawer.setAttribute('aria-hidden', 'true');
    document.body.dataset.cartOpen = 'false';
    unlockPage(!opts || opts.restore !== false);
  }
  function setBusy(busy) {
    checkoutBusy = busy;
    renderCart();
    document.dispatchEvent(new CustomEvent('bopoil:cart-busy'));
  }
  async function checkout() {
    if (mode !== 'square' || checkoutBusy || !itemCount()) return;
    var items = Object.keys(cart).map(function (id) { return { id: id, quantity: cart[id] }; });
    var fingerprint = JSON.stringify(items);
    if (!checkoutAttempt || checkoutAttempt.fingerprint !== fingerprint) checkoutAttempt = { fingerprint: fingerprint, key: crypto.randomUUID() };
    showMessage('');
    setBusy(true);
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
      setBusy(false);
    }
  }
  function trapTab(e, dialog) {
    var focusables = Array.prototype.filter.call(dialog.querySelectorAll('button:not(:disabled), a[href]'), function (el) { return el.getClientRects().length; });
    if (!focusables.length) return;
    var first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  // The boutique's live catalog replaces the saved lines: products gone from
  // Square leave the cart, and the other pages get the current names and prices.
  function load(nextMode, known) {
    mode = nextMode;
    products = known;
    catalogLoaded = true;
    checkoutAttempt = null;
    cart = readCart();
    saveLines();
    renderCart();
  }
  function reload() {
    if (!catalogLoaded) readLines();
    cart = readCart();
    renderCart();
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    if (btn.hasAttribute('data-cart-open')) openCart();
    if (btn.hasAttribute('data-cart-close')) closeCart();
    var attr = ['inc', 'dec', 'remove'].find(function (key) { return btn.hasAttribute('data-' + key); });
    if (attr && itemsEl.contains(btn)) {
      var productId = btn.dataset[attr];
      var lineIndex = Object.keys(cart).indexOf(productId);
      setQty(productId, attr === 'remove' ? 0 : cart[productId] + (attr === 'inc' ? 1 : -1));
      var replacement = Array.prototype.find.call(itemsEl.querySelectorAll('[data-' + attr + ']'), function (el) { return el.dataset[attr] === productId && !el.disabled; });
      if (!replacement) replacement = itemsEl.querySelectorAll('li')[Math.max(0, lineIndex - 1)]?.querySelector('button:not(:disabled), a[href]');
      (replacement || drawer.querySelector('.cart-close')).focus();
    }
  });
  overlay.addEventListener('click', function () { closeCart(); });
  document.addEventListener('keydown', function (e) {
    if (!isOpen()) return;
    if (e.key === 'Escape') closeCart();
    else if (e.key === 'Tab') trapTab(e, drawer);
  });
  checkoutBtn.addEventListener('click', checkout);
  window.addEventListener('storage', function (e) { if ((e.key === storageKey() || e.key === LINES_KEY) && !checkoutBusy) reload(); });
  window.addEventListener('pageshow', function (e) { if (e.persisted) setBusy(false); });

  window.BopoilCart = {
    load: load,
    add: addToCart,
    busy: function () { return checkoutBusy; },
    isOpen: isOpen,
    close: closeCart,
    lockPage: lockPage,
    unlockPage: unlockPage,
    trapTab: trapTab,
    escapeHtml: escapeHtml,
    money: money,
    paw: paw,
    allowedImageUrl: allowedImageUrl,
    imageAttrs: imageAttrs
  };
  reload();
})();

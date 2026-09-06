/* ==========================================================================
   BOPOIL — Boutique en ligne (panier côté client)
   --------------------------------------------------------------------------
   Aucune dépendance externe.

   Source des produits : l'API /api/public/shop expose le catalogue Square
   (noms, prix, images) du salon. Quand Square est configuré, la grille est
   rendue à partir de ces données et le paiement passe par un lien de paiement
   Square hébergé (/api/public/shop/checkout). Tant que Square n'est pas
   branché, la page conserve son catalogue de repli écrit en HTML (visible
   sans JavaScript et indexable) et la commande se fait par courriel avec
   cueillette au salon — la même approche « fonctionne dès la mise en ligne »
   que les autres formulaires du site.

   Le panier est conservé dans localStorage.
   ========================================================================== */

(function () {
  'use strict';

  var STORAGE_KEY = 'bopoil_cart_v1';
  var CONFIG = window.BOPOIL_CONFIG || {};
  var ORDER_EMAIL = (CONFIG.contact && CONFIG.contact.email) || 'info@bopoil.ca';

  var grid = document.querySelector('[data-shop-grid]');
  if (!grid) return;

  var filtersEl = document.querySelector('[data-shop-filters]');
  var countEl = document.querySelector('[data-shop-count]');
  var statusEl = document.querySelector('[data-order-status]');

  var checkoutMode = 'email'; // 'email' (repli) ou 'square'
  var PRODUCTS = {};

  function formatMoney(cents, currency) {
    try {
      return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: currency || 'CAD' }).format((cents || 0) / 100);
    } catch (e) {
      return ((cents || 0) / 100).toFixed(2) + ' $';
    }
  }

  function pawSVG(size) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="6.5" cy="10" r="1.8"/><circle cx="10.5" cy="6.5" r="1.8"/>' +
      '<circle cx="14.5" cy="6.5" r="1.8"/><circle cx="18" cy="10.5" r="1.8"/>' +
      '<path d="M8.5 16.5c1-2 2-3 3.5-3s2.5 1 3.5 3c.7 1.4 0 3-1.7 3-1 0-1.3-.4-1.8-.4s-.8.4-1.8.4c-1.7 0-2.4-1.6-1.7-3Z"/></svg>';
  }

  var PLUS_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function slugify(value) {
    return String(value || 'boutique').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'boutique';
  }

  /* ---- Rendu d'une grille de produits Square ---------------------------- */
  function squareCardHTML(product) {
    var catSlug = slugify(product.category);
    var media = product.imageUrl
      ? '<img src="' + escapeHtml(product.imageUrl) + '" alt="' + escapeHtml(product.name) + '" loading="lazy" decoding="async">'
      : pawSVG(64);
    return '' +
      '<article class="product-card" data-product data-id="' + escapeHtml(product.id) + '"' +
        ' data-name="' + escapeHtml(product.name) + '" data-price="' + (product.priceCents || 0) + '"' +
        ' data-currency="' + escapeHtml(product.currency || 'CAD') + '" data-cat="' + escapeHtml(catSlug) + '"' +
        ' data-tint="#f5efef" data-ink="#141414">' +
        '<div class="product-card__media' + (product.imageUrl ? ' product-card__media--photo' : '') + '" style="--tint:#f5efef;--tint-ink:#141414">' +
          '<span class="product-card__badge">' + escapeHtml(product.category) + '</span>' +
          media +
        '</div>' +
        '<div class="product-card__body">' +
          '<h2 class="product-card__title">' + escapeHtml(product.name) + '</h2>' +
          '<p class="product-card__desc">' + escapeHtml(product.description) + '</p>' +
          '<div class="product-card__foot">' +
            '<span class="product-card__price">' + formatMoney(product.priceCents, product.currency) + '</span>' +
            '<button class="btn btn--filled btn--small product-card__add" type="button" data-add="' + escapeHtml(product.id) + '" data-label="Ajouter">' +
              PLUS_SVG + '<span class="product-card__add-label">Ajouter</span>' +
            '</button>' +
          '</div>' +
        '</div>' +
      '</article>';
  }

  function renderSquareCatalog(products) {
    grid.innerHTML = products.map(squareCardHTML).join('');

    if (filtersEl) {
      var categories = [];
      var seen = {};
      products.forEach(function (p) {
        var slug = slugify(p.category);
        if (!seen[slug]) { seen[slug] = true; categories.push({ slug: slug, label: p.category }); }
      });
      var chips = ['<li><button class="shop-filter" type="button" data-filter="tous" aria-pressed="true">Tous</button></li>'];
      categories.forEach(function (c) {
        chips.push('<li><button class="shop-filter" type="button" data-filter="' + escapeHtml(c.slug) + '" aria-pressed="false">' + escapeHtml(c.label) + '</button></li>');
      });
      filtersEl.innerHTML = chips.join('');
    }
  }

  /* ---- Lecture du catalogue depuis le DOM (repli statique ou Square) ----- */
  function hydrateFromDom() {
    PRODUCTS = {};
    Array.prototype.forEach.call(grid.querySelectorAll('[data-product]'), function (card) {
      var id = card.getAttribute('data-id');
      var mediaEl = card.querySelector('.product-card__media > svg, .product-card__media > img');
      PRODUCTS[id] = {
        id: id,
        name: card.getAttribute('data-name') || '',
        price: parseInt(card.getAttribute('data-price'), 10) || 0,
        currency: card.getAttribute('data-currency') || 'CAD',
        category: card.getAttribute('data-cat') || '',
        tint: card.getAttribute('data-tint') || 'var(--accent-cream)',
        ink: card.getAttribute('data-ink') || 'var(--primary-color)',
        mediaHTML: mediaEl ? mediaEl.outerHTML : ''
      };
    });
  }

  /* ---- État du panier ---------------------------------------------------- */
  function loadCart() {
    try {
      var data = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
      var clean = {};
      Object.keys(data).forEach(function (id) {
        var q = parseInt(data[id], 10);
        if (PRODUCTS[id] && q > 0) clean[id] = Math.min(99, q);
      });
      return clean;
    } catch (e) { return {}; }
  }
  var cart = {};
  function saveCart() {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cart)); } catch (e) {}
  }
  function totalItems() { return Object.keys(cart).reduce(function (n, id) { return n + cart[id]; }, 0); }
  function subtotal() { return Object.keys(cart).reduce(function (s, id) { return s + (PRODUCTS[id] ? PRODUCTS[id].price * cart[id] : 0); }, 0); }
  function cartCurrency() {
    var ids = Object.keys(cart);
    return ids.length && PRODUCTS[ids[0]] ? PRODUCTS[ids[0]].currency : 'CAD';
  }

  /* ---- Éléments d'interface --------------------------------------------- */
  var overlay = document.querySelector('[data-cart-overlay]');
  var drawer = document.querySelector('[data-cart-drawer]');
  var itemsEl = document.querySelector('[data-cart-items]');
  var footEl = document.querySelector('[data-cart-foot]');
  var subtotalEl = document.querySelector('[data-cart-subtotal]');
  var confirmEl = document.querySelector('[data-cart-confirm]');
  var noteEl = document.querySelector('[data-cart-note]');
  var checkoutBtn = document.querySelector('[data-cart-checkout]');
  var countEls = document.querySelectorAll('[data-cart-count]');

  function updateCount() {
    var n = totalItems();
    Array.prototype.forEach.call(countEls, function (el) {
      el.textContent = String(n);
      if (n > 0) el.removeAttribute('hidden'); else el.setAttribute('hidden', '');
    });
  }

  function renderCart() {
    var ids = Object.keys(cart);
    itemsEl.innerHTML = '';
    if (!ids.length) {
      var empty = document.createElement('div');
      empty.className = 'cart-empty';
      empty.innerHTML = pawSVG(48) +
        '<p><strong>Votre panier est vide.</strong></p>' +
        '<p>Parcourez la boutique et ajoutez vos essentiels de toilettage.</p>';
      itemsEl.appendChild(empty);
      footEl.hidden = true;
      updateCount();
      return;
    }
    ids.forEach(function (id) {
      var p = PRODUCTS[id];
      var qty = cart[id];
      var li = document.createElement('li');
      li.className = 'cart-line';
      li.innerHTML =
        '<span class="cart-line__thumb" style="--tint:' + p.tint + ';--tint-ink:' + p.ink + '">' + p.mediaHTML + '</span>' +
        '<div class="cart-line__info">' +
          '<p class="cart-line__name">' + escapeHtml(p.name) + '</p>' +
          '<p class="cart-line__unit">' + formatMoney(p.price, p.currency) + ' l\u2019unit\u00e9</p>' +
          '<div class="qty-stepper" role="group" aria-label="Quantit\u00e9">' +
            '<button type="button" data-dec="' + id + '" aria-label="Retirer un">\u2212</button>' +
            '<span class="qty-stepper__val" data-qty="' + id + '">' + qty + '</span>' +
            '<button type="button" data-inc="' + id + '" aria-label="Ajouter un">+</button>' +
          '</div>' +
        '</div>' +
        '<div class="cart-line__end">' +
          '<span class="cart-line__price">' + formatMoney(p.price * qty, p.currency) + '</span>' +
          '<button type="button" class="cart-line__remove" data-remove="' + id + '">Retirer</button>' +
        '</div>';
      itemsEl.appendChild(li);
    });
    subtotalEl.textContent = formatMoney(subtotal(), cartCurrency());
    footEl.hidden = false;
    updateCount();
  }

  function addToCart(id) {
    if (!PRODUCTS[id]) return;
    cart[id] = Math.min(99, (cart[id] || 0) + 1);
    saveCart();
    if (confirmEl) confirmEl.hidden = true;
    renderCart();
  }
  function setQty(id, qty) {
    if (qty <= 0) delete cart[id]; else cart[id] = Math.min(99, qty);
    saveCart();
    renderCart();
  }

  /* ---- Ouverture / fermeture du tiroir ---------------------------------- */
  var lastFocus = null;
  function openCart() {
    lastFocus = document.activeElement;
    overlay.setAttribute('data-open', 'true');
    drawer.setAttribute('data-open', 'true');
    drawer.setAttribute('aria-hidden', 'false');
    document.body.setAttribute('data-cart-open', 'true');
    var close = drawer.querySelector('.cart-close');
    if (close) close.focus();
  }
  function closeCart() {
    overlay.setAttribute('data-open', 'false');
    drawer.setAttribute('data-open', 'false');
    drawer.setAttribute('aria-hidden', 'true');
    document.body.setAttribute('data-cart-open', 'false');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  /* ---- Commande --------------------------------------------------------- */
  function checkoutByEmail() {
    var ids = Object.keys(cart);
    if (!ids.length) return;
    var lines = ['Bonjour BOPOIL,', '', 'Je souhaite commander les articles suivants :', ''];
    ids.forEach(function (id) {
      var p = PRODUCTS[id];
      lines.push('- ' + cart[id] + ' \u00d7 ' + p.name + ' (' + formatMoney(p.price, p.currency) + ') = ' + formatMoney(p.price * cart[id], p.currency));
    });
    lines.push('', 'Total : ' + formatMoney(subtotal(), cartCurrency()) + ' (taxes en sus)');
    lines.push('', 'Nom :', 'T\u00e9l\u00e9phone :', 'Cueillette en salon souhait\u00e9e le :', '');
    window.location.href = 'mailto:' + encodeURIComponent(ORDER_EMAIL) +
      '?subject=' + encodeURIComponent('Commande boutique — bopoil.ca') +
      '&body=' + encodeURIComponent(lines.join('\n'));
    if (confirmEl) {
      confirmEl.hidden = false;
      confirmEl.innerHTML = 'Votre client courriel s\u2019ouvre avec le r\u00e9capitulatif pr\u00e9rempli \u2014 ' +
        'il ne reste qu\u2019\u00e0 ajouter vos coordonn\u00e9es et \u00e0 appuyer sur \u00ab Envoyer \u00bb. ' +
        'Vous pouvez aussi nous \u00e9crire \u00e0 <a href="mailto:' + ORDER_EMAIL + '">' + ORDER_EMAIL + '</a> ou passer au salon.';
    }
  }

  function checkoutBySquare() {
    var ids = Object.keys(cart);
    if (!ids.length) return;
    var items = ids.map(function (id) { return { id: id, quantity: cart[id] }; });
    var original = checkoutBtn.textContent;
    checkoutBtn.disabled = true;
    checkoutBtn.textContent = 'Redirection vers Square…';
    if (confirmEl) confirmEl.hidden = true;

    fetch('/api/public/shop/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ items: items })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || !data.url) throw new Error(data.error || 'Le paiement n\u2019a pas pu \u00eatre d\u00e9marr\u00e9.');
        // Square hébergera le paiement; le panier sera vidé au retour (?commande=reussie).
        window.location.href = data.url;
      });
    }).catch(function (error) {
      checkoutBtn.disabled = false;
      checkoutBtn.textContent = original;
      if (confirmEl) {
        confirmEl.hidden = false;
        confirmEl.className = 'cart-confirm cart-confirm--error';
        confirmEl.textContent = error && error.message
          ? error.message
          : 'Le paiement n\u2019a pas pu \u00eatre d\u00e9marr\u00e9. Veuillez r\u00e9essayer ou nous \u00e9crire \u00e0 ' + ORDER_EMAIL + '.';
      }
    });
  }

  function applyCheckoutMode() {
    if (!checkoutBtn) return;
    if (checkoutMode === 'square') {
      checkoutBtn.textContent = 'Payer avec Square';
      if (noteEl) noteEl.textContent = 'Paiement sécurisé par Square. Vous êtes redirigé vers Square pour régler votre commande.';
    } else {
      checkoutBtn.textContent = 'Passer la commande';
      if (noteEl) noteEl.textContent = 'Taxes calculées à la cueillette. Le paiement se fait au salon.';
    }
  }

  /* ---- Filtres par catégorie -------------------------------------------- */
  function initFilters() {
    var filters = document.querySelectorAll('[data-filter]');
    var cards = Array.prototype.slice.call(grid.querySelectorAll('[data-product]'));
    function apply(cat) {
      var shown = 0;
      cards.forEach(function (card) {
        var match = cat === 'tous' || card.getAttribute('data-cat') === cat;
        card.hidden = !match;
        if (match) shown++;
      });
      if (countEl) countEl.textContent = shown + (shown > 1 ? ' produits' : ' produit');
    }
    Array.prototype.forEach.call(filters, function (btn) {
      btn.addEventListener('click', function () {
        Array.prototype.forEach.call(filters, function (b) { b.setAttribute('aria-pressed', 'false'); });
        btn.setAttribute('aria-pressed', 'true');
        apply(btn.getAttribute('data-filter'));
      });
    });
    apply('tous');
  }

  /* ---- Câblage des fiches produit --------------------------------------- */
  function bindAddButtons() {
    Array.prototype.forEach.call(grid.querySelectorAll('[data-add]'), function (btn) {
      btn.addEventListener('click', function () {
        addToCart(btn.getAttribute('data-add'));
        var label = btn.querySelector('.product-card__add-label');
        var original = btn.getAttribute('data-label') || (label ? label.textContent : '');
        btn.setAttribute('data-added', 'true');
        if (label) label.textContent = 'Ajouté ✓';
        window.setTimeout(function () {
          btn.removeAttribute('data-added');
          if (label) label.textContent = original;
        }, 1400);
      });
    });
  }

  function hydrateAndWire() {
    hydrateFromDom();
    bindAddButtons();
    initFilters();
    cart = loadCart();
    renderCart();
    updateCount();
  }

  /* ---- Retour de paiement Square ---------------------------------------- */
  function handleReturn() {
    if (!/[?&]commande=reussie/.test(window.location.search)) return;
    cart = {};
    saveCart();
    renderCart();
    updateCount();
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.className = 'form-status form-status--ok';
      statusEl.textContent = 'Merci! Votre paiement a bien été reçu. Nous préparons votre commande pour la cueillette au salon.';
    }
  }

  /* ---- Chargement du catalogue Square ----------------------------------- */
  function loadCatalog() {
    fetch('/api/public/shop', { headers: { Accept: 'application/json' } })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (!data || !data.configured || !Array.isArray(data.products) || !data.products.length) return;
        // Square est branché : on remplace le catalogue de repli par les
        // produits, prix et images réels du salon, et le paiement passe par Square.
        checkoutMode = 'square';
        renderSquareCatalog(data.products);
        hydrateFromDom();
        bindAddButtons();
        initFilters();
        cart = loadCart();
        renderCart();
        updateCount();
        applyCheckoutMode();
      })
      .catch(function () { /* on garde le catalogue de repli */ });
  }

  function init() {
    // Câblage immédiat sur le catalogue de repli (fonctionne sans réseau).
    hydrateAndWire();
    applyCheckoutMode();

    document.querySelectorAll('[data-cart-open]').forEach(function (b) { b.addEventListener('click', openCart); });
    if (overlay) overlay.addEventListener('click', closeCart);
    document.querySelectorAll('[data-cart-close]').forEach(function (b) { b.addEventListener('click', closeCart); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && drawer.getAttribute('data-open') === 'true') closeCart();
    });

    itemsEl.addEventListener('click', function (e) {
      var t = e.target.closest('button');
      if (!t) return;
      if (t.hasAttribute('data-inc')) setQty(t.getAttribute('data-inc'), cart[t.getAttribute('data-inc')] + 1);
      else if (t.hasAttribute('data-dec')) setQty(t.getAttribute('data-dec'), cart[t.getAttribute('data-dec')] - 1);
      else if (t.hasAttribute('data-remove')) setQty(t.getAttribute('data-remove'), 0);
    });

    if (checkoutBtn) checkoutBtn.addEventListener('click', function () {
      if (checkoutMode === 'square') checkoutBySquare(); else checkoutByEmail();
    });

    handleReturn();
    loadCatalog();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

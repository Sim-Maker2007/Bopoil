/* ==========================================================================
   BOPOIL — Boutique en ligne (panier côté client)
   --------------------------------------------------------------------------
   Aucune dépendance externe. Le catalogue est écrit en HTML dans
   boutique.html (visible sans JavaScript et indexable) ; ce script lit ces
   fiches pour gérer le filtrage par catégorie et le panier.

   Le panier est conservé dans localStorage. À la commande, on ouvre le
   client courriel du visiteur avec le récapitulatif prérempli — la même
   approche « fonctionne dès la mise en ligne, sans compte tiers » que les
   autres formulaires du site (voir js/main.js). Le paiement et la
   confirmation de disponibilité se font ensuite avec le salon (cueillette
   sur place au 38 avenue Gatineau).
   ========================================================================== */

(function () {
  'use strict';

  var STORAGE_KEY = 'bopoil_cart_v1';
  var CONFIG = window.BOPOIL_CONFIG || {};
  var ORDER_EMAIL = (CONFIG.contact && CONFIG.contact.email) || 'info@bopoil.ca';

  var grid = document.querySelector('[data-shop-grid]');
  if (!grid) return;

  var money = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' });

  /* ---- Catalogue : lu depuis le DOM -------------------------------------- */
  var PRODUCTS = {};
  Array.prototype.forEach.call(grid.querySelectorAll('[data-product]'), function (card) {
    var id = card.getAttribute('data-id');
    var iconEl = card.querySelector('.product-card__media svg');
    PRODUCTS[id] = {
      id: id,
      name: card.getAttribute('data-name') || '',
      price: parseInt(card.getAttribute('data-price'), 10) || 0,
      category: card.getAttribute('data-cat') || '',
      tint: card.getAttribute('data-tint') || 'var(--accent-cream)',
      ink: card.getAttribute('data-ink') || 'var(--primary-color)',
      iconHTML: iconEl ? iconEl.outerHTML : ''
    };
  });

  /* ---- État du panier ---------------------------------------------------- */
  function loadCart() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      var data = raw ? JSON.parse(raw) : {};
      var clean = {};
      Object.keys(data).forEach(function (id) {
        var q = parseInt(data[id], 10);
        if (PRODUCTS[id] && q > 0) clean[id] = q;
      });
      return clean;
    } catch (e) { return {}; }
  }

  var cart = loadCart();

  function saveCart() {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cart)); } catch (e) {}
  }

  function totalItems() {
    return Object.keys(cart).reduce(function (n, id) { return n + cart[id]; }, 0);
  }
  function subtotal() {
    return Object.keys(cart).reduce(function (sum, id) {
      return sum + PRODUCTS[id].price * cart[id];
    }, 0);
  }

  /* ---- Éléments d'interface --------------------------------------------- */
  var overlay = document.querySelector('[data-cart-overlay]');
  var drawer = document.querySelector('[data-cart-drawer]');
  var itemsEl = document.querySelector('[data-cart-items]');
  var footEl = document.querySelector('[data-cart-foot]');
  var subtotalEl = document.querySelector('[data-cart-subtotal]');
  var confirmEl = document.querySelector('[data-cart-confirm]');
  var countEls = document.querySelectorAll('[data-cart-count]');

  /* ---- Badge du bouton panier ------------------------------------------- */
  function updateCount() {
    var n = totalItems();
    Array.prototype.forEach.call(countEls, function (el) {
      el.textContent = String(n);
      if (n > 0) el.removeAttribute('hidden'); else el.setAttribute('hidden', '');
    });
  }

  /* ---- Icône SVG « paw » pour le panier vide ---------------------------- */
  function pawSVG(size) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="6.5" cy="10" r="1.8"/><circle cx="10.5" cy="6.5" r="1.8"/>' +
      '<circle cx="14.5" cy="6.5" r="1.8"/><circle cx="18" cy="10.5" r="1.8"/>' +
      '<path d="M8.5 16.5c1-2 2-3 3.5-3s2.5 1 3.5 3c.7 1.4 0 3-1.7 3-1 0-1.3-.4-1.8-.4s-.8.4-1.8.4c-1.7 0-2.4-1.6-1.7-3Z"/></svg>';
  }

  /* ---- Rendu du panier --------------------------------------------------- */
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
        '<span class="cart-line__thumb" style="--tint:' + p.tint + ';--tint-ink:' + p.ink + '">' + p.iconHTML + '</span>' +
        '<div class="cart-line__info">' +
          '<p class="cart-line__name">' + p.name + '</p>' +
          '<p class="cart-line__unit">' + money.format(p.price / 100) + ' l\u2019unit\u00e9</p>' +
          '<div class="qty-stepper" role="group" aria-label="Quantit\u00e9 pour ' + p.name + '">' +
            '<button type="button" data-dec="' + id + '" aria-label="Retirer un">\u2212</button>' +
            '<span class="qty-stepper__val" data-qty="' + id + '">' + qty + '</span>' +
            '<button type="button" data-inc="' + id + '" aria-label="Ajouter un">+</button>' +
          '</div>' +
        '</div>' +
        '<div class="cart-line__end">' +
          '<span class="cart-line__price">' + money.format((p.price * qty) / 100) + '</span>' +
          '<button type="button" class="cart-line__remove" data-remove="' + id + '">Retirer</button>' +
        '</div>';
      itemsEl.appendChild(li);
    });

    subtotalEl.textContent = money.format(subtotal() / 100);
    footEl.hidden = false;
    updateCount();
  }

  /* ---- Mutations --------------------------------------------------------- */
  function addToCart(id, openDrawerAfter) {
    if (!PRODUCTS[id]) return;
    cart[id] = (cart[id] || 0) + 1;
    saveCart();
    if (confirmEl) confirmEl.hidden = true;
    renderCart();
    if (openDrawerAfter) openCart();
  }
  function setQty(id, qty) {
    if (qty <= 0) delete cart[id]; else cart[id] = qty;
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

  /* ---- Commande (récapitulatif par courriel) ---------------------------- */
  function checkout() {
    var ids = Object.keys(cart);
    if (!ids.length) return;
    var lines = ['Bonjour BOPOIL,', '', 'Je souhaite commander les articles suivants :', ''];
    ids.forEach(function (id) {
      var p = PRODUCTS[id];
      lines.push('- ' + cart[id] + ' \u00d7 ' + p.name + ' (' + money.format(p.price / 100) + ') = ' +
        money.format((p.price * cart[id]) / 100));
    });
    lines.push('', 'Total : ' + money.format(subtotal() / 100) + ' (taxes en sus)');
    lines.push('', 'Nom :', 'T\u00e9l\u00e9phone :', 'Cueillette en salon souhait\u00e9e le :', '');
    var body = lines.join('\n');
    var href = 'mailto:' + encodeURIComponent(ORDER_EMAIL) +
      '?subject=' + encodeURIComponent('Commande boutique — bopoil.ca') +
      '&body=' + encodeURIComponent(body);
    window.location.href = href;

    if (confirmEl) {
      confirmEl.hidden = false;
      confirmEl.innerHTML = 'Votre client courriel s\u2019ouvre avec le r\u00e9capitulatif pr\u00e9rempli \u2014 ' +
        'il ne reste qu\u2019\u00e0 ajouter vos coordonn\u00e9es et \u00e0 appuyer sur \u00ab Envoyer \u00bb. ' +
        'Vous pouvez aussi nous \u00e9crire \u00e0 <a href="mailto:' + ORDER_EMAIL + '">' + ORDER_EMAIL + '</a> ' +
        'ou passer au salon. Nous confirmons la disponibilit\u00e9 et le paiement \u00e0 la cueillette.';
    }
  }

  /* ---- Filtres par catégorie -------------------------------------------- */
  function initFilters() {
    var filters = document.querySelectorAll('[data-filter]');
    var countEl = document.querySelector('[data-shop-count]');
    var cards = Array.prototype.slice.call(grid.querySelectorAll('[data-product]'));

    function apply(cat) {
      var shown = 0;
      cards.forEach(function (card) {
        var match = cat === 'tous' || card.getAttribute('data-cat') === cat;
        card.hidden = !match;
        if (match) shown++;
      });
      if (countEl) {
        countEl.textContent = shown + (shown > 1 ? ' produits' : ' produit');
      }
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

  /* ---- Écouteurs --------------------------------------------------------- */
  function init() {
    // Boutons « Ajouter au panier » des fiches produit
    Array.prototype.forEach.call(grid.querySelectorAll('[data-add]'), function (btn) {
      btn.addEventListener('click', function () {
        addToCart(btn.getAttribute('data-add'), false);
        var original = btn.getAttribute('data-label') || btn.textContent;
        btn.setAttribute('data-added', 'true');
        var label = btn.querySelector('.product-card__add-label');
        if (label) label.textContent = 'Ajouté ✓';
        window.setTimeout(function () {
          btn.removeAttribute('data-added');
          if (label) label.textContent = original;
        }, 1400);
      });
    });

    // Ouverture / fermeture
    document.querySelectorAll('[data-cart-open]').forEach(function (b) {
      b.addEventListener('click', openCart);
    });
    if (overlay) overlay.addEventListener('click', closeCart);
    document.querySelectorAll('[data-cart-close]').forEach(function (b) {
      b.addEventListener('click', closeCart);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && drawer.getAttribute('data-open') === 'true') closeCart();
    });

    // Délégation dans la liste du panier
    itemsEl.addEventListener('click', function (e) {
      var t = e.target.closest('button');
      if (!t) return;
      if (t.hasAttribute('data-inc')) setQty(t.getAttribute('data-inc'), cart[t.getAttribute('data-inc')] + 1);
      else if (t.hasAttribute('data-dec')) setQty(t.getAttribute('data-dec'), cart[t.getAttribute('data-dec')] - 1);
      else if (t.hasAttribute('data-remove')) setQty(t.getAttribute('data-remove'), 0);
    });

    var checkoutBtn = document.querySelector('[data-cart-checkout]');
    if (checkoutBtn) checkoutBtn.addEventListener('click', checkout);

    initFilters();
    renderCart();
    updateCount();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

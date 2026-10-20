/* BOPOIL boutique. Live products come from Square; the unconnected catalog is
   an explicitly labelled preview. The cart itself is js/cart.js, on every page. */
(function () {
  'use strict';
  var grid = document.querySelector('[data-shop-grid]');
  var Cart = window.BopoilCart;
  if (!grid || !Cart) return;
  var fallbackHTML = grid.innerHTML;
  var filtersEl = document.querySelector('[data-shop-filters]');
  var fallbackFilters = filtersEl.innerHTML;
  var brandsEl = document.querySelector('[data-shop-brands]');
  var brandField = document.querySelector('[data-shop-brand-field]');
  var countEl = document.querySelector('[data-shop-count]');
  var notice = document.querySelector('[data-catalog-notice]');
  var emptyEl = document.querySelector('[data-shop-empty]');
  var searchEl = document.querySelector('[data-shop-search]');
  var sortEl = document.querySelector('[data-shop-sort]');
  var statusEl = document.querySelector('[data-order-status]');
  var toast = document.querySelector('[data-shop-toast]');
  var productOverlay = document.querySelector('[data-product-overlay]');
  var sheet = document.querySelector('[data-product-sheet]');
  var sheetMedia = document.querySelector('[data-product-media]');
  var sheetCategory = document.querySelector('[data-product-category]');
  var sheetTitle = document.querySelector('[data-product-title]');
  var sheetPrice = document.querySelector('[data-product-price]');
  var sheetOptions = document.querySelector('[data-product-options]');
  var sheetDesc = document.querySelector('[data-product-desc]');
  var sheetQty = document.querySelector('[data-product-qty]');
  var sheetAdd = document.querySelector('[data-product-add]');
  var mode = 'loading';
  var products = Object.create(null);
  // Variation ids of each card, keyed by Square item: a product sold in several
  // colours, sizes or formats is one card with a picker in the product sheet.
  var groups = Object.create(null);
  var cards = [];
  var activeCategory = 'tous';
  var activeBrand = 'toutes';
  var requestedCategory = '';
  // Every brand of the catalog as [slug, name], and the slugs the menu lists now.
  var brandList = [];
  var shownBrands = null;
  var searching = false;
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
  // Square's catch-all category holds most of the store, so it is no use as a filter.
  var HIDDEN_CATEGORIES = ['boutique'];
  // Brands that also get a category card, right after « Tous les produits ».
  var FEATURED_BRANDS = ['lucky-bones'];
  var PLUS = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

  var escapeHtml = Cart.escapeHtml;
  var money = Cart.money;
  var paw = Cart.paw;
  var allowedImageUrl = Cart.allowedImageUrl;
  var imageAttrs = Cart.imageAttrs;
  // How wide each photo is shown, so the browser picks the smallest resized
  // version that fills it (Cart.imageAttrs): a card, the opened product, a tile.
  var CARD_SIZES = '(max-width: 720px) 45vw, (max-width: 1100px) 30vw, 300px';
  var SHEET_SIZES = '(max-width: 860px) 86vw, 420px';
  var TILE_SIZES = '(max-width: 1023px) 25vw, 200px';
  function normalized(value) {
    return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  function slug(value) { return normalized(value).replace(/[^a-z0-9]+/g, '-') || 'boutique'; }
  function reduceMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function chromeHidden(hidden) {
    document.querySelectorAll('[data-shop-chrome]').forEach(function (el) { el.hidden = hidden; });
    brandField.hidden = hidden || !brandList.length;
  }
  function requestedProductId() {
    return new URLSearchParams(window.location.search).get('produit') || '';
  }
  function setProductParam(id, replace) {
    var params = new URLSearchParams(window.location.search);
    if (id) params.set('produit', id); else params.delete('produit');
    var next = window.location.pathname + (params.toString() ? '?' + params.toString() : '') + window.location.hash;
    var current = window.location.pathname + window.location.search + window.location.hash;
    if (next !== current) history[replace ? 'replaceState' : 'pushState']({ produit: id || '' }, '', next);
  }
  function renderProductQty() {
    if (!sheetQty) return;
    sheetQty.textContent = String(productQty);
    var dec = sheet.querySelector('[data-product-dec]');
    var inc = sheet.querySelector('[data-product-inc]');
    if (dec) dec.disabled = productQty <= 1 || Cart.busy();
    if (inc) inc.disabled = productQty >= 99 || Cart.busy();
    if (sheetAdd) sheetAdd.disabled = Cart.busy() || (mode !== 'square' && mode !== 'preview');
  }
  function variantsOf(id) {
    return groups[products[id].group] || [id];
  }
  function optionValue(id, name) {
    var option = products[id].options.find(function (o) { return o.name === name; });
    return option ? option.value : '';
  }
  // The variation with this choice that keeps as many of the current other choices as possible.
  function pickVariant(id, name, value) {
    var best = '';
    var bestScore = -1;
    variantsOf(id).forEach(function (candidate) {
      if (optionValue(candidate, name) !== value) return;
      var score = products[candidate].options.filter(function (o) { return o.name !== name && optionValue(id, o.name) === o.value; }).length;
      if (score > bestScore) { best = candidate; bestScore = score; }
    });
    return best;
  }
  function swatchAttr(swatch) {
    if (swatch === 'camo') return ' data-swatch="camo"';
    return /^#[0-9a-f]{6}$/i.test(swatch || '') ? ' style="--swatch:' + swatch + '"' : '';
  }
  // One row per choice (Couleur, Taille, Format…). Colours are round swatches when
  // each value has its own colour; anything else is a row of toggles. A value
  // that does not exist with the other current choices is struck through, and
  // picking it switches the other choices to a variation that has it.
  function optionsHTML(id) {
    var ids = variantsOf(id);
    if (ids.length < 2) return '';
    var names = [];
    ids.forEach(function (vid) {
      products[vid].options.forEach(function (o) { if (names.indexOf(o.name) === -1) names.push(o.name); });
    });
    return names.map(function (name) {
      var values = [];
      ids.forEach(function (vid) {
        var option = products[vid].options.find(function (o) { return o.name === name; });
        if (option && !values.some(function (v) { return v.value === option.value; })) values.push(option);
      });
      var swatches = values.map(function (v) { return v.swatch; });
      var asSwatches = swatches.every(Boolean) && swatches.every(function (sw, i) { return swatches.indexOf(sw) === i; });
      var current = optionValue(id, name);
      return '<fieldset class="product-option"><legend>' + escapeHtml(name) + ' : <strong>' + escapeHtml(current) + '</strong></legend><div class="product-option__values">' +
        values.map(function (v) {
          var target = pickVariant(id, name, v.value);
          var exact = products[target].options.every(function (o) { return o.name === name || optionValue(id, o.name) === o.value; });
          var label = escapeHtml(v.value) + (exact ? '' : ', offert avec un autre choix');
          var attrs = ' type="button" data-option-name="' + escapeHtml(name) + '" data-option-value="' + escapeHtml(v.value) + '" aria-pressed="' + (v.value === current) + '"' + (exact ? '' : ' data-unavailable="true"');
          return asSwatches
            ? '<button class="product-option__swatch"' + attrs + swatchAttr(v.swatch) + ' aria-label="' + label + '" title="' + escapeHtml(v.value) + '"></button>'
            : '<button class="product-option__pill"' + attrs + (exact ? '' : ' aria-label="' + label + '"') + '>' + (v.swatch ? '<span class="product-option__dot"' + swatchAttr(v.swatch) + '></span>' : '') + escapeHtml(v.value) + '</button>';
        }).join('') + '</div></fieldset>';
    }).join('');
  }
  function fillProductSheet(id, keepQty) {
    var p = products[id];
    if (!p || !sheet) return false;
    openProductId = id;
    if (!keepQty) productQty = 1;
    sheetMedia.innerHTML = galleryHTML(p);
    sheetCategory.textContent = p.category || '';
    sheetTitle.textContent = variantsOf(id).length > 1 ? p.itemName : p.name;
    sheetPrice.textContent = money(p.price, p.currency);
    sheetOptions.innerHTML = optionsHTML(id);
    sheetOptions.hidden = !sheetOptions.innerHTML;
    sheetDesc.textContent = p.description || 'Demandez conseil à l’équipe du salon pour les détails de ce produit.';
    sheetAdd.dataset.add = id;
    renderProductQty();
    return true;
  }
  function selectOption(name, value) {
    var id = pickVariant(openProductId, name, value);
    if (!id || id === openProductId) return;
    fillProductSheet(id, true);
    setProductParam(id, true);
    var again = Array.prototype.find.call(sheetOptions.querySelectorAll('[data-option-name]'), function (el) {
      return el.dataset.optionName === name && el.dataset.optionValue === value;
    });
    if (again) again.focus();
  }
  function galleryHTML(p) {
    var urls = (p.images || []).filter(allowedImageUrl);
    if (!urls.length) return p.media || paw();
    var thumbs = urls.length > 1
      ? '<div class="product-sheet__thumbs" role="tablist" aria-label="Photos du produit">' + urls.map(function (url, index) {
        return '<button class="product-sheet__thumb" type="button" role="tab" data-sheet-image="' + index + '" aria-selected="' + (index === 0 ? 'true' : 'false') + '" aria-label="Photo ' + (index + 1) + ' sur ' + urls.length + '"><img' + imageAttrs(url, [256]) + ' alt=""></button>';
      }).join('') + '</div>'
      : '';
    return sheetMainHTML(urls[0], p.name) + thumbs;
  }
  function sheetMainHTML(url, name) {
    return '<img' + imageAttrs(url, [640, 1080], SHEET_SIZES) + ' alt="' + escapeHtml(name) + '" data-sheet-main>';
  }
  function setSheetImage(index) {
    var p = products[openProductId];
    if (!p || !p.images || !p.images[index] || !sheet) return;
    var main = sheet.querySelector('[data-sheet-main]');
    if (main) main.outerHTML = sheetMainHTML(p.images[index], p.name);
    sheet.querySelectorAll('[data-sheet-image]').forEach(function (btn) {
      btn.setAttribute('aria-selected', String(Number(btn.dataset.sheetImage) === index));
    });
  }
  function openProduct(id, opts) {
    if (!products[id] || !sheet) return;
    if (sheet.dataset.open === 'true') {
      fillProductSheet(id);
      if (!opts || opts.updateUrl !== false) setProductParam(id, true);
      return;
    }
    if (Cart.isOpen()) Cart.close({ restore: false });
    if (!fillProductSheet(id)) return;
    if (!opts || opts.updateUrl !== false) setProductParam(id);
    toast.hidden = true;
    productOverlay.dataset.open = 'true';
    sheet.dataset.open = 'true';
    sheet.inert = false;
    sheet.setAttribute('aria-hidden', 'false');
    document.body.dataset.productOpen = 'true';
    Cart.lockPage([productOverlay, sheet, toast]);
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
    Cart.unlockPage(!opts || opts.restore !== false);
  }
  function syncProductFromUrl() {
    var id = requestedProductId();
    if (id && products[id]) {
      if (openProductId !== id) openProduct(id, { updateUrl: false });
      return;
    }
    if (sheet && sheet.dataset.open === 'true') closeProduct({ updateUrl: false });
  }
  // A brand's category card (FEATURED_BRANDS) holds every product of that brand.
  function inActiveCategory(card) {
    return activeCategory === 'tous' || (card.dataset.cat || '').split(' ').indexOf(activeCategory) !== -1 ||
      cardBrands(card).indexOf(activeCategory) !== -1;
  }
  function cardBrands(card) {
    return (card.dataset.brand || '').split(' ').filter(Boolean);
  }
  // Words without accents or capitals: « Gâteries Chiens » → gateries, chiens.
  function words(value) {
    return normalized(value).split(/[^a-z0-9]+/).filter(Boolean);
  }
  // Little words are left out of a search that has others, so « brosse pour
  // chien » finds what « brosse chien » finds.
  var STOP_WORDS = ['a', 'au', 'aux', 'avec', 'd', 'de', 'des', 'du', 'en', 'et', 'l', 'la', 'le', 'les', 'pour', 'sur', 'un', 'une'];
  function searchTokens(value) {
    var tokens = words(value);
    var meaningful = tokens.filter(function (t) { return STOP_WORDS.indexOf(t) === -1; });
    return meaningful.length ? meaningful : tokens;
  }
  // Where a word is found decides how high the product ranks: its name first,
  // then its colours and sizes, its brand, its category and its description.
  var SEARCH_FIELDS = [['name', 8], ['variants', 5], ['brand', 4], ['cat', 2], ['desc', 1]];
  var searchIndex = new WeakMap();
  function cardWords(card) {
    var fields = searchIndex.get(card);
    if (!fields) {
      fields = SEARCH_FIELDS.map(function (field) { return { words: words(card.dataset[field[0]]), weight: field[1] }; });
      searchIndex.set(card, fields);
    }
    return fields;
  }
  // 0 unless every word of the search is in the product. A whole word counts
  // most, then the start of a word; a long search word may also sit inside a
  // word (« poil » in « antipoils »), a short one may not (« os » in « cosmétiques »).
  function searchScore(card, tokens) {
    var fields = cardWords(card);
    var total = 0;
    for (var i = 0; i < tokens.length; i++) {
      var token = tokens[i];
      var best = 0;
      fields.forEach(function (field) {
        field.words.forEach(function (word) {
          var at = word.indexOf(token);
          var quality = word === token ? 3 : at === 0 ? 2 : at > 0 && token.length > 3 ? 1 : 0;
          best = Math.max(best, quality * field.weight);
        });
      });
      if (!best) return 0;
      total += best;
    }
    return total;
  }
  function filterProducts() {
    if (mode !== 'square' && mode !== 'preview') return;
    var tokens = searchTokens(searchEl.value);
    // Starting a search puts the best matches first, unless the shopper chose
    // a price order; clearing it goes back to the names.
    if (tokens.length && !searching && sortEl.value === 'name') sortEl.value = 'relevance';
    if (!tokens.length && searching && sortEl.value === 'relevance') sortEl.value = 'name';
    searching = tokens.length > 0;
    var scores = new Map();
    if (searching) cards.forEach(function (card) { scores.set(card, searchScore(card, tokens)); });
    var sorted = cards.slice();
    if (sortEl.value === 'price-asc') sorted.sort(function (a, b) { return Number(a.dataset.price) - Number(b.dataset.price); });
    if (sortEl.value === 'price-desc') sorted.sort(function (a, b) { return Number(b.dataset.price) - Number(a.dataset.price); });
    // A leading mark such as « *SAFARI » must not put a product ahead of the A's.
    if (sortEl.value === 'name' || sortEl.value === 'relevance') sorted.sort(function (a, b) { return a.dataset.name.localeCompare(b.dataset.name, 'fr', { ignorePunctuation: true }); });
    // Equal scores keep the alphabetical order (the sort is stable).
    if (sortEl.value === 'relevance' && searching) sorted.sort(function (a, b) { return scores.get(b) - scores.get(a); });
    // The brand menu lists only the brands found in the chosen category.
    var available = Object.create(null);
    cards.forEach(function (card) {
      if (inActiveCategory(card)) cardBrands(card).forEach(function (brand) { available[brand] = true; });
    });
    if (!available[activeBrand]) activeBrand = 'toutes';
    var count = 0;
    var shown = 0;
    sorted.forEach(function (card) {
      var inBrand = activeBrand === 'toutes' || cardBrands(card).indexOf(activeBrand) !== -1;
      var match = inActiveCategory(card) && inBrand && (!searching || scores.get(card) > 0);
      card.hidden = !match;
      if (match) {
        card.style.setProperty('--i', String(shown));
        count++;
        shown++;
      }
      grid.appendChild(card);
    });
    filtersEl.querySelectorAll('[data-filter]').forEach(function (el) { el.setAttribute('aria-pressed', String(el.dataset.filter === activeCategory)); });
    // iOS Safari ignores hidden options, so the menu is rebuilt when its brands change.
    var listed = brandList.filter(function (entry) { return available[entry[0]]; });
    var key = listed.map(function (entry) { return entry[0]; }).join(' ');
    if (key !== shownBrands) {
      shownBrands = key;
      brandsEl.innerHTML = '<option value="toutes">Toutes les marques</option>' + listed.map(function (entry) {
        return '<option value="' + escapeHtml(entry[0]) + '">' + escapeHtml(entry[1].toLocaleUpperCase('fr')) + '</option>';
      }).join('');
    }
    brandsEl.value = activeBrand;
    countEl.textContent = count + (count > 1 ? ' produits' : ' produit');
    emptyEl.hidden = count !== 0 || mode === 'error' || !cards.length;
  }
  // On phones and tablets the categories are a swipeable row: bring a
  // half-hidden category fully into view.
  function revealFilter(list, btn) {
    if (!btn || list.scrollWidth <= list.clientWidth) return;
    var row = list.getBoundingClientRect();
    var box = btn.getBoundingClientRect();
    if (box.left >= row.left + 24 && box.right <= row.right - 24) return;
    list.scrollBy({ left: box.left - row.left - (row.width - box.width) / 2, behavior: reduceMotion() ? 'auto' : 'smooth' });
  }
  function cardHTML(p, index) {
    var id = escapeHtml(p.id);
    var name = escapeHtml(p.name);
    var badge = p.category ? '<span class="product-card__badge">' + escapeHtml(p.category) + '</span>' : '';
    var cat = escapeHtml(p.cat || slug(p.category));
    var desc = escapeHtml(p.description || '');
    var images = (p.imageUrls || []).filter(allowedImageUrl);
    var image = p.imageHtml || paw();
    var dots = images.length > 1
      ? '<span class="product-card__dots" aria-hidden="true">' + images.map(function (_, index) { return '<i' + (index === 0 ? ' data-active="true"' : '') + '></i>'; }).join('') + '</span>'
      : '';
    var quick = p.choices
      ? '<button class="product-card__quick" type="button" data-open-product="' + id + '" aria-haspopup="dialog" aria-controls="product-sheet" aria-label="Choisir les options : ' + name + '">' + PLUS + '</button>'
      : '<button class="product-card__quick" type="button" data-add="' + id + '" aria-label="Ajouter au panier : ' + name + '">' + PLUS + '</button>';
    return '<article class="product-card" style="--i:' + index + (p.tint ? ';--tint:' + escapeHtml(p.tint) + ';--tint-ink:' + escapeHtml(p.ink || '') : '') + '" data-product data-id="' + id + '" data-name="' + name + '" data-price="' + p.priceCents + '" data-currency="' + escapeHtml(p.currency || 'CAD') + '" data-cat="' + cat + '" data-brand="' + escapeHtml(p.brand || '') + '" data-variants="' + escapeHtml(p.variants || '') + '" data-desc="' + desc + '" data-images="' + escapeHtml(images.join('|')) + '">' +
      '<button class="product-card__hit" type="button" data-open-product="' + id + '" aria-haspopup="dialog" aria-controls="product-sheet" aria-label="Voir le produit : ' + name + '">' +
        '<span class="product-card__media">' +
          badge + image + dots +
          '<span class="product-card__view">Voir le produit</span>' +
        '</span>' +
        '<span class="product-card__body">' +
          '<span class="product-card__title">' + name + '</span>' +
          '<span class="product-card__price">' + (p.fromPrice ? '<span class="product-card__from">À partir de</span> ' : '') + money(p.priceCents, p.currency) + '</span>' +
          (p.choices || '') +
        '</span>' +
      '</button>' +
      quick +
    '</article>';
  }
  function renderFilters(categories, photos, brands) {
    var html = '<li><button class="shop-cat shop-cat--all" type="button" data-filter="tous" aria-pressed="true"><span class="shop-cat__label">Tous les produits</span></button></li>';
    var i = 0;
    // Each card shows the photo set on the category in Square; a category without
    // one (or whose photo fails to load) gets one of the salon photos instead.
    function addTile(key, name) {
      var fallback = CAT_PHOTOS[i++ % CAT_PHOTOS.length];
      var photo = photos[key] || fallback;
      html += '<li><button class="shop-cat" type="button" data-filter="' + escapeHtml(key) + '" aria-pressed="false">' +
        '<span class="shop-cat__media"><img' + imageAttrs(photo, [256, 384], TILE_SIZES) + (photo !== fallback ? ' data-fallback="' + fallback + '"' : '') + ' alt="" width="480" height="360" loading="lazy" decoding="async"></span>' +
        '<span class="shop-cat__label">' + escapeHtml(name) + '</span></button></li>';
    }
    FEATURED_BRANDS.forEach(function (key) { if (brands.has(key)) addTile(key, brands.get(key)); });
    // Entries are [slug, Square category name], listed alphabetically like the Square dashboard.
    // A category named after a brand is offered in the brand menu instead.
    Array.from(categories).filter(function (entry) {
      return HIDDEN_CATEGORIES.indexOf(entry[0]) === -1 && !brands.has(entry[0]);
    }).sort(function (a, b) { return a[1].localeCompare(b[1], 'fr'); }).forEach(function (entry) {
      addTile(entry[0], entry[1]);
    });
    filtersEl.innerHTML = html;
    filtersEl.querySelectorAll('img[data-fallback]').forEach(function (img) {
      img.addEventListener('error', function () { img.src = img.dataset.fallback; img.removeAttribute('data-fallback'); }, { once: true });
    });
  }
  // Entries are [slug, brand name]; no brands (the preview catalog) leaves the menu out.
  function renderBrands(brands) {
    brandList = Array.from(brands).sort(function (a, b) { return a[1].localeCompare(b[1], 'fr', { sensitivity: 'base' }); });
    shownBrands = null;
  }
  // Square products arrive already described (known); the preview cards are read from the page.
  function hydrate(known) {
    products = known || Object.create(null);
    if (!known) groups = Object.create(null);
    cards = Array.prototype.slice.call(grid.querySelectorAll('[data-product]'));
    cards.forEach(function (card, index) {
      var media = card.querySelector('.product-card__media > svg, .product-card__media > img');
      var badge = card.querySelector('.product-card__badge');
      if (!products[card.dataset.id]) {
        products[card.dataset.id] = {
          name: card.dataset.name,
          itemName: card.dataset.name,
          price: Number(card.dataset.price),
          currency: card.dataset.currency || 'CAD',
          media: media ? media.outerHTML : paw(),
          images: (card.dataset.images || '').split('|').filter(Boolean),
          description: card.dataset.desc || '',
          category: badge ? badge.textContent.trim() : '',
          options: [],
          group: card.dataset.id
        };
        groups[card.dataset.id] = [card.dataset.id];
      }
      card.style.setProperty('--i', String(index));
      var btn = card.querySelector('[data-add]');
      if (btn) {
        btn.disabled = false;
        btn.setAttribute('aria-label', 'Ajouter au panier : ' + card.dataset.name);
      }
    });
    Cart.load(mode, products);
    filterProducts();
    syncProductFromUrl();
  }
  function renderSquareCatalog(list, categoryList) {
    var categories = new Map();
    var brands = new Map();
    var photos = Object.create(null);
    categoryList.forEach(function (c) {
      var key = c && slug(c.name);
      if (key && !photos[key] && /^https:\/\//i.test(c.imageUrl || '')) photos[key] = c.imageUrl;
    });
    var known = Object.create(null);
    var members = Object.create(null);
    var order = [];
    list.forEach(function (p) {
      var key = p.itemId || p.id;
      if (!members[key]) { members[key] = []; order.push(key); }
      members[key].push(p);
    });
    groups = Object.create(null);
    grid.innerHTML = order.map(function (key, index) {
      var variants = members[key];
      var p = variants[0];
      var several = variants.length > 1;
      // A product is listed under every Square category it belongs to.
      var names = Array.isArray(p.categories) && p.categories.length ? p.categories : [p.category];
      // The badge names the item's first category other than the catch-all; an
      // item filed only under it gets none rather than « Boutique ».
      var shownCategory = names.find(function (name) { return HIDDEN_CATEGORIES.indexOf(slug(name)) === -1; }) || '';
      var slugs = names.map(function (name) {
        var key = slug(name);
        categories.set(key, name);
        return key;
      });
      var brandSlugs = (Array.isArray(p.brands) ? p.brands : []).map(function (name) {
        var key = slug(name);
        brands.set(key, name);
        return key;
      });
      var title = several ? p.itemName || p.name : p.name;
      var cardUrls = [];
      groups[key] = variants.map(function (v) {
        var urls = (Array.isArray(v.imageUrls) ? v.imageUrls : (v.imageUrl ? [v.imageUrl] : [])).filter(allowedImageUrl);
        if (!cardUrls.length) cardUrls = urls;
        known[v.id] = {
          name: v.name,
          itemName: title,
          price: v.priceCents,
          currency: v.currency || 'CAD',
          media: urls[0] ? '<img' + imageAttrs(urls[0], [256]) + ' alt="">' : paw(),
          images: urls,
          description: v.description || '',
          category: shownCategory,
          options: several && Array.isArray(v.options) ? v.options : [],
          group: key
        };
        return v.id;
      });
      var prices = variants.map(function (v) { return v.priceCents; });
      var image = cardUrls[0] ? '<img' + imageAttrs(cardUrls[0], [384, 640], CARD_SIZES) + ' alt="' + escapeHtml(title) + '" loading="lazy" decoding="async">' : paw();
      return cardHTML({
        id: p.id,
        name: title,
        description: p.description || '',
        priceCents: Math.min.apply(null, prices),
        fromPrice: Math.min.apply(null, prices) !== Math.max.apply(null, prices),
        currency: p.currency,
        category: shownCategory,
        cat: slugs.join(' '),
        brand: brandSlugs.join(' '),
        variants: several ? variants.map(function (v) { return v.variation || ''; }).join(' ') : '',
        choices: several ? choicesHTML(groups[key], known) : '',
        imageHtml: image,
        imageUrls: cardUrls
      }, index);
    }).join('');
    renderFilters(categories, photos, brands);
    renderBrands(brands);
    grid.querySelectorAll('.product-card__media img').forEach(function (img) {
      img.addEventListener('error', function () { img.outerHTML = paw(); });
    });
    return known;
  }
  // « 3 couleurs · 2 tailles » under the price of a card that groups variations,
  // with the colours as small dots.
  function choicesHTML(ids, known) {
    var counts = [];
    var dots = [];
    ids.forEach(function (id) {
      known[id].options.forEach(function (o) {
        var entry = counts.find(function (c) { return c.name === o.name; });
        if (!entry) counts.push(entry = { name: o.name, values: [] });
        if (entry.values.indexOf(o.value) !== -1) return;
        entry.values.push(o.value);
        if (o.swatch && dots.length < 6 && dots.indexOf(o.swatch) === -1) dots.push(o.swatch);
      });
    });
    var text = counts.map(function (c) {
      var word = c.name.toLowerCase();
      return c.values.length + ' ' + (c.values.length > 1 && !/[sxz]$/.test(word) ? word + 's' : word);
    }).join(' · ');
    return '<span class="product-card__choices">' + dots.map(function (sw) { return '<i' + swatchAttr(sw) + '></i>'; }).join('') + escapeHtml(text) + '</span>';
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
    if (mode !== 'square' && mode !== 'preview') return;
    if (Cart.add(id, qty) && btn) markAdded(btn);
  }
  async function loadCatalog() {
    mode = 'loading';
    grid.setAttribute('aria-busy', 'true');
    notice.textContent = 'Chargement de la boutique…';
    grid.querySelectorAll('[data-add]').forEach(function (btn) { btn.disabled = true; });
    try {
      var res = await fetch('/api/public/shop', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
      if (!res.ok) throw new Error('catalog');
      var data = await res.json();
      if (!data || data.error || typeof data.configured !== 'boolean' || !Array.isArray(data.products)) throw new Error('catalog');
      activeCategory = 'tous';
      activeBrand = 'toutes';
      var known = null;
      if (data.configured) {
        mode = 'square';
        known = renderSquareCatalog(data.products, Array.isArray(data.categories) ? data.categories : []);
        if (requestedCategory && filtersEl.querySelector('[data-filter="' + CSS.escape(requestedCategory) + '"]')) activeCategory = requestedCategory;
        notice.innerHTML = data.products.length ? 'Paiement sécurisé avec Square · Cueillette au 38 avenue Gatineau<br>Notre équipe communiquera avec vous lorsque votre commande sera prête à ramasser au salon. Livraison disponible sur demande.' : 'La boutique se prépare. Aucun produit n’est disponible en ligne pour le moment. Contactez le salon pour être conseillé.';
      } else {
        mode = 'preview';
        grid.innerHTML = fallbackHTML;
        filtersEl.innerHTML = fallbackFilters;
        renderBrands(new Map());
        notice.textContent = 'Aperçu de la boutique — produits et prix à confirmer. Vous pouvez essayer le panier; les commandes en ligne ne sont pas encore ouvertes.';
      }
      grid.hidden = false;
      hydrate(known);
    } catch (e) {
      mode = 'error';
      grid.hidden = true;
      emptyEl.hidden = true;
      countEl.textContent = 'Catalogue indisponible';
      notice.innerHTML = 'La boutique est temporairement indisponible. Votre panier enregistré est conservé.<button type="button" data-catalog-retry>Réessayer</button>';
      closeProduct({ restore: false, updateUrl: false });
    } finally {
      chromeHidden(mode === 'error' || !cards.length);
      grid.setAttribute('aria-busy', 'false');
      if (activeCategory !== 'tous') revealFilter(filtersEl, filtersEl.querySelector('[aria-pressed="true"]'));
    }
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
    if (btn.hasAttribute('data-product-close')) closeProduct();
    if (btn.hasAttribute('data-sheet-image')) { setSheetImage(Number(btn.dataset.sheetImage)); return; }
    if (btn.hasAttribute('data-option-name')) { selectOption(btn.dataset.optionName, btn.dataset.optionValue); return; }
    if (btn.hasAttribute('data-catalog-retry')) loadCatalog();
    if (btn.hasAttribute('data-add')) addToCart(btn.dataset.add, btn.hasAttribute('data-product-add') ? productQty : 1, btn);
    if (btn.hasAttribute('data-product-inc')) { productQty = Math.min(99, productQty + 1); renderProductQty(); }
    if (btn.hasAttribute('data-product-dec')) { productQty = Math.max(1, productQty - 1); renderProductQty(); }
    if (btn.hasAttribute('data-filter')) { activeCategory = btn.dataset.filter; filterProducts(); revealFilter(filtersEl, btn); }
    if (btn.hasAttribute('data-shop-reset')) { activeCategory = 'tous'; activeBrand = 'toutes'; searchEl.value = ''; sortEl.value = 'name'; filterProducts(); revealFilter(filtersEl, filtersEl.querySelector('[data-filter="tous"]')); searchEl.focus(); }
  });
  productOverlay.addEventListener('click', function () { closeProduct(); });
  sheet.addEventListener('click', function (e) { if (e.target === sheet) closeProduct(); });
  document.addEventListener('keydown', function (e) {
    // The cart (js/cart.js) handles its own drawer.
    if (Cart.isOpen()) return;
    if (e.key === 'Escape') {
      if (sheet.dataset.open === 'true') closeProduct();
      return;
    }
    if (sheet.dataset.open === 'true' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      var p = products[openProductId];
      var total = p && p.images ? p.images.length : 0;
      if (total > 1) {
        e.preventDefault();
        var current = Array.prototype.findIndex.call(sheet.querySelectorAll('[data-sheet-image]'), function (btn) { return btn.getAttribute('aria-selected') === 'true'; });
        if (current < 0) current = 0;
        setSheetImage((current + (e.key === 'ArrowRight' ? 1 : total - 1)) % total);
      }
      return;
    }
    if (e.key === 'Tab' && sheet.dataset.open === 'true') Cart.trapTab(e, sheet);
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
  brandsEl.addEventListener('change', function () { activeBrand = brandsEl.value; filterProducts(); });
  window.addEventListener('popstate', syncProductFromUrl);
  document.addEventListener('bopoil:cart-busy', renderProductQty);
  document.addEventListener('bopoil:cart-opening', function () { if (sheet.dataset.open === 'true') closeProduct({ restore: false }); });
  var params = new URLSearchParams(window.location.search);
  // The Lucky Bones page links to « boutique.html?categorie=lucky-bones »: the
  // store opens on that category, then the address drops it.
  requestedCategory = params.get('categorie') || '';
  params.delete('categorie');
  if (params.has('commande')) {
    statusEl.hidden = false;
    statusEl.textContent = 'De retour de Square ? Consultez votre reçu Square pour confirmer le paiement. Votre panier est conservé; ne payez pas une seconde fois si vous avez déjà reçu un reçu.';
    params.delete('commande');
  }
  if (params.toString() !== window.location.search.replace(/^\?/, '')) {
    history.replaceState(null, '', window.location.pathname + (params.size ? '?' + params.toString() : '') + window.location.hash);
  }
  loadCatalog();
})();

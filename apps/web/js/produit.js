/* BOPOIL product page (/boutique/produit/…). The server renders the whole page
   for search engines (apps/coat-care/lib/shop-pages.ts), including each
   variation's price and choices; this script switches variations and photos
   and adds the product to the cart (js/cart.js). */
(function () {
  'use strict';
  var page = document.querySelector('[data-product-page]');
  var dataEl = document.querySelector('[data-product-json]');
  var Cart = window.BopoilCart;
  if (!page || !dataEl || !Cart || !Cart.know) return;
  var data;
  try { data = JSON.parse(dataEl.textContent); } catch (e) { return; }
  if (!data || !data.variants || !data.variants[data.current]) return;
  var gallery = page.querySelector('[data-product-gallery]');
  var priceEl = page.querySelector('[data-product-price]');
  var optionsEl = page.querySelector('[data-product-options]');
  var qtyEl = page.querySelector('[data-product-qty]');
  var dec = page.querySelector('[data-product-dec]');
  var inc = page.querySelector('[data-product-inc]');
  var add = page.querySelector('[data-product-add]');
  var GALLERY_SIZES = '(max-width: 860px) 92vw, 560px';
  var current = data.current;
  var qty = 1;
  var shownImage = 0;

  // What the cart shows for each variation: name, price and first photo.
  var known = Object.create(null);
  Object.keys(data.variants).forEach(function (id) {
    var v = data.variants[id];
    var images = (v.images || []).filter(Cart.allowedImageUrl);
    known[id] = {
      name: v.name,
      price: v.price,
      currency: v.currency || 'CAD',
      images: images,
      media: images[0] ? '<img' + Cart.imageAttrs(images[0], [256]) + ' alt="">' : Cart.paw()
    };
  });
  Cart.know('square', known);

  function render() {
    var busy = Cart.busy();
    qtyEl.textContent = String(qty);
    dec.disabled = qty <= 1 || busy;
    inc.disabled = qty >= 99 || busy;
    add.disabled = busy;
  }
  function mainImage(url) {
    return '<img' + Cart.imageAttrs(url, [640, 1080], GALLERY_SIZES) + ' alt="' + Cart.escapeHtml(data.name) + '" width="1080" height="1080" data-gallery-main>';
  }
  function renderGallery() {
    var images = known[current].images;
    shownImage = 0;
    if (!images.length) { gallery.innerHTML = Cart.paw(); return; }
    gallery.innerHTML = mainImage(images[0]) + (images.length > 1
      ? '<div class="product-sheet__thumbs" role="tablist" aria-label="Photos du produit">' + images.map(function (url, index) {
        return '<button class="product-sheet__thumb" type="button" role="tab" data-gallery-image="' + index + '" aria-selected="' + (index === 0) + '" aria-label="Photo ' + (index + 1) + ' sur ' + images.length + '"><img' + Cart.imageAttrs(url, [256]) + ' alt=""></button>';
      }).join('') + '</div>'
      : '');
  }
  function showImage(index) {
    var images = known[current].images;
    var main = gallery.querySelector('[data-gallery-main]');
    if (!images[index] || !main) return;
    shownImage = index;
    main.outerHTML = mainImage(images[index]);
    gallery.querySelectorAll('[data-gallery-image]').forEach(function (btn) {
      btn.setAttribute('aria-selected', String(Number(btn.dataset.galleryImage) === index));
    });
  }
  // The chosen variation's price, choices and photos; the address names it,
  // so a shared link opens on it.
  function selectVariant(id, name, value) {
    if (!data.variants[id] || id === current) return;
    var samePhotos = known[id].images.join('|') === known[current].images.join('|');
    current = id;
    priceEl.innerHTML = data.variants[id].priceHtml;
    if (optionsEl) {
      optionsEl.innerHTML = data.variants[id].optionsHtml;
      var again = Array.prototype.find.call(optionsEl.querySelectorAll('[data-option-name]'), function (el) {
        return el.dataset.optionName === name && el.dataset.optionValue === value;
      });
      if (again) again.focus();
    }
    if (!samePhotos) renderGallery();
    add.dataset.variant = id;
    try { history.replaceState(null, '', window.location.pathname + '?variante=' + encodeURIComponent(id) + window.location.hash); } catch (e) { /* The address is a convenience. */ }
  }
  function markAdded() {
    var label = add.querySelector('.product-card__add-label');
    add.dataset.added = 'true';
    if (label) label.textContent = 'Ajouté ✓';
    setTimeout(function () {
      delete add.dataset.added;
      if (label) label.textContent = 'Ajouter au panier';
    }, 1400);
  }

  page.addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn || !page.contains(btn)) return;
    if (btn.hasAttribute('data-variant') && btn.hasAttribute('data-option-name')) selectVariant(btn.dataset.variant, btn.dataset.optionName, btn.dataset.optionValue);
    else if (btn.hasAttribute('data-gallery-image')) showImage(Number(btn.dataset.galleryImage));
    else if (btn.hasAttribute('data-product-inc')) { qty = Math.min(99, qty + 1); render(); }
    else if (btn.hasAttribute('data-product-dec')) { qty = Math.max(1, qty - 1); render(); }
    else if (btn.hasAttribute('data-product-add') && Cart.add(current, qty)) markAdded();
  });
  gallery.addEventListener('keydown', function (e) {
    var total = known[current].images.length;
    if (total < 2 || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') || !e.target.closest('[data-gallery-image]')) return;
    e.preventDefault();
    showImage((shownImage + (e.key === 'ArrowRight' ? 1 : total - 1)) % total);
    var selected = gallery.querySelector('[data-gallery-image][aria-selected="true"]');
    if (selected) selected.focus();
  });
  document.addEventListener('bopoil:cart-busy', render);
  render();
})();

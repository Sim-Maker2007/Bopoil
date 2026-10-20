/* BOPOIL — calculateur de ration Lucky Bones (lucky-bones.html).
   Même calcul que celui de Distribution Lucky Bones : la ration quotidienne
   est un pourcentage du poids de l'animal (le profil choisi), servie en
   galettes de 227 g, 20 galettes par sac de 10 lb, sur 30 jours, TPS et TVQ
   en sus, deux repas par jour. Le prix de chaque recette vient du catalogue
   Square de la boutique; sans catalogue (boutique masquée, réseau), le
   calculateur donne la ration sans le budget. */
(function () {
  'use strict';
  var form = document.querySelector('[data-lb-calc]');
  if (!form) return;

  var PATTY_G = 227;
  var PATTIES_PER_BAG = 20;
  var DAYS = 30;
  var MEALS = 2;
  // 454 g par livre, comme le calculateur Lucky Bones (une galette de ½ lb : 227 g).
  var G_PER_LB = 454;
  var MAX_LB = 250;
  var TPS = 0.05;
  var TVQ = 0.09975;
  var MAX_ICONS = 12;
  // Les sacs de 10 lb du catalogue Square (« LB-C Sac Viking 10 lbs »).
  var RECIPES = {
    viking: /\bsac\s+viking\b/i,
    mechoui: /\bsac\s+m[ée]choui\b/i,
    'rock-o-rico': /\bsac\s+rock-o-ri/i
  };
  var prices = {};

  var weightEl = form.querySelector('#lb-poids');
  function el(name) { return form.querySelector('[data-lb-' + name + ']'); }

  var money = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' });
  var whole = new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 0 });
  var oneDecimal = new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 1 });

  // Le choix d'un menu déroulant ou d'un groupe de boutons radio.
  function value(name) { return form.elements[name].value; }
  // « 22,5 » et « 22.5 » se lisent tous deux 22.5.
  function number(input) {
    var n = parseFloat(String(input.value).replace(/\s/g, '').replace(',', '.'));
    return isFinite(n) ? n : NaN;
  }

  // Une galette congelée se coupe en quarts, en tiers ou en huitièmes : la
  // ration est arrondie à la fraction la plus proche, et le nom prend la
  // marque du pluriel à partir de deux.
  var FRACTIONS = [[0, ''], [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [1 / 2, '½'], [2 / 3, '⅔'], [3 / 4, '¾'], [1, '']];
  function split(count) {
    var units = Math.floor(count);
    var rest = count - units;
    var best = FRACTIONS[0];
    FRACTIONS.forEach(function (f) { if (Math.abs(rest - f[0]) < Math.abs(rest - best[0])) best = f; });
    if (best[0] === 1) return { units: units + 1, part: 0, mark: '' };
    return { units: units, part: best[0], mark: best[1] };
  }
  function patties(count) {
    var p = split(count);
    if (!p.units && !p.part) return 'moins de ⅛ de galette';
    if (!p.units) return p.mark === '½' ? '½ galette' : p.mark + ' de galette';
    return p.units + (p.mark ? ' ' + p.mark : '') + (p.units >= 2 ? ' galettes' : ' galette');
  }
  function pattyIcons(count) {
    var p = split(count);
    var total = p.units + (p.part ? 1 : 0);
    if (!total) { total = 1; p.part = 1 / 8; }
    var html = '';
    for (var i = 0; i < Math.min(total, MAX_ICONS); i++) {
      var fill = i < p.units ? 1 : p.part;
      html += '<span class="lb-patty" style="--fill:' + fill.toFixed(3) + '"></span>';
    }
    if (total > MAX_ICONS) html += '<span class="lb-patties__more">+' + (total - MAX_ICONS) + '</span>';
    return html;
  }

  function bodyWeightGrams() {
    var weight = number(weightEl);
    var kg = value('unite') === 'kg';
    var hint = el('weight-hint');
    var grams = weight * (kg ? 1000 : G_PER_LB);
    if (weightEl.value.trim() && !(grams > 0 && grams <= MAX_LB * G_PER_LB)) {
      hint.textContent = kg ? 'Entrez un poids valide, jusqu’à 113 kg.' : 'Entrez un poids valide, jusqu’à 250 lb.';
      return NaN;
    }
    hint.textContent = '';
    return grams;
  }

  var liveTimer = null;
  function announce(text) {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(function () { el('live').textContent = text; }, 700);
  }

  function update() {
    var body = bodyWeightGrams();
    var ready = body > 0;
    el('result').hidden = !ready;
    weightEl.setAttribute('aria-invalid', String(!!weightEl.value.trim() && !ready));
    if (!ready) { announce(''); return; }

    var day = body * Number(value('profil')) / 100;
    var dayPatties = day / PATTY_G;
    var monthPatties = dayPatties * DAYS;
    var bags = monthPatties / PATTIES_PER_BAG;

    el('day').textContent = whole.format(day) + ' g';
    el('day-patties').textContent = '≈ ' + patties(dayPatties);
    el('patty-icons').innerHTML = pattyIcons(dayPatties);
    el('meal').textContent = whole.format(day / MEALS) + ' g · ' + patties(dayPatties / MEALS);
    el('month').textContent = whole.format(monthPatties) + ' galettes · ' + oneDecimal.format(bags) + (bags >= 2 ? ' sacs' : ' sac');

    var price = prices[value('recette')];
    el('budget').hidden = !price;
    var summary = 'Ration de ' + whole.format(day) + ' grammes par jour, environ ' + patties(dayPatties) + '.';
    if (price) {
      var subtotal = bags * price;
      var total = subtotal * (1 + TPS + TVQ);
      el('total').textContent = money.format(total);
      el('subtotal').textContent = money.format(subtotal);
      el('tps').textContent = money.format(subtotal * TPS);
      el('tvq').textContent = money.format(subtotal * TVQ);
      el('per-day').textContent = money.format(total / DAYS);
      summary += ' Budget de ' + money.format(total) + ' pour 30 jours, taxes incluses.';
    }
    announce(summary);
  }

  // Le prix en boutique de chaque sac, dans le menu des recettes et sur les cartes.
  function showPrices() {
    Object.keys(prices).forEach(function (key) {
      form.ownerDocument.querySelectorAll('[data-lb-price="' + key + '"]').forEach(function (label) {
        var amount = money.format(prices[key]);
        label.textContent = label.dataset.name ? label.dataset.name + ' · ' + amount : 'Sac de 10 lb · ' + amount;
      });
    });
    update();
  }

  form.addEventListener('input', update);
  form.addEventListener('change', function (e) {
    // Passer de lb à kg convertit le poids déjà entré.
    if (e.target.name === 'unite') {
      var weight = number(weightEl);
      if (weight > 0) {
        var kg = e.target.value === 'kg';
        weightEl.value = oneDecimal.format(kg ? weight * G_PER_LB / 1000 : weight * 1000 / G_PER_LB);
      }
    }
    update();
  });
  form.addEventListener('submit', function (e) { e.preventDefault(); });
  update();

  fetch('/api/public/shop', { headers: { Accept: 'application/json' } })
    .then(function (res) {
      if (!res.ok) throw new Error('catalog');
      return res.json();
    })
    .then(function (data) {
      (data && Array.isArray(data.products) ? data.products : []).forEach(function (p) {
        if (!Array.isArray(p.brands) || p.brands.indexOf('Lucky Bones') === -1 || !(p.priceCents > 0)) return;
        Object.keys(RECIPES).forEach(function (key) {
          if (!prices[key] && RECIPES[key].test(p.name || '')) prices[key] = p.priceCents / 100;
        });
      });
      showPrices();
    })
    .catch(function () { /* Sans prix, la ration s'affiche sans le budget. */ });
})();

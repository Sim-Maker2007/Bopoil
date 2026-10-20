/* BOPOIL boutique search. Finds products by their name, choices, brand,
   category and description, whatever the accents, plurals or small typing
   mistakes, in French or in English (« gamelle » and « bowl » find the bols).
   No page code here: js/boutique.js hands it the cards, and the tests run it as is. */
(function () {
  'use strict';
  // Words without accents, capitals or ligatures: « Bœuf Séché » → boeuf, seche.
  function normalized(value) {
    return String(value || '').toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  function words(value) {
    return normalized(value).split(/[^a-z0-9]+/).filter(Boolean);
  }
  // A plural is searched as its singular: « brosses » finds « Brosse », « jeux »
  // finds « Jeu », « gâteaux » finds « Gâteau ». The products are reduced the
  // same way, so an odd result (« harnais » → « harnai ») still finds itself.
  // Other words ending in x stay whole (« toux » is not « tous »), and so do
  // sizes and weights.
  var stems = Object.create(null);
  function stem(word) {
    if (!stems[word]) {
      stems[word] = word.length < 4 || /\d/.test(word) ? word
        : /aux$/.test(word) && !/eaux$/.test(word) ? word.slice(0, -3) + 'al'
        : /[^s]s$|eux$|eaux$/.test(word) ? word.slice(0, -1)
        : word;
    }
    return stems[word];
  }
  // Little words are left out of a search that has others, so « brosse pour
  // chien » finds what « brosse chien » finds.
  var STOP_WORDS = ['a', 'au', 'aux', 'avec', 'd', 'de', 'des', 'du', 'en', 'et', 'l', 'la', 'le', 'les', 'pour', 'sur', 'un', 'une', 'and', 'for', 'of', 'with'];
  // Words that find each other: one idea per line, French first, then English.
  // When shoppers search for a word in vain, add it to its line (or a new one).
  var SYNONYMS = [
    'chien canin dog',
    'chiot puppy puppies',
    'chat felin minou cat',
    'chaton kitten',
    'gaterie friandise recompense collation treat snack',
    'shampooing shampoing shampoo',
    'revitalisant conditioner',
    'brosse brush',
    'peigne comb',
    'jouet jeu toy',
    'laisse leash',
    'collier collar',
    'harnais harness',
    'bol gamelle ecuelle bowl',
    'griffe ongle nail claw',
    'griffoir grattoir scratcher',
    'puce flea',
    'tique tick',
    'dentaire dental',
    'oreille ear',
    'oeil yeux eye',
    'litiere litter',
    'manteau veste coat jacket',
    'lit coussin matelas bed',
    'cataire catnip',
    'museliere muzzle',
    'rongeur rodent',
    'oiseau bird',
    'sac bag',
    'odeur odor',
    'poulet chicken',
    'boeuf beef',
    'saumon salmon',
    'dinde turkey',
    'agneau lamb',
    'porc pork',
    'canard duck',
    'poisson fish',
    'lapin rabbit'
  ];
  var synonymsOf = Object.create(null);
  var synonymWords = [];
  SYNONYMS.forEach(function (line) {
    var group = words(line).map(stem);
    group.forEach(function (s) { synonymsOf[s] = group; });
    synonymWords = synonymWords.concat(words(line));
  });
  // Where a word is found decides how high the product ranks: its name first,
  // then its colours and sizes, its brand, its category and its description.
  var FIELDS = [['name', 8], ['variants', 5], ['brand', 4], ['cat', 2], ['desc', 1]];

  function term(word) {
    var s = stem(word);
    return { word: word, stem: s, synonyms: (synonymsOf[s] || []).filter(function (other) { return other !== s; }) };
  }
  // Each word once, with its singular. « Anti-Glouton » is also « antiglouton ».
  function fieldWords(value) {
    var text = normalized(value);
    var list = text.split(/[^a-z0-9]+/);
    (text.match(/[a-z0-9]+(-[a-z0-9]+)+/g) || []).forEach(function (joined) { list.push(joined.replace(/-/g, '')); });
    var seen = Object.create(null);
    return list.filter(function (w) {
      if (!w || seen[w]) return false;
      seen[w] = true;
      return true;
    }).map(function (w) { return { word: w, stem: stem(w) }; });
  }
  // entries: one { name, variants, brand, cat, desc } per product, in the order
  // the scores come back in. The words are read on the first search, so a
  // shopper who only browses never waits for it.
  function createIndex(entries) {
    return { entries: entries, products: null, vocabulary: null };
  }
  function readWords(index) {
    if (index.products) return;
    var vocabulary = Object.create(null);
    index.products = index.entries.map(function (entry) {
      // A brand is only a name, so its words never stand for a synonym, even in
      // the product name: ZIPPY CLAWS toys are not for claws.
      var brand = fieldWords(entry.brand).map(function (w) { return w.word; });
      var fields = FIELDS.map(function (field) {
        var list = fieldWords(entry[field[0]]);
        list.forEach(function (w) { w.synonyms = brand.indexOf(w.word) === -1; });
        return { words: list, weight: field[1] };
      });
      // How much the catalog uses a word: once per product, by its best field.
      var best = Object.create(null);
      fields.forEach(function (field) {
        field.words.forEach(function (w) { best[w.word] = Math.max(best[w.word] || 0, field.weight); });
      });
      Object.keys(best).forEach(function (w) {
        if (!vocabulary[w]) vocabulary[w] = { word: w, stem: stem(w), weight: 0 };
        vocabulary[w].weight += best[w];
      });
      return fields;
    });
    synonymWords.forEach(function (w) {
      if (!vocabulary[w]) vocabulary[w] = { word: w, stem: stem(w), weight: 0 };
    });
    index.vocabulary = Object.keys(vocabulary).map(function (w) { return vocabulary[w]; });
  }
  // The catalog's own spelling of a word, to show a corrected search with its accents.
  function spelling(index, word) {
    for (var i = 0; i < index.entries.length; i++) {
      for (var f = 0; f < FIELDS.length; f++) {
        var found = String(index.entries[i][FIELDS[f][0]] || '').split(/[^\p{L}\p{N}]+/u).find(function (original) { return normalized(original) === word; });
        if (found) return found.toLowerCase();
      }
    }
    return word;
  }
  // How well a searched word matches a product word: the same word or its
  // plural (3), the start of a word (2), or, for a long search word, a part of
  // one (1): « poil » is in « antipoils », but « os » is not in « cosmétiques ».
  // A synonym counts only as a whole word, and as much as the start of a word.
  function quality(t, w) {
    if (w.word === t.word || w.stem === t.stem) return 3;
    var at = w.word.indexOf(t.word);
    if (at === 0) return 2;
    if (w.synonyms && t.synonyms.indexOf(w.stem) !== -1) return 2;
    return at > 0 && t.word.length > 3 ? 1 : 0;
  }
  // 0 unless every word of the search is in the product.
  function score(fields, terms) {
    var total = 0;
    for (var i = 0; i < terms.length; i++) {
      var best = 0;
      for (var f = 0; f < fields.length; f++) {
        var list = fields[f].words;
        for (var j = 0; j < list.length; j++) best = Math.max(best, quality(terms[i], list[j]) * fields[f].weight);
      }
      if (!best) return 0;
      total += best;
    }
    return total;
  }
  // Typing mistakes between a and b (a letter missing, extra, wrong or two
  // letters swapped), for the whole of b and for its best start, since the
  // last word of a search may still be being typed.
  function distances(a, b) {
    var before = null;
    var prev = [];
    for (var j = 0; j <= b.length; j++) prev[j] = j;
    for (var i = 1; i <= a.length; i++) {
      var row = [i];
      for (j = 1; j <= b.length; j++) {
        var v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (before && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, before[j - 2] + 1);
        row[j] = v;
      }
      before = prev;
      prev = row;
    }
    return { whole: prev[b.length], start: Math.min.apply(null, prev) };
  }
  // A word found nowhere in the catalog is read as the closest catalog word
  // that starts with the same letter: one mistake allowed from 5 letters, two
  // from 8. A whole word beats one still being typed, then the most used word.
  function correction(index, t) {
    if (t.word.length < 5 || /\d/.test(t.word)) return '';
    var limit = t.word.length >= 8 ? 2 : 1;
    var best = null;
    index.vocabulary.forEach(function (entry) {
      if (entry.word[0] !== t.word[0] || /\d/.test(entry.word)) return;
      var d = distances(t.word, entry.word);
      var s = t.stem === t.word ? d : distances(t.stem, entry.word);
      var whole = Math.min(d.whole, s.whole);
      // Fewer mistakes first; for as many, a whole word before a start.
      var key = whole <= limit ? whole * 2 : Math.min(d.start, s.start) * 2 + 1;
      if (key > limit * 2 + 1) return;
      if (!best || key < best.key || (key === best.key && entry.weight > best.weight)) best = { word: entry.word, key: key, weight: entry.weight };
    });
    return best ? best.word : '';
  }
  // Every synonym is in the vocabulary, so a word with synonyms is always known.
  function known(index, t) {
    return index.vocabulary.some(function (w) { return quality(t, w) > 0; });
  }
  // The search, word by word: little words left out, misspelt words corrected.
  function terms(index, query) {
    var list = words(query);
    var meaningful = list.filter(function (w) { return STOP_WORDS.indexOf(w) === -1; });
    var corrected = false;
    if (list.length) readWords(index);
    var result = (meaningful.length ? meaningful : list).map(function (word) {
      var t = term(word);
      if (known(index, t)) return t;
      var fix = correction(index, t);
      if (!fix) return t;
      corrected = true;
      return term(fix);
    });
    return { terms: result, corrected: corrected };
  }
  // scores: one per entry given to createIndex, 0 when the product does not
  // match. corrected: the search as it was read when a word had to be corrected
  // (« colier chien » → « collier chien »), otherwise ''.
  function find(index, query) {
    var read = terms(index, query);
    var searching = read.terms.length > 0;
    return {
      searching: searching,
      scores: searching ? index.products.map(function (fields) { return score(fields, read.terms); }) : index.entries.map(function () { return 0; }),
      corrected: read.corrected ? read.terms.map(function (t) { return spelling(index, t.word); }).join(' ') : ''
    };
  }

  window.BopoilSearch = {
    normalized: normalized,
    createIndex: createIndex,
    find: find
  };
})();

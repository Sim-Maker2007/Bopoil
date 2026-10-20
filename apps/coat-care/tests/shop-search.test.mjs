import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// js/shop-search.js is a plain browser script: run it as the page would.
const context = { window: {} };
vm.runInNewContext(await readFile(new URL("../../web/js/shop-search.js", import.meta.url), "utf8"), context);
const Search = context.window.BopoilSearch;

// Cards as js/boutique.js hands them over: brands as slugs, categories as words.
const catalog = [
  { name: "LW Brosse double pour petits animaux", brand: "lw", cat: "toilettage et hygiene", desc: "Brosse à deux faces pour lapins et cochons d'Inde." },
  { name: "SAFARI SW404", brand: "safari", cat: "toilettage et hygiene", desc: "Brosse à poils doux pour chats, idéale pour le pelage court." },
  { name: "LW Coupe-griffe", brand: "lw", cat: "toilettage et hygiene", desc: "Pour couper les griffes en douceur." },
  { name: "ZIPPY CLAWS Taco-Burrito", brand: "zippy-claws", cat: "jouets et stimulation", desc: "Peluche remplie d'herbe à chat." },
  { name: "DOGIT Bol Anti-Glouton", brand: "dogit", cat: "maison et entretien", desc: "Encourage votre chien à manger plus lentement." },
  { name: "CATIT Bol Surélevé Chat", brand: "catit", cat: "maison et entretien", desc: "Réduit la tension sur le cou de votre chat." },
  { name: "Zeus Collier Nylon", variants: "Rose Noir", brand: "zeus", cat: "accessoires et mode", desc: "Collier robuste pour chiens." },
  { name: "ZEUS Laisse", brand: "zeus", cat: "accessoires et mode", desc: "Laisse en nylon pour la promenade." },
  { name: "DOGMÄ Shampooing Velours 250 ml", brand: "dogma", cat: "toilettage et hygiene", desc: "Rend le pelage doux et soyeux." },
  { name: "ZOË Gâteries Chanvre et Saumon 150g", brand: "zoe", cat: "gateries et alimentation", desc: "Bouchées croquantes pour chiens." },
  { name: "LB-C Côte de bœuf 1.5 Lbs", brand: "lucky-bones", cat: "lucky bones", desc: "Os à mâcher au cœur tendre." },
  { name: "BACI+ Boules De Poils Originale", brand: "baci", cat: "sante et soins", desc: "Aide à éliminer les boules de poils des chats." },
  { name: "BUCO+ Gel dentaire", brand: "buco", cat: "sante et soins", desc: "Cosmétiques naturels pour une haleine fraîche." },
];
const index = Search.createIndex(catalog);

// Names found for a search, best first (equal scores keep the catalog order).
function found(query) {
  const { scores } = Search.find(index, query);
  return catalog
    .map((product, i) => ({ name: product.name, score: scores[i] }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((row) => row.name);
}

test("a search needs every word, ignores little ones, and ranks the name above the description", () => {
  assert.deepEqual(found("brosse"), ["LW Brosse double pour petits animaux", "SAFARI SW404"]);
  assert.deepEqual(found("brosse chat"), ["SAFARI SW404"]);
  assert.deepEqual(found("brosse pour un chat"), ["SAFARI SW404"]);
  assert.deepEqual(found("brosse zzzz"), []);
  assert.equal(Search.find(index, "  ").searching, false);
  assert.equal(Search.find(index, "brosse").searching, true);
});

test("plurals and singulars find each other", () => {
  assert.deepEqual(found("brosses"), found("brosse"));
  assert.deepEqual(found("colliers"), ["Zeus Collier Nylon"]);
  assert.deepEqual(found("bols"), ["DOGIT Bol Anti-Glouton", "CATIT Bol Surélevé Chat"]);
  assert.equal(found("griffes")[0], "LW Coupe-griffe");
  assert.equal(found("griffe")[0], "LW Coupe-griffe");
});

test("accents, capitals and the œ ligature do not matter", () => {
  assert.deepEqual(found("bœuf"), ["LB-C Côte de bœuf 1.5 Lbs"]);
  assert.deepEqual(found("boeuf"), ["LB-C Côte de bœuf 1.5 Lbs"]);
  assert.deepEqual(found("coeur"), ["LB-C Côte de bœuf 1.5 Lbs"]);
  assert.deepEqual(found("GÂTERIES"), ["ZOË Gâteries Chanvre et Saumon 150g"]);
});

test("a short word matches only the start of a word, a long one also its middle", () => {
  // « os » is not in « cosmétiques »; « poil » is in « poils ».
  assert.deepEqual(found("os"), ["LB-C Côte de bœuf 1.5 Lbs"]);
  assert.deepEqual(found("glouton"), ["DOGIT Bol Anti-Glouton"]);
  assert.deepEqual(found("antiglouton"), ["DOGIT Bol Anti-Glouton"]);
  assert.deepEqual(found("anti glouton"), ["DOGIT Bol Anti-Glouton"]);
  assert.deepEqual(found("dentaire"), ["BUCO+ Gel dentaire"]);
});

test("synonyms and English words find the French products", () => {
  assert.deepEqual(found("gamelle"), ["DOGIT Bol Anti-Glouton", "CATIT Bol Surélevé Chat"]);
  assert.deepEqual(found("friandise"), ["ZOË Gâteries Chanvre et Saumon 150g"]);
  assert.deepEqual(found("shampoing"), ["DOGMÄ Shampooing Velours 250 ml"]);
  assert.deepEqual(found("ongles"), ["LW Coupe-griffe"]);
  assert.deepEqual(found("leash"), ["ZEUS Laisse"]);
  assert.deepEqual(found("dog bowl"), ["DOGIT Bol Anti-Glouton"]);
  assert.deepEqual(found("treats"), ["ZOË Gâteries Chanvre et Saumon 150g"]);
  // A synonym ranks below the word itself.
  assert.deepEqual(found("chat").slice(0, 1), ["CATIT Bol Surélevé Chat"]);
});

test("a brand's words never stand for a synonym", () => {
  // ZIPPY CLAWS sells toys, not nail care, but its name still finds it.
  assert.deepEqual(found("griffes"), ["LW Coupe-griffe"]);
  assert.deepEqual(found("claws"), ["ZIPPY CLAWS Taco-Burrito", "LW Coupe-griffe"]);
});

test("a misspelt word is read as the closest word of the catalog, and says so", () => {
  assert.deepEqual(found("colier"), ["Zeus Collier Nylon"]);
  assert.equal(Search.find(index, "colier").corrected, "collier");
  assert.equal(Search.find(index, "colier pour chien").corrected, "collier chien");
  // Same first letter: « brose » is « brosse », not « rose ».
  assert.equal(Search.find(index, "brose").corrected, "brosse");
  assert.equal(Search.find(index, "shanpooing").corrected, "shampooing");
  // Shown with the catalog's accents.
  assert.equal(Search.find(index, "gateris").corrected, "gâteries");
  // A word the catalog knows, or one still being typed, is left alone.
  assert.equal(Search.find(index, "collier").corrected, "");
  assert.equal(Search.find(index, "sham").corrected, "");
  assert.deepEqual(found("sham"), ["DOGMÄ Shampooing Velours 250 ml"]);
  // Too far from anything: nothing found, nothing claimed.
  assert.deepEqual(found("xylophone"), []);
  assert.equal(Search.find(index, "xylophone").corrected, "");
});

test("every product is found first by its own name", () => {
  for (const product of catalog) assert.equal(found(product.name)[0], product.name, product.name);
});

test("the boutique searches with js/shop-search.js and keeps the search in the address", async () => {
  const [page, script, style] = await Promise.all([
    readFile(new URL("../../web/boutique.html", import.meta.url), "utf8"),
    readFile(new URL("../../web/js/boutique.js", import.meta.url), "utf8"),
    readFile(new URL("../../web/css/boutique.css", import.meta.url), "utf8"),
  ]);
  assert.match(script, /var Search = window\.BopoilSearch;\s*if \(!grid \|\| !Cart \|\| !Search\) return;/);
  assert.match(script, /Search\.createIndex\(cards\.map\(/);
  assert.match(script, /Search\.find\(searchIndex, searchEl\.value\)/);
  assert.match(script, /setParam\('recherche', searchEl\.value\.trim\(\), true\)/);
  assert.match(script, /if \(params\.has\('recherche'\)\) searchEl\.value = params\.get\('recherche'\);/);
  // A search with nothing in the chosen category offers the rest of the boutique.
  assert.match(page, /<button class="btn btn--filled btn--small" type="button" data-shop-widen hidden><\/button>/);
  assert.match(script, /if \(btn\.hasAttribute\('data-shop-widen'\)\) showWholeShop\(\);/);
  assert.match(style, /\.shop-count__fix \{ white-space: normal; \}/);
  // The longer offer wraps on a phone instead of running out of its card.
  assert.match(style, /\.shop-empty \.btn \{[^}]*white-space: normal;/);
});

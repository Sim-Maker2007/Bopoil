import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const web = new URL("../../web/", import.meta.url);
const read = (path) => readFile(new URL(path, web), "utf8");

test("Google Analytics loads only after the visitor accepts it in the Law 25 banner", async () => {
  const main = await read("js/main.js");
  const body = (name) => main.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}\\n`))[0];

  // The tag is requested from a single place, reached only through the consent.
  assert.equal(main.split("googletagmanager.com").length, 2);
  assert.match(body("startGoogleAnalytics"), /googletagmanager\.com/);
  assert.equal(main.split("startGoogleAnalytics(").length, 4, "defined once, started on a stored or a new acceptance");
  assert.match(body("initConsent"), /if \(choice === true\) startGoogleAnalytics\(gtagId\);/);
  assert.match(body("initConsent"), /if \(analytics\) startGoogleAnalytics\(gtagId\);\s*else stopGoogleAnalytics\(gtagId\);/);
  assert.match(body("initAnalytics"), /if \(a\.gtagId\) initConsent\(a\.gtagId\);/);
  assert.doesNotMatch(body("initAnalytics"), /googletagmanager|window\.gtag =/);

  // Refusing is as easy as accepting, and the choice can be changed later.
  const buttons = [...body("initConsent").matchAll(/<button class="([^"]+)" type="button" data-consent-choice="(refuse|accept)">/g)];
  assert.deepEqual(buttons.map((b) => b[2]), ["refuse", "accept"]);
  assert.equal(buttons[0][1], buttons[1][1], "both buttons look the same");
  assert.match(body("initConsent"), /Gérer les témoins/);
  assert.match(main, /CONSENT_MAX_AGE = 365 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(body("stopGoogleAnalytics"), /window\['ga-disable-' \+ id\] = true/);
  assert.match(body("stopGoogleAnalytics"), /Max-Age=0/);
});

test("the consent banner sits above the text pill and below the cart and product sheet", async () => {
  const [style, cart, boutique] = await Promise.all([read("css/style.css"), read("css/cart.css"), read("css/boutique.css")]);
  const zIndex = (css, selector) => Number(css.match(new RegExp(`${selector.replace(".", "\\.")} \\{[^}]*?z-index: (\\d+)`))[1]);
  const banner = zIndex(style, ".consent");
  assert.ok(banner > zIndex(style, ".sms-pill"));
  assert.ok(banner < zIndex(cart, ".cart-overlay"));
  assert.ok(banner < zIndex(boutique, ".product-overlay"));
  assert.match(style, /\.consent\[hidden\] \{ display: none; \}/);
});

#!/usr/bin/env node
/* ==========================================================================
   BOPOIL — variantes d'images
   --------------------------------------------------------------------------
   Pour chaque JPEG de images/, écrit la même image en WebP (environ 30 à 45 %
   plus légère à qualité égale). Pour les photos affichées en grille (accueil,
   galeries), ajoute aussi une vignette de 400 px : sur un téléphone, ces
   cases ne mesurent qu'un tiers ou la moitié de l'écran.

   Le générateur de pages (tools/build.py) détecte les fichiers présents et
   émet un <picture> avec la source WebP et toutes les largeurs disponibles.

   Utilise « sharp », déjà installé à la racine du dépôt par Next.js :

     node tools/optimize-images.mjs

   Les fichiers existants et plus récents que leur source ne sont pas refaits.
   ========================================================================== */

import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = path.join(root, "images");

// Photos affichées dans les grilles Instagram et galerie (cases de 33 à 50 vw).
const GRID = new Set([
  "salon-photo-1", "salon-photo-2", "salon-photo-3", "salon-photo-4",
  "galerie-spitz", "galerie-caniche", "galerie-border-collie", "boutique-interieur",
]);
const GRID_SOURCE_WIDTH = "800";
const THUMB_WIDTH = 400;

const WEBP = { quality: 78, effort: 5 };
const JPEG = { quality: 78, progressive: true, mozjpeg: true };

async function upToDate(target, source) {
  if (!existsSync(target)) return false;
  const [t, s] = await Promise.all([stat(target), stat(source)]);
  return t.mtimeMs >= s.mtimeMs;
}

let written = 0;
const files = (await readdir(dir)).filter((name) => name.endsWith(".jpg")).sort();

for (const file of files) {
  const source = path.join(dir, file);
  const webp = source.replace(/\.jpg$/, ".webp");
  if (!(await upToDate(webp, source))) {
    await sharp(source).webp(WEBP).toFile(webp);
    written += 1;
  }

  const match = file.match(/^(.+)-(\d+)\.jpg$/);
  if (!match || !GRID.has(match[1]) || match[2] !== GRID_SOURCE_WIDTH) continue;
  const thumb = path.join(dir, `${match[1]}-${THUMB_WIDTH}.jpg`);
  const thumbWebp = path.join(dir, `${match[1]}-${THUMB_WIDTH}.webp`);
  if (!(await upToDate(thumb, source))) {
    await sharp(source).resize({ width: THUMB_WIDTH }).jpeg(JPEG).toFile(thumb);
    written += 1;
  }
  if (!(await upToDate(thumbWebp, source))) {
    await sharp(source).resize({ width: THUMB_WIDTH }).webp(WEBP).toFile(thumbWebp);
    written += 1;
  }
}

console.log(`${written} fichier(s) écrit(s) dans images/. Relancez python3 tools/build.py.`);

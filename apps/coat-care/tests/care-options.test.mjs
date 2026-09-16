import assert from 'node:assert/strict';
import test from 'node:test';
import { matchingCare, sizeKeyFromLabel, suggestedCoat, careLabel } from '../lib/care-options.ts';
const services = [
  'Base - Catégorie D (Long ou frisé) · XS/TP (11 à 20 lbs)',
  'Complet - Catégorie D (Long ou frisé) · XS/TP (11 à 20 lbs)',
  'Base - Catégorie D (Long ou frisé) · L/G (61 à 80 lbs)',
  'Base - Catégorie C (Court à moyen avec sous poil) · XS/TP (11 à 20 lbs)',
  'Base - Catégorie F (Sur appel seulement) · XS/TP (11 à 20 lbs)',
  'Frais de déplacement / livraison · Article de base',
  'Taille de griffes pour votre compagnon! · Article de base',
  'Base pour chat · Article de base',
  'Base pour petit animal · Article de base',
  'Traitement de la mue · XS/TP (11 à 20 lbs)',
].map((name, id) => ({id, name}));
test('care choices respect category, size, species and call-only restrictions', () => {
  assert.deepEqual(matchingCare(services, {species:'dog'}, 'D', 'XS').map(s=>s.id), [0,1,6,9]);
  assert.deepEqual(matchingCare(services, {species:'cat'}, '', '').map(s=>s.id), [7]);
  assert.deepEqual(matchingCare(services, {species:'other'}, '', '').map(s=>s.id), [8]);
  assert.deepEqual(matchingCare(services, {species:'dog'}, 'F', 'OTHER').map(s=>s.id), [6]);
});
test('unknown and mixed breeds require an explicit coat choice', () => {
  assert.equal(suggestedCoat('Caniche'), 'D');
  assert.equal(suggestedCoat('Caniche croisé'), '');
  assert.equal(suggestedCoat('Race inconnue'), '');
  assert.equal(careLabel(services[0].name), 'Bain et soins de base');
});

test('sizeKeyFromLabel accepts the website size labels and the short keys', () => {
  assert.equal(sizeKeyFromLabel('XS/TP (11 à 20 lbs)'), 'XS');
  assert.equal(sizeKeyFromLabel('XXS/TTP (moins de 10 lbs)'), 'XXS');
  assert.equal(sizeKeyFromLabel('S/P (21 à 40 lbs)'), 'S');
  assert.equal(sizeKeyFromLabel('XL/TG (81 à 100 lbs)'), 'XL');
  assert.equal(sizeKeyFromLabel('XXL/TTG (101 à 120 lbs)'), 'OTHER');
  assert.equal(sizeKeyFromLabel('Géant (plus de 121 lbs)'), 'OTHER');
  assert.equal(sizeKeyFromLabel('M'), 'M');
  assert.equal(sizeKeyFromLabel(''), '');
  assert.equal(sizeKeyFromLabel(null), '');
  assert.equal(sizeKeyFromLabel('Moyen'), '');
});

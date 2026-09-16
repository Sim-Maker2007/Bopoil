import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { savedSizeChoice } from '../lib/care-options.ts';
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
function controls(source) {
  return [...source.matchAll(/<(input|textarea|select)\b([^>]*?)(?:\/>|>)/g)].map(([, tag, attrs]) => ({
    tag,
    name: attrs.match(/\bname="([^"]+)"/)?.[1],
    type: attrs.match(/\btype="([^"]+)"/)?.[1] || '',
    value: attrs.match(/\bvalue="([^"]*)"/)?.[1] || '',
    required: /\brequired\b/.test(attrs),
  })).filter((field) => field.name);
}
test('booking intake asks the same questions with the same choices and requirements as the public form', async () => {
  const [page, booking] = await Promise.all([read('../../web/fiche-informations.html'), read('../app/booking-intake.tsx')]);
  const form = page.match(/<form\b[^>]*data-formspree="intake"[\s\S]*?<\/form>/)[0];
  assert.deepEqual(controls(booking), controls(form));
  const options = (text) => [...text.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)].map(([,value,label]) => [value,label.replaceAll('&#39;', "'")]);
  assert.deepEqual(options(booking).map(([value,label]) => [value.replaceAll('&#39;', "'"),label]), options(form));
  assert.doesNotMatch(booking, /defaultChecked|defaultValue|\bchecked=/);
  assert.match(booking, /href="\/politique.html"/);
  assert.match(booking, /Object.fromEntries\(new FormData\(event.currentTarget\)\)/);
});
test('saved public-form weights remain usable when choosing care', () => {
  assert.equal(savedSizeChoice('XS/TP (11 à 20 lbs)'), 'XS');
  assert.equal(savedSizeChoice('XXS/TTP (moins de 10 lbs)'), 'XXS');
  assert.equal(savedSizeChoice('XL/TG (81 à 100 lbs)'), 'XL');
  assert.equal(savedSizeChoice('XXL/TTG (101 à 120 lbs)'), 'OTHER');
  assert.equal(savedSizeChoice('Géant (plus de 121 lbs)'), 'OTHER');
  assert.equal(savedSizeChoice('M'), 'M');
  assert.equal(savedSizeChoice(null), '');
});

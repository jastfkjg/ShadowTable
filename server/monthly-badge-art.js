'use strict';
const { join } = require('node:path');
const sharp = require('sharp');
const { monthRange } = require('../miniprogram/monthly-report');
const { FIRST_MONTH } = require('./badge-awards');

const asset = filename => join(__dirname, 'web', 'assets', filename);
const glyphWidth = 24, glyphHeight = 36;
const cache = new Map();
let glyphs;

function loadGlyphs() {
  if (!glyphs) {
    const atlas = asset('monthly-points-date-digits.png');
    glyphs = Promise.all(Array.from('0123456789.', (char, index) =>
      sharp(atlas).extract({ left: index * glyphWidth, top: 0, width: glyphWidth, height: glyphHeight })
        .png().toBuffer().then(input => [char, input])
    )).then(entries => new Map(entries)).catch(error => {
      glyphs = null;
      throw error;
    });
  }
  return glyphs;
}

async function stamp(month, rank) {
  const digits = await loadGlyphs();
  // Match the ribbon's shallow downward curve. Use local glyphs on every host.
  const offsets = [-54, -34, -14, 6, 21, 36, 56];
  const overlay = Array.from(month.replace('-', '.'), (char, index) => ({
    input: digits.get(char),
    left: 256 + offsets[index] - glyphWidth / 2,
    top: 420 + Math.round(6 * (1 - (offsets[index] / 56) ** 2)),
  }));
  return sharp(asset('monthly-points-' + rank + '.png')).composite(overlay).png().toBuffer();
}

function render(month, rank) {
  const key = month + '/' + rank;
  if (!cache.has(key)) {
    const image = stamp(month, rank).catch(error => {
      if (cache.get(key) === image) cache.delete(key);
      throw error;
    });
    cache.set(key, image);
    if (cache.size > 36) cache.delete(cache.keys().next().value);
  }
  return cache.get(key);
}

const route = /^\/assets\/badges\/monthly-points\/(\d{4}-(?:0[1-9]|1[0-2]))\/([1-3])\.png$/;
async function serve(req, res, path, now) {
  const match = route.exec(path);
  if (req.method !== 'GET' || !match) return false;
  const [, month, rank] = match;
  if (month < FIRST_MONTH || monthRange(month).end > now) return false;
  const image = await render(month, rank);
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.writeHead(200);
  res.end(image);
  return true;
}
module.exports = { render, serve };

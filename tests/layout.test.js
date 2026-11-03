import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutFor } from '../web/js/layout.js';

test('mise en page selon la fenêtre : bureau, téléphone debout, téléphone couché', () => {
  assert.equal(layoutFor(1280, 800), 'desktop');
  assert.equal(layoutFor(1024, 768), 'desktop');
  assert.equal(layoutFor(390, 844), 'portrait');
  assert.equal(layoutFor(360, 640), 'portrait');
  assert.equal(layoutFor(768, 1024), 'desktop', 'une tablette debout garde la fenêtre Macintosh');
  assert.equal(layoutFor(844, 390), 'land');
  assert.equal(layoutFor(667, 375), 'land', 'un petit téléphone couché n\'est pas pris pour un téléphone debout');
  assert.equal(layoutFor(932, 430), 'land');
});

test('une fenêtre étroite mais haute reste en portrait, une fenêtre basse mais large passe en paysage', () => {
  assert.equal(layoutFor(700, 900), 'portrait');
  assert.equal(layoutFor(1100, 500), 'land');
  assert.equal(layoutFor(1100, 600), 'desktop');
});

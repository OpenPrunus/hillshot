import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';
import { _dict, t, setLang, getLang, LANGS } from '../web/js/i18n.js';

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const phpFiles = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? phpFiles(path.join(dir, e.name)) : e.name.endsWith('.php') ? [path.join(dir, e.name)] : []));

test('le français et l\'anglais ont exactement les mêmes clés, toutes non vides', () => {
  const fr = Object.keys(_dict.fr).sort();
  const en = Object.keys(_dict.en).sort();
  assert.deepEqual(fr, en);
  for (const lang of LANGS) for (const [k, v] of Object.entries(_dict[lang])) assert.ok(v.trim().length > 0, `${lang}.${k} vide`);
});

test('les variables {x} sont les mêmes dans les deux langues', () => {
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const k of Object.keys(_dict.fr)) assert.deepEqual(vars(_dict.fr[k]), vars(_dict.en[k]), k);
});

test('toutes les clés utilisées par la page existent', () => {
  const html = read('web/index.php');
  const used = [...html.matchAll(/data-i18n(?:-placeholder|-aria)?="(\w+)"/g)].map((m) => m[1]);
  assert.ok(used.length > 25);
  for (const k of used) assert.ok(k in _dict.fr, `clé de la page inconnue : ${k}`);
});

test('toutes les clés t(\'…\') du code JavaScript existent', () => {
  for (const f of ['web/js/main.js', 'web/js/net.js']) {
    const used = [...read(f).matchAll(/\bt\('(\w+)'/g)].map((m) => m[1]);
    for (const k of used) assert.ok(k in _dict.fr, `${f} : clé inconnue ${k}`);
  }
  const map = [...read('web/js/main.js').matchAll(/(\w+): '(err\w+)'/g)];
  for (const [, , key] of map) assert.ok(key in _dict.fr, key);
});

test('chaque code d\'erreur du serveur PHP a un message dans le client', () => {
  const codes = new Set();
  for (const f of phpFiles('src/Game')) for (const m of read(f).matchAll(/->error\('(\w+)'\)/g)) codes.add(m[1]);
  assert.ok(codes.size >= 4, [...codes].join());
  const mapping = read('web/js/main.js').match(/const ERRORS = \{([^}]*)\}/)[1];
  for (const code of codes) assert.match(mapping, new RegExp(`\\b${code}\\b`), `code d'erreur non traduit : ${code}`);
});

test('t() remplace les variables et retombe sur l\'anglais puis sur la clé', () => {
  setLang('fr');
  assert.equal(getLang(), 'fr');
  assert.match(t('playerWins', { name: 'Zoé' }), /Zoé/);
  assert.equal(t('cle-inconnue'), 'cle-inconnue');
  setLang('en');
  assert.match(t('youWin'), /win/i);
  setLang('xx');
  assert.equal(getLang(), 'en', 'langue inconnue ignorée');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { C, LEFT, RIGHT, castleY, clampShot, createDuel, fire, fly, generateRound, groundY, maxSpeed, muzzle, nextRound } from '../web/js/engine.js';
import { seeded } from '../web/js/ai.js';

const flat = (wind = 0, castles = [60, 580]) => ({ baseY: 340, hillH: 0, hillX: 320, sigma: 60, castles, wind });
const endX = (t) => t.path[t.path.length - 1][0];

test('la calibration : portée à 45° et 400 g = 680 px (v0² / g)', () => {
  assert.ok(Math.abs((maxSpeed() ** 2) / C.G - C.RANGE_AT_MAX) < 1e-9);
});

test('un réglage est ramené dans ses bornes (0-90°, 0-400 g)', () => {
  assert.deepEqual(clampShot({ angle: -4, powder: 999 }), { angle: 0, powder: 400 });
  assert.deepEqual(clampShot({ angle: 120.9, powder: -1 }), { angle: 90, powder: 0 });
});

test('le sol : plateaux à la base, colline gaussienne symétrique', () => {
  const r = { baseY: 330, hillH: 100, hillX: 320, sigma: 60, castles: [60, 580], wind: 0 };
  assert.ok(Math.abs(groundY(r, 0) - 330) < 0.01);
  assert.ok(Math.abs(groundY(r, 320) - 230) < 1e-9);
  assert.ok(Math.abs(groundY(r, 270) - groundY(r, 370)) < 1e-9);
});

test('plus de poudre, plus loin ; le vent pousse l\'obus dans son sens', () => {
  const r = flat(0, [20, 620]);
  let prev = 0;
  for (const powder of [60, 120, 180, 240]) {
    const x = endX(fly(r, LEFT, { angle: 45, powder }));
    assert.ok(x > prev);
    prev = x;
  }
  const calm = endX(fly(flat(0), LEFT, { angle: 60, powder: 250 }));
  assert.ok(endX(fly(flat(1), LEFT, { angle: 60, powder: 250 })) > calm);
  assert.ok(endX(fly(flat(-1), LEFT, { angle: 60, powder: 250 })) < calm);
});

test('le château de droite tire vers la gauche', () => {
  const t = fly(flat(), RIGHT, { angle: 45, powder: 200 });
  assert.ok(endX(t) < muzzle(flat(), RIGHT, 45).x);
});

test('issues d\'un tir : sol, château (y compris le sien), hors de la scène', () => {
  assert.equal(fly(flat(), LEFT, { angle: 45, powder: 100 }).fate, 'ground');
  assert.equal(fly(flat(), LEFT, { angle: 45, powder: 400 }).fate, 'out');
  const self = fly(flat(), LEFT, { angle: 90, powder: 0 });
  assert.equal(self.fate, 'castle');
  assert.equal(self.hit, LEFT);
});

test('une grosse colline arrête les tirs tendus', () => {
  const r = { baseY: 340, hillH: 220, hillX: 320, sigma: 60, castles: [60, 580], wind: 0 };
  const t = fly(r, LEFT, { angle: 20, powder: 260 });
  assert.equal(t.fate, 'ground');
  assert.ok(endX(t) < 400);
});

function hittingShot(round, side) {
  for (let p = 0; p <= 400; p++) {
    const t = fly(round, side, { angle: 55, powder: p });
    if (t.fate === 'castle' && t.hit === 1 - side) return { angle: 55, powder: p };
  }
  throw new Error('aucun tir gagnant');
}

test('mode classique : un impact détruit le château et marque la manche', () => {
  const duel = createDuel({ target: 2, mode: 'classic', round: flat(), first: LEFT });
  const out = fire(duel, hittingShot(flat(), LEFT));
  assert.equal(out.roundOver, true);
  assert.equal(out.roundWinner, LEFT);
  assert.deepEqual(out.hp, [100, 0]);
  assert.deepEqual(duel.score, [1, 0]);
  assert.equal(out.matchWinner, null);
});

test('mode santé : trois impacts', () => {
  const duel = createDuel({ target: 1, mode: 'health', round: flat(), first: LEFT });
  const shot = hittingShot(flat(), LEFT);
  const hp = [];
  for (let i = 0; i < 3; i++) {
    const out = fire(duel, shot);
    hp.push(out.hp[RIGHT]);
    if (!out.roundOver) fire(duel, { angle: 45, powder: 100 });
  }
  assert.deepEqual(hp, [66, 32, 0]);
  assert.equal(duel.winner, LEFT);
});

test('on tire à tour de rôle, et l\'autre camp commence la manche suivante', () => {
  const duel = createDuel({ target: 3, round: flat(), first: RIGHT });
  assert.equal(duel.turn, RIGHT);
  fire(duel, { angle: 45, powder: 100 });
  assert.equal(duel.turn, LEFT);
  fire(duel, { angle: 45, powder: 100 });
  assert.equal(duel.turn, RIGHT);
  nextRound(duel, flat());
  assert.equal(duel.turn, LEFT);
  assert.deepEqual(duel.hp, [100, 100]);
});

test('un obus qui retombe sur son propre château donne la manche à l\'adversaire', () => {
  const duel = createDuel({ target: 1, round: flat(), first: LEFT });
  const out = fire(duel, { angle: 90, powder: 0 });
  assert.equal(out.roundWinner, RIGHT);
  assert.equal(duel.winner, RIGHT);
});

test('les manches générées respectent les plages du cahier des charges', () => {
  const rand = seeded(11);
  for (let i = 0; i < 400; i++) {
    const r = generateRound(rand);
    assert.ok(r.baseY >= 300 && r.baseY <= 360);
    assert.ok(r.hillH >= 10 && r.hillH <= 220);
    assert.ok(r.hillX >= 260 && r.hillX <= 380);
    assert.ok(r.sigma >= 40 && r.sigma <= 95);
    assert.ok(Math.abs(r.wind) <= C.WIND_MAX);
    assert.ok(r.castles[0] < C.W / 2 && r.castles[1] > C.W / 2);
    for (const side of [LEFT, RIGHT]) assert.ok(r.baseY - castleY(r, side) < 40, 'château posé sur son plateau');
  }
});

test('déterminisme : mêmes entrées, même vol', () => {
  const r = generateRound(seeded(3));
  assert.deepEqual(fly(r, LEFT, { angle: 52, powder: 210 }), fly(r, LEFT, { angle: 52, powder: 210 }));
});

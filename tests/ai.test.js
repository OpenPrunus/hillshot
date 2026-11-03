import test from 'node:test';
import assert from 'node:assert/strict';
import { LEFT, createDuel, fire, generateRound, nextRound } from '../web/js/engine.js';
import { LEVELS, createAI, seeded } from '../web/js/ai.js';

function playMatch(levelLeft, levelRight, seed) {
  const rand = seeded(seed);
  const duel = createDuel({ round: generateRound(rand), first: seed % 2, target: 5, mode: 'classic' });
  const ais = [createAI(0, levelLeft, seed), createAI(1, levelRight, seed + 1)];
  let shots = 0;
  while (duel.winner === null && shots < 600) {
    const side = duel.turn;
    const out = fire(duel, ais[side].decide(duel));
    ais[side].observe(duel.round, out.trajectory);
    shots++;
    if (out.roundOver && duel.winner === null) nextRound(duel, generateRound(rand));
  }
  return { winner: duel.winner, shots };
}

test('l\'IA connaît trois niveaux, de plus en plus précis', () => {
  assert.deepEqual(Object.keys(LEVELS), ['easy', 'normal', 'hard']);
  assert.ok(LEVELS.hard.powderError < LEVELS.normal.powderError && LEVELS.normal.powderError < LEVELS.easy.powderError);
});

test('ses tirs restent dans les bornes', () => {
  const rand = seeded(2);
  const ai = createAI(1, 'easy', 9);
  for (let i = 0; i < 50; i++) {
    const duel = createDuel({ round: generateRound(rand), first: 1 });
    const s = ai.decide(duel);
    assert.ok(Number.isInteger(s.angle) && Number.isInteger(s.powder));
  }
});

test('même graine, même partie', () => {
  assert.deepEqual(playMatch('normal', 'normal', 5), playMatch('normal', 'normal', 5));
});

test('toutes les parties se terminent', () => {
  for (let seed = 1; seed <= 20; seed++) assert.notEqual(playMatch('easy', 'easy', seed).winner, null, `graine ${seed}`);
});

test('plus le niveau est haut, plus l\'IA gagne (30 parties chacune)', () => {
  const wins = (a, b) => { let w = 0; for (let i = 0; i < 30; i++) if (playMatch(a, b, 100 + i).winner === LEFT) w++; return w; };
  assert.ok(wins('hard', 'easy') >= 22, 'difficile bat facile');
  assert.ok(wins('normal', 'easy') >= 20, 'normal bat facile');
  assert.ok(wins('hard', 'normal') >= 18, 'difficile bat normal');
});

test('elle corrige son tir d\'une salve à l\'autre dans une même manche', () => {
  const rand = seeded(8);
  const round = generateRound(rand);
  const ai = createAI(0, 'easy', 4);
  const duel = createDuel({ round, first: 0 });
  const errors = [];
  for (let i = 0; i < 6; i++) {
    const out = fire(duel, ai.decide(duel));
    ai.observe(round, out.trajectory);
    errors.push(Math.abs(out.trajectory.path.at(-1)[0] - round.castles[1]));
    if (out.roundOver) break;
    fire(duel, { angle: 45, powder: 100 });                      // l'adversaire tire dans le sol
  }
  assert.ok(errors.at(-1) <= errors[0] + 1, `l'écart ne grossit pas : ${errors.map(Math.round)}`);
});

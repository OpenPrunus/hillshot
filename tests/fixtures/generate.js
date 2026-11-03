// Génère tests/fixtures/engine-vectors.json : des matchs rejoués par le moteur JS (manches, tirs, vols, dégâts, scores).
// Les tests PHP (tests/php/Engine/FixturesTest.php) les rejouent avec src/Engine et exigent les mêmes résultats.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEFT, createDuel, fire, generateRound, nextRound } from '../../web/js/engine.js';
import { createAI, seeded } from '../../web/js/ai.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const duels = [];

function record(seed, mode, target, style) {
  const rand = seeded(seed);
  const rounds = [generateRound(rand)];
  const duel = createDuel({ target, mode, round: rounds[0], first: seed % 2 === 0 ? LEFT : 1 });
  const ais = [createAI(0, 'hard', seed), createAI(1, 'normal', seed + 1)];
  const shots = [];
  for (let i = 0; i < 70 && duel.winner === null; i++) {
    const side = duel.turn;
    let shot;
    if (style === 'ai') shot = ais[side].decide(duel);
    else shot = { angle: Math.floor(rand() * 100) - 5, powder: Math.floor(rand() * 440) - 20 };     // y compris hors bornes : le moteur les ramène
    const out = fire(duel, shot);
    ais[side].observe(duel.round, out.trajectory);
    shots.push({
      round: rounds.length - 1,
      shot,
      by: out.by,
      path: out.trajectory.path,
      fate: out.trajectory.fate,
      hit: out.trajectory.hit,
      hp: out.hp,
      roundOver: out.roundOver,
      roundWinner: out.roundWinner,
      matchWinner: out.matchWinner,
      next: out.next,
      score: [...duel.score],
    });
    if (out.roundOver && duel.winner === null) {
      const round = generateRound(rand);
      rounds.push(round);
      nextRound(duel, round);
    }
  }
  duels.push({ seed, mode, target, first: seed % 2 === 0 ? LEFT : 1, rounds, shots });
}

record(1, 'classic', 3, 'ai');
record(2, 'health', 3, 'ai');
record(3, 'classic', 5, 'ai');
record(4, 'health', 2, 'ai');
record(5, 'classic', 2, 'random');
record(6, 'health', 2, 'random');
record(7, 'classic', 3, 'random');

fs.writeFileSync(path.join(here, 'engine-vectors.json'), `${JSON.stringify({ duels })}\n`);
const total = duels.reduce((n, d) => n + d.shots.length, 0);
console.log(`${duels.length} matchs, ${total} tirs`);

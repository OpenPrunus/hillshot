// Hillshot — l'ordinateur. Il résout la balistique approximativement (même moteur, vent mal estimé selon le niveau),
// ajoute une marge d'erreur aléatoire, puis affine sa charge de poudre par dichotomie d'après l'écart de ses tirs précédents.
// Le hasard vient d'un générateur à graine : une partie est rejouable.

import { C, LEFT, fly } from './engine.js';

export const LEVELS = Object.freeze({
  easy: { windError: 0.6, powderError: 40, angleError: 6 },
  normal: { windError: 0.3, powderError: 22, angleError: 4 },
  hard: { windError: 0.15, powderError: 10, angleError: 2 },
});

/** Générateur pseudo-aléatoire déterministe (mulberry32) renvoyant des réels dans [0, 1). */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Abscisse d'arrivée (signée : positive = au-delà de la cible, dans le sens du tir) d'un tir de cette poudre. */
function overshoot(round, side, angle, powder, targetX) {
  const trajectory = fly(round, side, { angle, powder });
  const x = trajectory.path[trajectory.path.length - 1][0];
  return (side === LEFT ? 1 : -1) * (x - targetX);
}

export function createAI(side, level = 'normal', seed = 1) {
  const cfg = LEVELS[level] ?? LEVELS.normal;
  const rand = seeded(seed + side * 7919);
  const angles = [38, 42, 46, 50, 54, 58, 62, 66, 70, 74, 78];
  let roundKey = '';
  let angle = 50;
  let perceived = null;
  let lo = 0;
  let hi = C.MAX_POWDER;
  let last = null;
  let misses = 0;

  const key = (round) => `${round.baseY}/${round.hillH}/${round.hillX}/${round.castles}/${round.wind}`;

  /** Dichotomie : la poudre minimale pour laquelle l'obus ne retombe pas avant la cible (avec l'erreur d'angle et de vent du niveau). */
  function solve(round, a0, b0, ang) {
    let a = a0;
    let b = b0;
    for (let i = 0; i < 16; i++) {
      const mid = (a + b) / 2;
      if (overshoot(round, side, ang, mid, round.castles[1 - side]) < 0) a = mid;
      else b = mid;
    }
    const powder = (a + b) / 2;
    return { powder, error: Math.abs(overshoot(round, side, ang, powder, round.castles[1 - side])) };
  }

  /** Parmi quelques angles (point de départ au hasard), le premier qui permet d'atteindre la cible, sinon le moins mauvais. */
  function chooseAngle(round) {
    const offset = Math.floor(rand() * angles.length);
    let best = { angle: 50, error: Infinity };
    for (let i = 0; i < angles.length; i++) {
      const ang = angles[(offset + i) % angles.length];
      const { error } = solve(perceived, 0, C.MAX_POWDER, ang);
      if (error < 14) return ang;
      if (error < best.error) best = { angle: ang, error };
    }
    return best.angle;
  }

  return {
    level,
    /** Choisit le tir de ce tour. */
    decide(duel) {
      const round = duel.round;
      if (key(round) !== roundKey) {
        roundKey = key(round);
        perceived = { ...round, wind: round.wind * (1 + (rand() * 2 - 1) * cfg.windError) };
        angle = chooseAngle(round);
        lo = 0;
        hi = C.MAX_POWDER;
        last = null;
        misses = 0;
      }
      const { powder: solved } = solve(perceived, lo, hi, angle);
      const shrink = 0.5 ** misses;
      const shot = {
        angle: Math.round(angle + (rand() * 2 - 1) * cfg.angleError * shrink),
        powder: Math.round(solved + (rand() * 2 - 1) * cfg.powderError * shrink),
      };
      last = { ...shot };
      return shot;
    },
    /** Retient l'écart de son tir pour resserrer la fourchette de poudre à la prochaine tentative. */
    observe(round, trajectory) {
      if (!last) return;
      const x = trajectory.path[trajectory.path.length - 1][0];
      const over = (side === LEFT ? 1 : -1) * (x - round.castles[1 - side]);
      if (over < 0) lo = Math.max(lo, Math.min(last.powder, hi));
      else hi = Math.min(hi, Math.max(last.powder, lo));
      misses++;
    },
  };
}

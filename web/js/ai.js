// Hillshot — l'ordinateur. Comme un joueur, il ne connaît pas exactement le vent et ne sait pas à l'avance où tombera son premier
// obus : il résout la balistique avec le moteur du jeu sur une estimation du vent, puis vise avec une erreur de distance
// (aléatoire) propre à son niveau. Chaque tir lui apprend l'écart de son obus : il corrige alors son biais et resserre sa visée.
// Le hasard vient d'un générateur à graine : une partie est rejouable.

import { C, LEFT, fly } from './engine.js';

/**
 * aimError : écart-type (px) de l'erreur de visée du premier tir, divisé par deux à chaque tir manqué de la manche ;
 * windError : erreur d'estimation du vent (en unités de vent, de -1 à 1), corrigée par le biais mesuré après un premier tir.
 * Taux de réussite mesurés : premier tir ~7 % (facile), ~14 % (normal), ~29 % (difficile) ; au troisième tir ~20 % / ~47 % / ~79 %.
 */
export const LEVELS = Object.freeze({
  easy: { aimError: 500, windError: 0.6 },
  normal: { aimError: 220, windError: 0.3 },
  hard: { aimError: 100, windError: 0.12 },
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

const gauss = (rand) => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

/** Écart d'arrivée (signé : positif = au-delà de la cible, dans le sens du tir) d'un tir de cette poudre. */
function overshoot(round, side, angle, powder, targetX) {
  const trajectory = fly(round, side, { angle, powder });
  const x = trajectory.path[trajectory.path.length - 1][0];
  return (side === LEFT ? 1 : -1) * (x - targetX);
}

export function createAI(side, level = 'normal', seed = 1) {
  const cfg = LEVELS[level] ?? LEVELS.normal;
  const rand = seeded(seed + side * 7919);
  const dir = side === LEFT ? 1 : -1;
  const angles = [38, 42, 46, 50, 54, 58, 62, 66, 70, 74, 78];
  let roundKey = '';
  let angle = 50;
  let perceived = null;       // la manche telle qu'il la comprend (vent estimé)
  let bias = 0;               // erreur systématique mesurée sur ses tirs précédents (px, dans le sens du tir)
  let misses = 0;
  let lastOffset = 0;         // écart voulu du dernier tir par rapport à la cible

  const key = (round) => `${round.baseY}/${round.hillH}/${round.hillX}/${round.castles}/${round.wind}`;

  /** Dichotomie : la poudre pour laquelle l'obus retombe à `aimX` selon sa compréhension de la manche. */
  function solve(ang, aimX) {
    let a = 0;
    let b = C.MAX_POWDER;
    for (let i = 0; i < 16; i++) {
      const mid = (a + b) / 2;
      if (overshoot(perceived, side, ang, mid, aimX) < 0) a = mid;
      else b = mid;
    }
    return (a + b) / 2;
  }

  /** Parmi quelques angles (point de départ au hasard), le premier qui permet d'atteindre la cible, sinon le moins mauvais. */
  function chooseAngle(targetX) {
    const offset = Math.floor(rand() * angles.length);
    let best = { angle: 50, error: Infinity };
    for (let i = 0; i < angles.length; i++) {
      const ang = angles[(offset + i) % angles.length];
      const error = Math.abs(overshoot(perceived, side, ang, solve(ang, targetX), targetX));
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
      const targetX = round.castles[1 - side];
      if (key(round) !== roundKey) {
        roundKey = key(round);
        perceived = { ...round, wind: round.wind + (rand() * 2 - 1) * cfg.windError };
        angle = chooseAngle(targetX);
        bias = 0;
        misses = 0;
        lastOffset = 0;
      }
      // On corrige le biais mesuré, puis on ajoute l'erreur de visée du niveau (de plus en plus petite à chaque tir manqué).
      const offset = -bias + gauss(rand) * cfg.aimError * 0.5 ** misses;
      lastOffset = offset;
      const aimX = targetX + dir * offset;
      return { angle, powder: Math.round(solve(angle, aimX)) };
    },
    /** Mesure l'écart de son obus : l'erreur systématique (vent mal estimé, etc.) est corrigée au tir suivant. */
    observe(round, trajectory) {
      const impactX = trajectory.path[trajectory.path.length - 1][0];
      const miss = dir * (impactX - round.castles[1 - side]);
      bias = miss - lastOffset;
      misses++;
    },
  };
}

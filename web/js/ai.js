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

/** Valeur donnée à un tir qui s'écrase contre la colline avant d'en avoir passé la crête : bien pire que n'importe quelle retombée. */
const BLOCKED = -1e6;

/**
 * Écart d'arrivée (signé : positif = au-delà de la cible, dans le sens du tir) d'un tir de cette poudre.
 * Un tir qui retombe sur la pente de son propre côté de la colline ne passe pas : il compte comme `BLOCKED`, ce qui garde la
 * recherche monotone (plus de poudre = plus loin) et empêche l'IA de s'obstiner avec une poudre maximale qui ne passera jamais.
 */
function overshoot(round, side, angle, powder, targetX) {
  const trajectory = fly(round, side, { angle, powder });
  const x = trajectory.path[trajectory.path.length - 1][0];
  const beforeCrest = side === LEFT ? x < round.hillX : x > round.hillX;
  const mustCross = side === LEFT ? targetX > round.hillX : targetX < round.hillX;
  if (trajectory.fate === 'ground' && beforeCrest && mustCross) return BLOCKED;
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
  let lastShot = null;        // le tir précédent de la manche (pour ne jamais le rejouer à l'identique après un échec)

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

  /** Parmi quelques angles (point de départ au hasard), le premier qui permet d'atteindre la cible, sinon le moins mauvais (sauf `avoid`). */
  function chooseAngle(targetX, avoid = null) {
    const offset = Math.floor(rand() * angles.length);
    let best = { angle: avoid === 50 ? 54 : 50, error: Infinity };
    for (let i = 0; i < angles.length; i++) {
      const ang = angles[(offset + i) % angles.length];
      if (ang === avoid) continue;
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
        lastShot = null;
      }
      // On corrige le biais mesuré, puis on ajoute l'erreur de visée du niveau (de plus en plus petite à chaque tir manqué).
      const offset = -bias + gauss(rand) * cfg.aimError * 0.5 ** misses;
      lastOffset = offset;
      // on ne vise jamais hors du terrain : un écart de visée trop grand enverrait l'obus au-delà du bord, poudre au maximum
      const aimX = Math.max(10, Math.min(C.W - 10, targetX + dir * offset));
      let powder = Math.round(solve(angle, aimX));
      // Poudre au maximum (ou presque) et la cible n'est toujours pas atteinte : cet angle ne passera jamais, on en change.
      if (powder >= C.MAX_POWDER - 1 && overshoot(perceived, side, angle, powder, aimX) < -5) {
        angle = chooseAngle(aimX, angle);
        powder = Math.round(solve(angle, aimX));
      }
      // Jamais deux fois exactement le même tir quand le précédent a raté : on varie légèrement la poudre (l'angle, lui, est gardé :
      // la correction apprise vaut pour cet angle).
      if (lastShot && lastShot.angle === angle && lastShot.powder === powder) {
        const nudge = (rand() < 0.5 ? -1 : 1) * (4 + Math.floor(rand() * 12));
        const clamp = (v) => Math.max(0, Math.min(C.MAX_POWDER, v));
        powder = clamp(powder + nudge) !== lastShot.powder ? clamp(powder + nudge) : clamp(powder - nudge);
      }
      lastShot = { angle, powder };
      return { angle, powder };
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

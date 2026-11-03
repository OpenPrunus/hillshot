// Hillshot — moteur de jeu pur (aucun DOM, aucun hasard, pas d'horloge) : mêmes entrées => mêmes résultats.
// Repère de la scène : x vers la droite, y vers le BAS (0 = haut de la scène), 640 × 380 px.
// Le moteur existe aussi en PHP (src/Engine) : tests/fixtures/engine-vectors.json garde les deux identiques.

export const C = Object.freeze({
  W: 640,
  SCENE_H: 380,
  G: 0.08,               // gravité (px / pas²)
  RANGE_AT_MAX: 680,     // portée à 45° et 400 g, sans vent : calibre la vitesse initiale
  WIND_ACC: 0.012,       // accélération horizontale pour un vent de 1
  WIND_MAX: 1,
  MAX_ANGLE: 90,
  MAX_POWDER: 400,
  CASTLE_HW: 20,         // demi-largeur d'un château
  CASTLE_H: 40,
  MUZZLE: 18,            // longueur du canon
  MAX_TICKS: 1500,       // durée maximale d'un vol
  DAMAGE_CLASSIC: 100,
  DAMAGE_HEALTH: 34,
  TARGET: 5,
});

export const LEFT = 0;
export const RIGHT = 1;
export const dirOf = (side) => (side === LEFT ? 1 : -1);
export const maxSpeed = () => Math.sqrt(C.RANGE_AT_MAX * C.G);
export const clampShot = (s) => ({
  angle: Math.max(0, Math.min(C.MAX_ANGLE, Math.trunc(s.angle))),
  powder: Math.max(0, Math.min(C.MAX_POWDER, Math.trunc(s.powder))),
});

/** Manche : { baseY, hillH, hillX, sigma, castles: [xGauche, xDroite], wind }. */
export function groundY(round, x) {
  const dx = x - round.hillX;
  return round.baseY - round.hillH * Math.exp(-(dx * dx) / (2 * round.sigma * round.sigma));
}

export const castleY = (round, side) => groundY(round, round.castles[side]);

/** Tire une manche au hasard (`rand` : réels dans [0, 1)). */
export function generateRound(rand) {
  const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const baseY = int(300, 360);
  const hillH = int(10, 220);
  const hillX = int(260, 380);
  const sigma = int(40, 95);
  const wind = int(-100, 100) / 100;
  const round = { baseY, hillH, hillX, sigma, castles: [60, 580], wind };
  const place = (min, max, fallback) => {
    for (let i = 0; i < 20; i++) {
      const x = int(min, max);
      if (baseY - groundY(round, x) < 40) return x;
    }
    return fallback;
  };
  return { baseY, hillH, hillX, sigma, castles: [place(50, 150, 60), place(490, 590, 580)], wind };
}

/** Bouche du canon : au-dessus du château, dans la direction du tir. */
export function muzzle(round, side, angle) {
  const a = (angle * Math.PI) / 180;
  return { x: round.castles[side] + dirOf(side) * Math.cos(a) * C.MUZZLE, y: castleY(round, side) - C.CASTLE_H - 2 - Math.sin(a) * C.MUZZLE };
}

function castleAt(round, x, y) {
  for (const side of [LEFT, RIGHT]) {
    const cy = castleY(round, side);
    if (Math.abs(x - round.castles[side]) <= C.CASTLE_HW && y >= cy - C.CASTLE_H && y <= cy) return side;
  }
  return null;
}

/** Vol d'un obus : { path: [[x, y], …], fate: 'castle' | 'ground' | 'out', hit: côté touché | null }. */
export function fly(round, side, shot) {
  const a = (shot.angle * Math.PI) / 180;
  const v0 = (maxSpeed() * shot.powder) / C.MAX_POWDER;
  let vx = dirOf(side) * v0 * Math.cos(a);
  let vy = -v0 * Math.sin(a);
  const m = muzzle(round, side, shot.angle);
  let x = m.x;
  let y = m.y;
  const path = [[x, y]];
  let fate = 'out';
  let hit = null;
  for (let tick = 0; tick < C.MAX_TICKS; tick++) {
    vx += C.WIND_ACC * round.wind;
    vy += C.G;
    x += vx;
    y += vy;
    if (x < 0 || x > C.W) {
      path.push([x, y]);
      break;
    }
    const struck = castleAt(round, x, y);
    if (struck !== null) {
      path.push([x, y]);
      fate = 'castle';
      hit = struck;
      break;
    }
    const ground = groundY(round, x);
    if (y >= ground) {
      path.push([x, ground]);
      fate = 'ground';
      break;
    }
    path.push([x, y]);
  }
  return { path, fate, hit };
}

/** Un match : manches successives, chacun tire à son tour. `mode` : 'classic' (1 impact) ou 'health' (dégâts partiels). */
export function createDuel({ target = C.TARGET, mode = 'classic', round, first = LEFT }) {
  return { target, mode, round, turn: first, starter: first, hp: [100, 100], score: [0, 0], roundNumber: 1, winner: null };
}

/** Le joueur dont c'est le tour tire. Renvoie { by, shot, trajectory, hp, roundOver, roundWinner, matchWinner, next }. */
export function fire(duel, rawShot) {
  const shot = clampShot(rawShot);
  const by = duel.turn;
  const trajectory = fly(duel.round, by, shot);
  let roundOver = false;
  let roundWinner = null;
  if (trajectory.fate === 'castle') {
    const damage = duel.mode === 'health' ? C.DAMAGE_HEALTH : C.DAMAGE_CLASSIC;
    duel.hp[trajectory.hit] = Math.max(0, duel.hp[trajectory.hit] - damage);
    if (duel.hp[trajectory.hit] === 0) {
      roundOver = true;
      roundWinner = 1 - trajectory.hit;
      duel.score[roundWinner]++;
      if (duel.score[roundWinner] >= duel.target) duel.winner = roundWinner;
    }
  }
  if (!roundOver) duel.turn = 1 - by;
  return { by, shot, trajectory, hp: [...duel.hp], roundOver, roundWinner, matchWinner: duel.winner, next: duel.turn };
}

/** Nouvelle manche : châteaux remis à neuf, l'autre camp commence. */
export function nextRound(duel, round) {
  duel.round = round;
  duel.hp = [100, 100];
  duel.roundNumber++;
  duel.starter = 1 - duel.starter;
  duel.turn = duel.starter;
}

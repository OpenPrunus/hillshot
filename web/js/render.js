// Hillshot — rendu pixel-art de la scène 640 × 380 (style Macintosh, 16 couleurs tramées) sur deux calques :
// un calque de fond (ciel, colline, traces noires des tirs, qui restent toute la manche) et un calque animé (obus, explosions, canons).
import { C, LEFT, RIGHT, castleY, dirOf, groundY } from './engine.js';

const COL = {
  skyA: '#8ec6f5',
  skyB: '#a9d8ff',
  grassA: '#3f9a3f',
  grassB: '#52b552',
  dirt: '#7a5a2e',
  line: '#000',
  brick: '#9b9b9b',
  brickDark: '#6f6f6f',
  door: '#7b4a1e',
  flag: '#ff8a1c',
  smoke: '#444',
};

/** Motif tramé 2 × 2 (damier) de deux couleurs. */
function checker(ctx, a, b) {
  const p = document.createElement('canvas');
  p.width = 2;
  p.height = 2;
  const c = p.getContext('2d');
  c.fillStyle = a;
  c.fillRect(0, 0, 2, 2);
  c.fillStyle = b;
  c.fillRect(0, 0, 1, 1);
  c.fillRect(1, 1, 1, 1);
  return ctx.createPattern(p, 'repeat');
}

export class Scene {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.bg = document.createElement('canvas');
    this.bg.width = C.W;
    this.bg.height = C.SCENE_H;
    this.bgx = this.bg.getContext('2d');
    this.round = null;
    this.trailEnd = null;
  }

  /** Nouvelle manche : on redessine le ciel et la colline, les traces sont effacées. */
  setRound(round) {
    this.round = round;
    this.trailEnd = null;
    const g = this.bgx;
    g.fillStyle = checker(g, COL.skyA, COL.skyB);
    g.fillRect(0, 0, C.W, C.SCENE_H);
    const grass = checker(g, COL.grassA, COL.grassB);
    let prev = null;
    for (let x = 0; x < C.W; x++) {
      const y = Math.round(groundY(round, x));
      g.fillStyle = grass;
      g.fillRect(x, y, 1, C.SCENE_H - y);
      g.fillStyle = COL.line;
      if (prev === null) g.fillRect(x, y, 1, 1);
      else g.fillRect(x, Math.min(y, prev), 1, Math.abs(y - prev) + 1);   // liseré noir continu de 1 px
      prev = y;
    }
    g.fillStyle = COL.dirt;
    g.fillRect(0, C.SCENE_H - 6, C.W, 6);
  }

  /** Ajoute un segment à la trace noire (1 px) d'un tir ; le calque de fond la garde jusqu'à la fin de la manche. */
  trace(from, to) {
    const g = this.bgx;
    g.fillStyle = COL.line;
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
    for (let i = 0; i <= n; i++) g.fillRect(Math.round(from[0] + (dx * i) / n), Math.round(from[1] + (dy * i) / n), 1, 1);
  }

  /**
   * @param {{angles:[number,number], hp:[number,number], shell:?{x:number,y:number}, blasts:Array, time:number, activeSide:?number}} v
   */
  draw(v) {
    const ctx = this.ctx;
    ctx.drawImage(this.bg, 0, 0);
    if (!this.round) return;
    for (const side of [LEFT, RIGHT]) this.castle(ctx, side, v);
    for (const side of [LEFT, RIGHT]) if (v.hp[side] > 0) this.cannon(ctx, side, v.angles[side]);
    if (v.shell) {
      ctx.fillStyle = COL.line;
      ctx.fillRect(Math.round(v.shell.x) - 1, Math.round(v.shell.y) - 1, 3, 3);
    }
    for (const b of v.blasts) this.blast(ctx, b);
  }

  castle(ctx, side, v) {
    const cx = this.round.castles[side];
    const base = Math.round(castleY(this.round, side));
    const left = cx - C.CASTLE_HW;
    if (v.hp[side] <= 0) {
      ctx.fillStyle = COL.brickDark;
      for (let i = 0; i < 9; i++) ctx.fillRect(left + i * 4 + (i % 2), base - 6 - ((i * 7) % 9), 6, 8 + ((i * 3) % 5));
      ctx.fillStyle = COL.smoke;
      const puff = Math.floor(v.time / 120) % 3;
      ctx.fillRect(cx - 4 + puff * 3, base - 22 - puff * 4, 6, 6);
      ctx.fillRect(cx + 2 - puff * 2, base - 32 - puff * 5, 4, 4);
      return;
    }
    const top = base - C.CASTLE_H;
    ctx.fillStyle = COL.brick;
    ctx.fillRect(left, top, C.CASTLE_HW * 2, C.CASTLE_H);
    ctx.fillStyle = COL.line;
    for (let row = 0; row < 5; row++) {                                      // joints noirs, un rang sur deux décalé
      ctx.fillRect(left, top + row * 8, C.CASTLE_HW * 2, 1);
      for (let x = (row % 2) * 8; x < C.CASTLE_HW * 2; x += 16) ctx.fillRect(left + x, top + row * 8, 1, 8);
    }
    ctx.fillRect(left, top, 1, C.CASTLE_H);
    ctx.fillRect(left + C.CASTLE_HW * 2 - 1, top, 1, C.CASTLE_H);
    ctx.fillStyle = COL.skyA;
    for (let i = 0; i < 4; i++) ctx.fillRect(left + 4 + i * 10 - 3, top - 5, 6, 5);   // créneaux
    ctx.fillStyle = COL.brick;
    for (let i = 0; i < 5; i++) ctx.fillRect(left + i * 10 - (i === 4 ? 2 : 0), top - 5, i === 4 ? 2 : 4, 5);
    ctx.fillStyle = COL.line;
    ctx.fillRect(left, top - 5, 1, 5);
    ctx.fillRect(left + C.CASTLE_HW * 2 - 1, top - 5, 1, 5);
    const doorX = cx - 5;                                                    // porte arquée marron
    ctx.fillStyle = COL.door;
    ctx.fillRect(doorX, base - 14, 10, 14);
    ctx.fillRect(doorX + 1, base - 16, 8, 2);
    ctx.fillRect(doorX + 3, base - 17, 4, 1);
    ctx.fillStyle = COL.line;
    ctx.fillRect(doorX, base - 14, 1, 14);
    ctx.fillRect(doorX + 9, base - 14, 1, 14);
    const px = cx - dirOf(side) * 14;                                        // mât et fanion orange, côté opposé au canon
    ctx.fillStyle = COL.line;
    ctx.fillRect(px, top - 18, 1, 14);
    ctx.fillStyle = COL.flag;
    const wave = Math.floor(v.time / 200) % 2;
    ctx.fillRect(px + (side === LEFT ? -7 : 1), top - 18, 7, 3 + wave);
    if (v.hp[side] < 100 && v.hp[side] > 0) {                                // dégâts partiels : fissures
      ctx.fillStyle = COL.line;
      const n = v.hp[side] > 66 ? 1 : 2;
      for (let i = 0; i < n; i++) ctx.fillRect(left + 6 + i * 16, top + 4 + i * 6, 1, 14);
    }
  }

  cannon(ctx, side, angle) {
    const cx = this.round.castles[side];
    const pivotY = castleY(this.round, side) - C.CASTLE_H - 2;
    const a = (angle * Math.PI) / 180;
    const tx = cx + dirOf(side) * Math.cos(a) * C.MUZZLE;
    const ty = pivotY - Math.sin(a) * C.MUZZLE;
    ctx.strokeStyle = COL.line;
    ctx.lineWidth = 4;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(cx, pivotY);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.fillStyle = COL.line;
    ctx.fillRect(cx - 4, pivotY - 3, 8, 6);
  }

  /** Explosion : disques concentriques qui grossissent puis s'éteignent (b.age en images, b.size en px). */
  blast(ctx, b) {
    const k = b.age / b.life;
    if (k >= 1) return;
    const r = Math.max(2, b.size * Math.sqrt(k));
    const palette = k < 0.35 ? ['#fff3a0', '#ffd23c', '#ff8a1c'] : k < 0.7 ? ['#ffb02e', '#e8431b', '#7a1d0e'] : ['#6b2a1a', '#444', '#222'];
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = palette[i];
      const rr = Math.round(r * (1 - i * 0.28));
      ctx.fillRect(Math.round(b.x - rr), Math.round(b.y - rr * 0.7), rr * 2, Math.round(rr * 1.4));
    }
    for (let i = 0; i < b.debris; i++) {
      const ang = (i / b.debris) * Math.PI * 2 + b.x;
      ctx.fillStyle = '#333';
      ctx.fillRect(Math.round(b.x + Math.cos(ang) * r * 1.3), Math.round(b.y + Math.sin(ang) * r * 0.9 - k * 14), 2, 2);
    }
  }
}

/** Fanion rouge du vent : plus il est tendu et agité, plus le vent est fort (pas de valeur numérique affichée). */
export function drawWind(canvas, wind, time) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const poleX = w / 2;
  ctx.fillStyle = '#000';
  ctx.fillRect(poleX, 3, 2, h - 3);
  const strength = Math.min(1, Math.abs(wind) / C.WIND_MAX);
  const dir = wind >= 0 ? 1 : -1;
  const len = Math.round(6 + strength * (w / 2 - 8));
  const speed = 0.004 + strength * 0.012;
  ctx.fillStyle = '#d4231f';
  for (let i = 0; i < len; i++) {
    const wave = Math.sin(time * speed - i * 0.55) * (1 + strength * 3) * (i / len);
    const droop = (1 - strength) * i * 0.35;
    ctx.fillRect(poleX + 2 + (dir > 0 ? i : -i - 3), Math.round(4 + wave + droop), 1, 7 - Math.round(i / len * 3));
  }
}

/** Vignette du canon (angle) : le fût pivote en temps réel. */
export function drawCannonThumb(canvas, angle, side) {
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  ctx.fillStyle = '#b8d9f7';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = COL.grassA;
  ctx.fillRect(0, h - 8, w, 8);
  const a = (angle * Math.PI) / 180;
  const px = side === LEFT ? 8 : w - 8;
  const py = h - 12;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px + dirOf(side) * Math.cos(a) * (w - 18), py - Math.sin(a) * (w - 18));
  ctx.stroke();
  ctx.fillStyle = '#000';
  ctx.fillRect(px - 5, py - 3, 10, 9);
}

/** Vignette du tas de poudre noire : son volume grossit avec la charge. */
export function drawPowderThumb(canvas, powder) {
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  ctx.fillStyle = '#d9d2c0';
  ctx.fillRect(0, 0, w, h);
  const rows = Math.max(1, Math.round((powder / C.MAX_POWDER) * (h - 8) / 3));
  ctx.fillStyle = '#111';
  for (let r = 0; r < rows; r++) {
    const width = Math.max(4, Math.round((w - 6) * (1 - r / (rows + 3))));
    ctx.fillRect(Math.round((w - width) / 2), h - 4 - (r + 1) * 3, width, 3);
  }
}

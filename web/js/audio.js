// Hillshot — sons synthétisés (aucun fichier audio) : tir sourd du canon, sifflement de l'obus, explosion basse résolution.
// Les navigateurs exigent un geste utilisateur : unlock().
let ctx = null;
let muted = false;
let whistle = null;
try { muted = localStorage.getItem('hillshot.muted') === '1'; } catch { /* ignoré */ }

export function unlock() {
  if (ctx || typeof AudioContext === 'undefined') {
    if (ctx?.state === 'suspended') ctx.resume();
    return;
  }
  ctx = new AudioContext();
}

export const isMuted = () => muted;

export function setMuted(m) {
  muted = m;
  if (m) stopWhistle();
  try { localStorage.setItem('hillshot.muted', m ? '1' : '0'); } catch { /* ignoré */ }
}

function tone(freq, dur, { type = 'sine', gain = 0.18, slide = 0, delay = 0 } = {}) {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** Bruit blanc filtré (le filtre passe-bas descend de `from` à `to` Hz). */
function noise(dur, { from = 1500, to = 150, gain = 0.3, delay = 0 } = {}) {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime + delay;
  const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(from, t0);
  filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(g).connect(ctx.destination);
  src.start(t0);
}

/** Sifflement de l'obus : la fréquence suit l'altitude (y : 0 en haut, 380 au sol). */
export function startWhistle() {
  stopWhistle();
  if (!ctx || muted) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 400;
  g.gain.value = 0.05;
  osc.connect(g).connect(ctx.destination);
  osc.start();
  whistle = { osc, g };
}

export function updateWhistle(y) {
  if (!whistle || !ctx) return;
  const k = Math.max(0, Math.min(1, 1 - y / 380));
  whistle.osc.frequency.setTargetAtTime(220 + k * 900, ctx.currentTime, 0.02);
}

export function stopWhistle() {
  if (!whistle) return;
  try { whistle.osc.stop(); } catch { /* déjà arrêté */ }
  whistle = null;
}

export function play(name) {
  switch (name) {
    case 'fire': noise(0.28, { from: 500, to: 80, gain: 0.5 }); tone(90, 0.25, { type: 'square', gain: 0.18, slide: -50 }); break;
    case 'boom': noise(0.8, { from: 1400, to: 90, gain: 0.55 }); tone(60, 0.6, { type: 'sawtooth', gain: 0.2, slide: -30 }); break;
    case 'thud': noise(0.18, { from: 400, to: 80, gain: 0.3 }); break;
    case 'click': tone(660, 0.05, { type: 'square', gain: 0.07 }); break;
    case 'win': [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, { type: 'square', gain: 0.1, delay: i * 0.12 })); break;
    case 'lose': [392, 330, 262].forEach((f, i) => tone(f, 0.22, { type: 'square', gain: 0.1, delay: i * 0.16 })); break;
    default: break;
  }
}

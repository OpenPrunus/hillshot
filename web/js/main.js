// Hillshot — application : menus, tour par tour (contre l'ordinateur, à deux sur le même écran, en ligne), réglage des tirs,
// animation des obus. Les modes locaux utilisent le moteur JavaScript ; en ligne, le serveur calcule chaque vol et le client l'anime.
import { C, LEFT, RIGHT, createDuel, fire, generateRound, nextRound, clampShot } from './engine.js';
import { createAI, seeded } from './ai.js';
import * as i18n from './i18n.js';
import * as audio from './audio.js';
import { Scene, drawWind, drawCannonThumb, drawPowderThumb } from './render.js';
import { Net, playerToken } from './net.js';
import { layoutFor } from './layout.js';

const { t } = i18n;
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const STEP_MS = 1000 / 60;               // un pas de balistique = 1/60 s, comme sur le serveur
const AI_THINK_MS = 1100;                // l'ordinateur « réfléchit » un instant avant de tirer
const AFTER_FLIGHT_MS = 1400;            // pause sur l'explosion avant la suite (modes locaux)
const REPEAT_FIRST_MS = 500;             // maintien d'une flèche : 80 ms pendant 500 ms, puis 25 ms
const SCENE_BASE_H = 22 + 20 + 380 + 118 + 2;

const scene = new Scene($('#scene'));
const windCanvas = $('#wind');
const panels = { quit: $('#quit-dialog'), menu: $('#menu'), online: $('#online'), over: $('#over'), help: $('#help'), names: $('#names-dialog'), leaders: $('#leaders') };

// ---------------------------------------------------------------- réglages
const opts = { level: 'normal', target: 5, mode: 'classic', names: ['', ''], nick: '' };
try { Object.assign(opts, JSON.parse(localStorage.getItem('hillshot.opts') ?? '{}')); } catch { /* réglages illisibles */ }
const saveOpts = () => { try { localStorage.setItem('hillshot.opts', JSON.stringify(opts)); } catch { /* ignoré */ } };

// ---------------------------------------------------------------- état
const app = {
  mode: null,          // null | 'ai' | 'local' | 'online'
  duel: null,          // moteur (modes locaux)
  ai: null,
  rand: seeded(1),
  names: ['', ''],      // noms saisis ou pseudos en ligne ; vide = nom par défaut (traduit à l'affichage)
  nameKeys: [null, null],
  round: null,
  hp: [100, 100],
  score: [0, 0],
  target: C.TARGET,
  turn: LEFT,
  phase: 'idle',       // idle | aim | fly | wait | over
  shots: [{ angle: 45, powder: 150 }, { angle: 45, powder: 150 }],
  anim: null,
  blasts: [],
  banner: '',
  left: 0,             // secondes restantes (en ligne)
  deadline: 0,
  mySide: LEFT,
  queue: [],           // messages serveur reçus pendant une animation
  timers: [],
  acc: 0,
  last: 0,
  over: null,
};
const online = { status: 'idle', me: null, players: [], invite: null, ranked: false, oppLeft: false };

/** Nom affiché d'un joueur : le pseudo, sinon le nom par défaut dans la langue courante (« Toi » / « You », « Mac »…). */
const nameOf = (side) => app.names[side] || (app.nameKeys[side] ? t(app.nameKeys[side]) : '');
const isYou = (side) => !app.names[side] && app.nameKeys[side] === 'you';

const later = (fn, ms) => { const id = setTimeout(fn, ms); app.timers.push(id); return id; };
const clearTimers = () => { app.timers.forEach(clearTimeout); app.timers = []; };

// ---------------------------------------------------------------- panneaux et menus
function showPanel(name) {
  for (const [key, el] of Object.entries(panels)) el.hidden = key !== name;
}
const hidePanels = () => showPanel('');

function closeMenus() {
  for (const ul of $$('.menu ul')) ul.hidden = true;
  for (const b of $$('.menu > button')) b.classList.remove('open');
}

document.addEventListener('click', (e) => {
  const trigger = e.target instanceof Element ? e.target.closest('.menu > button') : null;
  if (trigger) {
    const ul = trigger.nextElementSibling;
    const wasOpen = !ul.hidden;
    closeMenus();
    ul.hidden = wasOpen;
    trigger.classList.toggle('open', !wasOpen);
    audio.unlock();
    return;
  }
  closeMenus();
});

function refreshLabels() {
  i18n.apply(document);
  $('#opt-sound').textContent = `${t('sound')} : ${audio.isMuted() ? t('off') : t('on')}`;
  $('#opt-lang').textContent = `${t('language')} : ${i18n.getLang().toUpperCase()}`;
  $('#opt-mode').textContent = `${t('mode')} : ${t(opts.mode === 'health' ? 'modeHealth' : 'modeClassic')}`;
  $('#sel-level').value = opts.level;
  $('#sel-target').value = String(opts.target);
  $('#nick').value = opts.nick ?? '';
  if (['lobby', 'queued', 'waiting'].includes(online.status)) renderLobby();
  renderHud();
}

// ---------------------------------------------------------------- réglage du tir (compteurs, clavier, molette)
const LIMITS = { angle: C.MAX_ANGLE, powder: C.MAX_POWDER };

/** Le joueur dont les compteurs sont actifs : celui dont c'est le tour et qui est une personne à ce clavier. */
function controlledSide() {
  if (app.phase !== 'aim') return null;
  if (app.mode === 'local') return app.turn;
  if (app.mode === 'ai') return app.turn === LEFT ? LEFT : null;
  if (app.mode === 'online') return app.turn === app.mySide ? app.mySide : null;
  return null;
}

function adjust(side, key, delta) {
  if (document.activeElement instanceof HTMLInputElement && document.activeElement.classList.contains('val')) document.activeElement.blur();
  const s = app.shots[side];
  s[key] = Math.max(0, Math.min(LIMITS[key], s[key] + delta));
  renderHud();
}

/** Le côté dont les compteurs restent affichés sur téléphone : le mien (en ligne, ou contre l'ordinateur), sinon celui qui joue. */
function mineSide() {
  if (app.mode === 'online') return app.mySide;
  if (app.mode === 'local') return app.turn;
  return LEFT;
}

function renderHud() {
  const active = controlledSide();
  for (const side of [LEFT, RIGHT]) {
    const s = app.shots[side];
    for (const key of ['angle', 'powder']) {
      const field = $(`#v-${key}-${side}`);
      if (document.activeElement !== field) field.value = String(s[key]);          // pas pendant la saisie
      field.readOnly = active !== side;
    }
    drawCannonThumb($(`#t-angle-${side}`), s.angle, side);
    drawPowderThumb($(`#t-powder-${side}`), s.powder);
    const hidden = app.mode === 'online' && side !== app.mySide && app.phase === 'aim';
    $(`#v-angle-${side}`).title = hidden ? '' : `${s.angle}°`;
    for (const col of $$(`.col[data-p="${side}"]`)) {
      col.classList.toggle('mine', side === mineSide());
      col.classList.toggle('active', active === side);
      col.classList.toggle('idle', active !== side && app.mode !== null);
      for (const b of col.querySelectorAll('.step')) b.disabled = active !== side;
    }
  }
  $('#score-0').textContent = String(app.score[0]);
  $('#score-1').textContent = String(app.score[1]);
  $('#name-0').textContent = nameOf(0);
  $('#name-1').textContent = nameOf(1);
  const showHp = app.mode !== null && (app.duel?.mode ?? app.modeName) === 'health';
  for (const side of [LEFT, RIGHT]) $(`#hp-${side}`).textContent = showHp ? `${app.hp[side]}%` : '';
  $('#fire').disabled = active === null;
  $('#menu-quit').disabled = app.mode === null;
  $('#turn-info').textContent = turnText();
  $('#ping').textContent = app.mode === 'online' && net.pingMs !== null ? t('ping', { ms: net.pingMs }) : '';
}

function turnText() {
  if (app.mode === null || app.phase === 'over' || app.phase === 'idle') return '';
  if (app.phase === 'fly' || app.phase === 'wait') return app.phase === 'fly' ? t('flying') : '';
  if (app.mode === 'online') return app.turn === app.mySide ? t('yourTurn', { s: Math.max(0, app.left) }) : t('turnOf', { name: nameOf(app.turn) });
  return isYou(app.turn) ? t('yourTurnPlain') : t('turnOf', { name: nameOf(app.turn) });
}

/** Champs de saisie : on tape la valeur ; elle est bornée (0-90°, 0-400 g) et appliquée tout de suite. Entrée valide, Échap annule la saisie. */
function setupFields() {
  for (const field of $$('.val')) {
    const [, key, sideText] = field.id.split('-');
    const side = Number(sideText);
    field.addEventListener('focus', () => { audio.unlock(); if (!field.readOnly) field.select(); });
    field.addEventListener('input', () => {
      if (field.readOnly) return;
      const digits = field.value.replace(/\D/g, '').slice(0, 3);
      if (digits !== field.value) field.value = digits;
      if (digits === '') return;
      app.shots[side][key] = Math.min(LIMITS[key], Number(digits));
      const s = app.shots[side];
      drawCannonThumb($(`#t-angle-${side}`), s.angle, side);
      drawPowderThumb($(`#t-powder-${side}`), s.powder);
    });
    const commit = () => { field.value = String(app.shots[side][key]); renderHud(); };
    field.addEventListener('change', commit);
    field.addEventListener('blur', commit);
  }
}

function setupSteppers() {
  for (const btn of $$('.step')) {
    const side = Number(btn.closest('.col').dataset.p);
    const { k, d } = btn.dataset;
    let timer = null;
    const stop = () => { clearTimeout(timer); timer = null; btn.classList.remove('down'); };
    btn.addEventListener('pointerdown', (e) => {
      audio.unlock();
      if (controlledSide() !== side) return;
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      const t0 = performance.now();
      const go = () => {
        if (controlledSide() !== side) return stop();
        adjust(side, k, Number(d));
        timer = setTimeout(go, performance.now() - t0 < REPEAT_FIRST_MS ? 80 : 25);     // horloge réelle : ne dépend pas de la machine
      };
      go();
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(ev, stop);
  }
  for (const col of $$('.col')) {
    const side = Number(col.dataset.p);
    col.addEventListener('wheel', (e) => {
      if (controlledSide() !== side) return;
      e.preventDefault();
      const key = col.querySelector('.step').dataset.k;
      adjust(side, key, e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
  }
}

const normKey = (e) => (e.key.length === 1 ? e.key.toLowerCase() : e.key);
window.addEventListener('keydown', (e) => {
  const inField = e.target instanceof HTMLInputElement && e.target.classList.contains('val');
  if ((e.target instanceof HTMLInputElement && !inField) || e.target instanceof HTMLSelectElement) return;
  audio.unlock();
  const k = normKey(e);
  if (inField && (k === 'Enter' || k === 'Escape')) {              // fin de saisie ; Espace ou Entrée tirent ensuite
    e.preventDefault();
    e.target.blur();
    return;
  }
  if (inField && !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) return;      // chiffres, effacement, tabulation
  if (k === 'Escape' && app.mode !== null) {
    e.preventDefault();
    if (panels.quit.hidden) askQuit(); else showPanel('');
    return;
  }
  const side = controlledSide();
  if (side === null || !panels.quit.hidden) return;
  const big = e.shiftKey;
  const map = {
    ArrowUp: ['angle', big ? 5 : 1], w: ['angle', big ? 5 : 1], z: ['angle', big ? 5 : 1],
    ArrowDown: ['angle', big ? -5 : -1], s: ['angle', big ? -5 : -1],
    ArrowRight: ['powder', big ? 10 : 1], d: ['powder', big ? 10 : 1],
    ArrowLeft: ['powder', big ? -10 : -1], a: ['powder', big ? -10 : -1], q: ['powder', big ? -10 : -1],
  };
  if (map[k]) {
    e.preventDefault();
    adjust(side, map[k][0], map[k][1]);
  } else if ((k === ' ' || k === 'Enter') && !e.repeat) {
    e.preventDefault();
    doFire();
  }
});

$('#fire').addEventListener('click', () => { audio.unlock(); doFire(); });

function doFire() {
  const side = controlledSide();
  if (side === null) return;
  const shot = clampShot(app.shots[side]);
  if (app.mode === 'online') {
    app.phase = 'wait';
    net.sendFire(shot);
    renderHud();
  } else {
    shootLocal(side, shot);
  }
}

// ---------------------------------------------------------------- manches et tirs : modes locaux
function startLocal(mode) {
  closeOnlineSession();
  clearTimers();
  app.mode = mode;
  app.rand = seeded((Math.random() * 2 ** 31) | 0);
  app.duel = createDuel({ target: Number(opts.target), mode: opts.mode, round: generateRound(app.rand), first: app.rand() < 0.5 ? LEFT : RIGHT });
  app.ai = mode === 'ai' ? createAI(RIGHT, opts.level, (Math.random() * 2 ** 31) | 0) : null;
  app.names = [opts.names[0] || '', mode === 'ai' ? '' : opts.names[1] || ''];
  app.nameKeys = mode === 'ai' ? ['you', 'cpu'] : ['player1', 'player2'];
  app.target = app.duel.target;
  app.modeName = opts.mode;
  app.score = [0, 0];
  app.over = null;
  hidePanels();
  beginRound(app.duel.round, app.duel.turn, [100, 100], 1);
}

function beginRound(round, turn, hp, number) {
  app.round = round;
  app.hp = [...hp];
  app.turn = turn;
  app.anim = null;
  app.blasts = [];
  app.phase = 'aim';
  scene.setRound(round);
  showBanner(t('roundNumber', { n: number }), 1500);
  renderHud();
  if (app.mode !== 'online') scheduleAI();
}

function scheduleAI() {
  if (app.mode !== 'ai' || app.turn !== RIGHT || app.phase !== 'aim') return;
  later(() => {
    if (app.mode !== 'ai' || app.phase !== 'aim' || app.turn !== RIGHT) return;
    const shot = clampShot(app.ai.decide(app.duel));
    app.shots[RIGHT] = { ...shot };                       // les compteurs de l'ordinateur bougent avant le tir
    renderHud();
    later(() => shootLocal(RIGHT, shot), 500);
  }, AI_THINK_MS);
}

function shootLocal(side, shot) {
  if (app.phase !== 'aim' || app.duel.turn !== side) return;
  const out = fire(app.duel, shot);
  app.ai?.observe(app.duel.round, out.trajectory);
  startFlight(out.by, out.shot, out.trajectory, { hp: out.hp, score: [...app.duel.score], over: out.roundOver, rw: out.roundWinner });
}

function afterFlightLocal(res) {
  const duel = app.duel;
  app.hp = res.hp;
  app.score = res.score;
  if (duel.winner !== null) return showOver(duel.winner, false);
  if (res.over) {
    showBanner(roundText(res), 2200);
    later(() => {
      nextRound(duel, generateRound(app.rand));
      beginRound(duel.round, duel.turn, [100, 100], duel.roundNumber);
    }, 2300);
    return undefined;
  }
  app.turn = duel.turn;
  app.phase = 'aim';
  renderHud();
  scheduleAI();
  return undefined;
}

function roundText(res) {
  const loser = 1 - res.rw;
  const by = res.by ?? app.anim?.side;
  if (isYou(loser)) return t(by === loser ? 'roundSelfYou' : 'roundDestroyedYou');
  return t(by === loser ? 'roundSelf' : 'roundDestroyed', { name: nameOf(loser) });
}

let bannerTimer = 0;
function showBanner(text, ms) {
  const el = $('#banner');
  el.replaceChildren();
  const span = document.createElement('span');
  span.textContent = text;
  el.append(span);
  el.hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// ---------------------------------------------------------------- animation d'un obus
function startFlight(side, shot, trajectory, result) {
  app.shots[side] = { angle: shot.angle, powder: shot.powder };
  app.phase = 'fly';
  app.anim = { side, path: trajectory.path, fate: trajectory.fate, hit: trajectory.hit, i: 0, result: { ...result, by: side }, ended: false };
  app.acc = 0;
  audio.play('fire');
  audio.startWhistle();
  renderHud();
}

function advanceFlight(dt) {
  const a = app.anim;
  if (!a || a.ended) return;
  app.acc += dt;
  while (app.acc >= STEP_MS && !a.ended) {
    app.acc -= STEP_MS;
    const from = a.path[a.i];
    a.i++;
    const to = a.path[a.i];
    if (!to) { endFlight(a); return; }
    scene.trace(from, to);
    audio.updateWhistle(to[1]);
    if (a.i >= a.path.length - 1) endFlight(a);
  }
}

function endFlight(a) {
  a.ended = true;
  audio.stopWhistle();
  const [x, y] = a.path[a.path.length - 1];
  if (a.fate === 'castle') {
    app.blasts.push({ x, y, age: 0, life: 70, size: 34, debris: 10 });
    audio.play('boom');
  } else if (a.fate === 'ground') {
    app.blasts.push({ x, y, age: 0, life: 36, size: 12, debris: 4 });
    audio.play('thud');
  }
  later(() => {
    const res = a.result;
    app.anim = null;
    if (app.mode === 'online') {
      app.hp = res.hp;
      app.score = res.score;
      if (res.over) showBanner(roundText(res), 2200);
      app.phase = 'wait';
      renderHud();
      flushQueue();
    } else {
      afterFlightLocal(res);
    }
  }, a.fate === 'castle' ? AFTER_FLIGHT_MS + 500 : AFTER_FLIGHT_MS);
}

// ---------------------------------------------------------------- fin de partie (modes locaux)
function showOver(winner, forfeit) {
  app.phase = 'over';
  clearTimers();
  const humanWon = app.mode === 'ai' ? winner === LEFT : true;
  $('#over-title').textContent = app.mode === 'ai' ? t(humanWon ? 'youWin' : 'youLose') : t('playerWins', { name: nameOf(winner) });
  $('#over-detail').textContent = `${app.score[0]} – ${app.score[1]}`;
  $('#over-again').textContent = t('playAgain');
  $('#over-again').disabled = false;
  $('#over-again').dataset.action = 'again';
  audio.play(humanWon ? 'win' : 'lose');
  later(() => showPanel('over'), forfeit ? 100 : 700);
  renderHud();
}

/** Quitter la partie en cours (menu Fichier, case de fermeture ou Échap) : confirmation, car en ligne c'est un forfait. */
function askQuit() {
  if (app.mode === null) return;
  if (app.phase === 'over') {
    document.querySelector('#over [data-action=quit]').click();
    return;
  }
  $('#quit-text').textContent = t(app.mode === 'online' ? 'confirmQuitOnline' : 'confirmQuit');
  showPanel('quit');
}

function endSession() {
  clearTimers();
  audio.stopWhistle();
  closeOnlineSession();
  app.mode = null;
  app.phase = 'idle';
  app.anim = null;
  app.duel = null;
  app.blasts = [];
  $('#banner').hidden = true;
  scene.setRound(IDLE_ROUND);
  app.round = IDLE_ROUND;
  app.hp = [100, 100];
  app.score = [0, 0];
  app.names = ['', ''];
  app.nameKeys = [null, null];
  showPanel('menu');
  renderHud();
}

// ---------------------------------------------------------------- mode en ligne
const net = new Net({
  onopen: () => {
    online.status = 'hello';
    setOnlineStatus('');
    $('#join').hidden = false;
    $('#lobby').hidden = true;
    $('#nick').focus();
  },
  onmessage: onServerMessage,
  onclose: (wasOpen) => {
    const inMatch = app.mode === 'online';
    closeOnlineSession();
    online.status = 'idle';
    if (inMatch || !panels.online.hidden || wasOpen) {
      resetBoard();
      showPanel('online');
      $('#join').hidden = true;
      $('#lobby').hidden = true;
      setOnlineStatus(t(wasOpen ? 'disconnected' : 'unreachable'), true);
    }
  },
});

function setOnlineStatus(text, error = false) {
  const el = $('#online-status');
  el.textContent = text;
  el.classList.toggle('error', error);
}

function resetBoard() {
  clearTimers();
  audio.stopWhistle();
  app.mode = null;
  app.phase = 'idle';
  app.anim = null;
  app.blasts = [];
  app.round = IDLE_ROUND;
  scene.setRound(IDLE_ROUND);
  app.names = ['', ''];
  app.nameKeys = [null, null];
  app.score = [0, 0];
  app.hp = [100, 100];
  renderHud();
}

function openOnline() {
  closeOnlineSession();
  resetBoard();
  showPanel('online');
  online.status = 'connecting';
  $('#join').hidden = true;
  $('#lobby').hidden = true;
  $('#invite').hidden = true;
  setOnlineStatus(t('connecting'));
  net.connect();
}

function closeOnlineSession() {
  if (app.mode === 'online') app.mode = null;
  app.queue = [];
  online.invite = null;
}

function leaveOnline() {
  net.close();
  closeOnlineSession();
  online.status = 'idle';
  showPanel('menu');
}

const ERRORS = { bad_name: 'errName', name_taken: 'errTaken', busy: 'errBusy', rate: 'errRate', full: 'errFull', not_ready: 'errGeneric', not_your_turn: 'errTurn', bad_shot: 'errShot' };

/** Les messages du déroulement du match attendent la fin de l'animation en cours, pour rester dans l'ordre. */
const SEQUENCED = new Set(['turn', 'round', 'result']);

function onServerMessage(m) {
  if (SEQUENCED.has(m.t) && (app.anim || app.phase === 'fly')) {
    app.queue.push(m);
    return;
  }
  handle(m);
}

function flushQueue() {
  while (app.queue.length > 0 && !app.anim) handle(app.queue.shift());
}

function handle(m) {
  switch (m.t) {
    case 'welcome':
      online.me = m;
      online.status = 'lobby';
      opts.nick = m.name;
      saveOpts();
      $('#join').hidden = true;
      $('#lobby').hidden = false;
      setOnlineStatus('');
      renderLobby();
      loadBoard($('#board'), 4);
      break;
    case 'lobby':
      online.players = m.players;
      if (['lobby', 'queued', 'waiting'].includes(online.status)) renderLobby();
      break;
    case 'queued': online.status = 'queued'; renderLobby(); break;
    case 'unqueued': online.status = 'lobby'; renderLobby(); break;
    case 'waiting': online.status = 'waiting'; setOnlineStatus(t('waitingAnswer', { name: m.name })); break;
    case 'invite':
      online.invite = m;
      $('#invite-text').textContent = t('invitedYou', { name: m.name });
      $('#invite').hidden = false;
      audio.play('click');
      break;
    case 'invite_cancel':
      online.invite = null;
      $('#invite').hidden = true;
      if (online.status === 'waiting') online.status = 'lobby';
      renderLobby();
      break;
    case 'declined': online.status = 'lobby'; renderLobby(); setOnlineStatus(t('declined', { name: m.name })); break;
    case 'match': startOnlineMatch(m); break;
    case 'round': onRound(m); break;
    case 'turn': onTurn(m); break;
    case 'shot': onShot(m); break;
    case 'result': onResult(m); break;
    case 'oppleft': online.oppLeft = true; $('#over-again').disabled = true; break;
    case 'left': backToLobby(); break;
    case 'error':
      setOnlineStatus(t(ERRORS[m.code] ?? 'errGeneric'), true);
      if (online.status === 'waiting') online.status = 'lobby';
      if (app.mode === 'online') { if (app.phase === 'wait') app.phase = 'aim'; renderHud(); } else renderLobby();
      break;
    default: break;
  }
}

function startOnlineMatch(m) {
  clearTimers();
  app.mode = 'online';
  app.duel = null;
  app.phase = 'wait';
  app.over = null;
  app.mySide = m.side;
  app.target = m.target;
  app.modeName = m.mode;
  app.queue = [];
  online.status = 'playing';
  online.ranked = m.ranked;
  online.oppLeft = false;
  online.invite = null;
  const me = online.me?.name ?? '';
  app.names = m.side === LEFT ? [me, m.opp.name] : [m.opp.name, me];
  app.nameKeys = m.side === LEFT ? ['you', null] : [null, 'you'];
  app.score = [0, 0];
  app.shots = [{ angle: 45, powder: 150 }, { angle: 45, powder: 150 }];
  hidePanels();
  audio.unlock();
}

function onRound(m) {
  if (app.mode !== 'online') return;
  app.left = m.left;
  app.deadline = performance.now() + m.left * 1000;
  beginRound(m.round, m.turn, m.hp, m.n);
  app.score = m.score;
  renderHud();
}

function onTurn(m) {
  if (app.mode !== 'online') return;
  app.turn = m.turn;
  app.left = m.left;
  app.deadline = performance.now() + m.left * 1000;
  app.phase = 'aim';
  renderHud();
}

function onShot(m) {
  if (app.mode !== 'online') return;
  startFlight(m.by, { angle: m.a, powder: m.p }, { path: m.path, fate: m.fate, hit: m.hit }, { hp: m.hp, score: m.score, over: m.over, rw: m.rw });
}

function onResult(m) {
  app.over = m;
  app.phase = 'over';
  const mine = m.winner === app.mySide;
  const delay = m.forfeit ? 200 : 800;
  later(() => {
    if (app.mode !== 'online' || app.over !== m) return;
    $('#over-title').textContent = t(mine ? 'youWin' : 'youLose');
    const rating = m.delta !== undefined ? t('ratingDelta', { rating: m.rating, delta: (m.delta >= 0 ? '+' : '') + m.delta }) : (m.forfeit ? '' : t(m.ranked ? 'ranked' : 'unranked'));
    $('#over-detail').textContent = [`${m.score[0]} – ${m.score[1]}`, m.forfeit && mine ? t('oppLeft') : '', rating].filter(Boolean).join(' · ');
    $('#over-again').textContent = t('rematch');
    $('#over-again').disabled = online.oppLeft;
    $('#over-again').dataset.action = 'rematch';
    showPanel('over');
  }, delay);
  if (!m.forfeit) audio.play(mine ? 'win' : 'lose');
  renderHud();
}

function backToLobby() {
  resetBoard();
  online.status = 'lobby';
  showPanel('online');
  $('#lobby').hidden = false;
  $('#join').hidden = true;
  renderLobby();
  loadBoard($('#board'), 4);
}

function renderLobby() {
  const status = online.status;
  $('#quick').textContent = t(status === 'queued' ? 'cancelSearch' : 'quickMatch');
  $('#quick').disabled = status === 'waiting';
  $('#my-rating').textContent = online.me ? `${online.me.name} · ${online.me.rating ?? '—'}${online.me.ranked ? '' : ' · ' + t('unranked')}` : '';
  if (status === 'queued') setOnlineStatus(t('searching'));
  else if (status === 'lobby') setOnlineStatus('');
  const list = $('#players');
  list.replaceChildren();
  if (online.players.length === 0) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = t('nobody');
    list.append(li);
  }
  for (const p of online.players) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `${p.name}${p.rating ? ` (${p.rating})` : ''}`;
    const sub = document.createElement('span');
    sub.className = 'muted';
    sub.textContent = t({ lobby: 'waiting', queued: 'searchingState', playing: 'inMatch' }[p.status] ?? 'waiting');
    const btn = document.createElement('button');
    btn.className = 'btn small';
    btn.textContent = t('challenge');
    btn.disabled = !(p.status === 'lobby' || p.status === 'queued') || status === 'waiting';
    btn.addEventListener('click', () => net.send({ t: 'challenge', id: p.id }));
    li.append(label, sub, btn);
    list.append(li);
  }
}

async function loadBoard(body, limit = 10) {
  const message = (text) => {
    body.replaceChildren();
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.textContent = text;
    tr.append(td);
    body.append(tr);
  };
  try {
    const res = await fetch('api.php', { cache: 'no-store' });
    if (!res.ok) throw new Error('http');
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return message(t('noScores'));
    body.replaceChildren();
    for (const r of rows.slice(0, limit)) {
      const tr = document.createElement('tr');
      for (const v of [r.rank, r.name, r.rating, `${r.wins} / ${r.losses}`]) {
        const td = document.createElement('td');
        td.textContent = String(v);
        tr.append(td);
      }
      body.append(tr);
    }
  } catch {
    message(t('boardUnavailable'));
  }
  return undefined;
}

// ---------------------------------------------------------------- rendu et boucle
const IDLE_ROUND = { baseY: 330, hillH: 120, hillX: 320, sigma: 70, castles: [90, 550], wind: 0.4 };
app.round = IDLE_ROUND;
scene.setRound(IDLE_ROUND);

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(100, now - (app.last || now));
  app.last = now;
  advanceFlight(dt);
  for (const b of app.blasts) b.age++;
  app.blasts = app.blasts.filter((b) => b.age < b.life);
  if (app.mode === 'online' && app.phase === 'aim') {
    const left = Math.max(0, Math.ceil((app.deadline - now) / 1000));
    if (left !== app.left) { app.left = left; $('#turn-info').textContent = turnText(); }
  }
  const a = app.anim;
  const p = a && !a.ended ? a.path[Math.min(a.i, a.path.length - 1)] : null;
  scene.draw({
    angles: [app.shots[LEFT].angle, app.shots[RIGHT].angle],
    hp: app.hp,
    shell: p ? { x: p[0], y: p[1] } : null,
    blasts: app.blasts,
    time: now,
  });
  drawWind(windCanvas, app.round?.wind ?? 0, now);
}

// ---------------------------------------------------------------- actions de l'interface
document.addEventListener('click', (e) => {
  const el = e.target instanceof Element ? e.target.closest('[data-action]') : null;
  if (!el) return;
  audio.unlock();
  audio.play('click');
  switch (el.dataset.action) {
    case 'ai': startLocal('ai'); break;
    case 'local': startLocal('local'); break;
    case 'online': openOnline(); break;
    case 'again': startLocal(app.mode); break;
    case 'rematch': net.send({ t: 'rematch' }); $('#over-again').disabled = true; break;
    case 'quit':
      if (app.mode === 'online') { net.send({ t: 'leave' }); backToLobby(); } else endSession();
      break;
    case 'resetScores':
      if (app.mode === 'ai' || app.mode === 'local') { const mode = app.mode; startLocal(mode); showBanner(t('resetDone'), 1500); }
      break;
    case 'leaderboard': showPanel('leaders'); loadBoard($('#board-menu')); break;
    case 'closeLeaders': showPanel(app.mode === null ? 'menu' : ''); break;
    case 'names':
      $('#name1').value = opts.names[0] ?? '';
      $('#name2').value = opts.names[1] ?? '';
      showPanel('names');
      break;
    case 'toggleMode': opts.mode = opts.mode === 'health' ? 'classic' : 'health'; saveOpts(); refreshLabels(); break;
    case 'toggleSound': audio.setMuted(!audio.isMuted()); refreshLabels(); break;
    case 'toggleLang': i18n.setLang(i18n.getLang() === 'fr' ? 'en' : 'fr'); refreshLabels(); break;
    case 'help': showPanel('help'); break;
    case 'closeHelp': showPanel(app.mode === null ? 'menu' : ''); break;
    case 'askQuit': askQuit(); break;
    case 'cancelQuit': showPanel(''); break;
    default: break;
  }
});

$('#sel-level').addEventListener('change', (e) => { opts.level = e.target.value; saveOpts(); });
$('#sel-target').addEventListener('change', (e) => { opts.target = Number(e.target.value); saveOpts(); });
$('#names-form').addEventListener('submit', (e) => {
  e.preventDefault();
  opts.names = [$('#name1').value.trim().slice(0, 15), $('#name2').value.trim().slice(0, 15)];
  saveOpts();
  showPanel(app.mode === null ? 'menu' : '');
});
$('#online-back').addEventListener('click', leaveOnline);
$('#quick').addEventListener('click', () => net.send({ t: online.status === 'queued' ? 'unqueue' : 'queue' }));
$('#invite-accept').addEventListener('click', () => {
  if (online.invite) net.send({ t: 'accept', id: online.invite.id });
  $('#invite').hidden = true;
});
$('#invite-decline').addEventListener('click', () => {
  if (online.invite) net.send({ t: 'decline', id: online.invite.id });
  online.invite = null;
  $('#invite').hidden = true;
});
$('#join').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#nick').value.trim();
  if (!name) { setOnlineStatus(t('errName'), true); return; }
  audio.unlock();
  net.send({ t: 'hello', name, token: playerToken() });
});

// La fenêtre Macintosh (640 px de large) s'adapte à l'écran.
function fit() {
  const mac = $('#mac');
  const fitEl = $('#fit');
  const layout = layoutFor(window.innerWidth, window.innerHeight);
  document.body.dataset.layout = layout;
  if (layout !== 'desktop') {
    mac.style.transform = '';
    fitEl.style.width = '';
    fitEl.style.height = '';
    return;
  }
  const h = mac.offsetHeight || SCENE_BASE_H;
  const s = Math.min(window.innerWidth / 650, window.innerHeight / (h + 10));
  mac.style.transform = `scale(${s})`;
  fitEl.style.width = `${640 * s + 4}px`;
  fitEl.style.height = `${h * s + 4}px`;
}
window.addEventListener('resize', fit);
window.addEventListener('orientationchange', () => setTimeout(fit, 150));

// ---------------------------------------------------------------- démarrage
i18n.setLang(i18n.detectLang());
setupSteppers();
setupFields();
refreshLabels();
fit();
showPanel('menu');
requestAnimationFrame(frame);

// Accès pour les tests de bout en bout dans le navigateur.
window.__hillshot = { app, online, opts, net, scene };

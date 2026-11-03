// Navigateur : un vrai Chrome (headless) piloté par DevTools, sans dépendance. Le site est servi par `php -S`, le serveur de jeu
// est le vrai serveur PHP, et un robot Node joue l'adversaire en ligne.
//   npm run test:browser          (PHP_BIN et CHROME_BIN réglables ; SHOTS=/dossier enregistre des captures d'écran)
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { Bot, PHP, ROOT, freePort, sleep, startGameServer, token, waitFor } from './helpers.js';

let BASE, chrome, php, game, tmpDir, cdp, nextId = 0;
const pending = new Map();
const errors = [];

before(async () => {
  game = await startGameServer();
  const port = await freePort();
  php = spawn(PHP, ['-S', `127.0.0.1:${port}`, '-t', path.join(ROOT, 'web')], {
    env: { ...process.env, HILLSHOT_WS: game.url, HILLSHOT_DATA_DIR: game.dataDir }, stdio: 'ignore',
  });
  BASE = `http://127.0.0.1:${port}`;
  await waitFor(async () => (await fetch(`${BASE}/`)).ok, 10000, 'site PHP');
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hillshot-chrome-'));
  const dbg = await freePort();
  chrome = spawn(process.env.CHROME_BIN || 'google-chrome', [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run',
    `--remote-debugging-port=${dbg}`, `--user-data-dir=${tmpDir}`, 'about:blank',
  ], { stdio: 'ignore' });
  const tab = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${dbg}/json`)).json()).find((t) => t.type === 'page'), 15000, 'Chrome');
  cdp = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { cdp.onopen = resolve; cdp.onerror = () => reject(new Error('DevTools')); });
  cdp.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(`${m.params.entry.text} ${m.params.entry.url ?? ''}`);
  };
  await call('Page.enable'); await call('Runtime.enable'); await call('Log.enable');
});
after(() => {
  try { cdp.close(); } catch { /* déjà fermé */ }
  for (const p of [chrome, php]) { try { p?.kill(); } catch { /* déjà arrêté */ } }
  game?.stop();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignoré */ }
});

function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    cdp.send(JSON.stringify({ id, method, params }));
  });
}
async function ev(expr) {
  const r = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`page : ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
  return r.result.value;
}
async function shot(name) {
  if (!process.env.SHOTS) return;
  fs.mkdirSync(process.env.SHOTS, { recursive: true });
  const { data } = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(process.env.SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
}
const DESKTOP = { w: 1100, h: 700, touch: false };
const PHONE_LANDSCAPE = { w: 844, h: 390, touch: true };
const PHONE_PORTRAIT = { w: 390, h: 844, touch: true };

async function open(device, lang = 'fr') {
  await call('Emulation.setDeviceMetricsOverride', { width: device.w, height: device.h, deviceScaleFactor: 1, mobile: !!device.touch });
  await call('Emulation.setTouchEmulationEnabled', device.touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  await call('Storage.clearDataForOrigin', { origin: new URL(BASE).origin, storageTypes: 'local_storage' });
  await call('Page.navigate', { url: `${BASE}/` });
  await waitFor(() => ev('document.readyState === "complete" && !!window.__hillshot'), 10000, 'page chargée');
  await ev(`localStorage.setItem('hillshot.lang', ${JSON.stringify(lang)}); location.reload()`);
  await waitFor(() => ev('document.readyState === "complete" && !!window.__hillshot'), 10000, 'page rechargée');
}
const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
const KEYS = { ArrowLeft: [37, 'ArrowLeft'], ArrowUp: [38, 'ArrowUp'], ArrowRight: [39, 'ArrowRight'], ArrowDown: [40, 'ArrowDown'], Escape: [27, 'Escape'], ' ': [32, 'Space'] };
const key = (type, k) => call('Input.dispatchKeyEvent', { type, key: k, code: KEYS[k]?.[1] ?? `Key${k.toUpperCase()}`, windowsVirtualKeyCode: KEYS[k]?.[0] ?? k.toUpperCase().charCodeAt(0) });
const press = async (k, times = 1) => { for (let i = 0; i < times; i++) { await key('keyDown', k); await key('keyUp', k); } };
const rect = (sel) => ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; })()`);
const app = () => ev('(() => { const a = window.__hillshot.app; return { mode: a.mode, phase: a.phase, turn: a.turn, shots: a.shots, hp: a.hp, score: a.score, anim: !!a.anim }; })()');
const val = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).textContent`);
/** Pixels noirs du calque de fond (colline, ciel et traces des tirs) : un indicateur de ce qui a été tracé. */
const darkPixels = () => ev('(() => { const s = window.__hillshot.scene; const d = s.bgx.getImageData(0, 0, 640, 380).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 40 && d[i + 1] < 40 && d[i + 2] < 40) n++; return n; })()');
const hold = async (sel, ms) => {
  const r = await rect(sel);
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.cx, y: r.cy, button: 'left', clickCount: 1, pointerType: 'mouse' });
  await sleep(ms);
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.cx, y: r.cy, button: 'left', clickCount: 1, pointerType: 'mouse' });
};

describe('page et mode local', () => {
  test('le menu s\'affiche, sans erreur, en français puis en anglais', async () => {
    errors.length = 0;
    await open(DESKTOP);
    assert.equal(await ev('document.title'), 'Hillshot');
    assert.match(await ev('document.querySelector("#menu [data-action=ai]").textContent'), /ordinateur/);
    const c = await rect('#scene');
    assert.ok(Math.abs(c.w / c.h - 640 / 380) < 0.02, `scène 640x380 : ${c.w}x${c.h}`);
    const gh = await ev('(() => { const a = document.querySelector(".foot a.gh"); return a && { href: a.href, target: a.target, rel: a.rel, text: a.textContent.trim(), visible: a.getBoundingClientRect().height > 0 }; })()');
    assert.equal(gh.href, 'https://github.com/OpenPrunus/hillshot');
    assert.equal(gh.target, '_blank');
    assert.match(gh.rel, /noopener/);
    assert.equal(gh.text, 'Voir le projet sur GitHub');
    assert.ok(gh.visible, 'le lien est visible dans le menu');
    assert.ok(await darkPixels() > 300, 'le décor (liseré noir de la colline) est dessiné');
    await shot('01-menu');
    await click('#opt-lang');
    assert.match(await ev('document.querySelector("#menu [data-action=ai]").textContent'), /computer/);
    assert.equal(await ev('document.querySelector(".foot a.gh").textContent.trim()'), 'View the project on GitHub');
    assert.equal(await ev('document.documentElement.lang'), 'en');
    assert.deepEqual(errors, []);
  });

  test('la barre de menus Macintosh ouvre ses menus', async () => {
    await open(DESKTOP);
    assert.equal(await ev('document.querySelector(".menu ul").hidden'), true);
    await click('.menu > button[data-menu=file]');
    assert.equal(await ev('document.querySelector(".menu ul").hidden'), false);
    await click('.menu > button[data-menu=options]');
    assert.equal(await ev('document.querySelector(".menu ul").hidden'), true, 'un seul menu ouvert à la fois');
    assert.match(await val('#opt-mode'), /Classique/);
    await click('#opt-mode');
    assert.match(await val('#opt-mode'), /Santé/);
  });

  test('2 joueurs : seul le joueur dont c\'est le tour a ses compteurs actifs', async () => {
    await open(DESKTOP);
    await click('#menu [data-action=local]');
    await waitFor(async () => (await app()).phase === 'aim', 4000, 'phase de réglage');
    const a = await app();
    const disabled = (side) => ev(`[...document.querySelectorAll('.col[data-p="${side}"] .step')].every((b) => b.disabled)`);
    assert.equal(await disabled(a.turn), false);
    assert.equal(await disabled(1 - a.turn), true);
    assert.equal(await ev('document.querySelector("#fire").disabled'), false);
    await shot('02-local');
  });

  test('maintien d\'une flèche : un pas toutes les 80 ms, puis toutes les 25 ms', async () => {
    await open(DESKTOP);
    await click('#menu [data-action=local]');
    await waitFor(async () => (await app()).phase === 'aim', 4000, 'phase de réglage');
    const side = (await app()).turn;
    const sel = `.col[data-p="${side}"] .step[data-k=powder][data-d="1"]`;
    const before = Number(await val(`#v-powder-${side}`));
    await hold(sel, 150);
    const tap = Number(await val(`#v-powder-${side}`)) - before;
    assert.ok(tap >= 1 && tap <= 4, `un appui bref : ${tap} pas`);
    const b2 = Number(await val(`#v-powder-${side}`));
    await hold(sel, 1000);
    const long = Number(await val(`#v-powder-${side}`)) - b2;
    assert.ok(long >= 12 && long <= 40, `maintien d'une seconde : ${long} pas (6 à 7 pendant 500 ms, puis ~20 à 25 ms)`);
  });

  test('clavier : angle, poudre (Maj) et molette', async () => {
    await open(DESKTOP);
    await click('#menu [data-action=local]');
    await waitFor(async () => (await app()).phase === 'aim', 4000, 'phase de réglage');
    const side = (await app()).turn;
    const a0 = Number(await val(`#v-angle-${side}`));
    await press('ArrowUp', 3);
    assert.equal(Number(await val(`#v-angle-${side}`)), a0 + 3);
    await press('ArrowDown');
    assert.equal(Number(await val(`#v-angle-${side}`)), a0 + 2);
    const p0 = Number(await val(`#v-powder-${side}`));
    await press('ArrowRight', 2);
    assert.equal(Number(await val(`#v-powder-${side}`)), p0 + 2);
    await press('ArrowLeft');
    assert.equal(Number(await val(`#v-powder-${side}`)), p0 + 1);
    await ev(`document.querySelector('#v-powder-${side}').closest('.col').dispatchEvent(new WheelEvent('wheel', { deltaY: -100, cancelable: true }))`);
    assert.equal(Number(await val(`#v-powder-${side}`)), p0 + 2);
    await ev(`(() => { const a = window.__hillshot.app; a.shots[${side}].angle = 90; })()`);
    await press('ArrowUp', 3);
    assert.equal(await app().then((x) => x.shots[side].angle), 90, 'borné à 90°');
  });

  test('contre l\'ordinateur : on tire, l\'obus laisse sa trace, puis l\'ordinateur joue', async () => {
    errors.length = 0;
    await open(DESKTOP);
    await ev('window.__hillshot.opts.level = "easy"');
    await click('#menu [data-action=ai]');
    await waitFor(async () => { const a = await app(); return a.phase === 'aim' && a.turn === 0; }, 15000, 'à nous de tirer');
    const dark0 = await darkPixels();
    const roundJson = await ev('JSON.stringify(window.__hillshot.app.round)');
    await press('ArrowUp', 5);
    await press('ArrowRight', 20);
    await press(' ');
    await waitFor(async () => (await app()).phase === 'fly', 3000, 'obus en vol');
    await sleep(700);
    assert.ok(await darkPixels() > dark0 + 20, 'la trajectoire reste dessinée dans le ciel');
    await shot('03-flight');
    await waitFor(async () => { const a = await app(); return a.phase === 'aim' && a.turn === 1 || a.phase === 'fly'; }, 15000, 'tour de l\'ordinateur');
    await waitFor(async () => { const a = await app(); return a.phase === 'aim' && a.turn === 0; }, 25000, 'retour au joueur');
    const sameRound = (await ev('JSON.stringify(window.__hillshot.app.round)')) === roundJson;
    if (sameRound) assert.ok(await darkPixels() > dark0 + 40, 'les traces des deux tirs sont conservées tant que la manche dure');
    else assert.ok((await app()).score[0] + (await app()).score[1] >= 1, 'le terrain n\'a changé que parce qu\'une manche a été gagnée');
    assert.deepEqual(errors, []);
  });

  test('les noms par défaut et les messages suivent la langue, même en cours de partie', async () => {
    await open(DESKTOP, 'en');
    await ev('window.__hillshot.opts.level = "easy"');
    await click('#menu [data-action=ai]');
    await waitFor(async () => { const a = await app(); return a.phase === 'aim' && a.turn === 0; }, 20000, 'à nous de tirer');
    assert.equal(await val('#name-0'), 'You');
    assert.equal(await val('#turn-info'), 'Your turn to fire');
    await click('#opt-lang');
    assert.equal(await val('#name-0'), 'Toi', 'le nom change avec la langue');
    assert.equal(await val('#turn-info'), 'À toi de tirer');
    await click('#opt-lang');
    // un obus qui retombe sur son propre château : message à la deuxième personne, dans la langue courante
    await ev('(() => { const a = window.__hillshot.app; a.shots[0] = { angle: 90, powder: 0 }; })()');
    await press(' ');
    await waitFor(() => ev('!document.querySelector("#banner").hidden && /castle/i.test(document.querySelector("#banner").textContent)'), 12000, 'message de manche');
    assert.equal(await val('#banner'), 'You destroyed your own castle!');
  });

  test('une manche gagnée remet un nouveau terrain et efface les traces', async () => {
    await open(DESKTOP);
    await click('#menu [data-action=local]');
    await waitFor(async () => (await app()).phase === 'aim', 4000, 'phase de réglage');
    // on triche côté test : le tir du joueur actif est calculé avec le moteur pour toucher le château adverse
    const shotFound = await ev(`(async () => {
      const E = await import('./js/engine.js');
      const a = window.__hillshot.app;
      const side = a.turn;
      for (let angle = 20; angle <= 85; angle += 5) for (let powder = 0; powder <= 400; powder += 2) {
        const t = E.fly(a.duel.round, side, { angle, powder });
        if (t.fate === 'castle' && t.hit === 1 - side) { a.shots[side] = { angle, powder }; return { side, angle, powder }; }
      }
      return null;
    })()`);
    assert.ok(shotFound, 'un tir gagnant existe');
    const roundBefore = await ev('JSON.stringify(window.__hillshot.app.round)');
    await press(' ');
    await waitFor(async () => (await app()).score[shotFound.side] === 1, 12000, 'manche marquée');
    await waitFor(async () => (await ev('JSON.stringify(window.__hillshot.app.round)')) !== roundBefore, 8000, 'nouveau terrain');
    await waitFor(async () => (await app()).phase === 'aim', 5000, 'la manche suivante commence');
    assert.deepEqual((await app()).hp, [100, 100]);
  });

  test('fin de partie : l\'écran de résultat propose de rejouer', async () => {
    await open(DESKTOP);
    await ev('window.__hillshot.opts.target = 1');
    await click('#menu [data-action=local]');
    await waitFor(async () => (await app()).phase === 'aim', 4000, 'phase de réglage');
    await ev(`(async () => {
      const E = await import('./js/engine.js');
      const a = window.__hillshot.app;
      const side = a.turn;
      for (let angle = 20; angle <= 85; angle += 5) for (let powder = 0; powder <= 400; powder += 2) {
        const t = E.fly(a.duel.round, side, { angle, powder });
        if (t.fate === 'castle' && t.hit === 1 - side) { a.shots[side] = { angle, powder }; return; }
      }
    })()`);
    await press(' ');
    await waitFor(() => ev('!document.querySelector("#over").hidden'), 15000, 'écran de fin');
    assert.match(await val('#over-title'), /gagne|win/i);
    await shot('04-over');
    await click('#over-again');
    await waitFor(async () => (await app()).phase === 'aim' && (await app()).score[0] === 0, 5000, 'nouvelle partie');
  });
});

describe('affichage sur téléphone', () => {
  for (const [label, device] of [['paysage', PHONE_LANDSCAPE], ['portrait', PHONE_PORTRAIT]]) {
    test(`téléphone en ${label} : la fenêtre tient dans l\'écran, les compteurs se touchent`, async () => {
      await open(device);
      const m = await rect('#mac');
      assert.ok(m.w <= device.w + 1 && m.h <= device.h + 1, `fenêtre ${Math.round(m.w)}x${Math.round(m.h)} dans ${device.w}x${device.h}`);
      assert.equal(await ev('document.documentElement.scrollWidth <= window.innerWidth'), true, 'pas de défilement horizontal');
      const gh = await rect('.foot a.gh');
      assert.ok(gh.h >= 20);
      await click('#menu [data-action=local]');
      await waitFor(async () => (await app()).phase === 'aim', 4000, 'phase de réglage');
      const side = (await app()).turn;
      const r = await rect(`.col[data-p="${side}"] .step[data-k=angle][data-d="1"]`);
      const a0 = Number(await val(`#v-angle-${side}`));
      await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.cx, y: r.cy }] });
      await sleep(120);
      await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      assert.ok(Number(await val(`#v-angle-${side}`)) > a0, 'un appui tactile règle l\'angle');
      await shot(`05-phone-${label}`);
    });
  }
});

describe('mode en ligne avec un robot adversaire', () => {
  test('salon, partie rapide, tour par tour, animation du vol serveur, puis départ de l\'adversaire', async () => {
    errors.length = 0;
    await open(DESKTOP);
    await click('#menu [data-action=online]');
    await waitFor(() => ev('!document.querySelector("#join").hidden'), 8000, 'connexion au serveur');
    await ev('document.querySelector("#nick").value = "Humain"');
    await ev('document.querySelector("#join").requestSubmit()');
    await waitFor(() => ev('!document.querySelector("#lobby").hidden'), 5000, 'salon');
    const robot = await new Bot(game.url).open();
    await robot.hello('Robot', token('robot'));
    await waitFor(() => ev('document.querySelectorAll("#players li").length > 0 && document.querySelector("#players").textContent.includes("Robot")'), 5000, 'robot visible');
    await shot('06-lobby');
    await click('#quick');
    robot.send({ t: 'queue' });
    const match = await robot.next('match');
    await waitFor(async () => (await app()).mode === 'online', 5000, 'match');
    const round = await robot.next('round', 5000, true);
    const humanSide = 1 - match.side;
    // si le robot commence, il tire dans le sol ; l'animation du vol doit être jouée par la page
    if (round.turn === match.side) {
      robot.send({ t: 'fire', a: 45, p: 100 });
      await waitFor(async () => (await app()).anim, 4000, 'vol animé chez l\'humain');
    }
    await waitFor(async () => { const a = await app(); return a.phase === 'aim' && a.turn === humanSide; }, 15000, 'tour de l\'humain');
    assert.equal(await ev('document.querySelector("#fire").disabled'), false);
    assert.match(await val('#turn-info'), /toi de tirer|Your turn/);
    await press('ArrowUp', 4);
    await press(' ');
    await waitFor(async () => (await app()).phase === 'fly' || (await app()).phase === 'wait', 3000, 'tir envoyé');
    const shot1 = await waitFor(() => robot.of('shot').find((x) => x.by === humanSide), 5000, 'tir de l\'humain reçu par le serveur');
    assert.equal(shot1.a, 49, 'l\'angle réglé au clavier est celui du serveur');
    await shot('07-online-flight');
    await waitFor(async () => (await app()).phase === 'aim' || (await app()).turn === match.side, 15000, 'la suite du match');
    robot.send({ t: 'leave' });
    await waitFor(() => ev('!document.querySelector("#over").hidden'), 8000, 'écran de fin (forfait)');
    assert.match(await val('#over-title'), /gagné|win/i);
    assert.deepEqual(errors, []);
    robot.close();
  });
});

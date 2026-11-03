// Intégration : le VRAI serveur PHP (server/server.php) sur un vrai port, avec des clients WebSocket.
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fly } from '../web/js/engine.js';
import { Bot, startGameServer, token, waitFor } from './helpers.js';

let server;
let fast;
const bots = [];
const bot = async (name, tok, srv = server) => {
  const b = await new Bot(srv.url).open();
  bots.push(b);
  if (name) await b.hello(name, tok);
  return b;
};

before(async () => {
  server = await startGameServer({ HILLSHOT_TARGET: '1', HILLSHOT_REMATCH_TTL: '3' });
  fast = await startGameServer({ HILLSHOT_TARGET: '3', HILLSHOT_AIM_SECONDS: '2' });
});
after(() => { for (const b of bots) b.close(); server?.stop(); fast?.stop(); });

/** Un réglage qui détruit le château adverse (cherché avec le moteur JS, sur le terrain reçu du serveur). */
function winningShot(round, side) {
  for (let angle = 20; angle <= 85; angle += 5) {
    for (let powder = 0; powder <= 400; powder += 4) {
      const t = fly(round, side, { angle, powder });
      if (t.fate === 'castle' && t.hit === 1 - side) return { angle, powder };
    }
  }
  throw new Error('aucun tir gagnant');
}

/** Deux joueurs en match ; renvoie leurs bots, le côté de chacun et la première manche. */
async function match(prefix, tokens = true, srv = server) {
  const a = await bot(`${prefix}1`, tokens ? token(`${prefix}1`) : null, srv);
  const b = await bot(`${prefix}2`, tokens ? token(`${prefix}2`) : null, srv);
  a.send({ t: 'queue' });
  await a.next('queued');
  b.send({ t: 'queue' });
  const [ma, mb] = await Promise.all([a.next('match'), b.next('match')]);
  const [ra, rb] = await Promise.all([a.next('round', 5000, true), b.next('round', 5000, true)]);
  const byTurn = (side) => (ma.side === side ? { me: a, other: b, side } : { me: b, other: a, side });
  return { a, b, ma, mb, round: ra, roundB: rb, shooter: byTurn(ra.turn) };
}

describe('serveur de jeu', () => {
  test('poignée de main, pseudo, salon', async () => {
    const a = await bot('Alice');
    const b = await bot('Bob');
    assert.equal(a.last('welcome').name, 'Alice');
    await waitFor(() => a.last('lobby')?.players.some((p) => p.name === 'Bob'), 4000, 'Bob visible dans le salon');
    assert.deepEqual(b.last('welcome').ranked, false);
  });

  test('un pseudo déjà pris ou invalide est refusé', async () => {
    const c = await bot(null);
    c.send({ t: 'hello', name: 'alice' });
    assert.equal((await c.next('error')).code, 'name_taken');
    c.send({ t: 'hello', name: '<>' });
    assert.equal((await c.next('error')).code, 'bad_name');
    c.send({ t: 'queue' });
    assert.equal((await c.next('error')).code, 'not_ready');
  });

  test('match classé : manche annoncée, tir validé, vol identique au moteur JS, résultat et classement', async () => {
    const m = await match('Rapide');
    assert.equal(m.ma.side + m.mb.side, 1);
    assert.equal(m.ma.ranked, true);
    assert.equal(m.ma.target, 1);
    assert.equal(m.ma.mode, 'classic');
    assert.deepEqual(m.round, m.roundB, 'les deux joueurs reçoivent la même manche');
    assert.deepEqual(m.round.hp, [100, 100]);
    assert.ok(Math.abs(m.round.round.wind) <= 1);

    const { me, other, side } = m.shooter;
    // celui dont ce n'est pas le tour ne peut pas tirer
    other.send({ t: 'fire', a: 45, p: 200 });
    assert.equal((await other.next('error')).code, 'not_your_turn');

    const shot = winningShot(m.round.round, side);
    me.send({ t: 'fire', a: shot.angle, p: shot.powder });
    const [sa, sb] = await Promise.all([me.next('shot'), other.next('shot')]);
    assert.deepEqual(sa, sb);
    assert.equal(sa.by, side);
    assert.equal(sa.fate, 'castle');
    assert.equal(sa.hit, 1 - side);
    assert.equal(sa.over, true);
    assert.equal(sa.rw, side);
    // le vol calculé par PHP est celui du moteur JS (arrondi à 0,1 px dans le message)
    const js = fly(m.round.round, side, shot);
    assert.equal(sa.path.length, js.path.length);
    sa.path.forEach(([x, y], i) => {
      assert.ok(Math.abs(x - js.path[i][0]) <= 0.06 && Math.abs(y - js.path[i][1]) <= 0.06, `point ${i}`);
    });

    const [ra, rb] = await Promise.all([me.next('result', 12000), other.next('result', 12000)]);
    assert.equal(ra.winner, side);
    assert.equal(ra.winner, rb.winner);
    assert.deepEqual(ra.score[side], 1);
    assert.equal(ra.ranked, true);
    assert.equal(ra.delta + rb.delta, 0);

    const file = path.join(server.dataDir, 'ratings.json');
    await waitFor(() => fs.existsSync(file), 3000, 'ratings.json');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(saved.players.length, 2);
    assert.ok(saved.players.every((p) => p.tokenHash.length === 64 && !JSON.stringify(p).includes(token('Rapide1'))), 'le jeton n\'est jamais stocké en clair');
    await Promise.all([m.a.next('left', 9000), m.b.next('left', 9000)]);          // fenêtre de revanche (3 s) écoulée
  });

  test('après un tir manqué, le tour passe à l\'adversaire une fois le vol animé', async () => {
    const m = await match('Tour', false);
    const { me, other, side } = m.shooter;
    me.send({ t: 'fire', a: 45, p: 100 });
    const shot = await me.next('shot');
    assert.equal(shot.fate, 'ground');
    assert.equal(shot.over, false);
    const t0 = Date.now();
    const turn = await other.next('turn', 9000);
    assert.equal(turn.turn, 1 - side);
    assert.ok(Date.now() - t0 >= 1500, 'le serveur laisse le temps d\'animer le vol');
    other.send({ t: 'fire', a: 45, p: 100 });
    assert.equal((await me.next('shot')).by, 1 - side);
    me.send({ t: 'leave' });
    await other.next('oppleft');
  });

  test('temps de réglage écoulé : tir d\'office, puis forfait au deuxième tour manqué', async () => {
    const m = await match('Lent', true, fast);
    const side = m.round.turn;
    const t0 = Date.now();
    const auto = await m.a.next('shot', 8000, true);
    assert.equal(auto.by, side);
    assert.deepEqual([auto.a, auto.p], [45, 200], 'dernier réglage connu (celui par défaut)');
    assert.ok(Date.now() - t0 >= 1500);
    // l'adversaire joue normalement ; le lent laisse de nouveau filer son tour => forfait
    const turn = await m.a.next('turn', 9000);
    assert.equal(turn.turn, 1 - side);
    const other = m.ma.side === 1 - side ? m.a : m.b;
    other.send({ t: 'fire', a: 45, p: 100 });
    const result = await m.a.next('result', 20000);
    assert.equal(result.forfeit, true);
    assert.equal(result.winner, 1 - side);
  });

  test('défi : invitation, refus, puis acceptation', async () => {
    const a = await bot('Defi1');
    const b = await bot('Defi2');
    await waitFor(() => a.last('lobby')?.players.some((p) => p.name === 'Defi2'), 4000, 'salon');
    const idB = a.last('lobby').players.find((p) => p.name === 'Defi2').id;
    a.send({ t: 'challenge', id: idB });
    const inv = await b.next('invite');
    assert.equal(inv.name, 'Defi1');
    b.send({ t: 'decline', id: inv.id });
    assert.equal((await a.next('declined')).name, 'Defi2');
    a.send({ t: 'challenge', id: idB });
    const inv2 = await b.next('invite');
    b.send({ t: 'accept', id: inv2.id });
    await Promise.all([a.next('match'), b.next('match')]);
    a.send({ t: 'leave' });
    await b.next('oppleft');
  });

  test('messages invalides : ignorés, la connexion survit', async () => {
    const a = await bot('Robuste');
    for (const raw of ['', '{', '[]', '{"t":1}', '{"t":"zzz"}', 'x'.repeat(5000)]) a.ws.send(raw);
    a.send({ t: 'fire', a: 'x', p: null });
    assert.equal((await a.next('error')).code, 'bad_shot');
    a.send({ t: 'ping', c: 42 });
    assert.equal((await a.next('pong')).c, 42);
    assert.equal(a.closed, false);
  });

  test('un client qui n\'est pas WebSocket reçoit un refus HTTP', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/`).catch(() => null);
    assert.ok(res === null || res.status === 400);
  });
});

/*
 * End-to-end test of the online mode: starts the real server (dist/server.cjs)
 * and connects two independent clients over WebSocket.
 * Run "npm run build" first, then: npx tsx tests/online.test.ts
 * Set TEST_URL=https://... to run the same test against the published website.
 */
import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { io, type Socket } from 'socket.io-client';
import { Bot } from '../shared/ai';
import { inputToBits, LEFT, RIGHT, type Side } from '../shared/engine';
import type { ClientToServer, RoomInfo, ServerToClient, Snapshot } from '../shared/protocol';

type S = Socket<ServerToClient, ClientToServer>;

const PORT = 3199;
const REMOTE = process.env.TEST_URL;
const URL = REMOTE ?? `http://localhost:${PORT}`;

let server: ChildProcess | null = null;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor<T>(what: string, fn: () => T | undefined | null | false, timeout = 15000): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(20);
  }
  throw new Error(`timeout waiting for: ${what}`);
}

class Client {
  socket: S;
  room: RoomInfo | null = null;
  snap: Snapshot | null = null;
  snaps = new Map<number, string>();
  side: Side = 0;
  seq = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(readonly playerId: string) {
    this.socket = io(URL, { transports: ['websocket'], forceNew: true });
    this.socket.on('room', (r) => (this.room = r));
    this.socket.on('snap', (s) => {
      this.snap = s;
      if (s.r) this.snaps.set(s.m.tick, JSON.stringify(s.m));
    });
  }

  connected() {
    return waitFor('connect', () => this.socket.connected);
  }

  create(scoreToWin: number) {
    return new Promise<string>((resolve, reject) =>
      this.socket.emit('create', { scoreToWin }, (res) => (res.ok ? resolve(res.code) : reject(new Error(res.error)))),
    );
  }

  join(code: string) {
    return new Promise<{ ok: boolean; error?: string; side?: Side }>((resolve) =>
      this.socket.emit('join', { code, playerId: this.playerId }, (res) => {
        if (res.ok) this.side = res.side;
        resolve(res as never);
      }),
    );
  }

  /** sends inputs 75x per second like the browser does */
  play(decide: (c: Client) => number) {
    this.stop();
    this.timer = setInterval(() => {
      if (this.snap?.r) this.socket.emit('input', { s: ++this.seq, b: decide(this) });
    }, 1000 / 75);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  close() {
    this.stop();
    this.socket.disconnect();
  }
}

async function main() {
  if (!REMOTE) {
    server = spawn(process.execPath, ['dist/server.cjs'], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    await new Promise<void>((resolve, reject) => {
      server!.stdout!.on('data', (d) => String(d).includes('läuft') && resolve());
      server!.on('exit', (code) => reject(new Error(`server exited ${code}`)));
    });
  }
  console.log(`Online tests against ${URL}`);

  // --- website is served -----------------------------------------------------
  const health = await fetch(`${URL}/healthz`).then((r) => r.json());
  assert.equal(health.ok, true);
  const page = await fetch(`${URL}/room/ABCDEF`).then((r) => r.text());
  assert.ok(page.includes('<canvas id="game"'), 'invitation link returns the game page');
  console.log('  ok  website and invitation URL are served');

  // --- room creation and joining -------------------------------------------
  const a = new Client('player-a-' + Math.random().toString(36).slice(2));
  const b = new Client('player-b-' + Math.random().toString(36).slice(2));
  await Promise.all([a.connected(), b.connected()]);
  const code = await a.create(2);
  assert.match(code, /^[A-Z2-9]{6}$/);
  assert.equal((await a.join(code)).side, LEFT);
  assert.equal((await b.join(code)).side, RIGHT);
  await waitFor('both see each other', () => a.room?.seats.every((s) => s?.connected) && b.room?.seats.every((s) => s?.connected));
  console.log(`  ok  room ${code} created, two players joined (left/right)`);

  const c = new Client('player-c-' + Math.random().toString(36).slice(2));
  await c.connected();
  const full = await c.join(code);
  assert.equal(full.ok, false);
  const missing = await c.join('ZZZZZZ');
  assert.equal(missing.ok, false);
  c.close();
  console.log('  ok  third player is rejected, unknown room is rejected');

  // a second room in parallel must not interfere
  const d = new Client('player-d-' + Math.random().toString(36).slice(2));
  await d.connected();
  const code2 = await d.create(15);
  assert.notEqual(code, code2);
  await d.join(code2);

  // --- ready + countdown -----------------------------------------------------
  a.socket.emit('ready', true);
  await sleep(200);
  assert.equal(a.room?.phase, 'lobby', 'one ready player does not start the game');
  b.socket.emit('ready', true);
  await waitFor('countdown', () => a.room?.phase === 'countdown' && b.room?.phase === 'countdown');
  await waitFor('playing', () => a.room?.phase === 'playing' && b.room?.phase === 'playing', 6000);
  assert.equal(d.room?.phase, 'lobby', 'other room unaffected');
  console.log('  ok  ready -> countdown -> playing');

  // --- independent control ---------------------------------------------------
  a.play(() => inputToBits({ left: false, right: true, up: false }));
  b.play(() => inputToBits({ left: false, right: true, up: false }));
  await sleep(600);
  const m = a.snap!.m;
  assert.ok(m.w.blobX[LEFT] > 240, `left blob moved right (${m.w.blobX[LEFT]})`);
  assert.ok(m.w.blobX[RIGHT] > 640, `right blob moved right (${m.w.blobX[RIGHT]})`);
  assert.ok(b.snap!.o === inputToBits({ left: false, right: true, up: false }), 'opponent input is forwarded for prediction');
  console.log('  ok  both players control their own blob at the same time');

  // --- full match with bots on both sides -----------------------------------
  const botA = new Bot(LEFT, 'hard');
  const botB = new Bot(RIGHT, 'easy');
  a.play((cl) => inputToBits(botA.getInput(cl.snap!.m)));
  b.play((cl) => inputToBits(botB.getInput(cl.snap!.m)));
  let lastScore = '';
  await waitFor(
    'match finished',
    () => {
      const s = a.snap?.m.l.scores.join(':');
      if (s && s !== lastScore) {
        lastScore = s;
        process.stdout.write(`      score ${s}\n`);
      }
      return a.room?.phase === 'finished' && b.room?.phase === 'finished';
    },
    240000,
  );
  a.stop();
  b.stop();
  assert.equal(a.room!.winner, b.room!.winner);
  assert.deepEqual(a.snap!.m.l.scores, b.snap!.m.l.scores);
  console.log(`  ok  match finished ${a.snap!.m.l.scores.join(':')}, both clients agree on the winner`);

  // both clients saw identical states
  let compared = 0;
  for (const [tick, json] of a.snaps) {
    const other = b.snaps.get(tick);
    if (other) {
      assert.equal(other, json, `state at tick ${tick} differs`);
      compared++;
    }
  }
  assert.ok(compared > 500, `compared ${compared} states`);
  console.log(`  ok  ${compared} game states identical on both clients`);

  // --- rematch ---------------------------------------------------------------
  a.socket.emit('rematch');
  await sleep(200);
  assert.equal(a.room?.phase, 'finished');
  b.socket.emit('rematch');
  await waitFor('rematch countdown', () => a.room?.phase === 'countdown');
  await waitFor('rematch playing', () => a.room?.phase === 'playing', 6000);
  await waitFor('score reset', () => a.snap?.m.l.scores.join(':') === '0:0');
  console.log('  ok  rematch starts a new match at 0:0');

  // --- disconnect and reconnect ---------------------------------------------
  b.close();
  await waitFor('paused', () => a.room?.phase === 'paused');
  const b2 = new Client(b.playerId);
  await b2.connected();
  const again = await b2.join(code);
  assert.equal(again.side, RIGHT, 'reconnecting player gets the same seat');
  await waitFor('resumed', () => a.room?.phase === 'playing' && b2.room?.phase === 'playing', 6000);
  console.log('  ok  connection loss pauses, reconnect resumes the same match');

  // --- leaving ---------------------------------------------------------------
  b2.socket.emit('leave');
  await waitFor('back to lobby', () => a.room?.phase === 'lobby' && a.room.seats[1] === null);
  console.log('  ok  leaving frees the seat');

  a.close();
  b2.close();
  d.close();
  console.log('\nall online tests passed');
}

main()
  .then(() => {
    server?.kill();
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    server?.kill();
    process.exit(1);
  });

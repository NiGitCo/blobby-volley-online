/*
 * Engine tests: physics values, collisions and rules.
 * Run with: npx tsx tests/engine.test.ts
 */
import assert from 'node:assert/strict';
import { Bot } from '../shared/ai';
import {
  BALL_COLLISION_VELOCITY,
  BALL_RADIUS,
  BLOBBY_LOWER_RADIUS,
  GRAVITATION,
  GROUND_PLANE_HEIGHT,
  GROUND_PLANE_HEIGHT_MAX,
  NET_POSITION_X,
  NET_RADIUS,
  NET_SPHERE_POSITION,
} from '../shared/constants';
import {
  cloneMatch,
  createMatch,
  type Input,
  LEFT,
  type MatchEvent,
  type MatchState,
  NO_INPUT,
  RIGHT,
  stepMatch,
} from '../shared/engine';

let passed = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`FAIL  ${name}`);
    throw err;
  }
}

const UP: Input = { left: false, right: false, up: true };
const RIGHT_KEY: Input = { left: false, right: true, up: false };
const LEFT_KEY: Input = { left: true, right: false, up: false };

function run(s: MatchState, steps: number, l: Input | ((s: MatchState) => Input), r: Input | ((s: MatchState) => Input), events: MatchEvent[] = []) {
  for (let i = 0; i < steps; i++) {
    stepMatch(s, typeof l === 'function' ? l(s) : l, typeof r === 'function' ? r(s) : r, events);
  }
  return events;
}

console.log('Engine tests');

test('derived constants match Blobby Volley 2', () => {
  assert.ok(Math.abs(GRAVITATION - 0.91525) < 1e-4, `gravity ${GRAVITATION}`);
  assert.ok(Math.abs(BALL_COLLISION_VELOCITY - 13.1225) < 1e-3);
  assert.equal(GROUND_PLANE_HEIGHT, 455.5);
});

test('blob jump reaches the original max height (y ≈ 206.4) when holding up', () => {
  const s = createMatch();
  let minY = Infinity;
  for (let i = 0; i < 80; i++) {
    stepMatch(s, UP, NO_INPUT);
    minY = Math.min(minY, s.w.blobY[LEFT]);
  }
  assert.ok(Math.abs(minY - 206.375) < 8, `apex ${minY}`);
});

test('short tap jumps lower than holding up', () => {
  const s = createMatch();
  stepMatch(s, UP, NO_INPUT);
  let minY = Infinity;
  for (let i = 0; i < 60; i++) {
    stepMatch(s, NO_INPUT, NO_INPUT);
    minY = Math.min(minY, s.w.blobY[LEFT]);
  }
  assert.ok(minY > 300, `apex ${minY}`);
});

test('no double jump in the air', () => {
  const s = createMatch();
  stepMatch(s, UP, NO_INPUT);
  for (let i = 0; i < 5; i++) stepMatch(s, NO_INPUT, NO_INPUT);
  const vyBefore = s.w.blobVY[LEFT];
  stepMatch(s, UP, NO_INPUT);
  assert.ok(s.w.blobVY[LEFT] > vyBefore, 'pressing up in the air must not jump again');
});

test('blobs stay on their own half and inside the walls', () => {
  const s = createMatch();
  run(s, 300, RIGHT_KEY, LEFT_KEY);
  assert.equal(s.w.blobX[LEFT], NET_POSITION_X - NET_RADIUS - BLOBBY_LOWER_RADIUS);
  assert.equal(s.w.blobX[RIGHT], NET_POSITION_X + NET_RADIUS + BLOBBY_LOWER_RADIUS);
  run(s, 300, LEFT_KEY, RIGHT_KEY);
  assert.equal(s.w.blobX[LEFT], 0);
  assert.equal(s.w.blobX[RIGHT], 800);
});

test('ball hovers before the serve and starts on the first hit', () => {
  const s = createMatch();
  const y0 = s.w.ballY;
  run(s, 50, NO_INPUT, NO_INPUT);
  assert.equal(s.w.ballY, y0);
  assert.equal(s.l.gameRunning, false);
  const ev = run(s, 30, UP, NO_INPUT);
  assert.ok(ev.some((e) => e.type === 'hitBlob' && e.side === LEFT));
  assert.equal(s.l.gameRunning, true);
});

test('ball leaves a blob always with the collision speed, direction depends on contact point', () => {
  const dirs: number[] = [];
  for (const offset of [-20, 0, 20]) {
    const s = createMatch();
    s.w.blobX[LEFT] = 200 + offset;
    const ev: MatchEvent[] = [];
    for (let i = 0; i < 40 && !ev.some((e) => e.type === 'hitBlob'); i++) stepMatch(s, UP, NO_INPUT, ev);
    const speed = Math.hypot(s.w.ballVX, s.w.ballVY);
    assert.ok(Math.abs(speed - BALL_COLLISION_VELOCITY) < 1e-9, `speed ${speed}`);
    dirs.push(s.w.ballVX);
  }
  assert.ok(dirs[0] > 0.5 && Math.abs(dirs[1]) < 1e-9 && dirs[2] < -0.5, `vx ${dirs}`);
});

test('ball on the ground = point for the opponent, who serves next', () => {
  const s = createMatch();
  s.l.gameRunning = true;
  s.w.ballX = 100;
  s.w.ballY = 300;
  const ev = run(s, 120, NO_INPUT, NO_INPUT);
  assert.deepEqual(s.l.scores, [0, 1]);
  assert.equal(s.l.serving, RIGHT);
  assert.ok(ev.some((e) => e.type === 'error' && e.side === LEFT));
  // after the ball rolled out it is placed above the server
  run(s, 600, NO_INPUT, NO_INPUT);
  assert.equal(s.w.ballX, 600);
  assert.equal(s.l.ballValid, true);
  assert.equal(s.l.gameRunning, false);
});

test('four touches on one side are a fault', () => {
  const s = createMatch();
  // jumping straight under the hovering ball: it bounces up and down on the blob
  const ev = run(s, 900, UP, NO_INPUT);
  const errors = ev.filter((e) => e.type === 'error');
  assert.ok(errors.length >= 1);
  assert.equal(errors[0].type === 'error' && errors[0].side, LEFT);
  assert.equal(s.l.scores[RIGHT] >= 1, true);
  const hitsBeforeError = ev.slice(0, ev.indexOf(errors[0])).filter((e) => e.type === 'hitBlob').length;
  assert.equal(hitsBeforeError, 4);
});

test('repeated contact within 11 steps counts once (squish)', () => {
  const s = createMatch();
  s.l.gameRunning = true;
  stepMatch(s, NO_INPUT, NO_INPUT);
  (s.l.squish as number[])[LEFT] = 0;
  // two physics hits right after each other
  s.w.ballX = 200;
  s.w.ballY = GROUND_PLANE_HEIGHT - 60;
  s.w.ballVY = 2;
  stepMatch(s, NO_INPUT, NO_INPUT);
  assert.equal(s.l.touches[LEFT], 1);
  s.w.ballX = 200;
  s.w.ballY = GROUND_PLANE_HEIGHT - 60;
  stepMatch(s, NO_INPUT, NO_INPUT);
  assert.equal(s.l.touches[LEFT], 1);
});

test('touching the ball resets the opponent touches', () => {
  const s = createMatch();
  s.l.touches[RIGHT] = 2;
  run(s, 30, UP, NO_INPUT);
  assert.equal(s.l.touches[RIGHT], 0);
});

test('ball bounces off the net side and the net top', () => {
  const s = createMatch();
  s.l.gameRunning = true;
  s.w.ballX = NET_POSITION_X - 60;
  s.w.ballY = 400;
  s.w.ballVX = 8;
  s.w.ballVY = 0;
  const ev = run(s, 10, NO_INPUT, NO_INPUT);
  assert.ok(ev.some((e) => e.type === 'net'));
  assert.ok(s.w.ballVX < 0);

  const t = createMatch();
  t.l.gameRunning = true;
  t.w.ballX = NET_POSITION_X - 5;
  t.w.ballY = NET_SPHERE_POSITION - 80;
  t.w.ballVX = 0;
  t.w.ballVY = 4;
  const ev2 = run(t, 30, NO_INPUT, NO_INPUT);
  assert.ok(ev2.some((e) => e.type === 'netTop'));
  assert.ok(t.w.ballVX < 0, 'ball slightly left of the net top must roll off to the left');
});

test('ball bounces off the walls and the ground', () => {
  const s = createMatch();
  s.l.gameRunning = true;
  s.l.ballValid = false;
  s.w.ballX = 50;
  s.w.ballY = 200;
  s.w.ballVX = -10;
  const ev = run(s, 100, NO_INPUT, NO_INPUT);
  assert.ok(ev.some((e) => e.type === 'wall'));
  assert.ok(s.w.ballX >= BALL_RADIUS);
  assert.ok(s.w.ballY <= GROUND_PLANE_HEIGHT_MAX - BALL_RADIUS);
});

test('win needs score-to-win and two points lead', () => {
  const s = createMatch(15);
  s.l.scores = [14, 14];
  s.l.gameRunning = true;
  s.w.ballX = 740;
  s.w.ballY = 300;
  run(s, 120, NO_INPUT, NO_INPUT);
  assert.deepEqual(s.l.scores, [15, 14]);
  assert.equal(s.l.winner, -1);
  s.l.gameRunning = true;
  s.l.ballValid = true;
  s.w.ballX = 740;
  s.w.ballY = 300;
  s.w.ballVX = 0;
  s.w.ballVY = 0;
  run(s, 120, NO_INPUT, NO_INPUT);
  assert.deepEqual(s.l.scores, [16, 14]);
  assert.equal(s.l.winner, LEFT);
  const frozen = JSON.stringify(s);
  run(s, 10, UP, UP);
  assert.equal(JSON.stringify(s), frozen, 'finished match does not change');
});

test('simulation is deterministic (needed for online prediction)', () => {
  const a = createMatch();
  const botL = new Bot(LEFT, 'hard');
  const botR = new Bot(RIGHT, 'hard');
  const inputs: [Input, Input][] = [];
  for (let i = 0; i < 3000; i++) {
    const l = botL.getInput(a);
    const r = botR.getInput(a);
    inputs.push([l, r]);
    stepMatch(a, l, r);
  }
  const b = createMatch();
  for (const [l, r] of inputs) stepMatch(b, l, r);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const c = cloneMatch(a);
  assert.equal(JSON.stringify(c), JSON.stringify(a));
});

test('computer players finish full matches without errors (all difficulties)', () => {
  for (const [dl, dr] of [
    ['hard', 'easy'],
    ['medium', 'medium'],
    ['easy', 'hard'],
  ] as const) {
    const s = createMatch(15);
    const l = new Bot(LEFT, dl);
    const r = new Bot(RIGHT, dr);
    let steps = 0;
    let hits = 0;
    while (s.l.winner === -1 && steps < 75 * 60 * 30) {
      const ev: MatchEvent[] = [];
      stepMatch(s, l.getInput(s), r.getInput(s), ev);
      hits += ev.filter((e) => e.type === 'hitBlob').length;
      steps++;
      assert.ok(Number.isFinite(s.w.ballX) && Number.isFinite(s.w.ballY), 'ball position is a number');
    }
    assert.notEqual(s.l.winner, -1, `${dl} vs ${dr} did not finish`);
    console.log(`      ${dl} vs ${dr}: ${s.l.scores.join(':')} in ${(steps / 75 / 60).toFixed(1)} min, ${hits} hits`);
  }
});

console.log(`\n${passed} engine tests passed`);

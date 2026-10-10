/*
 * Blobby Volley Online – game engine (physics + rules).
 *
 * The physics (handleBlob, ball/blob collisions, ball/world collisions) and
 * the rule logic are a TypeScript port of Blobby Volley 2
 * (src/PhysicWorld.cpp, src/GameLogic.cpp, src/DuelMatch.cpp,
 * data/rules/default.lua – https://github.com/danielknobe/blobbyvolley2),
 * licensed GPL-2.0-or-later. Copyright (C) 2006 Jonathan Sieber, Daniel Knobe.
 *
 * The whole state is plain data so it can be cloned, sent over the network
 * and replayed for client-side prediction. Everything here is deterministic.
 */
import {
  BALL_COLLISION_VELOCITY,
  BALL_GRAVITATION,
  BALL_RADIUS,
  BLOBBY_ANIMATION_SPEED,
  BLOBBY_JUMP_ACCELERATION,
  BLOBBY_JUMP_BUFFER,
  BLOBBY_LOWER_RADIUS,
  BLOBBY_LOWER_SPHERE,
  BLOBBY_SPEED,
  BLOBBY_UPPER_RADIUS,
  BLOBBY_UPPER_SPHERE,
  DEFAULT_SCORE_TO_WIN,
  GRAVITATION,
  GROUND_PLANE_HEIGHT,
  GROUND_PLANE_HEIGHT_MAX,
  LEFT_PLANE,
  NET_POSITION_X,
  NET_RADIUS,
  NET_SPHERE_POSITION,
  RIGHT_PLANE,
  SQUISH_TOLERANCE,
  STANDARD_BALL_ANGULAR_VELOCITY,
  STANDARD_BALL_HEIGHT,
} from './constants';

export const LEFT = 0;
export const RIGHT = 1;
export const NO_PLAYER = -1;
export type Side = 0 | 1;

export interface Input {
  left: boolean;
  right: boolean;
  up: boolean;
}

export const NO_INPUT: Input = Object.freeze({ left: false, right: false, up: false });

export function inputToBits(i: Input): number {
  return (i.left ? 1 : 0) | (i.right ? 2 : 0) | (i.up ? 4 : 0);
}

export function bitsToInput(b: number): Input {
  return { left: (b & 1) !== 0, right: (b & 2) !== 0, up: (b & 4) !== 0 };
}

export interface WorldState {
  ballX: number;
  ballY: number;
  ballVX: number;
  ballVY: number;
  ballRot: number;
  ballAngVel: number;
  blobX: [number, number];
  blobY: [number, number];
  blobVX: [number, number];
  blobVY: [number, number];
  blobAnim: [number, number];
  blobAnimSpeed: [number, number];
}

export interface LogicState {
  scores: [number, number];
  touches: [number, number];
  squish: [number, number];
  squishWall: number;
  squishGround: number;
  serving: number;
  ballValid: boolean;
  gameRunning: boolean;
  winner: number;
  lastError: number;
  scoreToWin: number;
}

export interface MatchState {
  tick: number;
  w: WorldState;
  l: LogicState;
}

export type MatchEvent =
  | { type: 'hitBlob'; side: Side; intensity: number }
  | { type: 'ground'; side: Side }
  | { type: 'wall'; side: Side }
  | { type: 'net'; side: Side }
  | { type: 'netTop' }
  | { type: 'error'; side: Side }
  | { type: 'reset' };

// ---------------------------------------------------------------------------
// Creation / cloning
// ---------------------------------------------------------------------------

export function createWorld(): WorldState {
  return {
    ballX: 200,
    ballY: STANDARD_BALL_HEIGHT,
    ballVX: 0,
    ballVY: 0,
    ballRot: 0,
    ballAngVel: STANDARD_BALL_ANGULAR_VELOCITY,
    blobX: [200, 600],
    blobY: [GROUND_PLANE_HEIGHT, GROUND_PLANE_HEIGHT],
    blobVX: [0, 0],
    blobVY: [0, 0],
    blobAnim: [0, 0],
    blobAnimSpeed: [0, 0],
  };
}

export function createLogic(scoreToWin = DEFAULT_SCORE_TO_WIN): LogicState {
  return {
    scores: [0, 0],
    touches: [0, 0],
    squish: [0, 0],
    squishWall: 0,
    squishGround: 0,
    serving: NO_PLAYER,
    ballValid: true,
    gameRunning: false,
    winner: NO_PLAYER,
    lastError: NO_PLAYER,
    scoreToWin,
  };
}

/** A fresh match where `serving` serves first. */
export function createMatch(scoreToWin = DEFAULT_SCORE_TO_WIN, serving: Side = LEFT): MatchState {
  const s: MatchState = { tick: 0, w: createWorld(), l: createLogic(scoreToWin) };
  setServingPlayer(s, serving);
  return s;
}

export function cloneMatch(s: MatchState): MatchState {
  const w = s.w;
  const l = s.l;
  return {
    tick: s.tick,
    w: {
      ballX: w.ballX,
      ballY: w.ballY,
      ballVX: w.ballVX,
      ballVY: w.ballVY,
      ballRot: w.ballRot,
      ballAngVel: w.ballAngVel,
      blobX: [w.blobX[0], w.blobX[1]],
      blobY: [w.blobY[0], w.blobY[1]],
      blobVX: [w.blobVX[0], w.blobVX[1]],
      blobVY: [w.blobVY[0], w.blobVY[1]],
      blobAnim: [w.blobAnim[0], w.blobAnim[1]],
      blobAnimSpeed: [w.blobAnimSpeed[0], w.blobAnimSpeed[1]],
    },
    l: {
      scores: [l.scores[0], l.scores[1]],
      touches: [l.touches[0], l.touches[1]],
      squish: [l.squish[0], l.squish[1]],
      squishWall: l.squishWall,
      squishGround: l.squishGround,
      serving: l.serving,
      ballValid: l.ballValid,
      gameRunning: l.gameRunning,
      winner: l.winner,
      lastError: l.lastError,
      scoreToWin: l.scoreToWin,
    },
  };
}

// ---------------------------------------------------------------------------
// Physics (port of PhysicWorld.cpp)
// ---------------------------------------------------------------------------

export function blobHitGround(w: WorldState, p: Side): boolean {
  return w.blobY[p] >= GROUND_PLANE_HEIGHT;
}

function circleCircleCollision(x1: number, y1: number, r1: number, x2: number, y2: number, r2: number): boolean {
  const dx = x1 - x2;
  const dy = y1 - y2;
  const sum = r1 + r2;
  return dx * dx + dy * dy < sum * sum;
}

function playerTopBallCollision(w: WorldState, p: Side): boolean {
  return circleCircleCollision(w.ballX, w.ballY, BALL_RADIUS, w.blobX[p], w.blobY[p] - BLOBBY_UPPER_SPHERE, BLOBBY_UPPER_RADIUS);
}

function playerBottomBallCollision(w: WorldState, p: Side): boolean {
  return circleCircleCollision(w.ballX, w.ballY, BALL_RADIUS, w.blobX[p], w.blobY[p] + BLOBBY_LOWER_SPHERE, BLOBBY_LOWER_RADIUS);
}

function blobbyAnimationStep(w: WorldState, p: Side): void {
  if (w.blobAnim[p] < 0) {
    w.blobAnimSpeed[p] = 0;
    w.blobAnim[p] = 0;
  }
  if (w.blobAnim[p] >= 4.5) {
    w.blobAnimSpeed[p] = -BLOBBY_ANIMATION_SPEED;
  }
  w.blobAnim[p] += w.blobAnimSpeed[p];
  if (w.blobAnim[p] >= 5) {
    w.blobAnim[p] = 4.99;
  }
}

function blobbyStartAnimation(w: WorldState, p: Side): void {
  if (w.blobAnimSpeed[p] === 0) w.blobAnimSpeed[p] = BLOBBY_ANIMATION_SPEED;
}

function handleBlob(w: WorldState, p: Side, input: Input): void {
  let gravity = GRAVITATION;

  if (input.up) {
    if (blobHitGround(w, p)) {
      w.blobVY[p] = BLOBBY_JUMP_ACCELERATION;
      blobbyStartAnimation(w, p);
    }
    // holding "up" makes the jump higher (BV2 "jump buffer")
    gravity -= BLOBBY_JUMP_BUFFER;
  }

  if ((input.left || input.right) && blobHitGround(w, p)) {
    blobbyStartAnimation(w, p);
  }

  w.blobVX[p] = (input.right ? BLOBBY_SPEED : 0) - (input.left ? BLOBBY_SPEED : 0);

  // ds = a/2 * dt^2 + v * dt   (dt = 1)
  w.blobX[p] += w.blobVX[p];
  w.blobY[p] += 0.5 * gravity + w.blobVY[p];
  // dv = a * dt
  w.blobVY[p] += gravity;

  if (w.blobY[p] > GROUND_PLANE_HEIGHT) {
    if (w.blobVY[p] > 3.5) blobbyStartAnimation(w, p);
    w.blobY[p] = GROUND_PLANE_HEIGHT;
    w.blobVY[p] = 0;
  }

  blobbyAnimationStep(w, p);
}

function handleBlobbyBallCollision(w: WorldState, p: Side, events: MatchEvent[]): boolean {
  let cy = w.blobY[p];
  if (playerBottomBallCollision(w, p)) {
    cy += BLOBBY_LOWER_SPHERE;
  } else if (playerTopBallCollision(w, p)) {
    cy -= BLOBBY_UPPER_SPHERE;
  } else {
    return false;
  }
  const cx = w.blobX[p];

  const rvx = w.blobVX[p] - w.ballVX;
  const rvy = w.blobVY[p] - w.ballVY;
  const intensity = Math.min(1, Math.sqrt(rvx * rvx + rvy * rvy) / 25);

  // The ball always leaves the blob with the same speed, in the direction
  // from the collision sphere's centre to the ball's centre.
  let dx = w.ballX - cx;
  let dy = w.ballY - cy;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len > 0) {
    dx /= len;
    dy /= len;
  } else {
    dx = 0;
    dy = -1;
  }
  w.ballVX = dx * BALL_COLLISION_VELOCITY;
  w.ballVY = dy * BALL_COLLISION_VELOCITY;
  w.ballX += w.ballVX;
  w.ballY += w.ballVY;

  events.push({ type: 'hitBlob', side: p, intensity });
  return true;
}

function handleBallWorldCollisions(w: WorldState, events: MatchEvent[]): void {
  // Ball to ground
  if (w.ballY + BALL_RADIUS > GROUND_PLANE_HEIGHT_MAX) {
    w.ballVY = -w.ballVY;
    w.ballVX *= 0.95;
    w.ballVY *= 0.95;
    w.ballY = GROUND_PLANE_HEIGHT_MAX - BALL_RADIUS;
    events.push({ type: 'ground', side: w.ballX > NET_POSITION_X ? RIGHT : LEFT });
  }

  // Border
  if (w.ballX - BALL_RADIUS <= LEFT_PLANE && w.ballVX < 0) {
    w.ballVX = -w.ballVX;
    w.ballX = LEFT_PLANE + BALL_RADIUS;
    events.push({ type: 'wall', side: LEFT });
  } else if (w.ballX + BALL_RADIUS >= RIGHT_PLANE && w.ballVX > 0) {
    w.ballVX = -w.ballVX;
    w.ballX = RIGHT_PLANE - BALL_RADIUS;
    events.push({ type: 'wall', side: RIGHT });
  } else if (w.ballY > NET_SPHERE_POSITION && Math.abs(w.ballX - NET_POSITION_X) < BALL_RADIUS + NET_RADIUS) {
    // Side of the net
    const right = w.ballX - NET_POSITION_X > 0;
    w.ballVX = -w.ballVX;
    w.ballX = NET_POSITION_X + (right ? BALL_RADIUS + NET_RADIUS : -BALL_RADIUS - NET_RADIUS);
    events.push({ type: 'net', side: right ? RIGHT : LEFT });
  } else {
    // Top of the net (a sphere)
    const tx = NET_POSITION_X - w.ballX;
    const ty = NET_SPHERE_POSITION - w.ballY;
    const dist = Math.sqrt(tx * tx + ty * ty);
    if (dist < NET_RADIUS + BALL_RADIUS) {
      const nx = dist > 0 ? tx / dist : 0;
      const ny = dist > 0 ? ty / dist : 1;

      // normal component of kinetic energy
      let perp = nx * w.ballVX + ny * w.ballVY;
      perp *= perp;
      // parallel component
      let para = w.ballVX * w.ballVX + w.ballVY * w.ballVY - perp;
      // the normal component is damped stronger than the parallel one
      perp *= 0.7;
      para *= 0.9;
      const newSpeed = Math.sqrt(perp + para);

      // reflect, normalise, scale
      const d = w.ballVX * nx + w.ballVY * ny;
      let rx = w.ballVX - 2 * d * nx;
      let ry = w.ballVY - 2 * d * ny;
      const rl = Math.sqrt(rx * rx + ry * ry);
      if (rl > 0) {
        rx /= rl;
        ry /= rl;
      }
      w.ballVX = rx * newSpeed;
      w.ballVY = ry * newSpeed;

      // push the ball out of the net
      w.ballX = NET_POSITION_X - nx * (NET_RADIUS + BALL_RADIUS);
      w.ballY = NET_SPHERE_POSITION - ny * (NET_RADIUS + BALL_RADIUS);

      events.push({ type: 'netTop' });
    }
  }
}

/** Keeps a blob on its own half and inside the field. */
export function clampBlob(w: WorldState, p: Side): void {
  if (p === LEFT) {
    if (w.blobX[LEFT] + BLOBBY_LOWER_RADIUS > NET_POSITION_X - NET_RADIUS) {
      w.blobX[LEFT] = NET_POSITION_X - NET_RADIUS - BLOBBY_LOWER_RADIUS;
    }
    if (w.blobX[LEFT] < LEFT_PLANE) w.blobX[LEFT] = LEFT_PLANE;
  } else {
    if (w.blobX[RIGHT] - BLOBBY_LOWER_RADIUS < NET_POSITION_X + NET_RADIUS) {
      w.blobX[RIGHT] = NET_POSITION_X + NET_RADIUS + BLOBBY_LOWER_RADIUS;
    }
    if (w.blobX[RIGHT] > RIGHT_PLANE) w.blobX[RIGHT] = RIGHT_PLANE;
  }
}

export function physicsStep(
  w: WorldState,
  inL: Input,
  inR: Input,
  ballValid: boolean,
  gameRunning: boolean,
  events: MatchEvent[],
): void {
  handleBlob(w, LEFT, inL);
  handleBlob(w, RIGHT, inR);

  if (gameRunning) {
    w.ballX += w.ballVX;
    w.ballY += 0.5 * BALL_GRAVITATION + w.ballVY;
    w.ballVY += BALL_GRAVITATION;
  }

  if (ballValid) {
    handleBlobbyBallCollision(w, LEFT, events);
    handleBlobbyBallCollision(w, RIGHT, events);
  }

  handleBallWorldCollisions(w, events);

  clampBlob(w, LEFT);
  clampBlob(w, RIGHT);

  // Ball rotation
  const speed = Math.sqrt(w.ballVX * w.ballVX + w.ballVY * w.ballVY);
  if (!gameRunning) w.ballRot -= w.ballAngVel;
  else if (w.ballVX > 0) w.ballRot += w.ballAngVel * (speed / 6);
  else w.ballRot -= w.ballAngVel * (speed / 6);

  if (w.ballRot <= 0) w.ballRot = 6.25 + w.ballRot;
  else if (w.ballRot >= 6.25) w.ballRot = w.ballRot - 6.25;
}

// ---------------------------------------------------------------------------
// Rules (port of GameLogic.cpp + default.lua)
// ---------------------------------------------------------------------------

function other(side: Side): Side {
  return side === LEFT ? RIGHT : LEFT;
}

function checkWin(l: LogicState): number {
  const [left, right] = l.scores;
  if (left >= l.scoreToWin && left >= right + 2) return LEFT;
  if (right >= l.scoreToWin && right >= left + 2) return RIGHT;
  return NO_PLAYER;
}

function score(l: LogicState, side: Side, amount: number): void {
  l.scores[side] = Math.max(0, l.scores[side] + amount);
  l.winner = checkWin(l);
}

function onError(l: LogicState, errorSide: Side, serveSide: Side): void {
  l.lastError = errorSide;
  l.ballValid = false;
  l.touches[0] = 0;
  l.touches[1] = 0;
  l.squish[0] = 0;
  l.squish[1] = 0;
  l.squishWall = 0;
  l.squishGround = 0;
  l.serving = serveSide;
}

/** default.lua mistake(): opponent gets the point and the serve. */
function mistake(l: LogicState, side: Side): void {
  score(l, other(side), 1);
  onError(l, side, other(side));
}

function onBallHitsPlayer(l: LogicState, side: Side): void {
  if (l.squish[side] > 0) return;
  l.squish[side] = SQUISH_TOLERANCE;
  l.squish[other(side)] = 0;
  l.gameRunning = true;
  l.touches[side]++;
  if (l.touches[side] > 3) mistake(l, side);
  l.touches[other(side)] = 0;
}

function onBallHitsGround(l: LogicState, side: Side): void {
  if (!(l.squishGround <= 0 && l.ballValid)) return;
  l.squishGround = SQUISH_TOLERANCE;
  l.touches[other(side)] = 0;
  mistake(l, side);
}

function onBallHitsWallOrNet(l: LogicState): void {
  if (!(l.squishWall <= 0 && l.ballValid)) return;
  l.squishWall = SQUISH_TOLERANCE;
  // default rules: walls and net are never a fault
}

// ---------------------------------------------------------------------------
// Match (port of DuelMatch.cpp)
// ---------------------------------------------------------------------------

function resetBall(w: WorldState, side: number): void {
  if (side === LEFT) {
    w.ballX = 200;
    w.ballY = STANDARD_BALL_HEIGHT;
  } else if (side === RIGHT) {
    w.ballX = 600;
    w.ballY = STANDARD_BALL_HEIGHT;
  } else {
    w.ballX = 400;
    w.ballY = 450;
  }
  w.ballVX = 0;
  w.ballVY = 0;
  w.ballAngVel = (side === RIGHT ? -1 : 1) * STANDARD_BALL_ANGULAR_VELOCITY;
}

function onServe(l: LogicState): void {
  l.ballValid = true;
  l.gameRunning = false;
}

export function setServingPlayer(s: MatchState, side: Side): void {
  s.l.serving = side;
  resetBall(s.w, side);
  onServe(s.l);
}

function canStartRound(w: WorldState, serving: number): boolean {
  if (serving !== LEFT && serving !== RIGHT) return false;
  return blobHitGround(w, serving) && w.ballVY < 1.5 && w.ballVY > -1.5 && w.ballY > 430;
}

export function isMatchOver(s: MatchState): boolean {
  return s.l.winner !== NO_PLAYER;
}

/**
 * Advances the match by one physics step (1/75 s).
 * Events of this step are appended to `events`.
 */
export function stepMatch(s: MatchState, inL: Input, inR: Input, events: MatchEvent[] = []): void {
  if (isMatchOver(s)) return;
  const w = s.w;
  const l = s.l;
  const ev: MatchEvent[] = [];

  physicsStep(w, inL, inR, l.ballValid, l.gameRunning, ev);

  // IGameLogic::step – the squish counters run down every step
  l.squish[0]--;
  l.squish[1]--;
  l.squishWall--;
  l.squishGround--;

  for (const e of ev) {
    switch (e.type) {
      case 'hitBlob':
        onBallHitsPlayer(l, e.side);
        break;
      case 'ground':
        onBallHitsGround(l, e.side);
        if (!l.ballValid) {
          w.ballVX *= 0.6;
          w.ballVY *= 0.6;
        }
        break;
      case 'net':
      case 'netTop':
      case 'wall':
        onBallHitsWallOrNet(l);
        break;
      default:
        break;
    }
  }

  if (l.lastError !== NO_PLAYER) {
    ev.push({ type: 'error', side: l.lastError as Side });
    l.lastError = NO_PLAYER;
    w.ballVX *= 0.6;
    w.ballVY *= 0.6;
  }

  if (!l.ballValid && !isMatchOver(s) && canStartRound(w, l.serving)) {
    resetBall(w, l.serving);
    onServe(l);
    ev.push({ type: 'reset' });
  }

  s.tick++;
  for (const e of ev) events.push(e);
}

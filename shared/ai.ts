/*
 * Blobby Volley Online – computer opponent (own implementation).
 * The bot only reads the match state and produces keyboard-like input, so it
 * obeys exactly the same physics as a human player.
 */
import {
  BALL_GRAVITATION,
  BALL_RADIUS,
  GROUND_PLANE_HEIGHT,
  LEFT_PLANE,
  NET_POSITION_X,
  NET_RADIUS,
  NET_SPHERE_POSITION,
  RIGHT_PLANE,
} from './constants';
import { type Input, LEFT, type MatchState, NO_INPUT, type Side } from './engine';

export type Difficulty = 'easy' | 'medium' | 'hard';

interface BotProfile {
  /** steps between two re-plans (reaction time) */
  reaction: number;
  /** random error added to the target position in px */
  noise: number;
  /** chance to attack with a jump when possible */
  jumpChance: number;
  /** how far behind the ball the bot stands (pushes the ball towards the net) */
  offset: number;
}

const PROFILES: Record<Difficulty, BotProfile> = {
  easy: { reaction: 16, noise: 28, jumpChance: 0.15, offset: 10 },
  medium: { reaction: 7, noise: 12, jumpChance: 0.5, offset: 16 },
  hard: { reaction: 1, noise: 3, jumpChance: 0.9, offset: 22 },
};

/** Height (ball centre) at which a standing blob touches the ball. */
const HIT_HEIGHT = GROUND_PLANE_HEIGHT - 19 - 25 - BALL_RADIUS + 6;

/** Simple ball forecast: gravity, walls and the net. Returns x when the ball falls to `y`. */
function forecastX(s: MatchState, y: number): { x: number; steps: number } {
  let x = s.w.ballX;
  let by = s.w.ballY;
  let vx = s.w.ballVX;
  let vy = s.w.ballVY;
  if (!s.l.gameRunning) return { x, steps: 0 };
  for (let i = 0; i < 300; i++) {
    x += vx;
    by += 0.5 * BALL_GRAVITATION + vy;
    vy += BALL_GRAVITATION;
    if (x - BALL_RADIUS <= LEFT_PLANE && vx < 0) {
      vx = -vx;
      x = LEFT_PLANE + BALL_RADIUS;
    } else if (x + BALL_RADIUS >= RIGHT_PLANE && vx > 0) {
      vx = -vx;
      x = RIGHT_PLANE - BALL_RADIUS;
    } else if (by > NET_SPHERE_POSITION && Math.abs(x - NET_POSITION_X) < BALL_RADIUS + NET_RADIUS) {
      vx = -vx;
      x = NET_POSITION_X + (x > NET_POSITION_X ? 1 : -1) * (BALL_RADIUS + NET_RADIUS);
    }
    if (vy > 0 && by >= y) return { x, steps: i + 1 };
  }
  return { x, steps: 300 };
}

export class Bot {
  private target: number;
  private wait = 0;
  private wantJump = false;
  private noise = 0;
  private readonly p: BotProfile;

  constructor(
    private readonly side: Side,
    difficulty: Difficulty,
  ) {
    this.p = PROFILES[difficulty];
    this.target = side === LEFT ? 200 : 600;
  }

  private onMySide(x: number): boolean {
    return this.side === LEFT ? x < NET_POSITION_X : x > NET_POSITION_X;
  }

  /** direction "towards the opponent" seen from this bot: +1 for left bot */
  private get dir(): number {
    return this.side === LEFT ? 1 : -1;
  }

  private plan(s: MatchState): void {
    const me = this.side;
    const home = me === LEFT ? 200 : 600;
    this.noise = (Math.random() * 2 - 1) * this.p.noise;
    this.wantJump = false;

    if (!s.l.ballValid) {
      this.target = home;
      return;
    }

    if (!s.l.gameRunning) {
      // waiting for a serve
      if (s.l.serving === me) {
        this.target = s.w.ballX - this.dir * (18 + this.p.offset * 0.5);
        this.wantJump = true;
      } else {
        this.target = home;
      }
      return;
    }

    const f = forecastX(s, HIT_HEIGHT);
    if (this.onMySide(f.x)) {
      // last touch: hit harder towards the net
      const extra = s.l.touches[me] >= 2 ? 8 : 0;
      this.target = f.x - this.dir * (this.p.offset + extra);
      this.wantJump = Math.random() < this.p.jumpChance;
    } else {
      this.target = home + this.dir * 20;
    }
  }

  getInput(s: MatchState): Input {
    if (s.l.winner !== -1) return NO_INPUT;
    if (--this.wait <= 0) {
      this.plan(s);
      this.wait = this.p.reaction;
    }

    const w = s.w;
    const me = this.side;
    const x = w.blobX[me];
    const goal = this.target + this.noise;
    const input: Input = { left: false, right: false, up: false };
    if (goal < x - 3) input.left = true;
    else if (goal > x + 3) input.right = true;

    const dx = w.ballX - x;
    const dy = w.blobY[me] - w.ballY;
    const near = Math.abs(dx) < 55;

    if (!s.l.gameRunning && s.l.serving === me && s.l.ballValid) {
      // serve: jump once we stand at the planned spot
      if (Math.abs(goal - x) < 6) input.up = true;
    } else if (s.l.gameRunning && s.l.ballValid && this.onMySide(w.ballX)) {
      // attack: jump when the ball comes down close above us
      if (this.wantJump && near && dy > 120 && dy < 260 && w.ballVY > -2) input.up = true;
      // emergency jump: ball would pass over our head
      if (near && dy > 90 && dy < 150 && w.ballVY > 3) input.up = true;
    }
    return input;
  }
}

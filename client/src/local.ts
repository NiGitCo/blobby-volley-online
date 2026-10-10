/*
 * Blobby Volley Online – games on one computer (2 players, vs. computer, menu demo).
 */
import { STEP_MS } from '../../shared/constants';
import { Bot } from '../../shared/ai';
import { cloneMatch, createMatch, type Input, isMatchOver, type MatchEvent, type MatchState, stepMatch } from '../../shared/engine';
import { interpolate, type View } from './render';

export type InputSource = Bot | (() => Input);

export class LocalGame {
  match: MatchState;
  private prev: MatchState;
  private acc = 0;
  private last = -1;
  paused = false;

  constructor(
    private readonly scoreToWin: number,
    private readonly sources: [InputSource, InputSource],
    private readonly onEvents: (events: MatchEvent[]) => void = () => {},
  ) {
    this.match = createMatch(scoreToWin);
    this.prev = cloneMatch(this.match);
  }

  get over(): boolean {
    return isMatchOver(this.match);
  }

  restart(): void {
    this.match = createMatch(this.scoreToWin);
    this.prev = cloneMatch(this.match);
    this.acc = 0;
    this.paused = false;
  }

  private read(src: InputSource): Input {
    return src instanceof Bot ? src.getInput(this.match) : src();
  }

  /** Runs the fixed 75-steps-per-second simulation and returns what to draw. */
  frame(now: number): View {
    const dt = this.last < 0 ? 0 : Math.min(250, now - this.last);
    this.last = now;
    if (!this.paused && !this.over) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= STEP_MS && n < 10) {
        this.acc -= STEP_MS;
        this.prev = cloneMatch(this.match);
        const events: MatchEvent[] = [];
        stepMatch(this.match, this.read(this.sources[0]), this.read(this.sources[1]), events);
        if (events.length) this.onEvents(events);
        n++;
      }
      if (this.acc >= STEP_MS) this.acc = 0;
    }
    return interpolate(this.prev, this.match, this.paused || this.over ? 1 : this.acc / STEP_MS);
  }
}

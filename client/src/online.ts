/*
 * Blobby Volley Online – online match in the browser.
 *
 * The server decides everything. To make your own blob react instantly, the
 * browser predicts the next steps locally ("client-side prediction"): it takes
 * the last state from the server and replays the key presses the server has
 * not processed yet. Small differences are smoothed out visually.
 */
import { io, type Socket } from 'socket.io-client';
import { STEP_MS } from '../../shared/constants';
import {
  bitsToInput,
  cloneMatch,
  type Input,
  inputToBits,
  type MatchEvent,
  type MatchState,
  stepMatch,
} from '../../shared/engine';
import type {
  ClientToServer,
  CreateRoomResponse,
  InputMessage,
  RoomInfo,
  ServerToClient,
  Snapshot,
} from '../../shared/protocol';
import type { Sound } from './audio';
import type { Keyboard } from './input';
import { interpolate, type View, viewFromMatch } from './render';

export type GameSocket = Socket<ServerToClient, ClientToServer>;

let sharedSocket: GameSocket | null = null;

export function getSocket(): GameSocket {
  if (!sharedSocket) {
    sharedSocket = io({
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
    });
  }
  return sharedSocket;
}

export function createRoom(scoreToWin: number): Promise<CreateRoomResponse> {
  const socket = getSocket();
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve({ ok: false, error: 'Der Server antwortet nicht. Bitte prüfe deine Internetverbindung.' }),
      15000,
    );
    socket.emit('create', { scoreToWin }, (res) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

export interface OnlineCallbacks {
  onRoom(info: RoomInfo): void;
  onError(message: string): void;
  onConnection(connected: boolean): void;
}

interface Offsets {
  bx: number;
  by: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const ZERO_OFFSETS: Offsets = { bx: 0, by: 0, x0: 0, y0: 0, x1: 0, y1: 0 };

export class OnlineSession {
  readonly socket: GameSocket;
  room: RoomInfo | null = null;
  side: 0 | 1 = 0;
  connected = false;
  rtt = 0;

  private server: MatchState | null = null;
  private running = false;
  private pred: MatchState | null = null;
  private prevPred: MatchState | null = null;
  private pending: InputMessage[] = [];
  private seq = 0;
  private oppBits = 0;
  private acc = 0;
  private lastFrame = 0;
  private off: Offsets = { ...ZERO_OFFSETS };
  private joined = false;
  private closed = false;
  private pingTimer: number;

  constructor(
    readonly code: string,
    private readonly playerId: string,
    private readonly cb: OnlineCallbacks,
    private readonly keyboard: Keyboard,
    private readonly sound: Sound,
  ) {
    this.socket = getSocket();
    this.socket.on('connect', this.handleConnect);
    this.socket.on('disconnect', this.handleDisconnect);
    this.socket.on('room', this.handleRoom);
    this.socket.on('snap', this.handleSnap);
    if (this.socket.connected) this.handleConnect();
    else this.socket.connect();
    this.pingTimer = window.setInterval(() => this.measurePing(), 2000);
  }

  private handleConnect = (): void => {
    this.connected = true;
    this.cb.onConnection(true);
    this.socket.emit('join', { code: this.code, playerId: this.playerId }, (res) => {
      if (this.closed) return;
      if (!res.ok) {
        this.cb.onError(res.error);
        return;
      }
      this.joined = true;
      this.side = res.side;
    });
  };

  private handleDisconnect = (): void => {
    this.connected = false;
    this.running = false;
    this.cb.onConnection(false);
  };

  private handleRoom = (info: RoomInfo): void => {
    if (info.code !== this.code) return;
    this.room = info;
    this.side = info.yourSide;
    this.cb.onRoom(info);
  };

  private handleSnap = (snap: Snapshot): void => {
    if (!this.joined) return;
    const opp = this.side === 0 ? 1 : 0;
    const old = this.server;
    if (old) {
      if (old.l.scores[0] !== snap.m.l.scores[0] || old.l.scores[1] !== snap.m.l.scores[1]) this.sound.whistle();
      // opponent hit the ball (confirmed by the server)
      if (snap.r && snap.m.l.squish[opp] > old.l.squish[opp]) this.sound.hit(0.6);
    }
    this.server = snap.m;
    this.oppBits = snap.o;
    this.pending = this.pending.filter((p) => p.s > snap.a);

    if (!snap.r) {
      this.running = false;
      this.pred = cloneMatch(snap.m);
      this.prevPred = null;
      this.pending = [];
      this.acc = 0;
      this.off = { ...ZERO_OFFSETS };
      return;
    }
    if (!this.running) {
      this.running = true;
      this.acc = 0;
      this.lastFrame = performance.now();
    }
    this.rebuildPrediction();
  };

  private inputsFor(mine: Input): [Input, Input] {
    const opp = bitsToInput(this.oppBits);
    return this.side === 0 ? [mine, opp] : [opp, mine];
  }

  private currentView(): View | null {
    if (!this.pred) return null;
    return this.prevPred ? interpolate(this.prevPred, this.pred, this.acc / STEP_MS) : viewFromMatch(this.pred);
  }

  /** Server state + all inputs the server has not seen yet = what you see. */
  private rebuildPrediction(): void {
    if (!this.server) return;
    const before = this.currentView();
    const np = cloneMatch(this.server);
    let npPrev: MatchState | null = null;
    const scratch: MatchEvent[] = [];
    for (let i = 0; i < this.pending.length; i++) {
      if (i === this.pending.length - 1) npPrev = cloneMatch(np);
      const [l, r] = this.inputsFor(bitsToInput(this.pending[i].b));
      stepMatch(np, l, r, scratch);
    }
    this.pred = np;
    this.prevPred = npPrev;
    const after = this.currentView();
    if (before && after) {
      const add = (cur: number, d: number) => (Math.abs(cur + d) > 140 ? 0 : cur + d);
      this.off.bx = add(this.off.bx, before.ballX - after.ballX);
      this.off.by = add(this.off.by, before.ballY - after.ballY);
      this.off.x0 = add(this.off.x0, before.blobX[0] - after.blobX[0]);
      this.off.y0 = add(this.off.y0, before.blobY[0] - after.blobY[0]);
      this.off.x1 = add(this.off.x1, before.blobX[1] - after.blobX[1]);
      this.off.y1 = add(this.off.y1, before.blobY[1] - after.blobY[1]);
    }
  }

  private tick(): void {
    if (!this.pred) return;
    const input = this.keyboard.either();
    const msg: InputMessage = { s: ++this.seq, b: inputToBits(input) };
    this.pending.push(msg);
    if (this.pending.length > 150) this.pending.shift();
    this.socket.emit('input', msg);

    this.prevPred = this.pred;
    this.pred = cloneMatch(this.pred);
    const events: MatchEvent[] = [];
    const [l, r] = this.inputsFor(input);
    stepMatch(this.pred, l, r, events);
    // own hits are played immediately, the opponent's when the server confirms them
    this.sound.events(events.filter((e) => e.type !== 'hitBlob' || e.side === this.side));
  }

  /** Advances the prediction and returns what should be drawn. */
  frame(now: number): View | null {
    const dt = Math.min(250, Math.max(0, now - this.lastFrame));
    this.lastFrame = now;

    if (this.running && this.pred && this.connected) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= STEP_MS && n < 10) {
        this.acc -= STEP_MS;
        this.tick();
        n++;
      }
      if (this.acc >= STEP_MS) this.acc = 0; // tab was frozen – do not fast-forward
    }

    // fade out correction offsets (~60 ms)
    const k = Math.exp(-dt / 60);
    const o = this.off;
    o.bx *= k;
    o.by *= k;
    o.x0 *= k;
    o.y0 *= k;
    o.x1 *= k;
    o.y1 *= k;

    const v = this.currentView();
    if (!v) return null;
    v.ballX += o.bx;
    v.ballY += o.by;
    v.blobX[0] += o.x0;
    v.blobY[0] += o.y0;
    v.blobX[1] += o.x1;
    v.blobY[1] += o.y1;
    if (this.server) {
      // score and serve as confirmed by the server
      v.scores = [this.server.l.scores[0], this.server.l.scores[1]];
      v.serving = this.server.l.serving;
    }
    return v;
  }

  private measurePing(): void {
    if (!this.connected) return;
    const t = performance.now();
    this.socket.emit('latency', () => {
      const r = performance.now() - t;
      this.rtt = this.rtt ? this.rtt * 0.7 + r * 0.3 : r;
    });
  }

  ready(ready: boolean): void {
    this.socket.emit('ready', ready);
  }

  rematch(): void {
    this.socket.emit('rematch');
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    window.clearInterval(this.pingTimer);
    this.socket.emit('leave');
    this.socket.off('connect', this.handleConnect);
    this.socket.off('disconnect', this.handleDisconnect);
    this.socket.off('room', this.handleRoom);
    this.socket.off('snap', this.handleSnap);
  }
}

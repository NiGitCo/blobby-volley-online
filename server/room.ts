/*
 * Blobby Volley Online – one private game room on the server.
 * The server owns the match: it runs the physics and the rules, the browsers
 * only send their key presses.
 */
import type { Server, Socket } from 'socket.io';
import { bitsToInput, createMatch, isMatchOver, LEFT, type MatchState, stepMatch } from '../shared/engine';
import type { ClientToServer, InputMessage, RoomInfo, RoomPhase, ServerToClient } from '../shared/protocol';

export type IO = Server<ClientToServer, ServerToClient>;
export type ClientSocket = Socket<ClientToServer, ServerToClient>;

export const COUNTDOWN_MS = 3000;
/** how long a disconnected player keeps the seat */
export const RECONNECT_GRACE_MS = 60_000;
/** max queued inputs before old ones are dropped (keeps the delay low) */
const MAX_INPUT_BACKLOG = 6;
/** if no input arrives for this long, the blob stops (e.g. browser tab hidden) */
const INPUT_TIMEOUT_MS = 250;

interface Player {
  id: string;
  socket: ClientSocket | null;
  ready: boolean;
  rematch: boolean;
  queue: InputMessage[];
  lastSeq: number;
  ack: number;
  bits: number;
  lastInputAt: number;
  disconnectedAt: number;
}

export class Room {
  readonly code: string;
  readonly scoreToWin: number;
  readonly seats: [Player | null, Player | null] = [null, null];
  phase: RoomPhase = 'lobby';
  match: MatchState;
  emptySince: number;
  private countdownEnd = 0;
  private winner = -1;
  private notice = '';
  private stepCount = 0;

  constructor(code: string, scoreToWin: number, now: number) {
    this.code = code;
    this.scoreToWin = scoreToWin;
    this.match = createMatch(scoreToWin, LEFT);
    this.emptySince = now;
  }

  get connectedCount(): number {
    return this.seats.filter((p) => p?.socket).length;
  }

  /** Returns the seat (0 = left, 1 = right) or an error text. */
  join(playerId: string, socket: ClientSocket, now: number): 0 | 1 | string {
    let side = this.seats.findIndex((p) => p?.id === playerId);
    if (side === -1) {
      side = this.seats.findIndex((p) => p === null);
      if (side === -1) return 'Dieser Spielraum ist bereits voll (2 Spieler).';
      this.seats[side] = {
        id: playerId,
        socket: null,
        ready: false,
        rematch: false,
        queue: [],
        lastSeq: -1,
        ack: -1,
        bits: 0,
        lastInputAt: 0,
        disconnectedAt: 0,
      };
    }
    const p = this.seats[side]!;
    if (p.socket && p.socket.id !== socket.id) {
      // same player opened the room again (e.g. reload) – the old connection loses the seat
      const old = p.socket;
      old.data.room = undefined;
      old.disconnect(true);
    }
    p.socket = socket;
    p.disconnectedAt = 0;
    p.queue = [];
    p.lastInputAt = 0;
    p.bits = 0;
    socket.data.room = this.code;
    socket.data.side = side;
    socket.join(this.code);
    this.emptySince = 0;

    if (this.phase === 'paused' && this.seats.every((s) => s?.socket)) {
      this.notice = 'Verbindung wiederhergestellt – weiter geht’s!';
      this.startCountdown(now);
    } else if (this.phase === 'lobby' && this.seats[side === 0 ? 1 : 0] === null) {
      this.notice = '';
    }
    this.broadcastRoom(now);
    return side as 0 | 1;
  }

  /** Connection lost – keep the seat for a while so the player can come back. */
  disconnect(side: 0 | 1, now: number): void {
    const p = this.seats[side];
    if (!p) return;
    p.socket = null;
    p.disconnectedAt = now;
    p.queue = [];
    p.bits = 0;
    if (this.phase === 'playing' || this.phase === 'countdown') {
      this.phase = 'paused';
      this.notice = 'Ein Spieler hat die Verbindung verloren. Warte auf Wiederverbindung …';
    }
    if (this.connectedCount === 0) this.emptySince = now;
    this.broadcastRoom(now);
  }

  /** Player left on purpose or did not come back in time. */
  removePlayer(side: 0 | 1, now: number, notice: string): void {
    const p = this.seats[side];
    if (!p) return;
    if (p.socket) {
      p.socket.leave(this.code);
      p.socket.data.room = undefined;
    }
    this.seats[side] = null;
    const other = this.seats[side === 0 ? 1 : 0];
    if (other) {
      other.ready = false;
      other.rematch = false;
    }
    this.phase = 'lobby';
    this.winner = -1;
    this.match = createMatch(this.scoreToWin, LEFT);
    this.notice = notice;
    if (this.connectedCount === 0) this.emptySince = now;
    this.broadcastRoom(now);
  }

  setReady(side: 0 | 1, ready: boolean, now: number): void {
    const p = this.seats[side];
    if (!p || this.phase !== 'lobby') return;
    p.ready = ready;
    if (this.seats.every((s) => s?.ready && s.socket)) {
      this.match = createMatch(this.scoreToWin, LEFT);
      this.winner = -1;
      this.notice = '';
      this.startCountdown(now);
    }
    this.broadcastRoom(now);
  }

  requestRematch(side: 0 | 1, now: number): void {
    const p = this.seats[side];
    if (!p || this.phase !== 'finished') return;
    p.rematch = true;
    if (this.seats.every((s) => s?.rematch && s.socket)) {
      for (const s of this.seats) if (s) s.rematch = false;
      this.match = createMatch(this.scoreToWin, LEFT);
      this.winner = -1;
      this.notice = '';
      this.startCountdown(now);
    }
    this.broadcastRoom(now);
  }

  input(side: 0 | 1, msg: InputMessage, now: number): void {
    const p = this.seats[side];
    if (!p) return;
    if (!Number.isInteger(msg?.s) || !Number.isInteger(msg?.b) || msg.b < 0 || msg.b > 7) return;
    if (msg.s <= p.lastSeq) return;
    p.lastSeq = msg.s;
    p.lastInputAt = now;
    p.queue.push({ s: msg.s, b: msg.b });
    if (p.queue.length > 60) p.queue.splice(0, p.queue.length - 60);
  }

  private startCountdown(now: number): void {
    this.phase = 'countdown';
    this.countdownEnd = now + COUNTDOWN_MS;
  }

  /** Takes this step's input of one player. */
  private consumeInput(p: Player | null, now: number): number {
    if (!p) return 0;
    const q = p.queue;
    while (q.length > MAX_INPUT_BACKLOG) {
      const dropped = q.shift()!;
      p.ack = dropped.s;
      p.bits = dropped.b;
    }
    const next = q.shift();
    if (next) {
      p.ack = next.s;
      p.bits = next.b;
    }
    if (!p.socket || now - p.lastInputAt > INPUT_TIMEOUT_MS) return 0;
    return p.bits;
  }

  /** Drop inputs while the match is not running, but acknowledge them. */
  private discardInputs(p: Player | null): void {
    if (!p) return;
    if (p.queue.length) p.ack = p.queue[p.queue.length - 1].s;
    p.queue = [];
    p.bits = 0;
  }

  /** Called 75 times per second. */
  step(now: number): void {
    this.stepCount++;

    // free seats of players that did not come back
    for (const side of [0, 1] as const) {
      const p = this.seats[side];
      if (p && !p.socket && p.disconnectedAt && now - p.disconnectedAt > RECONNECT_GRACE_MS) {
        this.removePlayer(side, now, 'Dein Gegner hat den Raum verlassen. Schicke den Link erneut, um weiterzuspielen.');
      }
    }

    if (this.phase === 'countdown' && now >= this.countdownEnd) {
      this.phase = 'playing';
      this.notice = '';
      this.broadcastRoom(now);
    }

    if (this.phase === 'playing') {
      const l = this.consumeInput(this.seats[0], now);
      const r = this.consumeInput(this.seats[1], now);
      stepMatch(this.match, bitsToInput(l), bitsToInput(r));
      if (isMatchOver(this.match)) {
        this.phase = 'finished';
        this.winner = this.match.l.winner;
        this.broadcastRoom(now);
      }
      this.sendSnapshots();
    } else {
      this.discardInputs(this.seats[0]);
      this.discardInputs(this.seats[1]);
      if (this.stepCount % 4 === 0) this.sendSnapshots();
      if (this.phase === 'countdown' && this.stepCount % 15 === 0) this.broadcastRoom(now);
    }
  }

  private sendSnapshots(): void {
    const running = this.phase === 'playing';
    for (const side of [0, 1] as const) {
      const p = this.seats[side];
      if (!p?.socket) continue;
      const o = this.seats[side === 0 ? 1 : 0];
      p.socket.emit('snap', { m: this.match, a: p.ack, o: o?.bits ?? 0, r: running });
    }
  }

  info(side: 0 | 1, now: number): RoomInfo {
    const seat = (p: Player | null) => (p ? { connected: !!p.socket, ready: p.ready, rematch: p.rematch } : null);
    return {
      code: this.code,
      phase: this.phase,
      seats: [seat(this.seats[0]), seat(this.seats[1])],
      yourSide: side,
      scoreToWin: this.scoreToWin,
      countdownMs: this.phase === 'countdown' ? Math.max(0, this.countdownEnd - now) : 0,
      winner: this.winner,
      notice: this.notice,
    };
  }

  broadcastRoom(now: number): void {
    for (const side of [0, 1] as const) {
      const p = this.seats[side];
      if (p?.socket) p.socket.emit('room', this.info(side, now));
    }
  }
}

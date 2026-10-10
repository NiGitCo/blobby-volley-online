/*
 * Blobby Volley Online – messages between browser and server (Socket.IO).
 */
import type { MatchState } from './engine';

export type RoomPhase = 'lobby' | 'countdown' | 'playing' | 'paused' | 'finished';

export interface SeatInfo {
  connected: boolean;
  ready: boolean;
  rematch: boolean;
}

export interface RoomInfo {
  code: string;
  phase: RoomPhase;
  /** index 0 = left / red, 1 = right / blue; null = free seat */
  seats: [SeatInfo | null, SeatInfo | null];
  yourSide: 0 | 1;
  scoreToWin: number;
  /** milliseconds until the match (re)starts, during "countdown" */
  countdownMs: number;
  winner: number;
  /** short message for the players, e.g. "Gegner hat die Verbindung verloren" */
  notice: string;
}

/** Server -> client game snapshot. */
export interface Snapshot {
  /** full authoritative match state */
  m: MatchState;
  /** last input sequence number of *this* client the server has applied */
  a: number;
  /** current input bits of the opponent */
  o: number;
  /** server running the simulation (false during countdown/pause) */
  r: boolean;
}

export interface CreateRoomRequest {
  scoreToWin: number;
}

export type CreateRoomResponse = { ok: true; code: string } | { ok: false; error: string };

export interface JoinRoomRequest {
  code: string;
  playerId: string;
}

export type JoinRoomResponse = { ok: true; side: 0 | 1 } | { ok: false; error: string };

export interface InputMessage {
  /** sequence number, increases by one every client step */
  s: number;
  /** input bits (see inputToBits) */
  b: number;
}

export interface ServerToClient {
  room: (info: RoomInfo) => void;
  snap: (snap: Snapshot) => void;
}

export interface ClientToServer {
  create: (req: CreateRoomRequest, cb: (res: CreateRoomResponse) => void) => void;
  join: (req: JoinRoomRequest, cb: (res: JoinRoomResponse) => void) => void;
  ready: (ready: boolean) => void;
  rematch: () => void;
  input: (msg: InputMessage) => void;
  leave: () => void;
  latency: (cb: () => void) => void;
}

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

export function normalizeRoomCode(raw: string): string {
  const trimmed = raw.trim();
  // allow pasting a whole invitation link
  const m = trimmed.match(/room\/([A-Za-z0-9]+)/);
  const code = (m ? m[1] : trimmed).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code;
}

export function isValidRoomCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  return true;
}

/*
 * Blobby Volley Online – server.
 * Serves the website and runs all online matches (Socket.IO / WebSocket).
 */
import { randomInt } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { Server } from 'socket.io';
import { DEFAULT_SCORE_TO_WIN, STEP_MS } from '../shared/constants';
import {
  type ClientToServer,
  isValidRoomCode,
  normalizeRoomCode,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type ServerToClient,
} from '../shared/protocol';
import { Room } from './room';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = process.env.PUBLIC_DIR ?? path.join(__dirname, 'public');
const MAX_ROOMS = 2000;
/** rooms without any connected player are deleted after this time */
const EMPTY_ROOM_TTL_MS = 5 * 60_000;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

const rooms = new Map<string, Room>();

function sendFile(res: ServerResponse, file: string, cache: boolean): void {
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': cache ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
}

function handleHttp(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    res.end();
    return;
  }

  const file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (file.startsWith(PUBLIC_DIR) && existsSync(file) && statSync(file).isFile()) {
    sendFile(res, file, pathname.startsWith('/assets/'));
    return;
  }
  // single page app: "/", "/room/ABC123" ... all get index.html
  const index = path.join(PUBLIC_DIR, 'index.html');
  if (existsSync(index)) {
    sendFile(res, index, false);
  } else {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Website wurde nicht gebaut. Bitte "npm run build" ausführen.');
  }
}

function newRoomCode(): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
}

const httpServer = createServer({ noDelay: true }, handleHttp);
const io = new Server<ClientToServer, ServerToClient>(httpServer, {
  pingInterval: 10_000,
  pingTimeout: 8_000,
  maxHttpBufferSize: 10_000,
});

io.on('connection', (socket) => {
  let created = 0;

  const current = () => {
    const code = socket.data.room as string | undefined;
    const side = socket.data.side as 0 | 1 | undefined;
    const room = code ? rooms.get(code) : undefined;
    return room && side !== undefined ? { room, side } : null;
  };

  socket.on('latency', (cb) => {
    if (typeof cb === 'function') cb();
  });

  socket.on('create', (req, cb) => {
    if (typeof cb !== 'function') return;
    if (created >= 20 || rooms.size >= MAX_ROOMS) {
      cb({ ok: false, error: 'Der Server ist gerade ausgelastet. Bitte später erneut versuchen.' });
      return;
    }
    let stw = Math.round(Number(req?.scoreToWin));
    if (!Number.isFinite(stw) || stw < 1 || stw > 99) stw = DEFAULT_SCORE_TO_WIN;
    const code = newRoomCode();
    rooms.set(code, new Room(code, stw, Date.now()));
    created++;
    console.log(`room ${code} created (rooms: ${rooms.size})`);
    cb({ ok: true, code });
  });

  socket.on('join', (req, cb) => {
    if (typeof cb !== 'function') return;
    const code = normalizeRoomCode(String(req?.code ?? ''));
    const playerId = String(req?.playerId ?? '').slice(0, 64);
    if (!isValidRoomCode(code) || playerId.length < 8) {
      cb({ ok: false, error: 'Ungültiger Raumcode.' });
      return;
    }
    const room = rooms.get(code);
    if (!room) {
      cb({ ok: false, error: 'Spielraum nicht gefunden. Vielleicht ist er abgelaufen – erstelle einfach einen neuen.' });
      return;
    }
    // leave a previous room of this connection
    const prev = current();
    if (prev && prev.room !== room) prev.room.removePlayer(prev.side, Date.now(), 'Dein Gegner hat den Raum verlassen.');

    const result = room.join(playerId, socket, Date.now());
    if (typeof result === 'string') {
      cb({ ok: false, error: result });
      return;
    }
    cb({ ok: true, side: result });
    room.broadcastRoom(Date.now());
  });

  socket.on('ready', (ready) => {
    const c = current();
    if (c) c.room.setReady(c.side, !!ready, Date.now());
  });

  socket.on('rematch', () => {
    const c = current();
    if (c) c.room.requestRematch(c.side, Date.now());
  });

  socket.on('input', (msg) => {
    const c = current();
    if (c) c.room.input(c.side, msg, Date.now());
  });

  socket.on('leave', () => {
    const c = current();
    if (c) c.room.removePlayer(c.side, Date.now(), 'Dein Gegner hat den Raum verlassen.');
    socket.data.room = undefined;
  });

  socket.on('disconnect', () => {
    const c = current();
    if (c) c.room.disconnect(c.side, Date.now());
  });
});

// ---------------------------------------------------------------------------
// Fixed time step loop: all rooms advance 75 times per second
// ---------------------------------------------------------------------------
let last = performance.now();
setInterval(() => {
  const nowPerf = performance.now();
  if (nowPerf - last > 250) last = nowPerf - STEP_MS; // server was stalled – do not fast-forward
  while (nowPerf - last >= STEP_MS) {
    last += STEP_MS;
    const now = Date.now();
    for (const room of rooms.values()) room.step(now);
  }
}, 2);

// Remove rooms nobody uses anymore
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.connectedCount === 0 && room.emptySince && now - room.emptySince > EMPTY_ROOM_TTL_MS) {
      rooms.delete(code);
      console.log(`room ${code} removed (rooms: ${rooms.size})`);
    }
  }
}, 30_000);

httpServer.listen(PORT, () => {
  console.log(`Blobby Volley Online läuft auf http://localhost:${PORT}`);
});

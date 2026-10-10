/*
 * Blobby Volley Online – app: menus, screens and the main loop.
 */
import './style.css';
import { Bot, type Difficulty } from '../../shared/ai';
import { DEFAULT_SCORE_TO_WIN } from '../../shared/constants';
import { RIGHT, LEFT } from '../../shared/engine';
import { isValidRoomCode, normalizeRoomCode, type RoomInfo } from '../../shared/protocol';
import { Sound } from './audio';
import { Keyboard } from './input';
import { LocalGame } from './local';
import { createRoom, OnlineSession } from './online';
import { Renderer } from './render';

// ---------------------------------------------------------------------------
// Settings (kept in the browser)
// ---------------------------------------------------------------------------
interface Settings {
  scoreToWin: number;
  sound: boolean;
}

function loadSettings(): Settings {
  const s: Settings = { scoreToWin: DEFAULT_SCORE_TO_WIN, sound: true };
  try {
    const raw = localStorage.getItem('blobby-settings');
    if (raw) {
      const v = JSON.parse(raw);
      if (Number.isInteger(v.scoreToWin) && v.scoreToWin >= 1 && v.scoreToWin <= 99) s.scoreToWin = v.scoreToWin;
      if (typeof v.sound === 'boolean') s.sound = v.sound;
    }
  } catch {
    /* storage not available */
  }
  return s;
}

function saveSettings(s: Settings): void {
  try {
    localStorage.setItem('blobby-settings', JSON.stringify(s));
  } catch {
    /* storage not available */
  }
}

/** One id per browser tab, so a reload gets the same seat back. */
function playerId(): string {
  const make = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
  try {
    let id = sessionStorage.getItem('blobby-player');
    if (!id) {
      id = make();
      sessionStorage.setItem('blobby-player', id);
    }
    return id;
  } catch {
    return make();
  }
}

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLDivElement;
const banner = document.getElementById('banner') as HTMLDivElement;
const renderer = new Renderer(canvas);
const keyboard = new Keyboard();
const sound = new Sound();
const settings = loadSettings();
sound.enabled = settings.sound;
const myId = playerId();

type Mode = 'menu' | 'local' | 'ai' | 'online';
let mode: Mode = 'menu';
let demo = new LocalGame(DEFAULT_SCORE_TO_WIN, [new Bot(LEFT, 'hard'), new Bot(RIGHT, 'hard')]);
let local: LocalGame | null = null;
let online: OnlineSession | null = null;
let overlayKey = '';

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Replaces the overlay only if the screen changed (keeps focus / clicks working). */
function show(key: string, html: string, bind: (root: HTMLElement) => void = () => {}): void {
  if (key === overlayKey) return;
  overlayKey = key;
  overlay.innerHTML = html;
  overlay.hidden = html === '';
  bind(overlay);
  const first = overlay.querySelector<HTMLElement>('[autofocus]');
  first?.focus();
}

function on(root: HTMLElement, selector: string, handler: () => void): void {
  root.querySelector(selector)?.addEventListener('click', () => {
    sound.unlock();
    handler();
  });
}

function setBanner(text: string): void {
  banner.textContent = text;
  banner.hidden = text === '';
}

function goHome(): void {
  online?.close();
  online = null;
  local = null;
  mode = 'menu';
  setBanner('');
  if (location.pathname !== '/') history.pushState(null, '', '/');
  showMenu();
}

// ---------------------------------------------------------------------------
// Menu screens
// ---------------------------------------------------------------------------
function showMenu(): void {
  show(
    'menu',
    `<div class="panel menu">
      <h1>BLOBBY VOLLEY <span>ONLINE</span></h1>
      <button class="primary" id="m-create" autofocus>Online-Spiel erstellen</button>
      <button id="m-join">Spielraum beitreten</button>
      <button id="m-local">Lokal zu zweit spielen</button>
      <button id="m-ai">Gegen Computer spielen</button>
      <button id="m-settings">Einstellungen</button>
    </div>`,
    (r) => {
      on(r, '#m-create', () => void createOnline());
      on(r, '#m-join', showJoin);
      on(r, '#m-local', startLocal);
      on(r, '#m-ai', showAiSelect);
      on(r, '#m-settings', showSettings);
    },
  );
}

function showJoin(error = ''): void {
  show(
    'join' + error,
    `<div class="panel">
      <h2>Spielraum beitreten</h2>
      <p>Füge den Einladungslink oder den 6-stelligen Raumcode ein:</p>
      <input id="j-code" type="text" maxlength="200" placeholder="z. B. X7K29P" autocomplete="off" autofocus />
      ${error ? `<p class="error">${esc(error)}</p>` : ''}
      <div class="row">
        <button id="j-back">Zurück</button>
        <button class="primary" id="j-go">Beitreten</button>
      </div>
    </div>`,
    (r) => {
      const input = r.querySelector<HTMLInputElement>('#j-code')!;
      const go = () => {
        const code = normalizeRoomCode(input.value);
        if (!isValidRoomCode(code)) {
          overlayKey = '';
          showJoin('Das ist kein gültiger Raumcode. Er besteht aus 6 Zeichen, z. B. X7K29P.');
          return;
        }
        history.pushState(null, '', `/room/${code}`);
        joinOnline(code);
      };
      on(r, '#j-go', go);
      on(r, '#j-back', showMenu);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') go();
      });
    },
  );
}

function showAiSelect(): void {
  show(
    'ai',
    `<div class="panel menu">
      <h2>Gegen Computer</h2>
      <p>Du spielst Rot (links) mit A / D / W oder den Pfeiltasten.</p>
      <button id="d-easy">Einfach</button>
      <button class="primary" id="d-medium" autofocus>Mittel</button>
      <button id="d-hard">Schwer</button>
      <button id="d-back">Zurück</button>
    </div>`,
    (r) => {
      on(r, '#d-easy', () => startAi('easy'));
      on(r, '#d-medium', () => startAi('medium'));
      on(r, '#d-hard', () => startAi('hard'));
      on(r, '#d-back', showMenu);
    },
  );
}

function showSettings(): void {
  const options = [5, 10, 15, 21, 25]
    .map((n) => `<option value="${n}" ${n === settings.scoreToWin ? 'selected' : ''}>${n} Punkte${n === 15 ? ' (Original)' : ''}</option>`)
    .join('');
  show(
    'settings',
    `<div class="panel">
      <h2>Einstellungen</h2>
      <label>Gewinnpunkte (mit 2 Punkten Vorsprung)
        <select id="s-score">${options}</select>
      </label>
      <label class="check"><input type="checkbox" id="s-sound" ${settings.sound ? 'checked' : ''}/> Sound an</label>
      <p class="small">Steuerung: Spieler 1 (Rot) A / D / W – Spieler 2 (Blau) Pfeiltasten.<br/>
      Online steuerst du deinen Blobby mit beiden Tastengruppen.</p>
      <button class="primary" id="s-back" autofocus>Fertig</button>
    </div>`,
    (r) => {
      on(r, '#s-back', () => {
        settings.scoreToWin = Number(r.querySelector<HTMLSelectElement>('#s-score')!.value) || DEFAULT_SCORE_TO_WIN;
        settings.sound = r.querySelector<HTMLInputElement>('#s-sound')!.checked;
        sound.enabled = settings.sound;
        saveSettings(settings);
        showMenu();
      });
    },
  );
}

// ---------------------------------------------------------------------------
// Local games
// ---------------------------------------------------------------------------
function startLocal(): void {
  mode = 'local';
  local = new LocalGame(settings.scoreToWin, [() => keyboard.player1(), () => keyboard.player2()], (e) => sound.events(e));
  show('', '');
}

function startAi(difficulty: Difficulty): void {
  mode = 'ai';
  local = new LocalGame(settings.scoreToWin, [() => keyboard.either(), new Bot(RIGHT, difficulty)], (e) => sound.events(e));
  show('', '');
}

function showLocalPause(): void {
  if (!local) return;
  local.paused = true;
  show(
    'pause',
    `<div class="panel menu">
      <h2>Pause</h2>
      <button class="primary" id="p-resume" autofocus>Weiterspielen</button>
      <button id="p-restart">Neu starten</button>
      <button id="p-home">Hauptmenü</button>
    </div>`,
    (r) => {
      on(r, '#p-resume', () => {
        if (local) local.paused = false;
        show('', '');
      });
      on(r, '#p-restart', () => {
        local?.restart();
        show('', '');
      });
      on(r, '#p-home', goHome);
    },
  );
}

function showLocalResult(): void {
  if (!local) return;
  const [l, r] = local.match.l.scores;
  const winner = local.match.l.winner;
  const text =
    mode === 'ai' ? (winner === LEFT ? 'Du hast gewonnen!' : 'Der Computer hat gewonnen.') : winner === LEFT ? 'Rot gewinnt!' : 'Blau gewinnt!';
  show(
    'local-result',
    `<div class="panel menu">
      <h2>${text}</h2>
      <p class="score"><span class="red">${l}</span> : <span class="blue">${r}</span></p>
      <button class="primary" id="r-again" autofocus>Nochmal spielen</button>
      <button id="r-home">Hauptmenü</button>
    </div>`,
    (root) => {
      on(root, '#r-again', () => {
        local?.restart();
        show('', '');
      });
      on(root, '#r-home', goHome);
    },
  );
}

// ---------------------------------------------------------------------------
// Online
// ---------------------------------------------------------------------------
async function createOnline(): Promise<void> {
  show('creating', `<div class="panel"><h2>Spielraum wird erstellt …</h2></div>`);
  const res = await createRoom(settings.scoreToWin);
  if (!res.ok) {
    showOnlineError(res.error);
    return;
  }
  history.pushState(null, '', `/room/${res.code}`);
  joinOnline(res.code);
}

function joinOnline(code: string): void {
  online?.close();
  mode = 'online';
  local = null;
  show('connecting', `<div class="panel"><h2>Verbinde mit Spielraum ${esc(code)} …</h2></div>`);
  online = new OnlineSession(
    code,
    myId,
    {
      onRoom: (info) => updateOnlineScreen(info),
      onError: (msg) => showOnlineError(msg),
      onConnection: (ok) => setBanner(ok ? '' : 'Verbindung unterbrochen – verbinde neu …'),
    },
    keyboard,
    sound,
  );
}

function showOnlineError(message: string): void {
  online?.close();
  online = null;
  mode = 'menu';
  show(
    'error' + message,
    `<div class="panel">
      <h2>Das hat nicht geklappt</h2>
      <p class="error">${esc(message)}</p>
      <button class="primary" id="e-home" autofocus>Zum Hauptmenü</button>
    </div>`,
    (r) => on(r, '#e-home', goHome),
  );
}

function copyText(text: string, button: HTMLButtonElement): void {
  const done = () => {
    button.textContent = 'Kopiert ✓';
    setTimeout(() => (button.textContent = 'Link kopieren'), 2000);
  };
  const fallback = () => {
    const input = document.getElementById('o-link') as HTMLInputElement | null;
    input?.select();
    try {
      document.execCommand('copy');
      done();
    } catch {
      button.textContent = 'Bitte manuell kopieren';
    }
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, fallback);
  else fallback();
}

function seatLabel(info: RoomInfo, side: 0 | 1): string {
  const seat = info.seats[side];
  const who = side === info.yourSide ? 'Du' : 'Dein Freund';
  const color = side === 0 ? '<span class="red">Rot (links)</span>' : '<span class="blue">Blau (rechts)</span>';
  if (!seat) return `${color}: <em>wartet auf Mitspieler …</em>`;
  if (!seat.connected) return `${color} – ${who}: <em>Verbindung getrennt …</em>`;
  return `${color} – ${who}: ${seat.ready ? '<strong>bereit ✓</strong>' : 'noch nicht bereit'}`;
}

function updateOnlineScreen(info: RoomInfo): void {
  if (mode !== 'online' || !online) return;
  const link = `${location.origin}/room/${info.code}`;
  const me = info.seats[info.yourSide];
  const notice = info.notice ? `<p class="notice">${esc(info.notice)}</p>` : '';

  if (info.phase === 'lobby') {
    const both = info.seats.every((s) => s?.connected);
    const key = `lobby|${JSON.stringify(info.seats)}|${info.notice}`;
    show(
      key,
      `<div class="panel lobby">
        <h2>Spielraum ${esc(info.code)}</h2>
        ${notice}
        <p>Schicke diesen Link deinem Freund (z. B. per WhatsApp oder Discord):</p>
        <div class="row link">
          <input id="o-link" type="text" readonly value="${esc(link)}" />
          <button id="o-copy">Link kopieren</button>
        </div>
        <ul class="seats">
          <li>${seatLabel(info, 0)}</li>
          <li>${seatLabel(info, 1)}</li>
        </ul>
        <p class="small">Du spielst ${info.yourSide === 0 ? '<span class="red">Rot</span>' : '<span class="blue">Blau</span>'} – Steuerung: A / D / W oder Pfeiltasten. Gewinn bei ${info.scoreToWin} Punkten (2 Punkte Vorsprung).</p>
        <div class="row">
          <button id="o-leave">Verlassen</button>
          <button class="primary" id="o-ready" ${both ? 'autofocus' : 'disabled'}>${me?.ready ? 'Doch nicht bereit' : 'Bereit'}</button>
        </div>
        ${both ? '' : '<p class="small">„Bereit“ wird aktiv, sobald dein Freund den Link geöffnet hat.</p>'}
      </div>`,
      (r) => {
        on(r, '#o-copy', () => copyText(link, r.querySelector('#o-copy')!));
        on(r, '#o-leave', goHome);
        on(r, '#o-ready', () => online?.ready(!me?.ready));
      },
    );
  } else if (info.phase === 'countdown') {
    const n = Math.max(1, Math.ceil(info.countdownMs / 1000));
    show(`countdown${n}`, `<div class="countdown">${notice}<div class="big">${n}</div></div>`);
  } else if (info.phase === 'playing') {
    show('', '');
  } else if (info.phase === 'paused') {
    show(
      `paused|${info.notice}`,
      `<div class="panel">
        <h2>Spiel pausiert</h2>
        ${notice}
        <p class="small">Der Platz wird 60 Sekunden freigehalten.</p>
        <button id="o-leave">Raum verlassen</button>
      </div>`,
      (r) => on(r, '#o-leave', goHome),
    );
  } else if (info.phase === 'finished') {
    const won = info.winner === info.yourSide;
    const opp = info.seats[info.yourSide === 0 ? 1 : 0];
    const status = me?.rematch
      ? opp?.rematch
        ? ''
        : 'Warte auf deinen Freund …'
      : opp?.rematch
        ? 'Dein Freund möchte eine Revanche!'
        : '';
    show(
      `finished|${JSON.stringify(info.seats)}`,
      `<div class="panel menu">
        <h2>${won ? 'Du hast gewonnen! 🎉' : 'Dein Freund hat gewonnen.'}</h2>
        <p class="score" id="o-score"></p>
        ${status ? `<p class="notice">${status}</p>` : ''}
        <button class="primary" id="o-rematch" ${me?.rematch ? 'disabled' : 'autofocus'}>Revanche</button>
        <button id="o-leave">Hauptmenü</button>
      </div>`,
      (r) => {
        on(r, '#o-rematch', () => online?.rematch());
        on(r, '#o-leave', goHome);
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
function loop(now: number): void {
  try {
    if (mode === 'local' || mode === 'ai') {
      const v = local!.frame(now);
      renderer.draw(v);
      if (local!.over) showLocalResult();
    } else if (mode === 'online' && online) {
      const v = online.frame(now);
      if (v) {
        const ping = online.rtt ? `Ping ${Math.round(online.rtt)} ms` : '';
        renderer.draw(v, { mySide: online.side, info: `Raum ${online.code}${ping ? ' · ' + ping : ''}` });
        const scoreEl = document.getElementById('o-score');
        if (scoreEl && !scoreEl.textContent) {
          scoreEl.innerHTML = `<span class="red">${v.scores[0]}</span> : <span class="blue">${v.scores[1]}</span>`;
        }
      } else {
        renderer.draw(demo.frame(now));
      }
    } else {
      if (demo.over) demo = new LocalGame(DEFAULT_SCORE_TO_WIN, [new Bot(LEFT, 'hard'), new Bot(RIGHT, 'hard')]);
      renderer.draw(demo.frame(now));
    }
  } catch (err) {
    console.error(err);
  }
  requestAnimationFrame(loop);
}

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if ((mode === 'local' || mode === 'ai') && local && !local.over) {
    if (local.paused) {
      local.paused = false;
      show('', '');
    } else {
      showLocalPause();
    }
  }
});

window.addEventListener('resize', () => renderer.resize());

function route(): void {
  const m = location.pathname.match(/^\/room\/([A-Za-z0-9]+)\/?$/);
  if (m) {
    const code = normalizeRoomCode(m[1]);
    if (isValidRoomCode(code)) {
      joinOnline(code);
      return;
    }
    showOnlineError('Dieser Einladungslink ist ungültig.');
    return;
  }
  online?.close();
  online = null;
  local = null;
  mode = 'menu';
  showMenu();
}

window.addEventListener('popstate', route);
// unlock audio on the first key press as well
window.addEventListener('keydown', () => sound.unlock(), { once: true });

route();
requestAnimationFrame(loop);

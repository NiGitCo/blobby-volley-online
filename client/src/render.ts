/*
 * Blobby Volley Online – canvas renderer (own artwork, drawn with code).
 */
import {
  BALL_RADIUS,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  GROUND_PLANE_HEIGHT_MAX,
  NET_POSITION_X,
  NET_RADIUS,
  NET_SPHERE_POSITION,
} from '../../shared/constants';
import type { MatchState } from '../../shared/engine';

/** Everything the renderer needs for one frame. */
export interface View {
  ballX: number;
  ballY: number;
  ballRot: number;
  blobX: [number, number];
  blobY: [number, number];
  blobAnim: [number, number];
  scores: [number, number];
  touches: [number, number];
  serving: number;
  ballValid: boolean;
}

export interface HudExtras {
  /** small text at the bottom centre, e.g. ping */
  info?: string;
  /** highlight "your" blob with a marker (online) */
  mySide?: number;
}

const BLOB_COLORS = [
  { body: '#e8322f', light: '#ff8a7a', dark: '#8f1512' },
  { body: '#2f62e8', light: '#86a8ff', dark: '#132f8f' },
];

export function viewFromMatch(s: MatchState): View {
  return {
    ballX: s.w.ballX,
    ballY: s.w.ballY,
    ballRot: s.w.ballRot,
    blobX: [s.w.blobX[0], s.w.blobX[1]],
    blobY: [s.w.blobY[0], s.w.blobY[1]],
    blobAnim: [s.w.blobAnim[0], s.w.blobAnim[1]],
    scores: [s.l.scores[0], s.l.scores[1]],
    touches: [s.l.touches[0], s.l.touches[1]],
    serving: s.l.serving,
    ballValid: s.l.ballValid,
  };
}

function lerp(a: number, b: number, t: number): number {
  // big jumps (ball reset) are not interpolated
  return Math.abs(b - a) > 80 ? b : a + (b - a) * t;
}

/** Smooth movement between two physics steps on fast monitors. */
export function interpolate(prev: MatchState, cur: MatchState, t: number): View {
  const v = viewFromMatch(cur);
  const p = prev.w;
  v.ballX = lerp(p.ballX, cur.w.ballX, t);
  v.ballY = lerp(p.ballY, cur.w.ballY, t);
  for (const i of [0, 1] as const) {
    v.blobX[i] = lerp(p.blobX[i], cur.w.blobX[i], t);
    v.blobY[i] = lerp(p.blobY[i], cur.w.blobY[i], t);
  }
  return v;
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private background: HTMLCanvasElement | null = null;
  private scale = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas wird von diesem Browser nicht unterstützt.');
    this.ctx = ctx;
    this.resize();
  }

  /** Match the canvas resolution to its size on screen. */
  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.scale = w / FIELD_WIDTH;
  }

  private drawBackground(): HTMLCanvasElement {
    if (this.background) return this.background;
    const c = document.createElement('canvas');
    c.width = FIELD_WIDTH;
    c.height = FIELD_HEIGHT;
    const g = c.getContext('2d')!;

    // sky
    const sky = g.createLinearGradient(0, 0, 0, 340);
    sky.addColorStop(0, '#4f97ef');
    sky.addColorStop(1, '#bfe2ff');
    g.fillStyle = sky;
    g.fillRect(0, 0, FIELD_WIDTH, 340);

    // clouds
    g.fillStyle = 'rgba(255,255,255,0.85)';
    const cloud = (x: number, y: number, s: number) => {
      g.beginPath();
      g.ellipse(x, y, 46 * s, 16 * s, 0, 0, Math.PI * 2);
      g.ellipse(x - 28 * s, y + 4 * s, 30 * s, 12 * s, 0, 0, Math.PI * 2);
      g.ellipse(x + 30 * s, y + 5 * s, 28 * s, 11 * s, 0, 0, Math.PI * 2);
      g.ellipse(x + 4 * s, y - 10 * s, 26 * s, 14 * s, 0, 0, Math.PI * 2);
      g.fill();
    };
    cloud(140, 80, 1);
    cloud(560, 60, 0.8);
    cloud(700, 150, 0.6);
    cloud(330, 170, 0.5);

    // sea
    const sea = g.createLinearGradient(0, 340, 0, 420);
    sea.addColorStop(0, '#1c6fc9');
    sea.addColorStop(1, '#46a6e0');
    g.fillStyle = sea;
    g.fillRect(0, 340, FIELD_WIDTH, 80);
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 2;
    for (let i = 0; i < 14; i++) {
      const x = (i * 97) % FIELD_WIDTH;
      const y = 355 + ((i * 37) % 55);
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + 12, y - 4, x + 24, y);
      g.stroke();
    }

    // sand
    const sand = g.createLinearGradient(0, 420, 0, FIELD_HEIGHT);
    sand.addColorStop(0, '#f6dea0');
    sand.addColorStop(1, '#ddb466');
    g.fillStyle = sand;
    g.fillRect(0, 420, FIELD_WIDTH, FIELD_HEIGHT - 420);
    g.fillStyle = 'rgba(160,110,40,0.18)';
    for (let i = 0; i < 260; i++) {
      const x = (i * 131.7) % FIELD_WIDTH;
      const y = 425 + ((i * 53.3) % 170);
      g.fillRect(x, y, 2, 2);
    }
    // ground line where the blobs stand
    g.fillStyle = 'rgba(150,100,40,0.25)';
    g.fillRect(0, GROUND_PLANE_HEIGHT_MAX, FIELD_WIDTH, 2);

    this.background = c;
    return c;
  }

  private drawShadow(x: number, y: number, w: number): void {
    const g = this.ctx;
    const h = GROUND_PLANE_HEIGHT_MAX - y;
    const alpha = Math.max(0.08, 0.3 - h / 1500);
    g.fillStyle = `rgba(60,40,10,${alpha})`;
    g.beginPath();
    g.ellipse(x + h * 0.25, GROUND_PLANE_HEIGHT_MAX + 3, w * (1 + h / 900), 7, 0, 0, Math.PI * 2);
    g.fill();
  }

  private drawNet(): void {
    const g = this.ctx;
    const x = NET_POSITION_X;
    const grad = g.createLinearGradient(x - NET_RADIUS, 0, x + NET_RADIUS, 0);
    grad.addColorStop(0, '#9a9a9a');
    grad.addColorStop(0.45, '#ffffff');
    grad.addColorStop(1, '#8a8a8a');
    g.fillStyle = grad;
    g.fillRect(x - NET_RADIUS, NET_SPHERE_POSITION, NET_RADIUS * 2, GROUND_PLANE_HEIGHT_MAX - NET_SPHERE_POSITION + 6);
    g.beginPath();
    g.arc(x, NET_SPHERE_POSITION, NET_RADIUS, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 1;
    g.strokeRect(x - NET_RADIUS, NET_SPHERE_POSITION, NET_RADIUS * 2, GROUND_PLANE_HEIGHT_MAX - NET_SPHERE_POSITION + 6);
  }

  private drawBlob(side: 0 | 1, x: number, y: number, anim: number, marker: boolean): void {
    const g = this.ctx;
    const col = BLOB_COLORS[side];
    // squash animation (5 phases like the original sprite sheet)
    const a = Math.max(0, Math.min(5, anim));
    const sy = 1 - a * 0.035;
    const sx = 1 + a * 0.025;
    const bottom = y + 45;

    g.save();
    g.translate(x, bottom);
    g.scale(sx, sy);
    g.translate(0, -45);

    // body
    g.beginPath();
    g.moveTo(0, -45);
    g.bezierCurveTo(17, -45, 26, -33, 27, -19);
    g.bezierCurveTo(29, -5, 37, 4, 36, 19);
    g.bezierCurveTo(35, 37, 20, 45, 0, 45);
    g.bezierCurveTo(-20, 45, -35, 37, -36, 19);
    g.bezierCurveTo(-37, 4, -29, -5, -27, -19);
    g.bezierCurveTo(-26, -33, -17, -45, 0, -45);
    g.closePath();
    const body = g.createRadialGradient(-10, -22, 6, 0, 5, 60);
    body.addColorStop(0, col.light);
    body.addColorStop(0.5, col.body);
    body.addColorStop(1, col.dark);
    g.globalAlpha = 0.93;
    g.fillStyle = body;
    g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = col.dark;
    g.lineWidth = 1.5;
    g.stroke();

    // glossy highlight
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath();
    g.ellipse(-11, -30, 6, 10, -0.4, 0, Math.PI * 2);
    g.fill();

    // eyes – looking towards the net
    const look = side === 0 ? 3 : -3;
    for (const ex of [-8, 8]) {
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.ellipse(ex + look, -24, 5, 7.5, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#111111';
      g.beginPath();
      g.ellipse(ex + look * 1.6, -23, 2.6, 4.2, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();

    if (marker) {
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.beginPath();
      g.moveTo(x - 7, y - 62);
      g.lineTo(x + 7, y - 62);
      g.lineTo(x, y - 53);
      g.closePath();
      g.fill();
    }
  }

  private drawBall(x: number, y: number, rot: number, faded: boolean): void {
    const g = this.ctx;
    const r = BALL_RADIUS;
    g.save();
    g.translate(x, y);
    if (faded) g.globalAlpha = 0.75;
    const shade = g.createRadialGradient(-10, -12, 4, 0, 0, r);
    shade.addColorStop(0, '#ffffff');
    shade.addColorStop(0.7, '#f1f1ea');
    shade.addColorStop(1, '#c9c9bd');
    g.fillStyle = shade;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fill();

    // volleyball seams
    g.rotate(rot);
    g.strokeStyle = '#3d6fd0';
    g.lineWidth = 2.2;
    for (let i = 0; i < 3; i++) {
      g.rotate((Math.PI * 2) / 3);
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(r * 0.55, -r * 0.2, r * 0.75, -r * 0.68);
      g.stroke();
      g.beginPath();
      g.moveTo(r * 0.35, r * 0.08);
      g.quadraticCurveTo(r * 0.85, 0, r * 0.98, -r * 0.2);
      g.stroke();
    }
    g.rotate(-rot);
    g.strokeStyle = 'rgba(70,70,60,0.6)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(0, 0, r - 0.5, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }

  private drawHud(v: View, extras: HudExtras): void {
    const g = this.ctx;
    g.textBaseline = 'top';
    g.font = 'bold 54px "Trebuchet MS", Arial, sans-serif';
    g.lineWidth = 5;
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    for (const side of [0, 1] as const) {
      const text = String(v.scores[side]) + (v.serving === side ? '!' : '');
      g.textAlign = side === 0 ? 'left' : 'right';
      const x = side === 0 ? 24 : FIELD_WIDTH - 24;
      g.strokeText(text, x, 16);
      g.fillStyle = BLOB_COLORS[side].body;
      g.fillText(text, x, 16);
      // touches of this side in the current rally
      for (let i = 0; i < 3; i++) {
        g.fillStyle = i < v.touches[side] ? '#ffffff' : 'rgba(255,255,255,0.3)';
        g.beginPath();
        const dx = side === 0 ? 32 + i * 18 : FIELD_WIDTH - 32 - i * 18;
        g.arc(dx, 84, 5, 0, Math.PI * 2);
        g.fill();
      }
    }

    // ball above the screen: arrow marker
    if (v.ballY < -BALL_RADIUS) {
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.beginPath();
      g.moveTo(v.ballX, 4);
      g.lineTo(v.ballX - 9, 18);
      g.lineTo(v.ballX + 9, 18);
      g.closePath();
      g.fill();
    }

    if (extras.info) {
      g.font = '14px Arial, sans-serif';
      g.textAlign = 'center';
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillText(extras.info, FIELD_WIDTH / 2, FIELD_HEIGHT - 22);
    }
  }

  draw(v: View, extras: HudExtras = {}): void {
    this.resize();
    const g = this.ctx;
    g.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    g.drawImage(this.drawBackground(), 0, 0);

    this.drawShadow(v.blobX[0], v.blobY[0] + 45, 32);
    this.drawShadow(v.blobX[1], v.blobY[1] + 45, 32);
    this.drawShadow(v.ballX, v.ballY + BALL_RADIUS, 24);

    this.drawNet();
    this.drawBlob(0, v.blobX[0], v.blobY[0], v.blobAnim[0], extras.mySide === 0);
    this.drawBlob(1, v.blobX[1], v.blobY[1], v.blobAnim[1], extras.mySide === 1);
    this.drawBall(v.ballX, v.ballY, v.ballRot, !v.ballValid);
    this.drawHud(v, extras);
  }
}

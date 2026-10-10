/*
 * Blobby Volley Online – keyboard handling.
 * Player 1: A / D / W     Player 2: arrow keys
 */
import type { Input } from '../../shared/engine';

const GAME_KEYS = new Set(['KeyA', 'KeyD', 'KeyW', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);

export class Keyboard {
  private readonly down = new Set<string>();
  /** while false (menus with text fields), keys are not swallowed */
  captureKeys = true;

  constructor() {
    window.addEventListener('keydown', (e) => {
      this.down.add(e.code);
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (this.captureKeys && !typing && GAME_KEYS.has(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
    });
    // releasing keys while the window is not focused would otherwise "stick"
    window.addEventListener('blur', () => this.down.clear());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.down.clear();
    });
  }

  private is(code: string): boolean {
    return this.down.has(code);
  }

  player1(): Input {
    return { left: this.is('KeyA'), right: this.is('KeyD'), up: this.is('KeyW') };
  }

  player2(): Input {
    return { left: this.is('ArrowLeft'), right: this.is('ArrowRight'), up: this.is('ArrowUp') };
  }

  /** Online: both key sets control your own blob. */
  either(): Input {
    const a = this.player1();
    const b = this.player2();
    return { left: a.left || b.left, right: a.right || b.right, up: a.up || b.up };
  }
}

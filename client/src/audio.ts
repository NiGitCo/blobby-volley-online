/*
 * Blobby Volley Online – small synthesized sound effects (no audio files).
 */
import type { MatchEvent } from '../../shared/engine';

export class Sound {
  enabled = true;
  private ctx: AudioContext | null = null;

  private context(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private tone(freq: number, endFreq: number, duration: number, volume: number, type: OscillatorType): void {
    const ctx = this.context();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(endFreq, t + duration);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  hit(intensity: number): void {
    this.tone(260 + intensity * 120, 120, 0.12, 0.15 + intensity * 0.25, 'sine');
  }

  whistle(): void {
    this.tone(1900, 2100, 0.35, 0.08, 'square');
  }

  /** Plays the sounds belonging to match events (hits, net). */
  events(events: MatchEvent[]): void {
    for (const e of events) {
      if (e.type === 'hitBlob') this.hit(e.intensity);
      else if (e.type === 'netTop') this.tone(500, 300, 0.08, 0.12, 'triangle');
    }
  }

  /** must be called from a click once, browsers block audio before that */
  unlock(): void {
    this.context();
  }
}

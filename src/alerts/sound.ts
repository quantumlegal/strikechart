import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dynamic import for play-sound
let player: any = null;

async function getPlayer() {
  if (!player) {
    const playSound = await import('play-sound');
    player = playSound.default({});
  }
  return player;
}

export type AlertLevel = 'high' | 'normal';

export class SoundAlert {
  private enabled: boolean = config.alerts.soundEnabled;
  private lastAlerts: Map<string, number> = new Map();
  private soundsDir: string;

  constructor() {
    this.soundsDir = path.resolve(__dirname, '../../sounds');
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  async play(symbol: string, level: AlertLevel = 'normal'): Promise<void> {
    if (!this.enabled) {
      return;
    }

    // Check cooldown
    const now = Date.now();
    const lastAlert = this.lastAlerts.get(symbol) || 0;
    if (now - lastAlert < config.alerts.cooldownSeconds * 1000) {
      return;
    }

    this.lastAlerts.set(symbol, now);

    const soundFile = level === 'high' ? 'alert-high.wav' : 'alert-normal.wav';
    const soundPath = path.join(this.soundsDir, soundFile);

    try {
      const p = await getPlayer();
      p.play(soundPath, (err: Error | null) => {
        if (err) {
          // Silently ignore sound errors (file might not exist or audio not available)
        }
      });
    } catch {
      // Silently ignore if play-sound is not available
    }
  }

  async playHigh(symbol: string): Promise<void> {
    return this.play(symbol, 'high');
  }

  async playNormal(symbol: string): Promise<void> {
    return this.play(symbol, 'normal');
  }

  // Clear cooldown for a symbol (useful for testing)
  clearCooldown(symbol: string): void {
    this.lastAlerts.delete(symbol);
  }

  // Clear all cooldowns
  clearAllCooldowns(): void {
    this.lastAlerts.clear();
  }
}

import { config } from '../config.js';

export class TelegramNotifier {
  private botToken: string;
  private chatId: string;
  private cooldownMs: number;
  private symbolCooldowns: Map<string, number> = new Map();
  private healthCooldownUntil: number = 0;

  constructor() {
    this.botToken = config.telegram.botToken;
    this.chatId = config.telegram.chatId;
    this.cooldownMs = config.telegram.cooldownMs;
  }

  isEnabled(): boolean {
    return config.telegram.enabled && this.botToken.length > 0 && this.chatId.length > 0;
  }

  async sendAlert(symbol: string, type: string, message: string): Promise<boolean> {
    if (!this.isEnabled()) return false;

    const now = Date.now();
    const cooldownKey = `${symbol}-${type}`;
    const lastSent = this.symbolCooldowns.get(cooldownKey) || 0;

    if (now - lastSent < this.cooldownMs) return false;

    const text = `*Signal Sense Hunter*\n\n` +
      `*${type}*: \`${symbol}\`\n` +
      `${message}`;

    const sent = await this.send(text);
    if (sent) {
      this.symbolCooldowns.set(cooldownKey, now);
      this.cleanStaleCooldowns();
    }
    return sent;
  }

  async sendHealthWarning(message: string): Promise<boolean> {
    if (!this.isEnabled()) return false;

    const now = Date.now();
    if (now < this.healthCooldownUntil) return false;

    const text = `*Signal Sense Hunter - Health Warning*\n\n${message}`;

    const sent = await this.send(text);
    if (sent) {
      this.healthCooldownUntil = now + this.cooldownMs;
    }
    return sent;
  }

  private async send(text: string): Promise<boolean> {
    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        console.warn(`[Telegram] Send failed: ${response.status}`);
        return false;
      }

      return true;
    } catch (error) {
      console.warn('[Telegram] Send error:', (error as Error).message);
      return false;
    }
  }

  private cleanStaleCooldowns(): void {
    const now = Date.now();
    const staleThreshold = 60 * 60 * 1000; // 1h

    for (const [key, timestamp] of this.symbolCooldowns) {
      if (now - timestamp > staleThreshold) {
        this.symbolCooldowns.delete(key);
      }
    }
  }
}

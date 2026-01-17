export interface NotificationConfig {
  enabled: boolean;
  soundEnabled: boolean;
  minConfidence: number;
  types: {
    smartSignals: boolean;
    volumeSpikes: boolean;
    liquidations: boolean;
    whaleAlerts: boolean;
    patterns: boolean;
    reversals: boolean;
  };
}

export interface PendingNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  symbol: string;
  direction?: 'LONG' | 'SHORT';
  confidence?: number;
  timestamp: number;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export class NotificationManager {
  private config: NotificationConfig = {
    enabled: true,
    soundEnabled: true,
    minConfidence: 60,
    types: {
      smartSignals: true,
      volumeSpikes: true,
      liquidations: true,
      whaleAlerts: true,
      patterns: true,
      reversals: true,
    },
  };

  private pendingNotifications: PendingNotification[] = [];
  private sentNotifications: Set<string> = new Set();
  private cooldownMs: number = 60000; // 1 minute cooldown per symbol/type
  private maxPending: number = 50;

  getConfig(): NotificationConfig {
    return { ...this.config };
  }

  setConfig(config: Partial<NotificationConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.types) {
      this.config.types = { ...this.config.types, ...config.types };
    }
  }

  private generateId(type: string, symbol: string): string {
    return `${type}-${symbol}-${Math.floor(Date.now() / this.cooldownMs)}`;
  }

  private shouldNotify(type: string, symbol: string, confidence?: number): boolean {
    if (!this.config.enabled) return false;

    // Check if notification type is enabled
    const typeKey = type.toLowerCase().replace(/_/g, '') as keyof typeof this.config.types;
    if (this.config.types[typeKey] === false) return false;

    // Check confidence threshold
    if (confidence !== undefined && confidence < this.config.minConfidence) return false;

    // Check cooldown
    const id = this.generateId(type, symbol);
    if (this.sentNotifications.has(id)) return false;

    return true;
  }

  addSmartSignal(
    symbol: string,
    direction: 'LONG' | 'SHORT',
    confidence: number,
    entryType: string
  ): void {
    if (!this.shouldNotify('smartSignals', symbol, confidence)) return;

    const priority = confidence >= 80 ? 'CRITICAL' : confidence >= 70 ? 'HIGH' : 'MEDIUM';

    this.addNotification({
      type: 'SMART_SIGNAL',
      title: `${direction} Signal: ${symbol}`,
      message: `${entryType} entry detected with ${confidence.toFixed(0)}% confidence`,
      symbol,
      direction,
      confidence,
      priority,
    });
  }

  addVolumeSpike(symbol: string, multiplier: number, priceChange: number): void {
    if (!this.shouldNotify('volumeSpikes', symbol)) return;

    const priority = multiplier >= 10 ? 'HIGH' : multiplier >= 5 ? 'MEDIUM' : 'LOW';

    this.addNotification({
      type: 'VOLUME_SPIKE',
      title: `Volume Spike: ${symbol}`,
      message: `${multiplier.toFixed(1)}x average volume, price ${priceChange > 0 ? '+' : ''}${priceChange.toFixed(2)}%`,
      symbol,
      direction: priceChange > 0 ? 'LONG' : 'SHORT',
      priority,
    });
  }

  addLiquidation(symbol: string, side: 'LONG' | 'SHORT', amount: number, intensity: string): void {
    if (!this.shouldNotify('liquidations', symbol)) return;

    const priority = intensity === 'EXTREME' ? 'CRITICAL' : intensity === 'HIGH' ? 'HIGH' : 'MEDIUM';

    this.addNotification({
      type: 'LIQUIDATION',
      title: `${intensity} Liquidations: ${symbol}`,
      message: `$${(amount / 1000000).toFixed(2)}M ${side} positions liquidated`,
      symbol,
      direction: side === 'LONG' ? 'SHORT' : 'LONG', // Opposite direction opportunity
      priority,
    });
  }

  addWhaleAlert(symbol: string, type: string, size: number, direction: 'BULLISH' | 'BEARISH'): void {
    if (!this.shouldNotify('whaleAlerts', symbol)) return;

    const priority = size >= 1000000 ? 'HIGH' : 'MEDIUM';

    this.addNotification({
      type: 'WHALE_ALERT',
      title: `Whale ${type}: ${symbol}`,
      message: `$${(size / 1000000).toFixed(2)}M ${direction.toLowerCase()} activity detected`,
      symbol,
      direction: direction === 'BULLISH' ? 'LONG' : 'SHORT',
      priority,
    });
  }

  addPatternAlert(symbol: string, pattern: string, confidence: number, direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL'): void {
    if (!this.shouldNotify('patterns', symbol, confidence)) return;

    const priority = confidence >= 80 ? 'HIGH' : 'MEDIUM';

    this.addNotification({
      type: 'PATTERN',
      title: `${pattern}: ${symbol}`,
      message: `Pattern detected with ${confidence}% confidence`,
      symbol,
      direction: direction === 'BULLISH' ? 'LONG' : direction === 'BEARISH' ? 'SHORT' : undefined,
      confidence,
      priority,
    });
  }

  addReversalSignal(symbol: string, type: string, confidence: number): void {
    if (!this.shouldNotify('reversals', symbol, confidence)) return;

    const isBullish = type.includes('BULLISH');
    const priority = confidence >= 75 ? 'HIGH' : 'MEDIUM';

    this.addNotification({
      type: 'REVERSAL',
      title: `${isBullish ? 'Bullish' : 'Bearish'} Reversal: ${symbol}`,
      message: `Reversal signal with ${confidence.toFixed(0)}% confidence`,
      symbol,
      direction: isBullish ? 'LONG' : 'SHORT',
      confidence,
      priority,
    });
  }

  private addNotification(params: Omit<PendingNotification, 'id' | 'timestamp'>): void {
    const id = this.generateId(params.type, params.symbol);

    // Mark as sent
    this.sentNotifications.add(id);

    // Add to pending queue
    this.pendingNotifications.push({
      id,
      timestamp: Date.now(),
      ...params,
    });

    // Trim old notifications
    if (this.pendingNotifications.length > this.maxPending) {
      this.pendingNotifications = this.pendingNotifications.slice(-this.maxPending);
    }

    // Clean up old sent IDs (older than cooldown * 2)
    const cutoff = `${Math.floor((Date.now() - this.cooldownMs * 2) / this.cooldownMs)}`;
    for (const sentId of this.sentNotifications) {
      if (sentId.split('-').pop()! < cutoff) {
        this.sentNotifications.delete(sentId);
      }
    }
  }

  getPendingNotifications(): PendingNotification[] {
    return [...this.pendingNotifications];
  }

  getAndClearPending(): PendingNotification[] {
    const notifications = [...this.pendingNotifications];
    this.pendingNotifications = [];
    return notifications;
  }

  clearAll(): void {
    this.pendingNotifications = [];
  }

  getRecentNotifications(limit: number = 20): PendingNotification[] {
    return this.pendingNotifications.slice(-limit);
  }

  getCriticalNotifications(): PendingNotification[] {
    return this.pendingNotifications.filter(n => n.priority === 'CRITICAL');
  }
}

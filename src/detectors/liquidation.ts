import { DataStore } from '../core/dataStore.js';

export interface LiquidationAlert {
  symbol: string;
  side: 'LONG' | 'SHORT';
  totalLiquidated: number;      // USD value
  liquidationCount: number;     // Number of liquidations
  avgPrice: number;
  priceImpact: number;          // % price move during liquidations
  intensity: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  timestamp: number;
}

interface LiquidationEvent {
  symbol: string;
  side: 'LONG' | 'SHORT';
  quantity: number;
  price: number;
  timestamp: number;
}

export class LiquidationDetector {
  private liquidations: Map<string, LiquidationEvent[]> = new Map();
  private windowMs: number = 5 * 60 * 1000; // 5 minute window

  constructor(private dataStore: DataStore) {}

  // Simulate liquidation detection from price/volume analysis
  // In production, you'd use Binance's forceOrder stream
  detectFromPriceAction(): void {
    const symbols = this.dataStore.getAllSymbols();
    const now = Date.now();

    for (const symbolData of symbols) {
      const { priceHistory, current, symbol } = symbolData;

      if (priceHistory.length < 10) continue;

      // Detect rapid price drops/spikes with high volume (likely liquidations)
      const recentPrices = priceHistory.slice(-10);
      const priceChange = ((current.lastPrice - recentPrices[0].price) / recentPrices[0].price) * 100;
      const absChange = Math.abs(priceChange);

      // Significant move with high volume suggests liquidations
      if (absChange > 1 && current.quoteVolume > 5000000) {
        const side: 'LONG' | 'SHORT' = priceChange < 0 ? 'LONG' : 'SHORT';

        // Estimate liquidation amount based on volume spike
        const estimatedLiq = current.quoteVolume * (absChange / 100) * 0.3; // 30% of unusual volume

        if (estimatedLiq > 100000) { // Min $100K liquidations
          const events = this.liquidations.get(symbol) || [];
          events.push({
            symbol,
            side,
            quantity: estimatedLiq,
            price: current.lastPrice,
            timestamp: now,
          });

          // Keep only recent events
          const filtered = events.filter(e => now - e.timestamp < this.windowMs);
          this.liquidations.set(symbol, filtered);
        }
      }
    }
  }

  getAlerts(): LiquidationAlert[] {
    const alerts: LiquidationAlert[] = [];
    const now = Date.now();

    for (const [symbol, events] of this.liquidations) {
      const recentEvents = events.filter(e => now - e.timestamp < this.windowMs);
      if (recentEvents.length === 0) continue;

      // Aggregate by side
      const longLiqs = recentEvents.filter(e => e.side === 'LONG');
      const shortLiqs = recentEvents.filter(e => e.side === 'SHORT');

      for (const [side, liqs] of [['LONG', longLiqs], ['SHORT', shortLiqs]] as const) {
        if (liqs.length === 0) continue;

        const totalLiquidated = liqs.reduce((sum, l) => sum + l.quantity, 0);
        const avgPrice = liqs.reduce((sum, l) => sum + l.price, 0) / liqs.length;

        const symbolData = this.dataStore.getSymbol(symbol);
        const currentPrice = symbolData?.current.lastPrice || avgPrice;
        const priceImpact = ((currentPrice - avgPrice) / avgPrice) * 100;

        let intensity: LiquidationAlert['intensity'] = 'LOW';
        if (totalLiquidated > 5000000) intensity = 'EXTREME';
        else if (totalLiquidated > 1000000) intensity = 'HIGH';
        else if (totalLiquidated > 500000) intensity = 'MEDIUM';

        if (totalLiquidated > 100000) {
          alerts.push({
            symbol,
            side,
            totalLiquidated,
            liquidationCount: liqs.length,
            avgPrice,
            priceImpact,
            intensity,
            timestamp: now,
          });
        }
      }
    }

    return alerts.sort((a, b) => b.totalLiquidated - a.totalLiquidated);
  }

  getExtremeLiquidations(): LiquidationAlert[] {
    return this.getAlerts().filter(a => a.intensity === 'EXTREME' || a.intensity === 'HIGH');
  }

  getLongLiquidations(): LiquidationAlert[] {
    return this.getAlerts().filter(a => a.side === 'LONG');
  }

  getShortLiquidations(): LiquidationAlert[] {
    return this.getAlerts().filter(a => a.side === 'SHORT');
  }
}

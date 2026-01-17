import { config } from '../config.js';
import { DataStore } from '../core/dataStore.js';
import { VolatilityAlert } from '../binance/types.js';

export class VolatilityDetector {
  constructor(private dataStore: DataStore) {}

  detect(): VolatilityAlert[] {
    const alerts: VolatilityAlert[] = [];
    const symbols = this.dataStore.getAllSymbols();

    for (const symbolData of symbols) {
      const change = symbolData.current.priceChangePercent;
      const absChange = Math.abs(change);

      if (absChange >= config.volatility.minChange24h) {
        alerts.push({
          symbol: symbolData.symbol,
          change24h: change,
          direction: change > 0 ? 'LONG' : 'SHORT',
          isCritical: absChange >= config.volatility.criticalChange24h,
          lastPrice: symbolData.current.lastPrice,
          timestamp: Date.now(),
        });
      }
    }

    // Sort by absolute change (biggest moves first)
    alerts.sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h));

    return alerts;
  }

  getGainers(): VolatilityAlert[] {
    return this.detect().filter((a) => a.direction === 'LONG');
  }

  getLosers(): VolatilityAlert[] {
    return this.detect().filter((a) => a.direction === 'SHORT');
  }

  getTopMovers(limit: number = 10): VolatilityAlert[] {
    return this.detect().slice(0, limit);
  }

  getCritical(): VolatilityAlert[] {
    return this.detect().filter((a) => a.isCritical);
  }
}

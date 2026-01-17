import { config } from '../config.js';
import { DataStore } from '../core/dataStore.js';
import { RangeAlert } from '../binance/types.js';

export class RangeDetector {
  constructor(private dataStore: DataStore) {}

  detect(): RangeAlert[] {
    const alerts: RangeAlert[] = [];
    const symbols = this.dataStore.getAllSymbols();

    for (const symbolData of symbols) {
      const { highPrice, lowPrice, openPrice, lastPrice } = symbolData.current;

      if (openPrice <= 0) {
        continue;
      }

      // Calculate range as percentage of open price
      const range = ((highPrice - lowPrice) / openPrice) * 100;

      if (range >= config.range.minRange) {
        const position = this.calculatePosition(lastPrice, highPrice, lowPrice);

        alerts.push({
          symbol: symbolData.symbol,
          range,
          position,
          currentPrice: lastPrice,
          highPrice,
          lowPrice,
          timestamp: Date.now(),
        });
      }
    }

    // Sort by range (most volatile first)
    alerts.sort((a, b) => b.range - a.range);

    return alerts;
  }

  private calculatePosition(
    current: number,
    high: number,
    low: number
  ): 'Near High' | 'Near Low' | 'Middle' | 'Breaking' {
    const totalRange = high - low;
    if (totalRange <= 0) {
      return 'Middle';
    }

    const positionInRange = (current - low) / totalRange;

    // Check if breaking out (at new high or low)
    if (current >= high * 0.999) {
      return 'Breaking';
    }
    if (current <= low * 1.001) {
      return 'Breaking';
    }

    // Position within range
    if (positionInRange >= 0.8) {
      return 'Near High';
    }
    if (positionInRange <= 0.2) {
      return 'Near Low';
    }

    return 'Middle';
  }

  getTopRanges(limit: number = 10): RangeAlert[] {
    return this.detect().slice(0, limit);
  }

  // Get symbols near their highs (potential long setups)
  getNearHighs(): RangeAlert[] {
    return this.detect().filter((a) => a.position === 'Near High' || a.position === 'Breaking');
  }

  // Get symbols near their lows (potential short setups or bounce plays)
  getNearLows(): RangeAlert[] {
    return this.detect().filter((a) => a.position === 'Near Low');
  }

  // Get actively breaking out symbols
  getBreaking(): RangeAlert[] {
    return this.detect().filter((a) => a.position === 'Breaking');
  }
}

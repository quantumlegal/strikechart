import { config } from '../config.js';
import { DataStore } from '../core/dataStore.js';
import { VelocityAlert, PricePoint } from '../binance/types.js';

export class VelocityDetector {
  private previousVelocities: Map<string, number> = new Map();

  constructor(private dataStore: DataStore) {}

  detect(): VelocityAlert[] {
    const alerts: VelocityAlert[] = [];
    const symbols = this.dataStore.getAllSymbols();

    for (const symbolData of symbols) {
      const priceHistory = symbolData.priceHistory;

      // Need at least 2 data points
      if (priceHistory.length < 2) {
        continue;
      }

      const velocity = this.calculateVelocity(priceHistory);
      const absVelocity = Math.abs(velocity);

      if (absVelocity >= config.velocity.minVelocity) {
        const previousVelocity = this.previousVelocities.get(symbolData.symbol) || 0;
        const acceleration = velocity - previousVelocity;

        let trend: 'Accelerating' | 'Steady' | 'Decelerating';
        if (acceleration > config.velocity.accelerationThreshold) {
          trend = 'Accelerating';
        } else if (acceleration < -config.velocity.accelerationThreshold) {
          trend = 'Decelerating';
        } else {
          trend = 'Steady';
        }

        alerts.push({
          symbol: symbolData.symbol,
          velocity,
          acceleration,
          trend,
          timestamp: Date.now(),
        });
      }

      // Store current velocity for next calculation
      this.previousVelocities.set(symbolData.symbol, this.calculateVelocity(priceHistory));
    }

    // Sort by absolute velocity (fastest moves first)
    alerts.sort((a, b) => Math.abs(b.velocity) - Math.abs(a.velocity));

    return alerts;
  }

  private calculateVelocity(priceHistory: PricePoint[]): number {
    if (priceHistory.length < 2) {
      return 0;
    }

    const oldest = priceHistory[0];
    const newest = priceHistory[priceHistory.length - 1];

    const priceChange = ((newest.price - oldest.price) / oldest.price) * 100;
    const timeMinutes = (newest.timestamp - oldest.timestamp) / (1000 * 60);

    if (timeMinutes <= 0) {
      return 0;
    }

    return priceChange / timeMinutes; // %/min
  }

  getAccelerating(): VelocityAlert[] {
    return this.detect().filter((a) => a.trend === 'Accelerating');
  }

  getTopVelocity(limit: number = 10): VelocityAlert[] {
    return this.detect().slice(0, limit);
  }

  // Get breakout candidates (high velocity + accelerating)
  getBreakoutCandidates(): VelocityAlert[] {
    return this.detect().filter(
      (a) => a.trend === 'Accelerating' && Math.abs(a.velocity) >= config.velocity.minVelocity * 2
    );
  }
}

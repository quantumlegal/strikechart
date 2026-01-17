import { getFundingRates } from '../binance/api.js';
import { DataStore } from '../core/dataStore.js';

export interface FundingAlert {
  symbol: string;
  fundingRate: number;        // Percentage
  nextFundingTime: number;
  markPrice: number;
  priceChange24h: number;
  signal: 'LONG_SQUEEZE' | 'SHORT_SQUEEZE' | 'EXTREME_POSITIVE' | 'EXTREME_NEGATIVE' | 'NORMAL';
  strength: 'HIGH' | 'MEDIUM' | 'LOW';
}

export class FundingDetector {
  private fundingRates: Map<string, FundingAlert> = new Map();
  private lastUpdate: number = 0;
  private updateIntervalMs: number = 60000; // Update every 60 seconds

  constructor(private dataStore: DataStore) {}

  async update(): Promise<void> {
    const now = Date.now();
    if (now - this.lastUpdate < this.updateIntervalMs) {
      return;
    }

    try {
      const rates = await getFundingRates();
      this.lastUpdate = now;

      for (const rate of rates) {
        const symbolData = this.dataStore.getSymbol(rate.symbol);
        const priceChange = symbolData?.current.priceChangePercent || 0;

        const alert = this.analyzeRate(rate, priceChange);
        this.fundingRates.set(rate.symbol, alert);
      }
    } catch (error) {
      console.error('Failed to fetch funding rates:', error);
    }
  }

  private analyzeRate(
    rate: { symbol: string; fundingRate: number; fundingTime: number; markPrice: number },
    priceChange24h: number
  ): FundingAlert {
    const { symbol, fundingRate, fundingTime, markPrice } = rate;

    let signal: FundingAlert['signal'] = 'NORMAL';
    let strength: FundingAlert['strength'] = 'LOW';

    // Extreme funding rates
    if (fundingRate > 0.1) {
      signal = 'EXTREME_POSITIVE';
      strength = fundingRate > 0.3 ? 'HIGH' : 'MEDIUM';
    } else if (fundingRate < -0.1) {
      signal = 'EXTREME_NEGATIVE';
      strength = fundingRate < -0.3 ? 'HIGH' : 'MEDIUM';
    }

    // Squeeze detection
    // Negative funding + price dropping = potential long squeeze
    if (fundingRate < -0.05 && priceChange24h < -5) {
      signal = 'LONG_SQUEEZE';
      strength = fundingRate < -0.1 && priceChange24h < -10 ? 'HIGH' : 'MEDIUM';
    }

    // Positive funding + price rising = potential short squeeze
    if (fundingRate > 0.05 && priceChange24h > 5) {
      signal = 'SHORT_SQUEEZE';
      strength = fundingRate > 0.1 && priceChange24h > 10 ? 'HIGH' : 'MEDIUM';
    }

    return {
      symbol,
      fundingRate,
      nextFundingTime: fundingTime,
      markPrice,
      priceChange24h,
      signal,
      strength,
    };
  }

  getAll(): FundingAlert[] {
    return Array.from(this.fundingRates.values());
  }

  getExtremeRates(threshold: number = 0.1): FundingAlert[] {
    return this.getAll()
      .filter((a) => Math.abs(a.fundingRate) >= threshold)
      .sort((a, b) => Math.abs(b.fundingRate) - Math.abs(a.fundingRate));
  }

  getNegativeFunding(): FundingAlert[] {
    return this.getAll()
      .filter((a) => a.fundingRate < -0.01)
      .sort((a, b) => a.fundingRate - b.fundingRate);
  }

  getPositiveFunding(): FundingAlert[] {
    return this.getAll()
      .filter((a) => a.fundingRate > 0.01)
      .sort((a, b) => b.fundingRate - a.fundingRate);
  }

  getSqueezeSignals(): FundingAlert[] {
    return this.getAll()
      .filter((a) => a.signal === 'LONG_SQUEEZE' || a.signal === 'SHORT_SQUEEZE')
      .sort((a, b) => {
        const strengthOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
        return strengthOrder[b.strength] - strengthOrder[a.strength];
      });
  }

  getSymbol(symbol: string): FundingAlert | undefined {
    return this.fundingRates.get(symbol);
  }

  // Time until next funding
  getTimeToFunding(symbol: string): number {
    const alert = this.fundingRates.get(symbol);
    if (!alert) return 0;
    return Math.max(0, alert.nextFundingTime - Date.now());
  }
}

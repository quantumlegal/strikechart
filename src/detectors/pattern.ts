import { DataStore } from '../core/dataStore.js';
import { getKlines } from '../binance/api.js';

export interface PatternAlert {
  symbol: string;
  pattern: 'DOUBLE_BOTTOM' | 'DOUBLE_TOP' | 'BREAKOUT_UP' | 'BREAKOUT_DOWN' |
           'SUPPORT_TEST' | 'RESISTANCE_TEST' | 'ROUND_NUMBER' | 'PREVIOUS_HIGH' | 'PREVIOUS_LOW';
  confidence: number;           // 0-100
  priceLevel: number;
  currentPrice: number;
  distancePercent: number;      // % from key level
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  description: string;
  timestamp: number;
}

interface PriceLevel {
  price: number;
  type: 'SUPPORT' | 'RESISTANCE' | 'ROUND' | 'HIGH' | 'LOW';
  strength: number;
}

export class PatternDetector {
  private priceData: Map<string, { high: number; low: number; levels: PriceLevel[] }> = new Map();
  private lastUpdate: number = 0;
  private updateIntervalMs: number = 60000; // Update every minute

  constructor(private dataStore: DataStore) {}

  async update(): Promise<void> {
    const now = Date.now();
    if (now - this.lastUpdate < this.updateIntervalMs) return;

    const symbols = this.dataStore.getAllSymbols()
      .filter(s => s.current.quoteVolume > 5000000) // Min $5M volume
      .slice(0, 50); // Top 50

    for (const symbolData of symbols) {
      try {
        const klines = await getKlines(symbolData.symbol, '1h', 48); // 48 hours
        if (klines.length < 24) continue;

        const highs = klines.map(k => k.high);
        const lows = klines.map(k => k.low);

        const highestHigh = Math.max(...highs);
        const lowestLow = Math.min(...lows);

        // Identify key levels
        const levels: PriceLevel[] = [];

        // Previous 24h high/low
        const recent24h = klines.slice(-24);
        const high24h = Math.max(...recent24h.map(k => k.high));
        const low24h = Math.min(...recent24h.map(k => k.low));

        levels.push({ price: high24h, type: 'HIGH', strength: 80 });
        levels.push({ price: low24h, type: 'LOW', strength: 80 });

        // Round numbers
        const currentPrice = symbolData.current.lastPrice;
        const roundNumbers = this.findRoundNumbers(currentPrice);
        for (const rn of roundNumbers) {
          levels.push({ price: rn, type: 'ROUND', strength: 60 });
        }

        // Find support/resistance from price clusters
        const priceClusterLevels = this.findPriceClusters(klines.map(k => ({ high: k.high, low: k.low, close: k.close })));
        levels.push(...priceClusterLevels);

        this.priceData.set(symbolData.symbol, {
          high: highestHigh,
          low: lowestLow,
          levels,
        });

        // Small delay to avoid rate limits
        await new Promise(r => setTimeout(r, 50));
      } catch (e) {
        // Skip failed symbols
      }
    }

    this.lastUpdate = now;
  }

  private findRoundNumbers(price: number): number[] {
    const rounds: number[] = [];
    const magnitude = Math.pow(10, Math.floor(Math.log10(price)));

    // Find nearby round numbers
    const base = Math.floor(price / magnitude) * magnitude;
    for (let i = -2; i <= 2; i++) {
      const level = base + (i * magnitude);
      if (level > 0 && Math.abs((level - price) / price) < 0.1) { // Within 10%
        rounds.push(level);
      }
    }

    return rounds;
  }

  private findPriceClusters(candles: { high: number; low: number; close: number }[]): PriceLevel[] {
    const levels: PriceLevel[] = [];
    const touchPoints: Map<number, number> = new Map();

    // Round prices to find clusters
    const precision = candles[0]?.close > 100 ? 1 : candles[0]?.close > 1 ? 0.01 : 0.0001;

    for (const candle of candles) {
      const roundedHigh = Math.round(candle.high / precision) * precision;
      const roundedLow = Math.round(candle.low / precision) * precision;

      touchPoints.set(roundedHigh, (touchPoints.get(roundedHigh) || 0) + 1);
      touchPoints.set(roundedLow, (touchPoints.get(roundedLow) || 0) + 1);
    }

    // Find levels with multiple touches
    for (const [price, touches] of touchPoints) {
      if (touches >= 3) {
        const isResistance = candles.filter(c => c.high >= price * 0.99 && c.high <= price * 1.01).length >
                            candles.filter(c => c.low >= price * 0.99 && c.low <= price * 1.01).length;

        levels.push({
          price,
          type: isResistance ? 'RESISTANCE' : 'SUPPORT',
          strength: Math.min(100, touches * 20),
        });
      }
    }

    return levels.slice(0, 5); // Top 5 levels
  }

  detect(): PatternAlert[] {
    const alerts: PatternAlert[] = [];
    const now = Date.now();

    for (const symbolData of this.dataStore.getAllSymbols()) {
      const { symbol, current, priceHistory } = symbolData;
      const data = this.priceData.get(symbol);

      if (!data || priceHistory.length < 10) continue;

      const currentPrice = current.lastPrice;

      // Check proximity to key levels
      for (const level of data.levels) {
        const distance = ((currentPrice - level.price) / level.price) * 100;
        const absDistance = Math.abs(distance);

        // Only alert if within 2% of level
        if (absDistance > 2) continue;

        let pattern: PatternAlert['pattern'];
        let direction: PatternAlert['direction'];
        let description: string;

        if (level.type === 'RESISTANCE' && distance > 0) {
          pattern = 'BREAKOUT_UP';
          direction = 'BULLISH';
          description = `Breaking above resistance at $${level.price.toFixed(4)}`;
        } else if (level.type === 'SUPPORT' && distance < 0) {
          pattern = 'BREAKOUT_DOWN';
          direction = 'BEARISH';
          description = `Breaking below support at $${level.price.toFixed(4)}`;
        } else if (level.type === 'RESISTANCE') {
          pattern = 'RESISTANCE_TEST';
          direction = 'NEUTRAL';
          description = `Testing resistance at $${level.price.toFixed(4)}`;
        } else if (level.type === 'SUPPORT') {
          pattern = 'SUPPORT_TEST';
          direction = 'NEUTRAL';
          description = `Testing support at $${level.price.toFixed(4)}`;
        } else if (level.type === 'ROUND') {
          pattern = 'ROUND_NUMBER';
          direction = distance > 0 ? 'BULLISH' : 'BEARISH';
          description = `Near round number $${level.price.toFixed(2)}`;
        } else if (level.type === 'HIGH') {
          pattern = 'PREVIOUS_HIGH';
          direction = distance > 0 ? 'BULLISH' : 'NEUTRAL';
          description = `Near 24h high $${level.price.toFixed(4)}`;
        } else {
          pattern = 'PREVIOUS_LOW';
          direction = distance < 0 ? 'BEARISH' : 'NEUTRAL';
          description = `Near 24h low $${level.price.toFixed(4)}`;
        }

        // Calculate confidence
        const proximityBonus = Math.max(0, 30 - absDistance * 15);
        const confidence = Math.round(Math.min(100, level.strength * 0.5 + proximityBonus));

        if (confidence >= 40) {
          alerts.push({
            symbol,
            pattern,
            confidence,
            priceLevel: level.price,
            currentPrice,
            distancePercent: Math.round(distance * 100) / 100,
            direction,
            description,
            timestamp: now,
          });
        }
      }

      // Detect double bottom/top patterns from price history
      if (priceHistory.length >= 30) {
        const doublePattern = this.detectDoublePattern(priceHistory.map(p => p.price));
        if (doublePattern) {
          alerts.push({
            symbol,
            pattern: doublePattern.type,
            confidence: doublePattern.confidence,
            priceLevel: doublePattern.level,
            currentPrice,
            distancePercent: ((currentPrice - doublePattern.level) / doublePattern.level) * 100,
            direction: doublePattern.type === 'DOUBLE_BOTTOM' ? 'BULLISH' : 'BEARISH',
            description: doublePattern.type === 'DOUBLE_BOTTOM'
              ? `Double bottom forming at $${doublePattern.level.toFixed(4)}`
              : `Double top forming at $${doublePattern.level.toFixed(4)}`,
            timestamp: now,
          });
        }
      }
    }

    return alerts.sort((a, b) => b.confidence - a.confidence);
  }

  private detectDoublePattern(prices: number[]): { type: 'DOUBLE_BOTTOM' | 'DOUBLE_TOP'; level: number; confidence: number } | null {
    if (prices.length < 20) return null;

    const recent = prices.slice(-20);
    const min1 = Math.min(...recent.slice(0, 10));
    const min2 = Math.min(...recent.slice(10));
    const max1 = Math.max(...recent.slice(0, 10));
    const max2 = Math.max(...recent.slice(10));

    // Double bottom: two similar lows
    const minDiff = Math.abs((min1 - min2) / min1) * 100;
    if (minDiff < 2 && prices[prices.length - 1] > min2 * 1.02) {
      return {
        type: 'DOUBLE_BOTTOM',
        level: (min1 + min2) / 2,
        confidence: Math.round(80 - minDiff * 10),
      };
    }

    // Double top: two similar highs
    const maxDiff = Math.abs((max1 - max2) / max1) * 100;
    if (maxDiff < 2 && prices[prices.length - 1] < max2 * 0.98) {
      return {
        type: 'DOUBLE_TOP',
        level: (max1 + max2) / 2,
        confidence: Math.round(80 - maxDiff * 10),
      };
    }

    return null;
  }

  getBreakouts(): PatternAlert[] {
    return this.detect().filter(a => a.pattern === 'BREAKOUT_UP' || a.pattern === 'BREAKOUT_DOWN');
  }

  getSupportResistanceTests(): PatternAlert[] {
    return this.detect().filter(a => a.pattern === 'SUPPORT_TEST' || a.pattern === 'RESISTANCE_TEST');
  }

  getTopPatterns(limit: number = 20): PatternAlert[] {
    return this.detect().slice(0, limit);
  }
}

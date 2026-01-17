import { DataStore } from '../core/dataStore.js';

export interface WhaleAlert {
  symbol: string;
  type: 'LARGE_BUY' | 'LARGE_SELL' | 'ACCUMULATION' | 'DISTRIBUTION';
  estimatedSize: number;        // USD value
  priceLevel: number;
  volumeRatio: number;          // How much larger than average
  direction: 'BULLISH' | 'BEARISH';
  confidence: number;           // 0-100
  timestamp: number;
}

interface VolumeSnapshot {
  volume: number;
  price: number;
  timestamp: number;
}

export class WhaleDetector {
  private volumeHistory: Map<string, VolumeSnapshot[]> = new Map();
  private whaleThreshold: number = 100000; // $100K minimum for whale activity
  private windowMs: number = 10 * 60 * 1000; // 10 minute window

  constructor(private dataStore: DataStore) {}

  update(): void {
    const symbols = this.dataStore.getAllSymbols();
    const now = Date.now();

    for (const symbolData of symbols) {
      const { symbol, current } = symbolData;

      let history = this.volumeHistory.get(symbol) || [];
      history.push({
        volume: current.quoteVolume,
        price: current.lastPrice,
        timestamp: now,
      });

      // Keep last 60 snapshots
      if (history.length > 60) {
        history = history.slice(-60);
      }
      this.volumeHistory.set(symbol, history);
    }
  }

  detect(): WhaleAlert[] {
    const alerts: WhaleAlert[] = [];
    const now = Date.now();

    for (const symbolData of this.dataStore.getAllSymbols()) {
      const { symbol, current } = symbolData;
      const history = this.volumeHistory.get(symbol) || [];

      if (history.length < 30) continue;

      // Calculate volume delta (incremental volume)
      const recentHistory = history.slice(-10);
      const olderHistory = history.slice(-30, -10);

      if (olderHistory.length < 10) continue;

      const recentVolumeDelta = recentHistory[recentHistory.length - 1].volume - recentHistory[0].volume;
      const avgVolumeDelta = (olderHistory[olderHistory.length - 1].volume - olderHistory[0].volume) / olderHistory.length * 10;

      if (avgVolumeDelta <= 0) continue;

      const volumeRatio = recentVolumeDelta / avgVolumeDelta;

      // Detect unusual volume with significant size
      if (recentVolumeDelta > this.whaleThreshold && volumeRatio > 3) {
        // Determine if it's buying or selling based on price action
        const priceChange = ((current.lastPrice - recentHistory[0].price) / recentHistory[0].price) * 100;
        const isBuying = priceChange > 0.1;
        const isSelling = priceChange < -0.1;

        let type: WhaleAlert['type'];
        let direction: WhaleAlert['direction'];

        if (isBuying && volumeRatio > 5) {
          type = 'ACCUMULATION';
          direction = 'BULLISH';
        } else if (isSelling && volumeRatio > 5) {
          type = 'DISTRIBUTION';
          direction = 'BEARISH';
        } else if (isBuying) {
          type = 'LARGE_BUY';
          direction = 'BULLISH';
        } else if (isSelling) {
          type = 'LARGE_SELL';
          direction = 'BEARISH';
        } else {
          continue; // Neutral volume spike
        }

        // Confidence based on volume ratio and size
        const sizeConfidence = Math.min(50, (recentVolumeDelta / 1000000) * 25);
        const ratioConfidence = Math.min(50, (volumeRatio / 10) * 50);
        const confidence = Math.round(sizeConfidence + ratioConfidence);

        alerts.push({
          symbol,
          type,
          estimatedSize: recentVolumeDelta,
          priceLevel: current.lastPrice,
          volumeRatio,
          direction,
          confidence,
          timestamp: now,
        });
      }
    }

    return alerts.sort((a, b) => b.estimatedSize - a.estimatedSize);
  }

  getTopWhaleActivity(limit: number = 20): WhaleAlert[] {
    return this.detect().slice(0, limit);
  }

  getAccumulation(): WhaleAlert[] {
    return this.detect().filter(a => a.type === 'ACCUMULATION');
  }

  getDistribution(): WhaleAlert[] {
    return this.detect().filter(a => a.type === 'DISTRIBUTION');
  }

  getBullishWhales(): WhaleAlert[] {
    return this.detect().filter(a => a.direction === 'BULLISH');
  }

  getBearishWhales(): WhaleAlert[] {
    return this.detect().filter(a => a.direction === 'BEARISH');
  }
}

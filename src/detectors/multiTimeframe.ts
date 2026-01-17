import { getMultiTimeframeChanges, getSymbolRSI, getKlines, calculateRSI } from '../binance/api.js';
import { DataStore } from '../core/dataStore.js';

export interface MTFAlert {
  symbol: string;
  change15m: number;
  change1h: number;
  change4h: number;
  change24h: number;
  rsi1h: number;
  alignment: 'STRONG_BULLISH' | 'BULLISH' | 'MIXED' | 'BEARISH' | 'STRONG_BEARISH';
  divergence: 'BULLISH_DIV' | 'BEARISH_DIV' | 'NONE';
  momentum: 'ACCELERATING' | 'DECELERATING' | 'STEADY';
  timestamp: number;
}

export class MultiTimeframeDetector {
  private mtfData: Map<string, MTFAlert> = new Map();
  private lastUpdate: number = 0;
  private updateIntervalMs: number = 60000; // Update every minute
  private symbolQueue: string[] = [];
  private currentIndex: number = 0;

  constructor(private dataStore: DataStore) {}

  async update(): Promise<void> {
    const now = Date.now();

    // Initialize queue if empty
    if (this.symbolQueue.length === 0) {
      const symbols = this.dataStore.getAllSymbols();
      this.symbolQueue = symbols
        .filter((s) => s.current.quoteVolume > 10000000) // Only symbols with >$10M volume
        .map((s) => s.symbol)
        .slice(0, 50); // Top 50 by activity
    }

    // Process 5 symbols per update cycle to avoid rate limits
    const batchSize = 5;
    const batch = this.symbolQueue.slice(this.currentIndex, this.currentIndex + batchSize);

    for (const symbol of batch) {
      try {
        const changes = await getMultiTimeframeChanges(symbol);
        const rsi = await getSymbolRSI(symbol, '1h');

        const alert = this.analyzeSymbol(symbol, changes, rsi);
        this.mtfData.set(symbol, alert);
      } catch (error) {
        // Skip failed symbols
      }
    }

    this.currentIndex = (this.currentIndex + batchSize) % this.symbolQueue.length;
  }

  private analyzeSymbol(
    symbol: string,
    changes: { change15m: number; change1h: number; change4h: number; change24h: number },
    rsi: number
  ): MTFAlert {
    const { change15m, change1h, change4h, change24h } = changes;

    // Determine alignment
    const allPositive = change15m > 0 && change1h > 0 && change4h > 0;
    const allNegative = change15m < 0 && change1h < 0 && change4h < 0;
    const strongPositive = allPositive && change15m > 1 && change1h > 2;
    const strongNegative = allNegative && change15m < -1 && change1h < -2;

    let alignment: MTFAlert['alignment'] = 'MIXED';
    if (strongPositive) alignment = 'STRONG_BULLISH';
    else if (strongNegative) alignment = 'STRONG_BEARISH';
    else if (allPositive) alignment = 'BULLISH';
    else if (allNegative) alignment = 'BEARISH';

    // Detect divergence (short-term vs long-term disagreement)
    let divergence: MTFAlert['divergence'] = 'NONE';
    if (change15m > 1 && change4h < -2) {
      divergence = 'BEARISH_DIV'; // Short-term pump, long-term down = potential reversal down
    } else if (change15m < -1 && change4h > 2) {
      divergence = 'BULLISH_DIV'; // Short-term dip, long-term up = potential bounce
    }

    // Momentum (comparing timeframes)
    let momentum: MTFAlert['momentum'] = 'STEADY';
    if (Math.abs(change15m) > Math.abs(change1h) && Math.abs(change1h) > Math.abs(change4h)) {
      momentum = 'ACCELERATING';
    } else if (Math.abs(change15m) < Math.abs(change1h) && Math.abs(change1h) < Math.abs(change4h)) {
      momentum = 'DECELERATING';
    }

    return {
      symbol,
      change15m,
      change1h,
      change4h,
      change24h,
      rsi1h: rsi,
      alignment,
      divergence,
      momentum,
      timestamp: Date.now(),
    };
  }

  getAll(): MTFAlert[] {
    return Array.from(this.mtfData.values());
  }

  getAligned(direction: 'BULLISH' | 'BEARISH'): MTFAlert[] {
    return this.getAll().filter((a) =>
      direction === 'BULLISH'
        ? a.alignment === 'STRONG_BULLISH' || a.alignment === 'BULLISH'
        : a.alignment === 'STRONG_BEARISH' || a.alignment === 'BEARISH'
    );
  }

  getStrongAligned(): MTFAlert[] {
    return this.getAll().filter(
      (a) => a.alignment === 'STRONG_BULLISH' || a.alignment === 'STRONG_BEARISH'
    );
  }

  getDivergences(): MTFAlert[] {
    return this.getAll().filter((a) => a.divergence !== 'NONE');
  }

  getAccelerating(): MTFAlert[] {
    return this.getAll().filter((a) => a.momentum === 'ACCELERATING');
  }

  getRSIExtremes(): MTFAlert[] {
    return this.getAll().filter((a) => a.rsi1h < 25 || a.rsi1h > 75);
  }

  getOversold(): MTFAlert[] {
    return this.getAll()
      .filter((a) => a.rsi1h < 30)
      .sort((a, b) => a.rsi1h - b.rsi1h);
  }

  getOverbought(): MTFAlert[] {
    return this.getAll()
      .filter((a) => a.rsi1h > 70)
      .sort((a, b) => b.rsi1h - a.rsi1h);
  }

  getSymbol(symbol: string): MTFAlert | undefined {
    return this.mtfData.get(symbol);
  }
}

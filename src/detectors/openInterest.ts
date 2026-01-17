import { getAllOpenInterest } from '../binance/api.js';
import { DataStore } from '../core/dataStore.js';

export interface OIAlert {
  symbol: string;
  openInterest: number;
  oiChange: number;           // Percentage change from previous
  priceChange: number;        // Current price change %
  signal: 'STRONG_TREND' | 'BUILDING_SHORTS' | 'BUILDING_LONGS' | 'CLOSING_POSITIONS' | 'NEUTRAL';
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  timestamp: number;
}

interface OIHistory {
  openInterest: number;
  timestamp: number;
}

export class OpenInterestDetector {
  private currentOI: Map<string, number> = new Map();
  private oiHistory: Map<string, OIHistory[]> = new Map();
  private lastUpdate: number = 0;
  private updateIntervalMs: number = 120000; // Update every 2 minutes

  constructor(private dataStore: DataStore) {}

  async update(): Promise<void> {
    const now = Date.now();
    if (now - this.lastUpdate < this.updateIntervalMs) {
      return;
    }

    try {
      const oiData = await getAllOpenInterest();
      this.lastUpdate = now;

      for (const data of oiData) {
        const prevOI = this.currentOI.get(data.symbol);
        this.currentOI.set(data.symbol, data.openInterest);

        // Store history
        const history = this.oiHistory.get(data.symbol) || [];
        history.push({ openInterest: data.openInterest, timestamp: now });

        // Keep last 30 data points (about 1 hour)
        if (history.length > 30) {
          history.shift();
        }
        this.oiHistory.set(data.symbol, history);
      }
    } catch (error) {
      console.error('Failed to fetch open interest:', error);
    }
  }

  analyze(): OIAlert[] {
    const alerts: OIAlert[] = [];

    for (const [symbol, currentOI] of this.currentOI) {
      const history = this.oiHistory.get(symbol) || [];
      if (history.length < 2) continue;

      const previousOI = history[history.length - 2]?.openInterest || currentOI;
      const oiChange = ((currentOI - previousOI) / previousOI) * 100;

      const symbolData = this.dataStore.getSymbol(symbol);
      const priceChange = symbolData?.current.priceChangePercent || 0;

      const alert = this.determineSignal(symbol, currentOI, oiChange, priceChange);
      if (alert.signal !== 'NEUTRAL') {
        alerts.push(alert);
      }
    }

    return alerts.sort((a, b) => Math.abs(b.oiChange) - Math.abs(a.oiChange));
  }

  private determineSignal(
    symbol: string,
    openInterest: number,
    oiChange: number,
    priceChange: number
  ): OIAlert {
    let signal: OIAlert['signal'] = 'NEUTRAL';
    let direction: OIAlert['direction'] = 'NEUTRAL';

    // Rising OI + Rising Price = Strong bullish trend (new longs entering)
    if (oiChange > 2 && priceChange > 1) {
      signal = 'STRONG_TREND';
      direction = 'BULLISH';
    }
    // Rising OI + Falling Price = Shorts building (potential squeeze)
    else if (oiChange > 2 && priceChange < -1) {
      signal = 'BUILDING_SHORTS';
      direction = 'BEARISH'; // But watch for squeeze
    }
    // Falling OI + Rising Price = Short squeeze / shorts closing
    else if (oiChange < -2 && priceChange > 1) {
      signal = 'CLOSING_POSITIONS';
      direction = 'BULLISH'; // Shorts covering
    }
    // Falling OI + Falling Price = Longs closing / liquidations
    else if (oiChange < -2 && priceChange < -1) {
      signal = 'CLOSING_POSITIONS';
      direction = 'BEARISH'; // Longs exiting
    }
    // Rising OI significantly with any price = new positions building
    else if (oiChange > 5) {
      signal = priceChange > 0 ? 'BUILDING_LONGS' : 'BUILDING_SHORTS';
      direction = priceChange > 0 ? 'BULLISH' : 'BEARISH';
    }

    return {
      symbol,
      openInterest,
      oiChange,
      priceChange,
      signal,
      direction,
      timestamp: Date.now(),
    };
  }

  getSignificantChanges(minChange: number = 3): OIAlert[] {
    return this.analyze().filter((a) => Math.abs(a.oiChange) >= minChange);
  }

  getBullishSignals(): OIAlert[] {
    return this.analyze().filter((a) => a.direction === 'BULLISH');
  }

  getBearishSignals(): OIAlert[] {
    return this.analyze().filter((a) => a.direction === 'BEARISH');
  }

  getSqueezeSetups(): OIAlert[] {
    // Building shorts with rising OI = potential short squeeze
    // Building longs with falling price = potential long squeeze
    return this.analyze().filter(
      (a) => a.signal === 'BUILDING_SHORTS' || a.signal === 'BUILDING_LONGS'
    );
  }

  getSymbol(symbol: string): OIAlert | undefined {
    return this.analyze().find((a) => a.symbol === symbol);
  }
}

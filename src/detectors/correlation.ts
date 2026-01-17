import { DataStore } from '../core/dataStore.js';

export interface CorrelationAlert {
  symbol: string;
  btcCorrelation: number;       // -1 to 1 correlation coefficient
  isDecoupling: boolean;        // True if breaking from BTC
  decouplingStrength: number;   // 0-100 how strong the decoupling is
  altPerformance: number;       // Alt's % change
  btcPerformance: number;       // BTC's % change
  outperformance: number;       // Alt vs BTC difference
  signal: 'OUTPERFORMING' | 'UNDERPERFORMING' | 'DECOUPLING_UP' | 'DECOUPLING_DOWN' | 'CORRELATED';
  timestamp: number;
}

interface PricePoint {
  price: number;
  timestamp: number;
}

export class CorrelationDetector {
  private priceHistory: Map<string, PricePoint[]> = new Map();
  private btcHistory: PricePoint[] = [];
  private windowSize: number = 60; // 60 data points for correlation

  constructor(private dataStore: DataStore) {}

  update(): void {
    const symbols = this.dataStore.getAllSymbols();
    const now = Date.now();

    // Update BTC price history
    const btcData = this.dataStore.getSymbol('BTCUSDT');
    if (btcData) {
      this.btcHistory.push({ price: btcData.current.lastPrice, timestamp: now });
      if (this.btcHistory.length > this.windowSize) {
        this.btcHistory = this.btcHistory.slice(-this.windowSize);
      }
    }

    // Update all symbol histories
    for (const symbolData of symbols) {
      const { symbol, current } = symbolData;
      let history = this.priceHistory.get(symbol) || [];
      history.push({ price: current.lastPrice, timestamp: now });

      if (history.length > this.windowSize) {
        history = history.slice(-this.windowSize);
      }
      this.priceHistory.set(symbol, history);
    }
  }

  // Calculate Pearson correlation coefficient
  private calculateCorrelation(prices1: number[], prices2: number[]): number {
    if (prices1.length !== prices2.length || prices1.length < 10) return 0;

    const n = prices1.length;
    const mean1 = prices1.reduce((a, b) => a + b, 0) / n;
    const mean2 = prices2.reduce((a, b) => a + b, 0) / n;

    let numerator = 0;
    let denom1 = 0;
    let denom2 = 0;

    for (let i = 0; i < n; i++) {
      const diff1 = prices1[i] - mean1;
      const diff2 = prices2[i] - mean2;
      numerator += diff1 * diff2;
      denom1 += diff1 * diff1;
      denom2 += diff2 * diff2;
    }

    const denominator = Math.sqrt(denom1 * denom2);
    if (denominator === 0) return 0;

    return numerator / denominator;
  }

  detect(): CorrelationAlert[] {
    const alerts: CorrelationAlert[] = [];
    const now = Date.now();

    if (this.btcHistory.length < 30) return alerts;

    const btcPrices = this.btcHistory.map(p => p.price);
    const btcStart = btcPrices[0];
    const btcEnd = btcPrices[btcPrices.length - 1];
    const btcPerformance = ((btcEnd - btcStart) / btcStart) * 100;

    for (const [symbol, history] of this.priceHistory) {
      if (symbol === 'BTCUSDT' || symbol === 'BTCUSDC') continue;
      if (history.length < 30) continue;

      const altPrices = history.slice(-this.btcHistory.length).map(p => p.price);
      if (altPrices.length !== btcPrices.length) continue;

      const correlation = this.calculateCorrelation(altPrices, btcPrices);

      const altStart = altPrices[0];
      const altEnd = altPrices[altPrices.length - 1];
      const altPerformance = ((altEnd - altStart) / altStart) * 100;
      const outperformance = altPerformance - btcPerformance;

      // Determine signal
      let signal: CorrelationAlert['signal'] = 'CORRELATED';
      let isDecoupling = false;
      let decouplingStrength = 0;

      // Low correlation = decoupling
      if (Math.abs(correlation) < 0.3) {
        isDecoupling = true;
        decouplingStrength = Math.round((1 - Math.abs(correlation)) * 100);
        signal = altPerformance > 0 ? 'DECOUPLING_UP' : 'DECOUPLING_DOWN';
      }
      // High correlation but very different performance = interesting
      else if (Math.abs(outperformance) > 3) {
        signal = outperformance > 0 ? 'OUTPERFORMING' : 'UNDERPERFORMING';
        decouplingStrength = Math.round(Math.min(100, Math.abs(outperformance) * 10));
      }

      // Only report interesting cases
      if (isDecoupling || Math.abs(outperformance) > 2) {
        const symbolData = this.dataStore.getSymbol(symbol);
        if (!symbolData || symbolData.current.quoteVolume < 1000000) continue; // Min $1M volume

        alerts.push({
          symbol,
          btcCorrelation: Math.round(correlation * 100) / 100,
          isDecoupling,
          decouplingStrength,
          altPerformance: Math.round(altPerformance * 100) / 100,
          btcPerformance: Math.round(btcPerformance * 100) / 100,
          outperformance: Math.round(outperformance * 100) / 100,
          signal,
          timestamp: now,
        });
      }
    }

    return alerts.sort((a, b) => Math.abs(b.outperformance) - Math.abs(a.outperformance));
  }

  getDecoupling(): CorrelationAlert[] {
    return this.detect().filter(a => a.isDecoupling);
  }

  getOutperformers(): CorrelationAlert[] {
    return this.detect().filter(a => a.signal === 'OUTPERFORMING');
  }

  getUnderperformers(): CorrelationAlert[] {
    return this.detect().filter(a => a.signal === 'UNDERPERFORMING');
  }

  getTopAlerts(limit: number = 20): CorrelationAlert[] {
    return this.detect().slice(0, limit);
  }
}

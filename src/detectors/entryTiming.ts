import { DataStore } from '../core/dataStore.js';
import { getKlines, calculateRSI } from '../binance/api.js';

export interface EntrySignal {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
  riskRewardRatio: number;
  atr: number;                  // Average True Range
  vwap: number;                 // Volume Weighted Average Price
  entryType: 'PULLBACK' | 'BREAKOUT' | 'REVERSAL' | 'MOMENTUM';
  confidence: number;
  reasons: string[];
  timestamp: number;
}

interface KlineData {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export class EntryTimingCalculator {
  private entryData: Map<string, EntrySignal> = new Map();
  private lastUpdate: number = 0;
  private updateIntervalMs: number = 30000; // Update every 30 seconds

  constructor(private dataStore: DataStore) {}

  async update(): Promise<void> {
    const now = Date.now();
    if (now - this.lastUpdate < this.updateIntervalMs) return;

    const symbols = this.dataStore.getAllSymbols()
      .filter(s => s.current.quoteVolume > 5000000)
      .sort((a, b) => Math.abs(b.current.priceChangePercent) - Math.abs(a.current.priceChangePercent))
      .slice(0, 30); // Top 30 movers

    for (const symbolData of symbols) {
      try {
        const klines = await getKlines(symbolData.symbol, '15m', 50);
        if (klines.length < 30) continue;

        const signal = await this.calculateEntry(symbolData.symbol, klines);
        if (signal) {
          this.entryData.set(symbolData.symbol, signal);
        }

        await new Promise(r => setTimeout(r, 100)); // Rate limit
      } catch (e) {
        // Skip failed symbols
      }
    }

    this.lastUpdate = now;
  }

  private async calculateEntry(symbol: string, klines: KlineData[]): Promise<EntrySignal | null> {
    const now = Date.now();
    const symbolData = this.dataStore.getSymbol(symbol);
    if (!symbolData) return null;

    const currentPrice = symbolData.current.lastPrice;
    const change24h = symbolData.current.priceChangePercent;

    // Calculate ATR (Average True Range)
    const atr = this.calculateATR(klines, 14);

    // Calculate VWAP
    const vwap = this.calculateVWAP(klines.slice(-20));

    // Calculate RSI
    const closes = klines.map(k => k.close);
    const rsi = calculateRSI(closes);

    // Determine direction based on trend
    const direction: 'LONG' | 'SHORT' = change24h > 0 ? 'LONG' : 'SHORT';

    // Determine entry type
    let entryType: EntrySignal['entryType'] = 'MOMENTUM';
    const reasons: string[] = [];

    // Pullback entry: price retraced but trend intact
    if (direction === 'LONG' && currentPrice < vwap && currentPrice > vwap * 0.97) {
      entryType = 'PULLBACK';
      reasons.push('Price pulled back to VWAP - good entry on dip');
    } else if (direction === 'SHORT' && currentPrice > vwap && currentPrice < vwap * 1.03) {
      entryType = 'PULLBACK';
      reasons.push('Price bounced to VWAP - good entry on rally');
    }

    // RSI-based entries
    if (rsi < 30 && direction === 'LONG') {
      entryType = 'REVERSAL';
      reasons.push(`RSI oversold (${rsi.toFixed(0)}) - potential bounce`);
    } else if (rsi > 70 && direction === 'SHORT') {
      entryType = 'REVERSAL';
      reasons.push(`RSI overbought (${rsi.toFixed(0)}) - potential pullback`);
    }

    // Breakout detection
    const recentHigh = Math.max(...klines.slice(-20).map(k => k.high));
    const recentLow = Math.min(...klines.slice(-20).map(k => k.low));

    if (currentPrice > recentHigh * 0.99 && direction === 'LONG') {
      entryType = 'BREAKOUT';
      reasons.push('Breaking above recent highs');
    } else if (currentPrice < recentLow * 1.01 && direction === 'SHORT') {
      entryType = 'BREAKOUT';
      reasons.push('Breaking below recent lows');
    }

    // Add momentum reason if strong move
    if (Math.abs(change24h) > 10) {
      reasons.push(`Strong ${change24h > 0 ? 'bullish' : 'bearish'} momentum (${change24h.toFixed(1)}%)`);
    }

    // Calculate stop loss and take profits using ATR
    let stopLoss: number;
    let takeProfit1: number;
    let takeProfit2: number;
    let takeProfit3: number;

    if (direction === 'LONG') {
      stopLoss = currentPrice - (atr * 2);
      takeProfit1 = currentPrice + (atr * 1.5);
      takeProfit2 = currentPrice + (atr * 3);
      takeProfit3 = currentPrice + (atr * 5);
    } else {
      stopLoss = currentPrice + (atr * 2);
      takeProfit1 = currentPrice - (atr * 1.5);
      takeProfit2 = currentPrice - (atr * 3);
      takeProfit3 = currentPrice - (atr * 5);
    }

    // Calculate risk/reward ratio
    const risk = Math.abs(currentPrice - stopLoss);
    const reward = Math.abs(takeProfit2 - currentPrice);
    const riskRewardRatio = reward / risk;

    // Calculate confidence
    let confidence = 50;
    if (riskRewardRatio >= 2) confidence += 15;
    if (entryType === 'PULLBACK') confidence += 10;
    if (entryType === 'REVERSAL' && (rsi < 25 || rsi > 75)) confidence += 10;
    if (Math.abs(change24h) > 5) confidence += 10;
    if (reasons.length >= 2) confidence += 5;

    confidence = Math.min(95, confidence);

    // Only return signals with decent confidence
    if (confidence < 50 || riskRewardRatio < 1.5) return null;

    return {
      symbol,
      direction,
      entryPrice: currentPrice,
      stopLoss,
      takeProfit1,
      takeProfit2,
      takeProfit3,
      riskRewardRatio: Math.round(riskRewardRatio * 100) / 100,
      atr,
      vwap,
      entryType,
      confidence,
      reasons,
      timestamp: now,
    };
  }

  private calculateATR(klines: KlineData[], period: number = 14): number {
    if (klines.length < period + 1) return 0;

    const trueRanges: number[] = [];

    for (let i = 1; i < klines.length; i++) {
      const high = klines[i].high;
      const low = klines[i].low;
      const prevClose = klines[i - 1].close;

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trueRanges.push(tr);
    }

    // Simple moving average of TR
    const recentTR = trueRanges.slice(-period);
    return recentTR.reduce((sum, tr) => sum + tr, 0) / recentTR.length;
  }

  private calculateVWAP(klines: KlineData[]): number {
    let cumulativeTPV = 0;
    let cumulativeVolume = 0;

    for (const k of klines) {
      const typicalPrice = (k.high + k.low + k.close) / 3;
      cumulativeTPV += typicalPrice * k.volume;
      cumulativeVolume += k.volume;
    }

    return cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : 0;
  }

  getEntrySignals(): EntrySignal[] {
    return Array.from(this.entryData.values())
      .sort((a, b) => b.confidence - a.confidence);
  }

  getLongEntries(limit: number = 10): EntrySignal[] {
    return this.getEntrySignals()
      .filter(s => s.direction === 'LONG')
      .slice(0, limit);
  }

  getShortEntries(limit: number = 10): EntrySignal[] {
    return this.getEntrySignals()
      .filter(s => s.direction === 'SHORT')
      .slice(0, limit);
  }

  getPullbackEntries(): EntrySignal[] {
    return this.getEntrySignals().filter(s => s.entryType === 'PULLBACK');
  }

  getBreakoutEntries(): EntrySignal[] {
    return this.getEntrySignals().filter(s => s.entryType === 'BREAKOUT');
  }

  getReversalEntries(): EntrySignal[] {
    return this.getEntrySignals().filter(s => s.entryType === 'REVERSAL');
  }

  getHighRRSetups(minRR: number = 2): EntrySignal[] {
    return this.getEntrySignals().filter(s => s.riskRewardRatio >= minRR);
  }

  getSymbol(symbol: string): EntrySignal | undefined {
    return this.entryData.get(symbol);
  }
}

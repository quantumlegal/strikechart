import { config } from '../config.js';
import {
  TickerData,
  SymbolData,
  PricePoint,
  VolumePoint,
} from '../binance/types.js';

export class DataStore {
  private symbols: Map<string, SymbolData> = new Map();
  private knownSymbols: Set<string> = new Set();
  private initialized: boolean = false;

  update(tickers: TickerData[]): { newListings: string[] } {
    const now = Date.now();
    const newListings: string[] = [];

    for (const ticker of tickers) {
      const existing = this.symbols.get(ticker.symbol);

      if (existing) {
        // Update existing symbol
        this.updateSymbol(existing, ticker, now);
      } else {
        // New symbol
        const isNew = this.initialized && !this.knownSymbols.has(ticker.symbol);
        if (isNew) {
          newListings.push(ticker.symbol);
        }

        this.symbols.set(ticker.symbol, {
          symbol: ticker.symbol,
          current: ticker,
          priceHistory: [{ price: ticker.lastPrice, timestamp: now }],
          volumeHistory: [{ volume: ticker.quoteVolume, timestamp: now }],
          firstSeen: now,
          isNew,
        });

        this.knownSymbols.add(ticker.symbol);
      }
    }

    // Mark as initialized after first batch
    if (!this.initialized) {
      this.initialized = true;
    }

    return { newListings };
  }

  private updateSymbol(data: SymbolData, ticker: TickerData, now: number): void {
    data.current = ticker;

    // Add to price history
    data.priceHistory.push({ price: ticker.lastPrice, timestamp: now });

    // Add to volume history
    data.volumeHistory.push({ volume: ticker.quoteVolume, timestamp: now });

    // Trim old data (keep last N minutes based on config)
    const velocityWindow = config.velocity.windowMinutes * 60 * 1000;
    const volumeWindow = config.volume.avgWindowMinutes * 60 * 1000;

    data.priceHistory = this.trimHistory(data.priceHistory, velocityWindow);
    data.volumeHistory = this.trimHistory(data.volumeHistory, volumeWindow);

    // After 1 hour, no longer considered "new"
    if (data.isNew && now - data.firstSeen > 60 * 60 * 1000) {
      data.isNew = false;
    }
  }

  private trimHistory<T extends { timestamp: number }>(
    history: T[],
    windowMs: number
  ): T[] {
    const cutoff = Date.now() - windowMs;
    return history.filter((point) => point.timestamp > cutoff);
  }

  getSymbol(symbol: string): SymbolData | undefined {
    return this.symbols.get(symbol);
  }

  getAllSymbols(): SymbolData[] {
    return Array.from(this.symbols.values());
  }

  getSymbolCount(): number {
    return this.symbols.size;
  }

  getPriceHistory(symbol: string): PricePoint[] {
    return this.symbols.get(symbol)?.priceHistory || [];
  }

  getVolumeHistory(symbol: string): VolumePoint[] {
    return this.symbols.get(symbol)?.volumeHistory || [];
  }

  getNewListings(): SymbolData[] {
    return Array.from(this.symbols.values()).filter((s) => s.isNew);
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

import { DataStore } from './dataStore.js';
import { Opportunity } from '../binance/types.js';

export interface FilterConfig {
  minVolume24h: number;         // Minimum 24h volume in USDT
  minChange24h: number;         // Minimum absolute % change
  excludeSymbols: string[];     // Symbols to exclude
  watchlist: string[];          // Only show these if set
  onlyUSDT: boolean;            // Only USDT pairs
  excludeStablecoins: boolean;  // Exclude stablecoin pairs
}

const STABLECOINS = ['USDC', 'BUSD', 'DAI', 'TUSD', 'USDP', 'FDUSD'];

export class FilterManager {
  private config: FilterConfig = {
    minVolume24h: 0,
    minChange24h: 0,
    excludeSymbols: [],
    watchlist: [],
    onlyUSDT: true,
    excludeStablecoins: true,
  };

  constructor(private dataStore: DataStore) {}

  setConfig(config: Partial<FilterConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): FilterConfig {
    return { ...this.config };
  }

  setMinVolume(volume: number): void {
    this.config.minVolume24h = volume;
  }

  setMinChange(change: number): void {
    this.config.minChange24h = change;
  }

  addToWatchlist(symbol: string): void {
    if (!this.config.watchlist.includes(symbol)) {
      this.config.watchlist.push(symbol.toUpperCase());
    }
  }

  removeFromWatchlist(symbol: string): void {
    this.config.watchlist = this.config.watchlist.filter(
      (s) => s !== symbol.toUpperCase()
    );
  }

  clearWatchlist(): void {
    this.config.watchlist = [];
  }

  getWatchlist(): string[] {
    return [...this.config.watchlist];
  }

  excludeSymbol(symbol: string): void {
    if (!this.config.excludeSymbols.includes(symbol)) {
      this.config.excludeSymbols.push(symbol.toUpperCase());
    }
  }

  includeSymbol(symbol: string): void {
    this.config.excludeSymbols = this.config.excludeSymbols.filter(
      (s) => s !== symbol.toUpperCase()
    );
  }

  // Apply filters to opportunities
  filterOpportunities(opportunities: Opportunity[]): Opportunity[] {
    return opportunities.filter((opp) => this.passesFilter(opp.symbol));
  }

  // Check if a symbol passes all filters
  passesFilter(symbol: string): boolean {
    const symbolData = this.dataStore.getSymbol(symbol);
    if (!symbolData) return false;

    // Watchlist filter (if set, only show watchlist)
    if (this.config.watchlist.length > 0) {
      if (!this.config.watchlist.includes(symbol)) {
        return false;
      }
    }

    // Exclude list
    if (this.config.excludeSymbols.includes(symbol)) {
      return false;
    }

    // USDT only
    if (this.config.onlyUSDT && !symbol.endsWith('USDT')) {
      return false;
    }

    // Exclude stablecoins
    if (this.config.excludeStablecoins) {
      const base = symbol.replace(/USDT$|BUSD$|USD$/, '');
      if (STABLECOINS.includes(base)) {
        return false;
      }
    }

    // Minimum volume
    if (this.config.minVolume24h > 0) {
      if (symbolData.current.quoteVolume < this.config.minVolume24h) {
        return false;
      }
    }

    // Minimum change
    if (this.config.minChange24h > 0) {
      if (Math.abs(symbolData.current.priceChangePercent) < this.config.minChange24h) {
        return false;
      }
    }

    return true;
  }

  // Get filtered symbols from data store
  getFilteredSymbols(): string[] {
    return this.dataStore
      .getAllSymbols()
      .filter((s) => this.passesFilter(s.symbol))
      .map((s) => s.symbol);
  }

  // Get volume tiers
  getByVolumeTier(tier: 'MEGA' | 'HIGH' | 'MEDIUM' | 'LOW'): string[] {
    const thresholds = {
      MEGA: 500_000_000,    // >$500M
      HIGH: 100_000_000,    // $100M-$500M
      MEDIUM: 20_000_000,   // $20M-$100M
      LOW: 0,               // <$20M
    };

    const symbols = this.dataStore.getAllSymbols();

    return symbols
      .filter((s) => {
        const vol = s.current.quoteVolume;
        switch (tier) {
          case 'MEGA':
            return vol >= thresholds.MEGA;
          case 'HIGH':
            return vol >= thresholds.HIGH && vol < thresholds.MEGA;
          case 'MEDIUM':
            return vol >= thresholds.MEDIUM && vol < thresholds.HIGH;
          case 'LOW':
            return vol < thresholds.MEDIUM;
        }
      })
      .map((s) => s.symbol);
  }
}

// Preset filter configurations
export const FILTER_PRESETS = {
  // Only high-volume coins (>$50M daily volume)
  highVolume: {
    minVolume24h: 50_000_000,
    minChange24h: 0,
    excludeSymbols: [],
    watchlist: [],
    onlyUSDT: true,
    excludeStablecoins: true,
  } as FilterConfig,

  // Big movers only (>5% change)
  bigMovers: {
    minVolume24h: 10_000_000,
    minChange24h: 5,
    excludeSymbols: [],
    watchlist: [],
    onlyUSDT: true,
    excludeStablecoins: true,
  } as FilterConfig,

  // Top tier only (mega volume)
  topTier: {
    minVolume24h: 100_000_000,
    minChange24h: 0,
    excludeSymbols: [],
    watchlist: [],
    onlyUSDT: true,
    excludeStablecoins: true,
  } as FilterConfig,

  // All symbols (no filter)
  all: {
    minVolume24h: 0,
    minChange24h: 0,
    excludeSymbols: [],
    watchlist: [],
    onlyUSDT: true,
    excludeStablecoins: true,
  } as FilterConfig,
};

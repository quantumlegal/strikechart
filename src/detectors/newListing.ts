import { DataStore } from '../core/dataStore.js';
import { NewListingAlert, SymbolData } from '../binance/types.js';

export class NewListingDetector {
  private firstPrices: Map<string, number> = new Map();

  constructor(private dataStore: DataStore) {}

  detect(): NewListingAlert[] {
    const alerts: NewListingAlert[] = [];
    const newListings = this.dataStore.getNewListings();

    for (const symbolData of newListings) {
      const alert = this.createAlert(symbolData);
      if (alert) {
        alerts.push(alert);
      }
    }

    // Sort by change from first price (biggest movers first)
    alerts.sort((a, b) => Math.abs(b.changeFromFirst) - Math.abs(a.changeFromFirst));

    return alerts;
  }

  private createAlert(symbolData: SymbolData): NewListingAlert | null {
    const symbol = symbolData.symbol;
    const currentPrice = symbolData.current.lastPrice;

    // Record first price if not already recorded
    if (!this.firstPrices.has(symbol)) {
      this.firstPrices.set(symbol, currentPrice);
    }

    const firstPrice = this.firstPrices.get(symbol)!;
    const changeFromFirst = ((currentPrice - firstPrice) / firstPrice) * 100;

    return {
      symbol,
      firstPrice,
      currentPrice,
      changeFromFirst,
      timestamp: Date.now(),
    };
  }

  // Called when new symbols appear in the WebSocket stream
  onNewSymbols(symbols: string[]): NewListingAlert[] {
    const alerts: NewListingAlert[] = [];

    for (const symbol of symbols) {
      const symbolData = this.dataStore.getSymbol(symbol);
      if (symbolData) {
        const alert = this.createAlert(symbolData);
        if (alert) {
          alerts.push(alert);
        }
      }
    }

    return alerts;
  }

  getAll(): NewListingAlert[] {
    return this.detect();
  }

  // Get new listings that have moved significantly
  getSignificantMovers(minChange: number = 10): NewListingAlert[] {
    return this.detect().filter((a) => Math.abs(a.changeFromFirst) >= minChange);
  }
}

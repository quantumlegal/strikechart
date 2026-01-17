// Binance Futures URL generator

const BINANCE_FUTURES_BASE = 'https://www.binance.com/en/futures';

/**
 * Generate a Binance Futures trading URL for a symbol
 * @param symbol - The trading pair symbol (e.g., "BTCUSDT")
 * @returns The full Binance Futures URL
 */
export function generateBinanceUrl(symbol: string): string {
  // Binance Futures URLs are lowercase
  return `${BINANCE_FUTURES_BASE}/${symbol}`;
}

/**
 * Generate a Binance chart URL with specific settings
 * @param symbol - The trading pair symbol
 * @param interval - The chart interval (e.g., "1m", "5m", "1h", "1d")
 * @returns The Binance TradingView chart URL
 */
export function generateChartUrl(symbol: string, interval: string = '5m'): string {
  return `${BINANCE_FUTURES_BASE}/${symbol}?type=perpetual&interval=${interval}`;
}

/**
 * Generate a Binance market info URL
 * @param symbol - The trading pair symbol
 * @returns The Binance market info URL
 */
export function generateMarketInfoUrl(symbol: string): string {
  return `https://www.binance.com/en/trade/${symbol}?type=cross`;
}

/**
 * Extract the base asset from a USDT pair
 * @param symbol - The trading pair symbol (e.g., "BTCUSDT")
 * @returns The base asset (e.g., "BTC")
 */
export function getBaseAsset(symbol: string): string {
  if (symbol.endsWith('USDT')) {
    return symbol.slice(0, -4);
  }
  if (symbol.endsWith('BUSD')) {
    return symbol.slice(0, -4);
  }
  if (symbol.endsWith('USD')) {
    return symbol.slice(0, -3);
  }
  return symbol;
}

/**
 * Check if a symbol is a USDT perpetual
 * @param symbol - The trading pair symbol
 * @returns True if it's a USDT perpetual pair
 */
export function isUsdtPerpetual(symbol: string): boolean {
  return symbol.endsWith('USDT');
}

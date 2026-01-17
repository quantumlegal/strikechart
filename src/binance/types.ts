// Binance Futures 24hr Ticker data from WebSocket
export interface BinanceTicker {
  e: string;           // Event type: "24hrTicker"
  E: number;           // Event time
  s: string;           // Symbol (e.g., "BTCUSDT")
  p: string;           // Price change
  P: string;           // Price change percent
  w: string;           // Weighted average price
  c: string;           // Last price
  Q: string;           // Last quantity
  o: string;           // Open price
  h: string;           // High price
  l: string;           // Low price
  v: string;           // Total traded base asset volume
  q: string;           // Total traded quote asset volume
  O: number;           // Statistics open time
  C: number;           // Statistics close time
  F: number;           // First trade ID
  L: number;           // Last trade ID
  n: number;           // Total number of trades
}

// Parsed ticker data for internal use
export interface TickerData {
  symbol: string;
  lastPrice: number;
  priceChange: number;
  priceChangePercent: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  quoteVolume: number;
  trades: number;
  eventTime: number;
}

// Symbol tracking data
export interface SymbolData {
  symbol: string;
  current: TickerData;
  priceHistory: PricePoint[];      // For velocity calculation
  volumeHistory: VolumePoint[];    // For volume spike detection
  firstSeen: number;               // Timestamp when first observed
  isNew: boolean;                  // True if recently listed
}

// Price point for velocity tracking
export interface PricePoint {
  price: number;
  timestamp: number;
}

// Volume point for rolling average
export interface VolumePoint {
  volume: number;
  timestamp: number;
}

// Detection results
export interface VolatilityAlert {
  symbol: string;
  change24h: number;
  direction: 'LONG' | 'SHORT';
  isCritical: boolean;
  lastPrice: number;
  timestamp: number;
}

export interface VolumeAlert {
  symbol: string;
  currentVolume: number;
  averageVolume: number;
  multiplier: number;
  priceChange: number;
  timestamp: number;
}

export interface VelocityAlert {
  symbol: string;
  velocity: number;           // %/min
  acceleration: number;       // Change in velocity
  trend: 'Accelerating' | 'Steady' | 'Decelerating';
  timestamp: number;
}

export interface RangeAlert {
  symbol: string;
  range: number;              // (High - Low) / Open as %
  position: 'Near High' | 'Near Low' | 'Middle' | 'Breaking';
  currentPrice: number;
  highPrice: number;
  lowPrice: number;
  timestamp: number;
}

export interface NewListingAlert {
  symbol: string;
  firstPrice: number;
  currentPrice: number;
  changeFromFirst: number;
  timestamp: number;
}

// Unified opportunity for ranking
export interface Opportunity {
  symbol: string;
  type: 'VOLATILITY' | 'VOLUME' | 'VELOCITY' | 'RANGE' | 'NEW_LISTING';
  score: number;              // 0-100 composite score
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  details: {
    change24h?: number;
    volumeMultiplier?: number;
    velocity?: number;
    range?: number;
    isNew?: boolean;
  };
  timestamp: number;
  lastPrice: number;
}

// WebSocket connection status
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

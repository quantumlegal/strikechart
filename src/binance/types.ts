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
  recentPriceChange: number; // Price change during spike window (last ~10 snapshots)
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

// Health & Efficiency report
export interface HealthReport {
  cycle: number;
  timestamp: number;
  memory: {
    heapUsedMB: number;
    heapTotalMB: number;
    rssMB: number;
    externalMB: number;
    percentUsed: number;
    warning: boolean;
  };
  websocket: {
    status: ConnectionStatus;
    lastDataReceivedAgo: number;
    reconnectAttempts: number;
    watchdogTriggered: boolean;
  };
  database: {
    tables: Record<string, number>;
    sizeBytes: number;
    pruned: { opportunities: number; alerts: number; pendingSignals: number };
    vacuumed: boolean;
  };
  dataStore: {
    symbolCount: number;
    staleSymbolsRemoved: string[];
  };
  maps: {
    connectionsPerIPSize: number;
    socketMessageCountsSize: number;
    entriesCleaned: number;
  };
  ml: {
    enabled: boolean;
    serviceAvailable: boolean;
    cacheSize: number;
  };
  intervals: {
    updateInterval: boolean;
    logInterval: boolean;
    detectorInterval: boolean;
  };
  autoTraining?: {
    completedSignals: number;
    lastTrainingTime: number;
    newSignalsSinceLastTrain: number;
    triggered: boolean;
    trainResult: any | null;
  };
  backup?: {
    backedUp: boolean;
    backupPath?: string;
    backupCount?: number;
  };
}

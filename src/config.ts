import dotenv from 'dotenv';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

export const config = {
  // Detection thresholds
  volatility: {
    minChange24h: Number(process.env.MIN_CHANGE_24H) || 10,
    criticalChange24h: Number(process.env.CRITICAL_CHANGE_24H) || 25,
  },
  volume: {
    spikeMultiplier: Number(process.env.VOLUME_SPIKE_MULTIPLIER) || 3,
    avgWindowMinutes: Number(process.env.AVG_WINDOW_MINUTES) || 60,
    minQuoteVolume: isProduction ? 10000000 : 0, // $10M minimum in production
  },
  velocity: {
    minVelocity: Number(process.env.MIN_VELOCITY) || 0.5,
    windowMinutes: Number(process.env.VELOCITY_WINDOW_MINUTES) || 5,
    accelerationThreshold: Number(process.env.ACCELERATION_THRESHOLD) || 0.1,
  },
  range: {
    minRange: Number(process.env.MIN_RANGE) || 15,
  },

  // UI settings - slower refresh in production to save resources
  ui: {
    refreshMs: isProduction ? 2000 : (Number(process.env.UI_REFRESH_MS) || 1000),
    maxDisplayed: isProduction ? 15 : (Number(process.env.MAX_DISPLAYED) || 20),
  },

  // Alerts
  alerts: {
    soundEnabled: process.env.SOUND_ENABLED !== 'false',
    cooldownSeconds: Number(process.env.COOLDOWN_SECONDS) || 30,
  },

  // WebSocket
  websocket: {
    url: 'wss://fstream.binance.com/ws/!ticker@arr',
    reconnectDelayMs: 5000,
    pingInterval: isProduction ? 25000 : 30000,
    pingTimeout: 20000,
  },

  // Storage
  storage: {
    dbPath: './data/signalsensehunter.db',
  },

  // Memory management (production optimizations)
  memory: {
    maxPriceHistory: isProduction ? 100 : 500,
    maxVolumeHistory: isProduction ? 50 : 200,
    gcIntervalMs: isProduction ? 300000 : 600000, // 5 min in prod, 10 min in dev
  },

  // Detector update intervals (staggered in production)
  detectors: {
    funding: isProduction ? 120000 : 60000,
    openInterest: isProduction ? 120000 : 60000,
    multiTimeframe: 60000,
    pattern: 60000,
    entry: 30000,
    topPicker: 5000,
    correlation: 30000,
    whale: 10000,
    liquidation: 5000,
  },

  // Logging level
  logging: {
    verbose: !isProduction,
  },

  // ML Service configuration
  ml: {
    enabled: process.env.ML_ENABLED !== 'false',
    serviceUrl: process.env.ML_SERVICE_URL || 'http://localhost:8001',
    timeout: Number(process.env.ML_TIMEOUT) || 2000,
    minSignalsForTraining: Number(process.env.ML_MIN_SIGNALS) || 500,
    mlWeight: Number(process.env.ML_WEIGHT) || 0.6,
    ruleWeight: Number(process.env.RULE_WEIGHT) || 0.4,
    filterThreshold: Number(process.env.ML_FILTER_THRESHOLD) || 0.40, // Filter signals below 40% win prob
    healthCheckInterval: 30000, // 30 seconds
    cacheTTL: 5000, // 5 second cache
  },

  // OMNIA Protocol Tracker configuration
  omnia: {
    enabled: process.env.OMNIA_ENABLED !== 'false',
    coingeckoApiKey: process.env.COINGECKO_API_KEY || '',
    etherscanApiKey: process.env.ETHERSCAN_API_KEY || '',
    bscscanApiKey: process.env.BSCSCAN_API_KEY || '',
    contractAddress: '0x75780415fca0157e4814a1a2588f1ee9ff0f7e88',
    priceUpdateInterval: Number(process.env.OMNIA_PRICE_INTERVAL) || 60000, // 60 seconds
    transferUpdateInterval: Number(process.env.OMNIA_TRANSFER_INTERVAL) || 30000, // 30 seconds
    whaleThreshold: Number(process.env.OMNIA_WHALE_THRESHOLD) || 100000, // Alert if > 100K OMNIA
  },
};

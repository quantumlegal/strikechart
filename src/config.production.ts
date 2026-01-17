// Production configuration - optimized for performance and security

export const productionConfig = {
  // Server settings
  server: {
    port: process.env.PORT || 3000,
    host: '0.0.0.0', // Allow external connections
    cors: {
      origin: process.env.ALLOWED_ORIGINS?.split(',') || ['*'],
      methods: ['GET', 'POST'],
    },
  },

  // WebSocket optimization
  websocket: {
    // Reduce update frequency for lower bandwidth
    updateIntervalMs: 2000, // 2 seconds instead of 1

    // Connection pooling
    pingInterval: 25000,
    pingTimeout: 20000,

    // Compression
    perMessageDeflate: {
      threshold: 1024, // Only compress messages > 1KB
    },
  },

  // Detection thresholds - optimized to reduce noise
  volatility: {
    minChange24h: 10,
    criticalChange24h: 25,
  },

  volume: {
    spikeMultiplier: 3,
    avgWindowMinutes: 60,
    minQuoteVolume: 10000000, // $10M minimum for quality
  },

  velocity: {
    minVelocity: 0.5,
    windowMinutes: 5,
    accelerationThreshold: 0.1,
  },

  // UI settings - limit data sent to clients
  ui: {
    maxDisplayed: 15, // Reduced from 20
    refreshMs: 2000,
  },

  // Detector update intervals - staggered to reduce CPU spikes
  detectors: {
    funding: 120000,      // 2 min
    openInterest: 120000, // 2 min
    multiTimeframe: 60000, // 1 min
    pattern: 60000,       // 1 min
    entry: 30000,         // 30 sec
    topPicker: 5000,      // 5 sec (priority feature)
    correlation: 30000,   // 30 sec
    whale: 10000,         // 10 sec
    liquidation: 5000,    // 5 sec
  },

  // Memory management
  memory: {
    maxPriceHistory: 100,    // Reduced from unlimited
    maxVolumeHistory: 50,
    maxSignalHistory: 500,
    gcIntervalMs: 300000,    // Run cleanup every 5 min
  },

  // Rate limiting
  rateLimit: {
    windowMs: 60000,
    maxRequests: 100,
  },

  // Caching
  cache: {
    fundingTtl: 60000,       // Cache funding for 1 min
    patternTtl: 30000,       // Cache patterns for 30 sec
    topPicksTtl: 5000,       // Cache top picks for 5 sec
  },

  // Security headers
  security: {
    helmet: true,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'", "wss:", "ws:"],
      },
    },
  },

  // Logging
  logging: {
    level: 'warn', // Only log warnings and errors in production
    format: 'json',
  },
};

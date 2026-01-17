import dotenv from 'dotenv';

dotenv.config();

export const config = {
  // Detection thresholds
  volatility: {
    minChange24h: Number(process.env.MIN_CHANGE_24H) || 10,        // Minimum ±10% 24H change
    criticalChange24h: Number(process.env.CRITICAL_CHANGE_24H) || 25,   // Critical alert at ±25%
  },
  volume: {
    spikeMultiplier: Number(process.env.VOLUME_SPIKE_MULTIPLIER) || 3,      // Alert when volume > 3x average
    avgWindowMinutes: Number(process.env.AVG_WINDOW_MINUTES) || 60,    // Rolling average window
  },
  velocity: {
    minVelocity: Number(process.env.MIN_VELOCITY) || 0.5,        // Minimum 0.5%/min to flag
    windowMinutes: Number(process.env.VELOCITY_WINDOW_MINUTES) || 5,        // Calculate over 5 minutes
    accelerationThreshold: Number(process.env.ACCELERATION_THRESHOLD) || 0.1, // Velocity increase per minute
  },
  range: {
    minRange: Number(process.env.MIN_RANGE) || 15,            // Minimum 15% daily range
  },

  // UI settings
  ui: {
    refreshMs: Number(process.env.UI_REFRESH_MS) || 1000,         // Dashboard refresh rate
    maxDisplayed: Number(process.env.MAX_DISPLAYED) || 20,        // Max items per category
  },

  // Alerts
  alerts: {
    soundEnabled: process.env.SOUND_ENABLED !== 'false',
    cooldownSeconds: Number(process.env.COOLDOWN_SECONDS) || 30,     // Don't repeat same alert within 30s
  },

  // WebSocket
  websocket: {
    url: 'wss://fstream.binance.com/ws/!ticker@arr',
    reconnectDelayMs: 5000,
  },

  // Storage
  storage: {
    dbPath: './data/strikechart.db',
  },
};

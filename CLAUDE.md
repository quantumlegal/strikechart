# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
# Development - Terminal UI (hot reload)
npm run dev

# Development - Web server (hot reload)
npm run dev:web

# Production build
npm run build

# Production - Terminal UI
npm run start

# Production - Web server
npm run start:web

# PM2 deployment (cluster mode)
pm2 start dist/web-index.js --name strikechart -i max
```

## Architecture Overview

Signal Sense Hunter is a real-time Binance Futures volatility hunter monitoring 584+ trading pairs.

### Data Flow

```
Binance WebSocket (!ticker@arr)
    ↓
BinanceWebSocket (src/binance/websocket.ts)
    ↓
DataStore (src/core/dataStore.ts) - maintains rolling price/volume history
    ↓
18 Parallel Detectors (src/detectors/*.ts)
    ↓
OpportunityRanker (src/core/opportunity.ts) - aggregates & scores
    ↓
Terminal UI (blessed) OR Web Server (Express + Socket.IO)
    ↓
SQLite persistence (sql.js)
```

### Detector Pattern

All detectors follow the same structure:
```typescript
class XxxDetector {
  constructor(private dataStore: DataStore) {}
  detect(): XxxAlert[] { ... }
  getTopAlerts(limit: number): XxxAlert[] { ... }
}
```

Detectors operate independently on DataStore. OpportunityRanker orchestrates all 18 detectors and converts their outputs to a unified `Opportunity` type with composite scoring.

### Key Directories

- `src/binance/` - WebSocket connection and Binance types
- `src/core/` - DataStore, OpportunityRanker, FilterManager
- `src/detectors/` - 18 detector modules (volatility, volume, velocity, smartSignal, etc.)
- `src/ui/` - Terminal dashboard (blessed)
- `src/web/` - Express + Socket.IO server
- `src/storage/` - SQLite persistence

### Entry Points

- `src/index.ts` - Terminal UI entry point (Signal Sense Hunter class)
- `src/web-index.ts` - Web server entry point (Signal Sense HunterWeb class)

## Configuration

- `src/config.ts` - Development config (thresholds, intervals, alert settings)
- `src/config.production.ts` - Production optimizations (reduced memory, staggered updates)

Key config values:
- `volatility.minChange24h`: 10% threshold for volatility alerts
- `volume.spikeMultiplier`: 3x average volume = alert
- `velocity.minVelocity`: 0.5%/min price movement threshold
- `ui.refreshMs`: Dashboard update interval (1000ms dev, 2000ms prod)

## Adding New Detectors

1. Create `src/detectors/yourDetector.ts` following the detector pattern
2. Define your alert interface in the detector file
3. Add detector instance to `OpportunityRanker` constructor
4. Call detector in `getAllOpportunities()` method
5. Map detector alerts to `Opportunity` type with appropriate scoring

## Important Patterns

- DataStore uses rolling windows (5-60 min) with auto-trimming to manage memory
- Detectors are called in parallel but results are aggregated synchronously
- SmartSignal detector fuses 7 signal components for high-confidence trades
- TopPicker provides composite scoring across all detector outputs
- NotificationManager handles deduplication and cooldown for alerts

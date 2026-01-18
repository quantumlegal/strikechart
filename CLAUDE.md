# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Signal Sense Hunter** is a real-time Binance Futures volatility scanner monitoring 584+ trading pairs with ML-powered signal quality prediction.

- **Live URL**: https://signalsense.trade
- **GitHub**: https://github.com/quantumlegal/strikechart.git
- **VPS Provider**: Hostinger (KVM 4)

---

## Production Infrastructure

### Hostinger VPS Details

| Property | Value |
|----------|-------|
| Server | srv1256837.hstgr.cloud |
| IP Address | 72.61.93.6 |
| OS | Ubuntu 24.04 LTS |
| Plan | KVM 4 |
| CPU | 4 cores |
| Memory | 16 GB |
| Disk | 200 GB |
| Location | Germany - Frankfurt |
| VPS ID | 1256837 |

### Docker Containers

| Container | Port | Purpose |
|-----------|------|---------|
| signalsensehunter-app | 3001 | Node.js main application |
| signalsensehunter-ml | 8001 | Python ML service (XGBoost/LightGBM) |

### Docker Volumes (CRITICAL - Preserve These!)

| Volume | Contents | Purpose |
|--------|----------|---------|
| `ml-models` | `.joblib` files | Trained ML models |
| `app-data` | SQLite database | Signal features, outcomes, ML predictions |

### Firewall Rules

| Port | Protocol | Purpose |
|------|----------|---------|
| 22 | TCP | SSH |
| 80 | TCP | HTTP |
| 443 | TCP | HTTPS |
| 3001 | TCP | Node.js app |
| 8001 | TCP | ML service |

---

## Deployment

### Prerequisites

- Node.js 20+
- Git access to https://github.com/quantumlegal/strikechart.git
- Hostinger API access (via MCP tools)

### Local Development

```bash
# Install dependencies
npm install

# Development - Web server (hot reload)
npm run dev:web

# Development - Terminal UI (hot reload)
npm run dev

# Build TypeScript
npm run build
```

### Deploy to Production

**Method 1: Via Claude Code MCP (Recommended)**

```javascript
// 1. Make code changes locally
// 2. Build: npm run build
// 3. Commit and push to GitHub
git add .
git commit -m "Your changes"
git push origin master

// 4. Deploy via Hostinger MCP
mcp__hostinger-mcp__VPS_createNewProjectV1({
  virtualMachineId: 1256837,
  project_name: "signalsensehunter",
  content: "https://github.com/quantumlegal/strikechart"
})
```

**Method 2: Via SSH**

```bash
ssh root@72.61.93.6
cd /docker/signalsensehunter
git pull origin master
docker-compose down           # Stops containers, KEEPS volumes
docker-compose up --build -d  # Rebuilds with new code
docker-compose ps             # Verify healthy
```

### CRITICAL: Volume Preservation

**DO NOT** delete and recreate the project - this deletes Docker volumes and loses all ML training data!

**Correct**: Use `VPS_createNewProjectV1` with same project name (replaces code, keeps volumes)
**Correct**: Use `VPS_updateProjectV1` (restarts containers with existing code)
**WRONG**: Delete project then create new one (loses all training data!)

### Verify Deployment

```bash
# Check containers are healthy
curl https://signalsense.trade/api/status
# Expected: {"status":"connected","symbolCount":584,"uptime":...}

# Check ML data preserved
curl https://signalsense.trade/api/ml/feature-counts
# Expected: {"total":X,"completed":Y,...} where X > 0
```

---

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

---

## Architecture Overview

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
SmartSignalEngine + ML Client (predictions)
    ↓
Web Server (Express + Socket.IO) → Dashboard
    ↓
SQLite persistence (sql.js) + ML Service (Python)
```

### ML Architecture

```
┌─── Node.js App ──────────────────────────────────────┐
│  SmartSignalEngine (rule-based: 0-100 confidence)    │
│         ↓                                            │
│  FeatureExtractor (35+ features per signal)          │
│         ↓                                            │
│  MLServiceClient ──→ Python ML Service (port 8001)   │
│         ↓              ↓                             │
│  Combined Confidence = 60% ML + 40% Rule-based       │
└──────────────────────────────────────────────────────┘

┌─── Python ML Service ────────────────────────────────┐
│  FastAPI + XGBoost + LightGBM Ensemble               │
│  POST /api/v1/predict     → Single prediction        │
│  POST /api/v1/predict/batch → Batch predictions      │
│  POST /api/v1/train       → Trigger retraining       │
│  GET  /api/v1/stats       → Model metrics            │
│  GET  /health             → Service health           │
└──────────────────────────────────────────────────────┘
```

### Key Directories

- `src/binance/` - WebSocket connection and Binance types
- `src/core/` - DataStore, OpportunityRanker, FilterManager
- `src/detectors/` - 18 detector modules (volatility, volume, velocity, smartSignal, etc.)
- `src/services/` - ML client, feature extractor
- `src/storage/` - SQLite persistence
- `src/ui/` - Terminal dashboard (blessed)
- `src/web/` - Express + Socket.IO server
- `ml-service/` - Python ML microservice
- `public/` - Frontend HTML/CSS/JS

### Entry Points

- `src/index.ts` - Terminal UI entry point
- `src/web-index.ts` - Web server entry point
- `ml-service/app/main.py` - ML service entry point

---

## Security Configuration

### Rate Limiting (src/web/server.ts)

| Limiter | Limit | Endpoints |
|---------|-------|-----------|
| `apiLimiter` | 100 req/min | All `/api/*` routes |
| `strictLimiter` | 10 req/min | Sensitive endpoints (ML training) |
| `sparklineLimiter` | 600 req/min | `/api/price-history/:symbol` |

### Security Headers (Helmet.js)

- Content Security Policy (CSP)
- X-Frame-Options
- X-Content-Type-Options
- Strict-Transport-Security

### Socket.IO Limits

- Max 5 connections per IP
- 30 messages per minute per socket
- 1MB max message size

### CORS Whitelist

```javascript
const ALLOWED_ORIGINS = [
  'https://signalsense.trade',
  'https://www.signalsense.trade',
  'http://localhost:3000',
  'http://localhost:3001',
];
```

---

## API Endpoints

### Status & Data

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | Connection status, symbol count, uptime |
| `/api/opportunities` | GET | Top 20 ranked opportunities |
| `/api/debug` | GET | All detector outputs |
| `/api/price-history/:symbol` | GET | Last 30 price points for sparklines |
| `/api/performance` | GET | Win rate tracker stats |

### Filters & Watchlist

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/filters` | GET/POST | Get/set filter configuration |
| `/api/filters/preset/:name` | POST | Apply filter preset |
| `/api/watchlist` | GET | Get watchlist |
| `/api/watchlist/:symbol` | POST/DELETE | Add/remove from watchlist |

### ML Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ml/status` | GET | ML service status |
| `/api/ml/stats` | GET | Model performance metrics |
| `/api/ml/feature-counts` | GET | Training data counts |
| `/api/ml/train` | POST | Trigger model retraining |
| `/api/ml/export-csv` | GET | Export training data |

---

## Configuration

### Development (src/config.ts)

```typescript
volatility.minChange24h: 10%    // Volatility alert threshold
volume.spikeMultiplier: 3x      // Volume spike multiplier
velocity.minVelocity: 0.5%/min  // Price velocity threshold
ui.refreshMs: 1000              // Dashboard update interval
```

### Production (src/config.production.ts)

- Reduced memory usage
- Staggered detector updates
- 2-second update intervals

### ML Configuration

```typescript
ml: {
  serviceUrl: 'http://ml-service:8001',  // Docker internal
  timeout: 2000,
  enabled: true,
  minSignalsForTraining: 500,
  mlWeight: 0.6,
  ruleWeight: 0.4,
  filterThreshold: 0.4,
}
```

---

## Detector Pattern

All 18 detectors follow the same structure:

```typescript
class XxxDetector {
  constructor(private dataStore: DataStore) {}
  detect(): XxxAlert[] { ... }
  getTopAlerts(limit: number): XxxAlert[] { ... }
}
```

### Available Detectors

1. VolatilityDetector - Price change tracking
2. VolumeDetector - Volume spike detection
3. VelocityDetector - Price momentum
4. FundingDetector - Funding rate analysis
5. OpenInterestDetector - OI changes
6. MultiTimeframeDetector - MTF alignment
7. SmartSignalEngine - Composite signals + ML
8. LiquidationDetector - Liquidation events
9. WhaleDetector - Large trades
10. CorrelationDetector - BTC correlation
11. SentimentAnalyzer - Market sentiment
12. PatternDetector - Chart patterns
13. EntryTimingCalculator - Entry optimization
14. WinRateTracker - Performance tracking
15. NotificationManager - Alert management
16. TopPicker - Best opportunity selection

---

## Adding New Features

### New Detector

1. Create `src/detectors/yourDetector.ts`
2. Define alert interface
3. Add to `OpportunityRanker` constructor
4. Call in `getAllOpportunities()` method
5. Map alerts to `Opportunity` type

### New API Endpoint

1. Add route in `src/web/server.ts` setupRoutes()
2. Apply appropriate rate limiter
3. Update this documentation

---

## Troubleshooting

### Sparklines Not Loading

Check rate limiter - `/api/price-history` needs higher limit (sparklineLimiter: 600/min)

### ML Service Not Available

```bash
# Check ML container health
curl https://signalsense.trade/api/ml/status

# Check container logs
docker logs signalsensehunter-ml
```

### High Memory Usage

- Reduce `maxPriceHistory` in config
- Decrease `maxDisplayed` values
- Increase Node.js heap: `NODE_OPTIONS="--max-old-space-size=512"`

### WebSocket Disconnections

- Check nginx `proxy_read_timeout`
- Verify Socket.IO reconnection in client
- Check firewall rules for ports 3001/8001

### Deployment Failed

1. Check GitHub push succeeded
2. Verify VPS container status via MCP
3. Check container logs for build errors

---

## Backup & Recovery

### Backup Training Data

```bash
curl https://signalsense.trade/api/ml/export-csv > backup_training_data.csv
```

### Restore from Backup

1. Import CSV via ML service endpoint
2. Trigger retraining: `POST /api/ml/train`

---

## Useful Commands

### Hostinger MCP Tools

```javascript
// List VPS projects
mcp__hostinger-mcp__VPS_getProjectListV1({ virtualMachineId: 1256837 })

// Update project (restart containers)
mcp__hostinger-mcp__VPS_updateProjectV1({
  virtualMachineId: 1256837,
  projectName: "signalsensehunter"
})

// Deploy from GitHub
mcp__hostinger-mcp__VPS_createNewProjectV1({
  virtualMachineId: 1256837,
  project_name: "signalsensehunter",
  content: "https://github.com/quantumlegal/strikechart"
})

// Get project logs
mcp__hostinger-mcp__VPS_getProjectLogsV1({
  virtualMachineId: 1256837,
  projectName: "signalsensehunter"
})

// View firewall rules
mcp__hostinger-mcp__VPS_getFirewallListV1({})
```

### Git Workflow

```bash
# Check status
git status

# Commit changes
git add .
git commit -m "Description of changes"

# Push to GitHub (triggers deployment)
git push origin master
```

---

## Important Patterns

- DataStore uses rolling windows (5-60 min) with auto-trimming
- Detectors run in parallel, results aggregated synchronously
- SmartSignal fuses 7 components for high-confidence trades
- ML predictions cached for 5 seconds
- Named Docker volumes persist across deployments
- Always use `VPS_createNewProjectV1` for code updates (preserves volumes)

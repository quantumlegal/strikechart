# Signal Sense Hunter Deployment Guide

## Quick Reference

| Item | Value |
|------|-------|
| **Live URL** | https://signalsense.trade |
| **GitHub** | https://github.com/quantumlegal/strikechart.git |
| **VPS IP** | 72.61.93.6 |
| **VPS ID** | 1256837 |
| **App Port** | 3001 |
| **ML Port** | 8001 |

---

## CRITICAL: Preserving ML Training Data

The ML system stores training data in Docker volumes. **Using the wrong deployment method will delete all training data!**

### Docker Volumes (Must Preserve)

| Volume | Contents | Purpose |
|--------|----------|---------|
| `ml-models` | `.joblib` files | Trained XGBoost/LightGBM models |
| `app-data` | SQLite database | Signal features, outcomes, ML predictions |

### Correct Deployment Methods

**Method 1: Via Claude Code MCP (Recommended)**

```javascript
// 1. Push changes to GitHub
git add .
git commit -m "Your changes"
git push origin master

// 2. Deploy via Hostinger MCP - PRESERVES volumes
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

**Method 3: Update Only (No Code Changes)**

```javascript
// Just restart containers with existing code
mcp__hostinger-mcp__VPS_updateProjectV1({
  virtualMachineId: 1256837,
  projectName: "signalsensehunter"
})
```

### WRONG Method (Loses All Data!)

**DO NOT use Delete Project + Create Project** - this deletes Docker volumes!

```javascript
// ❌ NEVER DO THIS - loses all ML training data!
mcp__hostinger-mcp__VPS_deleteProjectV1(...)  // WRONG!
mcp__hostinger-mcp__VPS_createNewProjectV1(...) // Data is gone!
```

### Verify Data After Deployment

```bash
curl https://signalsense.trade/api/ml/feature-counts
# Should show: {"total":X,"completed":Y,...} where X > 0
# If all zeros, volumes were deleted!
```

### Backup Before Risky Operations

```bash
curl https://signalsense.trade/api/ml/export-csv > backup_training_data.csv
```

---

## Standard Deployment Workflow

### 1. Make Changes Locally

```bash
cd "D:\Trading system\strikechart"

# Edit files...

# Build TypeScript
npm run build

# Test locally (optional)
npm run dev:web
```

### 2. Commit and Push

```bash
git add .
git commit -m "Description of changes

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"

git push origin master
```

### 3. Deploy to VPS

Via Claude Code MCP:
```javascript
mcp__hostinger-mcp__VPS_createNewProjectV1({
  virtualMachineId: 1256837,
  project_name: "signalsensehunter",
  content: "https://github.com/quantumlegal/strikechart"
})
```

### 4. Verify Deployment

```bash
# Check status
curl https://signalsense.trade/api/status
# Expected: {"status":"connected","symbolCount":584,"uptime":...}

# Check containers
mcp__hostinger-mcp__VPS_getProjectListV1({ virtualMachineId: 1256837 })
# Both containers should show "healthy"
```

---

## Environment Setup

### Local Development

```bash
# Clone repository
git clone https://github.com/quantumlegal/strikechart.git
cd strikechart

# Install dependencies
npm install

# Development with hot reload
npm run dev:web

# Or build and run production
npm run build
npm run start:web
```

### Environment Variables

Create `.env.production`:
```env
NODE_ENV=production
PORT=3001
ML_SERVICE_URL=http://ml-service:8001
ML_ENABLED=true
ALLOWED_ORIGINS=https://signalsense.trade,https://www.signalsense.trade
LOG_LEVEL=warn
```

---

## Docker Configuration

### docker-compose.yml

```yaml
services:
  ml-service:
    build: ./ml-service
    container_name: signalsensehunter-ml
    restart: unless-stopped
    ports:
      - "8001:8001"
    volumes:
      - ml-models:/app/models  # CRITICAL: Persist trained models
    environment:
      - ML_HOST=0.0.0.0
      - ML_PORT=8001
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8001/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s

  signalsensehunter:
    build: .
    container_name: signalsensehunter-app
    restart: unless-stopped
    ports:
      - "3001:3001"
    volumes:
      - app-data:/app/data  # CRITICAL: Persist SQLite database
    environment:
      - NODE_ENV=production
      - PORT=3001
      - ML_SERVICE_URL=http://ml-service:8001
      - ML_ENABLED=true
    depends_on:
      ml-service:
        condition: service_healthy

volumes:
  ml-models:
    driver: local
  app-data:
    driver: local
```

---

## Hostinger VPS Management

### Access Methods

1. **Claude Code MCP** - Automated deployment via API
2. **hPanel Web UI** - https://hpanel.hostinger.com/vps/1256837
3. **SSH** - `ssh root@72.61.93.6`

### Useful MCP Commands

```javascript
// List all projects
mcp__hostinger-mcp__VPS_getProjectListV1({ virtualMachineId: 1256837 })

// Get project containers and health
mcp__hostinger-mcp__VPS_getProjectContainersV1({
  virtualMachineId: 1256837,
  projectName: "signalsensehunter"
})

// View logs
mcp__hostinger-mcp__VPS_getProjectLogsV1({
  virtualMachineId: 1256837,
  projectName: "signalsensehunter"
})

// Restart project
mcp__hostinger-mcp__VPS_restartProjectV1({
  virtualMachineId: 1256837,
  projectName: "signalsensehunter"
})

// Stop project
mcp__hostinger-mcp__VPS_stopProjectV1({
  virtualMachineId: 1256837,
  projectName: "signalsensehunter"
})

// Start project
mcp__hostinger-mcp__VPS_startProjectV1({
  virtualMachineId: 1256837,
  projectName: "signalsensehunter"
})
```

### Firewall Management

```javascript
// List firewalls
mcp__hostinger-mcp__VPS_getFirewallListV1({})

// Get firewall details
mcp__hostinger-mcp__VPS_getFirewallDetailsV1({ firewallId: YOUR_ID })

// Create firewall rule
mcp__hostinger-mcp__VPS_createFirewallRuleV1({
  firewallId: YOUR_ID,
  protocol: "TCP",
  port: "3001",
  source: "any",
  source_detail: "any"
})
```

---

## Security Configuration

### Current Firewall Rules

| Port | Protocol | Purpose |
|------|----------|---------|
| 22 | TCP | SSH access |
| 80 | TCP | HTTP (redirects to HTTPS) |
| 443 | TCP | HTTPS |
| 3001 | TCP | Node.js application |
| 8001 | TCP | ML service |

### Rate Limiting

| Limiter | Limit | Endpoints |
|---------|-------|-----------|
| `apiLimiter` | 100 req/min | All `/api/*` |
| `strictLimiter` | 10 req/min | ML training |
| `sparklineLimiter` | 600 req/min | Price history |

### Socket.IO Limits

- Max 5 connections per IP
- 30 messages per minute per socket
- 1MB max message size

---

## Monitoring

### Health Check Endpoints

```bash
# Main app status
curl https://signalsense.trade/api/status

# ML service health
curl https://signalsense.trade/api/ml/status

# ML feature counts
curl https://signalsense.trade/api/ml/feature-counts
```

### Container Logs

Via MCP:
```javascript
mcp__hostinger-mcp__VPS_getProjectLogsV1({
  virtualMachineId: 1256837,
  projectName: "signalsensehunter"
})
```

Via SSH:
```bash
docker logs signalsensehunter-app
docker logs signalsensehunter-ml
```

---

## Troubleshooting

### Container Not Starting

1. Check logs for errors
2. Verify port 3001/8001 not in use
3. Check Docker memory limits
4. Verify healthcheck commands work

### 522 Connection Timeout

1. Check firewall allows ports 3001, 8001
2. Verify containers are running
3. Check Cloudflare SSL settings

### Sparklines Not Loading / Going Blank

**Fixed in January 2026:**
- Error responses (rate limits) were being cached as `undefined`
- Solution: Only cache valid history arrays, return stale cache on errors
- Cache duration increased from 5s to 30s

**Still happening? Check:**
1. Rate limiter - `sparklineLimiter` (600/min) on `/api/price-history/:symbol`
2. After restart - Sparklines need time to accumulate price history data
3. Frontend cache - 30 second cache, stale data returned on errors

### Rate Limiter Errors in Logs

**Fixed in January 2026:**
- `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` errors
- Solution: `app.set('trust proxy', true)` in server.ts

### Performance Tracker Won't Expand/Collapse

**Fixed in January 2026:**
- Missing CSS for initial collapsed state rotation
- Solution: Added `.performance-section.collapsed .collapse-toggle { transform: rotate(-90deg); }`

### ML Service Unavailable

1. Check ML container health
2. Verify `ML_SERVICE_URL` environment variable
3. Check ML service logs for errors

### Lost ML Training Data

Volumes were deleted. Restore from backup:
```bash
# If you have a backup
curl -X POST https://signalsense.trade/api/ml/import-csv -d @backup.csv

# Otherwise, start collecting new data
# Training will resume after 500+ signals
```

### Deployment Actions Stuck in "Delayed"

The Hostinger MCP queue can get backed up. Solutions:
1. Wait longer (actions process sequentially)
2. Check action status: `VPS_getActionsV1({ virtualMachineId: 1256837 })`
3. Don't queue multiple deployments - wait for each to complete

---

## Scaling

### Vertical Scaling

| Spec | Capacity |
|------|----------|
| 2 vCPU, 2GB RAM | ~500 concurrent users |
| 4 vCPU, 4GB RAM | ~2000 concurrent users |
| 8 vCPU, 8GB RAM | ~5000 concurrent users |

### Horizontal Scaling

For high traffic:
1. Deploy multiple instances behind load balancer
2. Use sticky sessions for WebSocket
3. Add Redis adapter for Socket.IO clustering

---

## Estimated Resource Usage

| Metric | Development | Production |
|--------|-------------|------------|
| CPU | 5-15% | 2-8% |
| Memory | 150-250MB | 100-200MB |
| Bandwidth | ~500KB/s | ~200KB/s |
| Connections | 1-5 | Unlimited |

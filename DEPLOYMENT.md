# Signal Sense Hunter Deployment Guide

## CRITICAL: Preserving ML Training Data

The ML system stores training data in Docker volumes. **Using the wrong deployment method will delete all training data!**

### Docker Volumes (Must Preserve)

| Volume | Contents | Purpose |
|--------|----------|---------|
| `ml-models` | `.joblib` files | Trained XGBoost/LightGBM models |
| `app-data` | SQLite database | Signal features, outcomes, ML predictions |

### Correct Deployment Method (Hostinger VPS)

**Use UPDATE, not DELETE/CREATE:**

```bash
# Via Hostinger API - Updates code while PRESERVING volumes
POST /api/vps/v1/virtual-machines/1256837/docker/projects/signalsensehunter/update
```

**Via SSH (Alternative):**
```bash
ssh root@72.61.93.6
cd /docker/signalsensehunter
git pull origin master
docker-compose down           # Stops containers, KEEPS volumes
docker-compose up --build -d  # Rebuilds with new code
docker-compose ps             # Verify healthy
```

### WRONG Method (Loses All Data!)

**DO NOT use Delete Project + Create Project** - this deletes Docker volumes!

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

## Quick Start (Production)

```bash
# Build optimized production bundle
npm run build

# Start with PM2 (recommended)
pm2 start dist/web-index.js --name signalsensehunter -i max

# Or use Docker
docker build -t signalsensehunter .
docker run -d -p 3000:3000 --name signalsensehunter strikechart
```

---

## Optimization Checklist

### 1. Build Optimization

```bash
# Install production dependencies only
npm ci --production

# Build TypeScript with optimizations
npm run build
```

### 2. Environment Variables

Create `.env.production`:
```env
NODE_ENV=production
PORT=3000
ALLOWED_ORIGINS=https://yourdomain.com
LOG_LEVEL=warn
```

### 3. PM2 Configuration (Recommended)

Create `ecosystem.config.js`:
```javascript
module.exports = {
  apps: [{
    name: 'signalsensehunter',
    script: 'dist/web-index.js',
    instances: 'max',        // Use all CPU cores
    exec_mode: 'cluster',
    max_memory_restart: '500M',
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    // Auto-restart on crash
    autorestart: true,
    watch: false,
    // Graceful shutdown
    kill_timeout: 5000,
    wait_ready: true,
    listen_timeout: 10000,
  }]
};
```

Start with: `pm2 start ecosystem.config.js --env production`

### 4. Docker Deployment

Create `Dockerfile`:
```dockerfile
FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --production

# Copy built files
COPY dist/ ./dist/
COPY public/ ./public/

# Security: Run as non-root
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001
USER nodejs

EXPOSE 3000
CMD ["node", "dist/web-index.js"]
```

Create `.dockerignore`:
```
node_modules
src
*.ts
*.md
.git
```

### 5. Nginx Reverse Proxy (Recommended)

```nginx
upstream signalsensehunter {
    server 127.0.0.1:3000;
    keepalive 64;
}

server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;
    gzip_min_length 1000;

    # Static files caching
    location /static/ {
        alias /app/public/;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    # WebSocket support
    location /socket.io/ {
        proxy_pass http://signalsensehunter;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }

    # API and main app
    location / {
        proxy_pass http://signalsensehunter;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## Performance Optimizations

### Memory Management

The app implements:
- **Rolling window data**: Only keeps last 100 price points per symbol
- **Automatic cleanup**: Removes stale data every 5 minutes
- **Lazy loading**: Detectors only analyze active symbols

### Bandwidth Reduction

- **Update throttling**: 2 second intervals instead of 1
- **Data filtering**: Only sends top N items per category
- **Compression**: Socket.io perMessageDeflate enabled

### CPU Optimization

- **Staggered updates**: Different detectors update at different intervals
- **Caching**: Pattern and funding data cached to avoid recalculation
- **Clustering**: PM2 cluster mode uses all CPU cores

---

## Security Hardening

### 1. Add Security Headers

Install helmet:
```bash
npm install helmet
```

Add to server:
```typescript
import helmet from 'helmet';
app.use(helmet());
```

### 2. Rate Limiting

Install express-rate-limit:
```bash
npm install express-rate-limit
```

Add to server:
```typescript
import rateLimit from 'express-rate-limit';
app.use(rateLimit({
  windowMs: 60000,
  max: 100,
}));
```

### 3. Input Validation

All user inputs (filters, presets) are validated before processing.

### 4. No Secrets Exposed

- No API keys required (uses public Binance data)
- No database credentials (SQLite is local)
- Environment variables for any sensitive config

---

## Monitoring

### Health Check Endpoint

```bash
curl http://localhost:3000/api/status
# Returns: {"status":"connected","symbolCount":584,"uptime":123.45}
```

### PM2 Monitoring

```bash
pm2 monit          # Real-time CPU/Memory
pm2 logs           # View logs
pm2 status         # Check process status
```

### Recommended Metrics

- WebSocket connections count
- Average response time
- Memory usage
- CPU utilization
- Error rate

---

## Scaling Considerations

### Horizontal Scaling

For high traffic:
1. Deploy multiple instances behind a load balancer
2. Use sticky sessions for WebSocket (Socket.io)
3. Consider Redis adapter for Socket.io clustering

### Vertical Scaling

Single server capacity:
- 2 vCPU, 2GB RAM: ~500 concurrent users
- 4 vCPU, 4GB RAM: ~2000 concurrent users
- 8 vCPU, 8GB RAM: ~5000 concurrent users

---

## Cloud Deployment Options

### Railway/Render (Easy)
- Push to GitHub, auto-deploy
- Free tier available
- WebSocket support built-in

### DigitalOcean App Platform
```bash
doctl apps create --spec .do/app.yaml
```

### AWS/GCP/Azure
- Use container services (ECS, Cloud Run, AKS)
- Add load balancer for SSL termination
- Use managed Redis for session scaling

---

## Troubleshooting

### High Memory Usage
- Reduce `maxPriceHistory` in config
- Decrease `maxDisplayed` to send less data
- Increase Node.js heap: `NODE_OPTIONS="--max-old-space-size=512"`

### Slow Response Times
- Check Binance API rate limits
- Enable compression in nginx
- Reduce update interval

### WebSocket Disconnections
- Increase nginx `proxy_read_timeout`
- Check for proxy buffering issues
- Enable Socket.io reconnection in client

---

## Estimated Resource Usage

| Metric | Development | Production |
|--------|-------------|------------|
| CPU | 5-15% | 2-8% |
| Memory | 150-250MB | 100-200MB |
| Bandwidth | ~500KB/s | ~200KB/s |
| Connections | 1-5 | Unlimited |

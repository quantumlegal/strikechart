# StrikeChart

**Real-time Binance Futures volatility hunter — 18 signal detectors, a terminal dashboard, and a live web UI.**

StrikeChart streams the entire Binance USD-M Futures market over WebSocket and runs 18 independent
detectors over it in real time, surfacing the symbols that are *moving* right now — volatility spikes,
volume/velocity bursts, funding-rate and open-interest shifts, liquidation cascades, whale prints, and
more. It runs as a fast terminal TUI **or** a browser dashboard, with optional audio alerts and an
optional Python ML scoring service.

> ⚠️ **Not financial advice.** This is a market-scanning and research tool. It surfaces statistical
> signals; it does not place trades. Crypto futures are high-risk — do your own research.

---

## Features

- **Live market firehose** — connects to Binance Futures public WebSocket streams (no API key required for market data).
- **18 detectors**, each scoring symbols independently and feeding a combined opportunity ranking:

  | | | |
  |---|---|---|
  | Volatility | Volume | Velocity (rate of change) |
  | Funding rate | Open interest | Liquidations |
  | Whale prints | Multi-timeframe alignment | Pattern |
  | Range / breakout | Correlation | Sentiment |
  | New-listing | Smart signal (composite) | Top picker |
  | Win-rate | Entry timing | Notifications |

- **Two interfaces** from the same engine:
  - **Terminal TUI** (`blessed` / `blessed-contrib`) — dense, keyboard-driven, great over SSH.
  - **Web dashboard** (`express` + `socket.io`) — live-updating browser view.
- **Audio alerts** on high-conviction signals (toggleable).
- **Local persistence** via SQLite (`sql.js`) — no external DB to run.
- **Optional ML service** (`ml-service/`, Python + FastAPI) for model-based signal scoring.
- **Production-ready deployment** — Dockerfile, `docker-compose.yml`, nginx config, PM2 (`ecosystem.config.cjs`), and a `setup-vps.sh` one-shot VPS bootstrap.
- Extra data sources wired in (CoinGecko, Etherscan clients) for enrichment.

---

## Quick start

**Requirements:** Node.js 20+. (Optional: Docker, and Python 3.11+ for the ML service.)

```bash
git clone https://github.com/quantumlegal/strikechart.git
cd strikechart
npm install
cp .env.example .env        # tweak thresholds / sound if you like — defaults work out of the box
```

Run the **terminal** scanner:

```bash
npm run dev          # live (tsx watch)
# or, built:
npm run build && npm start
```

Run the **web dashboard**:

```bash
npm run dev:web      # then open the printed localhost URL
# or, built:
npm run build && npm run start:web
```

No Binance API key is needed for market data — StrikeChart uses public WebSocket streams. Keys are only
read if you set them in `.env` (and are never required to run).

---

## Configuration

All configuration is via `.env` (see `.env.example`). Common knobs:

| Variable | Purpose |
|---|---|
| `SOUND_ENABLED` | Enable/disable audio alerts |
| `MIN_CHANGE_24H` | Minimum 24h % move to consider a symbol |
| `VOLUME_SPIKE_MULTIPLIER` | How far above average volume counts as a spike |
| `MIN_VELOCITY` | Minimum price-velocity threshold |
| `BINANCE_API_KEY` / `BINANCE_API_SECRET` | Optional — only for authenticated endpoints |

Detector defaults live in `src/config.ts`; production overrides in `src/config.production.ts`.

---

## Optional ML service

`ml-service/` is a self-contained Python FastAPI app that scores signals with a model. It runs
independently and StrikeChart calls it when enabled.

```bash
cd ml-service
pip install -r requirements.txt
python run.py        # serves http://localhost:<port>  (docs at /docs)
```

---

## Deployment

StrikeChart ships with everything to run on a small VPS:

```bash
docker compose up -d          # app (+ ml-service if enabled)
```

or bare-metal with PM2:

```bash
./setup-vps.sh                # installs deps, builds, configures nginx + PM2
```

`nginx-strikechart.conf` and `DEPLOYMENT.md` cover the reverse-proxy / TLS setup.

---

## Architecture

```
Binance Futures WebSocket  ──▶  dataStore  ──▶  18 detectors  ──▶  opportunity ranking
                                                                     │
                                              ┌──────────────────────┼───────────────────────┐
                                          terminal TUI          web dashboard           audio alerts
                                         (blessed-contrib)     (express+socket.io)       (play-sound)
                                                                     │
                                                          optional ML service (FastAPI)
```

- `src/binance/` — WebSocket + REST client and types
- `src/core/` — data store, filters, opportunity scoring
- `src/detectors/` — the 18 signal detectors
- `src/services/` — CoinGecko / Etherscan enrichment
- `src/index.ts` — terminal entry · `src/web-index.ts` — web entry

---

## License

MIT — see [LICENSE](LICENSE). Built and maintained by [@quantumlegal](https://github.com/quantumlegal).

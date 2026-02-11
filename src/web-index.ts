import { config } from './config.js';
import { BinanceWebSocket } from './binance/websocket.js';
import { DataStore } from './core/dataStore.js';
import { OpportunityRanker } from './core/opportunity.js';
import { WebServer } from './web/server.js';
import { SoundAlert } from './alerts/sound.js';
import { StorageManager } from './storage/sqlite.js';
import { TickerData } from './binance/types.js';
import { HealthManager, IntervalRefs } from './services/healthManager.js';
import { TelegramNotifier } from './services/telegramNotifier.js';

class SignalSenseHunterWeb {
  private ws: BinanceWebSocket;
  private dataStore: DataStore;
  private opportunityRanker: OpportunityRanker;
  private webServer: WebServer;
  private soundAlert: SoundAlert;
  private storage: StorageManager;
  private sessionId: number = 0;
  private intervalRefs: IntervalRefs = {
    updateInterval: null,
    logInterval: null,
    detectorInterval: null,
  };
  private criticalAlertCooldowns: Map<string, number> = new Map();
  private healthManager: HealthManager | null = null;
  private telegramNotifier: TelegramNotifier;

  constructor() {
    this.dataStore = new DataStore();
    this.opportunityRanker = new OpportunityRanker(this.dataStore);
    this.soundAlert = new SoundAlert();
    this.storage = new StorageManager();
    this.ws = new BinanceWebSocket();
    this.telegramNotifier = new TelegramNotifier();

    const port = parseInt(process.env.PORT || '3000', 10);
    this.webServer = new WebServer(this.dataStore, this.opportunityRanker, port);
  }

  async init(): Promise<void> {
    await this.storage.init();
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.ws.on('connected', () => {
      console.log('Connected to Binance Futures WebSocket');
      this.webServer.setConnectionStatus('connected', this.ws.symbols);
    });

    this.ws.on('disconnected', () => {
      console.log('Disconnected from Binance');
      this.webServer.setConnectionStatus('disconnected', 0);
    });

    this.ws.on('statusChange', (status) => {
      this.webServer.setConnectionStatus(status, this.ws.symbols);
    });

    this.ws.on('tickers', (tickers: TickerData[]) => {
      this.handleTickers(tickers);
    });

    this.ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });

    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());

    process.on('uncaughtException', (error) => {
      console.error('[FATAL] Uncaught exception:', error);
      this.shutdown();
    });

    process.on('unhandledRejection', (reason) => {
      console.error('[WARNING] Unhandled rejection:', reason);
      // Log but don't crash - allow the app to continue
    });
  }

  private handleTickers(tickers: TickerData[]): void {
    const { newListings } = this.dataStore.update(tickers);

    if (newListings.length > 0) {
      for (const symbol of newListings) {
        console.log(`New listing detected: ${symbol}`);
        this.soundAlert.playHigh(symbol);
        this.storage.logAlert(symbol, 'NEW_LISTING', `New listing detected: ${symbol}`, 'high');
      }
    }

    this.webServer.setConnectionStatus('connected', this.dataStore.getSymbolCount());
  }

  private checkCriticalAlerts(): void {
    const criticalAlerts = this.opportunityRanker.getVolatilityDetector().getCritical();
    const now = Date.now();

    for (const alert of criticalAlerts) {
      const lastAlerted = this.criticalAlertCooldowns.get(alert.symbol) || 0;
      if (now - lastAlerted < 900000) continue; // 15 min cooldown per symbol

      console.log(`Critical alert: ${alert.symbol} ${alert.change24h.toFixed(2)}%`);
      this.soundAlert.playHigh(alert.symbol);
      this.storage.logAlert(
        alert.symbol,
        'CRITICAL_VOLATILITY',
        `Critical move: ${alert.change24h.toFixed(2)}%`,
        'high'
      );
      this.criticalAlertCooldowns.set(alert.symbol, now);

      // Send Telegram notification if enabled
      this.telegramNotifier.sendAlert(
        alert.symbol,
        'CRITICAL_VOLATILITY',
        `Critical move: ${alert.change24h.toFixed(2)}% | Direction: ${alert.direction} | Price: $${alert.lastPrice}`
      );
    }

    // Clean stale cooldown entries (> 1h old)
    if (this.criticalAlertCooldowns.size > 50) {
      for (const [symbol, ts] of this.criticalAlertCooldowns) {
        if (now - ts > 3600000) {
          this.criticalAlertCooldowns.delete(symbol);
        }
      }
    }
  }

  private logOpportunities(): void {
    const opportunities = this.opportunityRanker.getTopOpportunities(20);
    if (opportunities.length > 0) {
      this.storage.logOpportunities(opportunities);
    }
  }

  async start(): Promise<void> {
    console.log('Starting Signal Sense Hunter Web...');

    await this.init();

    this.sessionId = this.storage.startSession();

    // Initialize ML integration (must happen after storage.init())
    await this.webServer.initializeML(this.storage);

    await this.webServer.start();

    this.ws.connect();

    // Update clients every second
    this.intervalRefs.updateInterval = setInterval(() => {
      this.webServer.emitUpdate();
      this.checkCriticalAlerts();
    }, config.ui.refreshMs);

    // Log opportunities every 10 seconds
    this.intervalRefs.logInterval = setInterval(() => {
      this.logOpportunities();
    }, 10000);

    // Update advanced detectors every 30 seconds
    this.intervalRefs.detectorInterval = setInterval(async () => {
      try {
        await this.webServer.updateDetectors();
      } catch (error) {
        console.error('Error updating detectors:', error);
      }
    }, 30000);

    // Initial detector update after 5 seconds (give time for data to populate)
    setTimeout(async () => {
      try {
        await this.webServer.updateDetectors();
        console.log('Advanced detectors initialized (Funding, OI, MTF)');
      } catch (error) {
        console.error('Error initializing detectors:', error);
      }
    }, 5000);

    // Initialize and start HealthManager
    this.healthManager = new HealthManager(
      this.storage,
      this.dataStore,
      this.ws,
      {
        connectionsPerIP: this.webServer.getConnectionsPerIP(),
        socketMessageCounts: this.webServer.getSocketMessageCounts(),
      },
      this.intervalRefs,
      this.webServer.getMLClient(),
      this.telegramNotifier,
    );
    this.webServer.setHealthManager(this.healthManager);
    this.healthManager.start();

    console.log('Signal Sense Hunter Web started. Press Ctrl+C to stop.');
  }

  private async shutdown(): Promise<void> {
    console.log('\nShutting down Signal Sense Hunter Web...');

    if (this.healthManager) {
      this.healthManager.shutdown();
    }

    if (this.intervalRefs.updateInterval) {
      clearInterval(this.intervalRefs.updateInterval);
    }
    if (this.intervalRefs.logInterval) {
      clearInterval(this.intervalRefs.logInterval);
    }
    if (this.intervalRefs.detectorInterval) {
      clearInterval(this.intervalRefs.detectorInterval);
    }

    if (this.sessionId) {
      this.storage.endSession(this.sessionId);
    }

    this.ws.disconnect();
    this.storage.close();
    await this.webServer.stop();

    console.log('Signal Sense Hunter Web stopped.');
    process.exit(0);
  }
}

const app = new SignalSenseHunterWeb();
app.start();

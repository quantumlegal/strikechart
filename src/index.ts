import { config } from './config.js';
import { BinanceWebSocket } from './binance/websocket.js';
import { DataStore } from './core/dataStore.js';
import { OpportunityRanker } from './core/opportunity.js';
import { Dashboard } from './ui/dashboard.js';
import { SoundAlert } from './alerts/sound.js';
import { StorageManager } from './storage/sqlite.js';
import { TickerData } from './binance/types.js';

class StrikeChart {
  private ws: BinanceWebSocket;
  private dataStore: DataStore;
  private opportunityRanker: OpportunityRanker;
  private dashboard: Dashboard;
  private soundAlert: SoundAlert;
  private storage: StorageManager;
  private sessionId: number = 0;
  private refreshInterval: NodeJS.Timeout | null = null;
  private logInterval: NodeJS.Timeout | null = null;
  private previousCriticalSymbols: Set<string> = new Set();

  constructor() {
    // Initialize components
    this.dataStore = new DataStore();
    this.opportunityRanker = new OpportunityRanker(this.dataStore);
    this.soundAlert = new SoundAlert();
    this.storage = new StorageManager();
    this.ws = new BinanceWebSocket();
    this.dashboard = new Dashboard(this.dataStore, this.opportunityRanker);
  }

  async init(): Promise<void> {
    await this.storage.init();
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // WebSocket events
    this.ws.on('connected', () => {
      this.dashboard.setConnectionStatus('connected', this.ws.symbols);
    });

    this.ws.on('disconnected', () => {
      this.dashboard.setConnectionStatus('disconnected', 0);
    });

    this.ws.on('statusChange', (status) => {
      this.dashboard.setConnectionStatus(status, this.ws.symbols);
    });

    this.ws.on('tickers', (tickers: TickerData[]) => {
      this.handleTickers(tickers);
    });

    this.ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });

    // Dashboard key events
    this.dashboard.onKey((key) => {
      if (key === 'toggleSound') {
        const enabled = this.soundAlert.toggle();
        this.dashboard.setSoundEnabled(enabled);
      }
    });

    // Handle process exit
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  private handleTickers(tickers: TickerData[]): void {
    // Update data store
    const { newListings } = this.dataStore.update(tickers);

    // Handle new listings
    if (newListings.length > 0) {
      for (const symbol of newListings) {
        this.soundAlert.playHigh(symbol);
        this.storage.logAlert(symbol, 'NEW_LISTING', `New listing detected: ${symbol}`, 'high');
      }
    }

    // Update connection status with symbol count
    this.dashboard.setConnectionStatus('connected', this.dataStore.getSymbolCount());
  }

  private checkCriticalAlerts(): void {
    const criticalAlerts = this.opportunityRanker.getVolatilityDetector().getCritical();

    for (const alert of criticalAlerts) {
      // Only alert for new critical symbols
      if (!this.previousCriticalSymbols.has(alert.symbol)) {
        this.soundAlert.playHigh(alert.symbol);
        this.storage.logAlert(
          alert.symbol,
          'CRITICAL_VOLATILITY',
          `Critical move: ${alert.change24h.toFixed(2)}%`,
          'high'
        );
      }
    }

    // Update tracked critical symbols
    this.previousCriticalSymbols = new Set(criticalAlerts.map(a => a.symbol));
  }

  private logOpportunities(): void {
    const opportunities = this.opportunityRanker.getTopOpportunities(20);
    if (opportunities.length > 0) {
      this.storage.logOpportunities(opportunities);
    }
  }

  async start(): Promise<void> {
    console.log('Starting StrikeChart...');

    // Initialize storage
    await this.init();

    // Start session tracking
    this.sessionId = this.storage.startSession();

    // Connect to Binance WebSocket
    this.ws.connect();

    // Start dashboard
    this.dashboard.start();

    // Set up refresh interval for dashboard
    this.refreshInterval = setInterval(() => {
      this.dashboard.refresh();
      this.checkCriticalAlerts();
    }, config.ui.refreshMs);

    // Set up logging interval (every 10 seconds)
    this.logInterval = setInterval(() => {
      this.logOpportunities();
    }, 10000);

    console.log('StrikeChart started. Press Q to quit.');
  }

  private shutdown(): void {
    console.log('\nShutting down StrikeChart...');

    // Clear intervals
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    if (this.logInterval) {
      clearInterval(this.logInterval);
    }

    // End session
    if (this.sessionId) {
      this.storage.endSession(this.sessionId);
    }

    // Disconnect WebSocket
    this.ws.disconnect();

    // Close storage
    this.storage.close();

    // Destroy dashboard
    this.dashboard.destroy();

    console.log('StrikeChart stopped.');
    process.exit(0);
  }
}

// Start the application
const app = new StrikeChart();
app.start();

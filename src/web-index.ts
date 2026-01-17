import { config } from './config.js';
import { BinanceWebSocket } from './binance/websocket.js';
import { DataStore } from './core/dataStore.js';
import { OpportunityRanker } from './core/opportunity.js';
import { WebServer } from './web/server.js';
import { SoundAlert } from './alerts/sound.js';
import { StorageManager } from './storage/sqlite.js';
import { TickerData } from './binance/types.js';

class SignalSenseHunterWeb {
  private ws: BinanceWebSocket;
  private dataStore: DataStore;
  private opportunityRanker: OpportunityRanker;
  private webServer: WebServer;
  private soundAlert: SoundAlert;
  private storage: StorageManager;
  private sessionId: number = 0;
  private updateInterval: NodeJS.Timeout | null = null;
  private logInterval: NodeJS.Timeout | null = null;
  private detectorInterval: NodeJS.Timeout | null = null;
  private previousCriticalSymbols: Set<string> = new Set();

  constructor() {
    this.dataStore = new DataStore();
    this.opportunityRanker = new OpportunityRanker(this.dataStore);
    this.soundAlert = new SoundAlert();
    this.storage = new StorageManager();
    this.ws = new BinanceWebSocket();

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

    for (const alert of criticalAlerts) {
      if (!this.previousCriticalSymbols.has(alert.symbol)) {
        console.log(`Critical alert: ${alert.symbol} ${alert.change24h.toFixed(2)}%`);
        this.soundAlert.playHigh(alert.symbol);
        this.storage.logAlert(
          alert.symbol,
          'CRITICAL_VOLATILITY',
          `Critical move: ${alert.change24h.toFixed(2)}%`,
          'high'
        );
      }
    }

    this.previousCriticalSymbols = new Set(criticalAlerts.map(a => a.symbol));
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

    await this.webServer.start();

    this.ws.connect();

    // Update clients every second
    this.updateInterval = setInterval(() => {
      this.webServer.emitUpdate();
      this.checkCriticalAlerts();
    }, config.ui.refreshMs);

    // Log opportunities every 10 seconds
    this.logInterval = setInterval(() => {
      this.logOpportunities();
    }, 10000);

    // Update advanced detectors every 30 seconds
    this.detectorInterval = setInterval(async () => {
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

    console.log('Signal Sense Hunter Web started. Press Ctrl+C to stop.');
  }

  private async shutdown(): Promise<void> {
    console.log('\nShutting down Signal Sense Hunter Web...');

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    if (this.logInterval) {
      clearInterval(this.logInterval);
    }
    if (this.detectorInterval) {
      clearInterval(this.detectorInterval);
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

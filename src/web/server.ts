import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { OpportunityRanker } from '../core/opportunity.js';
import { DataStore } from '../core/dataStore.js';
import { FilterManager, FILTER_PRESETS } from '../core/filters.js';
import { FundingDetector } from '../detectors/funding.js';
import { OpenInterestDetector } from '../detectors/openInterest.js';
import { MultiTimeframeDetector } from '../detectors/multiTimeframe.js';
import { SmartSignalEngine } from '../detectors/smartSignal.js';
import { LiquidationDetector } from '../detectors/liquidation.js';
import { WhaleDetector } from '../detectors/whale.js';
import { CorrelationDetector } from '../detectors/correlation.js';
import { SentimentAnalyzer } from '../detectors/sentiment.js';
import { PatternDetector } from '../detectors/pattern.js';
import { EntryTimingCalculator } from '../detectors/entryTiming.js';
import { WinRateTracker } from '../detectors/winRate.js';
import { NotificationManager } from '../detectors/notifications.js';
import { TopPicker } from '../detectors/topPicker.js';
import { ConnectionStatus } from '../binance/types.js';
import { StorageManager } from '../storage/sqlite.js';
import { MLServiceClient } from '../services/mlClient.js';
import { FeatureExtractor } from '../services/featureExtractor.js';
import { OmniaTracker } from '../services/omniaTracker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Trust proxy setting for rate limiter (required behind Cloudflare/nginx)
// Must be set BEFORE creating rate limiters
const TRUST_PROXY = true;

// Security: Rate limiting configuration
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute per IP
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const strictLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute (for sensitive endpoints like training)
  message: { error: 'Rate limit exceeded for this endpoint.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Higher limit for sparkline data (internal data, no external API calls)
const sparklineLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 600, // 600 requests per minute (10 per second) - enough for all symbols
  message: { error: 'Too many sparkline requests.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
  'https://signalsense.trade',
  'https://www.signalsense.trade',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
];

export class WebServer {
  private app: express.Application;
  private server: ReturnType<typeof createServer>;
  private io: SocketIOServer;
  private port: number;
  private connectionStatus: ConnectionStatus = 'disconnected';
  private symbolCount: number = 0;
  private visitorCount: number = 0;
  private totalVisitors: number = 0;  // All-time counter

  // Security: Track connections per IP
  private connectionsPerIP: Map<string, number> = new Map();
  private readonly MAX_CONNECTIONS_PER_IP = 5;
  private readonly MESSAGE_RATE_LIMIT = 30; // messages per minute per socket
  private socketMessageCounts: Map<string, { count: number; resetTime: number }> = new Map();

  // Detectors
  private fundingDetector: FundingDetector;
  private oiDetector: OpenInterestDetector;
  private mtfDetector: MultiTimeframeDetector;
  private smartSignalEngine: SmartSignalEngine;
  private filterManager: FilterManager;

  // New advanced detectors
  private liquidationDetector: LiquidationDetector;
  private whaleDetector: WhaleDetector;
  private correlationDetector: CorrelationDetector;
  private sentimentAnalyzer: SentimentAnalyzer;
  private patternDetector: PatternDetector;
  private entryCalculator: EntryTimingCalculator;
  private winRateTracker: WinRateTracker;
  private notificationManager: NotificationManager;
  private topPicker: TopPicker;

  // ML Integration
  private storageManager: StorageManager | null = null;
  private mlClient: MLServiceClient;
  private featureExtractor: FeatureExtractor | null = null;

  // OMNIA Protocol Tracker
  private omniaTracker: OmniaTracker;

  constructor(
    private dataStore: DataStore,
    private opportunityRanker: OpportunityRanker,
    port: number = 3000
  ) {
    this.port = port;
    this.app = express();

    // Trust proxy for correct IP detection behind reverse proxy (Cloudflare, nginx)
    // This is required for rate limiting to work correctly
    this.app.set('trust proxy', TRUST_PROXY);

    this.server = createServer(this.app);
    this.io = new SocketIOServer(this.server, {
      cors: {
        origin: (origin, callback) => {
          // Allow requests with no origin (mobile apps, curl, etc.) in development
          if (!origin || ALLOWED_ORIGINS.includes(origin)) {
            callback(null, true);
          } else {
            console.warn(`[Security] Blocked Socket.IO connection from origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
          }
        },
        methods: ['GET', 'POST'],
        credentials: true,
      },
      // Connection limits
      pingTimeout: 60000,
      pingInterval: 25000,
      maxHttpBufferSize: 1e6, // 1MB max message size
    });

    // Initialize detectors
    this.fundingDetector = new FundingDetector(dataStore);
    this.oiDetector = new OpenInterestDetector(dataStore);
    this.mtfDetector = new MultiTimeframeDetector(dataStore);
    this.filterManager = new FilterManager(dataStore);

    // Initialize smart signal engine (needs access to all detectors)
    this.smartSignalEngine = new SmartSignalEngine(
      dataStore,
      this.fundingDetector,
      this.oiDetector,
      this.mtfDetector,
      this.opportunityRanker.getVolatilityDetector(),
      this.opportunityRanker.getVolumeDetector(),
      this.opportunityRanker.getVelocityDetector()
    );

    // Initialize advanced detectors
    this.liquidationDetector = new LiquidationDetector(dataStore);
    this.whaleDetector = new WhaleDetector(dataStore);
    this.correlationDetector = new CorrelationDetector(dataStore);
    this.sentimentAnalyzer = new SentimentAnalyzer(dataStore, this.fundingDetector, this.oiDetector);
    this.patternDetector = new PatternDetector(dataStore);
    this.entryCalculator = new EntryTimingCalculator(dataStore);
    this.winRateTracker = new WinRateTracker(dataStore, config.storage.dbPath);
    this.notificationManager = new NotificationManager();

    // Initialize Top Picker (needs access to all detectors)
    this.topPicker = new TopPicker(
      dataStore,
      this.fundingDetector,
      this.oiDetector,
      this.smartSignalEngine,
      this.patternDetector,
      this.entryCalculator,
      this.correlationDetector,
      this.whaleDetector
    );

    // Initialize ML client
    this.mlClient = new MLServiceClient(
      config.ml.serviceUrl,
      config.ml.timeout,
      config.ml.enabled
    );

    // Initialize OMNIA Protocol Tracker
    this.omniaTracker = new OmniaTracker();
    this.setupOmniaEvents();

    this.setupRoutes();
    this.setupSocketIO();
  }

  // Initialize storage and ML integration (call after storage manager is ready)
  async initializeML(storageManager: StorageManager): Promise<void> {
    this.storageManager = storageManager;

    // Set storage manager on win rate tracker
    this.winRateTracker.setStorageManager(storageManager);

    // Initialize feature extractor
    this.featureExtractor = new FeatureExtractor(
      this.dataStore,
      this.fundingDetector,
      this.oiDetector,
      this.mtfDetector,
      this.opportunityRanker.getVolumeDetector(),
      this.opportunityRanker.getVelocityDetector(),
      this.patternDetector,
      this.entryCalculator,
      this.whaleDetector,
      this.correlationDetector
    );

    // Setup ML integration in SmartSignalEngine
    if (config.ml.enabled) {
      this.smartSignalEngine.setMLClient(this.mlClient, this.featureExtractor, {
        mlWeight: config.ml.mlWeight,
        ruleWeight: config.ml.ruleWeight,
        filterThreshold: config.ml.filterThreshold,
      });
    }

    console.log('[WebServer] ML integration initialized');
  }

  private setupRoutes(): void {
    // Security: Helmet for HTTP security headers
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://platform.twitter.com", "https://cdn.syndication.twimg.com"], // Required for Socket.IO + Twitter widget
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://platform.twitter.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "wss:", "ws:", "https://api.binance.com", "https://fapi.binance.com", "https://syndication.twitter.com", "https://cdn.syndication.twimg.com"],
          frameSrc: ["'self'", "https://platform.twitter.com", "https://syndication.twitter.com"],
        },
      },
      crossOriginEmbedderPolicy: false, // Allow embedding
    }));

    // Security: CORS for Express
    this.app.use((req, res, next) => {
      const origin = req.headers.origin;
      if (origin && ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
      }
      next();
    });

    // Security: Rate limiting for API endpoints
    this.app.use('/api/', apiLimiter);

    this.app.use(express.static(path.join(__dirname, '../../public')));
    this.app.use(express.json({ limit: '100kb' })); // Limit JSON body size

    // API endpoints
    this.app.get('/api/status', (req, res) => {
      res.json({
        status: this.connectionStatus,
        symbolCount: this.symbolCount,
        uptime: process.uptime(),
      });
    });

    this.app.get('/api/opportunities', (req, res) => {
      const opps = this.opportunityRanker.getTopOpportunities(20);
      res.json(this.filterManager.filterOpportunities(opps));
    });

    // Debug endpoint to check data
    this.app.get('/api/debug', (req, res) => {
      const filterSymbols = (items: any[]) =>
        items.filter((item) => this.filterManager.passesFilter(item.symbol));

      res.json({
        topMovers: filterSymbols(this.opportunityRanker.getVolatilityDetector().getTopMovers(config.ui.maxDisplayed)),
        velocityAlerts: filterSymbols(this.opportunityRanker.getVelocityDetector().getTopVelocity(config.ui.maxDisplayed)),
        volumeSpikes: filterSymbols(this.opportunityRanker.getVolumeDetector().getTopSpikes(config.ui.maxDisplayed)),
        highConviction: filterSymbols(this.opportunityRanker.getHighConviction().slice(0, config.ui.maxDisplayed)),
        smartSignalsLong: filterSymbols(this.smartSignalEngine.getTopSignals(config.ui.maxDisplayed, 'LONG')),
      });
    });

    // Filter endpoints
    this.app.get('/api/filters', (req, res) => {
      res.json(this.filterManager.getConfig());
    });

    this.app.post('/api/filters', (req, res) => {
      this.filterManager.setConfig(req.body);
      res.json({ success: true, config: this.filterManager.getConfig() });
    });

    this.app.post('/api/filters/preset/:name', (req, res) => {
      const preset = FILTER_PRESETS[req.params.name as keyof typeof FILTER_PRESETS];
      if (preset) {
        this.filterManager.setConfig(preset);
        res.json({ success: true, config: this.filterManager.getConfig() });
      } else {
        res.status(404).json({ error: 'Preset not found' });
      }
    });

    // Watchlist endpoints
    this.app.get('/api/watchlist', (req, res) => {
      res.json(this.filterManager.getWatchlist());
    });

    this.app.post('/api/watchlist/:symbol', (req, res) => {
      this.filterManager.addToWatchlist(req.params.symbol);
      res.json({ success: true, watchlist: this.filterManager.getWatchlist() });
    });

    this.app.delete('/api/watchlist/:symbol', (req, res) => {
      this.filterManager.removeFromWatchlist(req.params.symbol);
      res.json({ success: true, watchlist: this.filterManager.getWatchlist() });
    });

    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, '../../public/index.html'));
    });

    // Price history endpoint for sparklines (uses higher rate limit)
    this.app.get('/api/price-history/:symbol', sparklineLimiter, (req, res) => {
      const symbol = (req.params.symbol as string).toUpperCase();
      const priceHistory = this.dataStore.getPriceHistory(symbol);

      // Return last 30 price points for sparkline
      const recentHistory = priceHistory.slice(-30).map(p => ({
        price: p.price,
        timestamp: p.timestamp
      }));

      res.json({
        symbol,
        history: recentHistory,
        count: recentHistory.length
      });
    });

    // Performance stats endpoint
    this.app.get('/api/performance', (req, res) => {
      const stats = this.winRateTracker.getOverallStats();
      const recentSignals = this.winRateTracker.getRecentSignals(20);

      res.json({
        overall: stats,
        recentSignals: recentSignals.map(s => ({
          id: s.id,
          symbol: s.symbol,
          direction: s.direction,
          entryType: s.entryType,
          entryPrice: s.entryPrice,
          exitPrice: s.exitPrice,
          outcome: s.outcome,
          pnlPercent: s.pnlPercent,
          confidence: s.confidence,
          timestamp: s.timestamp
        }))
      });
    });

    // ============== ML API Endpoints ==============

    // ML service status
    this.app.get('/api/ml/status', async (req, res) => {
      const status = this.mlClient.getStatus();
      const featureCounts = this.winRateTracker.getFeatureCounts();

      res.json({
        ...status,
        signalCount: featureCounts.total,
        completedSignals: featureCounts.completed,
        readyForTraining: this.winRateTracker.hasEnoughDataForTraining(config.ml.minSignalsForTraining),
        minSignalsForTraining: config.ml.minSignalsForTraining,
      });
    });

    // ML model statistics
    this.app.get('/api/ml/stats', async (req, res) => {
      try {
        const stats = await this.mlClient.getStats();
        const accuracyStats = this.winRateTracker.getMLAccuracyStats();

        res.json({
          model: stats,
          accuracy: accuracyStats,
        });
      } catch (error) {
        res.json({
          model: null,
          accuracy: this.winRateTracker.getMLAccuracyStats(),
          error: 'Failed to get ML stats',
        });
      }
    });

    // Trigger ML training (strict rate limit)
    this.app.post('/api/ml/train', strictLimiter, async (req, res) => {
      if (!this.winRateTracker.hasEnoughDataForTraining(config.ml.minSignalsForTraining)) {
        res.status(400).json({
          error: 'Not enough training data',
          required: config.ml.minSignalsForTraining,
          current: this.winRateTracker.getFeatureCounts().completed,
        });
        return;
      }

      try {
        const trainingData = this.winRateTracker.getTrainingData(5000);
        const result = await this.mlClient.triggerTraining(trainingData);

        if (result) {
          res.json(result);
        } else {
          res.status(500).json({ error: 'Training failed' });
        }
      } catch (error) {
        res.status(500).json({ error: 'Training error: ' + (error as Error).message });
      }
    });

    // Export training data as CSV
    this.app.get('/api/ml/export-csv', (req, res) => {
      const csv = this.winRateTracker.exportTrainingDataCSV();

      if (!csv) {
        res.status(404).json({ error: 'No training data available' });
        return;
      }

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=training_data.csv');
      res.send(csv);
    });

    // Feature counts for training data
    this.app.get('/api/ml/feature-counts', (req, res) => {
      res.json(this.winRateTracker.getFeatureCounts());
    });

    // ============== OMNIA Protocol API Endpoints ==============

    // OMNIA service status
    this.app.get('/api/omnia/status', (req, res) => {
      res.json(this.omniaTracker.getStatus());
    });

    // OMNIA current price and market data
    this.app.get('/api/omnia/price', (req, res) => {
      const data = this.omniaTracker.getData();
      res.json({
        price: data.price,
        priceChange24h: data.priceChange24h,
        priceChangePercent24h: data.priceChangePercent24h,
        marketCap: data.marketCap,
        volume24h: data.volume24h,
        circulatingSupply: data.circulatingSupply,
        totalSupply: data.totalSupply,
        ath: data.ath,
        athChangePercent: data.athChangePercent,
        lastUpdated: data.priceLastUpdated,
      });
    });

    // OMNIA price chart data
    this.app.get('/api/omnia/chart/:timeframe', async (req, res) => {
      const tf = req.params.timeframe;
      let days = 7;

      switch (tf) {
        case '24h':
          days = 1;
          break;
        case '7d':
          days = 7;
          break;
        case '30d':
          days = 30;
          break;
        default:
          days = 7;
      }

      try {
        const chartData = await this.omniaTracker.getChartData(days);
        res.json({
          timeframe: tf,
          days,
          data: chartData,
        });
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch chart data' });
      }
    });

    // OMNIA exchange listings
    this.app.get('/api/omnia/exchanges', (req, res) => {
      const data = this.omniaTracker.getData();
      res.json({
        exchanges: data.exchanges,
        count: data.exchanges.length,
        lastUpdated: data.priceLastUpdated,
      });
    });

    // OMNIA recent transfers
    this.app.get('/api/omnia/transfers', (req, res) => {
      const data = this.omniaTracker.getData();
      const formatted = data.recentTransfers.map(t => ({
        ...t,
        display: this.omniaTracker.formatTransfer(t),
      }));

      res.json({
        transfers: formatted,
        count: formatted.length,
        lastUpdated: data.transfersLastUpdated,
      });
    });

    // OMNIA whale alerts
    this.app.get('/api/omnia/whales', (req, res) => {
      const severity = req.query.severity as string | undefined;
      const validSeverities = ['info', 'warning', 'critical'];
      const filterSeverity = severity && validSeverities.includes(severity)
        ? severity as 'info' | 'warning' | 'critical'
        : undefined;

      const alerts = this.omniaTracker.getWhaleAlerts(filterSeverity, 50);

      res.json({
        alerts: alerts.map(a => ({
          ...a,
          display: this.omniaTracker.formatTransfer(a.transfer),
        })),
        count: alerts.length,
      });
    });

    // OMNIA community and social data
    this.app.get('/api/omnia/community', (req, res) => {
      const community = this.omniaTracker.getCommunityData();
      res.json(community || {
        twitterFollowers: 0,
        telegramMembers: 0,
        redditSubscribers: 0,
        watchlistUsers: 0,
        sentimentVotesUp: 0,
        sentimentVotesDown: 0,
        sentimentPercent: 50,
      });
    });

    // OMNIA contract and social info
    this.app.get('/api/omnia/info', (req, res) => {
      res.json(this.omniaTracker.getContractInfo());
    });

    // OMNIA full data snapshot
    this.app.get('/api/omnia/data', (req, res) => {
      const data = this.omniaTracker.getData();
      res.json(data);
    });

    // Force refresh OMNIA data
    this.app.post('/api/omnia/refresh', strictLimiter, async (req, res) => {
      try {
        await this.omniaTracker.refresh();
        res.json({ success: true, message: 'OMNIA data refreshed' });
      } catch (error) {
        res.status(500).json({ error: 'Failed to refresh data' });
      }
    });

    // Serve OMNIA tracking page
    this.app.get('/omnia', (req, res) => {
      res.sendFile(path.join(__dirname, '../../public/omnia.html'));
    });
  }

  private setupSocketIO(): void {
    // Security: Connection middleware to limit connections per IP
    this.io.use((socket, next) => {
      const clientIP = socket.handshake.address ||
                       socket.handshake.headers['x-forwarded-for']?.toString().split(',')[0] ||
                       'unknown';

      const currentConnections = this.connectionsPerIP.get(clientIP) || 0;

      if (currentConnections >= this.MAX_CONNECTIONS_PER_IP) {
        console.warn(`[Security] Blocked connection from ${clientIP}: too many connections (${currentConnections})`);
        return next(new Error('Too many connections from your IP'));
      }

      // Store IP on socket for later cleanup
      (socket as any).clientIP = clientIP;
      this.connectionsPerIP.set(clientIP, currentConnections + 1);

      next();
    });

    this.io.on('connection', (socket) => {
      const clientIP = (socket as any).clientIP || 'unknown';

      // Track visitor count
      this.visitorCount++;
      this.totalVisitors++;

      if (config.logging.verbose) {
        console.log('Client connected:', socket.id, `from ${clientIP}`, `(${this.visitorCount} online)`);
      }

      // Initialize message rate tracking for this socket
      this.socketMessageCounts.set(socket.id, { count: 0, resetTime: Date.now() + 60000 });

      // Broadcast updated visitor count to ALL clients
      this.broadcastVisitorCount();
      this.emitUpdate();

      // Security: Rate limit helper for socket messages
      const checkRateLimit = (): boolean => {
        const rateData = this.socketMessageCounts.get(socket.id);
        if (!rateData) return false;

        const now = Date.now();
        if (now > rateData.resetTime) {
          rateData.count = 0;
          rateData.resetTime = now + 60000;
        }

        rateData.count++;
        if (rateData.count > this.MESSAGE_RATE_LIMIT) {
          console.warn(`[Security] Rate limit exceeded for socket ${socket.id} from ${clientIP}`);
          return false;
        }
        return true;
      };

      // Handle filter updates from client (with rate limiting)
      socket.on('setFilter', (filterConfig) => {
        if (!checkRateLimit()) {
          socket.emit('error', { message: 'Rate limit exceeded' });
          return;
        }
        this.filterManager.setConfig(filterConfig);
        this.emitUpdate();
      });

      socket.on('addToWatchlist', (symbol) => {
        if (!checkRateLimit()) {
          socket.emit('error', { message: 'Rate limit exceeded' });
          return;
        }
        // Security: Validate symbol input
        if (typeof symbol !== 'string' || symbol.length > 20 || !/^[A-Z0-9]+$/.test(symbol)) {
          socket.emit('error', { message: 'Invalid symbol' });
          return;
        }
        this.filterManager.addToWatchlist(symbol);
        this.emitUpdate();
      });

      socket.on('removeFromWatchlist', (symbol) => {
        if (!checkRateLimit()) {
          socket.emit('error', { message: 'Rate limit exceeded' });
          return;
        }
        // Security: Validate symbol input
        if (typeof symbol !== 'string' || symbol.length > 20) {
          socket.emit('error', { message: 'Invalid symbol' });
          return;
        }
        this.filterManager.removeFromWatchlist(symbol);
        this.emitUpdate();
      });

      socket.on('disconnect', () => {
        this.visitorCount = Math.max(0, this.visitorCount - 1);

        // Clean up connection tracking
        const currentConnections = this.connectionsPerIP.get(clientIP) || 1;
        if (currentConnections <= 1) {
          this.connectionsPerIP.delete(clientIP);
        } else {
          this.connectionsPerIP.set(clientIP, currentConnections - 1);
        }

        // Clean up message rate tracking
        this.socketMessageCounts.delete(socket.id);

        if (config.logging.verbose) {
          console.log('Client disconnected:', socket.id, `(${this.visitorCount} online)`);
        }

        // Broadcast updated visitor count to remaining clients
        this.broadcastVisitorCount();
      });
    });
  }

  private broadcastVisitorCount(): void {
    this.io.emit('visitorCount', {
      online: this.visitorCount,
      total: this.totalVisitors,
    });
  }

  private setupOmniaEvents(): void {
    // Forward OMNIA tracker events to Socket.IO clients
    this.omniaTracker.on('update', (data) => {
      this.io.emit('omnia:update', data);
    });

    this.omniaTracker.on('whaleAlert', (alert) => {
      this.io.emit('omnia:whale', alert);
    });

    this.omniaTracker.on('transfer', (transfer) => {
      this.io.emit('omnia:transfer', transfer);
    });
  }

  setConnectionStatus(status: ConnectionStatus, symbols: number): void {
    this.connectionStatus = status;
    this.symbolCount = symbols;
  }

  async updateDetectors(): Promise<void> {
    // Update all detectors (called periodically)
    await Promise.all([
      this.fundingDetector.update(),
      this.oiDetector.update(),
      this.mtfDetector.update(),
      this.patternDetector.update(),
      this.entryCalculator.update(),
    ]);

    // Update real-time detectors
    this.liquidationDetector.detectFromPriceAction();
    this.whaleDetector.update();
    this.correlationDetector.update();

    // Evaluate pending signals for win rate tracking
    this.winRateTracker.evaluatePendingSignals();

    // Update smart signal engine after other detectors
    await this.smartSignalEngine.analyze();

    // Record high-confidence signals for win rate tracking
    const topSignals = this.smartSignalEngine.getTopSignals(5, 'LONG');
    for (const signal of topSignals) {
      if (signal.confidence >= 60 && (signal.direction === 'LONG' || signal.direction === 'SHORT')) {
        this.winRateTracker.recordSignal(
          signal.symbol,
          signal.entryType,
          signal.direction,
          signal.price,
          signal.confidence
        );
      }
    }
  }

  emitUpdate(): void {
    // Update volume tracking for spike detection
    this.opportunityRanker.update();

    const filterSymbols = (items: any[]) =>
      items.filter((item) => this.filterManager.passesFilter(item.symbol));

    const data = {
      status: this.connectionStatus,
      symbolCount: this.symbolCount,
      timestamp: Date.now(),

      // Original panels
      topMovers: filterSymbols(
        this.opportunityRanker.getVolatilityDetector().getTopMovers(config.ui.maxDisplayed)
      ),
      velocityAlerts: filterSymbols(
        this.opportunityRanker.getVelocityDetector().getTopVelocity(config.ui.maxDisplayed)
      ),
      volumeSpikes: filterSymbols(
        this.opportunityRanker.getVolumeDetector().getTopSpikes(config.ui.maxDisplayed)
      ),
      rangeBreakouts: filterSymbols(
        this.opportunityRanker.getRangeDetector().getNearHighs().slice(0, config.ui.maxDisplayed)
      ),
      highConviction: filterSymbols(
        this.opportunityRanker.getHighConviction().slice(0, config.ui.maxDisplayed)
      ),

      // New panels
      fundingRates: filterSymbols(this.fundingDetector.getExtremeRates(0.05).slice(0, config.ui.maxDisplayed)),
      squeezeSetups: filterSymbols(this.fundingDetector.getSqueezeSignals().slice(0, config.ui.maxDisplayed)),
      openInterest: filterSymbols(this.oiDetector.getSignificantChanges(2).slice(0, config.ui.maxDisplayed)),
      multiTimeframe: filterSymbols(this.mtfDetector.getStrongAligned().slice(0, config.ui.maxDisplayed)),
      rsiExtremes: filterSymbols(this.mtfDetector.getRSIExtremes().slice(0, config.ui.maxDisplayed)),
      divergences: filterSymbols(this.mtfDetector.getDivergences().slice(0, config.ui.maxDisplayed)),

      // Smart Signal Engine panels
      smartSignalsLong: filterSymbols(this.smartSignalEngine.getTopSignals(config.ui.maxDisplayed, 'LONG')),
      smartSignalsShort: filterSymbols(this.smartSignalEngine.getTopSignals(config.ui.maxDisplayed, 'SHORT')),
      earlyEntries: filterSymbols(this.smartSignalEngine.getEarlyEntries(config.ui.maxDisplayed)),
      reversalSignals: filterSymbols(this.smartSignalEngine.getReversalSignals(config.ui.maxDisplayed)),
      breakoutCandidates: filterSymbols(this.smartSignalEngine.getBreakoutCandidates(config.ui.maxDisplayed)),
      lowRiskSetups: filterSymbols(this.smartSignalEngine.getLowRiskSetups(config.ui.maxDisplayed)),

      // Advanced detector panels
      liquidations: this.liquidationDetector.getAlerts().slice(0, config.ui.maxDisplayed),
      whaleAlerts: this.whaleDetector.getTopWhaleActivity(config.ui.maxDisplayed),
      correlations: this.correlationDetector.getTopAlerts(config.ui.maxDisplayed),
      patterns: this.patternDetector.getTopPatterns(config.ui.maxDisplayed),
      entrySignals: this.entryCalculator.getEntrySignals().slice(0, config.ui.maxDisplayed),

      // Top Picks for fast trading
      topPicks: this.topPicker.getAllPicks(),

      // Sentiment data
      marketSentiment: this.sentimentAnalyzer.getMarketSentiment(),

      // Win rate stats
      winRateStats: this.winRateTracker.getOverallStats(),

      // Recent signals for performance tracking
      recentSignals: this.winRateTracker.getRecentSignals(10).map(s => ({
        id: s.id,
        symbol: s.symbol,
        direction: s.direction,
        entryType: s.entryType,
        entryPrice: s.entryPrice,
        exitPrice: s.exitPrice,
        outcome: s.outcome,
        pnlPercent: s.pnlPercent,
        confidence: s.confidence,
        timestamp: s.timestamp
      })),

      // Notifications
      notifications: this.notificationManager.getAndClearPending(),

      // Current filters
      filters: this.filterManager.getConfig(),
      watchlist: this.filterManager.getWatchlist(),

      // ML Status
      mlStatus: this.mlClient.getStatus(),
      mlFeatureCounts: this.winRateTracker.getFeatureCounts(),

      // Visitor count
      visitors: {
        online: this.visitorCount,
        total: this.totalVisitors,
      },
    };

    this.io.emit('update', data);
  }

  getFundingDetector(): FundingDetector {
    return this.fundingDetector;
  }

  getOIDetector(): OpenInterestDetector {
    return this.oiDetector;
  }

  getMTFDetector(): MultiTimeframeDetector {
    return this.mtfDetector;
  }

  getFilterManager(): FilterManager {
    return this.filterManager;
  }

  getSmartSignalEngine(): SmartSignalEngine {
    return this.smartSignalEngine;
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, async () => {
        console.log(`Web dashboard running at http://localhost:${this.port}`);

        // Start OMNIA Protocol tracking
        if (config.omnia?.enabled) {
          try {
            await this.omniaTracker.start();
          } catch (error) {
            console.warn('[WebServer] Failed to start OMNIA tracker:', error);
          }
        }

        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      // Stop OMNIA tracker
      this.omniaTracker.stop();

      this.io.close();
      this.server.close(() => {
        resolve();
      });
    });
  }
}

import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import path from 'path';
import fs from 'fs';
import { config } from '../config.js';
import { Opportunity } from '../binance/types.js';

// Signal features for ML training
export interface SignalFeatures {
  signal_id: string;
  symbol: string;
  timestamp: number;

  // Price features
  price_change_24h: number;
  price_change_1h: number;
  price_change_15m: number;
  price_change_5m: number;
  high_low_range: number;
  price_position: number; // Position within high-low range (0-1)

  // Volume features
  volume_quote_24h: number;
  volume_multiplier: number;
  volume_change_1h: number;

  // Momentum features
  velocity: number;
  acceleration: number;
  trend_state: number; // 1 = uptrend, -1 = downtrend, 0 = neutral

  // Technical features
  rsi_1h: number;
  mtf_alignment: number; // 1-4 timeframes aligned
  divergence_type: number; // 0 = none, 1 = bullish, -1 = bearish

  // Funding features
  funding_rate: number;
  funding_signal: number; // 1 = bullish (negative funding), -1 = bearish
  funding_direction_match: number; // 1 if funding agrees with signal direction

  // Open Interest features
  oi_change_percent: number;
  oi_signal: number; // 1 = bullish, -1 = bearish, 0 = neutral
  oi_price_alignment: number; // 1 if OI and price move together

  // Pattern features
  pattern_type: number; // Encoded pattern type
  pattern_confidence: number;
  distance_from_level: number;

  // Smart Signal features
  smart_confidence: number;
  component_count: number;
  entry_type: number; // 0 = EARLY, 1 = MOMENTUM, 2 = REVERSAL, 3 = BREAKOUT
  risk_level: number; // 0 = LOW, 1 = MEDIUM, 2 = HIGH

  // Entry timing features
  atr_percent: number;
  vwap_distance: number;
  risk_reward_ratio: number;

  // Whale/Correlation features
  whale_activity: number;
  btc_correlation: number;
  btc_outperformance: number;

  // Direction
  direction: number; // 1 = LONG, -1 = SHORT
}

// ML model metrics for tracking performance
export interface MLModelMetrics {
  id?: number;
  model_version: string;
  training_date: number;
  training_samples: number;
  validation_auc: number;
  validation_accuracy: number;
  win_rate_predicted: number;
  win_rate_actual: number;
  feature_importance: string; // JSON string
}

// ML prediction result
export interface MLPrediction {
  win_probability: number;
  quality_tier: 'HIGH' | 'MEDIUM' | 'LOW' | 'FILTER';
  confidence: number;
  should_filter: boolean;
  model_version: string;
}

export class StorageManager {
  private db: SqlJsDatabase | null = null;
  private dbPath: string;
  private saveInterval: NodeJS.Timeout | null = null;

  constructor(dbPath: string = config.storage.dbPath) {
    this.dbPath = dbPath;
  }

  async init(): Promise<void> {
    // Ensure directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Initialize sql.js
    const SQL = await initSqlJs();

    // Load existing database or create new one
    if (fs.existsSync(this.dbPath)) {
      const buffer = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(buffer);
    } else {
      this.db = new SQL.Database();
    }

    this.createTables();

    // Auto-save every 30 seconds
    this.saveInterval = setInterval(() => this.save(), 30000);
  }

  private createTables(): void {
    if (!this.db) return;

    // Create opportunities table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS opportunities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        type TEXT NOT NULL,
        score INTEGER NOT NULL,
        direction TEXT NOT NULL,
        change24h REAL,
        volume_multiplier REAL,
        velocity REAL,
        range_percent REAL,
        is_new INTEGER DEFAULT 0,
        last_price REAL NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(symbol, type, created_at)
      )
    `);

    // Create indexes
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_opportunities_symbol ON opportunities(symbol)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_opportunities_type ON opportunities(type)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_opportunities_created_at ON opportunities(created_at)`);

    // Create alerts table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        alert_type TEXT NOT NULL,
        message TEXT,
        level TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_alerts_symbol ON alerts(symbol)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at)`);

    // Create sessions table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        total_opportunities INTEGER DEFAULT 0,
        total_alerts INTEGER DEFAULT 0
      )
    `);

    // Create signal_features table for ML training data
    this.db.run(`
      CREATE TABLE IF NOT EXISTS signal_features (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        signal_id TEXT UNIQUE NOT NULL,
        symbol TEXT NOT NULL,
        timestamp INTEGER NOT NULL,

        -- Price features
        price_change_24h REAL DEFAULT 0,
        price_change_1h REAL DEFAULT 0,
        price_change_15m REAL DEFAULT 0,
        price_change_5m REAL DEFAULT 0,
        high_low_range REAL DEFAULT 0,
        price_position REAL DEFAULT 0,

        -- Volume features
        volume_quote_24h REAL DEFAULT 0,
        volume_multiplier REAL DEFAULT 0,
        volume_change_1h REAL DEFAULT 0,

        -- Momentum features
        velocity REAL DEFAULT 0,
        acceleration REAL DEFAULT 0,
        trend_state INTEGER DEFAULT 0,

        -- Technical features
        rsi_1h REAL DEFAULT 50,
        mtf_alignment INTEGER DEFAULT 0,
        divergence_type INTEGER DEFAULT 0,

        -- Funding features
        funding_rate REAL DEFAULT 0,
        funding_signal INTEGER DEFAULT 0,
        funding_direction_match INTEGER DEFAULT 0,

        -- Open Interest features
        oi_change_percent REAL DEFAULT 0,
        oi_signal INTEGER DEFAULT 0,
        oi_price_alignment INTEGER DEFAULT 0,

        -- Pattern features
        pattern_type INTEGER DEFAULT 0,
        pattern_confidence REAL DEFAULT 0,
        distance_from_level REAL DEFAULT 0,

        -- Smart Signal features
        smart_confidence REAL DEFAULT 0,
        component_count INTEGER DEFAULT 0,
        entry_type INTEGER DEFAULT 0,
        risk_level INTEGER DEFAULT 1,

        -- Entry timing features
        atr_percent REAL DEFAULT 0,
        vwap_distance REAL DEFAULT 0,
        risk_reward_ratio REAL DEFAULT 0,

        -- Whale/Correlation features
        whale_activity REAL DEFAULT 0,
        btc_correlation REAL DEFAULT 0,
        btc_outperformance REAL DEFAULT 0,

        -- Direction and outcome
        direction INTEGER DEFAULT 0,
        outcome TEXT DEFAULT 'PENDING',
        pnl_percent REAL DEFAULT NULL,

        -- ML prediction (filled after prediction)
        ml_win_probability REAL DEFAULT NULL,
        ml_quality_tier TEXT DEFAULT NULL,
        ml_model_version TEXT DEFAULT NULL
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_signal_features_signal_id ON signal_features(signal_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_signal_features_symbol ON signal_features(symbol)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_signal_features_timestamp ON signal_features(timestamp)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_signal_features_outcome ON signal_features(outcome)`);

    // Create ml_model_metrics table for tracking model performance
    this.db.run(`
      CREATE TABLE IF NOT EXISTS ml_model_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model_version TEXT NOT NULL,
        training_date INTEGER NOT NULL,
        training_samples INTEGER NOT NULL,
        validation_auc REAL DEFAULT 0,
        validation_accuracy REAL DEFAULT 0,
        win_rate_predicted REAL DEFAULT 0,
        win_rate_actual REAL DEFAULT 0,
        feature_importance TEXT DEFAULT '{}'
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_ml_model_metrics_version ON ml_model_metrics(model_version)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_ml_model_metrics_date ON ml_model_metrics(training_date)`);
  }

  private save(): void {
    if (!this.db) return;

    const data = this.db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(this.dbPath, buffer);
  }

  logOpportunity(opportunity: Opportunity): void {
    if (!this.db) return;

    this.db.run(
      `INSERT OR IGNORE INTO opportunities (
        symbol, type, score, direction, change24h, volume_multiplier,
        velocity, range_percent, is_new, last_price, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        opportunity.symbol,
        opportunity.type,
        opportunity.score,
        opportunity.direction,
        opportunity.details.change24h ?? null,
        opportunity.details.volumeMultiplier ?? null,
        opportunity.details.velocity ?? null,
        opportunity.details.range ?? null,
        opportunity.details.isNew ? 1 : 0,
        opportunity.lastPrice,
        opportunity.timestamp,
      ]
    );
  }

  logOpportunities(opportunities: Opportunity[]): void {
    if (!this.db) return;

    for (const opp of opportunities) {
      this.logOpportunity(opp);
    }
  }

  logAlert(symbol: string, alertType: string, message: string, level: 'high' | 'normal'): void {
    if (!this.db) return;

    this.db.run(
      `INSERT INTO alerts (symbol, alert_type, message, level, created_at) VALUES (?, ?, ?, ?, ?)`,
      [symbol, alertType, message, level, Date.now()]
    );
  }

  startSession(): number {
    if (!this.db) return 0;

    this.db.run(`INSERT INTO sessions (started_at) VALUES (?)`, [Date.now()]);

    const result = this.db.exec('SELECT last_insert_rowid() as id');
    return result[0]?.values[0]?.[0] as number || 0;
  }

  endSession(sessionId: number): void {
    if (!this.db) return;

    const countOpps = this.db.exec(
      `SELECT COUNT(*) as count FROM opportunities WHERE created_at >= (SELECT started_at FROM sessions WHERE id = ${sessionId})`
    );
    const countAlerts = this.db.exec(
      `SELECT COUNT(*) as count FROM alerts WHERE created_at >= (SELECT started_at FROM sessions WHERE id = ${sessionId})`
    );

    const oppsCount = countOpps[0]?.values[0]?.[0] as number || 0;
    const alertsCount = countAlerts[0]?.values[0]?.[0] as number || 0;

    this.db.run(
      `UPDATE sessions SET ended_at = ?, total_opportunities = ?, total_alerts = ? WHERE id = ?`,
      [Date.now(), oppsCount, alertsCount, sessionId]
    );

    this.save();
  }

  getRecentOpportunities(limit: number = 100): any[] {
    if (!this.db) return [];

    const result = this.db.exec(`SELECT * FROM opportunities ORDER BY created_at DESC LIMIT ${limit}`);
    return this.resultToObjects(result);
  }

  getOpportunitiesBySymbol(symbol: string, limit: number = 100): any[] {
    if (!this.db) return [];

    const stmt = this.db.prepare(`SELECT * FROM opportunities WHERE symbol = ? ORDER BY created_at DESC LIMIT ?`);
    stmt.bind([symbol, limit]);

    const results: any[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();

    return results;
  }

  getTopSymbolsByFrequency(limit: number = 10): any[] {
    if (!this.db) return [];

    const result = this.db.exec(`
      SELECT symbol, COUNT(*) as frequency, AVG(score) as avg_score
      FROM opportunities
      GROUP BY symbol
      ORDER BY frequency DESC
      LIMIT ${limit}
    `);

    return this.resultToObjects(result);
  }

  getStatsLast24h(): any {
    if (!this.db) return {};

    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const result = this.db.exec(`
      SELECT
        COUNT(*) as total_opportunities,
        COUNT(DISTINCT symbol) as unique_symbols,
        AVG(score) as avg_score,
        MAX(score) as max_score
      FROM opportunities
      WHERE created_at >= ${cutoff}
    `);

    if (result.length > 0 && result[0].values.length > 0) {
      const columns = result[0].columns;
      const values = result[0].values[0];
      const obj: any = {};
      columns.forEach((col, i) => {
        obj[col] = values[i];
      });
      return obj;
    }

    return {};
  }

  private resultToObjects(result: any[]): any[] {
    if (result.length === 0) return [];

    const columns = result[0].columns;
    return result[0].values.map((row: any[]) => {
      const obj: any = {};
      columns.forEach((col: string, i: number) => {
        obj[col] = row[i];
      });
      return obj;
    });
  }

  // ============== ML Feature Storage Methods ==============

  saveSignalFeatures(features: SignalFeatures): void {
    if (!this.db) return;

    this.db.run(
      `INSERT OR REPLACE INTO signal_features (
        signal_id, symbol, timestamp,
        price_change_24h, price_change_1h, price_change_15m, price_change_5m,
        high_low_range, price_position,
        volume_quote_24h, volume_multiplier, volume_change_1h,
        velocity, acceleration, trend_state,
        rsi_1h, mtf_alignment, divergence_type,
        funding_rate, funding_signal, funding_direction_match,
        oi_change_percent, oi_signal, oi_price_alignment,
        pattern_type, pattern_confidence, distance_from_level,
        smart_confidence, component_count, entry_type, risk_level,
        atr_percent, vwap_distance, risk_reward_ratio,
        whale_activity, btc_correlation, btc_outperformance,
        direction
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        features.signal_id,
        features.symbol,
        features.timestamp,
        features.price_change_24h,
        features.price_change_1h,
        features.price_change_15m,
        features.price_change_5m,
        features.high_low_range,
        features.price_position,
        features.volume_quote_24h,
        features.volume_multiplier,
        features.volume_change_1h,
        features.velocity,
        features.acceleration,
        features.trend_state,
        features.rsi_1h,
        features.mtf_alignment,
        features.divergence_type,
        features.funding_rate,
        features.funding_signal,
        features.funding_direction_match,
        features.oi_change_percent,
        features.oi_signal,
        features.oi_price_alignment,
        features.pattern_type,
        features.pattern_confidence,
        features.distance_from_level,
        features.smart_confidence,
        features.component_count,
        features.entry_type,
        features.risk_level,
        features.atr_percent,
        features.vwap_distance,
        features.risk_reward_ratio,
        features.whale_activity,
        features.btc_correlation,
        features.btc_outperformance,
        features.direction,
      ]
    );
  }

  updateSignalOutcome(signalId: string, outcome: 'WIN' | 'LOSS', pnlPercent: number): void {
    if (!this.db) return;

    this.db.run(
      `UPDATE signal_features SET outcome = ?, pnl_percent = ? WHERE signal_id = ?`,
      [outcome, pnlPercent, signalId]
    );
  }

  updateSignalMLPrediction(signalId: string, prediction: MLPrediction): void {
    if (!this.db) return;

    this.db.run(
      `UPDATE signal_features SET ml_win_probability = ?, ml_quality_tier = ?, ml_model_version = ? WHERE signal_id = ?`,
      [prediction.win_probability, prediction.quality_tier, prediction.model_version, signalId]
    );
  }

  getCompletedSignalsForTraining(limit: number = 5000): SignalFeatures[] {
    if (!this.db) return [];

    const result = this.db.exec(`
      SELECT * FROM signal_features
      WHERE outcome IN ('WIN', 'LOSS')
      ORDER BY timestamp DESC
      LIMIT ${limit}
    `);

    return this.resultToObjects(result) as SignalFeatures[];
  }

  getSignalFeaturesByOutcome(outcome: 'WIN' | 'LOSS' | 'PENDING', limit: number = 1000): SignalFeatures[] {
    if (!this.db) return [];

    const stmt = this.db.prepare(`SELECT * FROM signal_features WHERE outcome = ? ORDER BY timestamp DESC LIMIT ?`);
    stmt.bind([outcome, limit]);

    const results: SignalFeatures[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject() as SignalFeatures);
    }
    stmt.free();

    return results;
  }

  getSignalFeaturesCount(): { total: number; completed: number; wins: number; losses: number; pending: number } {
    if (!this.db) return { total: 0, completed: 0, wins: 0, losses: 0, pending: 0 };

    const result = this.db.exec(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN outcome IN ('WIN', 'LOSS') THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN outcome = 'WIN' THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN outcome = 'LOSS' THEN 1 ELSE 0 END) as losses,
        SUM(CASE WHEN outcome = 'PENDING' THEN 1 ELSE 0 END) as pending
      FROM signal_features
    `);

    if (result.length > 0 && result[0].values.length > 0) {
      const values = result[0].values[0];
      return {
        total: (values[0] as number) || 0,
        completed: (values[1] as number) || 0,
        wins: (values[2] as number) || 0,
        losses: (values[3] as number) || 0,
        pending: (values[4] as number) || 0,
      };
    }

    return { total: 0, completed: 0, wins: 0, losses: 0, pending: 0 };
  }

  getPendingSignalIds(): string[] {
    if (!this.db) return [];

    const result = this.db.exec(`SELECT signal_id FROM signal_features WHERE outcome = 'PENDING'`);
    if (result.length === 0) return [];

    return result[0].values.map((row: any) => row[0] as string);
  }

  // ============== ML Model Metrics Methods ==============

  saveModelMetrics(metrics: MLModelMetrics): void {
    if (!this.db) return;

    this.db.run(
      `INSERT INTO ml_model_metrics (
        model_version, training_date, training_samples,
        validation_auc, validation_accuracy,
        win_rate_predicted, win_rate_actual, feature_importance
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        metrics.model_version,
        metrics.training_date,
        metrics.training_samples,
        metrics.validation_auc,
        metrics.validation_accuracy,
        metrics.win_rate_predicted,
        metrics.win_rate_actual,
        metrics.feature_importance,
      ]
    );
  }

  getLatestModelMetrics(): MLModelMetrics | null {
    if (!this.db) return null;

    const result = this.db.exec(`
      SELECT * FROM ml_model_metrics
      ORDER BY training_date DESC
      LIMIT 1
    `);

    const metrics = this.resultToObjects(result);
    return metrics.length > 0 ? (metrics[0] as MLModelMetrics) : null;
  }

  getModelMetricsHistory(limit: number = 10): MLModelMetrics[] {
    if (!this.db) return [];

    const result = this.db.exec(`
      SELECT * FROM ml_model_metrics
      ORDER BY training_date DESC
      LIMIT ${limit}
    `);

    return this.resultToObjects(result) as MLModelMetrics[];
  }

  updateModelActualWinRate(modelVersion: string, actualWinRate: number): void {
    if (!this.db) return;

    this.db.run(
      `UPDATE ml_model_metrics SET win_rate_actual = ? WHERE model_version = ?`,
      [actualWinRate, modelVersion]
    );
  }

  // ============== ML Data Export Methods ==============

  exportTrainingDataAsCSV(): string {
    if (!this.db) return '';

    const result = this.db.exec(`
      SELECT * FROM signal_features
      WHERE outcome IN ('WIN', 'LOSS')
      ORDER BY timestamp ASC
    `);

    if (result.length === 0 || result[0].values.length === 0) return '';

    const columns = result[0].columns;
    const rows = result[0].values;

    let csv = columns.join(',') + '\n';

    for (const row of rows) {
      csv += row.map(v => v === null ? '' : v).join(',') + '\n';
    }

    return csv;
  }

  getMLAccuracyStats(): { predicted: number; actual: number; modelCount: number } {
    if (!this.db) return { predicted: 0, actual: 0, modelCount: 0 };

    const result = this.db.exec(`
      SELECT
        AVG(ml_win_probability) as avg_predicted,
        AVG(CASE WHEN outcome = 'WIN' THEN 1.0 ELSE 0.0 END) as avg_actual,
        COUNT(*) as count
      FROM signal_features
      WHERE outcome IN ('WIN', 'LOSS') AND ml_win_probability IS NOT NULL
    `);

    if (result.length > 0 && result[0].values.length > 0) {
      const values = result[0].values[0];
      return {
        predicted: ((values[0] as number) || 0) * 100,
        actual: ((values[1] as number) || 0) * 100,
        modelCount: (values[2] as number) || 0,
      };
    }

    return { predicted: 0, actual: 0, modelCount: 0 };
  }

  close(): void {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
    }
    if (this.db) {
      this.save();
      this.db.close();
    }
  }
}

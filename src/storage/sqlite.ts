import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import path from 'path';
import fs from 'fs';
import { config } from '../config.js';
import { Opportunity } from '../binance/types.js';

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

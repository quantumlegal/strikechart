import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { HealthReport } from '../binance/types.js';
import { StorageManager } from '../storage/sqlite.js';
import { DataStore } from '../core/dataStore.js';
import { BinanceWebSocket } from '../binance/websocket.js';
import { MLServiceClient } from './mlClient.js';
import { TelegramNotifier } from './telegramNotifier.js';

export interface IntervalRefs {
  updateInterval: NodeJS.Timeout | null;
  logInterval: NodeJS.Timeout | null;
  detectorInterval: NodeJS.Timeout | null;
}

export interface ServerMaps {
  connectionsPerIP: Map<string, number>;
  socketMessageCounts: Map<string, { count: number; resetTime: number }>;
}

export class HealthManager {
  private storage: StorageManager;
  private dataStore: DataStore;
  private ws: BinanceWebSocket;
  private serverMaps: ServerMaps;
  private intervalRefs: IntervalRefs;
  private mlClient: MLServiceClient;
  private telegram: TelegramNotifier | null;

  private healthInterval: NodeJS.Timeout | null = null;
  private cycleCount: number = 0;
  private lastReport: HealthReport | null = null;
  private startTime: number = Date.now();

  // Auto-training state
  private lastTrainingTime: number = 0;
  private lastTrainingSignalCount: number = 0;

  constructor(
    storage: StorageManager,
    dataStore: DataStore,
    ws: BinanceWebSocket,
    serverMaps: ServerMaps,
    intervalRefs: IntervalRefs,
    mlClient: MLServiceClient,
    telegram?: TelegramNotifier,
  ) {
    this.storage = storage;
    this.dataStore = dataStore;
    this.ws = ws;
    this.serverMaps = serverMaps;
    this.intervalRefs = intervalRefs;
    this.mlClient = mlClient;
    this.telegram = telegram ?? null;
  }

  start(): void {
    if (!config.health.enabled) {
      console.log('[HealthManager] Disabled via config');
      return;
    }

    console.log(`[HealthManager] Starting (interval: ${config.health.intervalMs / 1000}s)`);

    // First run after 30s delay to let things stabilize
    setTimeout(() => {
      this.runCycle();
      this.healthInterval = setInterval(() => this.runCycle(), config.health.intervalMs);
    }, 30000);
  }

  shutdown(): void {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }
    console.log('[HealthManager] Shut down');
  }

  getLastReport(): HealthReport | null {
    return this.lastReport;
  }

  getMetrics(): { uptime: number; cycles: number; lastCycleAt: number | null } {
    return {
      uptime: Date.now() - this.startTime,
      cycles: this.cycleCount,
      lastCycleAt: this.lastReport?.timestamp ?? null,
    };
  }

  private async runCycle(): Promise<void> {
    this.cycleCount++;
    const cycleNum = this.cycleCount;

    console.log(`[HealthManager] === Health Cycle #${cycleNum} ===`);

    try {
      // 1. Memory check
      const memoryReport = this.checkMemory();

      // 2. WebSocket watchdog
      const wsReport = this.checkWebSocket();

      // 3. DB pruning
      const dbReport = this.pruneDatabase();

      // 4. Stale symbol cleanup
      const staleReport = this.cleanStaleSymbols();

      // 5. Map cleanup
      const mapReport = this.cleanMaps();

      // 6. ML stats
      const mlReport = this.checkML();

      // 7. Interval health
      const intervalReport = this.checkIntervals();

      // 8. Auto-training check
      const autoTrainingReport = await this.checkAutoTraining();

      // 9. Automated backup
      const backupReport = this.backupDatabase(cycleNum);

      // 10. Build report
      this.lastReport = {
        cycle: cycleNum,
        timestamp: Date.now(),
        memory: memoryReport,
        websocket: wsReport,
        database: dbReport,
        dataStore: staleReport,
        maps: mapReport,
        ml: mlReport,
        intervals: intervalReport,
        autoTraining: autoTrainingReport,
        backup: backupReport,
      };

      console.log(`[HealthManager] Cycle #${cycleNum} complete. Memory: ${memoryReport.heapUsedMB.toFixed(1)}MB (${memoryReport.percentUsed.toFixed(0)}%), Symbols: ${staleReport.symbolCount}, DB rows: ${Object.values(dbReport.tables).reduce((a, b) => a + b, 0)}`);

      // 11. Send Telegram health alerts if issues detected
      this.sendHealthAlerts(this.lastReport);
    } catch (error) {
      console.error(`[HealthManager] Cycle #${cycleNum} error:`, error);
    }
  }

  private checkMemory(): HealthReport['memory'] {
    const mem = process.memoryUsage();
    const heapUsedMB = mem.heapUsed / 1024 / 1024;
    const heapTotalMB = mem.heapTotal / 1024 / 1024;
    const rssMB = mem.rss / 1024 / 1024;
    const externalMB = mem.external / 1024 / 1024;
    const maxHeapMB = config.health.maxHeapMB;
    const percentUsed = (heapUsedMB / maxHeapMB) * 100;
    const warning = percentUsed >= config.health.memoryWarnPercent;

    if (warning) {
      console.warn(`[HealthManager] MEMORY WARNING: ${heapUsedMB.toFixed(1)}MB / ${maxHeapMB}MB (${percentUsed.toFixed(0)}%)`);
    } else {
      console.log(`[HealthManager] Memory: heap ${heapUsedMB.toFixed(1)}MB, rss ${rssMB.toFixed(1)}MB`);
    }

    return { heapUsedMB, heapTotalMB, rssMB, externalMB, percentUsed, warning };
  }

  private checkWebSocket(): HealthReport['websocket'] {
    const status = this.ws.status;
    const lastDataTime = this.ws.getLastDataTime();
    const lastDataReceivedAgo = lastDataTime > 0 ? Date.now() - lastDataTime : -1;
    const reconnectAttempts = this.ws.getReconnectAttempts();
    let watchdogTriggered = false;

    if (status === 'connected' && lastDataTime > 0 && lastDataReceivedAgo > config.health.wsWatchdogTimeoutMs) {
      console.warn(`[HealthManager] WS WATCHDOG: Connected but no data for ${(lastDataReceivedAgo / 1000).toFixed(0)}s - forcing reconnect`);
      this.ws.forceReconnect();
      watchdogTriggered = true;
    } else {
      console.log(`[HealthManager] WebSocket: ${status}, last data ${lastDataReceivedAgo > 0 ? (lastDataReceivedAgo / 1000).toFixed(0) + 's ago' : 'N/A'}, reconnects: ${reconnectAttempts}`);
    }

    return { status, lastDataReceivedAgo, reconnectAttempts, watchdogTriggered };
  }

  private pruneDatabase(): HealthReport['database'] {
    const tables = this.storage.getTableCounts();
    const sizeBytes = this.storage.getDatabaseSizeBytes();

    console.log(`[HealthManager] DB size: ${(sizeBytes / 1024 / 1024).toFixed(2)}MB, rows: ${JSON.stringify(tables)}`);

    const pruned = this.storage.pruneOldRecords(
      config.health.pruneOpportunityDays,
      config.health.pruneAlertDays,
      config.health.prunePendingHours,
    );

    const totalPruned = pruned.opportunities + pruned.alerts + pruned.pendingSignals;
    let vacuumed = false;

    if (totalPruned > 0) {
      console.log(`[HealthManager] Pruned: ${pruned.opportunities} opps, ${pruned.alerts} alerts, ${pruned.pendingSignals} pending signals`);
      this.storage.vacuum();
      vacuumed = true;
      console.log('[HealthManager] VACUUM complete');
    }

    return { tables, sizeBytes, pruned, vacuumed };
  }

  private cleanStaleSymbols(): HealthReport['dataStore'] {
    const symbolCount = this.dataStore.getSymbolCount();
    const maxAgeMs = config.health.staleSymbolHours * 60 * 60 * 1000;
    const removed = this.dataStore.removeStaleSymbols(maxAgeMs);

    if (removed.length > 0) {
      console.log(`[HealthManager] Removed ${removed.length} stale symbols: ${removed.slice(0, 5).join(', ')}${removed.length > 5 ? '...' : ''}`);
    }

    return { symbolCount, staleSymbolsRemoved: removed };
  }

  private cleanMaps(): HealthReport['maps'] {
    const connectionsPerIP = this.serverMaps.connectionsPerIP;
    const socketMessageCounts = this.serverMaps.socketMessageCounts;
    let entriesCleaned = 0;

    // Remove connectionsPerIP entries with count <= 0
    for (const [ip, count] of connectionsPerIP) {
      if (count <= 0) {
        connectionsPerIP.delete(ip);
        entriesCleaned++;
      }
    }

    // Remove socketMessageCounts entries stale > 5 min
    const now = Date.now();
    for (const [socketId, data] of socketMessageCounts) {
      if (now - data.resetTime > 5 * 60 * 1000) {
        socketMessageCounts.delete(socketId);
        entriesCleaned++;
      }
    }

    if (entriesCleaned > 0) {
      console.log(`[HealthManager] Cleaned ${entriesCleaned} stale map entries`);
    }

    return {
      connectionsPerIPSize: connectionsPerIP.size,
      socketMessageCountsSize: socketMessageCounts.size,
      entriesCleaned,
    };
  }

  private checkML(): HealthReport['ml'] {
    const status = this.mlClient.getStatus();
    console.log(`[HealthManager] ML: enabled=${status.enabled}, available=${status.serviceAvailable}, cache=${status.cacheSize}`);
    return {
      enabled: status.enabled,
      serviceAvailable: status.serviceAvailable,
      cacheSize: status.cacheSize,
    };
  }

  private checkIntervals(): HealthReport['intervals'] {
    const report = {
      updateInterval: this.intervalRefs.updateInterval !== null,
      logInterval: this.intervalRefs.logInterval !== null,
      detectorInterval: this.intervalRefs.detectorInterval !== null,
    };

    const missing = Object.entries(report).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length > 0) {
      console.warn(`[HealthManager] MISSING INTERVALS: ${missing.join(', ')}`);
    } else {
      console.log('[HealthManager] All intervals active');
    }

    return report;
  }

  // === NEW: Auto-training check ===
  private async checkAutoTraining(): Promise<HealthReport['autoTraining']> {
    const counts = this.storage.getSignalFeaturesCount();
    const now = Date.now();
    const newSignals = counts.completed - this.lastTrainingSignalCount;

    const report: NonNullable<HealthReport['autoTraining']> = {
      completedSignals: counts.completed,
      lastTrainingTime: this.lastTrainingTime,
      newSignalsSinceLastTrain: newSignals,
      triggered: false,
      trainResult: null,
    };

    // Check conditions for auto-training
    const hasEnoughTotal = counts.completed >= config.ml.minSignalsForTraining;
    const cooldownPassed = now - this.lastTrainingTime > config.ml.autoTrainCooldownMs;
    const hasEnoughNew = newSignals >= config.ml.minNewSignalsForRetrain;

    if (hasEnoughTotal && cooldownPassed && hasEnoughNew && config.ml.enabled) {
      console.log(`[HealthManager] Auto-training triggered: ${counts.completed} completed signals, ${newSignals} new since last train`);

      try {
        const trainingData = this.storage.getCompletedSignalsForTraining(5000);
        const result = await this.mlClient.triggerTraining(trainingData);

        if (result) {
          this.lastTrainingTime = now;
          this.lastTrainingSignalCount = counts.completed;
          report.triggered = true;
          report.trainResult = result;
          console.log(`[HealthManager] Auto-training complete: version=${result.model_version}, AUC=${result.validation_auc?.toFixed(3)}`);
        } else {
          console.warn('[HealthManager] Auto-training returned null');
        }
      } catch (error) {
        console.error('[HealthManager] Auto-training error:', error);
      }
    } else {
      console.log(`[HealthManager] Auto-training: ${counts.completed} completed, ${newSignals} new, cooldown=${cooldownPassed ? 'ready' : 'waiting'}`);
    }

    return report;
  }

  // === NEW: Automated database backup ===
  private backupDatabase(cycleNum: number): HealthReport['backup'] {
    if (cycleNum % config.health.backupIntervalCycles !== 0) {
      return { backedUp: false };
    }

    try {
      const dbPath = this.storage.getDbPath();
      const dbDir = path.dirname(dbPath);
      const backupDir = path.join(dbDir, 'backups');

      // Ensure backup directory exists
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      // Copy DB file
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(backupDir, `signalsense_${timestamp}.db`);

      if (fs.existsSync(dbPath)) {
        fs.copyFileSync(dbPath, backupPath);
        console.log(`[HealthManager] Database backed up to: ${backupPath}`);
      }

      // Export CSV training data alongside
      const csvData = this.storage.exportTrainingDataAsCSV();
      if (csvData) {
        const csvPath = path.join(backupDir, `training_data_${timestamp}.csv`);
        fs.writeFileSync(csvPath, csvData);
        console.log(`[HealthManager] Training CSV exported to: ${csvPath}`);
      }

      // Keep only last N backups
      const backupFiles = fs.readdirSync(backupDir)
        .filter(f => f.startsWith('signalsense_') && f.endsWith('.db'))
        .sort()
        .reverse();

      if (backupFiles.length > config.health.maxBackups) {
        const toDelete = backupFiles.slice(config.health.maxBackups);
        for (const file of toDelete) {
          fs.unlinkSync(path.join(backupDir, file));
          // Also delete matching CSV
          const csvFile = file.replace('signalsense_', 'training_data_').replace('.db', '.csv');
          const csvFullPath = path.join(backupDir, csvFile);
          if (fs.existsSync(csvFullPath)) {
            fs.unlinkSync(csvFullPath);
          }
        }
        console.log(`[HealthManager] Cleaned ${toDelete.length} old backups (keeping ${config.health.maxBackups})`);
      }

      return {
        backedUp: true,
        backupPath,
        backupCount: Math.min(backupFiles.length, config.health.maxBackups),
      };
    } catch (error) {
      console.error('[HealthManager] Backup error:', error);
      return { backedUp: false };
    }
  }

  // === NEW: Telegram health alerts ===
  private sendHealthAlerts(report: HealthReport): void {
    if (!this.telegram || !this.telegram.isEnabled()) return;

    const issues: string[] = [];

    if (report.memory.warning) {
      issues.push(`Memory: ${report.memory.heapUsedMB.toFixed(0)}MB (${report.memory.percentUsed.toFixed(0)}%)`);
    }

    if (report.websocket.status !== 'connected') {
      issues.push(`WebSocket: ${report.websocket.status}`);
    }

    if (report.websocket.watchdogTriggered) {
      issues.push('WS Watchdog triggered - forced reconnect');
    }

    const missingIntervals = Object.entries(report.intervals)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missingIntervals.length > 0) {
      issues.push(`Missing intervals: ${missingIntervals.join(', ')}`);
    }

    if (issues.length > 0) {
      const message = issues.map(i => `- ${i}`).join('\n');
      this.telegram.sendHealthWarning(message);
    }
  }
}

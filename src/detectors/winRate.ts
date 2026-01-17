import { DataStore } from '../core/dataStore.js';
import { StorageManager, SignalFeatures, MLPrediction } from '../storage/sqlite.js';

export interface SignalRecord {
  id: string;
  symbol: string;
  entryType: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  confidence: number;
  timestamp: number;
  outcome?: 'WIN' | 'LOSS' | 'PENDING';
  exitPrice?: number;
  pnlPercent?: number;
  features?: SignalFeatures; // ML features
  mlPrediction?: MLPrediction; // ML prediction result
}

export interface WinRateStats {
  totalSignals: number;
  wins: number;
  losses: number;
  pending: number;
  winRate: number;
  avgWinPercent: number;
  avgLossPercent: number;
  profitFactor: number;
}

export interface OverallStats extends WinRateStats {
  byType: Record<string, WinRateStats>;
  recentPerformance: number; // Last 20 signals win rate
}

export class WinRateTracker {
  private signals: Map<string, SignalRecord> = new Map();
  private completedSignals: SignalRecord[] = [];
  private maxStoredSignals: number = 500;
  private evaluationTimeMs: number = 15 * 60 * 1000; // 15 minutes
  private storageManager: StorageManager | null = null;

  constructor(
    private dataStore: DataStore,
    private dbPath?: string
  ) {
    // Load historical data if available
    this.loadFromStorage();
  }

  // Set storage manager for persistence (called after StorageManager is initialized)
  setStorageManager(storageManager: StorageManager): void {
    this.storageManager = storageManager;
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    // Load pending signals count for stats (actual data stays in SQLite)
    if (this.storageManager) {
      const counts = this.storageManager.getSignalFeaturesCount();
      console.log(`[WinRateTracker] Loaded from storage: ${counts.completed} completed, ${counts.pending} pending signals`);
    }
  }

  private saveToStorage(): void {
    // No-op: we save immediately when recording/updating signals
  }

  private generateId(): string {
    return `sig_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  recordSignal(
    symbol: string,
    entryType: string,
    direction: 'LONG' | 'SHORT',
    entryPrice: number,
    confidence: number,
    features?: SignalFeatures,
    mlPrediction?: MLPrediction
  ): string {
    const id = this.generateId();
    const record: SignalRecord = {
      id,
      symbol,
      entryType,
      direction,
      entryPrice,
      confidence,
      timestamp: Date.now(),
      outcome: 'PENDING',
      features,
      mlPrediction,
    };

    this.signals.set(id, record);

    // Persist features to SQLite if available
    if (this.storageManager && features) {
      // Update the signal_id in features to match
      const featuresWithId = { ...features, signal_id: id };
      this.storageManager.saveSignalFeatures(featuresWithId);

      // Also save ML prediction if available
      if (mlPrediction) {
        this.storageManager.updateSignalMLPrediction(id, mlPrediction);
      }
    }

    return id;
  }

  // Record signal with pre-generated ID (useful when features are extracted beforehand)
  recordSignalWithId(
    id: string,
    symbol: string,
    entryType: string,
    direction: 'LONG' | 'SHORT',
    entryPrice: number,
    confidence: number,
    features?: SignalFeatures,
    mlPrediction?: MLPrediction
  ): void {
    const record: SignalRecord = {
      id,
      symbol,
      entryType,
      direction,
      entryPrice,
      confidence,
      timestamp: Date.now(),
      outcome: 'PENDING',
      features,
      mlPrediction,
    };

    this.signals.set(id, record);

    // Features should already be saved by caller, but save ML prediction
    if (this.storageManager && mlPrediction) {
      this.storageManager.updateSignalMLPrediction(id, mlPrediction);
    }
  }

  // Update ML prediction for an existing signal
  updateMLPrediction(signalId: string, prediction: MLPrediction): void {
    const signal = this.signals.get(signalId);
    if (signal) {
      signal.mlPrediction = prediction;
    }

    if (this.storageManager) {
      this.storageManager.updateSignalMLPrediction(signalId, prediction);
    }
  }

  evaluatePendingSignals(): void {
    const now = Date.now();

    for (const [id, signal] of this.signals) {
      if (signal.outcome !== 'PENDING') continue;
      if (now - signal.timestamp < this.evaluationTimeMs) continue;

      // Get current price
      const symbolData = this.dataStore.getSymbol(signal.symbol);
      if (!symbolData) continue;

      const currentPrice = symbolData.current.lastPrice;
      const pnlPercent = signal.direction === 'LONG'
        ? ((currentPrice - signal.entryPrice) / signal.entryPrice) * 100
        : ((signal.entryPrice - currentPrice) / signal.entryPrice) * 100;

      // Determine outcome: > 0.5% profit = WIN, < -0.5% = LOSS, otherwise neutral
      let outcome: 'WIN' | 'LOSS';
      if (pnlPercent > 0.5) {
        outcome = 'WIN';
      } else if (pnlPercent < -0.5) {
        outcome = 'LOSS';
      } else {
        // Small move, count as win if in right direction
        outcome = pnlPercent >= 0 ? 'WIN' : 'LOSS';
      }

      signal.outcome = outcome;
      signal.exitPrice = currentPrice;
      signal.pnlPercent = pnlPercent;

      // Persist outcome to SQLite
      if (this.storageManager) {
        this.storageManager.updateSignalOutcome(id, outcome, pnlPercent);
      }

      // Move to completed
      this.completedSignals.push(signal);
      this.signals.delete(id);

      // Trim old signals
      if (this.completedSignals.length > this.maxStoredSignals) {
        this.completedSignals = this.completedSignals.slice(-this.maxStoredSignals);
      }
    }

    this.saveToStorage();
  }

  // Get feature counts from storage (for ML training readiness)
  getFeatureCounts(): { total: number; completed: number; wins: number; losses: number; pending: number } {
    if (this.storageManager) {
      return this.storageManager.getSignalFeaturesCount();
    }
    return { total: 0, completed: 0, wins: 0, losses: 0, pending: 0 };
  }

  // Check if we have enough data for ML training
  hasEnoughDataForTraining(minSignals: number = 500): boolean {
    const counts = this.getFeatureCounts();
    return counts.completed >= minSignals;
  }

  // Get training data from storage
  getTrainingData(limit: number = 5000): SignalFeatures[] {
    if (this.storageManager) {
      return this.storageManager.getCompletedSignalsForTraining(limit);
    }
    return [];
  }

  // Export training data as CSV for external analysis
  exportTrainingDataCSV(): string {
    if (this.storageManager) {
      return this.storageManager.exportTrainingDataAsCSV();
    }
    return '';
  }

  // Get ML accuracy stats from storage
  getMLAccuracyStats(): { predicted: number; actual: number; modelCount: number } {
    if (this.storageManager) {
      return this.storageManager.getMLAccuracyStats();
    }
    return { predicted: 0, actual: 0, modelCount: 0 };
  }

  private calculateStats(signals: SignalRecord[]): WinRateStats {
    const completed = signals.filter(s => s.outcome !== 'PENDING');
    const wins = completed.filter(s => s.outcome === 'WIN');
    const losses = completed.filter(s => s.outcome === 'LOSS');
    const pending = signals.filter(s => s.outcome === 'PENDING');

    const avgWinPercent = wins.length > 0
      ? wins.reduce((sum, s) => sum + (s.pnlPercent || 0), 0) / wins.length
      : 0;

    const avgLossPercent = losses.length > 0
      ? Math.abs(losses.reduce((sum, s) => sum + (s.pnlPercent || 0), 0) / losses.length)
      : 0;

    const totalWins = wins.reduce((sum, s) => sum + Math.abs(s.pnlPercent || 0), 0);
    const totalLosses = losses.reduce((sum, s) => sum + Math.abs(s.pnlPercent || 0), 0);

    return {
      totalSignals: completed.length,
      wins: wins.length,
      losses: losses.length,
      pending: pending.length,
      winRate: completed.length > 0 ? (wins.length / completed.length) * 100 : 0,
      avgWinPercent,
      avgLossPercent,
      profitFactor: totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0,
    };
  }

  getOverallStats(): OverallStats {
    const allSignals = [...this.completedSignals, ...Array.from(this.signals.values())];
    const baseStats = this.calculateStats(allSignals);

    // Group by entry type
    const byType: Record<string, WinRateStats> = {};
    const typeGroups = new Map<string, SignalRecord[]>();

    for (const signal of allSignals) {
      const type = signal.entryType;
      if (!typeGroups.has(type)) {
        typeGroups.set(type, []);
      }
      typeGroups.get(type)!.push(signal);
    }

    for (const [type, signals] of typeGroups) {
      byType[type] = this.calculateStats(signals);
    }

    // Recent performance (last 20 completed signals)
    const recentCompleted = this.completedSignals.slice(-20);
    const recentWins = recentCompleted.filter(s => s.outcome === 'WIN').length;
    const recentPerformance = recentCompleted.length > 0
      ? (recentWins / recentCompleted.length) * 100
      : 0;

    return {
      ...baseStats,
      byType,
      recentPerformance,
    };
  }

  getStatsByType(entryType: string): WinRateStats {
    const allSignals = [...this.completedSignals, ...Array.from(this.signals.values())];
    const typeSignals = allSignals.filter(s => s.entryType === entryType);
    return this.calculateStats(typeSignals);
  }

  getStatsBySymbol(symbol: string): WinRateStats {
    const allSignals = [...this.completedSignals, ...Array.from(this.signals.values())];
    const symbolSignals = allSignals.filter(s => s.symbol === symbol);
    return this.calculateStats(symbolSignals);
  }

  getRecentSignals(limit: number = 20): SignalRecord[] {
    return this.completedSignals.slice(-limit).reverse();
  }

  getPendingSignals(): SignalRecord[] {
    return Array.from(this.signals.values());
  }

  getSignalById(id: string): SignalRecord | undefined {
    return this.signals.get(id) || this.completedSignals.find(s => s.id === id);
  }
}

import { DataStore } from '../core/dataStore.js';

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

  constructor(
    private dataStore: DataStore,
    private dbPath?: string
  ) {
    // Load historical data if available
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    // In-memory only for now, could add SQLite later
  }

  private saveToStorage(): void {
    // In-memory only for now
  }

  private generateId(): string {
    return `sig_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  recordSignal(
    symbol: string,
    entryType: string,
    direction: 'LONG' | 'SHORT',
    entryPrice: number,
    confidence: number
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
    };

    this.signals.set(id, record);
    return id;
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

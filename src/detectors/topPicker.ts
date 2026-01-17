import { DataStore } from '../core/dataStore.js';
import { FundingDetector } from './funding.js';
import { OpenInterestDetector } from './openInterest.js';
import { SmartSignalEngine } from './smartSignal.js';
import { PatternDetector } from './pattern.js';
import { EntryTimingCalculator } from './entryTiming.js';
import { CorrelationDetector } from './correlation.js';
import { WhaleDetector } from './whale.js';

export interface TopPick {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  score: number;                    // 0-100 composite score
  confidence: number;               // Signal confidence

  // Funding analysis
  fundingRate: number;              // Current funding rate
  fundingDirection: 'EARN' | 'PAY'; // Does this trade earn or pay funding?
  fundingScore: number;             // How favorable is funding (0-100)
  estimatedFundingPnl: string;      // e.g., "+0.01%" every 8h

  // Price data
  price: number;
  change1h: number;
  change24h: number;

  // Technical analysis
  entryType: string;
  momentum: 'STRONG' | 'MODERATE' | 'WEAK';
  volumeProfile: 'HIGH' | 'NORMAL' | 'LOW';

  // Risk management
  suggestedLeverage: number;
  stopLoss: number;
  takeProfit: number;
  riskRewardRatio: number;

  // Reasoning
  reasons: string[];
  urgency: 'NOW' | 'WAIT' | 'WATCH';  // Trade timing recommendation

  timestamp: number;
}

export class TopPicker {
  private lastUpdate: number = 0;
  private updateIntervalMs: number = 5000; // Update every 5 seconds for fast trading
  private cachedPicks: { longs: TopPick[]; shorts: TopPick[] } = { longs: [], shorts: [] };

  constructor(
    private dataStore: DataStore,
    private fundingDetector: FundingDetector,
    private oiDetector: OpenInterestDetector,
    private smartSignalEngine: SmartSignalEngine,
    private patternDetector: PatternDetector,
    private entryCalculator: EntryTimingCalculator,
    private correlationDetector: CorrelationDetector,
    private whaleDetector: WhaleDetector
  ) {}

  analyze(): { longs: TopPick[]; shorts: TopPick[] } {
    const now = Date.now();
    if (now - this.lastUpdate < this.updateIntervalMs) {
      return this.cachedPicks;
    }

    const symbols = this.dataStore.getAllSymbols()
      .filter(s => s.current.quoteVolume > 10000000) // Min $10M volume for liquidity
      .slice(0, 100); // Top 100 by volume

    const longCandidates: TopPick[] = [];
    const shortCandidates: TopPick[] = [];

    for (const symbolData of symbols) {
      const { symbol, current, priceHistory } = symbolData;

      // Skip stablecoins
      if (symbol.includes('USDC') || symbol.includes('BUSD') || symbol.includes('TUSD')) continue;

      // Get funding data
      const fundingData = this.fundingDetector.getSymbol(symbol);
      const fundingRate = fundingData?.fundingRate || 0;

      // Get smart signals
      const smartSignals = this.smartSignalEngine.getTopSignals(50, 'LONG');
      const smartSignal = smartSignals.find(s => s.symbol === symbol);
      const smartShortSignals = this.smartSignalEngine.getTopSignals(50, 'SHORT');
      const smartShortSignal = smartShortSignals.find(s => s.symbol === symbol);

      // Get entry timing data
      const entryData = this.entryCalculator.getSymbol(symbol);

      // Get pattern data
      const patterns = this.patternDetector.getTopPatterns(100);
      const symbolPattern = patterns.find(p => p.symbol === symbol);

      // Get whale activity
      const whaleAlerts = this.whaleDetector.getTopWhaleActivity(50);
      const whaleAlert = whaleAlerts.find(w => w.symbol === symbol);

      // Get correlation data
      const correlations = this.correlationDetector.getTopAlerts(50);
      const corrAlert = correlations.find(c => c.symbol === symbol);

      // Calculate 1h change from price history
      const change1h = this.calculate1hChange(priceHistory);

      // Analyze for LONG
      const longPick = this.analyzeLongOpportunity(
        symbol, current, fundingRate, smartSignal, entryData,
        symbolPattern, whaleAlert, corrAlert, change1h
      );
      if (longPick && longPick.score >= 50) {
        longCandidates.push(longPick);
      }

      // Analyze for SHORT
      const shortPick = this.analyzeShortOpportunity(
        symbol, current, fundingRate, smartShortSignal, entryData,
        symbolPattern, whaleAlert, corrAlert, change1h
      );
      if (shortPick && shortPick.score >= 50) {
        shortCandidates.push(shortPick);
      }
    }

    // Sort by score and take top 5
    const longs = longCandidates
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const shorts = shortCandidates
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    this.cachedPicks = { longs, shorts };
    this.lastUpdate = now;

    return { longs, shorts };
  }

  private calculate1hChange(priceHistory: { price: number; timestamp: number }[]): number {
    if (priceHistory.length < 2) return 0;

    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;

    // Find price closest to 1 hour ago
    let oldPrice = priceHistory[0].price;
    for (const point of priceHistory) {
      if (point.timestamp >= oneHourAgo) {
        break;
      }
      oldPrice = point.price;
    }

    const currentPrice = priceHistory[priceHistory.length - 1].price;
    return ((currentPrice - oldPrice) / oldPrice) * 100;
  }

  private analyzeLongOpportunity(
    symbol: string,
    current: any,
    fundingRate: number,
    smartSignal: any,
    entryData: any,
    pattern: any,
    whaleAlert: any,
    corrAlert: any,
    change1h: number
  ): TopPick | null {
    let score = 0;
    const reasons: string[] = [];

    // === FUNDING ANALYSIS (25 points max) ===
    // For LONGS: negative funding = we get paid, positive = we pay
    let fundingScore = 50; // neutral
    let fundingDirection: 'EARN' | 'PAY' = 'PAY';

    if (fundingRate < 0) {
      // Negative funding = longs earn funding
      fundingDirection = 'EARN';
      fundingScore = Math.min(100, 50 + Math.abs(fundingRate) * 5000);
      score += Math.min(25, Math.abs(fundingRate) * 2500);
      reasons.push(`Earn ${Math.abs(fundingRate * 100).toFixed(4)}% funding every 8h`);
    } else if (fundingRate > 0.0005) {
      // High positive funding = expensive to hold longs
      fundingScore = Math.max(0, 50 - fundingRate * 5000);
      score -= Math.min(10, fundingRate * 1000);
    }

    // === TECHNICAL SIGNALS (35 points max) ===
    if (smartSignal) {
      const signalScore = smartSignal.confidence * 0.35;
      score += signalScore;
      reasons.push(`Smart signal: ${smartSignal.confidence.toFixed(0)}% confidence`);
    }

    // === MOMENTUM (15 points max) ===
    let momentum: 'STRONG' | 'MODERATE' | 'WEAK' = 'WEAK';
    if (current.priceChangePercent > 5 && change1h > 1) {
      momentum = 'STRONG';
      score += 15;
      reasons.push('Strong bullish momentum');
    } else if (current.priceChangePercent > 2 || change1h > 0.5) {
      momentum = 'MODERATE';
      score += 8;
      reasons.push('Moderate bullish momentum');
    } else if (current.priceChangePercent > 0) {
      score += 3;
    }

    // === VOLUME PROFILE (10 points max) ===
    let volumeProfile: 'HIGH' | 'NORMAL' | 'LOW' = 'NORMAL';
    if (current.quoteVolume > 100000000) {
      volumeProfile = 'HIGH';
      score += 10;
      reasons.push('High volume liquidity');
    } else if (current.quoteVolume > 30000000) {
      score += 5;
    } else {
      volumeProfile = 'LOW';
    }

    // === PATTERN RECOGNITION (10 points max) ===
    if (pattern && pattern.direction === 'BULLISH') {
      score += Math.min(10, pattern.confidence * 0.1);
      reasons.push(`${pattern.pattern.replace(/_/g, ' ')}`);
    }

    // === WHALE ACTIVITY (5 points max) ===
    if (whaleAlert && whaleAlert.direction === 'BULLISH') {
      score += 5;
      reasons.push('Whale accumulation detected');
    }

    // === BTC CORRELATION BONUS ===
    if (corrAlert && corrAlert.outperformance > 5) {
      score += 5;
      reasons.push('Outperforming BTC');
    }

    // Minimum threshold
    if (score < 50) return null;

    // Calculate entry levels
    const price = current.lastPrice;
    const atr = entryData?.atr || price * 0.02;
    const stopLoss = price - (atr * 1.5);
    const takeProfit = price + (atr * 2.5);
    const riskRewardRatio = (takeProfit - price) / (price - stopLoss);

    // Suggested leverage based on confidence
    const suggestedLeverage = score >= 80 ? 10 : score >= 70 ? 7 : score >= 60 ? 5 : 3;

    // Determine urgency
    let urgency: 'NOW' | 'WAIT' | 'WATCH' = 'WATCH';
    if (score >= 75 && fundingDirection === 'EARN') urgency = 'NOW';
    else if (score >= 65) urgency = 'WAIT';

    return {
      symbol,
      direction: 'LONG',
      score: Math.round(score),
      confidence: smartSignal?.confidence || 50,
      fundingRate,
      fundingDirection,
      fundingScore: Math.round(fundingScore),
      estimatedFundingPnl: fundingDirection === 'EARN'
        ? `+${Math.abs(fundingRate * 100).toFixed(4)}%`
        : `-${Math.abs(fundingRate * 100).toFixed(4)}%`,
      price,
      change1h: Math.round(change1h * 100) / 100,
      change24h: Math.round(current.priceChangePercent * 100) / 100,
      entryType: smartSignal?.entryType || entryData?.entryType || 'MOMENTUM',
      momentum,
      volumeProfile,
      suggestedLeverage,
      stopLoss,
      takeProfit,
      riskRewardRatio: Math.round(riskRewardRatio * 100) / 100,
      reasons,
      urgency,
      timestamp: Date.now(),
    };
  }

  private analyzeShortOpportunity(
    symbol: string,
    current: any,
    fundingRate: number,
    smartSignal: any,
    entryData: any,
    pattern: any,
    whaleAlert: any,
    corrAlert: any,
    change1h: number
  ): TopPick | null {
    let score = 0;
    const reasons: string[] = [];

    // === FUNDING ANALYSIS (25 points max) ===
    // For SHORTS: positive funding = we get paid, negative = we pay
    let fundingScore = 50;
    let fundingDirection: 'EARN' | 'PAY' = 'PAY';

    if (fundingRate > 0) {
      // Positive funding = shorts earn funding
      fundingDirection = 'EARN';
      fundingScore = Math.min(100, 50 + fundingRate * 5000);
      score += Math.min(25, fundingRate * 2500);
      reasons.push(`Earn ${(fundingRate * 100).toFixed(4)}% funding every 8h`);
    } else if (fundingRate < -0.0005) {
      // High negative funding = expensive to hold shorts
      fundingScore = Math.max(0, 50 + fundingRate * 5000);
      score -= Math.min(10, Math.abs(fundingRate) * 1000);
    }

    // === TECHNICAL SIGNALS (35 points max) ===
    if (smartSignal && smartSignal.direction === 'SHORT') {
      const signalScore = smartSignal.confidence * 0.35;
      score += signalScore;
      reasons.push(`Smart signal: ${smartSignal.confidence.toFixed(0)}% confidence`);
    }

    // === MOMENTUM (15 points max) ===
    let momentum: 'STRONG' | 'MODERATE' | 'WEAK' = 'WEAK';
    if (current.priceChangePercent < -5 && change1h < -1) {
      momentum = 'STRONG';
      score += 15;
      reasons.push('Strong bearish momentum');
    } else if (current.priceChangePercent < -2 || change1h < -0.5) {
      momentum = 'MODERATE';
      score += 8;
      reasons.push('Moderate bearish momentum');
    } else if (current.priceChangePercent < 0) {
      score += 3;
    }

    // === OVERBOUGHT / REVERSAL DETECTION ===
    // High positive change might indicate reversal opportunity
    if (current.priceChangePercent > 15) {
      score += 10;
      reasons.push('Potential overbought reversal');
    }

    // === VOLUME PROFILE (10 points max) ===
    let volumeProfile: 'HIGH' | 'NORMAL' | 'LOW' = 'NORMAL';
    if (current.quoteVolume > 100000000) {
      volumeProfile = 'HIGH';
      score += 10;
      reasons.push('High volume liquidity');
    } else if (current.quoteVolume > 30000000) {
      score += 5;
    } else {
      volumeProfile = 'LOW';
    }

    // === PATTERN RECOGNITION (10 points max) ===
    if (pattern && pattern.direction === 'BEARISH') {
      score += Math.min(10, pattern.confidence * 0.1);
      reasons.push(`${pattern.pattern.replace(/_/g, ' ')}`);
    }

    // === WHALE ACTIVITY (5 points max) ===
    if (whaleAlert && whaleAlert.direction === 'BEARISH') {
      score += 5;
      reasons.push('Whale distribution detected');
    }

    // === BTC CORRELATION BONUS ===
    if (corrAlert && corrAlert.outperformance < -5) {
      score += 5;
      reasons.push('Underperforming BTC');
    }

    // Minimum threshold
    if (score < 50) return null;

    // Calculate entry levels
    const price = current.lastPrice;
    const atr = entryData?.atr || price * 0.02;
    const stopLoss = price + (atr * 1.5);
    const takeProfit = price - (atr * 2.5);
    const riskRewardRatio = (price - takeProfit) / (stopLoss - price);

    // Suggested leverage based on confidence
    const suggestedLeverage = score >= 80 ? 10 : score >= 70 ? 7 : score >= 60 ? 5 : 3;

    // Determine urgency
    let urgency: 'NOW' | 'WAIT' | 'WATCH' = 'WATCH';
    if (score >= 75 && fundingDirection === 'EARN') urgency = 'NOW';
    else if (score >= 65) urgency = 'WAIT';

    return {
      symbol,
      direction: 'SHORT',
      score: Math.round(score),
      confidence: smartSignal?.confidence || 50,
      fundingRate,
      fundingDirection,
      fundingScore: Math.round(fundingScore),
      estimatedFundingPnl: fundingDirection === 'EARN'
        ? `+${Math.abs(fundingRate * 100).toFixed(4)}%`
        : `-${Math.abs(fundingRate * 100).toFixed(4)}%`,
      price,
      change1h: Math.round(change1h * 100) / 100,
      change24h: Math.round(current.priceChangePercent * 100) / 100,
      entryType: smartSignal?.entryType || entryData?.entryType || 'MOMENTUM',
      momentum,
      volumeProfile,
      suggestedLeverage,
      stopLoss,
      takeProfit,
      riskRewardRatio: Math.round(riskRewardRatio * 100) / 100,
      reasons,
      urgency,
      timestamp: Date.now(),
    };
  }

  getTopLongs(limit: number = 5): TopPick[] {
    return this.analyze().longs.slice(0, limit);
  }

  getTopShorts(limit: number = 5): TopPick[] {
    return this.analyze().shorts.slice(0, limit);
  }

  getAllPicks(): { longs: TopPick[]; shorts: TopPick[] } {
    return this.analyze();
  }
}

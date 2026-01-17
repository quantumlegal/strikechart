import { DataStore } from '../core/dataStore.js';
import { FundingDetector, FundingAlert } from './funding.js';
import { OpenInterestDetector, OIAlert } from './openInterest.js';
import { MultiTimeframeDetector, MTFAlert } from './multiTimeframe.js';
import { VolatilityDetector } from './volatility.js';
import { VolumeDetector } from './volume.js';
import { VelocityDetector } from './velocity.js';
import { MLPrediction } from '../storage/sqlite.js';

export interface SmartSignal {
  symbol: string;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  confidence: number; // 0-100 (rule-based)
  confluenceScore: number; // 0-100
  signals: SignalComponent[];
  reasoning: string[];
  entryType: 'EARLY' | 'MOMENTUM' | 'REVERSAL' | 'BREAKOUT';
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  price: number;
  timestamp: number;

  // ML Enhancement fields
  mlPrediction?: MLPrediction;
  combinedConfidence?: number; // ML + rule-based combined
  mlEnhanced?: boolean;
  qualityTier?: 'HIGH' | 'MEDIUM' | 'LOW' | 'FILTER';
}

export interface SignalComponent {
  name: string;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  strength: number; // 0-100
  weight: number;
}

export interface ReversalSignal {
  symbol: string;
  type: 'BULLISH_REVERSAL' | 'BEARISH_REVERSAL';
  confidence: number;
  triggers: string[];
  price: number;
  potentialTarget: number;
  stopLoss: number;
}

export class SmartSignalEngine {
  private dataStore: DataStore;
  private fundingDetector: FundingDetector;
  private oiDetector: OpenInterestDetector;
  private mtfDetector: MultiTimeframeDetector;
  private volatilityDetector: VolatilityDetector;
  private volumeDetector: VolumeDetector;
  private velocityDetector: VelocityDetector;

  private smartSignals: Map<string, SmartSignal> = new Map();
  private reversalSignals: Map<string, ReversalSignal> = new Map();

  // Historical data for divergence detection
  private priceHistory: Map<string, number[]> = new Map();
  private rsiHistory: Map<string, number[]> = new Map();

  // ML integration
  private mlClient: any = null; // MLServiceClient
  private featureExtractor: any = null; // FeatureExtractor
  private mlEnabled: boolean = false;
  private mlWeight: number = 0.6;
  private ruleWeight: number = 0.4;
  private filterThreshold: number = 0.40;

  constructor(
    dataStore: DataStore,
    fundingDetector: FundingDetector,
    oiDetector: OpenInterestDetector,
    mtfDetector: MultiTimeframeDetector,
    volatilityDetector: VolatilityDetector,
    volumeDetector: VolumeDetector,
    velocityDetector: VelocityDetector
  ) {
    this.dataStore = dataStore;
    this.fundingDetector = fundingDetector;
    this.oiDetector = oiDetector;
    this.mtfDetector = mtfDetector;
    this.volatilityDetector = volatilityDetector;
    this.volumeDetector = volumeDetector;
    this.velocityDetector = velocityDetector;
  }

  // Set ML client for ML-enhanced signals
  setMLClient(mlClient: any, featureExtractor: any, config: { mlWeight: number; ruleWeight: number; filterThreshold: number }): void {
    this.mlClient = mlClient;
    this.featureExtractor = featureExtractor;
    this.mlWeight = config.mlWeight;
    this.ruleWeight = config.ruleWeight;
    this.filterThreshold = config.filterThreshold;
    this.mlEnabled = true;
    console.log('[SmartSignalEngine] ML integration enabled');
  }

  // Calculate combined confidence from ML and rule-based scores
  calculateCombinedConfidence(mlWinProb: number, ruleConfidence: number): number {
    const mlScore = mlWinProb * 100;
    let combined = (mlScore * this.mlWeight) + (ruleConfidence * this.ruleWeight);

    // Boost if both agree strongly
    if ((mlScore > 60 && ruleConfidence > 60) || (mlScore < 40 && ruleConfidence < 40)) {
      combined *= 1.1;
    }

    // Penalty if they disagree significantly
    if (Math.abs(mlScore - ruleConfidence) > 30) {
      combined *= 0.9;
    }

    return Math.min(100, Math.max(0, combined));
  }

  // Enhance signal with ML prediction
  async enhanceWithML(signal: SmartSignal): Promise<SmartSignal> {
    if (!this.mlEnabled || !this.mlClient || !this.featureExtractor) {
      return signal;
    }

    try {
      // Check if ML service is available
      const isAvailable = await this.mlClient.checkHealth();
      if (!isAvailable) {
        return signal;
      }

      // Generate a signal ID for this prediction
      const signalId = `sig_${Date.now()}_${signal.symbol}`;

      // Extract features
      const features = this.featureExtractor.extractFeatures(signal, signalId);

      // Get ML prediction
      const prediction = await this.mlClient.predict(features);
      if (!prediction) {
        return signal;
      }

      // Calculate combined confidence
      const combinedConfidence = this.calculateCombinedConfidence(
        prediction.win_probability,
        signal.confidence
      );

      // Enhance signal with ML data
      return {
        ...signal,
        mlPrediction: prediction,
        combinedConfidence,
        mlEnhanced: true,
        qualityTier: prediction.quality_tier,
      };
    } catch (error) {
      console.warn('[SmartSignalEngine] ML enhancement failed:', error);
      return signal;
    }
  }

  async analyze(): Promise<void> {
    const symbolsData = this.dataStore.getAllSymbols();

    for (const symbolData of symbolsData) {
      const symbol = symbolData.symbol;
      const signal = await this.analyzeSymbol(symbol);
      if (signal && signal.confidence >= 40) {
        this.smartSignals.set(symbol, signal);
      }

      const reversal = await this.detectReversal(symbol);
      if (reversal && reversal.confidence >= 30) {
        this.reversalSignals.set(symbol, reversal);
      }
    }
  }

  private async analyzeSymbol(symbol: string): Promise<SmartSignal | null> {
    const symbolData = this.dataStore.getSymbol(symbol);
    if (!symbolData) return null;
    const ticker = symbolData.current;

    const signals: SignalComponent[] = [];
    const reasoning: string[] = [];

    // 1. Price Movement Signal (weight: 20)
    const priceSignal = this.analyzePriceMovement(symbol);
    if (priceSignal) {
      signals.push(priceSignal);
      if (priceSignal.strength > 50) {
        reasoning.push(`Price ${priceSignal.direction === 'BULLISH' ? 'up' : 'down'} ${ticker.priceChangePercent.toFixed(1)}% in 24h`);
      }
    }

    // 2. Volume Signal (weight: 15)
    const volumeSignal = this.analyzeVolume(symbol);
    if (volumeSignal) {
      signals.push(volumeSignal);
      if (volumeSignal.strength > 60) {
        reasoning.push(`Volume spike detected (${volumeSignal.strength.toFixed(0)}% above average)`);
      }
    }

    // 3. Velocity/Momentum Signal (weight: 20)
    const velocitySignal = this.analyzeVelocity(symbol);
    if (velocitySignal) {
      signals.push(velocitySignal);
      if (velocitySignal.strength > 50) {
        reasoning.push(`Strong momentum: ${velocitySignal.direction === 'BULLISH' ? 'accelerating up' : 'accelerating down'}`);
      }
    }

    // 4. Funding Rate Signal (weight: 15)
    const fundingSignal = this.analyzeFunding(symbol);
    if (fundingSignal) {
      signals.push(fundingSignal);
      if (fundingSignal.strength > 60) {
        reasoning.push(`Funding ${fundingSignal.direction === 'BULLISH' ? 'negative (shorts paying)' : 'high positive (longs paying)'}`);
      }
    }

    // 5. Open Interest Signal (weight: 10)
    const oiSignal = this.analyzeOpenInterest(symbol);
    if (oiSignal) {
      signals.push(oiSignal);
      if (oiSignal.strength > 50) {
        reasoning.push(`OI ${oiSignal.direction === 'BULLISH' ? 'building with price' : 'diverging from price'}`);
      }
    }

    // 6. Multi-Timeframe Signal (weight: 20)
    const mtfSignal = this.analyzeMTF(symbol);
    if (mtfSignal) {
      signals.push(mtfSignal);
      if (mtfSignal.strength > 60) {
        reasoning.push(`${mtfSignal.direction} alignment across timeframes`);
      }
    }

    if (signals.length === 0) return null;

    // Calculate confluence score
    const { direction, confluenceScore, confidence } = this.calculateConfluence(signals);

    // Determine entry type
    const entryType = this.determineEntryType(signals, symbol);

    // Determine risk level
    const riskLevel = this.calculateRiskLevel(confluenceScore, signals);

    return {
      symbol,
      direction,
      confidence,
      confluenceScore,
      signals,
      reasoning,
      entryType,
      riskLevel,
      price: ticker.lastPrice,
      timestamp: Date.now(),
    };
  }

  private analyzePriceMovement(symbol: string): SignalComponent | null {
    const ticker = this.dataStore.getSymbol(symbol)?.current;
    if (!ticker) return null;

    const change = ticker.priceChangePercent;
    const absChange = Math.abs(change);

    // Scale: 5% = 50 strength, 10% = 75, 20%+ = 100
    const strength = Math.min(100, absChange * 5);

    return {
      name: 'Price Movement',
      direction: change > 0 ? 'BULLISH' : change < 0 ? 'BEARISH' : 'NEUTRAL',
      strength,
      weight: 20,
    };
  }

  private analyzeVolume(symbol: string): SignalComponent | null {
    const spikes = this.volumeDetector.getTopSpikes(100);
    const spike = spikes.find(s => s.symbol === symbol);

    if (!spike) {
      return {
        name: 'Volume',
        direction: 'NEUTRAL',
        strength: 30,
        weight: 15,
      };
    }

    // Volume ratio: 2x = 50, 3x = 70, 5x+ = 100
    const strength = Math.min(100, spike.multiplier * 20);
    const ticker = this.dataStore.getSymbol(symbol)?.current;

    return {
      name: 'Volume',
      direction: ticker && ticker.priceChangePercent > 0 ? 'BULLISH' : 'BEARISH',
      strength,
      weight: 15,
    };
  }

  private analyzeVelocity(symbol: string): SignalComponent | null {
    const velocities = this.velocityDetector.getTopVelocity(100);
    const velocity = velocities.find(v => v.symbol === symbol);

    if (!velocity) {
      return {
        name: 'Velocity',
        direction: 'NEUTRAL',
        strength: 20,
        weight: 20,
      };
    }

    // Velocity: 0.5%/min = 50, 1%/min = 75, 2%/min = 100
    const strength = Math.min(100, Math.abs(velocity.velocity) * 50);

    return {
      name: 'Velocity',
      direction: velocity.velocity > 0 ? 'BULLISH' : 'BEARISH',
      strength,
      weight: 20,
    };
  }

  private analyzeFunding(symbol: string): SignalComponent | null {
    const fundingAlert = this.fundingDetector.getSymbol(symbol);
    if (!fundingAlert) {
      return null;
    }

    const funding = fundingAlert.fundingRate;
    const absRate = Math.abs(funding);
    // Funding: 0.01% = 30, 0.05% = 60, 0.1%+ = 100
    const strength = Math.min(100, absRate * 1000);

    // Negative funding = bullish (shorts paying), positive = bearish (longs paying)
    // This is contrarian - extreme funding often leads to squeezes
    return {
      name: 'Funding Rate',
      direction: funding < -0.01 ? 'BULLISH' : funding > 0.05 ? 'BEARISH' : 'NEUTRAL',
      strength,
      weight: 15,
    };
  }

  private analyzeOpenInterest(symbol: string): SignalComponent | null {
    const oiData = this.oiDetector.getSymbol(symbol);
    if (!oiData) return null;

    const ticker = this.dataStore.getSymbol(symbol)?.current;
    if (!ticker) return null;

    const oiChange = oiData.oiChange;
    const priceChange = ticker.priceChangePercent;

    // OI increasing with price = strong trend
    // OI decreasing with price up = weak/ending trend
    let direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    let strength = Math.min(100, Math.abs(oiChange) * 10);

    if (oiChange > 2 && priceChange > 2) {
      direction = 'BULLISH';
      strength = Math.min(100, strength * 1.5);
    } else if (oiChange > 2 && priceChange < -2) {
      direction = 'BEARISH';
      strength = Math.min(100, strength * 1.5);
    } else if (oiChange < -2 && priceChange > 2) {
      // Divergence - potential reversal coming
      direction = 'BEARISH';
    } else if (oiChange < -2 && priceChange < -2) {
      // Shorts closing - potential bounce
      direction = 'BULLISH';
    }

    return {
      name: 'Open Interest',
      direction,
      strength,
      weight: 10,
    };
  }

  private analyzeMTF(symbol: string): SignalComponent | null {
    const mtfData = this.mtfDetector.getSymbol(symbol);
    if (!mtfData) return null;

    let strength = 50;
    let direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';

    switch (mtfData.alignment) {
      case 'STRONG_BULLISH':
        direction = 'BULLISH';
        strength = 100;
        break;
      case 'BULLISH':
        direction = 'BULLISH';
        strength = 75;
        break;
      case 'STRONG_BEARISH':
        direction = 'BEARISH';
        strength = 100;
        break;
      case 'BEARISH':
        direction = 'BEARISH';
        strength = 75;
        break;
      case 'MIXED':
        strength = 30;
        break;
    }

    // Boost for divergence (potential reversal)
    if (mtfData.divergence !== 'NONE') {
      strength = Math.min(100, strength + 20);
    }

    return {
      name: 'Multi-Timeframe',
      direction,
      strength,
      weight: 20,
    };
  }

  private calculateConfluence(signals: SignalComponent[]): {
    direction: 'LONG' | 'SHORT' | 'NEUTRAL';
    confluenceScore: number;
    confidence: number;
  } {
    let bullishScore = 0;
    let bearishScore = 0;
    let totalWeight = 0;

    for (const signal of signals) {
      totalWeight += signal.weight;
      const weightedStrength = (signal.strength / 100) * signal.weight;

      if (signal.direction === 'BULLISH') {
        bullishScore += weightedStrength;
      } else if (signal.direction === 'BEARISH') {
        bearishScore += weightedStrength;
      }
    }

    const maxScore = totalWeight;
    const netScore = bullishScore - bearishScore;
    const confluenceScore = Math.abs(netScore) / maxScore * 100;

    // Confidence based on confluence and number of aligned signals
    const alignedSignals = signals.filter(s =>
      (netScore > 0 && s.direction === 'BULLISH') ||
      (netScore < 0 && s.direction === 'BEARISH')
    ).length;

    const alignmentBonus = (alignedSignals / signals.length) * 20;
    const confidence = Math.min(100, confluenceScore + alignmentBonus);

    let direction: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
    if (netScore > 10) direction = 'LONG';
    else if (netScore < -10) direction = 'SHORT';

    return { direction, confluenceScore, confidence };
  }

  private determineEntryType(signals: SignalComponent[], symbol: string): 'EARLY' | 'MOMENTUM' | 'REVERSAL' | 'BREAKOUT' {
    const volumeSignal = signals.find(s => s.name === 'Volume');
    const velocitySignal = signals.find(s => s.name === 'Velocity');
    const mtfSignal = signals.find(s => s.name === 'Multi-Timeframe');
    const fundingSignal = signals.find(s => s.name === 'Funding Rate');

    // Check for reversal conditions
    const mtfData = this.mtfDetector.getSymbol(symbol);
    if (mtfData && mtfData.divergence !== 'NONE') {
      return 'REVERSAL';
    }

    if (fundingSignal && fundingSignal.strength > 70) {
      return 'REVERSAL'; // Extreme funding often leads to squeezes
    }

    // Early entry: Volume building but price hasn't moved much yet
    if (volumeSignal && volumeSignal.strength > 60 && velocitySignal && velocitySignal.strength < 40) {
      return 'EARLY';
    }

    // Breakout: Strong velocity with MTF alignment
    if (velocitySignal && velocitySignal.strength > 70 && mtfSignal && mtfSignal.strength > 60) {
      return 'BREAKOUT';
    }

    // Default to momentum
    return 'MOMENTUM';
  }

  private calculateRiskLevel(confluenceScore: number, signals: SignalComponent[]): 'LOW' | 'MEDIUM' | 'HIGH' {
    const alignedCount = signals.filter(s => s.strength > 50).length;

    if (confluenceScore > 70 && alignedCount >= 4) return 'LOW';
    if (confluenceScore > 50 && alignedCount >= 3) return 'MEDIUM';
    return 'HIGH';
  }

  private async detectReversal(symbol: string): Promise<ReversalSignal | null> {
    const ticker = this.dataStore.getSymbol(symbol)?.current;
    if (!ticker) return null;

    const triggers: string[] = [];
    let reversalType: 'BULLISH_REVERSAL' | 'BEARISH_REVERSAL' | null = null;
    let confidence = 0;

    // 1. RSI Divergence Check
    const mtfData = this.mtfDetector.getSymbol(symbol);
    if (mtfData) {
      if (mtfData.divergence === 'BULLISH_DIV') {
        triggers.push('RSI bullish divergence detected');
        reversalType = 'BULLISH_REVERSAL';
        confidence += 25;
      } else if (mtfData.divergence === 'BEARISH_DIV') {
        triggers.push('RSI bearish divergence detected');
        reversalType = 'BEARISH_REVERSAL';
        confidence += 25;
      }

      // RSI extreme
      if (mtfData.rsi1h < 25) {
        triggers.push(`RSI oversold at ${mtfData.rsi1h.toFixed(1)}`);
        if (!reversalType) reversalType = 'BULLISH_REVERSAL';
        confidence += 20;
      } else if (mtfData.rsi1h > 75) {
        triggers.push(`RSI overbought at ${mtfData.rsi1h.toFixed(1)}`);
        if (!reversalType) reversalType = 'BEARISH_REVERSAL';
        confidence += 20;
      }
    }

    // 2. Funding Rate Extreme (contrarian)
    const fundingData = this.fundingDetector.getSymbol(symbol);
    const funding = fundingData?.fundingRate ?? null;
    if (funding !== null) {
      if (funding > 0.1) {
        triggers.push(`Extreme positive funding: ${(funding * 100).toFixed(3)}%`);
        if (!reversalType) reversalType = 'BEARISH_REVERSAL';
        confidence += 20;
      } else if (funding < -0.05) {
        triggers.push(`Extreme negative funding: ${(funding * 100).toFixed(3)}%`);
        if (!reversalType) reversalType = 'BULLISH_REVERSAL';
        confidence += 20;
      }
    }

    // 3. OI Divergence
    const oiData = this.oiDetector.getSymbol(symbol);
    if (oiData && ticker) {
      const oiChange = oiData.oiChange;
      const priceChange = ticker.priceChangePercent;

      // Price up but OI down = weak rally, potential reversal down
      if (priceChange > 5 && oiChange < -3) {
        triggers.push('OI divergence: Price up but positions closing');
        if (!reversalType) reversalType = 'BEARISH_REVERSAL';
        confidence += 15;
      }
      // Price down but OI down = shorts closing, potential bounce
      else if (priceChange < -5 && oiChange < -3) {
        triggers.push('OI divergence: Shorts covering');
        if (!reversalType) reversalType = 'BULLISH_REVERSAL';
        confidence += 15;
      }
    }

    // 4. Volume Climax (high volume at extreme = exhaustion)
    const volumeSpikes = this.volumeDetector.getTopSpikes(50);
    const volumeSpike = volumeSpikes.find(v => v.symbol === symbol);
    if (volumeSpike && volumeSpike.multiplier > 4) {
      if (ticker.priceChangePercent > 15) {
        triggers.push('Volume climax at price high - potential exhaustion');
        if (!reversalType) reversalType = 'BEARISH_REVERSAL';
        confidence += 15;
      } else if (ticker.priceChangePercent < -15) {
        triggers.push('Volume climax at price low - potential capitulation');
        if (!reversalType) reversalType = 'BULLISH_REVERSAL';
        confidence += 15;
      }
    }

    if (!reversalType || triggers.length === 0) return null;

    // Calculate potential targets
    const range = ticker.highPrice - ticker.lowPrice;
    const potentialTarget = reversalType === 'BULLISH_REVERSAL'
      ? ticker.lastPrice + range * 0.5
      : ticker.lastPrice - range * 0.5;
    const stopLoss = reversalType === 'BULLISH_REVERSAL'
      ? ticker.lastPrice - range * 0.2
      : ticker.lastPrice + range * 0.2;

    return {
      symbol,
      type: reversalType,
      confidence: Math.min(100, confidence),
      triggers,
      price: ticker.lastPrice,
      potentialTarget,
      stopLoss,
    };
  }

  // Public getters
  getTopSignals(limit: number = 10, direction?: 'LONG' | 'SHORT'): SmartSignal[] {
    let signals = Array.from(this.smartSignals.values());

    if (direction) {
      signals = signals.filter(s => s.direction === direction);
    }

    return signals
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }

  getEarlyEntries(limit: number = 10): SmartSignal[] {
    return Array.from(this.smartSignals.values())
      .filter(s => s.entryType === 'EARLY')
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }

  getReversalSignals(limit: number = 10): ReversalSignal[] {
    return Array.from(this.reversalSignals.values())
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }

  getBreakoutCandidates(limit: number = 10): SmartSignal[] {
    return Array.from(this.smartSignals.values())
      .filter(s => s.entryType === 'BREAKOUT')
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }

  getLowRiskSetups(limit: number = 10): SmartSignal[] {
    return Array.from(this.smartSignals.values())
      .filter(s => s.riskLevel === 'LOW' || s.riskLevel === 'MEDIUM')
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }

  getSignal(symbol: string): SmartSignal | undefined {
    return this.smartSignals.get(symbol);
  }

  getReversal(symbol: string): ReversalSignal | undefined {
    return this.reversalSignals.get(symbol);
  }
}

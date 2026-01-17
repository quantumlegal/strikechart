import { DataStore } from '../core/dataStore.js';
import { SmartSignal, SmartSignalEngine } from '../detectors/smartSignal.js';
import { FundingDetector } from '../detectors/funding.js';
import { OpenInterestDetector } from '../detectors/openInterest.js';
import { MultiTimeframeDetector } from '../detectors/multiTimeframe.js';
import { VolumeDetector } from '../detectors/volume.js';
import { VelocityDetector } from '../detectors/velocity.js';
import { PatternDetector } from '../detectors/pattern.js';
import { EntryTimingCalculator } from '../detectors/entryTiming.js';
import { WhaleDetector } from '../detectors/whale.js';
import { CorrelationDetector } from '../detectors/correlation.js';
import { SignalFeatures } from '../storage/sqlite.js';

// Feature extraction service that generates 35+ features for ML training
export class FeatureExtractor {
  constructor(
    private dataStore: DataStore,
    private fundingDetector: FundingDetector,
    private oiDetector: OpenInterestDetector,
    private mtfDetector: MultiTimeframeDetector,
    private volumeDetector: VolumeDetector,
    private velocityDetector: VelocityDetector,
    private patternDetector: PatternDetector,
    private entryCalculator: EntryTimingCalculator,
    private whaleDetector: WhaleDetector,
    private correlationDetector: CorrelationDetector
  ) {}

  // Extract all features for a smart signal
  extractFeatures(signal: SmartSignal, signalId: string): SignalFeatures {
    const symbol = signal.symbol;
    const symbolData = this.dataStore.getSymbol(symbol);
    const ticker = symbolData?.current;

    // Price features
    const priceFeatures = this.extractPriceFeatures(symbol);

    // Volume features
    const volumeFeatures = this.extractVolumeFeatures(symbol);

    // Momentum features
    const momentumFeatures = this.extractMomentumFeatures(symbol);

    // Technical features (RSI, MTF)
    const technicalFeatures = this.extractTechnicalFeatures(symbol);

    // Funding features
    const fundingFeatures = this.extractFundingFeatures(symbol, signal.direction);

    // Open Interest features
    const oiFeatures = this.extractOIFeatures(symbol);

    // Pattern features
    const patternFeatures = this.extractPatternFeatures(symbol);

    // Smart Signal features
    const smartFeatures = this.extractSmartSignalFeatures(signal);

    // Entry timing features
    const entryFeatures = this.extractEntryFeatures(symbol);

    // Whale/Correlation features
    const whaleCorrelationFeatures = this.extractWhaleCorrelationFeatures(symbol);

    return {
      signal_id: signalId,
      symbol,
      timestamp: Date.now(),
      ...priceFeatures,
      ...volumeFeatures,
      ...momentumFeatures,
      ...technicalFeatures,
      ...fundingFeatures,
      ...oiFeatures,
      ...patternFeatures,
      ...smartFeatures,
      ...entryFeatures,
      ...whaleCorrelationFeatures,
      direction: signal.direction === 'LONG' ? 1 : -1,
    };
  }

  private extractPriceFeatures(symbol: string): {
    price_change_24h: number;
    price_change_1h: number;
    price_change_15m: number;
    price_change_5m: number;
    high_low_range: number;
    price_position: number;
  } {
    const symbolData = this.dataStore.getSymbol(symbol);
    const ticker = symbolData?.current;
    const priceHistory = this.dataStore.getPriceHistory(symbol);

    if (!ticker) {
      return {
        price_change_24h: 0,
        price_change_1h: 0,
        price_change_15m: 0,
        price_change_5m: 0,
        high_low_range: 0,
        price_position: 0.5,
      };
    }

    const currentPrice = ticker.lastPrice;
    const highPrice = ticker.highPrice;
    const lowPrice = ticker.lowPrice;

    // Calculate price changes from history
    const now = Date.now();
    const price1hAgo = this.getPriceAtTime(priceHistory, now - 60 * 60 * 1000) || currentPrice;
    const price15mAgo = this.getPriceAtTime(priceHistory, now - 15 * 60 * 1000) || currentPrice;
    const price5mAgo = this.getPriceAtTime(priceHistory, now - 5 * 60 * 1000) || currentPrice;

    const priceChange1h = price1hAgo > 0 ? ((currentPrice - price1hAgo) / price1hAgo) * 100 : 0;
    const priceChange15m = price15mAgo > 0 ? ((currentPrice - price15mAgo) / price15mAgo) * 100 : 0;
    const priceChange5m = price5mAgo > 0 ? ((currentPrice - price5mAgo) / price5mAgo) * 100 : 0;

    const range = highPrice - lowPrice;
    const highLowRange = lowPrice > 0 ? (range / lowPrice) * 100 : 0;
    const pricePosition = range > 0 ? (currentPrice - lowPrice) / range : 0.5;

    return {
      price_change_24h: ticker.priceChangePercent,
      price_change_1h: priceChange1h,
      price_change_15m: priceChange15m,
      price_change_5m: priceChange5m,
      high_low_range: highLowRange,
      price_position: pricePosition,
    };
  }

  private extractVolumeFeatures(symbol: string): {
    volume_quote_24h: number;
    volume_multiplier: number;
    volume_change_1h: number;
  } {
    const symbolData = this.dataStore.getSymbol(symbol);
    const ticker = symbolData?.current;

    if (!ticker) {
      return {
        volume_quote_24h: 0,
        volume_multiplier: 1,
        volume_change_1h: 0,
      };
    }

    // Get volume spike data
    const volumeSpikes = this.volumeDetector.getTopSpikes(100);
    const volumeSpike = volumeSpikes.find(v => v.symbol === symbol);

    const volumeMultiplier = volumeSpike?.multiplier || 1;

    // Estimate volume change (use multiplier as proxy)
    const volumeChange1h = Math.max(0, (volumeMultiplier - 1) * 50); // Scale to percentage-like

    return {
      volume_quote_24h: ticker.quoteVolume / 1_000_000, // In millions
      volume_multiplier: volumeMultiplier,
      volume_change_1h: volumeChange1h,
    };
  }

  private extractMomentumFeatures(symbol: string): {
    velocity: number;
    acceleration: number;
    trend_state: number;
  } {
    const velocities = this.velocityDetector.getTopVelocity(100);
    const velocityData = velocities.find(v => v.symbol === symbol);

    if (!velocityData) {
      return {
        velocity: 0,
        acceleration: 0,
        trend_state: 0,
      };
    }

    // Determine trend state based on velocity
    let trendState = 0;
    if (velocityData.velocity > 0.3) trendState = 1; // Uptrend
    else if (velocityData.velocity < -0.3) trendState = -1; // Downtrend

    return {
      velocity: velocityData.velocity,
      acceleration: velocityData.acceleration,
      trend_state: trendState,
    };
  }

  private extractTechnicalFeatures(symbol: string): {
    rsi_1h: number;
    mtf_alignment: number;
    divergence_type: number;
  } {
    const mtfData = this.mtfDetector.getSymbol(symbol);

    if (!mtfData) {
      return {
        rsi_1h: 50,
        mtf_alignment: 0,
        divergence_type: 0,
      };
    }

    // Count aligned timeframes
    let alignmentCount = 0;
    if (mtfData.alignment === 'STRONG_BULLISH' || mtfData.alignment === 'STRONG_BEARISH') {
      alignmentCount = 4;
    } else if (mtfData.alignment === 'BULLISH' || mtfData.alignment === 'BEARISH') {
      alignmentCount = 3;
    } else if (mtfData.alignment === 'MIXED') {
      alignmentCount = 2;
    } else {
      alignmentCount = 1;
    }

    // Divergence type
    let divergenceType = 0;
    if (mtfData.divergence === 'BULLISH_DIV') divergenceType = 1;
    else if (mtfData.divergence === 'BEARISH_DIV') divergenceType = -1;

    return {
      rsi_1h: mtfData.rsi1h,
      mtf_alignment: alignmentCount,
      divergence_type: divergenceType,
    };
  }

  private extractFundingFeatures(symbol: string, direction: 'LONG' | 'SHORT' | 'NEUTRAL'): {
    funding_rate: number;
    funding_signal: number;
    funding_direction_match: number;
  } {
    const fundingData = this.fundingDetector.getSymbol(symbol);

    if (!fundingData) {
      return {
        funding_rate: 0,
        funding_signal: 0,
        funding_direction_match: 0,
      };
    }

    const fundingRate = fundingData.fundingRate;

    // Funding signal: negative = bullish (shorts paying), positive = bearish
    let fundingSignal = 0;
    if (fundingRate < -0.01) fundingSignal = 1; // Bullish
    else if (fundingRate > 0.05) fundingSignal = -1; // Bearish

    // Check if funding agrees with signal direction
    let directionMatch = 0;
    if (direction === 'LONG' && fundingSignal >= 0) directionMatch = 1;
    else if (direction === 'SHORT' && fundingSignal <= 0) directionMatch = 1;

    return {
      funding_rate: fundingRate * 100, // Convert to percentage
      funding_signal: fundingSignal,
      funding_direction_match: directionMatch,
    };
  }

  private extractOIFeatures(symbol: string): {
    oi_change_percent: number;
    oi_signal: number;
    oi_price_alignment: number;
  } {
    const oiData = this.oiDetector.getSymbol(symbol);
    const symbolData = this.dataStore.getSymbol(symbol);
    const ticker = symbolData?.current;

    if (!oiData || !ticker) {
      return {
        oi_change_percent: 0,
        oi_signal: 0,
        oi_price_alignment: 0,
      };
    }

    const oiChange = oiData.oiChange;
    const priceChange = ticker.priceChangePercent;

    // OI signal based on change and price correlation
    let oiSignal = 0;
    if (oiChange > 2 && priceChange > 2) oiSignal = 1; // Bullish: OI up, price up
    else if (oiChange > 2 && priceChange < -2) oiSignal = -1; // Bearish: OI up, price down
    else if (oiChange < -2 && priceChange > 2) oiSignal = -1; // Potential reversal
    else if (oiChange < -2 && priceChange < -2) oiSignal = 1; // Shorts closing

    // Price alignment: 1 if OI and price move together
    const oiPriceAlignment = (oiChange > 0 && priceChange > 0) || (oiChange < 0 && priceChange < 0) ? 1 : 0;

    return {
      oi_change_percent: oiChange,
      oi_signal: oiSignal,
      oi_price_alignment: oiPriceAlignment,
    };
  }

  private extractPatternFeatures(symbol: string): {
    pattern_type: number;
    pattern_confidence: number;
    distance_from_level: number;
  } {
    const patterns = this.patternDetector.getTopPatterns(50);
    const pattern = patterns.find(p => p.symbol === symbol);

    if (!pattern) {
      return {
        pattern_type: 0,
        pattern_confidence: 0,
        distance_from_level: 0,
      };
    }

    // Encode pattern type
    const patternTypeMap: Record<string, number> = {
      SUPPORT_BOUNCE: 1,
      RESISTANCE_BREAK: 2,
      DOUBLE_BOTTOM: 3,
      DOUBLE_TOP: 4,
      HIGHER_HIGH: 5,
      LOWER_LOW: 6,
      CONSOLIDATION_BREAK: 7,
      TREND_CONTINUATION: 8,
    };

    const patternType = patternTypeMap[pattern.pattern] || 0;

    // Calculate distance from level
    const symbolData = this.dataStore.getSymbol(symbol);
    const currentPrice = symbolData?.current?.lastPrice || 0;
    const level = pattern.priceLevel || currentPrice;
    const distanceFromLevel = currentPrice > 0 ? Math.abs((currentPrice - level) / currentPrice) * 100 : 0;

    return {
      pattern_type: patternType,
      pattern_confidence: pattern.confidence,
      distance_from_level: distanceFromLevel,
    };
  }

  private extractSmartSignalFeatures(signal: SmartSignal): {
    smart_confidence: number;
    component_count: number;
    entry_type: number;
    risk_level: number;
  } {
    // Encode entry type
    const entryTypeMap: Record<string, number> = {
      EARLY: 0,
      MOMENTUM: 1,
      REVERSAL: 2,
      BREAKOUT: 3,
    };

    // Encode risk level
    const riskLevelMap: Record<string, number> = {
      LOW: 0,
      MEDIUM: 1,
      HIGH: 2,
    };

    return {
      smart_confidence: signal.confidence,
      component_count: signal.signals.length,
      entry_type: entryTypeMap[signal.entryType] || 1,
      risk_level: riskLevelMap[signal.riskLevel] || 1,
    };
  }

  private extractEntryFeatures(symbol: string): {
    atr_percent: number;
    vwap_distance: number;
    risk_reward_ratio: number;
  } {
    const entrySignals = this.entryCalculator.getEntrySignals();
    const entry = entrySignals.find(e => e.symbol === symbol);

    if (!entry) {
      return {
        atr_percent: 0,
        vwap_distance: 0,
        risk_reward_ratio: 1.5,
      };
    }

    // Calculate ATR percent
    const symbolData = this.dataStore.getSymbol(symbol);
    const currentPrice = symbolData?.current?.lastPrice || 1;
    const atrPercent = entry.atr ? (entry.atr / currentPrice) * 100 : 0;

    // Calculate VWAP distance
    const vwapDistance = entry.vwap ? ((currentPrice - entry.vwap) / entry.vwap) * 100 : 0;

    // Risk/reward ratio
    const riskRewardRatio = entry.riskRewardRatio || 1.5;

    return {
      atr_percent: atrPercent,
      vwap_distance: vwapDistance,
      risk_reward_ratio: riskRewardRatio,
    };
  }

  private extractWhaleCorrelationFeatures(symbol: string): {
    whale_activity: number;
    btc_correlation: number;
    btc_outperformance: number;
  } {
    // Whale activity
    const whaleAlerts = this.whaleDetector.getTopWhaleActivity(50);
    const whaleAlert = whaleAlerts.find(w => w.symbol === symbol);
    const whaleActivity = whaleAlert?.confidence || 0;

    // Correlation with BTC
    const correlations = this.correlationDetector.getTopAlerts(100);
    const correlation = correlations.find(c => c.symbol === symbol);

    const btcCorrelation = correlation?.btcCorrelation || 0;

    // Calculate outperformance vs BTC
    const symbolData = this.dataStore.getSymbol(symbol);
    const btcData = this.dataStore.getSymbol('BTCUSDT');

    const symbolChange = symbolData?.current?.priceChangePercent || 0;
    const btcChange = btcData?.current?.priceChangePercent || 0;
    const btcOutperformance = symbolChange - btcChange;

    return {
      whale_activity: whaleActivity,
      btc_correlation: btcCorrelation,
      btc_outperformance: btcOutperformance,
    };
  }

  // Helper to get price at a specific time from history
  private getPriceAtTime(history: Array<{ price: number; timestamp: number }>, targetTime: number): number | null {
    if (history.length === 0) return null;

    // Find closest price point to target time
    let closest = history[0];
    let minDiff = Math.abs(history[0].timestamp - targetTime);

    for (const point of history) {
      const diff = Math.abs(point.timestamp - targetTime);
      if (diff < minDiff) {
        minDiff = diff;
        closest = point;
      }
    }

    // Only return if within reasonable range (5 minutes)
    if (minDiff > 5 * 60 * 1000) return null;

    return closest.price;
  }

  // Get feature names for ML model (useful for feature importance)
  static getFeatureNames(): string[] {
    return [
      'price_change_24h',
      'price_change_1h',
      'price_change_15m',
      'price_change_5m',
      'high_low_range',
      'price_position',
      'volume_quote_24h',
      'volume_multiplier',
      'volume_change_1h',
      'velocity',
      'acceleration',
      'trend_state',
      'rsi_1h',
      'mtf_alignment',
      'divergence_type',
      'funding_rate',
      'funding_signal',
      'funding_direction_match',
      'oi_change_percent',
      'oi_signal',
      'oi_price_alignment',
      'pattern_type',
      'pattern_confidence',
      'distance_from_level',
      'smart_confidence',
      'component_count',
      'entry_type',
      'risk_level',
      'atr_percent',
      'vwap_distance',
      'risk_reward_ratio',
      'whale_activity',
      'btc_correlation',
      'btc_outperformance',
      'direction',
    ];
  }

  // Convert features to array format for ML prediction
  static featuresToArray(features: SignalFeatures): number[] {
    return [
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
    ];
  }
}

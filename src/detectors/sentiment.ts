import { DataStore } from '../core/dataStore.js';
import { FundingDetector } from './funding.js';
import { OpenInterestDetector } from './openInterest.js';

export interface MarketSentiment {
  overallScore: number;         // 0-100 (0 = extreme fear, 100 = extreme greed)
  sentiment: 'EXTREME_FEAR' | 'FEAR' | 'NEUTRAL' | 'GREED' | 'EXTREME_GREED';
  components: {
    fundingScore: number;       // 0-100
    oiScore: number;            // 0-100
    volatilityScore: number;    // 0-100
    momentumScore: number;      // 0-100
  };
  indicators: {
    avgFundingRate: number;
    bullishCoins: number;
    bearishCoins: number;
    neutralCoins: number;
    highVolatilityCount: number;
    avgChange24h: number;
  };
  timestamp: number;
}

export interface SymbolSentiment {
  symbol: string;
  score: number;                // 0-100
  sentiment: 'VERY_BEARISH' | 'BEARISH' | 'NEUTRAL' | 'BULLISH' | 'VERY_BULLISH';
  fundingBias: number;          // -100 to 100
  volumeTrend: 'INCREASING' | 'DECREASING' | 'STABLE';
  priceTrend: 'UP' | 'DOWN' | 'SIDEWAYS';
  timestamp: number;
}

export class SentimentAnalyzer {
  constructor(
    private dataStore: DataStore,
    private fundingDetector: FundingDetector,
    private oiDetector: OpenInterestDetector
  ) {}

  getMarketSentiment(): MarketSentiment {
    const now = Date.now();
    const symbols = this.dataStore.getAllSymbols();

    // Calculate funding score
    let totalFunding = 0;
    let fundingCount = 0;
    const fundingRates = this.fundingDetector.getAll();

    for (const rate of fundingRates) {
      totalFunding += rate.fundingRate;
      fundingCount++;
    }

    const avgFunding = fundingCount > 0 ? totalFunding / fundingCount : 0;
    // Positive funding = more longs = greed, negative = fear
    // Normalize: -0.1% to +0.1% maps to 0-100
    const fundingScore = Math.max(0, Math.min(100, 50 + (avgFunding * 500)));

    // Calculate momentum score
    let bullishCoins = 0;
    let bearishCoins = 0;
    let neutralCoins = 0;
    let totalChange = 0;
    let highVolatilityCount = 0;

    for (const symbolData of symbols) {
      const change = symbolData.current.priceChangePercent;
      totalChange += change;

      if (change > 2) bullishCoins++;
      else if (change < -2) bearishCoins++;
      else neutralCoins++;

      if (Math.abs(change) > 10) highVolatilityCount++;
    }

    const avgChange24h = symbols.length > 0 ? totalChange / symbols.length : 0;
    const momentumScore = Math.max(0, Math.min(100, 50 + (avgChange24h * 5)));

    // Calculate volatility score (high volatility = more greed/fear extremes)
    const volatilityRatio = highVolatilityCount / Math.max(1, symbols.length);
    const volatilityScore = Math.max(0, Math.min(100, volatilityRatio * 200));

    // OI score - rising OI with rising prices = greed
    const oiAlerts = this.oiDetector.analyze();
    const bullishOI = oiAlerts.filter(a => a.direction === 'BULLISH').length;
    const bearishOI = oiAlerts.filter(a => a.direction === 'BEARISH').length;
    const oiScore = oiAlerts.length > 0
      ? Math.max(0, Math.min(100, 50 + ((bullishOI - bearishOI) / oiAlerts.length) * 50))
      : 50;

    // Overall score (weighted average)
    const overallScore = Math.round(
      fundingScore * 0.3 +
      momentumScore * 0.35 +
      volatilityScore * 0.15 +
      oiScore * 0.2
    );

    // Determine sentiment label
    let sentiment: MarketSentiment['sentiment'];
    if (overallScore >= 80) sentiment = 'EXTREME_GREED';
    else if (overallScore >= 60) sentiment = 'GREED';
    else if (overallScore >= 40) sentiment = 'NEUTRAL';
    else if (overallScore >= 20) sentiment = 'FEAR';
    else sentiment = 'EXTREME_FEAR';

    return {
      overallScore,
      sentiment,
      components: {
        fundingScore: Math.round(fundingScore),
        oiScore: Math.round(oiScore),
        volatilityScore: Math.round(volatilityScore),
        momentumScore: Math.round(momentumScore),
      },
      indicators: {
        avgFundingRate: Math.round(avgFunding * 10000) / 10000,
        bullishCoins,
        bearishCoins,
        neutralCoins,
        highVolatilityCount,
        avgChange24h: Math.round(avgChange24h * 100) / 100,
      },
      timestamp: now,
    };
  }

  getSymbolSentiment(symbol: string): SymbolSentiment | null {
    const now = Date.now();
    const symbolData = this.dataStore.getSymbol(symbol);
    if (!symbolData) return null;

    const { current, priceHistory, volumeHistory } = symbolData;

    // Price trend
    let priceTrend: SymbolSentiment['priceTrend'] = 'SIDEWAYS';
    if (current.priceChangePercent > 1) priceTrend = 'UP';
    else if (current.priceChangePercent < -1) priceTrend = 'DOWN';

    // Volume trend
    let volumeTrend: SymbolSentiment['volumeTrend'] = 'STABLE';
    if (volumeHistory.length >= 10) {
      const recentVol = volumeHistory.slice(-5);
      const olderVol = volumeHistory.slice(-10, -5);
      const recentAvg = recentVol.reduce((s, v) => s + v.volume, 0) / recentVol.length;
      const olderAvg = olderVol.reduce((s, v) => s + v.volume, 0) / olderVol.length;

      if (recentAvg > olderAvg * 1.2) volumeTrend = 'INCREASING';
      else if (recentAvg < olderAvg * 0.8) volumeTrend = 'DECREASING';
    }

    // Funding bias
    const fundingData = this.fundingDetector.getSymbol(symbol);
    const fundingBias = fundingData ? Math.round(fundingData.fundingRate * 1000) : 0;

    // Calculate overall score
    let score = 50;
    score += current.priceChangePercent * 2; // Price impact
    score += fundingBias * 10; // Funding impact
    if (volumeTrend === 'INCREASING' && priceTrend === 'UP') score += 10;
    if (volumeTrend === 'INCREASING' && priceTrend === 'DOWN') score -= 10;

    score = Math.max(0, Math.min(100, Math.round(score)));

    let sentiment: SymbolSentiment['sentiment'];
    if (score >= 80) sentiment = 'VERY_BULLISH';
    else if (score >= 60) sentiment = 'BULLISH';
    else if (score >= 40) sentiment = 'NEUTRAL';
    else if (score >= 20) sentiment = 'BEARISH';
    else sentiment = 'VERY_BEARISH';

    return {
      symbol,
      score,
      sentiment,
      fundingBias,
      volumeTrend,
      priceTrend,
      timestamp: now,
    };
  }

  getTopBullish(limit: number = 10): SymbolSentiment[] {
    const symbols = this.dataStore.getAllSymbols();
    const sentiments: SymbolSentiment[] = [];

    for (const { symbol } of symbols) {
      const s = this.getSymbolSentiment(symbol);
      if (s && s.score >= 60) sentiments.push(s);
    }

    return sentiments.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  getTopBearish(limit: number = 10): SymbolSentiment[] {
    const symbols = this.dataStore.getAllSymbols();
    const sentiments: SymbolSentiment[] = [];

    for (const { symbol } of symbols) {
      const s = this.getSymbolSentiment(symbol);
      if (s && s.score <= 40) sentiments.push(s);
    }

    return sentiments.sort((a, b) => a.score - b.score).slice(0, limit);
  }
}

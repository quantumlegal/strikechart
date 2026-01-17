import { config } from '../config.js';
import {
  Opportunity,
  VolatilityAlert,
  VolumeAlert,
  VelocityAlert,
  RangeAlert,
  NewListingAlert,
} from '../binance/types.js';
import { VolatilityDetector } from '../detectors/volatility.js';
import { VolumeDetector } from '../detectors/volume.js';
import { VelocityDetector } from '../detectors/velocity.js';
import { RangeDetector } from '../detectors/range.js';
import { NewListingDetector } from '../detectors/newListing.js';
import { DataStore } from './dataStore.js';

export class OpportunityRanker {
  private volatilityDetector: VolatilityDetector;
  private volumeDetector: VolumeDetector;
  private velocityDetector: VelocityDetector;
  private rangeDetector: RangeDetector;
  private newListingDetector: NewListingDetector;

  constructor(private dataStore: DataStore) {
    this.volatilityDetector = new VolatilityDetector(dataStore);
    this.volumeDetector = new VolumeDetector(dataStore);
    this.velocityDetector = new VelocityDetector(dataStore);
    this.rangeDetector = new RangeDetector(dataStore);
    this.newListingDetector = new NewListingDetector(dataStore);
  }

  // Call this on every data update to track volume changes
  update(): void {
    this.volumeDetector.updateVolumeTracking();
  }

  getAllOpportunities(): Opportunity[] {
    const opportunities: Opportunity[] = [];

    // Volatility alerts
    for (const alert of this.volatilityDetector.detect()) {
      opportunities.push(this.fromVolatility(alert));
    }

    // Volume alerts (avoid duplicates)
    for (const alert of this.volumeDetector.detect()) {
      if (!opportunities.find((o) => o.symbol === alert.symbol && o.type === 'VOLUME')) {
        opportunities.push(this.fromVolume(alert));
      }
    }

    // Velocity alerts
    for (const alert of this.velocityDetector.detect()) {
      if (!opportunities.find((o) => o.symbol === alert.symbol && o.type === 'VELOCITY')) {
        opportunities.push(this.fromVelocity(alert));
      }
    }

    // Range alerts
    for (const alert of this.rangeDetector.detect()) {
      if (!opportunities.find((o) => o.symbol === alert.symbol && o.type === 'RANGE')) {
        opportunities.push(this.fromRange(alert));
      }
    }

    // New listing alerts
    for (const alert of this.newListingDetector.detect()) {
      opportunities.push(this.fromNewListing(alert));
    }

    // Sort by composite score
    opportunities.sort((a, b) => b.score - a.score);

    return opportunities;
  }

  getTopOpportunities(limit: number = config.ui.maxDisplayed): Opportunity[] {
    return this.getAllOpportunities().slice(0, limit);
  }

  // Get opportunities with multiple signals (high conviction)
  getHighConviction(): Opportunity[] {
    const symbolScores = new Map<string, number>();
    const all = this.getAllOpportunities();

    // Count how many signal types each symbol has
    for (const opp of all) {
      const count = (symbolScores.get(opp.symbol) || 0) + 1;
      symbolScores.set(opp.symbol, count);
    }

    // Return opportunities where symbol has 2+ signals
    return all.filter((opp) => (symbolScores.get(opp.symbol) || 0) >= 2);
  }

  // Get detectors for direct access
  getVolatilityDetector(): VolatilityDetector {
    return this.volatilityDetector;
  }

  getVolumeDetector(): VolumeDetector {
    return this.volumeDetector;
  }

  getVelocityDetector(): VelocityDetector {
    return this.velocityDetector;
  }

  getRangeDetector(): RangeDetector {
    return this.rangeDetector;
  }

  getNewListingDetector(): NewListingDetector {
    return this.newListingDetector;
  }

  private fromVolatility(alert: VolatilityAlert): Opportunity {
    const absChange = Math.abs(alert.change24h);
    // Score: 0-50 based on change (10% = 0, 60% = 50)
    const score = Math.min(50, ((absChange - config.volatility.minChange24h) / 50) * 50);

    return {
      symbol: alert.symbol,
      type: 'VOLATILITY',
      score: Math.round(score + (alert.isCritical ? 25 : 0)),
      direction: alert.direction,
      details: { change24h: alert.change24h },
      timestamp: alert.timestamp,
      lastPrice: alert.lastPrice,
    };
  }

  private fromVolume(alert: VolumeAlert): Opportunity {
    // Score: 0-30 based on multiplier (3x = 0, 10x = 30)
    const score = Math.min(30, ((alert.multiplier - config.volume.spikeMultiplier) / 7) * 30);

    const symbolData = this.dataStore.getSymbol(alert.symbol);
    const direction = alert.priceChange > 0 ? 'LONG' : alert.priceChange < 0 ? 'SHORT' : 'NEUTRAL';

    return {
      symbol: alert.symbol,
      type: 'VOLUME',
      score: Math.round(score),
      direction,
      details: { volumeMultiplier: alert.multiplier, change24h: alert.priceChange },
      timestamp: alert.timestamp,
      lastPrice: symbolData?.current.lastPrice || 0,
    };
  }

  private fromVelocity(alert: VelocityAlert): Opportunity {
    const absVelocity = Math.abs(alert.velocity);
    // Score: 0-40 based on velocity (0.5%/min = 0, 3%/min = 40)
    const score = Math.min(40, ((absVelocity - config.velocity.minVelocity) / 2.5) * 40);
    const accelBonus = alert.trend === 'Accelerating' ? 15 : 0;

    const symbolData = this.dataStore.getSymbol(alert.symbol);
    const direction = alert.velocity > 0 ? 'LONG' : 'SHORT';

    return {
      symbol: alert.symbol,
      type: 'VELOCITY',
      score: Math.round(score + accelBonus),
      direction,
      details: { velocity: alert.velocity },
      timestamp: alert.timestamp,
      lastPrice: symbolData?.current.lastPrice || 0,
    };
  }

  private fromRange(alert: RangeAlert): Opportunity {
    // Score: 0-25 based on range (15% = 0, 40% = 25)
    const score = Math.min(25, ((alert.range - config.range.minRange) / 25) * 25);
    const breakingBonus = alert.position === 'Breaking' ? 20 : 0;

    let direction: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
    if (alert.position === 'Near High' || alert.position === 'Breaking') {
      direction = 'LONG';
    } else if (alert.position === 'Near Low') {
      direction = 'SHORT';
    }

    return {
      symbol: alert.symbol,
      type: 'RANGE',
      score: Math.round(score + breakingBonus),
      direction,
      details: { range: alert.range },
      timestamp: alert.timestamp,
      lastPrice: alert.currentPrice,
    };
  }

  private fromNewListing(alert: NewListingAlert): Opportunity {
    const absChange = Math.abs(alert.changeFromFirst);
    // Score: 30 base + 0-40 based on change from first
    const score = 30 + Math.min(40, (absChange / 100) * 40);

    return {
      symbol: alert.symbol,
      type: 'NEW_LISTING',
      score: Math.round(score),
      direction: alert.changeFromFirst > 0 ? 'LONG' : 'SHORT',
      details: { isNew: true, change24h: alert.changeFromFirst },
      timestamp: alert.timestamp,
      lastPrice: alert.currentPrice,
    };
  }
}

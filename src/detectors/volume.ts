import { config } from '../config.js';
import { DataStore } from '../core/dataStore.js';
import { VolumeAlert } from '../binance/types.js';

export class VolumeDetector {
  private volumeSnapshots: Map<string, { volume: number; timestamp: number }[]> = new Map();
  private lastUpdate: number = 0;

  constructor(private dataStore: DataStore) {}

  // Track incremental volume changes (volume delta between snapshots)
  updateVolumeTracking(): void {
    const now = Date.now();
    const symbols = this.dataStore.getAllSymbols();

    for (const symbolData of symbols) {
      const symbol = symbolData.symbol;
      const currentVolume = symbolData.current.quoteVolume;

      let snapshots = this.volumeSnapshots.get(symbol) || [];
      snapshots.push({ volume: currentVolume, timestamp: now });

      // Keep last 60 snapshots (about 1 minute of data at 1 update/sec)
      if (snapshots.length > 60) {
        snapshots = snapshots.slice(-60);
      }
      this.volumeSnapshots.set(symbol, snapshots);
    }
    this.lastUpdate = now;
  }

  detect(): VolumeAlert[] {
    const alerts: VolumeAlert[] = [];
    const symbols = this.dataStore.getAllSymbols();

    for (const symbolData of symbols) {
      const symbol = symbolData.symbol;
      const snapshots = this.volumeSnapshots.get(symbol) || [];

      // Need at least 30 snapshots to calculate meaningful volume delta
      if (snapshots.length < 30) {
        continue;
      }

      // Calculate volume increase rate over recent period vs average
      // Volume delta = how much volume was added in the last N seconds
      const recentPeriod = 10; // Last 10 snapshots
      const avgPeriod = 30; // Older 30 snapshots for baseline

      const recentSnapshots = snapshots.slice(-recentPeriod);
      const olderSnapshots = snapshots.slice(-avgPeriod, -recentPeriod);

      if (olderSnapshots.length < 10) continue;

      // Calculate volume delta (incremental volume added)
      const recentDelta = recentSnapshots[recentSnapshots.length - 1].volume - recentSnapshots[0].volume;
      const avgDelta = olderSnapshots[olderSnapshots.length - 1].volume - olderSnapshots[0].volume;

      // Normalize by time period
      const recentRate = recentDelta / recentPeriod;
      const avgRate = avgDelta / olderSnapshots.length;

      // Avoid division by zero
      if (avgRate <= 0) continue;

      const multiplier = recentRate / avgRate;

      // Also check absolute volume - must be significant
      const totalVolume = symbolData.current.quoteVolume;
      if (totalVolume < 1000000) continue; // Min $1M volume

      if (multiplier >= config.volume.spikeMultiplier) {
        alerts.push({
          symbol: symbolData.symbol,
          currentVolume: totalVolume,
          averageVolume: avgRate * 60, // Extrapolate to per-minute
          multiplier,
          priceChange: symbolData.current.priceChangePercent,
          timestamp: Date.now(),
        });
      }
    }

    // Sort by multiplier (biggest spikes first)
    alerts.sort((a, b) => b.multiplier - a.multiplier);

    return alerts;
  }

  getTopSpikes(limit: number = 10): VolumeAlert[] {
    return this.detect().slice(0, limit);
  }

  // Get volume spikes that coincide with price increases (bullish)
  getBullishSpikes(): VolumeAlert[] {
    return this.detect().filter((a) => a.priceChange > 0);
  }

  // Get volume spikes that coincide with price decreases (bearish)
  getBearishSpikes(): VolumeAlert[] {
    return this.detect().filter((a) => a.priceChange < 0);
  }
}

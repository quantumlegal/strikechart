/**
 * OMNIA Protocol Tracker Service
 * Orchestrates CoinGecko and Etherscan clients
 * Emits real-time updates via EventEmitter pattern
 */

import { EventEmitter } from 'events';
import { CoinGeckoClient, PriceData, ChartDataPoint, Exchange, CommunityData } from './coingeckoClient.js';
import { EtherscanClient, TokenTransfer } from './etherscanClient.js';
import { config } from '../config.js';

// Whale alert severity levels
export type WhaleSeverity = 'info' | 'warning' | 'critical';

export interface WhaleAlert {
  id: string;
  transfer: TokenTransfer;
  severity: WhaleSeverity;
  message: string;
  timestamp: number;
}

export interface OmniaData {
  // Price data
  price: number;
  priceChange24h: number;
  priceChangePercent24h: number;
  marketCap: number;
  volume24h: number;
  circulatingSupply: number;
  totalSupply: number;
  ath: number;
  athChangePercent: number;

  // Exchange data
  exchanges: Exchange[];

  // On-chain data
  recentTransfers: TokenTransfer[];
  whaleAlerts: WhaleAlert[];

  // Community & Social data
  community: CommunityData | null;

  // Meta
  lastUpdated: number;
  priceLastUpdated: number;
  transfersLastUpdated: number;
}

export interface OmniaStatus {
  enabled: boolean;
  lastUpdate: number;
  priceAvailable: boolean;
  transfersAvailable: boolean;
  errors: string[];
}

export class OmniaTracker extends EventEmitter {
  private coingeckoClient: CoinGeckoClient;
  private etherscanClient: EtherscanClient;

  private enabled: boolean;
  private priceUpdateInterval: number;
  private transferUpdateInterval: number;
  private whaleThreshold: number;

  private priceTimer: NodeJS.Timeout | null = null;
  private transferTimer: NodeJS.Timeout | null = null;

  private currentData: OmniaData;
  private errors: string[] = [];
  private lastProcessedBlock: number = 0;

  constructor() {
    super();

    const omniaConfig = config.omnia || {};

    this.enabled = omniaConfig.enabled ?? true;
    this.priceUpdateInterval = omniaConfig.priceUpdateInterval ?? 60000;
    this.transferUpdateInterval = omniaConfig.transferUpdateInterval ?? 30000;
    this.whaleThreshold = omniaConfig.whaleThreshold ?? 100000;

    // Initialize clients
    this.coingeckoClient = new CoinGeckoClient(
      omniaConfig.coingeckoApiKey || '',
      10000
    );

    this.etherscanClient = new EtherscanClient(
      omniaConfig.etherscanApiKey || '',
      omniaConfig.bscscanApiKey || '',
      10000
    );

    // Initialize empty data
    this.currentData = this.getEmptyData();
  }

  private getEmptyData(): OmniaData {
    return {
      price: 0,
      priceChange24h: 0,
      priceChangePercent24h: 0,
      marketCap: 0,
      volume24h: 0,
      circulatingSupply: 21370000,
      totalSupply: 100000000,
      ath: 1.77,
      athChangePercent: -99.8,
      exchanges: [],
      recentTransfers: [],
      whaleAlerts: [],
      community: null,
      lastUpdated: 0,
      priceLastUpdated: 0,
      transfersLastUpdated: 0,
    };
  }

  /**
   * Start the tracking service
   */
  async start(): Promise<void> {
    if (!this.enabled) {
      console.log('[OmniaTracker] Service disabled');
      return;
    }

    console.log('[OmniaTracker] Starting OMNIA Protocol tracking...');

    // Initial data fetch
    await this.updatePrice();
    await this.updateTransfers();

    // Set up periodic updates
    this.priceTimer = setInterval(
      () => this.updatePrice(),
      this.priceUpdateInterval
    );

    this.transferTimer = setInterval(
      () => this.updateTransfers(),
      this.transferUpdateInterval
    );

    console.log('[OmniaTracker] Service started');
    console.log(`  - Price updates: every ${this.priceUpdateInterval / 1000}s`);
    console.log(`  - Transfer updates: every ${this.transferUpdateInterval / 1000}s`);
    console.log(`  - Whale threshold: ${this.whaleThreshold.toLocaleString()} OMNIA`);
  }

  /**
   * Stop the tracking service
   */
  stop(): void {
    if (this.priceTimer) {
      clearInterval(this.priceTimer);
      this.priceTimer = null;
    }

    if (this.transferTimer) {
      clearInterval(this.transferTimer);
      this.transferTimer = null;
    }

    console.log('[OmniaTracker] Service stopped');
  }

  /**
   * Update price data from CoinGecko
   */
  private async updatePrice(): Promise<void> {
    try {
      const priceData = await this.coingeckoClient.getPrice();

      if (priceData) {
        this.currentData.price = priceData.price;
        this.currentData.priceChange24h = priceData.priceChange24h;
        this.currentData.priceChangePercent24h = priceData.priceChangePercent24h;
        this.currentData.marketCap = priceData.marketCap;
        this.currentData.volume24h = priceData.volume24h;
        this.currentData.circulatingSupply = priceData.circulatingSupply || 21370000;
        this.currentData.totalSupply = priceData.totalSupply || 100000000;
        this.currentData.ath = priceData.ath;
        this.currentData.athChangePercent = priceData.athChangePercent;
        this.currentData.priceLastUpdated = Date.now();

        this.removeError('price');
      }

      // Fetch exchange data (less frequently, only when price updates)
      const exchanges = await this.coingeckoClient.getExchangeTickers();
      if (exchanges.length > 0) {
        this.currentData.exchanges = exchanges;
      }

      // Fetch community data
      const community = await this.coingeckoClient.getCommunityData();
      if (community) {
        this.currentData.community = community;
      }

      this.currentData.lastUpdated = Date.now();
      this.emit('update', this.currentData);
    } catch (error) {
      this.addError('price', `Price update failed: ${(error as Error).message}`);
    }
  }

  /**
   * Update transfer data from Etherscan
   */
  private async updateTransfers(): Promise<void> {
    try {
      const transfers = await this.etherscanClient.getTokenTransfers(1, 50, this.lastProcessedBlock);

      if (transfers.length > 0) {
        // Update last processed block
        const maxBlock = Math.max(...transfers.map(t => t.blockNumber));
        if (maxBlock > this.lastProcessedBlock) {
          this.lastProcessedBlock = maxBlock;
        }

        // Check for new whale transfers
        const newWhales = this.detectWhaleMovements(transfers);
        if (newWhales.length > 0) {
          this.currentData.whaleAlerts = [
            ...newWhales,
            ...this.currentData.whaleAlerts,
          ].slice(0, 50); // Keep last 50 whale alerts

          // Emit whale alert events
          for (const alert of newWhales) {
            this.emit('whaleAlert', alert);
          }
        }

        // Update transfers list
        this.currentData.recentTransfers = transfers.slice(0, 50);
        this.currentData.transfersLastUpdated = Date.now();

        // Emit individual transfer events for real-time feed
        for (const transfer of transfers.slice(0, 5)) {
          this.emit('transfer', transfer);
        }

        this.removeError('transfers');
      }

      this.currentData.lastUpdated = Date.now();
      this.emit('update', this.currentData);
    } catch (error) {
      this.addError('transfers', `Transfer update failed: ${(error as Error).message}`);
    }
  }

  /**
   * Detect whale movements and create alerts
   */
  private detectWhaleMovements(transfers: TokenTransfer[]): WhaleAlert[] {
    const alerts: WhaleAlert[] = [];

    for (const transfer of transfers) {
      if (!transfer.isWhale) continue;

      // Don't create duplicates
      const existingAlert = this.currentData.whaleAlerts.find(
        a => a.transfer.hash === transfer.hash
      );
      if (existingAlert) continue;

      const severity = this.getWhaleSeverity(transfer.value);
      const formatted = this.etherscanClient.formatTransfer(transfer);

      alerts.push({
        id: `whale_${transfer.hash.slice(0, 8)}`,
        transfer,
        severity,
        message: `${formatted.amount} OMNIA moved: ${formatted.from} → ${formatted.to}`,
        timestamp: Date.now(),
      });
    }

    return alerts;
  }

  /**
   * Determine whale alert severity based on amount
   */
  private getWhaleSeverity(amount: number): WhaleSeverity {
    if (amount >= 1000000) return 'critical';  // 1M+
    if (amount >= 500000) return 'warning';    // 500K-1M
    return 'info';                              // 100K-500K
  }

  /**
   * Get current snapshot of all data
   */
  getData(): OmniaData {
    return { ...this.currentData };
  }

  /**
   * Get chart data for specified timeframe
   */
  async getChartData(days: number = 7): Promise<ChartDataPoint[]> {
    return this.coingeckoClient.getMarketChart(days);
  }

  /**
   * Get service status
   */
  getStatus(): OmniaStatus {
    return {
      enabled: this.enabled,
      lastUpdate: this.currentData.lastUpdated,
      priceAvailable: this.currentData.priceLastUpdated > 0,
      transfersAvailable: this.currentData.transfersLastUpdated > 0,
      errors: [...this.errors],
    };
  }

  /**
   * Get whale alerts filtered by severity
   */
  getWhaleAlerts(severity?: WhaleSeverity, limit: number = 20): WhaleAlert[] {
    let alerts = this.currentData.whaleAlerts;

    if (severity) {
      alerts = alerts.filter(a => a.severity === severity);
    }

    return alerts.slice(0, limit);
  }

  /**
   * Get community and social data
   */
  getCommunityData(): CommunityData | null {
    return this.currentData.community;
  }

  /**
   * Get exchange transfers
   */
  async getExchangeTransfers(limit: number = 20): Promise<TokenTransfer[]> {
    return this.etherscanClient.getExchangeTransfers(limit);
  }

  /**
   * Force refresh all data
   */
  async refresh(): Promise<void> {
    this.coingeckoClient.clearCache();
    this.etherscanClient.clearCache();
    await Promise.all([this.updatePrice(), this.updateTransfers()]);
  }

  /**
   * Error tracking helpers
   */
  private addError(type: string, message: string): void {
    const errorKey = `${type}: ${message}`;
    if (!this.errors.includes(errorKey)) {
      this.errors.push(errorKey);
      if (this.errors.length > 10) {
        this.errors.shift();
      }
    }
    console.warn(`[OmniaTracker] ${errorKey}`);
  }

  private removeError(type: string): void {
    this.errors = this.errors.filter(e => !e.startsWith(`${type}:`));
  }

  /**
   * Get contract information
   */
  getContractInfo(): {
    eth: { address: string; chain: string; explorerUrl: string };
    social: {
      website: string;
      twitter: string;
      linktree: string;
    };
  } {
    return {
      eth: this.etherscanClient.getContractInfo(),
      social: {
        website: 'https://omniatech.io/',
        twitter: 'https://x.com/omnia_protocol',
        linktree: 'https://linktr.ee/omniaprotocol',
      },
    };
  }

  /**
   * Format a transfer for display
   */
  formatTransfer(transfer: TokenTransfer) {
    return this.etherscanClient.formatTransfer(transfer);
  }
}

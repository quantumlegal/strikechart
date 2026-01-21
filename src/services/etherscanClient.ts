/**
 * Etherscan API Client for OMNIA Protocol on-chain tracking
 * Free tier: 5 calls/sec
 * Tracks: Token transfers, top holders, wallet balances
 */

export interface TokenTransfer {
  hash: string;
  blockNumber: number;
  timestamp: number;
  from: string;
  to: string;
  value: number;
  tokenSymbol: string;
  tokenDecimal: number;
  gasPrice: string;
  gasUsed: string;
  // Derived fields
  isWhale: boolean;
  direction: 'in' | 'out' | 'transfer';
  exchangeInvolved: string | null;
}

export interface TokenHolder {
  address: string;
  balance: number;
  percentageOfSupply: number;
  label?: string;
}

export interface WalletBalance {
  address: string;
  balance: number;
  lastUpdated: number;
}

// Known exchange and contract addresses
const KNOWN_ADDRESSES: Record<string, string> = {
  // Exchanges
  '0x0d0707963952f2fba59dd06f2b425ace40b492fe': 'Gate.io',
  '0x75e89d5979e4f6fba9f97c104c2f0afb3f1dcb88': 'MEXC',
  '0x2b5634c42055806a59e9107ed44d43c426e58258': 'KuCoin',
  '0x1ab4973a48dc892cd9971ece8e01dcc7688f8f23': 'KuCoin 2',
  '0xf977814e90da44bfa03b6295a0616a897441acec': 'Binance',
  // DEX Routers
  '0x10ed43c718714eb63d5aa57b78b54704e256024e': 'PancakeSwap',
  '0x7a250d5630b4cf539739df2c5dacb4c659f2488d': 'Uniswap V2',
  '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45': 'Uniswap V3',
  // Dead wallets
  '0x000000000000000000000000000000000000dead': 'Burn Address',
  '0x0000000000000000000000000000000000000000': 'Zero Address',
};

export class EtherscanClient {
  // V2 API endpoints with chainid parameter
  private baseUrl = 'https://api.etherscan.io/v2/api';
  private bscBaseUrl = 'https://api.bscscan.com/api';
  private ethChainId = 1; // Ethereum Mainnet
  private bscChainId = 56; // BSC Mainnet
  private contractAddress = '0x75780415fca0157e4814a1a2588f1ee9ff0f7e88';
  private apiKey: string;
  private bscApiKey: string;
  private timeout: number;
  private tokenDecimals = 18;
  private totalSupply = 100000000;

  // Rate limiting
  private lastRequestTime: number = 0;
  private minRequestInterval: number = 200; // 5 req/sec = 200ms between requests

  // Cache
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private transfersCacheTTL: number = 30000; // 30 seconds
  private holdersCacheTTL: number = 300000; // 5 minutes

  constructor(
    ethApiKey: string = '',
    bscApiKey: string = '',
    timeout: number = 10000
  ) {
    this.apiKey = ethApiKey;
    this.bscApiKey = bscApiKey;
    this.timeout = timeout;
  }

  private async rateLimitedFetch(url: string): Promise<Response> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.minRequestInterval) {
      await new Promise(resolve =>
        setTimeout(resolve, this.minRequestInterval - timeSinceLastRequest)
      );
    }

    this.lastRequestTime = Date.now();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  private getCached<T>(key: string, ttl: number): T | null {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < ttl) {
      return cached.data as T;
    }
    return null;
  }

  private setCache(key: string, data: any): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  private parseTokenValue(value: string, decimals: number = this.tokenDecimals): number {
    return parseFloat(value) / Math.pow(10, decimals);
  }

  private getAddressLabel(address: string): string | null {
    const lower = address.toLowerCase();
    return KNOWN_ADDRESSES[lower] || null;
  }

  private isExchangeAddress(address: string): boolean {
    const label = this.getAddressLabel(address);
    if (!label) return false;
    return ['Gate.io', 'MEXC', 'KuCoin', 'KuCoin 2', 'Binance'].includes(label);
  }

  private shortenAddress(address: string): string {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  /**
   * Get recent token transfers for OMNIA
   */
  async getTokenTransfers(
    page: number = 1,
    offset: number = 50,
    startBlock: number = 0
  ): Promise<TokenTransfer[]> {
    const cacheKey = `transfers_${page}_${offset}_${startBlock}`;
    const cached = this.getCached<TokenTransfer[]>(cacheKey, this.transfersCacheTTL);
    if (cached) return cached;

    try {
      // V2 API requires chainid parameter
      const apiKeyParam = this.apiKey ? `&apikey=${this.apiKey}` : '';
      const url = `${this.baseUrl}?chainid=${this.ethChainId}&module=account&action=tokentx&contractaddress=${this.contractAddress}&page=${page}&offset=${offset}&startblock=${startBlock}&sort=desc${apiKeyParam}`;
      const response = await this.rateLimitedFetch(url);

      if (!response.ok) {
        console.warn(`[Etherscan] Transfers fetch failed: ${response.status}`);
        return [];
      }

      const data = await response.json();

      if (data.status !== '1' || !data.result) {
        // API returns '0' status with 'No transactions found' for empty results
        if (data.message === 'No transactions found') {
          return [];
        }
        // Handle missing API key or deprecated endpoint gracefully
        if (data.message?.includes('API Key') || data.message?.includes('Invalid')) {
          console.warn('[Etherscan] API key required for V2 API - transfers will be limited');
          return [];
        }
        console.warn('[Etherscan] API error:', data.message);
        return [];
      }

      const transfers: TokenTransfer[] = data.result.map((tx: any) => {
        const value = this.parseTokenValue(tx.value, parseInt(tx.tokenDecimal));
        const fromLabel = this.getAddressLabel(tx.from);
        const toLabel = this.getAddressLabel(tx.to);

        let direction: 'in' | 'out' | 'transfer' = 'transfer';
        let exchangeInvolved: string | null = null;

        if (this.isExchangeAddress(tx.from)) {
          direction = 'out'; // From exchange = withdrawal
          exchangeInvolved = fromLabel;
        } else if (this.isExchangeAddress(tx.to)) {
          direction = 'in'; // To exchange = deposit
          exchangeInvolved = toLabel;
        }

        return {
          hash: tx.hash,
          blockNumber: parseInt(tx.blockNumber),
          timestamp: parseInt(tx.timeStamp) * 1000,
          from: tx.from,
          to: tx.to,
          value,
          tokenSymbol: tx.tokenSymbol,
          tokenDecimal: parseInt(tx.tokenDecimal),
          gasPrice: tx.gasPrice,
          gasUsed: tx.gasUsed,
          isWhale: value >= 100000, // >= 100K OMNIA is whale
          direction,
          exchangeInvolved,
        };
      });

      this.setCache(cacheKey, transfers);
      return transfers;
    } catch (error) {
      console.warn('[Etherscan] Transfers fetch error:', error);
      return [];
    }
  }

  /**
   * Get top token holders
   * Note: Etherscan doesn't have a direct API for this on free tier
   * This is a workaround using token transfers to approximate holders
   */
  async getTopHolders(limit: number = 20): Promise<TokenHolder[]> {
    const cacheKey = `holders_${limit}`;
    const cached = this.getCached<TokenHolder[]>(cacheKey, this.holdersCacheTTL);
    if (cached) return cached;

    // Note: Free Etherscan API doesn't have direct holder endpoint
    // This would require Etherscan Pro or scraping
    // For now, return a placeholder that can be enhanced later
    const holders: TokenHolder[] = [
      { address: '0x1234...dead', balance: 0, percentageOfSupply: 0, label: 'Data requires Etherscan Pro' },
    ];

    this.setCache(cacheKey, holders);
    return holders;
  }

  /**
   * Get wallet token balance
   */
  async getWalletBalance(address: string): Promise<WalletBalance | null> {
    const cacheKey = `balance_${address}`;
    const cached = this.getCached<WalletBalance>(cacheKey, this.transfersCacheTTL);
    if (cached) return cached;

    try {
      // V2 API requires chainid parameter
      const apiKeyParam = this.apiKey ? `&apikey=${this.apiKey}` : '';
      const url = `${this.baseUrl}?chainid=${this.ethChainId}&module=account&action=tokenbalance&contractaddress=${this.contractAddress}&address=${address}&tag=latest${apiKeyParam}`;
      const response = await this.rateLimitedFetch(url);

      if (!response.ok) {
        return null;
      }

      const data = await response.json();

      if (data.status !== '1') {
        return null;
      }

      const balance: WalletBalance = {
        address,
        balance: this.parseTokenValue(data.result),
        lastUpdated: Date.now(),
      };

      this.setCache(cacheKey, balance);
      return balance;
    } catch (error) {
      console.warn('[Etherscan] Balance fetch error:', error);
      return null;
    }
  }

  /**
   * Get whale transfers (> threshold amount)
   */
  async getWhaleTransfers(
    threshold: number = 100000,
    limit: number = 20
  ): Promise<TokenTransfer[]> {
    const transfers = await this.getTokenTransfers(1, 100);
    return transfers.filter(t => t.value >= threshold).slice(0, limit);
  }

  /**
   * Get transfers involving exchanges
   */
  async getExchangeTransfers(limit: number = 20): Promise<TokenTransfer[]> {
    const transfers = await this.getTokenTransfers(1, 100);
    return transfers.filter(t => t.exchangeInvolved !== null).slice(0, limit);
  }

  /**
   * Format transfer for display
   */
  formatTransfer(transfer: TokenTransfer): {
    from: string;
    to: string;
    amount: string;
    timeAgo: string;
    type: string;
  } {
    const fromLabel = this.getAddressLabel(transfer.from) || this.shortenAddress(transfer.from);
    const toLabel = this.getAddressLabel(transfer.to) || this.shortenAddress(transfer.to);

    const amount = transfer.value >= 1000000
      ? `${(transfer.value / 1000000).toFixed(2)}M`
      : transfer.value >= 1000
        ? `${(transfer.value / 1000).toFixed(1)}K`
        : transfer.value.toFixed(0);

    const now = Date.now();
    const diff = now - transfer.timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    let timeAgo: string;
    if (days > 0) {
      timeAgo = `${days}d ago`;
    } else if (hours > 0) {
      timeAgo = `${hours}h ago`;
    } else if (minutes > 0) {
      timeAgo = `${minutes}m ago`;
    } else {
      timeAgo = 'just now';
    }

    let type: string;
    if (transfer.isWhale) {
      type = '🐋 WHALE';
    } else if (transfer.direction === 'in') {
      type = '⬇️ Deposit';
    } else if (transfer.direction === 'out') {
      type = '⬆️ Withdrawal';
    } else {
      type = '↔️ Transfer';
    }

    return { from: fromLabel, to: toLabel, amount, timeAgo, type };
  }

  /**
   * Get contract info
   */
  getContractInfo(): {
    address: string;
    chain: string;
    explorerUrl: string;
  } {
    return {
      address: this.contractAddress,
      chain: 'Ethereum',
      explorerUrl: `https://etherscan.io/token/${this.contractAddress}`,
    };
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}

/**
 * CoinGecko API Client for OMNIA Protocol tracking
 * Free tier: 30 calls/min, 10,000 calls/month
 */

export interface PriceData {
  price: number;
  priceChange24h: number;
  priceChangePercent24h: number;
  marketCap: number;
  volume24h: number;
  circulatingSupply: number;
  totalSupply: number;
  ath: number;
  athChangePercent: number;
  athDate: string;
  lastUpdated: number;
}

export interface ChartDataPoint {
  timestamp: number;
  price: number;
}

export interface Exchange {
  name: string;
  pair: string;
  price: number;
  volume24h: number;
  volumePercent: number;
  trustScore: string;
  tradeUrl: string;
  lastUpdated: number;
}

export interface CoinGeckoMarketData {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  market_cap: number;
  total_volume: number;
  price_change_24h: number;
  price_change_percentage_24h: number;
  circulating_supply: number;
  total_supply: number;
  ath: number;
  ath_change_percentage: number;
  ath_date: string;
  last_updated: string;
}

export interface CoinGeckoTicker {
  base: string;
  target: string;
  market: {
    name: string;
    identifier: string;
    has_trading_incentive: boolean;
  };
  last: number;
  volume: number;
  converted_volume: {
    usd: number;
  };
  trust_score: string;
  trade_url: string;
  timestamp: string;
}

export class CoinGeckoClient {
  private baseUrl = 'https://api.coingecko.com/api/v3';
  private proBaseUrl = 'https://pro-api.coingecko.com/api/v3';
  private coinId = 'omnia-protocol';
  private apiKey: string;
  private timeout: number;
  private lastRequestTime: number = 0;
  private minRequestInterval: number = 2000; // 2 seconds between requests (30/min limit)

  // Cache for rate limiting
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private cacheTTL: number = 60000; // 60 second cache

  constructor(apiKey: string = '', timeout: number = 10000) {
    this.apiKey = apiKey;
    this.timeout = timeout;
  }

  private async rateLimitedFetch(url: string): Promise<Response> {
    // Respect rate limits
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

    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    // Use Pro API if key is provided
    const finalUrl = this.apiKey
      ? url.replace(this.baseUrl, this.proBaseUrl)
      : url;

    if (this.apiKey) {
      headers['x-cg-pro-api-key'] = this.apiKey;
    }

    try {
      const response = await fetch(finalUrl, {
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  private getCached<T>(key: string): T | null {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data as T;
    }
    return null;
  }

  private setCache(key: string, data: any): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  /**
   * Get current price and market data for OMNIA
   */
  async getPrice(): Promise<PriceData | null> {
    const cacheKey = 'price';
    const cached = this.getCached<PriceData>(cacheKey);
    if (cached) return cached;

    try {
      const url = `${this.baseUrl}/coins/${this.coinId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`;
      const response = await this.rateLimitedFetch(url);

      if (!response.ok) {
        console.warn(`[CoinGecko] Price fetch failed: ${response.status}`);
        return null;
      }

      const data = await response.json();
      const marketData = data.market_data;

      const priceData: PriceData = {
        price: marketData.current_price?.usd || 0,
        priceChange24h: marketData.price_change_24h || 0,
        priceChangePercent24h: marketData.price_change_percentage_24h || 0,
        marketCap: marketData.market_cap?.usd || 0,
        volume24h: marketData.total_volume?.usd || 0,
        circulatingSupply: marketData.circulating_supply || 0,
        totalSupply: marketData.total_supply || 100000000,
        ath: marketData.ath?.usd || 0,
        athChangePercent: marketData.ath_change_percentage?.usd || 0,
        athDate: marketData.ath_date?.usd || '',
        lastUpdated: Date.now(),
      };

      this.setCache(cacheKey, priceData);
      return priceData;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.warn('[CoinGecko] Price request timeout');
      } else {
        console.warn('[CoinGecko] Price fetch error:', error);
      }
      return null;
    }
  }

  /**
   * Get price chart data for specified number of days
   */
  async getMarketChart(days: number = 7): Promise<ChartDataPoint[]> {
    const cacheKey = `chart_${days}`;
    const cached = this.getCached<ChartDataPoint[]>(cacheKey);
    if (cached) return cached;

    try {
      const url = `${this.baseUrl}/coins/${this.coinId}/market_chart?vs_currency=usd&days=${days}`;
      const response = await this.rateLimitedFetch(url);

      if (!response.ok) {
        console.warn(`[CoinGecko] Chart fetch failed: ${response.status}`);
        return [];
      }

      const data = await response.json();
      const chartData: ChartDataPoint[] = (data.prices || []).map(
        ([timestamp, price]: [number, number]) => ({
          timestamp,
          price,
        })
      );

      this.setCache(cacheKey, chartData);
      return chartData;
    } catch (error) {
      console.warn('[CoinGecko] Chart fetch error:', error);
      return [];
    }
  }

  /**
   * Get exchange listings and tickers for OMNIA
   */
  async getExchangeTickers(): Promise<Exchange[]> {
    const cacheKey = 'exchanges';
    const cached = this.getCached<Exchange[]>(cacheKey);
    if (cached) return cached;

    try {
      const url = `${this.baseUrl}/coins/${this.coinId}/tickers?include_exchange_logo=false&depth=false`;
      const response = await this.rateLimitedFetch(url);

      if (!response.ok) {
        console.warn(`[CoinGecko] Tickers fetch failed: ${response.status}`);
        return [];
      }

      const data = await response.json();
      const tickers: CoinGeckoTicker[] = data.tickers || [];

      // Calculate total volume for percentage
      const totalVolume = tickers.reduce(
        (sum, t) => sum + (t.converted_volume?.usd || 0),
        0
      );

      const exchanges: Exchange[] = tickers.map((ticker) => ({
        name: ticker.market.name,
        pair: `${ticker.base}/${ticker.target}`,
        price: ticker.last,
        volume24h: ticker.converted_volume?.usd || 0,
        volumePercent: totalVolume > 0
          ? ((ticker.converted_volume?.usd || 0) / totalVolume) * 100
          : 0,
        trustScore: ticker.trust_score || 'low',
        tradeUrl: ticker.trade_url || '',
        lastUpdated: new Date(ticker.timestamp).getTime(),
      }));

      // Sort by volume
      exchanges.sort((a, b) => b.volume24h - a.volume24h);

      this.setCache(cacheKey, exchanges);
      return exchanges;
    } catch (error) {
      console.warn('[CoinGecko] Tickers fetch error:', error);
      return [];
    }
  }

  /**
   * Get simple price (lightweight call)
   */
  async getSimplePrice(): Promise<{ price: number; change24h: number } | null> {
    const cacheKey = 'simple_price';
    const cached = this.getCached<{ price: number; change24h: number }>(cacheKey);
    if (cached) return cached;

    try {
      const url = `${this.baseUrl}/simple/price?ids=${this.coinId}&vs_currencies=usd&include_24hr_change=true`;
      const response = await this.rateLimitedFetch(url);

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      const coinData = data[this.coinId];

      if (!coinData) return null;

      const result = {
        price: coinData.usd || 0,
        change24h: coinData.usd_24h_change || 0,
      };

      this.setCache(cacheKey, result);
      return result;
    } catch (error) {
      return null;
    }
  }

  /**
   * Clear cache (useful for forced refresh)
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Check if CoinGecko API is reachable
   */
  async ping(): Promise<boolean> {
    try {
      const response = await this.rateLimitedFetch(`${this.baseUrl}/ping`);
      return response.ok;
    } catch {
      return false;
    }
  }
}

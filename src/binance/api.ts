import https from 'https';

const BASE_URL = 'fapi.binance.com';

interface FundingRateInfo {
  symbol: string;
  fundingRate: number;
  fundingTime: number;
  markPrice: number;
}

interface OpenInterestInfo {
  symbol: string;
  openInterest: number;
  time: number;
}

interface KlineData {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

async function fetchJson<T>(path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BASE_URL,
      path,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

export async function getFundingRates(): Promise<FundingRateInfo[]> {
  const data = await fetchJson<any[]>('/fapi/v1/premiumIndex');

  return data.map((item) => ({
    symbol: item.symbol,
    fundingRate: parseFloat(item.lastFundingRate) * 100, // Convert to percentage
    fundingTime: item.nextFundingTime,
    markPrice: parseFloat(item.markPrice),
  }));
}

export async function getOpenInterest(symbol: string): Promise<OpenInterestInfo> {
  const data = await fetchJson<any>(`/fapi/v1/openInterest?symbol=${symbol}`);

  return {
    symbol: data.symbol,
    openInterest: parseFloat(data.openInterest),
    time: data.time,
  };
}

export async function getAllOpenInterest(): Promise<OpenInterestInfo[]> {
  // Get all symbols first, then batch fetch OI
  const tickers = await fetchJson<any[]>('/fapi/v1/ticker/24hr');
  const symbols = tickers
    .filter((t) => t.symbol.endsWith('USDT'))
    .slice(0, 100) // Limit to top 100 to avoid rate limits
    .map((t) => t.symbol);

  const results: OpenInterestInfo[] = [];

  // Fetch in batches of 10 with delay to avoid rate limits
  for (let i = 0; i < symbols.length; i += 10) {
    const batch = symbols.slice(i, i + 10);
    const promises = batch.map((symbol) =>
      getOpenInterest(symbol).catch(() => null)
    );
    const batchResults = await Promise.all(promises);
    results.push(...batchResults.filter((r): r is OpenInterestInfo => r !== null));

    if (i + 10 < symbols.length) {
      await new Promise((r) => setTimeout(r, 100)); // Small delay between batches
    }
  }

  return results;
}

export async function getKlines(
  symbol: string,
  interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d',
  limit: number = 100
): Promise<KlineData[]> {
  const data = await fetchJson<any[]>(
    `/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
  );

  return data.map((k) => ({
    openTime: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
    closeTime: k[6],
  }));
}

export async function getMultiTimeframeChanges(symbol: string): Promise<{
  change15m: number;
  change1h: number;
  change4h: number;
  change24h: number;
}> {
  try {
    const [klines15m, klines1h, klines4h] = await Promise.all([
      getKlines(symbol, '15m', 2),
      getKlines(symbol, '1h', 2),
      getKlines(symbol, '4h', 2),
    ]);

    const calcChange = (klines: KlineData[]) => {
      if (klines.length < 2) return 0;
      const prev = klines[0].close;
      const curr = klines[1].close;
      return ((curr - prev) / prev) * 100;
    };

    // For 24h, we need more candles
    const klines24h = await getKlines(symbol, '1h', 25);
    const change24h = klines24h.length >= 24
      ? ((klines24h[klines24h.length - 1].close - klines24h[0].close) / klines24h[0].close) * 100
      : 0;

    return {
      change15m: calcChange(klines15m),
      change1h: calcChange(klines1h),
      change4h: calcChange(klines4h),
      change24h,
    };
  } catch {
    return { change15m: 0, change1h: 0, change4h: 0, change24h: 0 };
  }
}

// Calculate RSI from klines
export function calculateRSI(closes: number[], period: number = 14): number {
  if (closes.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) {
      gains += change;
    } else {
      losses -= change;
    }
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) {
      avgGain = (avgGain * (period - 1) + change) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - change) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

export async function getSymbolRSI(symbol: string, interval: '15m' | '1h' | '4h' = '1h'): Promise<number> {
  try {
    const klines = await getKlines(symbol, interval, 50);
    const closes = klines.map((k) => k.close);
    return calculateRSI(closes);
  } catch {
    return 50;
  }
}

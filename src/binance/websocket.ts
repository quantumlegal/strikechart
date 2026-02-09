import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { config } from '../config.js';
import { BinanceTicker, TickerData, ConnectionStatus } from './types.js';

export class BinanceWebSocket extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private _status: ConnectionStatus = 'disconnected';
  private symbolCount: number = 0;

  // Watchdog & backoff fields
  private _lastDataReceived: number = 0;
  private _reconnectAttempts: number = 0;
  private static readonly BACKOFF_BASE_MS = 1000;
  private static readonly BACKOFF_MAX_MS = 60000;
  private static readonly BACKOFF_JITTER_MS = 1000;

  get status(): ConnectionStatus {
    return this._status;
  }

  get symbols(): number {
    return this.symbolCount;
  }

  getLastDataTime(): number {
    return this._lastDataReceived;
  }

  getReconnectAttempts(): number {
    return this._reconnectAttempts;
  }

  forceReconnect(): void {
    console.log('[WebSocket] Force reconnect triggered by watchdog');
    this._reconnectAttempts = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    this.connect();
  }

  connect(): void {
    if (this.ws) {
      try { this.ws.close(); } catch {}
    }

    this._status = 'connecting';
    this.emit('statusChange', this._status);

    this.ws = new WebSocket(config.websocket.url);

    this.ws.on('open', () => {
      this._status = 'connected';
      this._reconnectAttempts = 0;
      this._lastDataReceived = Date.now();
      this.emit('statusChange', this._status);
      this.emit('connected');
    });

    this.ws.on('message', (data: WebSocket.RawData) => {
      try {
        this._lastDataReceived = Date.now();
        const tickers: BinanceTicker[] = JSON.parse(data.toString());
        this.symbolCount = tickers.length;

        const parsedTickers = tickers.map(this.parseTicker);
        this.emit('tickers', parsedTickers);
      } catch (error) {
        this.emit('error', error);
      }
    });

    this.ws.on('error', (error) => {
      this._status = 'error';
      this.emit('statusChange', this._status);
      this.emit('error', error);
    });

    this.ws.on('close', () => {
      this._status = 'disconnected';
      this.emit('statusChange', this._status);
      this.emit('disconnected');
      this.scheduleReconnect();
    });
  }

  private parseTicker(ticker: BinanceTicker): TickerData {
    return {
      symbol: ticker.s,
      lastPrice: parseFloat(ticker.c),
      priceChange: parseFloat(ticker.p),
      priceChangePercent: parseFloat(ticker.P),
      openPrice: parseFloat(ticker.o),
      highPrice: parseFloat(ticker.h),
      lowPrice: parseFloat(ticker.l),
      volume: parseFloat(ticker.v),
      quoteVolume: parseFloat(ticker.q),
      trades: ticker.n,
      eventTime: ticker.E,
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    // Exponential backoff: min(base * 2^attempts, max) + random jitter
    const delay = Math.min(
      BinanceWebSocket.BACKOFF_BASE_MS * Math.pow(2, this._reconnectAttempts),
      BinanceWebSocket.BACKOFF_MAX_MS
    ) + Math.random() * BinanceWebSocket.BACKOFF_JITTER_MS;

    this._reconnectAttempts++;
    console.log(`[WebSocket] Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt #${this._reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.emit('reconnecting');
      this.connect();
    }, delay);
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this._status = 'disconnected';
    this.emit('statusChange', this._status);
  }
}

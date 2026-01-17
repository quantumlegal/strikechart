import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { config } from '../config.js';
import { BinanceTicker, TickerData, ConnectionStatus } from './types.js';

export class BinanceWebSocket extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private _status: ConnectionStatus = 'disconnected';
  private symbolCount: number = 0;

  get status(): ConnectionStatus {
    return this._status;
  }

  get symbols(): number {
    return this.symbolCount;
  }

  connect(): void {
    if (this.ws) {
      this.ws.close();
    }

    this._status = 'connecting';
    this.emit('statusChange', this._status);

    this.ws = new WebSocket(config.websocket.url);

    this.ws.on('open', () => {
      this._status = 'connected';
      this.emit('statusChange', this._status);
      this.emit('connected');
    });

    this.ws.on('message', (data: WebSocket.RawData) => {
      try {
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

    this.reconnectTimer = setTimeout(() => {
      this.emit('reconnecting');
      this.connect();
    }, config.websocket.reconnectDelayMs);
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

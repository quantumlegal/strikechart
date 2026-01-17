import blessed from 'blessed';
import contrib from 'blessed-contrib';
import { spawn } from 'child_process';
import { config } from '../config.js';
import { OpportunityRanker } from '../core/opportunity.js';
import { DataStore } from '../core/dataStore.js';
import { ConnectionStatus } from '../binance/types.js';
import { generateBinanceUrl } from '../utils/links.js';
import {
  formatPercent,
  formatMultiplier,
  formatVelocity,
  formatDirection,
  formatTrend,
  formatPosition,
  formatSymbol,
  formatConnectionStatus,
  colors,
} from './formatters.js';

export class Dashboard {
  private screen: blessed.Widgets.Screen;
  private grid: any;
  private topMoversBox: blessed.Widgets.BoxElement;
  private velocityBox: blessed.Widgets.BoxElement;
  private volumeBox: blessed.Widgets.BoxElement;
  private breakoutBox: blessed.Widgets.BoxElement;
  private statusBar: blessed.Widgets.BoxElement;
  private helpBar: blessed.Widgets.BoxElement;

  private connectionStatus: ConnectionStatus = 'disconnected';
  private symbolCount: number = 0;
  private soundEnabled: boolean = config.alerts.soundEnabled;

  private displayedSymbols: string[] = [];
  private onKeyCallback: ((key: string) => void) | null = null;

  constructor(
    private dataStore: DataStore,
    private opportunityRanker: OpportunityRanker
  ) {
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'STRIKECHART v1.0 - Binance Futures Volatility Hunter',
      fullUnicode: true,
    });

    this.grid = new contrib.grid({ rows: 12, cols: 12, screen: this.screen });

    // Top movers panel (left side, top)
    this.topMoversBox = this.grid.set(0, 0, 5, 6, blessed.box, {
      label: ' TOP MOVERS (24H) ',
      border: { type: 'line' },
      style: {
        border: { fg: 'cyan' },
        label: { fg: 'white', bold: true },
      },
      tags: true,
      scrollable: true,
      padding: { left: 1, right: 1 },
    });

    // Velocity alerts panel (right side, top)
    this.velocityBox = this.grid.set(0, 6, 5, 6, blessed.box, {
      label: ' VELOCITY ALERTS ',
      border: { type: 'line' },
      style: {
        border: { fg: 'yellow' },
        label: { fg: 'white', bold: true },
      },
      tags: true,
      scrollable: true,
      padding: { left: 1, right: 1 },
    });

    // Volume spikes panel (left side, middle)
    this.volumeBox = this.grid.set(5, 0, 4, 6, blessed.box, {
      label: ' VOLUME SPIKES ',
      border: { type: 'line' },
      style: {
        border: { fg: 'magenta' },
        label: { fg: 'white', bold: true },
      },
      tags: true,
      scrollable: true,
      padding: { left: 1, right: 1 },
    });

    // Breakout candidates panel (right side, middle)
    this.breakoutBox = this.grid.set(5, 6, 4, 6, blessed.box, {
      label: ' BREAKOUT CANDIDATES ',
      border: { type: 'line' },
      style: {
        border: { fg: 'green' },
        label: { fg: 'white', bold: true },
      },
      tags: true,
      scrollable: true,
      padding: { left: 1, right: 1 },
    });

    // Status bar
    this.statusBar = this.grid.set(9, 0, 1, 12, blessed.box, {
      border: { type: 'line' },
      style: {
        border: { fg: 'white' },
      },
      tags: true,
      padding: { left: 1, right: 1 },
    });

    // Help bar
    this.helpBar = this.grid.set(10, 0, 2, 12, blessed.box, {
      border: { type: 'line' },
      style: {
        border: { fg: 'gray' },
      },
      tags: true,
      padding: { left: 1, right: 1 },
      content: '{center}[1-5: Open in Browser] [R: Refresh] [T: Toggle Sound] [Q: Quit]{/center}',
    });

    this.setupKeyBindings();
  }

  private setupKeyBindings(): void {
    // Quit
    this.screen.key(['q', 'C-c', 'escape'], () => {
      this.screen.destroy();
      process.exit(0);
    });

    // Refresh
    this.screen.key(['r'], () => {
      this.refresh();
    });

    // Toggle sound
    this.screen.key(['t'], () => {
      this.soundEnabled = !this.soundEnabled;
      if (this.onKeyCallback) {
        this.onKeyCallback('toggleSound');
      }
      this.updateStatusBar();
    });

    // Number keys to open in browser
    for (let i = 1; i <= 9; i++) {
      this.screen.key([i.toString()], () => {
        const symbol = this.displayedSymbols[i - 1];
        if (symbol) {
          const url = generateBinanceUrl(symbol);
          this.openInBrowser(url);
        }
      });
    }
  }

  private openInBrowser(url: string): void {
    const platform = process.platform;

    // Use spawn with proper arguments to avoid shell injection
    if (platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
    } else if (platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' });
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    }
  }

  onKey(callback: (key: string) => void): void {
    this.onKeyCallback = callback;
  }

  setConnectionStatus(status: ConnectionStatus, symbols: number): void {
    this.connectionStatus = status;
    this.symbolCount = symbols;
    this.updateStatusBar();
  }

  setSoundEnabled(enabled: boolean): void {
    this.soundEnabled = enabled;
    this.updateStatusBar();
  }

  private updateStatusBar(): void {
    const soundStatus = this.soundEnabled
      ? `${colors.green}ON${colors.reset}`
      : `${colors.red}OFF${colors.reset}`;

    this.statusBar.setContent(
      `STRIKECHART v1.0 | ${formatConnectionStatus(this.connectionStatus, this.symbolCount)} | Sound: ${soundStatus}`
    );
    this.screen.render();
  }

  refresh(): void {
    this.displayedSymbols = [];

    // Update top movers
    const topMovers = this.opportunityRanker.getVolatilityDetector().getTopMovers(config.ui.maxDisplayed);
    let topMoversContent = '';
    topMovers.forEach((alert, index) => {
      if (index < 5) {
        this.displayedSymbols.push(alert.symbol);
      }
      const change = alert.change24h >= 0
        ? `${colors.green}${formatPercent(alert.change24h)}${colors.reset}`
        : `${colors.red}${formatPercent(alert.change24h)}${colors.reset}`;
      const critical = alert.isCritical ? ` ${colors.red}!!!${colors.reset}` : '';
      topMoversContent += `${index + 1}. ${formatSymbol(alert.symbol)} ${change} ${formatDirection(alert.direction)}${critical}\n`;
    });
    this.topMoversBox.setContent(topMoversContent || '{gray-fg}No significant movers{/}');

    // Update velocity alerts
    const velocityAlerts = this.opportunityRanker.getVelocityDetector().getTopVelocity(config.ui.maxDisplayed);
    let velocityContent = '';
    velocityAlerts.forEach((alert, index) => {
      const velocity = alert.velocity >= 0
        ? `${colors.green}${formatVelocity(alert.velocity)}${colors.reset}`
        : `${colors.red}${formatVelocity(alert.velocity)}${colors.reset}`;
      const trendIcon = alert.trend === 'Accelerating' ? '↗' : alert.trend === 'Decelerating' ? '↘' : '→';
      velocityContent += `${formatSymbol(alert.symbol)} ${velocity} ${trendIcon} ${formatTrend(alert.trend)}\n`;
    });
    this.velocityBox.setContent(velocityContent || '{gray-fg}No velocity alerts{/}');

    // Update volume spikes
    const volumeSpikes = this.opportunityRanker.getVolumeDetector().getTopSpikes(config.ui.maxDisplayed);
    let volumeContent = '';
    volumeSpikes.forEach((alert) => {
      const change = alert.priceChange >= 0
        ? `${colors.green}${formatPercent(alert.priceChange)}${colors.reset}`
        : `${colors.red}${formatPercent(alert.priceChange)}${colors.reset}`;
      volumeContent += `${formatSymbol(alert.symbol)} Vol: ${colors.magenta}${formatMultiplier(alert.multiplier)} avg${colors.reset} ${change}\n`;
    });
    this.volumeBox.setContent(volumeContent || '{gray-fg}No volume spikes{/}');

    // Update breakout candidates
    const rangeAlerts = this.opportunityRanker.getRangeDetector().getNearHighs().slice(0, config.ui.maxDisplayed);
    let breakoutContent = '';
    rangeAlerts.forEach((alert) => {
      breakoutContent += `${formatSymbol(alert.symbol)} Range: ${colors.cyan}${alert.range.toFixed(1)}%${colors.reset} ${formatPosition(alert.position)}\n`;
    });
    this.breakoutBox.setContent(breakoutContent || '{gray-fg}No breakout candidates{/}');

    this.updateStatusBar();
    this.screen.render();
  }

  start(): void {
    this.screen.render();
  }

  destroy(): void {
    this.screen.destroy();
  }
}

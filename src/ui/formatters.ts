// Color codes for blessed terminal UI
export const colors = {
  green: '{green-fg}',
  red: '{red-fg}',
  yellow: '{yellow-fg}',
  cyan: '{cyan-fg}',
  magenta: '{magenta-fg}',
  white: '{white-fg}',
  gray: '{#888888-fg}',
  reset: '{/}',
};

export function formatPercent(value: number, decimals: number = 2): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

export function formatPrice(value: number): string {
  if (value >= 1000) {
    return value.toFixed(2);
  } else if (value >= 1) {
    return value.toFixed(4);
  } else if (value >= 0.001) {
    return value.toFixed(6);
  } else {
    return value.toFixed(8);
  }
}

export function formatVolume(value: number): string {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)}B`;
  } else if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  } else if (value >= 1_000) {
    return `${(value / 1_000).toFixed(2)}K`;
  }
  return value.toFixed(2);
}

export function formatMultiplier(value: number): string {
  return `${value.toFixed(1)}x`;
}

export function formatVelocity(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%/min`;
}

export function colorize(text: string, value: number): string {
  const color = value >= 0 ? colors.green : colors.red;
  return `${color}${text}${colors.reset}`;
}

export function colorizePercent(value: number, decimals: number = 2): string {
  return colorize(formatPercent(value, decimals), value);
}

export function formatDirection(direction: 'LONG' | 'SHORT' | 'NEUTRAL'): string {
  switch (direction) {
    case 'LONG':
      return `${colors.green}[LONG ->]${colors.reset}`;
    case 'SHORT':
      return `${colors.red}[SHORT ->]${colors.reset}`;
    default:
      return `${colors.gray}[NEUTRAL]${colors.reset}`;
  }
}

export function formatTrend(trend: 'Accelerating' | 'Steady' | 'Decelerating'): string {
  switch (trend) {
    case 'Accelerating':
      return `${colors.green}Accelerating${colors.reset}`;
    case 'Steady':
      return `${colors.yellow}Steady${colors.reset}`;
    case 'Decelerating':
      return `${colors.red}Decelerating${colors.reset}`;
  }
}

export function formatPosition(position: 'Near High' | 'Near Low' | 'Middle' | 'Breaking'): string {
  switch (position) {
    case 'Near High':
      return `${colors.green}Near High${colors.reset}`;
    case 'Near Low':
      return `${colors.red}Near Low${colors.reset}`;
    case 'Breaking':
      return `${colors.magenta}Breaking${colors.reset}`;
    default:
      return `${colors.gray}Middle${colors.reset}`;
  }
}

export function formatSymbol(symbol: string, maxLength: number = 12): string {
  if (symbol.length <= maxLength) {
    return symbol.padEnd(maxLength);
  }
  return symbol.slice(0, maxLength - 1) + '~';
}

export function formatScore(score: number): string {
  if (score >= 70) {
    return `${colors.green}${score}${colors.reset}`;
  } else if (score >= 40) {
    return `${colors.yellow}${score}${colors.reset}`;
  } else {
    return `${colors.gray}${score}${colors.reset}`;
  }
}

export function formatConnectionStatus(status: string, symbolCount: number): string {
  switch (status) {
    case 'connected':
      return `${colors.green}Connected{/} | Symbols: ${symbolCount}`;
    case 'connecting':
      return `${colors.yellow}Connecting...{/}`;
    case 'disconnected':
      return `${colors.red}Disconnected{/}`;
    case 'error':
      return `${colors.red}Error{/}`;
    default:
      return status;
  }
}

export function padRight(text: string, length: number): string {
  // Account for color codes which don't take up visual space
  const cleanText = text.replace(/\{[^}]+\}/g, '');
  const padding = Math.max(0, length - cleanText.length);
  return text + ' '.repeat(padding);
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 3) + '...';
}

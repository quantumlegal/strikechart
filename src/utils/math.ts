/**
 * Calculate the average of an array of numbers
 */
export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

/**
 * Calculate the standard deviation of an array of numbers
 */
export function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = average(values);
  const squaredDiffs = values.map((val) => Math.pow(val - avg, 2));
  return Math.sqrt(average(squaredDiffs));
}

/**
 * Calculate the z-score of a value
 */
export function zScore(value: number, mean: number, stdDev: number): number {
  if (stdDev === 0) return 0;
  return (value - mean) / stdDev;
}

/**
 * Calculate percentage change between two values
 */
export function percentChange(oldValue: number, newValue: number): number {
  if (oldValue === 0) return 0;
  return ((newValue - oldValue) / oldValue) * 100;
}

/**
 * Calculate the exponential moving average
 */
export function ema(values: number[], period: number): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];

  const k = 2 / (period + 1);
  let result = values[0];

  for (let i = 1; i < values.length; i++) {
    result = values[i] * k + result * (1 - k);
  }

  return result;
}

/**
 * Calculate the simple moving average
 */
export function sma(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const slice = values.slice(-period);
  return average(slice);
}

/**
 * Calculate the rate of change (velocity)
 */
export function rateOfChange(values: number[], periods: number = 1): number {
  if (values.length < periods + 1) return 0;
  const current = values[values.length - 1];
  const previous = values[values.length - 1 - periods];
  return percentChange(previous, current);
}

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Linear interpolation
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

/**
 * Map a value from one range to another
 */
export function mapRange(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number
): number {
  const normalized = (value - inMin) / (inMax - inMin);
  return lerp(outMin, outMax, normalized);
}

/**
 * Calculate a composite score from multiple weighted factors
 */
export function compositeScore(
  factors: { value: number; weight: number; min?: number; max?: number }[]
): number {
  let totalWeight = 0;
  let weightedSum = 0;

  for (const factor of factors) {
    const normalizedValue = factor.min !== undefined && factor.max !== undefined
      ? mapRange(clamp(factor.value, factor.min, factor.max), factor.min, factor.max, 0, 100)
      : clamp(factor.value, 0, 100);

    weightedSum += normalizedValue * factor.weight;
    totalWeight += factor.weight;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

/**
 * Calculate the median of an array
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Calculate the percentile rank of a value in an array
 */
export function percentileRank(values: number[], value: number): number {
  if (values.length === 0) return 0;
  const below = values.filter((v) => v < value).length;
  return (below / values.length) * 100;
}

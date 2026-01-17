import { SignalFeatures, MLPrediction } from '../storage/sqlite.js';
import { config } from '../config.js';

// ML Service response types
interface PredictResponse {
  prediction: MLPrediction;
}

interface PredictBatchResponse {
  predictions: Record<string, MLPrediction>;
}

interface MLServiceStatus {
  status: string;
  model_loaded: boolean;
  model_version: string | null;
  uptime_seconds: number;
}

interface MLModelStats {
  model_loaded: boolean;
  model_version: string | null;
  training_date: string | null;
  training_samples: number | null;
  validation_auc: number | null;
  validation_accuracy: number | null;
  predictions_made: number;
  feature_importance: Record<string, number> | null;
}

interface TrainResponse {
  status: string;
  model_version: string;
  training_samples: number;
  validation_auc: number;
  validation_accuracy: number;
  feature_importance: Record<string, number>;
  message: string;
}

// Prediction cache entry
interface CacheEntry {
  prediction: MLPrediction;
  timestamp: number;
}

export class MLServiceClient {
  private serviceUrl: string;
  private timeout: number;
  private enabled: boolean;
  private serviceAvailable: boolean = false;
  private lastHealthCheck: number = 0;
  private healthCheckInterval: number = 30000; // 30 seconds
  private predictionCache: Map<string, CacheEntry> = new Map();
  private cacheTTL: number = 5000; // 5 second cache
  private modelVersion: string | null = null;

  constructor(
    serviceUrl: string = config.ml?.serviceUrl || 'http://localhost:8000',
    timeout: number = config.ml?.timeout || 2000,
    enabled: boolean = config.ml?.enabled ?? true
  ) {
    this.serviceUrl = serviceUrl;
    this.timeout = timeout;
    this.enabled = enabled;

    // Initial health check
    if (this.enabled) {
      this.checkHealth();
    }
  }

  // Check if service is available
  async checkHealth(): Promise<boolean> {
    if (!this.enabled) return false;

    const now = Date.now();

    // Use cached result if recent
    if (now - this.lastHealthCheck < this.healthCheckInterval) {
      return this.serviceAvailable;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.serviceUrl}/health`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data: MLServiceStatus = await response.json();
        this.serviceAvailable = data.status === 'healthy';
        this.modelVersion = data.model_version;
        this.lastHealthCheck = now;
        return this.serviceAvailable && data.model_loaded;
      }
    } catch (error) {
      // Service unavailable - this is fine, we'll fallback to rule-based
      this.serviceAvailable = false;
    }

    this.lastHealthCheck = now;
    return false;
  }

  // Get service availability (cached)
  isServiceAvailable(): boolean {
    return this.enabled && this.serviceAvailable;
  }

  // Get model version
  getModelVersion(): string | null {
    return this.modelVersion;
  }

  // Convert features to API format
  private featuresToApiFormat(features: SignalFeatures): Record<string, any> {
    return {
      signal_id: features.signal_id,
      symbol: features.symbol,
      price_change_24h: features.price_change_24h,
      price_change_1h: features.price_change_1h,
      price_change_15m: features.price_change_15m,
      price_change_5m: features.price_change_5m,
      high_low_range: features.high_low_range,
      price_position: features.price_position,
      volume_quote_24h: features.volume_quote_24h,
      volume_multiplier: features.volume_multiplier,
      volume_change_1h: features.volume_change_1h,
      velocity: features.velocity,
      acceleration: features.acceleration,
      trend_state: features.trend_state,
      rsi_1h: features.rsi_1h,
      mtf_alignment: features.mtf_alignment,
      divergence_type: features.divergence_type,
      funding_rate: features.funding_rate,
      funding_signal: features.funding_signal,
      funding_direction_match: features.funding_direction_match,
      oi_change_percent: features.oi_change_percent,
      oi_signal: features.oi_signal,
      oi_price_alignment: features.oi_price_alignment,
      pattern_type: features.pattern_type,
      pattern_confidence: features.pattern_confidence,
      distance_from_level: features.distance_from_level,
      smart_confidence: features.smart_confidence,
      component_count: features.component_count,
      entry_type: features.entry_type,
      risk_level: features.risk_level,
      atr_percent: features.atr_percent,
      vwap_distance: features.vwap_distance,
      risk_reward_ratio: features.risk_reward_ratio,
      whale_activity: features.whale_activity,
      btc_correlation: features.btc_correlation,
      btc_outperformance: features.btc_outperformance,
      direction: features.direction,
    };
  }

  // Get prediction for a single signal
  async predict(features: SignalFeatures): Promise<MLPrediction | null> {
    if (!this.enabled || !this.serviceAvailable) {
      return null;
    }

    // Check cache
    const cacheKey = features.signal_id;
    const cached = this.predictionCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.prediction;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.serviceUrl}/api/v1/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ features: this.featuresToApiFormat(features) }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn(`[MLClient] Prediction failed: ${response.status}`);
        return null;
      }

      const data: PredictResponse = await response.json();
      const prediction = data.prediction;

      // Cache result
      this.predictionCache.set(cacheKey, {
        prediction,
        timestamp: Date.now(),
      });

      // Cleanup old cache entries
      this.cleanupCache();

      return prediction;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.warn('[MLClient] Prediction timeout');
      } else {
        console.warn('[MLClient] Prediction error:', error);
      }
      return null;
    }
  }

  // Get predictions for multiple signals (batch)
  async predictBatch(featuresList: SignalFeatures[]): Promise<Map<string, MLPrediction>> {
    const results = new Map<string, MLPrediction>();

    if (!this.enabled || !this.serviceAvailable || featuresList.length === 0) {
      return results;
    }

    // Check cache first
    const uncached: SignalFeatures[] = [];
    for (const features of featuresList) {
      const cached = this.predictionCache.get(features.signal_id);
      if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
        results.set(features.signal_id, cached.prediction);
      } else {
        uncached.push(features);
      }
    }

    // If all cached, return
    if (uncached.length === 0) {
      return results;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout * 2); // Longer timeout for batch

      const response = await fetch(`${this.serviceUrl}/api/v1/predict/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          features_list: uncached.map(f => this.featuresToApiFormat(f)),
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn(`[MLClient] Batch prediction failed: ${response.status}`);
        return results;
      }

      const data: PredictBatchResponse = await response.json();

      // Cache and add to results
      for (const [signalId, prediction] of Object.entries(data.predictions)) {
        results.set(signalId, prediction);
        this.predictionCache.set(signalId, {
          prediction,
          timestamp: Date.now(),
        });
      }

      this.cleanupCache();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.warn('[MLClient] Batch prediction timeout');
      } else {
        console.warn('[MLClient] Batch prediction error:', error);
      }
    }

    return results;
  }

  // Get model statistics
  async getStats(): Promise<MLModelStats | null> {
    if (!this.enabled) return null;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.serviceUrl}/api/v1/stats`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      console.warn('[MLClient] Failed to get stats:', error);
    }

    return null;
  }

  // Trigger model training (sends data to ML service)
  async triggerTraining(trainingData: SignalFeatures[]): Promise<TrainResponse | null> {
    if (!this.enabled) return null;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout for training

      const response = await fetch(`${this.serviceUrl}/api/v1/train/sqlite-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(trainingData),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const result = await response.json();
        this.modelVersion = result.model_version;
        return result;
      } else {
        const error = await response.text();
        console.warn('[MLClient] Training failed:', error);
      }
    } catch (error) {
      console.warn('[MLClient] Training error:', error);
    }

    return null;
  }

  // Reload model from disk
  async reloadModel(): Promise<boolean> {
    if (!this.enabled) return false;

    try {
      const response = await fetch(`${this.serviceUrl}/api/v1/reload`, {
        method: 'POST',
      });

      if (response.ok) {
        const data = await response.json();
        this.modelVersion = data.model_version;
        return data.status === 'success';
      }
    } catch (error) {
      console.warn('[MLClient] Reload failed:', error);
    }

    return false;
  }

  // Cleanup old cache entries
  private cleanupCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.predictionCache) {
      if (now - entry.timestamp > this.cacheTTL * 10) {
        this.predictionCache.delete(key);
      }
    }
  }

  // Get status summary for API
  getStatus(): {
    enabled: boolean;
    serviceAvailable: boolean;
    modelVersion: string | null;
    cacheSize: number;
  } {
    return {
      enabled: this.enabled,
      serviceAvailable: this.serviceAvailable,
      modelVersion: this.modelVersion,
      cacheSize: this.predictionCache.size,
    };
  }
}

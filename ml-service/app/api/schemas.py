from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Any
from enum import Enum


class QualityTier(str, Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"
    FILTER = "FILTER"


class SignalFeatures(BaseModel):
    """Input features for ML prediction"""
    signal_id: str
    symbol: str

    # Price features
    price_change_24h: float = 0.0
    price_change_1h: float = 0.0
    price_change_15m: float = 0.0
    price_change_5m: float = 0.0
    high_low_range: float = 0.0
    price_position: float = 0.5

    # Volume features
    volume_quote_24h: float = 0.0
    volume_multiplier: float = 1.0
    volume_change_1h: float = 0.0

    # Momentum features
    velocity: float = 0.0
    acceleration: float = 0.0
    trend_state: int = 0

    # Technical features
    rsi_1h: float = 50.0
    mtf_alignment: int = 0
    divergence_type: int = 0

    # Funding features
    funding_rate: float = 0.0
    funding_signal: int = 0
    funding_direction_match: int = 0

    # Open Interest features
    oi_change_percent: float = 0.0
    oi_signal: int = 0
    oi_price_alignment: int = 0

    # Pattern features
    pattern_type: int = 0
    pattern_confidence: float = 0.0
    distance_from_level: float = 0.0

    # Smart Signal features
    smart_confidence: float = 0.0
    component_count: int = 0
    entry_type: int = 0
    risk_level: int = 1

    # Entry timing features
    atr_percent: float = 0.0
    vwap_distance: float = 0.0
    risk_reward_ratio: float = 1.5

    # Whale/Correlation features
    whale_activity: float = 0.0
    btc_correlation: float = 0.0
    btc_outperformance: float = 0.0

    # Direction
    direction: int = 1  # 1 = LONG, -1 = SHORT


class MLPrediction(BaseModel):
    """ML prediction result"""
    signal_id: str
    win_probability: float = Field(..., ge=0.0, le=1.0)
    quality_tier: QualityTier
    confidence: float = Field(..., ge=0.0, le=100.0)
    should_filter: bool
    model_version: str
    xgboost_prob: Optional[float] = None
    lightgbm_prob: Optional[float] = None


class PredictRequest(BaseModel):
    """Single prediction request"""
    features: SignalFeatures


class PredictBatchRequest(BaseModel):
    """Batch prediction request"""
    features_list: List[SignalFeatures]


class PredictResponse(BaseModel):
    """Single prediction response"""
    prediction: MLPrediction


class PredictBatchResponse(BaseModel):
    """Batch prediction response"""
    predictions: Dict[str, MLPrediction]


class TrainingData(BaseModel):
    """Training data format"""
    signal_id: str
    features: List[float]
    outcome: int  # 1 = WIN, 0 = LOSS


class TrainRequest(BaseModel):
    """Training request with data"""
    training_data: Optional[List[TrainingData]] = None
    csv_path: Optional[str] = None


class TrainResponse(BaseModel):
    """Training response"""
    status: str
    model_version: str
    training_samples: int
    validation_auc: float
    validation_accuracy: float
    feature_importance: Dict[str, float]
    message: str


class ModelStats(BaseModel):
    """Model statistics"""
    model_loaded: bool
    model_version: Optional[str]
    training_date: Optional[str]
    training_samples: Optional[int]
    validation_auc: Optional[float]
    validation_accuracy: Optional[float]
    predictions_made: int
    feature_importance: Optional[Dict[str, float]]


class HealthResponse(BaseModel):
    """Health check response"""
    status: str
    model_loaded: bool
    model_version: Optional[str]
    uptime_seconds: float

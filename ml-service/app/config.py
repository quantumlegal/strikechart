import os
from pathlib import Path

# Base directory
BASE_DIR = Path(__file__).parent.parent

# Model directory
MODEL_DIR = BASE_DIR / "models"
MODEL_DIR.mkdir(exist_ok=True)

# Model configuration
MODEL_CONFIG = {
    "xgboost_weight": 0.6,
    "lightgbm_weight": 0.4,
    "min_training_samples": 500,
    "validation_split": 0.2,
    "random_state": 42,
}

# XGBoost parameters
XGBOOST_PARAMS = {
    "n_estimators": 200,
    "max_depth": 6,
    "learning_rate": 0.05,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "min_child_weight": 3,
    "gamma": 0.1,
    "reg_alpha": 0.1,
    "reg_lambda": 1.0,
    "scale_pos_weight": 1.0,  # Will be calculated based on class imbalance
    "random_state": 42,
    "n_jobs": -1,
    "objective": "binary:logistic",
    "eval_metric": "auc",
}

# LightGBM parameters
LIGHTGBM_PARAMS = {
    "n_estimators": 200,
    "max_depth": 6,
    "learning_rate": 0.05,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "min_child_samples": 20,
    "reg_alpha": 0.1,
    "reg_lambda": 1.0,
    "random_state": 42,
    "n_jobs": -1,
    "objective": "binary",
    "metric": "auc",
    "verbosity": -1,
    "force_col_wise": True,
}

# Feature names (must match Node.js FeatureExtractor order)
FEATURE_NAMES = [
    "price_change_24h",
    "price_change_1h",
    "price_change_15m",
    "price_change_5m",
    "high_low_range",
    "price_position",
    "volume_quote_24h",
    "volume_multiplier",
    "volume_change_1h",
    "velocity",
    "acceleration",
    "trend_state",
    "rsi_1h",
    "mtf_alignment",
    "divergence_type",
    "funding_rate",
    "funding_signal",
    "funding_direction_match",
    "oi_change_percent",
    "oi_signal",
    "oi_price_alignment",
    "pattern_type",
    "pattern_confidence",
    "distance_from_level",
    "smart_confidence",
    "component_count",
    "entry_type",
    "risk_level",
    "atr_percent",
    "vwap_distance",
    "risk_reward_ratio",
    "whale_activity",
    "btc_correlation",
    "btc_outperformance",
    "direction",
]

# Quality tier thresholds
QUALITY_TIERS = {
    "HIGH": 0.70,     # >= 70% win probability
    "MEDIUM": 0.55,   # >= 55%
    "LOW": 0.40,      # >= 40%
    "FILTER": 0.0,    # < 40%
}

# Server configuration
SERVER_HOST = os.getenv("ML_HOST", "0.0.0.0")
SERVER_PORT = int(os.getenv("ML_PORT", "8001"))

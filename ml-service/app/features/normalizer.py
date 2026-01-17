import numpy as np
from typing import List, Dict, Any
from sklearn.preprocessing import StandardScaler, RobustScaler
import joblib
from pathlib import Path

from ..config import FEATURE_NAMES, MODEL_DIR


class FeatureNormalizer:
    """Normalizes features for ML model input"""

    def __init__(self):
        self.scaler = RobustScaler()  # Robust to outliers (common in trading data)
        self.is_fitted = False
        self.scaler_path = MODEL_DIR / "feature_scaler.joblib"

    def fit(self, features: np.ndarray) -> "FeatureNormalizer":
        """Fit the scaler on training data"""
        self.scaler.fit(features)
        self.is_fitted = True
        return self

    def transform(self, features: np.ndarray) -> np.ndarray:
        """Transform features using fitted scaler"""
        if not self.is_fitted:
            # If not fitted, return features as-is (will be scaled 0-1 manually)
            return self._manual_scale(features)
        return self.scaler.transform(features)

    def fit_transform(self, features: np.ndarray) -> np.ndarray:
        """Fit and transform in one step"""
        self.fit(features)
        return self.transform(features)

    def _manual_scale(self, features: np.ndarray) -> np.ndarray:
        """Manual scaling when scaler is not fitted"""
        # Apply reasonable bounds for each feature type
        scaled = features.copy()

        # Price changes: clip to [-100, 100], scale to [-1, 1]
        for i in [0, 1, 2, 3]:  # price_change_*
            scaled[:, i] = np.clip(scaled[:, i], -100, 100) / 100

        # Range/position: already 0-1 or percentage
        scaled[:, 4] = np.clip(scaled[:, 4], 0, 100) / 100  # high_low_range
        scaled[:, 5] = np.clip(scaled[:, 5], 0, 1)  # price_position

        # Volume: log scale for quote volume, clip multiplier
        scaled[:, 6] = np.log1p(np.clip(scaled[:, 6], 0, 10000)) / 10  # volume_quote_24h (in millions)
        scaled[:, 7] = np.clip(scaled[:, 7], 0, 20) / 20  # volume_multiplier
        scaled[:, 8] = np.clip(scaled[:, 8], 0, 500) / 500  # volume_change_1h

        # Momentum: velocity and acceleration
        scaled[:, 9] = np.clip(scaled[:, 9], -5, 5) / 5  # velocity
        scaled[:, 10] = np.clip(scaled[:, 10], -2, 2) / 2  # acceleration
        # trend_state already -1, 0, 1

        # Technical
        scaled[:, 12] = (np.clip(scaled[:, 12], 0, 100) - 50) / 50  # rsi_1h centered
        scaled[:, 13] = scaled[:, 13] / 4  # mtf_alignment (0-4)
        # divergence_type already -1, 0, 1

        # Funding
        scaled[:, 15] = np.clip(scaled[:, 15], -1, 1)  # funding_rate (already in %)
        # funding_signal and direction_match already -1, 0, 1

        # OI
        scaled[:, 18] = np.clip(scaled[:, 18], -50, 50) / 50  # oi_change_percent
        # oi_signal and alignment already -1, 0, 1

        # Pattern
        scaled[:, 21] = scaled[:, 21] / 8  # pattern_type (0-8)
        scaled[:, 22] = scaled[:, 22] / 100  # pattern_confidence
        scaled[:, 23] = np.clip(scaled[:, 23], 0, 10) / 10  # distance_from_level

        # Smart Signal
        scaled[:, 24] = scaled[:, 24] / 100  # smart_confidence
        scaled[:, 25] = scaled[:, 25] / 6  # component_count
        scaled[:, 26] = scaled[:, 26] / 3  # entry_type
        scaled[:, 27] = scaled[:, 27] / 2  # risk_level

        # Entry timing
        scaled[:, 28] = np.clip(scaled[:, 28], 0, 10) / 10  # atr_percent
        scaled[:, 29] = np.clip(scaled[:, 29], -10, 10) / 10  # vwap_distance
        scaled[:, 30] = np.clip(scaled[:, 30], 0, 10) / 10  # risk_reward_ratio

        # Whale/Correlation
        scaled[:, 31] = np.clip(scaled[:, 31], 0, 100) / 100  # whale_activity
        scaled[:, 32] = np.clip(scaled[:, 32], -1, 1)  # btc_correlation
        scaled[:, 33] = np.clip(scaled[:, 33], -50, 50) / 50  # btc_outperformance

        # Direction already -1 or 1

        return scaled

    def save(self, path: Path = None) -> None:
        """Save fitted scaler to disk"""
        save_path = path or self.scaler_path
        if self.is_fitted:
            joblib.dump(self.scaler, save_path)

    def load(self, path: Path = None) -> bool:
        """Load scaler from disk"""
        load_path = path or self.scaler_path
        if load_path.exists():
            self.scaler = joblib.load(load_path)
            self.is_fitted = True
            return True
        return False

    @staticmethod
    def features_dict_to_array(features_dict: Dict[str, Any]) -> np.ndarray:
        """Convert features dictionary to numpy array in correct order"""
        return np.array([
            features_dict.get("price_change_24h", 0),
            features_dict.get("price_change_1h", 0),
            features_dict.get("price_change_15m", 0),
            features_dict.get("price_change_5m", 0),
            features_dict.get("high_low_range", 0),
            features_dict.get("price_position", 0.5),
            features_dict.get("volume_quote_24h", 0),
            features_dict.get("volume_multiplier", 1),
            features_dict.get("volume_change_1h", 0),
            features_dict.get("velocity", 0),
            features_dict.get("acceleration", 0),
            features_dict.get("trend_state", 0),
            features_dict.get("rsi_1h", 50),
            features_dict.get("mtf_alignment", 0),
            features_dict.get("divergence_type", 0),
            features_dict.get("funding_rate", 0),
            features_dict.get("funding_signal", 0),
            features_dict.get("funding_direction_match", 0),
            features_dict.get("oi_change_percent", 0),
            features_dict.get("oi_signal", 0),
            features_dict.get("oi_price_alignment", 0),
            features_dict.get("pattern_type", 0),
            features_dict.get("pattern_confidence", 0),
            features_dict.get("distance_from_level", 0),
            features_dict.get("smart_confidence", 0),
            features_dict.get("component_count", 0),
            features_dict.get("entry_type", 0),
            features_dict.get("risk_level", 1),
            features_dict.get("atr_percent", 0),
            features_dict.get("vwap_distance", 0),
            features_dict.get("risk_reward_ratio", 1.5),
            features_dict.get("whale_activity", 0),
            features_dict.get("btc_correlation", 0),
            features_dict.get("btc_outperformance", 0),
            features_dict.get("direction", 1),
        ]).reshape(1, -1)

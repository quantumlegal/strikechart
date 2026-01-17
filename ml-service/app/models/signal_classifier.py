import numpy as np
from typing import Dict, List, Optional, Tuple
from datetime import datetime
import joblib
from pathlib import Path

from xgboost import XGBClassifier
from lightgbm import LGBMClassifier
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import roc_auc_score, accuracy_score, precision_score, recall_score

from ..config import (
    MODEL_DIR,
    MODEL_CONFIG,
    XGBOOST_PARAMS,
    LIGHTGBM_PARAMS,
    FEATURE_NAMES,
    QUALITY_TIERS,
)
from ..features.normalizer import FeatureNormalizer


class SignalClassifier:
    """Ensemble classifier using XGBoost and LightGBM"""

    def __init__(self):
        self.xgb_model: Optional[XGBClassifier] = None
        self.lgbm_model: Optional[LGBMClassifier] = None
        self.normalizer = FeatureNormalizer()

        self.model_version: Optional[str] = None
        self.training_date: Optional[datetime] = None
        self.training_samples: int = 0
        self.validation_auc: float = 0.0
        self.validation_accuracy: float = 0.0
        self.feature_importance: Dict[str, float] = {}
        self.predictions_made: int = 0

        self.xgb_weight = MODEL_CONFIG["xgboost_weight"]
        self.lgbm_weight = MODEL_CONFIG["lightgbm_weight"]

        # Try to load existing model
        self.load()

    @property
    def is_loaded(self) -> bool:
        return self.xgb_model is not None and self.lgbm_model is not None

    def train(
        self,
        features: np.ndarray,
        labels: np.ndarray,
        timestamps: Optional[np.ndarray] = None,
    ) -> Dict:
        """
        Train the ensemble model with time-series cross-validation.

        Args:
            features: Shape (n_samples, n_features)
            labels: Shape (n_samples,) with 0=LOSS, 1=WIN
            timestamps: Optional timestamps for time-series ordering

        Returns:
            Training metrics dictionary
        """
        n_samples = len(labels)

        if n_samples < MODEL_CONFIG["min_training_samples"]:
            raise ValueError(
                f"Insufficient training data: {n_samples} samples, "
                f"minimum required: {MODEL_CONFIG['min_training_samples']}"
            )

        # Order by timestamp if available
        if timestamps is not None:
            sort_idx = np.argsort(timestamps)
            features = features[sort_idx]
            labels = labels[sort_idx]

        # Normalize features
        features_normalized = self.normalizer.fit_transform(features)

        # Calculate class weights for imbalanced data
        n_positive = np.sum(labels == 1)
        n_negative = np.sum(labels == 0)
        scale_pos_weight = n_negative / max(n_positive, 1)

        # Update XGBoost params with calculated weight
        xgb_params = XGBOOST_PARAMS.copy()
        xgb_params["scale_pos_weight"] = scale_pos_weight

        # Time-series cross-validation (walk-forward)
        tscv = TimeSeriesSplit(n_splits=5)

        xgb_aucs = []
        lgbm_aucs = []
        ensemble_aucs = []
        accuracies = []

        for train_idx, val_idx in tscv.split(features_normalized):
            X_train, X_val = features_normalized[train_idx], features_normalized[val_idx]
            y_train, y_val = labels[train_idx], labels[val_idx]

            # Train XGBoost
            xgb = XGBClassifier(**xgb_params)
            xgb.fit(
                X_train,
                y_train,
                eval_set=[(X_val, y_val)],
                verbose=False,
            )

            # Train LightGBM
            lgbm = LGBMClassifier(**LIGHTGBM_PARAMS)
            lgbm.fit(
                X_train,
                y_train,
                eval_set=[(X_val, y_val)],
            )

            # Predictions
            xgb_proba = xgb.predict_proba(X_val)[:, 1]
            lgbm_proba = lgbm.predict_proba(X_val)[:, 1]
            ensemble_proba = self.xgb_weight * xgb_proba + self.lgbm_weight * lgbm_proba

            # Calculate metrics
            xgb_aucs.append(roc_auc_score(y_val, xgb_proba))
            lgbm_aucs.append(roc_auc_score(y_val, lgbm_proba))
            ensemble_aucs.append(roc_auc_score(y_val, ensemble_proba))
            accuracies.append(accuracy_score(y_val, (ensemble_proba >= 0.5).astype(int)))

        # Train final models on all data
        self.xgb_model = XGBClassifier(**xgb_params)
        self.xgb_model.fit(features_normalized, labels, verbose=False)

        self.lgbm_model = LGBMClassifier(**LIGHTGBM_PARAMS)
        self.lgbm_model.fit(features_normalized, labels)

        # Calculate feature importance (average of both models)
        xgb_importance = self.xgb_model.feature_importances_
        lgbm_importance = self.lgbm_model.feature_importances_
        avg_importance = (xgb_importance * self.xgb_weight + lgbm_importance * self.lgbm_weight)

        # Normalize to sum to 1
        avg_importance = avg_importance / avg_importance.sum()

        self.feature_importance = {
            name: float(imp) for name, imp in zip(FEATURE_NAMES, avg_importance)
        }

        # Sort by importance
        self.feature_importance = dict(
            sorted(self.feature_importance.items(), key=lambda x: x[1], reverse=True)
        )

        # Store training metadata
        self.model_version = datetime.now().strftime("v1.%Y%m%d%H%M%S")
        self.training_date = datetime.now()
        self.training_samples = n_samples
        self.validation_auc = float(np.mean(ensemble_aucs))
        self.validation_accuracy = float(np.mean(accuracies))

        # Save models
        self.save()

        return {
            "status": "success",
            "model_version": self.model_version,
            "training_samples": self.training_samples,
            "validation_auc": self.validation_auc,
            "validation_accuracy": self.validation_accuracy,
            "xgb_auc": float(np.mean(xgb_aucs)),
            "lgbm_auc": float(np.mean(lgbm_aucs)),
            "feature_importance": self.feature_importance,
            "class_distribution": {
                "wins": int(n_positive),
                "losses": int(n_negative),
                "win_rate": float(n_positive / n_samples),
            },
        }

    def predict(self, features: np.ndarray) -> Tuple[float, str, float, bool]:
        """
        Predict win probability for a single signal.

        Args:
            features: Shape (1, n_features) or (n_features,)

        Returns:
            Tuple of (win_probability, quality_tier, confidence, should_filter)
        """
        if not self.is_loaded:
            raise RuntimeError("Model not loaded. Train or load a model first.")

        # Ensure 2D
        if features.ndim == 1:
            features = features.reshape(1, -1)

        # Normalize
        features_normalized = self.normalizer.transform(features)

        # Get predictions from both models
        xgb_proba = self.xgb_model.predict_proba(features_normalized)[0, 1]
        lgbm_proba = self.lgbm_model.predict_proba(features_normalized)[0, 1]

        # Ensemble prediction
        win_probability = self.xgb_weight * xgb_proba + self.lgbm_weight * lgbm_proba

        # Determine quality tier
        quality_tier = self._get_quality_tier(win_probability)

        # Calculate confidence (how certain the model is)
        confidence = abs(win_probability - 0.5) * 200  # 0-100 scale

        # Should filter if below threshold
        should_filter = win_probability < QUALITY_TIERS["LOW"]

        self.predictions_made += 1

        return float(win_probability), quality_tier, float(confidence), should_filter

    def predict_batch(
        self, features_list: List[np.ndarray]
    ) -> List[Tuple[float, str, float, bool]]:
        """Predict win probabilities for multiple signals"""
        if not self.is_loaded:
            raise RuntimeError("Model not loaded. Train or load a model first.")

        # Stack features
        features = np.vstack(features_list)

        # Normalize
        features_normalized = self.normalizer.transform(features)

        # Get predictions
        xgb_probas = self.xgb_model.predict_proba(features_normalized)[:, 1]
        lgbm_probas = self.lgbm_model.predict_proba(features_normalized)[:, 1]

        # Ensemble predictions
        win_probabilities = self.xgb_weight * xgb_probas + self.lgbm_weight * lgbm_probas

        results = []
        for win_prob in win_probabilities:
            quality_tier = self._get_quality_tier(win_prob)
            confidence = abs(win_prob - 0.5) * 200
            should_filter = win_prob < QUALITY_TIERS["LOW"]
            results.append((float(win_prob), quality_tier, float(confidence), should_filter))
            self.predictions_made += 1

        return results

    def predict_detailed(self, features: np.ndarray) -> Dict:
        """Predict with detailed breakdown"""
        if not self.is_loaded:
            raise RuntimeError("Model not loaded. Train or load a model first.")

        if features.ndim == 1:
            features = features.reshape(1, -1)

        features_normalized = self.normalizer.transform(features)

        xgb_proba = float(self.xgb_model.predict_proba(features_normalized)[0, 1])
        lgbm_proba = float(self.lgbm_model.predict_proba(features_normalized)[0, 1])
        win_probability = self.xgb_weight * xgb_proba + self.lgbm_weight * lgbm_proba

        quality_tier = self._get_quality_tier(win_probability)
        confidence = abs(win_probability - 0.5) * 200
        should_filter = win_probability < QUALITY_TIERS["LOW"]

        self.predictions_made += 1

        return {
            "win_probability": win_probability,
            "quality_tier": quality_tier,
            "confidence": confidence,
            "should_filter": should_filter,
            "xgboost_prob": xgb_proba,
            "lightgbm_prob": lgbm_proba,
            "model_version": self.model_version,
        }

    def _get_quality_tier(self, win_probability: float) -> str:
        """Determine quality tier based on win probability"""
        if win_probability >= QUALITY_TIERS["HIGH"]:
            return "HIGH"
        elif win_probability >= QUALITY_TIERS["MEDIUM"]:
            return "MEDIUM"
        elif win_probability >= QUALITY_TIERS["LOW"]:
            return "LOW"
        else:
            return "FILTER"

    def save(self) -> None:
        """Save models to disk"""
        if not self.is_loaded:
            return

        # Save XGBoost model
        xgb_path = MODEL_DIR / "xgboost_model.joblib"
        joblib.dump(self.xgb_model, xgb_path)

        # Save LightGBM model
        lgbm_path = MODEL_DIR / "lightgbm_model.joblib"
        joblib.dump(self.lgbm_model, lgbm_path)

        # Save normalizer
        self.normalizer.save()

        # Save metadata
        metadata = {
            "model_version": self.model_version,
            "training_date": self.training_date.isoformat() if self.training_date else None,
            "training_samples": self.training_samples,
            "validation_auc": self.validation_auc,
            "validation_accuracy": self.validation_accuracy,
            "feature_importance": self.feature_importance,
            "xgb_weight": self.xgb_weight,
            "lgbm_weight": self.lgbm_weight,
        }
        metadata_path = MODEL_DIR / "model_metadata.joblib"
        joblib.dump(metadata, metadata_path)

        print(f"[SignalClassifier] Models saved to {MODEL_DIR}")

    def load(self) -> bool:
        """Load models from disk"""
        xgb_path = MODEL_DIR / "xgboost_model.joblib"
        lgbm_path = MODEL_DIR / "lightgbm_model.joblib"
        metadata_path = MODEL_DIR / "model_metadata.joblib"

        if not all(p.exists() for p in [xgb_path, lgbm_path]):
            print("[SignalClassifier] No saved models found")
            return False

        try:
            self.xgb_model = joblib.load(xgb_path)
            self.lgbm_model = joblib.load(lgbm_path)
            self.normalizer.load()

            if metadata_path.exists():
                metadata = joblib.load(metadata_path)
                self.model_version = metadata.get("model_version")
                training_date_str = metadata.get("training_date")
                if training_date_str:
                    self.training_date = datetime.fromisoformat(training_date_str)
                self.training_samples = metadata.get("training_samples", 0)
                self.validation_auc = metadata.get("validation_auc", 0)
                self.validation_accuracy = metadata.get("validation_accuracy", 0)
                self.feature_importance = metadata.get("feature_importance", {})
                self.xgb_weight = metadata.get("xgb_weight", MODEL_CONFIG["xgboost_weight"])
                self.lgbm_weight = metadata.get("lgbm_weight", MODEL_CONFIG["lightgbm_weight"])

            print(f"[SignalClassifier] Models loaded: {self.model_version}")
            return True

        except Exception as e:
            print(f"[SignalClassifier] Error loading models: {e}")
            self.xgb_model = None
            self.lgbm_model = None
            return False

    def get_stats(self) -> Dict:
        """Get model statistics"""
        return {
            "model_loaded": self.is_loaded,
            "model_version": self.model_version,
            "training_date": self.training_date.isoformat() if self.training_date else None,
            "training_samples": self.training_samples,
            "validation_auc": self.validation_auc,
            "validation_accuracy": self.validation_accuracy,
            "predictions_made": self.predictions_made,
            "feature_importance": self.feature_importance,
        }

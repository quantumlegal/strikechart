import numpy as np
import pandas as pd
from typing import Dict, List, Optional, Tuple
from pathlib import Path

from ..models.signal_classifier import SignalClassifier
from ..config import FEATURE_NAMES, MODEL_CONFIG


class Trainer:
    """Training pipeline for signal classifier"""

    def __init__(self, classifier: SignalClassifier):
        self.classifier = classifier

    def train_from_csv(self, csv_path: str) -> Dict:
        """
        Train model from CSV file.

        Expected CSV columns:
        - signal_id (optional)
        - All feature columns from FEATURE_NAMES
        - outcome: 'WIN' or 'LOSS' (or 1/0)
        """
        df = pd.read_csv(csv_path)
        return self._train_from_dataframe(df)

    def train_from_data(self, training_data: List[Dict]) -> Dict:
        """
        Train model from list of training data dictionaries.

        Each dict should have:
        - signal_id (optional)
        - features: list of feature values in order
        - outcome: 1 (WIN) or 0 (LOSS)
        """
        if len(training_data) < MODEL_CONFIG["min_training_samples"]:
            raise ValueError(
                f"Insufficient training data: {len(training_data)} samples, "
                f"minimum required: {MODEL_CONFIG['min_training_samples']}"
            )

        # Convert to arrays
        features = np.array([d["features"] for d in training_data])
        labels = np.array([d["outcome"] for d in training_data])

        # Get timestamps if available
        timestamps = None
        if "timestamp" in training_data[0]:
            timestamps = np.array([d["timestamp"] for d in training_data])

        return self.classifier.train(features, labels, timestamps)

    def train_from_sqlite_data(self, signal_features_list: List[Dict]) -> Dict:
        """
        Train model from SQLite signal_features data.

        Each dict should have all feature columns plus 'outcome'.
        """
        if len(signal_features_list) < MODEL_CONFIG["min_training_samples"]:
            raise ValueError(
                f"Insufficient training data: {len(signal_features_list)} samples, "
                f"minimum required: {MODEL_CONFIG['min_training_samples']}"
            )

        df = pd.DataFrame(signal_features_list)
        return self._train_from_dataframe(df)

    def _train_from_dataframe(self, df: pd.DataFrame) -> Dict:
        """Train from pandas DataFrame"""
        # Check required columns
        missing_cols = [col for col in FEATURE_NAMES if col not in df.columns]
        if missing_cols:
            raise ValueError(f"Missing required feature columns: {missing_cols}")

        if "outcome" not in df.columns:
            raise ValueError("Missing 'outcome' column")

        # Filter to completed signals only
        df = df[df["outcome"].isin(["WIN", "LOSS", 1, 0])].copy()

        if len(df) < MODEL_CONFIG["min_training_samples"]:
            raise ValueError(
                f"Insufficient training data after filtering: {len(df)} samples, "
                f"minimum required: {MODEL_CONFIG['min_training_samples']}"
            )

        # Convert outcome to binary
        if df["outcome"].dtype == object:
            df["outcome"] = df["outcome"].map({"WIN": 1, "LOSS": 0})

        # Extract features
        features = df[FEATURE_NAMES].values.astype(np.float32)
        labels = df["outcome"].values.astype(np.int32)

        # Handle missing values
        features = np.nan_to_num(features, nan=0.0)

        # Get timestamps if available
        timestamps = None
        if "timestamp" in df.columns:
            timestamps = df["timestamp"].values

        return self.classifier.train(features, labels, timestamps)

    def validate_data(self, df: pd.DataFrame) -> Dict:
        """Validate training data without training"""
        issues = []

        # Check columns
        missing_cols = [col for col in FEATURE_NAMES if col not in df.columns]
        if missing_cols:
            issues.append(f"Missing feature columns: {missing_cols}")

        if "outcome" not in df.columns:
            issues.append("Missing 'outcome' column")

        # Check data types
        for col in FEATURE_NAMES:
            if col in df.columns:
                if not pd.api.types.is_numeric_dtype(df[col]):
                    issues.append(f"Column '{col}' is not numeric")

        # Check sample count
        valid_outcomes = df[df["outcome"].isin(["WIN", "LOSS", 1, 0])] if "outcome" in df.columns else df
        if len(valid_outcomes) < MODEL_CONFIG["min_training_samples"]:
            issues.append(
                f"Only {len(valid_outcomes)} valid samples, "
                f"minimum required: {MODEL_CONFIG['min_training_samples']}"
            )

        # Check class balance
        if "outcome" in df.columns:
            outcome_counts = df["outcome"].value_counts()
            win_count = outcome_counts.get("WIN", 0) + outcome_counts.get(1, 0)
            loss_count = outcome_counts.get("LOSS", 0) + outcome_counts.get(0, 0)
            total = win_count + loss_count

            if total > 0:
                win_rate = win_count / total
                if win_rate < 0.2 or win_rate > 0.8:
                    issues.append(
                        f"Severe class imbalance: {win_rate:.1%} win rate. "
                        "Model may be biased."
                    )

        # Check for missing values
        missing_pct = df[FEATURE_NAMES].isnull().mean() * 100
        cols_with_missing = missing_pct[missing_pct > 10].to_dict()
        if cols_with_missing:
            issues.append(f"Columns with >10% missing values: {cols_with_missing}")

        return {
            "valid": len(issues) == 0,
            "issues": issues,
            "sample_count": len(df),
            "feature_count": len([c for c in FEATURE_NAMES if c in df.columns]),
        }

    def get_data_stats(self, df: pd.DataFrame) -> Dict:
        """Get statistics about training data"""
        if "outcome" in df.columns:
            valid_df = df[df["outcome"].isin(["WIN", "LOSS", 1, 0])].copy()
            if valid_df["outcome"].dtype == object:
                valid_df["outcome"] = valid_df["outcome"].map({"WIN": 1, "LOSS": 0})
        else:
            valid_df = df

        stats = {
            "total_samples": len(valid_df),
        }

        if "outcome" in valid_df.columns:
            wins = valid_df["outcome"].sum()
            losses = len(valid_df) - wins
            stats["wins"] = int(wins)
            stats["losses"] = int(losses)
            stats["win_rate"] = float(wins / len(valid_df)) if len(valid_df) > 0 else 0

        # Feature statistics
        feature_stats = {}
        for col in FEATURE_NAMES:
            if col in valid_df.columns:
                feature_stats[col] = {
                    "mean": float(valid_df[col].mean()),
                    "std": float(valid_df[col].std()),
                    "min": float(valid_df[col].min()),
                    "max": float(valid_df[col].max()),
                    "missing_pct": float(valid_df[col].isnull().mean() * 100),
                }
        stats["feature_stats"] = feature_stats

        # Time range
        if "timestamp" in valid_df.columns:
            stats["time_range"] = {
                "start": int(valid_df["timestamp"].min()),
                "end": int(valid_df["timestamp"].max()),
                "duration_hours": (valid_df["timestamp"].max() - valid_df["timestamp"].min()) / 3600000,
            }

        return stats

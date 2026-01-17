from fastapi import APIRouter, HTTPException, BackgroundTasks
from typing import Dict, List
import numpy as np
import pandas as pd
from io import StringIO
import traceback

from .schemas import (
    SignalFeatures,
    MLPrediction,
    PredictRequest,
    PredictBatchRequest,
    PredictResponse,
    PredictBatchResponse,
    TrainRequest,
    TrainResponse,
    ModelStats,
    QualityTier,
)
from ..models.signal_classifier import SignalClassifier
from ..training.trainer import Trainer
from ..features.normalizer import FeatureNormalizer
from ..config import FEATURE_NAMES

router = APIRouter()

# Global classifier instance
classifier = SignalClassifier()
trainer = Trainer(classifier)


def features_to_array(features: SignalFeatures) -> np.ndarray:
    """Convert SignalFeatures to numpy array"""
    return FeatureNormalizer.features_dict_to_array(features.model_dump())


@router.post("/predict", response_model=PredictResponse)
async def predict_single(request: PredictRequest):
    """Predict win probability for a single signal"""
    if not classifier.is_loaded:
        raise HTTPException(
            status_code=503,
            detail="Model not loaded. Train a model first or wait for model to load."
        )

    try:
        features_array = features_to_array(request.features)
        result = classifier.predict_detailed(features_array)

        prediction = MLPrediction(
            signal_id=request.features.signal_id,
            win_probability=result["win_probability"],
            quality_tier=QualityTier(result["quality_tier"]),
            confidence=result["confidence"],
            should_filter=result["should_filter"],
            model_version=result["model_version"],
            xgboost_prob=result["xgboost_prob"],
            lightgbm_prob=result["lightgbm_prob"],
        )

        return PredictResponse(prediction=prediction)

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/predict/batch", response_model=PredictBatchResponse)
async def predict_batch(request: PredictBatchRequest):
    """Predict win probabilities for multiple signals"""
    if not classifier.is_loaded:
        raise HTTPException(
            status_code=503,
            detail="Model not loaded. Train a model first or wait for model to load."
        )

    try:
        predictions = {}

        for features in request.features_list:
            features_array = features_to_array(features)
            result = classifier.predict_detailed(features_array)

            predictions[features.signal_id] = MLPrediction(
                signal_id=features.signal_id,
                win_probability=result["win_probability"],
                quality_tier=QualityTier(result["quality_tier"]),
                confidence=result["confidence"],
                should_filter=result["should_filter"],
                model_version=result["model_version"],
                xgboost_prob=result["xgboost_prob"],
                lightgbm_prob=result["lightgbm_prob"],
            )

        return PredictBatchResponse(predictions=predictions)

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/train", response_model=TrainResponse)
async def train_model(request: TrainRequest, background_tasks: BackgroundTasks):
    """Train or retrain the model"""
    try:
        # Train from provided data or CSV path
        if request.training_data:
            # Convert to format expected by trainer
            training_data = [
                {
                    "signal_id": d.signal_id,
                    "features": d.features,
                    "outcome": d.outcome,
                }
                for d in request.training_data
            ]
            result = trainer.train_from_data(training_data)

        elif request.csv_path:
            result = trainer.train_from_csv(request.csv_path)

        else:
            raise HTTPException(
                status_code=400,
                detail="Provide either 'training_data' or 'csv_path'"
            )

        return TrainResponse(
            status=result["status"],
            model_version=result["model_version"],
            training_samples=result["training_samples"],
            validation_auc=result["validation_auc"],
            validation_accuracy=result["validation_accuracy"],
            feature_importance=result["feature_importance"],
            message=f"Model trained successfully with {result['training_samples']} samples",
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/train/csv")
async def train_from_csv_body(csv_data: str):
    """Train model from CSV data in request body"""
    try:
        df = pd.read_csv(StringIO(csv_data))
        result = trainer._train_from_dataframe(df)

        return TrainResponse(
            status=result["status"],
            model_version=result["model_version"],
            training_samples=result["training_samples"],
            validation_auc=result["validation_auc"],
            validation_accuracy=result["validation_accuracy"],
            feature_importance=result["feature_importance"],
            message=f"Model trained successfully with {result['training_samples']} samples",
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/train/sqlite-data")
async def train_from_sqlite_data(signal_features: List[Dict]):
    """Train model from SQLite signal_features data"""
    try:
        result = trainer.train_from_sqlite_data(signal_features)

        return TrainResponse(
            status=result["status"],
            model_version=result["model_version"],
            training_samples=result["training_samples"],
            validation_auc=result["validation_auc"],
            validation_accuracy=result["validation_accuracy"],
            feature_importance=result["feature_importance"],
            message=f"Model trained successfully with {result['training_samples']} samples",
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats", response_model=ModelStats)
async def get_model_stats():
    """Get model statistics"""
    stats = classifier.get_stats()
    return ModelStats(**stats)


@router.get("/features")
async def get_feature_names():
    """Get list of feature names in order"""
    return {
        "feature_names": FEATURE_NAMES,
        "feature_count": len(FEATURE_NAMES),
    }


@router.post("/reload")
async def reload_model():
    """Reload model from disk"""
    success = classifier.load()
    if success:
        return {"status": "success", "model_version": classifier.model_version}
    else:
        return {"status": "no_model", "message": "No saved model found"}

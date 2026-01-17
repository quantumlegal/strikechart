import time
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.routes import router as api_router
from .api.schemas import HealthResponse
from .api.routes import classifier
from .config import SERVER_HOST, SERVER_PORT

# Track startup time for uptime calculation
START_TIME = time.time()

# Create FastAPI app
app = FastAPI(
    title="Signal Sense Hunter ML Service",
    description="ML prediction service for trading signal quality assessment",
    version="1.0.0",
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routes
app.include_router(api_router, prefix="/api/v1", tags=["ML API"])


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint"""
    return HealthResponse(
        status="healthy",
        model_loaded=classifier.is_loaded,
        model_version=classifier.model_version,
        uptime_seconds=time.time() - START_TIME,
    )


@app.get("/")
async def root():
    """Root endpoint with service info"""
    return {
        "service": "Signal Sense Hunter ML Service",
        "version": "1.0.0",
        "status": "running",
        "model_loaded": classifier.is_loaded,
        "model_version": classifier.model_version,
        "endpoints": {
            "health": "/health",
            "predict": "/api/v1/predict",
            "predict_batch": "/api/v1/predict/batch",
            "train": "/api/v1/train",
            "stats": "/api/v1/stats",
            "features": "/api/v1/features",
            "reload": "/api/v1/reload",
        },
    }


@app.on_event("startup")
async def startup_event():
    """Load model on startup"""
    print("=" * 50)
    print("Signal Sense Hunter ML Service")
    print("=" * 50)

    if classifier.is_loaded:
        print(f"Model loaded: {classifier.model_version}")
        print(f"Training samples: {classifier.training_samples}")
        print(f"Validation AUC: {classifier.validation_auc:.4f}")
    else:
        print("No pre-trained model found.")
        print("Train a model using POST /api/v1/train")

    print("=" * 50)
    print(f"Server running at http://{SERVER_HOST}:{SERVER_PORT}")
    print("=" * 50)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=SERVER_HOST, port=SERVER_PORT)

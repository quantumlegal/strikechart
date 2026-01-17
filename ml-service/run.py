#!/usr/bin/env python3
"""
Simple script to run the ML service for development.
Usage: python run.py
"""

import uvicorn
from app.config import SERVER_HOST, SERVER_PORT

if __name__ == "__main__":
    print("Starting Signal Sense Hunter ML Service...")
    print(f"Server: http://{SERVER_HOST}:{SERVER_PORT}")
    print(f"Docs: http://{SERVER_HOST}:{SERVER_PORT}/docs")
    print("-" * 50)

    uvicorn.run(
        "app.main:app",
        host=SERVER_HOST,
        port=SERVER_PORT,
        reload=True,
        log_level="info",
    )

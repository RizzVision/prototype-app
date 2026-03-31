"""
RizzVision - AI-Powered Outfit Analysis for Visually Impaired Users

Entry point for the FastAPI application.
Run with: uvicorn main:app --reload
"""

import logging

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.api.routes import router
from app.errors.handlers import (
    image_quality_error_handler,
    generic_error_handler,
)
from app.services.image_ingestion import ImageQualityError

# Configure logging
logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL),
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("rizzvision")

# Create FastAPI app
app = FastAPI(
    title="RizzVision",
    description="AI-Powered Outfit Analysis for Visually Impaired Users",
    version="1.0.0",
)

# CORS middleware for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register error handlers
app.add_exception_handler(ImageQualityError, image_quality_error_handler)
app.add_exception_handler(Exception, generic_error_handler)

# Register routes
app.include_router(router)


@app.get("/")
async def root():
    return {
        "service": "RizzVision",
        "version": "1.0.0",
        "status": "running",
        "endpoint": "POST /analyze with multipart image",
    }


@app.get("/health")
async def health():
    return {"status": "healthy"}


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
    )

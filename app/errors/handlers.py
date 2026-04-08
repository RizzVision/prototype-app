"""
Error handling for the RizzVision API.

Every code path returns a user_message field - a short sentence ready to be spoken.
There is no acceptable state where the user receives a raw error code.
"""

import logging

from fastapi import Request
from fastapi.responses import JSONResponse

from app.services.image_ingestion import ImageQualityError

logger = logging.getLogger(__name__)

# Complete mapping of error codes to spoken user messages.
# These are fallbacks - ImageQualityError already carries its own user_message.
ERROR_MESSAGES = {
    "image_too_small": "This image is too small to analyse. Please take a closer photo.",
    "image_too_large": "This image is extremely large. Please use a standard photo from your camera.",
    "invalid_image": "The file you uploaded is not a valid image. Please try again with a photo.",
    "too_dark": "The photo is too dark. Please move to better lighting.",
    "too_bright": "The photo is overexposed. Please reduce glare and try again.",
    "blurry": "The photo is blurry. Hold the camera steady and try again.",
    "no_garment_detected": "No clothing detected. Please point the camera at a single clothing item and try again.",
    "llm_parse_failed": "Something went wrong generating your feedback. Please try again.",
    "internal_error": "Something unexpected went wrong. Please try again in a moment.",
    "no_file_uploaded": "No image was uploaded. Please attach a photo and try again.",
}


async def image_quality_error_handler(request: Request, exc: ImageQualityError):
    """Handle ImageQualityError with a spoken user_message."""
    logger.warning(f"Quality error: {exc.error_code} - {exc.user_message}")
    return JSONResponse(
        status_code=422,
        content={
            "error_code": exc.error_code,
            "user_message": exc.user_message,
        },
    )


async def generic_error_handler(request: Request, exc: Exception):
    """Catch-all handler ensuring users always receive a spoken message."""
    logger.error(f"Unhandled exception: {type(exc).__name__}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "error_code": "internal_error",
            "user_message": ERROR_MESSAGES["internal_error"],
        },
    )

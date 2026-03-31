"""
Stage 1 - Image Ingestion

Validates and normalises the uploaded image before any inference cost is incurred.
Rejects bad inputs early with specific, spoken error messages.
"""

import io
import logging

import numpy as np
from PIL import Image, ImageFilter

from app.core.config import settings

logger = logging.getLogger(__name__)


class ImageQualityError(Exception):
    """Raised when the image fails a quality gate check."""

    def __init__(self, error_code: str, user_message: str):
        self.error_code = error_code
        self.user_message = user_message
        super().__init__(user_message)


def ingest_image(raw_bytes: bytes) -> Image.Image:
    """
    Decode, validate, and normalise an uploaded image.

    - Converts to RGB (strips alpha, handles EXIF rotation)
    - Rejects images below minimum or above maximum dimensions
    - Resizes to target size with LANCZOS resampling

    Returns a PIL Image ready for downstream processing.
    """
    try:
        img = Image.open(io.BytesIO(raw_bytes))
    except Exception:
        raise ImageQualityError(
            error_code="invalid_image",
            user_message="The file you uploaded is not a valid image. Please try again with a photo.",
        )

    # Handle EXIF orientation before converting
    try:
        from PIL import ImageOps
        img = ImageOps.exif_transpose(img)
    except Exception:
        pass  # If EXIF transpose fails, proceed with original orientation

    img = img.convert("RGB")
    w, h = img.size

    if w < settings.IMAGE_MIN_DIMENSION or h < settings.IMAGE_MIN_DIMENSION:
        raise ImageQualityError(
            error_code="image_too_small",
            user_message="This image is too small to analyse. Please take a closer photo.",
        )

    if w * h > settings.IMAGE_MAX_DIMENSION * settings.IMAGE_MAX_DIMENSION:
        raise ImageQualityError(
            error_code="image_too_large",
            user_message="This image is extremely large. Please use a standard photo from your camera.",
        )

    # Resize to target size on longest side
    img.thumbnail(
        (settings.IMAGE_TARGET_SIZE, settings.IMAGE_TARGET_SIZE), Image.LANCZOS
    )

    logger.info(f"Image ingested: {img.size[0]}x{img.size[1]}")
    return img


def check_image_quality(img: Image.Image) -> None:
    """
    Run quality gate checks on the image.

    Raises ImageQualityError with a spoken user_message if any check fails.
    Checks are run in priority order: dark > bright > blurry.
    """
    arr = np.array(img)
    brightness = float(arr.mean())

    if brightness < settings.BRIGHTNESS_MIN:
        raise ImageQualityError(
            error_code="too_dark",
            user_message="The photo is too dark. Please move to better lighting and try again.",
        )

    if brightness > settings.BRIGHTNESS_MAX:
        raise ImageQualityError(
            error_code="too_bright",
            user_message="The photo is overexposed. Please reduce glare and try again.",
        )

    # Sharpness via Laplacian variance (edge detection on grayscale)
    gray = img.convert("L").filter(ImageFilter.FIND_EDGES)
    sharpness = float(np.array(gray).var())

    if sharpness < settings.SHARPNESS_MIN:
        raise ImageQualityError(
            error_code="blurry",
            user_message="The photo is blurry. Hold the camera steady and try again.",
        )

    logger.info(f"Quality gate passed: brightness={brightness:.1f}, sharpness={sharpness:.1f}")

"""
Stage 2 - Garment Segmentation

Isolate each garment as a binary mask before colour extraction.
Uses SegFormer (mattmdjaga/segformer_b2_clothes) - a clothing-specific
segmentation model that is lightweight and CPU-compatible.

Garment label mapping (from model output to RizzVision categories):
  - top: upper-clothes (model label 4)
  - bottom: skirt (5), pants (6)
  - full_body: dress (7)
  - outerwear: scarf (17)
"""

import logging
from dataclasses import dataclass

import numpy as np
import torch
from PIL import Image
from transformers import AutoModelForSemanticSegmentation, AutoImageProcessor

from app.core.config import settings
from app.services.image_ingestion import ImageQualityError

logger = logging.getLogger(__name__)

# Mapping from SegFormer clothing labels to RizzVision garment categories
# SegFormer labels: 0-Background, 1-Hat, 2-Hair, 3-Sunglasses, 4-Upper-clothes,
# 5-Skirt, 6-Pants, 7-Dress, 8-Belt, 9-Left-shoe, 10-Right-shoe, 11-Face,
# 12-Left-leg, 13-Right-leg, 14-Left-arm, 15-Right-arm, 16-Bag, 17-Scarf
GARMENT_LABEL_MAP = {
    4: "top",
    5: "bottom",
    6: "bottom",
    7: "full_body",
    17: "outerwear",
}

# Skin regions for skin tone analysis
SKIN_LABEL_IDS = [11, 14, 15]  # Face, Left-arm, Right-arm

# Human-readable names for speech output
GARMENT_DISPLAY_NAMES = {
    "top": "top",
    "bottom": "bottom",
    "full_body": "full body garment",
    "outerwear": "outerwear",
}



def _verify_clothing_with_clip(img: Image.Image) -> None:
    """Delegate to the public occasion_engine helper to avoid touching CLIP internals."""
    from app.services.color_engine.occasion_engine import verify_image_contains_clothing
    verify_image_contains_clothing(img)


@dataclass
class GarmentRegion:
    """A detected garment with its binary mask and label."""
    label: str
    display_name: str
    mask: np.ndarray  # Boolean mask, same HxW as input image


class SegmentationModel:
    """Manages the clothing segmentation model lifecycle."""

    def __init__(self):
        self._model = None
        self._processor = None
        self._device = "cpu"

    def _load(self):
        """Lazy-load model on first use to avoid cold-start overhead at import time."""
        if self._model is not None:
            return

        logger.info(f"Loading segmentation model: {settings.SEGMENTATION_MODEL}")
        self._processor = AutoImageProcessor.from_pretrained(
            settings.SEGMENTATION_MODEL
        )
        self._model = AutoModelForSemanticSegmentation.from_pretrained(
            settings.SEGMENTATION_MODEL
        )
        self._model.to(self._device)
        self._model.eval()
        logger.info("Segmentation model loaded successfully")

    def _run_inference(self, img: Image.Image) -> np.ndarray:
        """Run model inference and return the prediction map."""
        self._load()

        inputs = self._processor(images=img, return_tensors="pt").to(self._device)

        with torch.inference_mode():
            outputs = self._model(**inputs)

        logits = outputs.logits
        upsampled = torch.nn.functional.interpolate(
            logits,
            size=img.size[::-1],  # (H, W)
            mode="bilinear",
            align_corners=False,
        )
        return upsampled.argmax(dim=1).squeeze().cpu().numpy()

    def segment(self, img: Image.Image) -> tuple[list[GarmentRegion], np.ndarray | None]:
        """
        Run garment segmentation on a PIL image.

        Returns:
            - List of GarmentRegion objects, one per detected garment category.
            - Skin mask (boolean ndarray) or None if no skin detected.

        Raises ImageQualityError if no garments are detected.
        """
        pred = self._run_inference(img)

        # Extract garment regions
        regions = []
        for model_label, garment_category in GARMENT_LABEL_MAP.items():
            mask = pred == model_label
            if mask.sum() > (mask.size * 0.02):  # require 2% pixel coverage — filters marginal misclassifications
                existing = next(
                    (r for r in regions if r.label == garment_category), None
                )
                if existing is not None:
                    existing.mask = existing.mask | mask
                else:
                    regions.append(
                        GarmentRegion(
                            label=garment_category,
                            display_name=GARMENT_DISPLAY_NAMES[garment_category],
                            mask=mask,
                        )
                    )

        if not regions:
            raise ImageQualityError(
                error_code="no_garment_detected",
                user_message="No clothing detected. Please point the camera at a single clothing item and try again.",
            )

        # Second gate: CLIP verification that this is actually clothing on a person.
        # SegFormer can misclassify random objects as garment regions at low pixel
        # coverage. CLIP provides a high-accuracy semantic check before the LLM runs.
        _verify_clothing_with_clip(img)

        # Extract skin mask (face + arms)
        skin_mask = np.zeros(pred.shape, dtype=bool)
        for skin_id in SKIN_LABEL_IDS:
            skin_mask |= (pred == skin_id)

        # Only return skin mask if it has meaningful coverage
        if skin_mask.sum() < (skin_mask.size * 0.002):
            skin_mask = None

        logger.info(
            f"Detected {len(regions)} garment(s): {[r.label for r in regions]}, "
            f"skin={'yes' if skin_mask is not None else 'no'}"
        )
        return regions, skin_mask


# Module-level singleton - lazy loaded on first use
segmentation_model = SegmentationModel()

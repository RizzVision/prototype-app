"""
Clothing presence gate — SegFormer + CLIP two-layer verification.

SegFormer detects whether any clothing pixels are present (pixel coverage gate).
CLIP then confirms the image actually contains clothing and not a random object
(semantic gate). If either rejects, an ImageQualityError is raised before the
LLM is ever called.
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

# SegFormer label → garment category
GARMENT_LABEL_MAP = {
    4: "top",
    5: "bottom",
    6: "bottom",
    7: "full_body",
    17: "outerwear",
}

GARMENT_DISPLAY_NAMES = {
    "top": "top",
    "bottom": "bottom",
    "full_body": "full body garment",
    "outerwear": "outerwear",
}

# ── CLIP clothing verification ─────────────────────────────────────────────────

_CLOTHING_PROMPTS = [
    "a photo of a clothing item laid flat or worn by a person",
    "a shirt, t-shirt, top, blouse, or jacket",
    "trousers, jeans, pants, skirt, or shorts",
    "a dress, jumpsuit, or full body garment",
    "a person wearing an outfit",
    "clothing on a hanger or mannequin",
]

_NON_CLOTHING_PROMPTS = [
    "a random everyday object with no clothing",
    "food, furniture, electronics, or a vehicle",
    "a landscape, building, or outdoor scene",
    "a face or body with no visible clothing",
    "text, a document, or a screen",
]

_CLIP_REJECTION_MARGIN = 0.12


class _ClipModel:
    """Lazy-loaded CLIP model singleton."""

    def __init__(self):
        self._model = None
        self._processor = None
        self._loaded = False

    def load(self):
        if self._loaded:
            return
        try:
            from transformers import CLIPModel, CLIPProcessor
            self._processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
            self._model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
            self._model.eval()
            self._loaded = True
            logger.info("CLIP model loaded for clothing verification")
        except Exception as exc:
            logger.warning(f"CLIP model failed to load: {exc}")


_clip_model = _ClipModel()


def _verify_clothing_with_clip(img: Image.Image) -> None:
    """
    Raises ImageQualityError if the image is confidently not clothing.
    Falls back silently if CLIP is unavailable.
    """
    try:
        if not _clip_model._loaded:
            _clip_model.load()
        if not _clip_model._loaded:
            return

        all_prompts = _CLOTHING_PROMPTS + _NON_CLOTHING_PROMPTS
        n_clothing = len(_CLOTHING_PROMPTS)

        with torch.inference_mode():
            inputs = _clip_model._processor(
                text=all_prompts,
                images=img,
                return_tensors="pt",
                padding=True,
                truncation=True,
                max_length=77,
            )
            outputs = _clip_model._model(**inputs)
            probs = torch.softmax(outputs.logits_per_image, dim=-1).squeeze(0).cpu().numpy()

        clothing_score = float(probs[:n_clothing].sum())
        non_clothing_score = float(probs[n_clothing:].sum())

        logger.info(f"CLIP check: clothing={clothing_score:.3f}, non_clothing={non_clothing_score:.3f}")

        if non_clothing_score - clothing_score > _CLIP_REJECTION_MARGIN:
            raise ImageQualityError(
                error_code="no_garment_detected",
                user_message="No clothing detected. Please point the camera at a single clothing item and try again.",
            )

    except ImageQualityError:
        raise
    except Exception as exc:
        logger.warning(f"CLIP verification failed ({exc}) — proceeding without it")


@dataclass
class GarmentRegion:
    """A detected garment with its binary mask and label."""
    label: str
    display_name: str
    mask: np.ndarray


class SegmentationModel:
    """Manages the clothing segmentation model lifecycle."""

    def __init__(self):
        self._model = None
        self._processor = None
        self._device = "cpu"

    def _load(self):
        if self._model is not None:
            return
        logger.info(f"Loading segmentation model: {settings.SEGMENTATION_MODEL}")
        self._processor = AutoImageProcessor.from_pretrained(settings.SEGMENTATION_MODEL)
        self._model = AutoModelForSemanticSegmentation.from_pretrained(settings.SEGMENTATION_MODEL)
        self._model.to(self._device)
        self._model.eval()
        logger.info("Segmentation model loaded")

    def _run_inference(self, img: Image.Image) -> np.ndarray:
        self._load()
        inputs = self._processor(images=img, return_tensors="pt").to(self._device)
        with torch.inference_mode():
            outputs = self._model(**inputs)
        logits = outputs.logits
        upsampled = torch.nn.functional.interpolate(
            logits, size=img.size[::-1], mode="bilinear", align_corners=False,
        )
        return upsampled.argmax(dim=1).squeeze().cpu().numpy()

    def verify_clothing(self, img: Image.Image) -> None:
        """
        Two-gate clothing check: SegFormer pixel coverage + CLIP semantic check.
        Raises ImageQualityError if no clothing is detected.
        Returns silently if clothing is confirmed.
        """
        pred = self._run_inference(img)

        has_clothing = any(
            (pred == label).sum() > (pred.size * 0.02)
            for label in GARMENT_LABEL_MAP
        )

        if not has_clothing:
            raise ImageQualityError(
                error_code="no_garment_detected",
                user_message="No clothing detected. Please point the camera at a single clothing item and try again.",
            )

        _verify_clothing_with_clip(img)

        logger.info("Clothing presence confirmed")


segmentation_model = SegmentationModel()

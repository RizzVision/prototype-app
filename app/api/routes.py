"""
Stage 7 - API Layer (FastAPI)

One POST endpoint. Every code path returns a user_message field.
"""

import logging
import time
from dataclasses import asdict

import numpy as np
from fastapi import APIRouter, UploadFile, File

from app.errors.handlers import ERROR_MESSAGES
from app.services.image_ingestion import ImageQualityError, ingest_image, check_image_quality
from app.services.garment_segmentation import segmentation_model
from app.services.color_extraction import extract_colors_for_garments
from app.services.color_engine import run_color_engine
from app.services.llm_feedback import get_outfit_feedback
from app.services.response_shaper import shape_response

logger = logging.getLogger(__name__)

router = APIRouter()


def _engine_to_raw(engine) -> dict:
    """Serialize ColorEngineResult to a JSON-safe dict for the raw field."""
    return {
        "overall_score": engine.overall_score,
        "overall_label": engine.overall_label,
        "garment_details": engine.garment_details,
        "harmony": {
            "hue_score": engine.harmony.hue_score,
            "hue_pattern": engine.harmony.hue_pattern,
            "lightness_score": engine.harmony.lightness_score,
            "saturation_score": engine.harmony.saturation_score,
            "temperature_score": engine.harmony.temperature_score,
            "contrast_score": engine.harmony.contrast_score,
            "mutual_enhancement": engine.harmony.mutual_enhancement,
            "pairwise": engine.harmony.pairwise,
        },
        "skin": {
            "detected": engine.skin.detected,
            "hex_color": engine.skin.hex_color,
            "color_name": engine.skin.color_name,
            "depth": engine.skin.depth,
            "undertone": engine.skin.undertone,
            "season": engine.skin.season,
            "ita_angle": engine.skin.ita_angle,
            "garment_scores": engine.skin.garment_scores,
        },
        "seasonal": {
            "season": engine.seasonal.season,
            "sub_type": engine.seasonal.sub_type,
            "overall_compatibility": engine.seasonal.overall_compatibility,
            "per_garment": engine.seasonal.per_garment,
            "palette_suggestions": engine.seasonal.palette_suggestions,
        },
        "proportion": {
            "score": engine.proportion.score,
            "actual_ratios": engine.proportion.actual_ratios,
            "ideal_deviation": engine.proportion.ideal_deviation,
            "visual_weight_balance": engine.proportion.visual_weight_balance,
            "flags": engine.proportion.flags,
        },
        "occasion": {
            "formality_level": engine.occasion.formality_level,
            "formality_score": engine.occasion.formality_score,
            "best_occasion": engine.occasion.best_occasion,
            "occasions": [
                {"occasion": o.occasion, "score": o.score, "reasoning": o.reasoning}
                for o in engine.occasion.occasions
            ],
        },
        "style": {
            "primary_archetype": engine.style.primary_archetype,
            "archetype_confidence": engine.style.archetype_confidence,
            "coherence_score": engine.style.coherence_score,
            "description": engine.style.description,
            "archetype_scores": engine.style.archetype_scores,
        },
        "flags": engine.all_flags,
        "flag_messages": engine.flag_messages,
        "recommendations": engine.recommendations,
    }


@router.post("/analyze")
async def analyze_outfit(image: UploadFile = File(...)):
    """
    Analyse an outfit photo and return TTS-ready speech segments.

    Accepts: multipart/form-data with an 'image' file field.

    Returns:
        speech_segments   - Ordered TTS segments [{id, text}]
        color_score       - Master engine score (0-1)
        color_label       - Score label (excellent/good/decent/needs work/poor)
        harmony_pattern   - Detected hue harmony pattern
        best_occasion     - Best occasion suitability
        style_archetype   - Detected style archetype
        skin_detected     - Whether skin tone was analysed
        latency_ms        - Total processing time in ms
        raw               - Full analysis data for debugging/frontend
    """
    start_time = time.time()

    # --- Validate upload ---
    if not image or not image.filename:
        raise ImageQualityError(
            error_code="no_file_uploaded",
            user_message=ERROR_MESSAGES["no_file_uploaded"],
        )

    # --- Stage 1: Image Ingestion ---
    raw_bytes = await image.read()
    img = ingest_image(raw_bytes)
    check_image_quality(img)

    # --- Stage 2: Garment Segmentation (returns garments + skin mask) ---
    regions, skin_mask = segmentation_model.segment(img)

    # --- Stage 3: K-means Colour Extraction ---
    image_array = np.array(img)
    garment_colors = extract_colors_for_garments(image_array, regions)
    garment_labels = [gc["label"] for gc in garment_colors]

    # --- Stage 4: Full Color Engine (pass PIL image for CLIP occasion detection) ---
    engine_result = run_color_engine(
        image_array=image_array,
        garment_colors=garment_colors,
        garment_labels=garment_labels,
        skin_mask=skin_mask,
        pil_image=img,
    )

    # --- Stage 5: Single LLM Call ---
    llm_feedback = get_outfit_feedback(img, engine_result)

    # --- Stage 6: Response Shaping for TTS ---
    speech_segments = shape_response(llm_feedback, engine_result)

    # --- Stage 7: Build API Response ---
    latency_ms = int((time.time() - start_time) * 1000)

    response = {
        "speech_segments": speech_segments,
        "color_score": engine_result.overall_score,
        "color_label": engine_result.overall_label,
        "harmony_pattern": engine_result.harmony.hue_pattern,
        "best_occasion": engine_result.occasion.best_occasion,
        "style_archetype": engine_result.style.primary_archetype,
        "skin_detected": engine_result.skin.detected,
        "latency_ms": latency_ms,
        "raw": _engine_to_raw(engine_result),
    }

    logger.info(
        f"Analysis complete in {latency_ms}ms | "
        f"score={engine_result.overall_score} ({engine_result.overall_label}) | "
        f"occasion={engine_result.occasion.best_occasion} | "
        f"style={engine_result.style.primary_archetype}"
    )
    return response

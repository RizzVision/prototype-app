"""
Stage 7 - API Layer (FastAPI)

One POST endpoint. Every code path returns a user_message field.
"""

import logging
import time
from dataclasses import asdict

import numpy as np
from fastapi import APIRouter, UploadFile, File
from pydantic import BaseModel

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


class ShoppingAnalyzeRequest(BaseModel):
    """Shopping mode — wardrobe-aware live analysis."""
    wardrobe: str  # JSON string of wardrobe items (empty string if wardrobe is empty)


class ShoppingFollowUpRequest(BaseModel):
    """Follow-up question about the last scanned item."""
    question: str
    last_analysis_context: str  # Brief context from the previous analysis


@router.post("/shopping-analyze")
async def shopping_analyze(
    image: UploadFile = File(...),
    wardrobe: str = "",
):
    """
    Shopping mode analysis: analyse the item in frame and compare it
    against the user's wardrobe. Returns TTS-ready feedback.

    If wardrobe is empty, gives a standalone style assessment.
    Accepts: multipart/form-data with 'image' file and optional 'wardrobe' text field.
    """
    from google import genai
    from google.genai import types as gtypes
    from app.core.config import settings
    import io as _io

    start_time = time.time()

    if not image or not image.filename:
        raise ImageQualityError(
            error_code="no_file_uploaded",
            user_message=ERROR_MESSAGES["no_file_uploaded"],
        )

    raw_bytes = await image.read()
    img = ingest_image(raw_bytes)
    check_image_quality(img)

    # Run standard pipeline to get color/style data
    image_array = np.array(img)
    regions, skin_mask = segmentation_model.segment(img)
    garment_colors = extract_colors_for_garments(image_array, regions)
    garment_labels = [gc["label"] for gc in garment_colors]
    engine_result = run_color_engine(
        image_array=image_array,
        garment_colors=garment_colors,
        garment_labels=garment_labels,
        skin_mask=skin_mask,
        pil_image=img,
    )

    # Build context summary for the shopping LLM prompt
    garment_names = ", ".join(
        f"{gd['display_name']} ({gd['color_name']})"
        for gd in engine_result.garment_details
    ) or "unidentified garment"

    has_wardrobe = bool(wardrobe and wardrobe.strip() and wardrobe.strip() != "[]")

    if has_wardrobe:
        wardrobe_section = f"The user's wardrobe:\n{wardrobe}"
        match_instruction = (
            "Tell the user which specific items in their wardrobe this would pair well with, "
            "and which items it would clash with. Be specific — name the items. "
            "If nothing pairs well, say so honestly."
        )
    else:
        wardrobe_section = "The user has no saved wardrobe items."
        match_instruction = (
            "The wardrobe is empty. Give a standalone style and fit assessment. "
            "Tell the user how this item would look on them and what it would generally pair well with."
        )

    client = genai.Client(api_key=settings.GEMINI_API_KEY)

    prompt = f"""You are RizzVision in shopping mode, speaking to a visually impaired user.
Your response is read aloud. Every sentence must be under 15 words. No markdown. No lists.
Use concrete, tactile language. Never say "looks good" — say WHY.

Item detected: {garment_names}
Color score: {engine_result.overall_score:.2f} ({engine_result.overall_label})
Best occasion: {engine_result.occasion.best_occasion}
Style: {engine_result.style.primary_archetype}

{wardrobe_section}

Task:
1. Briefly describe what you see (1-2 sentences, garment and color).
2. {match_instruction}
3. One sentence on whether this is worth buying for their style.

Return ONLY valid JSON:
{{
  "item_description": "string",
  "wardrobe_match": "string",
  "buy_verdict": "string"
}}"""

    img_bytes_io = _io.BytesIO()
    img.save(img_bytes_io, format="JPEG", quality=85)
    img_bytes = img_bytes_io.getvalue()

    response = client.models.generate_content(
        model=settings.GEMINI_MODEL,
        contents=[
            gtypes.Part.from_bytes(data=img_bytes, mime_type="image/jpeg"),
            prompt,
        ],
        config=gtypes.GenerateContentConfig(max_output_tokens=400, temperature=0.4),
    )

    import json as _json
    try:
        text = response.text.strip()
        if text.startswith("```"):
            text = "\n".join(l for l in text.split("\n") if not l.strip().startswith("```"))
        data = _json.loads(text)
    except Exception:
        data = {
            "item_description": "I can see a clothing item in frame.",
            "wardrobe_match": "Unable to assess wardrobe compatibility right now.",
            "buy_verdict": "Try again for a full assessment.",
        }

    speech_segments = []
    if data.get("item_description"):
        speech_segments.append({"id": "item", "text": data["item_description"]})
    if data.get("wardrobe_match"):
        speech_segments.append({"id": "match", "text": data["wardrobe_match"]})
    if data.get("buy_verdict"):
        speech_segments.append({"id": "verdict", "text": data["buy_verdict"]})

    latency_ms = int((time.time() - start_time) * 1000)

    # Store context for potential follow-up
    analysis_context = (
        f"Item: {garment_names}. "
        f"Score: {engine_result.overall_score:.2f} ({engine_result.overall_label}). "
        f"Occasion: {engine_result.occasion.best_occasion}. "
        f"Assessment: {data.get('item_description', '')} {data.get('wardrobe_match', '')}"
    )

    return {
        "speech_segments": speech_segments,
        "color_score": engine_result.overall_score,
        "color_label": engine_result.overall_label,
        "best_occasion": engine_result.occasion.best_occasion,
        "style_archetype": engine_result.style.primary_archetype,
        "has_wardrobe": has_wardrobe,
        "analysis_context": analysis_context,
        "latency_ms": latency_ms,
    }


@router.post("/shopping-followup")
async def shopping_followup(req: ShoppingFollowUpRequest):
    """
    Answer a follow-up question about the last scanned shopping item.
    Returns a TTS-ready spoken answer.
    """
    from google import genai
    from google.genai import types as gtypes
    from app.core.config import settings

    client = genai.Client(api_key=settings.GEMINI_API_KEY)

    prompt = (
        f"You are RizzVision, a fashion assistant for visually impaired users. "
        f"Your response will be read aloud. Keep it under 3 sentences. No markdown. "
        f"Context from the last scan: {req.last_analysis_context}\n\n"
        f"User question: {req.question}\n\n"
        f"Answer the question directly and concisely."
    )

    response = client.models.generate_content(
        model=settings.GEMINI_MODEL,
        contents=prompt,
        config=gtypes.GenerateContentConfig(max_output_tokens=200, temperature=0.4),
    )

    return {"answer": response.text.strip()}


class OutfitSuggestionRequest(BaseModel):
    occasion: str
    mood: str
    wardrobe: str
    anchor: str = ""


@router.post("/outfit-suggestion")
async def outfit_suggestion(req: OutfitSuggestionRequest):
    """
    Generate outfit combinations from wardrobe items for a given occasion and mood.
    Uses Gemini to produce TTS-ready spoken suggestions.
    """
    from google import genai
    from google.genai import types
    from app.core.config import settings

    client = genai.Client(api_key=settings.GEMINI_API_KEY)

    anchor_line = f"\n{req.anchor}" if req.anchor else ""
    prompt = (
        f"You are a confident fashion stylist speaking to a visually impaired user. "
        f"Your response will be read aloud. Keep every sentence under 15 words. "
        f"Use vivid sensory language for colours (warmth, texture, mood) — never just name the colour.\n\n"
        f"Occasion: {req.occasion}\nMood: {req.mood}{anchor_line}\n\n"
        f"Their wardrobe:\n{req.wardrobe}\n\n"
        f"Give 2 outfit combinations. Format:\n"
        f"Outfit one: [name]\nWhat to wear: [pieces]\nHow it feels: [colour/texture description]\nWhy it works: [1-2 sentences]\n\n"
        f"Outfit two: [name]\nWhat to wear: [pieces]\nHow it feels: [colour/texture description]\nWhy it works: [1-2 sentences]\n\n"
        f"One thing to avoid: [clear warning]\n\n"
        f"If wardrobe is empty or too sparse, say so and suggest what to add."
    )

    response = client.models.generate_content(
        model=settings.GEMINI_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(max_output_tokens=600, temperature=0.4),
    )
    return {"suggestion": response.text}

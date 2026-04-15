"""
Stage 7 - API Layer (FastAPI)

One POST endpoint. Every code path returns a user_message field.
"""

import logging
import time
from dataclasses import asdict

import numpy as np
from fastapi import APIRouter, UploadFile, File
from pydantic import BaseModel, Field

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
        "garment_details": engine.garment_details,
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
            "suitable_occasions": [
                {"occasion": o.occasion, "score": o.score}
                for o in engine.occasion.occasions
            ],
        },
        "style": {
            "primary_archetype": engine.style.primary_archetype,
            "top_archetypes": engine.style.top_archetypes,
            "coherence_score": engine.style.coherence_score,
            "description": engine.style.description,
        },
        "flags": engine.all_flags,
        "flag_messages": engine.flag_messages,
        "recommendations": engine.recommendations,
        "outfit_score": engine.outfit_score,
        "outfit_score_label": engine.outfit_score_label,
    }


@router.post("/analyze")
async def analyze_outfit(image: UploadFile = File(...)):
    """
    Analyse an outfit photo and return TTS-ready speech segments.

    Accepts: multipart/form-data with an 'image' file field.

    Returns:
        speech_segments    - Ordered TTS segments [{id, text}]
        suitable_occasions - All occasions this outfit works for
        top_archetypes     - All matching style archetypes
        skin_detected      - Whether skin tone was analysed
        latency_ms         - Total processing time in ms
        raw                - Full analysis data for debugging/frontend
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
        "suitable_occasions": [o.occasion for o in engine_result.occasion.occasions],
        "top_archetypes": engine_result.style.top_archetypes,
        "skin_detected": engine_result.skin.detected,
        "latency_ms": latency_ms,
        "raw": _engine_to_raw(engine_result),
    }

    logger.info(
        f"Analysis complete in {latency_ms}ms | "
        f"occasions={[o.occasion for o in engine_result.occasion.occasions]} | "
        f"styles={engine_result.style.top_archetypes}"
    )
    return response


class ShoppingAnalyzeRequest(BaseModel):
    """Shopping mode — wardrobe-aware live analysis."""
    wardrobe: str  # JSON string of wardrobe items (empty string if wardrobe is empty)


class ShoppingFollowUpRequest(BaseModel):
    """Follow-up question about the last scanned item."""
    question: str = Field(..., max_length=500)
    last_analysis_context: str = Field(..., max_length=2000)


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
Suitable occasions: {", ".join(o.occasion for o in engine_result.occasion.occasions)}
Style: {", ".join(engine_result.style.top_archetypes)}

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

    suitable_occasions = [o.occasion for o in engine_result.occasion.occasions]

    # Store context for potential follow-up
    analysis_context = (
        f"Item: {garment_names}. "
        f"Suitable for: {', '.join(suitable_occasions)}. "
        f"Style: {', '.join(engine_result.style.top_archetypes)}. "
        f"Assessment: {data.get('item_description', '')} {data.get('wardrobe_match', '')}"
    )

    return {
        "speech_segments": speech_segments,
        "suitable_occasions": suitable_occasions,
        "top_archetypes": engine_result.style.top_archetypes,
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
    occasion: str = Field(..., max_length=100)
    wardrobe: str = Field(..., max_length=4000)
    anchor: str = Field("", max_length=200)


@router.post("/outfit-suggestion")
async def outfit_suggestion(req: OutfitSuggestionRequest):
    """
    Generate 1-2 outfit combinations from wardrobe items for a given occasion.
    Uses Gemini to produce short, fun, TTS-ready spoken suggestions that name
    exact wardrobe items by their saved names.
    """
    from google import genai
    from google.genai import types
    from app.core.config import settings

    client = genai.Client(api_key=settings.GEMINI_API_KEY)

    anchor_line = f"\nBuild the outfit around: {req.anchor}" if req.anchor else ""

    prompt = (
        f"You are RizzVision, a bold and fun fashion assistant speaking to a visually impaired user. "
        f"Your response will be read aloud by a screen reader.\n\n"
        f"RULES:\n"
        f"1. ALWAYS refer to items by their EXACT name from the wardrobe list below. Never paraphrase or genericise. "
        f"   If the item is called 'white polo', say 'white polo'. If it's 'camo cargo pants', say 'camo cargo pants'.\n"
        f"2. Never use hex codes. Never use technical colour codes. Use the colour name as given in the item name.\n"
        f"3. Be short and punchy. The whole response must be under 80 words.\n"
        f"4. Be fun and confident — like a friend hyping them up. Use phrases like "
        f"   'You would absolutely slay in...', 'This combo is a vibe:', 'Trust me on this one:', "
        f"   'Nobody is ready for you in...', etc.\n"
        f"5. Give exactly 1 outfit combination if the wardrobe is small (under 4 items), "
        f"   or 2 combinations if there are 4 or more items.\n"
        f"6. Each combination is ONE sentence naming the exact items.\n"
        f"7. End with one short sentence on why it works for the occasion.\n"
        f"8. If the wardrobe is empty, say 'Your wardrobe is empty. Scan some clothes first and come back.'\n\n"
        f"Occasion: {req.occasion}{anchor_line}\n\n"
        f"Wardrobe (use these exact names):\n{req.wardrobe}"
    )

    response = client.models.generate_content(
        model=settings.GEMINI_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(max_output_tokens=250, temperature=0.7),
    )
    return {"suggestion": response.text}

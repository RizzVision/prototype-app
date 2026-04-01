"""
Stage 5 - Single LLM Call (Gemini Flash)

One call to Gemini 1.5 Flash per user interaction. The image and pre-computed
colour data are passed together in context. The LLM handles garment identification,
fit assessment, occasion context, and Indian fashion vocabulary.

It does NOT compute colour harmony - it narrates a score it did not produce.
Now receives comprehensive data from the full Color Engine.
"""

import io
import json
import logging

from google import genai
from google.genai import types
from PIL import Image

from app.core.config import settings
from app.services.color_engine.engine import ColorEngineResult

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are RizzVision, an AI outfit analyst designed for visually impaired users.
Your feedback will be read aloud by a screen reader. Every sentence must be short, clear, and spoken naturally.

RULES:
1. Be direct. Do not soften feedback to be polite.
2. Be humane. Explain why something works or does not.
3. Keep every sentence under 15 words. This will be read aloud.
4. Never use visual metaphors the user cannot reference. Avoid words like "looks sharp", "pops", "clean aesthetic", "eye-catching".
5. Use concrete language: "the dark blue shirt" not "the top piece" or "the garment". You may use your own color descriptions from the image — be specific and vivid. Pre-computed color names are a guide, not a constraint.
6. Trust ALL pre-computed scores completely. Do not guess at colour compatibility, skin tone analysis, or occasion suitability. Narrate the scores, flags, and recommendations provided.
7. When describing garments, include tactile details: fabric weight impression, fit type, neckline, sleeve length.
8. Assess proportion, silhouette, and general occasion suitability in fit feedback.
9. The overall verdict must be one honest sentence. Not cruel. Not false.
10. The top fix must be the single most impactful change the user can make right now.
11. You understand Indian fashion vocabulary: kurta, dhoti, saree, sherwani, dupatta, salwar, churidar, lehenga, etc.
12. When skin tone data is available, weave it naturally into color feedback. Do not make it awkward or clinical.
13. Reference the detected style archetype if it adds value. Do not force it.
14. For occasion feedback, mention the best-matching occasion naturally.

Return ONLY valid JSON. No markdown. No preamble. No explanation outside the JSON.

Output schema:
{
  "garments": [{"name": "string", "description": "string"}],
  "color_feedback": "string",
  "fit_feedback": "string",
  "overall_verdict": "string",
  "top_fix": "string"
}

Field guidance:
- garments: List each visible garment with a tactile description including fabric weight impression, fit type, neckline, sleeve length.
- color_feedback: Narrate the pre-computed harmony score and all diagnostic findings. Reference skin compatibility if available. Mention specific color names. If score < 0.5, explain what clashes and why. If score > 0.7, explain why it works.
- fit_feedback: Assess proportion, silhouette, occasion suitability. Reference the detected best occasion and style archetype.
- overall_verdict: One sentence. Honest. Not cruel. Not false.
- top_fix: The single most impactful change. Use the recommendations provided when available."""

REPAIR_PROMPT = """The previous response was not valid JSON. Here is the raw response:

{raw_response}

Please return ONLY valid JSON matching this exact schema, nothing else:
{{
  "garments": [{{"name": "string", "description": "string"}}],
  "color_feedback": "string",
  "fit_feedback": "string",
  "overall_verdict": "string",
  "top_fix": "string"
}}"""

_client = None


def _get_client():
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.GEMINI_API_KEY)
        logger.info(f"Gemini client created with model: {settings.GEMINI_MODEL}")
    return _client


def _build_color_context(engine_result: ColorEngineResult) -> str:
    """Build comprehensive colour context from the full engine output."""
    lines = [
        "═══ PRE-COMPUTED ANALYSIS (trust these values, do not recompute) ═══",
        "",
    ]

    # Garment colors with names
    lines.append("GARMENTS DETECTED:")
    for gd in engine_result.garment_details:
        lines.append(f"  - {gd['display_name']}: {gd['color_name']} ({gd['hex_color']})")
    lines.append("")

    # Master score
    lines.append(f"OVERALL COLOUR SCORE: {engine_result.overall_score}/1.00 ({engine_result.overall_label})")
    lines.append("")

    # Harmony details
    h = engine_result.harmony
    lines.append(f"HARMONY: pattern={h.hue_pattern}, hue={h.hue_score}, "
                 f"lightness={h.lightness_score}, saturation={h.saturation_score}, "
                 f"temperature={h.temperature_score}, contrast={h.contrast_score}")

    if h.pairwise:
        lines.append("Pairwise analysis:")
        for p in h.pairwise:
            lines.append(
                f"  {p['garment_a']} + {p['garment_b']}: {p['relationship']} "
                f"(deltaE={p['delta_e']}, contrast={p['contrast_ratio']})"
            )
    lines.append("")

    # Skin tone (if detected)
    skin = engine_result.skin
    if skin.detected:
        lines.append(f"SKIN TONE: {skin.color_name}, depth={skin.depth}, "
                     f"undertone={skin.undertone}, season={skin.season}")
        if skin.garment_scores:
            lines.append("Skin compatibility per garment:")
            for label, score in skin.garment_scores.items():
                level = "excellent" if score > 0.7 else "good" if score > 0.5 else "poor"
                lines.append(f"  {label}: {score:.2f} ({level})")
        lines.append("")

    # Seasonal analysis
    seasonal = engine_result.seasonal
    if seasonal.season != "unknown":
        lines.append(f"SEASONAL TYPE: {seasonal.season} ({seasonal.sub_type})")
        lines.append(f"Seasonal compatibility: {seasonal.overall_compatibility:.2f}")
        for pg in seasonal.per_garment:
            lines.append(f"  {pg['label']} ({pg['color_name']}): {pg['recommendation']}")
        if seasonal.palette_suggestions:
            from app.services.color_engine.color_science import name_color
            suggestions = [name_color(c) for c in seasonal.palette_suggestions]
            lines.append(f"Suggested additions: {', '.join(suggestions)}")
        lines.append("")

    # Proportion
    prop = engine_result.proportion
    if prop.actual_ratios:
        lines.append("PROPORTION:")
        for r in prop.actual_ratios:
            pct = int(r["ratio"] * 100)
            lines.append(f"  {r['label']}: {pct}% ({r['role']})")
        lines.append(f"Proportion score: {prop.score:.2f}")
        lines.append("")

    # Occasion
    occ = engine_result.occasion
    lines.append(f"FORMALITY: {occ.formality_level} ({occ.formality_score:.2f})")
    lines.append(f"Best occasion: {occ.best_occasion}")
    top_occasions = sorted(occ.occasions, key=lambda o: o.score, reverse=True)[:3]
    for o in top_occasions:
        lines.append(f"  {o.occasion}: {o.score:.2f}")
    lines.append("")

    # Style
    style = engine_result.style
    lines.append(f"STYLE: {style.primary_archetype} "
                 f"(confidence={style.archetype_confidence:.2f}, "
                 f"coherence={style.coherence_score:.2f})")
    if style.description:
        lines.append(f"  Description: {style.description}")
    lines.append("")

    # Flags and messages
    if engine_result.flag_messages:
        lines.append("DIAGNOSTIC FLAGS (narrate these to the user):")
        for msg in engine_result.flag_messages:
            lines.append(f"  ⚠ {msg}")
        lines.append("")

    # Recommendations
    if engine_result.recommendations:
        lines.append("TOP RECOMMENDATIONS (use these for the top_fix field):")
        for i, rec in enumerate(engine_result.recommendations, 1):
            lines.append(f"  {i}. {rec}")

    return "\n".join(lines)


def _parse_llm_json(text: str) -> dict:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        cleaned = "\n".join(lines)
    return json.loads(cleaned)


def _validate_feedback(data: dict) -> dict:
    required_fields = {
        "garments": [],
        "color_feedback": "Colour analysis is not available for this image.",
        "fit_feedback": "Fit analysis is not available for this image.",
        "overall_verdict": "I was unable to fully assess this outfit.",
        "top_fix": "Try taking a clearer photo for better feedback.",
    }
    for field, default in required_fields.items():
        if field not in data or not data[field]:
            data[field] = default
    if isinstance(data["garments"], list):
        validated = []
        for g in data["garments"]:
            if isinstance(g, dict) and "name" in g and "description" in g:
                validated.append(g)
        data["garments"] = validated
    return data


def get_outfit_feedback(
    img: Image.Image,
    engine_result: ColorEngineResult,
) -> dict:
    """
    Make a single LLM call to Gemini Flash for outfit feedback.

    Now receives the full ColorEngineResult for comprehensive context injection.
    """
    from app.services.image_ingestion import ImageQualityError

    client = _get_client()
    color_context = _build_color_context(engine_result)

    img_byte_arr = io.BytesIO()
    img.save(img_byte_arr, format="JPEG", quality=85)
    img_bytes = img_byte_arr.getvalue()

    user_prompt = f"""Analyse this outfit photo.

{color_context}

Based on the image and the pre-computed data above, provide your structured feedback as JSON."""

    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        max_output_tokens=600,
        temperature=0.4,
    )

    # First attempt
    response = None
    try:
        response = client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=[
                types.Part.from_bytes(data=img_bytes, mime_type="image/jpeg"),
                user_prompt,
            ],
            config=config,
        )
        feedback = _parse_llm_json(response.text)
        return _validate_feedback(feedback)
    except json.JSONDecodeError:
        logger.warning("First LLM call returned malformed JSON, retrying with repair prompt")
        raw_response = response.text if response else "empty response"
    except Exception as e:
        logger.error(f"First LLM call failed: {e}")
        raw_response = str(e)

    # Retry with repair prompt
    try:
        repair_msg = REPAIR_PROMPT.format(raw_response=raw_response)
        response = client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=repair_msg,
            config=types.GenerateContentConfig(max_output_tokens=600, temperature=0.2),
        )
        feedback = _parse_llm_json(response.text)
        return _validate_feedback(feedback)
    except Exception as e:
        logger.error(f"Repair LLM call also failed: {e}")
        raise ImageQualityError(
            error_code="llm_parse_failed",
            user_message="Something went wrong generating your feedback. Please try again.",
        )

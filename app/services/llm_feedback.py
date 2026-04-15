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
2. Be humane. Explain why something works or does not work.
3. Keep every sentence under 15 words. This will be read aloud.
4. Never use visual metaphors the user cannot reference. Avoid words like "looks sharp", "pops", "clean aesthetic", "eye-catching".
5. Use concrete language: "the dark blue shirt" not "the top piece" or "the garment". You may use your own color descriptions from the image — be specific and vivid. Pre-computed color names are a guide, not a constraint.
6. Trust ALL pre-computed scores and the OUTFIT SCORE completely. Do not invent or guess compatibility, skin tone analysis, or occasion suitability. Narrate the scores and flags provided. Never contradict them.
7. When describing garments, include tactile details: fabric weight impression, fit type, neckline, sleeve length.
8. Assess proportion, silhouette, and general occasion suitability in fit feedback.
9. The overall verdict must reflect the OUTFIT SCORE honestly. excellent/good = positive verdict. fair/poor = constructive criticism.
10. The top fix must be the single most impactful change the user can make right now.
11. You understand Indian fashion vocabulary: kurta, dhoti, saree, sherwani, dupatta, salwar, churidar, lehenga, etc.
12. When skin compatibility data is available, weave it naturally into color feedback. Do not make it awkward or clinical. If compatibility is poor for a garment, say which colour is the problem and why.
13. Reference the detected style archetypes if they add value. Mention the range — do not force a single label.
14. For occasion feedback, mention ALL suitable occasions from the list. Never collapse a multi-occasion item into one category.
15. Count physically separate garments only. A shirt with a contrast collar, stripes, or colorblock pattern is ONE garment entry. Only create separate garment entries for items that can be worn independently (e.g., a jacket + jeans).

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
- color_feedback: Start by anchoring on the OUTFIT SCORE provided. Then narrate any skin compatibility findings, diagnostic flags, and specific color names. If the outfit score is poor or fair, explain concretely what is causing the issue. If good or excellent, say why it works.
- fit_feedback: Assess proportion, silhouette, and occasion suitability. Reference the detected occasions and style archetype.
- overall_verdict: One sentence. Must align with the outfit score — do not be falsely positive when the score is poor.
- top_fix: The single most impactful change. Use the TOP RECOMMENDATIONS provided — do not invent your own."""

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
    """Build analysis context from the engine output."""
    lines = [
        "═══ PRE-COMPUTED ANALYSIS (trust these values, do not recompute) ═══",
        "",
    ]

    # Overall outfit score — anchor the LLM here first
    score_pct = int(engine_result.outfit_score * 100)
    lines.append(
        f"OUTFIT SCORE: {score_pct}/100 ({engine_result.outfit_score_label.upper()})"
    )
    lines.append(
        "This score reflects skin compatibility, colour proportion, and style coherence. "
        "Your color_feedback and overall_verdict MUST align with this score."
    )
    lines.append("")

    # Garment colors with names
    lines.append("GARMENTS DETECTED:")
    for gd in engine_result.garment_details:
        lines.append(f"  - {gd['display_name']}: {gd['color_name']} ({gd['hex_color']})")
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

    # Proportion
    prop = engine_result.proportion
    if prop.actual_ratios:
        lines.append("PROPORTION:")
        for r in prop.actual_ratios:
            pct = int(r["ratio"] * 100)
            lines.append(f"  {r['label']}: {pct}% ({r['role']})")
        lines.append("")

    # Occasion — multi-label: list all suitable occasions
    occ = engine_result.occasion
    lines.append(f"FORMALITY: {occ.formality_level} ({occ.formality_score:.2f})")
    lines.append(f"SUITABLE OCCASIONS (this item works for all of these — do not pick just one):")
    for o in occ.occasions:
        lines.append(f"  - {o.occasion} ({o.score:.1%})")
    lines.append("")

    # Style — multi-label: list all matching archetypes
    style = engine_result.style
    lines.append(f"STYLE ARCHETYPES (this item fits all of these — mention the range):")
    for arch in style.top_archetypes:
        lines.append(f"  - {arch}")
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
        max_output_tokens=900,
        temperature=0.2,
    )

    contents = [
        types.Part.from_bytes(data=img_bytes, mime_type="image/jpeg"),
        user_prompt,
    ]

    # First attempt
    response = None
    try:
        response = client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=contents,
            config=config,
        )
        feedback = _parse_llm_json(response.text)
        return _validate_feedback(feedback)
    except json.JSONDecodeError:
        # Malformed JSON only — retry with a repair prompt that includes the original context
        logger.warning("First LLM call returned malformed JSON, retrying with repair prompt")
        raw_response = response.text
    except Exception as e:
        # Network / quota / auth errors — no point retrying with a different prompt
        logger.error(f"LLM call failed: {e}")
        raise ImageQualityError(
            error_code="llm_parse_failed",
            user_message="Something went wrong generating your feedback. Please try again.",
        )

    # Repair attempt — only reached on json.JSONDecodeError.
    # Re-send the image + color context so the model has full information.
    try:
        repair_msg = REPAIR_PROMPT.format(raw_response=raw_response)
        repair_contents = [
            types.Part.from_bytes(data=img_bytes, mime_type="image/jpeg"),
            f"{repair_msg}\n\n{color_context}",
        ]
        response = client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=repair_contents,
            config=types.GenerateContentConfig(max_output_tokens=900, temperature=0.1),
        )
        feedback = _parse_llm_json(response.text)
        return _validate_feedback(feedback)
    except Exception as e:
        logger.error(f"Repair LLM call also failed: {e}")
        raise ImageQualityError(
            error_code="llm_parse_failed",
            user_message="Something went wrong generating your feedback. Please try again.",
        )

"""
Stage 6 - Response Shaping for TTS

Converts structured JSON into segments designed to be heard, not read.
The spoken order is non-negotiable:

1. Garments detected
2. Colour feedback (harmony + skin compatibility)
3. Fit feedback (proportion, silhouette, occasion)
4. Overall verdict
5. Top fix

TTS sentence design rules:
- Short sentences only (aim for under 15 words)
- No em dashes, parentheses, or nested clauses
- No lists read as lists (natural prose sequences)
- No visual metaphors
- Concrete language
"""

import logging
import re

from app.services.color_engine.engine import ColorEngineResult

logger = logging.getLogger(__name__)


def _clean_for_tts(text: str) -> str:
    """
    Clean text for natural TTS delivery.

    - Strip markdown, parentheticals, em dashes, semicolons
    - Collapse whitespace
    - Ensure terminal punctuation
    """
    text = re.sub(r"\*{1,3}([^*]+)\*{1,3}", r"\1", text)
    text = re.sub(r"\([^)]*\)", "", text)
    text = text.replace("—", ". ")
    text = text.replace(" - ", ". ")
    text = text.replace(";", ".")
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\.{2,}", ".", text)
    text = re.sub(r"\.\s*\.", ".", text)
    text = text.strip()
    if text and text[-1] not in ".!?":
        text += "."
    return text


def _format_garments_segment(garments: list[dict]) -> str:
    """Format LLM garment descriptions into a flowing spoken sequence."""
    if not garments:
        return "I could not identify specific garments in this photo."

    parts = []
    if len(garments) == 1:
        g = garments[0]
        parts.append(f"You are wearing {g['name']}. {g['description']}")
    else:
        parts.append(f"I can see {len(garments)} pieces.")
        for g in garments:
            parts.append(f"The {g['name']}. {g['description']}")

    return _clean_for_tts(" ".join(parts))


def _build_skin_intro(engine: ColorEngineResult) -> str:
    """Build a spoken skin-tone intro line if skin was detected."""
    skin = engine.skin
    if not skin.detected:
        return ""
    depth_map = {
        "very_light": "very light",
        "light": "light",
        "medium_light": "medium-light",
        "medium": "medium",
        "medium_deep": "medium-deep",
        "deep": "deep",
    }
    depth_label = depth_map.get(skin.depth, skin.depth)
    return (
        f"Your skin has {depth_label} depth with {skin.undertone} undertones. "
        f"This means {skin.season} colours suit you best."
    )


def shape_response(
    llm_feedback: dict,
    engine: ColorEngineResult,
) -> list[dict]:
    """
    Shape LLM feedback + engine data into ordered speech segments.

    Args:
        llm_feedback: Validated dict from the LLM call.
        engine: Full ColorEngineResult from the color engine.

    Returns:
        Ordered list [{"id": str, "text": str}] ready for TTS.
    """
    segments = []

    # ── 1. Garments ──────────────────────────────────────────────────────────
    garments_text = _format_garments_segment(llm_feedback.get("garments", []))
    segments.append({"id": "garments", "text": garments_text})

    # ── 2. Skin tone intro (prepended to colour feedback) ────────────────────
    skin_intro = _build_skin_intro(engine)

    # ── 3. Colour feedback ───────────────────────────────────────────────────
    color_raw = llm_feedback.get("color_feedback", "")
    if skin_intro:
        color_text = _clean_for_tts(f"{skin_intro} {color_raw}")
    else:
        color_text = _clean_for_tts(color_raw)

    if color_text:
        segments.append({"id": "color_feedback", "text": color_text})

    # ── 4. Fit / occasion / style feedback ───────────────────────────────────
    fit_text = _clean_for_tts(llm_feedback.get("fit_feedback", ""))
    if fit_text:
        # If the LLM didn't mention occasions and we have multiple, append them
        occasion_names = [o.occasion for o in engine.occasion.occasions]
        if occasion_names and not any(o.lower() in fit_text.lower() for o in occasion_names):
            if len(occasion_names) == 1:
                fit_text = _clean_for_tts(f"{fit_text} This works best for {occasion_names[0]}.")
            else:
                joined = ", ".join(occasion_names[:-1]) + f" and {occasion_names[-1]}"
                fit_text = _clean_for_tts(f"{fit_text} This works for {joined}.")
        segments.append({"id": "fit_feedback", "text": fit_text})

    # ── 5. Overall verdict ───────────────────────────────────────────────────
    verdict_text = _clean_for_tts(llm_feedback.get("overall_verdict", ""))
    if verdict_text:
        segments.append({"id": "overall_verdict", "text": verdict_text})

    # ── 6. Top fix ───────────────────────────────────────────────────────────
    # Prefer the engine's top recommendation, fall back to LLM's top_fix
    engine_top_rec = engine.recommendations[0] if engine.recommendations else ""
    llm_top_fix = llm_feedback.get("top_fix", "")

    # Use the engine recommendation if it's meaningfully different
    if engine_top_rec and len(engine_top_rec) > 10:
        fix_text = _clean_for_tts(engine_top_rec)
    else:
        fix_text = _clean_for_tts(llm_top_fix)

    if fix_text:
        segments.append({"id": "top_fix", "text": fix_text})

    logger.info(f"Shaped {len(segments)} speech segments")
    return segments

"""
Response Shaping for TTS

Converts LLM JSON output into ordered speech segments designed to be heard, not read.

Spoken order:
1. Garments detected
2. Colour feedback
3. Fit feedback
4. Overall verdict
5. Top fix

TTS rules: short sentences, no markdown, no parentheses, no em dashes, concrete language.
"""

import logging
import re

logger = logging.getLogger(__name__)


def _clean_for_tts(text: str) -> str:
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


def shape_response(llm_feedback: dict) -> list[dict]:
    """
    Shape LLM feedback dict into ordered TTS speech segments.

    Args:
        llm_feedback: Validated dict from get_outfit_feedback().

    Returns:
        Ordered list of {"id": str, "text": str} ready for TTS.
    """
    segments = []

    garments_text = _format_garments_segment(llm_feedback.get("garments", []))
    segments.append({"id": "garments", "text": garments_text})

    color_text = _clean_for_tts(llm_feedback.get("color_feedback", ""))
    if color_text:
        segments.append({"id": "color_feedback", "text": color_text})

    fit_text = _clean_for_tts(llm_feedback.get("fit_feedback", ""))
    if fit_text:
        segments.append({"id": "fit_feedback", "text": fit_text})

    verdict_text = _clean_for_tts(llm_feedback.get("overall_verdict", ""))
    if verdict_text:
        segments.append({"id": "overall_verdict", "text": verdict_text})

    fix_text = _clean_for_tts(llm_feedback.get("top_fix", ""))
    if fix_text:
        segments.append({"id": "top_fix", "text": fix_text})

    logger.info(f"Shaped {len(segments)} speech segments")
    return segments

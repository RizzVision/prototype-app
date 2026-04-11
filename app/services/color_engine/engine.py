"""
Master Color Engine - Orchestrator

Runs:
  1. Skin tone detection and compatibility
  2. Proportion analysis
  3. Occasion suitability scoring (multi-label)
  4. Style archetype profiling (multi-label)

Harmony analysis and seasonal analysis have been removed — they produced
arbitrary scores and confused the LLM with contradictory signals.
"""

import logging
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
from PIL import Image as PILImage

from app.services.color_engine.skin_analysis import SkinToneResult, analyze_skin
from app.services.color_engine.proportion_analyzer import ProportionResult, analyze_proportion
from app.services.color_engine.occasion_engine import OccasionResult, analyze_occasion
from app.services.color_engine.style_profiler import StyleResult, analyze_style
from app.services.color_engine.color_science import name_color

logger = logging.getLogger(__name__)


@dataclass
class ColorEngineResult:
    """Complete output from the master color engine."""
    # Sub-analysis results
    skin: SkinToneResult = field(default_factory=SkinToneResult)
    proportion: ProportionResult = field(default_factory=ProportionResult)
    occasion: OccasionResult = field(default_factory=OccasionResult)
    style: StyleResult = field(default_factory=StyleResult)

    # Garment details with named colors
    garment_details: list[dict] = field(default_factory=list)

    # Consolidated flags and spoken messages
    all_flags: list[str] = field(default_factory=list)
    flag_messages: list[str] = field(default_factory=list)

    # Top recommendations (skin/proportion based only)
    recommendations: list[str] = field(default_factory=list)

    # Overall outfit compatibility score (0.0–1.0).
    # Derived from skin compatibility + proportion + style coherence.
    # Passed directly to the LLM so it doesn't have to guess.
    outfit_score: float = 0.0
    outfit_score_label: str = "unknown"  # poor / fair / good / excellent


_FLAG_MESSAGES = {
    # Proportion flags
    "no_dominant_color": "There is no clear anchor colour. One piece should take the lead.",
    "competing_dominance": "Two garments compete for attention. Let one be the star and the other support it.",
    "accent_overpowers": "A smaller piece visually overpowers the rest. Consider muting the accent.",

    # Skin compatibility flags
    "skin_clash": "Some of your colours do not complement your skin tone.",
    "unflattering_color": "One of your garments is in a colour that does not flatter your complexion.",

    # Style flags
    "unclear_style_direction": "The outfit does not have a clear style direction. The pieces feel unrelated.",
    "low_coherence": "The garments do not tell a consistent story together.",

    # Skin not detected
    "skin_not_detected": "I could not detect your skin clearly. Skin tone analysis is not available for this photo.",
}


def _generate_recommendations(result: ColorEngineResult) -> list[str]:
    """Generate actionable recommendations based on skin and proportion analysis."""
    recs = []

    # Skin compatibility issues
    if "skin_clash" in result.all_flags and result.skin.garment_scores:
        worst_label = min(result.skin.garment_scores, key=result.skin.garment_scores.get)
        worst_score = result.skin.garment_scores[worst_label]
        if worst_score < 0.45:
            recs.append(
                f"The {worst_label} colour does not complement your skin tone well. "
                "Try a shade closer to your seasonal palette."
            )

    # Proportion issues
    if "no_dominant_color" in result.all_flags:
        recs.append(
            "Choose one garment as the anchor colour covering the most area. "
            "Let other pieces play supporting roles."
        )

    if "competing_dominance" in result.all_flags:
        recs.append(
            "Two pieces are competing for attention. Make one lighter, darker, "
            "or more muted so the other can lead."
        )

    if not recs:
        recs.append("The overall composition works well for the detected occasions.")

    return recs[:3]


def _compute_outfit_score(result: ColorEngineResult) -> tuple[float, str]:
    """
    Compute a single 0–1 outfit compatibility score.

    Weighted combination of:
      - Skin compatibility (40% if detected, else redistributed)
      - Proportion balance (35%)
      - Style coherence (25%)

    Flags act as deductions on top.
    """
    skin_weight = 0.40
    prop_weight = 0.35
    style_weight = 0.25

    # Skin sub-score
    if result.skin.detected and result.skin.garment_scores:
        avg_skin = sum(result.skin.garment_scores.values()) / len(result.skin.garment_scores)
        skin_score = avg_skin
    else:
        # Redistribute skin weight to proportion + style
        skin_score = 0.0
        prop_weight += skin_weight * 0.6
        style_weight += skin_weight * 0.4
        skin_weight = 0.0

    # Proportion sub-score (already 0–1)
    prop_score = result.proportion.score if result.proportion.score > 0 else 0.65

    # Style coherence sub-score (already 0–1)
    style_score = result.style.coherence_score if result.style.coherence_score > 0 else 0.50

    raw = skin_weight * skin_score + prop_weight * prop_score + style_weight * style_score

    # Flag deductions — each flag shaves off a fixed amount
    flag_deductions = {
        "skin_clash": 0.10,
        "unflattering_color": 0.08,
        "competing_dominance": 0.06,
        "accent_overpowers": 0.05,
        "unclear_style_direction": 0.05,
        "low_coherence": 0.04,
        "no_dominant_color": 0.04,
    }
    for flag in result.all_flags:
        raw -= flag_deductions.get(flag, 0.0)

    score = round(max(0.0, min(1.0, raw)), 2)

    if score >= 0.75:
        label = "excellent"
    elif score >= 0.58:
        label = "good"
    elif score >= 0.40:
        label = "fair"
    else:
        label = "poor"

    return score, label


def run_color_engine(
    image_array: np.ndarray,
    garment_colors: list[dict],
    garment_labels: list[str],
    skin_mask: np.ndarray | None = None,
    pil_image: Optional[PILImage.Image] = None,
) -> ColorEngineResult:
    """
    Run the color analysis engine (skin, proportion, occasion, style).

    Args:
        image_array: RGB image as numpy array (H, W, 3).
        garment_colors: List of {"label": str, "hex_color": str, "mask_area": int}.
        garment_labels: Corresponding garment labels.
        skin_mask: Boolean mask of skin pixels. None if unavailable.
        pil_image: Full PIL image for CLIP occasion detection.

    Returns:
        ColorEngineResult with all sub-analyses, flags, and recommendations.
    """
    result = ColorEngineResult()
    all_flags = []

    # --- Build garment details with named colors ---
    for gc in garment_colors:
        hex_c = gc.get("hex_color")
        detail = {
            "label": gc["label"],
            "display_name": gc.get("display_name", gc["label"]),
            "hex_color": hex_c,
            "color_name": name_color(hex_c) if hex_c else "unknown",
        }
        result.garment_details.append(detail)

    # --- 1. Skin Analysis ---
    skin_result = analyze_skin(image_array, skin_mask, garment_colors)
    result.skin = skin_result

    if skin_result.detected:
        if skin_result.garment_scores:
            avg_skin_score = sum(skin_result.garment_scores.values()) / len(
                skin_result.garment_scores
            )
            if avg_skin_score < 0.40:
                all_flags.append("skin_clash")
    else:
        all_flags.append("skin_not_detected")

    # --- 2. Proportion Analysis ---
    proportion_result = analyze_proportion(garment_colors)
    result.proportion = proportion_result
    all_flags.extend(proportion_result.flags)

    # --- 3. Occasion Analysis ---
    occasion_result = analyze_occasion(garment_colors, garment_labels, pil_image)
    result.occasion = occasion_result

    # --- 4. Style Profiling ---
    style_result = analyze_style(garment_colors, garment_labels)
    result.style = style_result
    all_flags.extend(style_result.flags)

    # --- Consolidate flags ---
    seen = set()
    for f in all_flags:
        if f not in seen:
            seen.add(f)
            result.all_flags.append(f)
            if f in _FLAG_MESSAGES:
                result.flag_messages.append(_FLAG_MESSAGES[f])

    # --- Generate recommendations ---
    result.recommendations = _generate_recommendations(result)

    # --- Compute overall outfit score ---
    result.outfit_score, result.outfit_score_label = _compute_outfit_score(result)

    logger.info(
        f"Color Engine: outfit_score={result.outfit_score} ({result.outfit_score_label}), "
        f"occasions={[o.occasion for o in occasion_result.occasions[:3]]}, "
        f"styles={[s for s in style_result.top_archetypes]}, "
        f"flags={result.all_flags}"
    )
    return result

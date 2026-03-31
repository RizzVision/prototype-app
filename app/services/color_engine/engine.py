"""
Master Color Engine - Orchestrator

Combines all analyzers into a single cohesive analysis pipeline:
  1. Advanced harmony analysis (hue, lightness, saturation, temperature, contrast)
  2. Skin tone detection and compatibility
  3. Seasonal color theory application
  4. Proportion analysis (60-30-10 rule)
  5. Occasion suitability scoring
  6. Style archetype profiling

Produces a weighted master score and comprehensive diagnostic flags
with human-readable messages for TTS delivery.
"""

import logging
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
from PIL import Image as PILImage

from app.services.color_engine.harmony_analyzer import (
    HarmonyDetail,
    analyze_harmony,
)
from app.services.color_engine.skin_analysis import SkinToneResult, analyze_skin
from app.services.color_engine.seasonal_analysis import SeasonalResult, analyze_seasonal
from app.services.color_engine.proportion_analyzer import ProportionResult, analyze_proportion
from app.services.color_engine.occasion_engine import OccasionResult, analyze_occasion
from app.services.color_engine.style_profiler import StyleResult, analyze_style
from app.services.color_engine.color_science import name_color

logger = logging.getLogger(__name__)


@dataclass
class ColorEngineResult:
    """Complete output from the master color engine."""
    # Master score (0-1)
    overall_score: float = 0.0
    overall_label: str = "unknown"

    # Sub-analysis results
    harmony: HarmonyDetail = field(default_factory=HarmonyDetail)
    skin: SkinToneResult = field(default_factory=SkinToneResult)
    seasonal: SeasonalResult = field(default_factory=SeasonalResult)
    proportion: ProportionResult = field(default_factory=ProportionResult)
    occasion: OccasionResult = field(default_factory=OccasionResult)
    style: StyleResult = field(default_factory=StyleResult)

    # Garment details with named colors
    garment_details: list[dict] = field(default_factory=list)

    # Consolidated flags and spoken messages
    all_flags: list[str] = field(default_factory=list)
    flag_messages: list[str] = field(default_factory=list)

    # Top recommendations
    recommendations: list[str] = field(default_factory=list)


# Scoring weights for the master score
_WEIGHTS = {
    "harmony": 0.30,         # Core color compatibility
    "skin_compat": 0.20,     # How well colors suit the skin tone
    "proportion": 0.15,      # 60-30-10 balance
    "temperature": 0.10,     # Warm/cool coherence
    "contrast": 0.10,        # Visual distinctness
    "enhancement": 0.10,     # Mutual color enhancement
    "coherence": 0.05,       # Style coherence
}

# When skin is not detected, redistribute its weight
_WEIGHTS_NO_SKIN = {
    "harmony": 0.40,
    "proportion": 0.15,
    "temperature": 0.15,
    "contrast": 0.10,
    "enhancement": 0.15,
    "coherence": 0.05,
}


# Complete flag → spoken message dictionary
_FLAG_MESSAGES = {
    # Harmony flags
    "hue_clash": "Two of your garments have colours that work against each other.",
    "low_lightness_contrast": "Your pieces are too similar in brightness. They blend together.",
    "all_high_saturation": "Every piece is very bold. Together they feel overwhelming.",
    "all_neutral_tones": "The outfit is all neutral. Safe, but there is no focal point.",
    "all_dark": "Everything is dark. A lighter piece would add dimension.",
    "all_light": "Everything is very light. A deeper piece would add grounding.",

    # Temperature flags
    "temperature_clash": "Your outfit mixes very warm and very cool tones. This creates visual tension.",
    "temperature_mix": "Your colours are split between warm and cool. Picking one direction would look more intentional.",

    # Contrast / enhancement flags
    "indistinguishable_pair": "Two of your garments are so similar they are hard to tell apart.",
    "low_contrast_pair": "Some of your pieces lack visual separation. More contrast would help.",

    # Proportion flags
    "no_dominant_color": "There is no clear anchor colour. One piece should take the lead.",
    "competing_dominance": "Two garments compete for attention. Let one be the star and the other support it.",
    "accent_overpowers": "A smaller piece visually overpowers the rest. Consider muting the accent.",

    # Skin compatibility flags
    "skin_clash": "Some of your colours do not complement your skin tone.",
    "season_mismatch": "Most of your colours fall outside your best seasonal palette.",
    "unflattering_color": "One of your garments is in a colour that does not flatter your complexion.",

    # Style flags
    "unclear_style_direction": "The outfit does not have a clear style direction. The pieces feel unrelated.",
    "low_coherence": "The garments do not tell a consistent story together.",

    # Skin not detected
    "skin_not_detected": "I could not detect your skin clearly. Skin tone analysis is not available for this photo.",
}


def _label_overall_score(score: float) -> str:
    """Convert a numerical score to a spoken label."""
    if score >= 0.80:
        return "excellent"
    elif score >= 0.65:
        return "good"
    elif score >= 0.50:
        return "decent"
    elif score >= 0.35:
        return "needs work"
    else:
        return "poor"


def _generate_recommendations(result: ColorEngineResult) -> list[str]:
    """Generate top 3 actionable recommendations based on all analysis data."""
    recs = []
    priority_flags = []

    # Priority 1: Skin compatibility issues
    if "unflattering_color" in result.all_flags and result.seasonal.per_garment:
        worst = min(result.seasonal.per_garment, key=lambda p: p["score"])
        if worst["score"] < 0.45:
            recs.append(worst["recommendation"])

    # Priority 2: Clashing colors
    if "hue_clash" in result.all_flags and result.harmony.pairwise:
        clashing = [p for p in result.harmony.pairwise if p["relationship"] == "clashing"]
        if clashing:
            pair = clashing[0]
            recs.append(
                f"The {pair['garment_a']} and {pair['garment_b']} clash. "
                f"Replace one with a complementary tone."
            )

    # Priority 3: Temperature mixing
    if "temperature_clash" in result.all_flags:
        recs.append(
            "Commit to either warm or cool tones across the outfit. "
            "Mixing both creates visual confusion."
        )

    # Priority 4: Proportion issues
    if "no_dominant_color" in result.all_flags:
        recs.append(
            "Choose one garment to be the anchor colour covering the most area. "
            "Let other pieces play supporting roles."
        )

    if "competing_dominance" in result.all_flags:
        recs.append(
            "Two pieces are fighting for attention. Make one lighter, darker, "
            "or more muted so the other can lead."
        )

    # Priority 5: Contrast
    if "low_lightness_contrast" in result.all_flags:
        recs.append(
            "Add more brightness contrast. Pair a dark piece with a light one "
            "so each garment stands out."
        )

    if "all_high_saturation" in result.all_flags:
        recs.append(
            "Dial back one piece to a muted version of the same colour. "
            "One vivid piece reads as intentional. All vivid reads as loud."
        )

    # Priority 6: Palette suggestions from seasonal analysis
    if (
        result.seasonal.palette_suggestions
        and result.seasonal.overall_compatibility < 0.60
        and len(recs) < 3
    ):
        suggestions = [name_color(c) for c in result.seasonal.palette_suggestions[:2]]
        recs.append(
            f"Based on your skin tone, try incorporating {suggestions[0]} "
            f"or {suggestions[1]} into your outfit."
        )

    # Positive reinforcement if things are going well
    if not recs:
        if result.overall_score >= 0.75:
            recs.append("This is a strong outfit. The colors work well together.")
        else:
            recs.append("Small adjustments in colour contrast would elevate this outfit.")

    return recs[:3]


def run_color_engine(
    image_array: np.ndarray,
    garment_colors: list[dict],
    garment_labels: list[str],
    skin_mask: np.ndarray | None = None,
    pil_image: Optional[PILImage.Image] = None,
) -> ColorEngineResult:
    """
    Run the complete color analysis engine.

    Args:
        image_array: RGB image as numpy array (H, W, 3).
        garment_colors: List of {"label": str, "hex_color": str, "mask_area": int}.
        garment_labels: Corresponding garment labels.
        skin_mask: Boolean mask of skin pixels. None if unavailable.

    Returns:
        ColorEngineResult with all sub-analyses, master score, flags, and recommendations.
    """
    result = ColorEngineResult()
    all_flags = []

    hex_colors = [gc.get("hex_color") for gc in garment_colors]

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

    # --- 1. Advanced Harmony ---
    harmony_detail, harmony_flags = analyze_harmony(hex_colors, garment_labels)
    result.harmony = harmony_detail
    all_flags.extend(harmony_flags)

    # --- 2. Skin Analysis ---
    skin_result = analyze_skin(image_array, skin_mask, garment_colors)
    result.skin = skin_result

    if skin_result.detected:
        # Check for skin clash
        if skin_result.garment_scores:
            avg_skin_score = sum(skin_result.garment_scores.values()) / len(
                skin_result.garment_scores
            )
            if avg_skin_score < 0.40:
                all_flags.append("skin_clash")
    else:
        all_flags.append("skin_not_detected")

    # --- 3. Seasonal Analysis ---
    seasonal_result = analyze_seasonal(
        skin_result.season if skin_result.detected else "unknown",
        garment_colors,
    )
    result.seasonal = seasonal_result
    all_flags.extend(seasonal_result.flags)

    # --- 4. Proportion Analysis ---
    proportion_result = analyze_proportion(garment_colors)
    result.proportion = proportion_result
    all_flags.extend(proportion_result.flags)

    # --- 5. Occasion Analysis (CLIP zero-shot when image is available) ---
    occasion_result = analyze_occasion(garment_colors, garment_labels, pil_image)
    result.occasion = occasion_result

    # --- 6. Style Profiling ---
    style_result = analyze_style(garment_colors, garment_labels)
    result.style = style_result
    all_flags.extend(style_result.flags)

    # --- Compute master score ---
    if skin_result.detected:
        weights = _WEIGHTS
        skin_score = (
            sum(skin_result.garment_scores.values())
            / max(1, len(skin_result.garment_scores))
        )
    else:
        weights = _WEIGHTS_NO_SKIN
        skin_score = 0.0

    # Compute weighted average of the harmony sub-scores
    harmony_avg = (
        harmony_detail.hue_score * 0.35
        + harmony_detail.lightness_score * 0.25
        + harmony_detail.saturation_score * 0.20
        + harmony_detail.mutual_enhancement * 0.20
    )

    score_components = {
        "harmony": harmony_avg,
        "proportion": proportion_result.score,
        "temperature": harmony_detail.temperature_score,
        "contrast": harmony_detail.contrast_score,
        "enhancement": harmony_detail.mutual_enhancement,
        "coherence": style_result.coherence_score,
    }

    if skin_result.detected:
        score_components["skin_compat"] = skin_score

    master_score = sum(
        score_components.get(k, 0.0) * w for k, w in weights.items()
    )
    result.overall_score = round(max(0.0, min(1.0, master_score)), 2)
    result.overall_label = _label_overall_score(result.overall_score)

    # --- Consolidate flags ---
    # Deduplicate while preserving order
    seen = set()
    for f in all_flags:
        if f not in seen:
            seen.add(f)
            result.all_flags.append(f)
            if f in _FLAG_MESSAGES:
                result.flag_messages.append(_FLAG_MESSAGES[f])

    # --- Generate recommendations ---
    result.recommendations = _generate_recommendations(result)

    logger.info(
        f"Color Engine: score={result.overall_score} ({result.overall_label}), "
        f"flags={result.all_flags}"
    )
    return result

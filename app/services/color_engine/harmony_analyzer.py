"""
Advanced Color Harmony Analyzer

Upgrades beyond basic hue-angle matching:
- CIEDE2000-based perceptual difference (not just hue)
- 8 named harmony patterns with nuanced scoring
- Temperature coherence analysis (warm vs cool mixing)
- Mutual enhancement detection (do colors make each other look better?)
- Pairwise clash detection with severity grading
"""

import logging
import math
from dataclasses import dataclass, field

from app.services.color_engine.color_science import (
    hex_to_hsl,
    hex_to_lab,
    hex_to_lch,
    delta_e_ciede2000,
    color_temperature,
    contrast_ratio,
)

logger = logging.getLogger(__name__)


@dataclass
class HarmonyDetail:
    """Detailed output from advanced harmony analysis."""
    hue_score: float = 0.0
    hue_pattern: str = "unknown"
    lightness_score: float = 0.0
    saturation_score: float = 0.0
    temperature_score: float = 0.0
    contrast_score: float = 0.0
    mutual_enhancement: float = 0.0
    pairwise: list[dict] = field(default_factory=list)  # Per-pair analysis


# ──────────────────────────────────────────────
# Hue harmony patterns (8 patterns, 12-sector precision)
# ──────────────────────────────────────────────

def _hue_angle_diff(h1: float, h2: float) -> float:
    """Shortest arc on the color wheel in degrees."""
    diff = abs(h1 - h2) % 360
    return min(diff, 360 - diff)


def _classify_hue_pattern(hue_diffs: list[float]) -> tuple[str, float]:
    """
    Classify the dominant hue relationship from pairwise hue differences.

    Returns (pattern_name, score).
    """
    if not hue_diffs:
        return "single", 0.85

    max_diff = max(hue_diffs)
    avg_diff = sum(hue_diffs) / len(hue_diffs)

    # Monochromatic: all hues within 15°
    if max_diff < 15:
        return "monochromatic", 0.90

    # Analogous: hues within 60°, very unified
    if max_diff <= 60:
        # Score higher for tighter analogous
        score = 0.85 - (max_diff - 15) * 0.002
        return "analogous", max(0.78, score)

    # Complementary: hues ~180° apart (150-210°)
    if 150 <= max_diff <= 210:
        # Closer to 180° is more intentional
        deviation = abs(max_diff - 180)
        score = 0.82 - deviation * 0.003
        return "complementary", max(0.70, score)

    # Split-complementary: one hue + two flanking the complement (120-150° or 210-240°)
    if len(hue_diffs) >= 2:
        sorted_diffs = sorted(hue_diffs)
        if any(100 <= d <= 150 for d in sorted_diffs) and any(
            150 < d <= 260 for d in sorted_diffs
        ):
            return "split-complementary", 0.75

    # Triadic: three hues ~120° apart
    if len(hue_diffs) >= 2:
        triadic_diffs = [d for d in hue_diffs if 100 <= d <= 140]
        if len(triadic_diffs) >= 2:
            return "triadic", 0.72

    # Tetradic / square: four hues ~90° apart
    if len(hue_diffs) >= 3:
        square_diffs = [d for d in hue_diffs if 75 <= d <= 105]
        if len(square_diffs) >= 3:
            return "tetradic", 0.65

    # Clash zone: 60-100° is the danger zone
    if any(60 < d < 100 for d in hue_diffs):
        clash_count = sum(1 for d in hue_diffs if 60 < d < 100)
        severity = clash_count / len(hue_diffs)
        score = max(0.20, 0.50 - severity * 0.25)
        return "clash", score

    # Wide analogous / unclassified but not clashing
    if max_diff <= 100:
        return "wide-analogous", 0.70

    return "mixed", 0.60


# ──────────────────────────────────────────────
# Lightness contrast scoring
# ──────────────────────────────────────────────

def _score_lightness(lab_values: list[tuple[float, float, float]]) -> tuple[float, list[str]]:
    """
    Score lightness distribution across garments.

    Good outfits have intentional lightness contrast.
    Returns (score, flags).
    """
    if len(lab_values) < 2:
        return 0.70, []

    l_values = [lab[0] for lab in lab_values]
    l_spread = max(l_values) - min(l_values)
    l_std = float(__import__("numpy").std(l_values))

    flags = []

    # Check if everything is dark
    if all(l < 35 for l in l_values):
        flags.append("all_dark")
        return 0.40, flags

    # Check if everything is light
    if all(l > 75 for l in l_values):
        flags.append("all_light")
        return 0.55, flags

    # Low contrast: pieces blend together
    if l_spread < 15:
        flags.append("low_lightness_contrast")
        return 0.40, flags

    if l_spread < 25:
        flags.append("low_lightness_contrast")
        score = 0.45 + (l_spread - 15) * 0.02
        return score, flags

    # Good contrast
    # Ideal spread is 30-60 in L*
    if 30 <= l_spread <= 65:
        score = 0.85 + min(0.15, l_std / 30 * 0.15)
    elif l_spread > 65:
        score = 0.80  # Very high contrast, bold but can work
    else:
        score = 0.60 + (l_spread - 25) * 0.04

    return min(1.0, score), flags


# ──────────────────────────────────────────────
# Saturation balance scoring
# ──────────────────────────────────────────────

def _score_saturation(hsl_values: list[tuple[float, float, float]]) -> tuple[float, list[str]]:
    """
    Score saturation balance across garments.

    Returns (score, flags).
    """
    if len(hsl_values) < 2:
        return 0.70, []

    saturations = [hsl[1] for hsl in hsl_values]
    flags = []

    all_high = all(s > 0.70 for s in saturations)
    all_neutral = all(s < 0.15 for s in saturations)
    sat_spread = max(saturations) - min(saturations)

    if all_high:
        flags.append("all_high_saturation")
        return 0.30, flags

    if all_neutral:
        flags.append("all_neutral_tones")
        return 0.50, flags

    # Intentional mix is good
    if sat_spread > 0.30:
        score = min(0.90, 0.65 + sat_spread * 0.50)
    elif sat_spread > 0.15:
        score = 0.60 + sat_spread * 0.30
    else:
        score = 0.55

    return score, flags


# ──────────────────────────────────────────────
# Temperature coherence
# ──────────────────────────────────────────────

def _score_temperature_coherence(hex_colors: list[str]) -> tuple[float, list[str]]:
    """
    Score whether garment colors share a consistent temperature.

    Mixing warm and cool tones is a common outfit mistake.
    Returns (score, flags).
    """
    if len(hex_colors) < 2:
        return 0.80, []

    temps = [color_temperature(c) for c in hex_colors]
    labels = [t[0] for t in temps]
    values = [t[1] for t in temps]

    flags = []

    warm_count = sum(1 for l in labels if l == "warm")
    cool_count = sum(1 for l in labels if l == "cool")
    neutral_count = sum(1 for l in labels if l == "neutral")

    # Pure warm or pure cool = excellent
    if warm_count == len(labels) or cool_count == len(labels):
        return 0.95, flags

    # All neutral = fine but unremarkable
    if neutral_count == len(labels):
        return 0.70, flags

    # Neutral + one temperature = good
    if neutral_count > 0 and (warm_count == 0 or cool_count == 0):
        return 0.85, flags

    # Mixed warm and cool
    if warm_count > 0 and cool_count > 0:
        # Severity depends on how extreme the mix is
        temp_range = max(values) - min(values)
        if temp_range > 1.2:
            flags.append("temperature_clash")
            return 0.30, flags
        elif temp_range > 0.8:
            flags.append("temperature_mix")
            return 0.50, flags
        else:
            # Mild mix, borderline acceptable
            return 0.65, flags

    return 0.70, flags


# ──────────────────────────────────────────────
# Mutual enhancement / contrast quality
# ──────────────────────────────────────────────

def _score_mutual_enhancement(hex_colors: list[str]) -> tuple[float, list[str]]:
    """
    Score how well colors enhance each other visually.

    Considers:
    - CIEDE2000 distinctness (colors should be perceptually distinct)
    - WCAG-adapted contrast ratio (garments should be visually separable)
    - Chroma balance (one vivid piece + muted base is a strong combo)
    """
    if len(hex_colors) < 2:
        return 0.70, []

    flags = []

    # Pairwise CIEDE2000 distances
    pair_distances = []
    pair_contrasts = []
    for i in range(len(hex_colors)):
        for j in range(i + 1, len(hex_colors)):
            de = delta_e_ciede2000(hex_colors[i], hex_colors[j])
            cr = contrast_ratio(hex_colors[i], hex_colors[j])
            pair_distances.append(de)
            pair_contrasts.append(cr)

    avg_distance = sum(pair_distances) / len(pair_distances)
    min_distance = min(pair_distances)
    avg_contrast = sum(pair_contrasts) / len(pair_contrasts)
    min_contrast = min(pair_contrasts)

    # Colors too similar (hard to distinguish)
    if min_distance < 5:
        flags.append("indistinguishable_pair")

    if min_contrast < 1.5:
        flags.append("low_contrast_pair")

    # Score based on average perceptual distance
    # Sweet spot: deltaE 15-45 (clearly different but not jarring)
    if avg_distance < 8:
        dist_score = 0.35
    elif avg_distance < 15:
        dist_score = 0.50 + (avg_distance - 8) * 0.03
    elif avg_distance <= 45:
        dist_score = 0.80 + min(0.15, (avg_distance - 15) / 200)
    else:
        dist_score = 0.75  # Very different, bold choice

    # Chroma analysis: look for intentional accent
    lch_values = [hex_to_lch(c) for c in hex_colors]
    chromas = [lch[1] for lch in lch_values]
    chroma_spread = max(chromas) - min(chromas) if chromas else 0

    # Having a chroma spread (one muted + one vivid) is a strong styling choice
    accent_bonus = min(0.10, chroma_spread / 50 * 0.10)

    score = min(1.0, dist_score + accent_bonus)
    return score, flags


# ──────────────────────────────────────────────
# Pairwise analysis (for detailed diagnostics)
# ──────────────────────────────────────────────

def _analyze_pairs(hex_colors: list[str], labels: list[str]) -> list[dict]:
    """Generate detailed pairwise analysis for each color pair."""
    pairs = []
    for i in range(len(hex_colors)):
        for j in range(i + 1, len(hex_colors)):
            h1, _, _ = hex_to_hsl(hex_colors[i])
            h2, _, _ = hex_to_hsl(hex_colors[j])
            hue_diff = _hue_angle_diff(h1, h2)
            de = delta_e_ciede2000(hex_colors[i], hex_colors[j])
            cr = contrast_ratio(hex_colors[i], hex_colors[j])

            t1_label, t1_val = color_temperature(hex_colors[i])
            t2_label, t2_val = color_temperature(hex_colors[j])

            relationship = "harmonious"
            if 60 < hue_diff < 100:
                relationship = "clashing"
            elif de < 8:
                relationship = "too similar"
            elif 150 <= hue_diff <= 210:
                relationship = "complementary"

            pairs.append({
                "garment_a": labels[i],
                "garment_b": labels[j],
                "hue_diff": round(hue_diff, 1),
                "delta_e": round(de, 1),
                "contrast_ratio": round(cr, 2),
                "temp_a": t1_label,
                "temp_b": t2_label,
                "relationship": relationship,
            })
    return pairs


# ──────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────

def analyze_harmony(
    hex_colors: list[str], labels: list[str]
) -> tuple[HarmonyDetail, list[str]]:
    """
    Full advanced harmony analysis.

    Args:
        hex_colors: List of garment hex colors (None values filtered out).
        labels: Corresponding garment labels (same length as hex_colors).

    Returns:
        (HarmonyDetail, flags) where flags is a list of diagnostic flag codes.
    """
    valid = [(c, l) for c, l in zip(hex_colors, labels) if c is not None]
    if not valid:
        return HarmonyDetail(), []

    colors = [c for c, _ in valid]
    color_labels = [l for _, l in valid]
    all_flags = []

    # Compute all color representations
    hsl_values = [hex_to_hsl(c) for c in colors]
    lab_values = [hex_to_lab(c) for c in colors]
    hues = [h for h, s, l in hsl_values]

    # Pairwise hue differences
    hue_diffs = []
    for i in range(len(hues)):
        for j in range(i + 1, len(hues)):
            hue_diffs.append(_hue_angle_diff(hues[i], hues[j]))

    # Score each axis
    hue_pattern, hue_score = _classify_hue_pattern(hue_diffs)
    lightness_score, l_flags = _score_lightness(lab_values)
    saturation_score, s_flags = _score_saturation(hsl_values)
    temperature_score, t_flags = _score_temperature_coherence(colors)
    enhancement_score, e_flags = _score_mutual_enhancement(colors)

    # Check for hue clash flag
    if hue_pattern == "clash":
        all_flags.append("hue_clash")

    all_flags.extend(l_flags)
    all_flags.extend(s_flags)
    all_flags.extend(t_flags)
    all_flags.extend(e_flags)

    # Pairwise detail
    pairwise = _analyze_pairs(colors, color_labels)

    # Contrast score from pairwise data
    if pairwise:
        avg_cr = sum(p["contrast_ratio"] for p in pairwise) / len(pairwise)
        contrast_score = min(1.0, avg_cr / 7.0)  # 7:1 = excellent
    else:
        contrast_score = 0.70

    detail = HarmonyDetail(
        hue_score=round(hue_score, 3),
        hue_pattern=hue_pattern,
        lightness_score=round(lightness_score, 3),
        saturation_score=round(saturation_score, 3),
        temperature_score=round(temperature_score, 3),
        contrast_score=round(contrast_score, 3),
        mutual_enhancement=round(enhancement_score, 3),
        pairwise=pairwise,
    )

    logger.info(
        f"Harmony: pattern={hue_pattern}, hue={hue_score:.2f}, "
        f"lightness={lightness_score:.2f}, sat={saturation_score:.2f}, "
        f"temp={temperature_score:.2f}, enhance={enhancement_score:.2f}"
    )
    return detail, all_flags

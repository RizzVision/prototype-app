"""
Stage 4 - Colour Harmony Engine

Pure Python, zero ML, fully deterministic. Colour compatibility is computed,
not inferred. The output is reproducible, auditable, and cannot be replicated
by prompting an LLM.

Three-axis scoring:
  - Hue relationship (50%): recognised harmonic patterns
  - Lightness contrast (30%): brightness spread across garments
  - Saturation balance (20%): intentional saturation mixing

Diagnostic flags translate numbers into actionable spoken statements.
"""

import colorsys
import logging
from dataclasses import dataclass, field

import numpy as np
from skimage import color as skcolor

logger = logging.getLogger(__name__)


@dataclass
class HarmonyResult:
    """Complete output of the colour harmony analysis."""
    score: float
    label: str
    flags: list[str] = field(default_factory=list)
    hue_score: float = 0.0
    lightness_score: float = 0.0
    saturation_score: float = 0.0


# --- Flag-to-speech mapping ---
FLAG_MESSAGES = {
    "low_lightness_contrast": (
        "Your pieces are too similar in brightness. They blend together."
    ),
    "all_high_saturation": (
        "Every piece is very bold. Together they feel overwhelming."
    ),
    "all_neutral_tones": (
        "The outfit is all neutral. Safe, but there is no focal point."
    ),
    "hue_clash": (
        "Two of your garments have colours that work against each other."
    ),
}


def hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    """Convert hex string like '#4A7B3C' to (R, G, B) tuple."""
    h = hex_color.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def hex_to_hsl(hex_color: str) -> tuple[float, float, float]:
    """Convert hex to (H in degrees, S in [0,1], L in [0,1])."""
    r, g, b = hex_to_rgb(hex_color)
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    return h * 360, s, l  # H in degrees, S, L


def hex_to_lab_lightness(hex_color: str) -> float:
    """Extract the L* value from CIELAB for a hex colour."""
    r, g, b = hex_to_rgb(hex_color)
    rgb_float = np.array([[[r / 255, g / 255, b / 255]]], dtype=np.float64)
    lab = skcolor.rgb2lab(rgb_float)
    return float(lab[0, 0, 0])  # L* channel


def _score_hue_relationship(hues: list[float]) -> tuple[float, str, bool]:
    """
    Score how well the hue angles form a recognised harmonic pattern.

    Returns (score, label, has_clash).
    """
    if len(hues) < 2:
        return 0.85, "monochromatic", False

    # Compute all pairwise hue angle differences
    diffs = []
    for i in range(len(hues)):
        for j in range(i + 1, len(hues)):
            diff = abs(hues[i] - hues[j])
            diff = min(diff, 360 - diff)  # Shortest arc on the colour wheel
            diffs.append(diff)

    # Use the maximum pairwise difference to determine the dominant pattern
    max_diff = max(diffs)
    has_clash = False

    if max_diff < 15:
        score, label = 0.90, "monochromatic"
    elif max_diff <= 60:
        score, label = 0.85, "analogous"
    elif 60 < max_diff < 100:
        score, label = 0.30, "clash"
        has_clash = True
    elif 100 <= max_diff < 150:
        score, label = 0.70, "split-complementary"
    elif 150 <= max_diff <= 210:
        score, label = 0.80, "complementary"
    elif 210 < max_diff <= 260:
        score, label = 0.70, "split-complementary"
    else:
        # >260 wraps back towards analogous on the other side
        score, label = 0.75, "wide-split"

    # Check if any individual pair is in the clash zone
    for d in diffs:
        if 60 < d < 100:
            has_clash = True
            break

    return score, label, has_clash


def _score_lightness_contrast(lab_lightness_values: list[float]) -> tuple[float, bool]:
    """
    Score the spread of L* values across garments.

    Returns (score, has_low_contrast_flag).
    """
    if len(lab_lightness_values) < 2:
        return 0.70, False

    l_spread = max(lab_lightness_values) - min(lab_lightness_values)

    low_contrast = l_spread < 20

    # Map spread to score: 0 spread -> 0.40, 80+ spread -> 1.0
    score = min(1.0, max(0.40, 0.40 + (l_spread / 80) * 0.60))

    return score, low_contrast


def _score_saturation_balance(saturations: list[float]) -> tuple[float, bool, bool]:
    """
    Score whether saturation levels are intentionally mixed.

    Returns (score, all_high_flag, all_neutral_flag).
    """
    if len(saturations) < 2:
        return 0.70, False, False

    all_high = all(s > 0.70 for s in saturations)
    all_neutral = all(s < 0.15 for s in saturations)

    if all_high:
        score = 0.35
    elif all_neutral:
        score = 0.50
    else:
        # Intentional mix of saturations is good
        sat_spread = max(saturations) - min(saturations)
        score = min(0.90, max(0.50, 0.50 + sat_spread * 0.80))

    return score, all_high, all_neutral


def analyze_harmony(hex_colors: list[str]) -> HarmonyResult:
    """
    Compute colour harmony from a list of garment hex colours.

    This is the core differentiator of RizzVision. The score is a weighted
    combination of three independent axes:
      - Hue relationship: 50%
      - Lightness contrast: 30%
      - Saturation balance: 20%

    Returns a HarmonyResult with score, label, flags, and per-axis scores.
    """
    # Filter out None values
    valid_colors = [c for c in hex_colors if c is not None]

    if not valid_colors:
        return HarmonyResult(
            score=0.0,
            label="unknown",
            flags=[],
            hue_score=0.0,
            lightness_score=0.0,
            saturation_score=0.0,
        )

    if len(valid_colors) == 1:
        return HarmonyResult(
            score=0.85,
            label="single garment",
            flags=[],
            hue_score=0.85,
            lightness_score=0.70,
            saturation_score=0.70,
        )

    # Extract colour components
    hsl_values = [hex_to_hsl(c) for c in valid_colors]
    hues = [h for h, s, l in hsl_values]
    saturations = [s for h, s, l in hsl_values]
    lab_lightness = [hex_to_lab_lightness(c) for c in valid_colors]

    # Score each axis
    hue_score, label, has_hue_clash = _score_hue_relationship(hues)
    lightness_score, has_low_contrast = _score_lightness_contrast(lab_lightness)
    saturation_score, has_all_high_sat, has_all_neutral = _score_saturation_balance(
        saturations
    )

    # Weighted combination
    final_score = (
        hue_score * 0.50
        + lightness_score * 0.30
        + saturation_score * 0.20
    )

    # Collect diagnostic flags
    flags = []
    if has_low_contrast:
        flags.append("low_lightness_contrast")
    if has_all_high_sat:
        flags.append("all_high_saturation")
    if has_all_neutral:
        flags.append("all_neutral_tones")
    if has_hue_clash:
        flags.append("hue_clash")

    result = HarmonyResult(
        score=round(final_score, 2),
        label=label,
        flags=flags,
        hue_score=round(hue_score, 2),
        lightness_score=round(lightness_score, 2),
        saturation_score=round(saturation_score, 2),
    )

    logger.info(
        f"Harmony: score={result.score}, label={result.label}, flags={result.flags}"
    )
    return result


def get_flag_messages(flags: list[str]) -> list[str]:
    """Convert flag codes to user-facing spoken messages."""
    return [FLAG_MESSAGES[f] for f in flags if f in FLAG_MESSAGES]

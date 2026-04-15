"""
Proportion Analyzer - The 60-30-10 Rule

Analyzes how color is distributed across garment areas.

The 60-30-10 rule is the cornerstone of outfit color proportion:
  - 60% dominant color (base/anchor)
  - 30% secondary color (supports the dominant)
  - 10% accent color (draws the eye, adds interest)

Also computes visual weight: saturated/dark colors on large areas
feel heavier than light/muted colors on small areas.
"""

import logging
from dataclasses import dataclass, field

from app.services.color_engine.color_science import hex_to_hsl, hex_to_lab

logger = logging.getLogger(__name__)


@dataclass
class ProportionResult:
    """Output of the proportion analysis."""
    score: float = 0.0
    actual_ratios: list[dict] = field(default_factory=list)  # [{label, ratio, role}]
    ideal_deviation: float = 0.0  # How far from 60-30-10
    visual_weight_balance: float = 0.0  # 0 = imbalanced, 1 = balanced
    flags: list[str] = field(default_factory=list)


def _compute_visual_weight(hex_color: str, area_ratio: float) -> float:
    """
    Compute visual weight of a garment.

    Visual weight = area × intensity factor.
    Dark, saturated colors feel heavier. Light, muted colors feel lighter.
    """
    if hex_color is None:
        return area_ratio * 0.5

    _, s, l = hex_to_hsl(hex_color)
    lab_l, _, _ = hex_to_lab(hex_color)

    # Darkness factor: darker = heavier (invert lightness)
    darkness = 1.0 - (lab_l / 100.0)

    # Saturation factor: more saturated = heavier
    intensity = 0.5 * darkness + 0.5 * s

    return area_ratio * (0.3 + 0.7 * intensity)


def analyze_proportion(
    garment_data: list[dict],
) -> ProportionResult:
    """
    Analyze color proportion across the outfit.

    Args:
        garment_data: List of dicts with keys:
            - label: garment label
            - hex_color: dominant color hex
            - mask_area: pixel count of the garment mask

    Returns:
        ProportionResult with score, ratios, and flags.
    """
    result = ProportionResult()

    if not garment_data:
        return result

    # Calculate area ratios
    total_area = sum(g.get("mask_area", 1) for g in garment_data)
    if total_area == 0:
        return result

    # Stamp temporary ratio keys — cleaned up in finally even if an exception occurs
    for g in garment_data:
        g["_ratio"] = g.get("mask_area", 1) / total_area

    try:
        # Sort by area (largest first)
        sorted_garments = sorted(garment_data, key=lambda g: g["_ratio"], reverse=True)

        # Assign roles based on area
        roles = []
        for i, g in enumerate(sorted_garments):
            if i == 0:
                role = "dominant"
            elif i == 1:
                role = "secondary"
            else:
                role = "accent"

            roles.append({
                "label": g["label"],
                "ratio": round(g["_ratio"], 3),
                "role": role,
                "hex_color": g.get("hex_color"),
            })

        result.actual_ratios = roles

        # Single garment: proportion is trivially correct
        if len(sorted_garments) == 1:
            result.score = 0.75
            result.visual_weight_balance = 0.75
            return result

        # Score against 60-30-10 ideal
        ratios = [g["_ratio"] for g in sorted_garments]

        if len(ratios) == 2:
            # Two garments: ideal is ~65/35 or ~70/30
            ideal = [0.65, 0.35]
            deviation = sum(abs(a - i) for a, i in zip(ratios, ideal))
            # Also acceptable: 55/45 to 75/25
            if 0.50 <= ratios[0] <= 0.80:
                proportion_score = max(0.55, 1.0 - deviation * 1.5)
            else:
                proportion_score = max(0.30, 0.6 - deviation)
        elif len(ratios) == 3:
            # Three garments: ideal is 60/30/10
            ideal = [0.60, 0.30, 0.10]
            deviation = sum(abs(a - i) for a, i in zip(ratios, ideal))
            proportion_score = max(0.30, 1.0 - deviation * 1.2)
        else:
            # 4+ garments: check that there's a clear hierarchy
            # Dominant should be > 40%, and there should be clear steps
            if ratios[0] > 0.40 and ratios[0] > ratios[1] * 1.3:
                proportion_score = 0.65
            else:
                proportion_score = 0.45
                result.flags.append("no_dominant_color")

        result.ideal_deviation = round(
            sum(abs(a - i) for a, i in zip(ratios, [0.60, 0.30, 0.10][:len(ratios)])),
            3,
        )

        # Flags
        if len(ratios) >= 2 and abs(ratios[0] - ratios[1]) < 0.08:
            result.flags.append("competing_dominance")
            proportion_score *= 0.8

        # Visual weight balance
        weights = []
        for g in sorted_garments:
            vw = _compute_visual_weight(g.get("hex_color"), g["_ratio"])
            weights.append(vw)

        if len(weights) >= 2:
            weight_range = max(weights) - min(weights)
            # Good balance means the dominant garment carries proportional weight
            # If a tiny accent has more visual weight than the base, it's unbalanced
            if weights[0] >= max(weights[1:]):
                balance = 0.80 + 0.20 * (1.0 - weight_range)
            else:
                balance = 0.40  # Accent overpowers the base
                result.flags.append("accent_overpowers")
            result.visual_weight_balance = round(max(0.0, min(1.0, balance)), 3)
        else:
            result.visual_weight_balance = 0.75

        # Final score: proportion accuracy + weight balance
        result.score = round(
            proportion_score * 0.60 + result.visual_weight_balance * 0.40, 3
        )

        logger.info(
            f"Proportion: score={result.score}, deviation={result.ideal_deviation}, "
            f"flags={result.flags}"
        )
        return result

    finally:
        # Always remove temp keys so callers never see _ratio on their dicts
        for g in garment_data:
            g.pop("_ratio", None)

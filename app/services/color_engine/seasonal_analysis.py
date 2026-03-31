"""
Seasonal Color Theory Analyzer

Applies the four-season personal color theory to evaluate
how well garment colors harmonize with the user's natural coloring.

The four seasons:
  Spring (warm + light): Clear, warm colors with golden undertones
  Summer (cool + light): Soft, muted colors with blue undertones
  Autumn (warm + deep): Rich, earthy colors with golden undertones
  Winter (cool + deep): High-contrast, clear colors with blue undertones

Each season has sub-types for more precise analysis:
  Light Spring / Warm Spring / Clear Spring
  Light Summer / Cool Summer / Soft Summer
  Soft Autumn / Warm Autumn / Deep Autumn
  Deep Winter / Cool Winter / Clear Winter
"""

import logging
from dataclasses import dataclass, field

import numpy as np
from skimage import color as skcolor

from app.services.color_engine.color_science import (
    hex_to_hsl,
    hex_to_lab,
    hex_to_lch,
    delta_e_ciede2000,
    color_temperature,
    name_color,
)

logger = logging.getLogger(__name__)


def _build_lab_array(hex_list: list[str]) -> np.ndarray:
    """Convert a list of hex colors to a (1, N, 3) LAB array for vectorized deltaE."""
    return np.array([hex_to_lab(h) for h in hex_list], dtype=np.float64).reshape(1, -1, 3)


def _min_delta_e_vectorized(query_hex: str, palette_lab: np.ndarray) -> float:
    """
    Return the minimum CIEDE2000 distance from query_hex to any color in palette_lab.

    palette_lab must be shape (1, N, 3). Runs a single vectorized deltaE call
    instead of N individual calls, giving ~N× speedup.
    """
    q = np.array(hex_to_lab(query_hex), dtype=np.float64)
    n = palette_lab.shape[1]
    q_tiled = np.tile(q, (1, n, 1))            # (1, N, 3)
    dists = skcolor.deltaE_ciede2000(q_tiled, palette_lab)  # (1, N)
    return float(dists.min())


def _argmin_delta_e_vectorized(query_hex: str, palette_lab: np.ndarray) -> int:
    """Return the index of the closest color in palette_lab to query_hex."""
    q = np.array(hex_to_lab(query_hex), dtype=np.float64)
    n = palette_lab.shape[1]
    q_tiled = np.tile(q, (1, n, 1))
    dists = skcolor.deltaE_ciede2000(q_tiled, palette_lab)
    return int(dists.argmin())


@dataclass
class SeasonalResult:
    """Output of seasonal color analysis."""
    season: str = "unknown"
    sub_type: str = "unknown"
    overall_compatibility: float = 0.0
    per_garment: list[dict] = field(default_factory=list)  # [{label, score, recommendation}]
    palette_suggestions: list[str] = field(default_factory=list)  # Hex colors that would improve the outfit
    flags: list[str] = field(default_factory=list)


# Comprehensive seasonal palettes: each with ~24 curated colors
# These represent the full range of flattering colors for each season
_SEASONAL_PALETTES = {
    "spring": {
        "description": "warm, clear, and light",
        "colors": [
            "#FF6347", "#FF8C00", "#FFA500", "#FFD700", "#F0E68C",
            "#98FB98", "#00CED1", "#87CEEB", "#DDA0DD", "#FF7F50",
            "#FFDAB9", "#F5DEB3", "#FFE4B5", "#FFA07A", "#20B2AA",
            "#66CDAA", "#BDB76B", "#DAA520", "#CD853F", "#D2B48C",
            "#FFFACD", "#FFF8DC", "#FAEBD7", "#EEE8AA",
        ],
        "avoid": [
            "#000000", "#36454F", "#4B0082", "#191970", "#800000",
            "#2F4F4F", "#808080",
        ],
        "temperature": "warm",
        "clarity": "clear",
        "depth": "light",
    },
    "summer": {
        "description": "cool, soft, and muted",
        "colors": [
            "#B0C4DE", "#D8BFD8", "#DDA0DD", "#E6E6FA", "#AFEEEE",
            "#FFB6C1", "#BC8F8F", "#778899", "#C0C0C0", "#87CEEB",
            "#ADD8E6", "#B0E0E6", "#F0F8FF", "#E0FFFF", "#FAFAD2",
            "#D3D3D3", "#C8A2C8", "#9370DB", "#6A5ACD", "#7B68EE",
            "#A9A9A9", "#8FBC8F", "#5F9EA0", "#4682B4",
        ],
        "avoid": [
            "#FF4500", "#FF8C00", "#FFD700", "#000000", "#8B4513",
            "#FF0000", "#FF6347",
        ],
        "temperature": "cool",
        "clarity": "muted",
        "depth": "light",
    },
    "autumn": {
        "description": "warm, rich, and earthy",
        "colors": [
            "#8B4513", "#D2691E", "#CD853F", "#A0522D", "#DAA520",
            "#B8860B", "#6B8E23", "#556B2F", "#BC8F8F", "#F4A460",
            "#DEB887", "#D2B48C", "#C19A6B", "#8B7355", "#FF8C00",
            "#CC5500", "#A52A2A", "#800000", "#704214", "#808000",
            "#9ACD32", "#2E8B57", "#BDB76B", "#F5DEB3",
        ],
        "avoid": [
            "#FF69B4", "#00FFFF", "#E6E6FA", "#C0C0C0", "#F0F8FF",
            "#000080", "#4169E1",
        ],
        "temperature": "warm",
        "clarity": "muted",
        "depth": "deep",
    },
    "winter": {
        "description": "cool, clear, and high-contrast",
        "colors": [
            "#000000", "#FFFFFF", "#FF0000", "#0000FF", "#FF00FF",
            "#00FF00", "#4B0082", "#DC143C", "#191970", "#C0C0C0",
            "#800080", "#008080", "#00008B", "#8B0000", "#2F4F4F",
            "#FFFAFA", "#F0FFFF", "#1C1C1C", "#2C2C2C", "#FF1493",
            "#00CED1", "#7FFF00", "#FFD700", "#4169E1",
        ],
        "avoid": [
            "#F5DEB3", "#DEB887", "#D2B48C", "#FAEBD7", "#FFE4C4",
            "#BDB76B", "#F0E68C",
        ],
        "temperature": "cool",
        "clarity": "clear",
        "depth": "deep",
    },
}

# Pre-compute LAB arrays for all palette/avoid colors at import time.
# Eliminates N repeated hex_to_lab + deltaE calls per garment during scoring.
_PALETTE_LAB: dict[str, dict[str, np.ndarray]] = {
    season: {
        "colors": _build_lab_array(palette["colors"]),   # (1, N, 3)
        "avoid":  _build_lab_array(palette["avoid"]),    # (1, M, 3)
    }
    for season, palette in _SEASONAL_PALETTES.items()
}


def _score_garment_for_season(
    hex_color: str, season: str
) -> tuple[float, str]:
    """
    Score a single garment color against a seasonal palette.

    Returns (score 0-1, recommendation string).
    Uses pre-computed LAB arrays for a single vectorized deltaE call
    instead of 24+ individual calls.
    """
    palette = _SEASONAL_PALETTES[season]
    cached = _PALETTE_LAB[season]
    color_name = name_color(hex_color)

    # Single vectorized call replaces 24 individual delta_e_ciede2000 calls
    min_good_dist = _min_delta_e_vectorized(hex_color, cached["colors"])
    min_avoid_dist = _min_delta_e_vectorized(hex_color, cached["avoid"])

    garment_temp, _ = color_temperature(hex_color)
    season_temp = palette["temperature"]
    temp_aligned = (garment_temp == season_temp) or garment_temp == "neutral"

    if min_good_dist < 8:
        base_score = 0.95
    elif min_good_dist < 15:
        base_score = 0.80
    elif min_good_dist < 25:
        base_score = 0.60
    elif min_good_dist < 35:
        base_score = 0.40
    else:
        base_score = 0.25

    if min_avoid_dist < 8:
        base_score *= 0.50
    elif min_avoid_dist < 15:
        base_score *= 0.75

    if temp_aligned:
        base_score = min(1.0, base_score * 1.10)
    elif garment_temp != "neutral":
        base_score *= 0.85

    # For recommendation: use argmin from the same vectorized pass
    if base_score >= 0.75:
        rec = f"The {color_name} works well with your coloring."
    else:
        best_idx = _argmin_delta_e_vectorized(hex_color, cached["colors"])
        suggestion = name_color(palette["colors"][best_idx])
        if base_score >= 0.50:
            rec = f"The {color_name} is okay. A {suggestion} would be more flattering."
        else:
            rec = f"The {color_name} does not suit your coloring. Try {suggestion} instead."

    return round(base_score, 3), rec


def _suggest_palette_additions(
    season: str, existing_colors: list[str], count: int = 3
) -> list[str]:
    """
    Suggest palette colors distinct from what is already worn.

    Builds a (P, E) distance matrix in two vectorized deltaE calls
    instead of P×E individual calls (P=24 palette, E=existing count).
    """
    palette_colors = _SEASONAL_PALETTES[season]["colors"]
    if not existing_colors:
        return palette_colors[:count]

    P = len(palette_colors)
    E = len(existing_colors)

    # palette_lab: (1, P, 3)  existing_lab: (1, E, 3)
    palette_lab = _PALETTE_LAB[season]["colors"]                          # (1, P, 3)
    existing_lab = _build_lab_array(existing_colors)                      # (1, E, 3)

    # Expand to (P, E, 3) for a full pairwise distance matrix
    p_exp = np.broadcast_to(palette_lab.reshape(P, 1, 3), (P, E, 3)).copy()
    e_exp = np.broadcast_to(existing_lab.reshape(1, E, 3), (P, E, 3)).copy()
    dist_matrix = skcolor.deltaE_ciede2000(p_exp, e_exp)                  # (P, E)

    min_dists = dist_matrix.min(axis=1)                                   # (P,)

    candidates = [
        (palette_colors[i], float(min_dists[i]))
        for i in range(P)
        if min_dists[i] > 15
    ]
    candidates.sort(key=lambda x: x[1], reverse=True)
    return [c[0] for c in candidates[:count]]


def analyze_seasonal(
    season: str,
    garment_colors: list[dict],
) -> SeasonalResult:
    """
    Full seasonal color analysis.

    Args:
        season: User's detected season ('spring', 'summer', 'autumn', 'winter').
                If 'unknown', defaults to a neutral analysis.
        garment_colors: List of {"label": str, "hex_color": str}.

    Returns:
        SeasonalResult with per-garment scores and palette suggestions.
    """
    result = SeasonalResult()

    if season == "unknown" or season not in _SEASONAL_PALETTES:
        result.season = "unknown"
        result.flags.append("skin_not_detected")
        return result

    result.season = season
    palette_info = _SEASONAL_PALETTES[season]
    result.sub_type = palette_info["description"]

    # Score each garment
    scores = []
    existing_hex = []
    for gc in garment_colors:
        hex_color = gc.get("hex_color")
        if not hex_color:
            continue

        existing_hex.append(hex_color)
        score, recommendation = _score_garment_for_season(hex_color, season)
        scores.append(score)
        result.per_garment.append({
            "label": gc["label"],
            "color_name": name_color(hex_color),
            "score": score,
            "recommendation": recommendation,
        })

    # Overall compatibility
    if scores:
        result.overall_compatibility = round(sum(scores) / len(scores), 3)
    else:
        result.overall_compatibility = 0.5

    # Palette suggestions
    if existing_hex:
        result.palette_suggestions = _suggest_palette_additions(
            season, existing_hex
        )

    # Flags
    if result.overall_compatibility < 0.40:
        result.flags.append("season_mismatch")
    if any(pg["score"] < 0.35 for pg in result.per_garment):
        result.flags.append("unflattering_color")

    logger.info(
        f"Seasonal: season={season}, compatibility={result.overall_compatibility}, "
        f"per_garment={[(pg['label'], pg['score']) for pg in result.per_garment]}"
    )
    return result

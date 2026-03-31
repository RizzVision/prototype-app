"""
Skin Tone Analysis

Detects the user's skin tone from exposed skin regions (face, arms) and
computes compatibility between garment colors and skin.

Uses:
- ITA (Individual Typology Angle) for skin depth classification
- LAB a*/b* for undertone detection (warm/cool/neutral)
- Seasonal color theory for compatibility scoring
"""

import logging
import math
from dataclasses import dataclass, field

import numpy as np
from skimage import color as skcolor
from sklearn.cluster import KMeans

from app.services.color_engine.color_science import (
    hex_to_lab,
    hex_to_hsl,
    hex_to_lch,
    name_color,
)

logger = logging.getLogger(__name__)

# Cap pixel count fed to KMeans for skin extraction.
# Skin pixels need fewer samples than garments (simpler distribution, k=2).
_MAX_SKIN_PIXELS = 2_000
_RNG = np.random.default_rng(42)


@dataclass
class SkinToneResult:
    """Complete skin analysis output."""
    detected: bool = False
    hex_color: str | None = None
    color_name: str | None = None
    depth: str = "unknown"           # very_light, light, medium_light, medium, medium_deep, deep
    undertone: str = "unknown"       # warm, cool, neutral
    season: str = "unknown"          # spring, summer, autumn, winter
    ita_angle: float = 0.0           # Raw ITA value for reference
    garment_scores: dict = field(default_factory=dict)  # label -> compatibility score


# ITA boundaries (dermatology standard)
# ITA = arctan((L* - 50) / b*) × (180/π)
_ITA_DEPTH = [
    (55, "very_light"),
    (41, "light"),
    (28, "medium_light"),
    (10, "medium"),
    (-30, "medium_deep"),
    (-90, "deep"),
]

# Undertone detection: warm has higher a* and b*, cool has lower
# These are typical LAB ranges for skin
_WARM_A_THRESHOLD = 12.0    # a* > 12 suggests warm (more red)
_COOL_A_THRESHOLD = 8.0     # a* < 8 suggests cool (less red)
_WARM_B_THRESHOLD = 18.0    # b* > 18 suggests warm (more yellow)
_COOL_B_THRESHOLD = 12.0    # b* < 12 suggests cool (less yellow)

# Seasonal color palettes: hex colors that are most flattering
# These are the "power colors" for each season
_SEASON_PALETTES = {
    "spring": {
        "power": ["#FF6347", "#FFD700", "#FF8C00", "#98FB98", "#87CEEB",
                   "#FFA07A", "#F0E68C", "#DDA0DD", "#20B2AA", "#FF7F50"],
        "avoid":  ["#000000", "#808080", "#4B0082", "#800000", "#191970"],
        "description": "warm and light",
    },
    "summer": {
        "power": ["#B0C4DE", "#DDA0DD", "#BC8F8F", "#778899", "#C0C0C0",
                   "#E6E6FA", "#FFB6C1", "#87CEEB", "#D8BFD8", "#AFEEEE"],
        "avoid":  ["#FF4500", "#FF8C00", "#FFD700", "#000000", "#8B4513"],
        "description": "cool and light",
    },
    "autumn": {
        "power": ["#8B4513", "#D2691E", "#CD853F", "#556B2F", "#B8860B",
                   "#A0522D", "#DAA520", "#BC8F8F", "#6B8E23", "#FF8C00"],
        "avoid":  ["#FF69B4", "#00FFFF", "#E6E6FA", "#C0C0C0", "#F0F8FF"],
        "description": "warm and deep",
    },
    "winter": {
        "power": ["#000000", "#FFFFFF", "#FF0000", "#0000FF", "#FF00FF",
                   "#00FF00", "#4B0082", "#DC143C", "#191970", "#C0C0C0"],
        "avoid":  ["#F5DEB3", "#DEB887", "#D2B48C", "#FAEBD7", "#FFE4C4"],
        "description": "cool and deep",
    },
}


def _build_lab_array(hex_list: list[str]) -> np.ndarray:
    """Convert a list of hex colors to a (1, N, 3) LAB array for vectorized deltaE."""
    return np.array([hex_to_lab(h) for h in hex_list], dtype=np.float64).reshape(1, -1, 3)


def _min_delta_e_vec(query_hex: str, palette_lab: np.ndarray) -> float:
    """Min CIEDE2000 from query_hex to any color in palette_lab (1, N, 3). Single vectorized call."""
    q = np.array(hex_to_lab(query_hex), dtype=np.float64)
    n = palette_lab.shape[1]
    q_tiled = np.tile(q, (1, n, 1))
    return float(skcolor.deltaE_ciede2000(q_tiled, palette_lab).min())


# Pre-compute LAB arrays for all season power/avoid colors at import time.
_SEASON_PALETTE_LAB: dict[str, dict[str, np.ndarray]] = {
    season: {
        "power": _build_lab_array(p["power"]),
        "avoid": _build_lab_array(p["avoid"]),
    }
    for season, p in _SEASON_PALETTES.items()
}


def extract_skin_color(image_array: np.ndarray, skin_mask: np.ndarray) -> str | None:
    """
    Extract the dominant skin color from masked skin pixels.

    Uses K-means with k=2 to separate skin from any remaining artifacts,
    then selects the cluster with LAB values most consistent with human skin.
    """
    pixels = image_array[skin_mask]

    # Filter near-black artifacts
    pixels = pixels[pixels.sum(axis=1) > 60]

    if len(pixels) < 100:
        return None

    # Subsample — skin colour distribution converges well below 2 000 points
    if len(pixels) > _MAX_SKIN_PIXELS:
        idx = _RNG.choice(len(pixels), _MAX_SKIN_PIXELS, replace=False)
        pixels = pixels[idx]

    # Convert to LAB
    pixels_f = pixels.astype(np.float32) / 255.0
    lab = skcolor.rgb2lab(pixels_f.reshape(1, -1, 3)).reshape(-1, 3)

    # K-means with k=2; n_init=2 is sufficient with a fixed random_state
    km = KMeans(n_clusters=min(2, len(pixels)), n_init=2, random_state=42)
    km.fit(lab)
    counts = np.bincount(km.labels_)

    # Select the cluster with L* in skin range (30-80) and positive a*, b*
    best_idx = None
    best_score = -1
    for i, center in enumerate(km.cluster_centers_):
        l_star, a_star, b_star = center
        # Skin typically has: L* 30-80, a* 5-25, b* 5-35
        skin_likelihood = 0
        if 25 < l_star < 85:
            skin_likelihood += 2
        if 3 < a_star < 30:
            skin_likelihood += 1
        if 3 < b_star < 40:
            skin_likelihood += 1
        # Weight by cluster size
        skin_likelihood *= counts[i]
        if skin_likelihood > best_score:
            best_score = skin_likelihood
            best_idx = i

    if best_idx is None:
        best_idx = counts.argmax()

    dominant_lab = km.cluster_centers_[best_idx]
    rgb = (
        np.clip(skcolor.lab2rgb([[dominant_lab]])[0][0], 0, 1) * 255
    ).astype(np.uint8)

    return "#{:02X}{:02X}{:02X}".format(*rgb)


def _compute_ita(l_star: float, b_star: float) -> float:
    """Compute the Individual Typology Angle from LAB values."""
    if abs(b_star) < 0.01:
        return 90.0 if l_star > 50 else -90.0
    return math.degrees(math.atan2(l_star - 50, b_star))


def _classify_depth(ita: float) -> str:
    for threshold, label in _ITA_DEPTH:
        if ita > threshold:
            return label
    return "deep"


def _classify_undertone(a_star: float, b_star: float) -> str:
    """
    Classify skin undertone from LAB a* and b* values.

    Warm: higher a* (more red) and higher b* (more yellow)
    Cool: lower a* (less red) and lower b* (less yellow/more blue)
    Neutral: balanced
    """
    warm_signals = 0
    cool_signals = 0

    if a_star > _WARM_A_THRESHOLD:
        warm_signals += 1
    elif a_star < _COOL_A_THRESHOLD:
        cool_signals += 1

    if b_star > _WARM_B_THRESHOLD:
        warm_signals += 1
    elif b_star < _COOL_B_THRESHOLD:
        cool_signals += 1

    if warm_signals > cool_signals:
        return "warm"
    elif cool_signals > warm_signals:
        return "cool"
    return "neutral"


def _determine_season(depth: str, undertone: str) -> str:
    """Map skin depth + undertone to a seasonal color type."""
    is_light = depth in ("very_light", "light", "medium_light")

    if undertone == "warm":
        return "spring" if is_light else "autumn"
    elif undertone == "cool":
        return "summer" if is_light else "winter"
    else:
        # Neutral undertone: lean toward the depth-appropriate "softer" season
        return "summer" if is_light else "autumn"


def _score_garment_vs_skin(
    garment_hex: str, season: str, undertone: str, skin_lab: tuple[float, float, float]
) -> float:
    """
    Score a single garment color against the user's skin tone.

    Considers:
    1. Seasonal palette proximity (how close is this to the season's power colors?)
    2. Contrast with skin (enough to be distinct, not so much it's jarring)
    3. Temperature alignment (warm skin + warm clothes = harmony)
    """
    from app.services.color_engine.color_science import (
        delta_e_ciede2000,
        color_temperature,
    )

    score = 0.0
    season_key = season if season in _SEASON_PALETTE_LAB else "autumn"
    cached = _SEASON_PALETTE_LAB[season_key]

    # 1. Seasonal palette proximity (40% weight) — vectorized, single deltaE call each
    min_power_dist = _min_delta_e_vec(garment_hex, cached["power"])
    palette_score = max(0.0, 1.0 - min_power_dist / 40.0)

    min_avoid_dist = _min_delta_e_vec(garment_hex, cached["avoid"])
    if min_avoid_dist < 10:
        palette_score *= 0.5

    score += 0.40 * palette_score

    # 2. Contrast with skin (30% weight)
    skin_hex = "#{:02X}{:02X}{:02X}".format(
        *np.clip(
            skcolor.lab2rgb([[list(skin_lab)]])[0][0] * 255, 0, 255
        ).astype(int)
    )
    skin_garment_de = delta_e_ciede2000(garment_hex, skin_hex)
    # Ideal contrast: deltaE 20-50. Too low = washed out. Too high = harsh.
    if skin_garment_de < 10:
        contrast_score = 0.3  # Too close to skin tone
    elif skin_garment_de < 20:
        contrast_score = 0.6
    elif skin_garment_de < 50:
        contrast_score = 1.0  # Sweet spot
    elif skin_garment_de < 70:
        contrast_score = 0.7
    else:
        contrast_score = 0.5  # Very high contrast, can work but is bold

    score += 0.30 * contrast_score

    # 3. Temperature alignment (30% weight)
    garment_temp_label, garment_temp = color_temperature(garment_hex)
    if undertone == "warm":
        temp_score = max(0.2, 0.5 + garment_temp * 0.5)
    elif undertone == "cool":
        temp_score = max(0.2, 0.5 - garment_temp * 0.5)
    else:
        temp_score = 0.65  # Neutral skin works with most temperatures

    score += 0.30 * temp_score

    return round(min(1.0, max(0.0, score)), 3)


def analyze_skin(
    image_array: np.ndarray,
    skin_mask: np.ndarray | None,
    garment_colors: list[dict],
) -> SkinToneResult:
    """
    Full skin tone analysis pipeline.

    Args:
        image_array: RGB image as numpy array.
        skin_mask: Boolean mask of skin pixels (face + arms). None if unavailable.
        garment_colors: List of {"label": str, "hex_color": str} dicts.

    Returns:
        SkinToneResult with depth, undertone, season, and per-garment compatibility.
    """
    result = SkinToneResult()

    if skin_mask is None or skin_mask.sum() < 100:
        logger.info("No skin region detected; skipping skin analysis")
        return result

    skin_hex = extract_skin_color(image_array, skin_mask)
    if skin_hex is None:
        logger.info("Could not extract skin color")
        return result

    result.detected = True
    result.hex_color = skin_hex
    result.color_name = name_color(skin_hex)

    l_star, a_star, b_star = hex_to_lab(skin_hex)
    skin_lab = (l_star, a_star, b_star)

    result.ita_angle = round(_compute_ita(l_star, b_star), 1)
    result.depth = _classify_depth(result.ita_angle)
    result.undertone = _classify_undertone(a_star, b_star)
    result.season = _determine_season(result.depth, result.undertone)

    logger.info(
        f"Skin analysis: depth={result.depth}, undertone={result.undertone}, "
        f"season={result.season}, ITA={result.ita_angle}"
    )

    # Score each garment against the skin
    for gc in garment_colors:
        hex_color = gc.get("hex_color")
        if hex_color:
            result.garment_scores[gc["label"]] = _score_garment_vs_skin(
                hex_color, result.season, result.undertone, skin_lab
            )

    logger.info(f"Garment-skin scores: {result.garment_scores}")
    return result

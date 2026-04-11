"""
Style Profiler — Discriminant Archetype Scoring

Each archetype is defined by a combination of:
  1. GARMENT TYPE  — primary discriminator (hard exclusions + strong boosts)
  2. COLOR REGIONS — HSL-space membership tests, not loose substring matching
  3. SATURATION    — with hard ceilings/floors that penalise contradictions
  4. LIGHTNESS     — with hard floor for Romantic (dark = not Romantic)
  5. HUE RANGE     — mandatory gate for Earthy/Natural
  6. HUE SPREAD    — tight vs wide palette preference
  7. TEMPERATURE   — warm / cool preference

Design rules:
  - Every archetype has both positive signals AND negative signals.
  - Archetypes that are mutually exclusive (Traditional vs Streetwear) must have
    explicit penalties so they cannot tie.
  - Garment type is checked FIRST; a hard exclusion can make the score very low
    before any colour analysis runs.
  - Color region membership is tested against HSL ranges, not color name strings.
"""

import logging

import numpy as np
from dataclasses import dataclass, field

from app.services.color_engine.color_science import (
    hex_to_hsl,
    hex_to_lab,
    name_color,
    color_temperature,
)

logger = logging.getLogger(__name__)


@dataclass
class StyleResult:
    """Output of the style profiler."""
    primary_archetype: str = "unclassified"
    archetype_confidence: float = 0.0
    coherence_score: float = 0.0
    archetype_scores: dict = field(default_factory=dict)
    # All archetypes that score within 70% of the top score — multi-label output
    top_archetypes: list[str] = field(default_factory=list)
    description: str = ""
    flags: list[str] = field(default_factory=list)


# ──────────────────────────────────────────────────────────────────────────────
# Color Region Definitions
#
# Each region is a tuple: (h_min, h_max, s_min, s_max, l_min, l_max)
# using HSL where H is 0-360°, S and L are 0-1.
# A garment falls into a region if ALL six bounds are satisfied.
# ──────────────────────────────────────────────────────────────────────────────
_REGIONS: dict[str, tuple] = {
    "achromatic":     (0,   360, 0.00, 0.12, 0.00, 1.00),  # Grays, white, black
    "white":          (0,   360, 0.00, 0.20, 0.85, 1.00),  # Near-white
    "black":          (0,   360, 0.00, 0.20, 0.00, 0.13),  # Near-black
    "charcoal":       (0,   360, 0.00, 0.18, 0.05, 0.30),  # Dark gray/charcoal
    "navy":           (210, 252, 0.25, 1.00, 0.05, 0.32),  # Navy blues (western classic)
    "cream_beige":    (28,   62, 0.00, 0.42, 0.72, 1.00),  # Cream, ivory, beige (western)
    "burgundy":       (330, 360, 0.25, 1.00, 0.05, 0.32),  # Burgundy (dark, wraps around)
    "burgundy_b":     (0,    18, 0.25, 1.00, 0.05, 0.32),  # Maroon (dark red, 0-18°)
    # Rich reds split across 0°: 0-25° low hue side AND 330-360° high hue side
    "warm_red_lo":    (0,    28, 0.50, 1.00, 0.18, 0.72),  # Vivid red, coral (0-28°)
    "warm_red_hi":    (330, 360, 0.50, 1.00, 0.18, 0.72),  # Crimson, scarlet (330-360°)
    "saffron":        (25,   48, 0.65, 1.00, 0.35, 0.75),  # Saffron / orange
    "gold_amber":     (42,   60, 0.52, 1.00, 0.30, 0.70),  # Gold, amber, mustard
    "earthy_brown":   (14,   50, 0.15, 0.92, 0.15, 0.62),  # Rust, tan, brown, terracotta
    "olive_sage":     (68,  148, 0.08, 0.50, 0.22, 0.62),  # Olive, sage, khaki
    # Pastels: defined by HIGH lightness (L > 0.62), not by saturation.
    # In HSL, even a vivid pink has S=1.0; what makes it "pastel" is L > 0.65.
    "pastel":         (0,   360, 0.08, 1.00, 0.63, 0.96),  # Any hue, high lightness
    "vivid":          (0,   360, 0.68, 1.00, 0.22, 0.78),  # High chroma, mid lightness
    "cool_jewel":     (180, 310, 0.28, 0.82, 0.20, 0.60),  # Teal, cobalt, violet, plum
}


def _in_region(h: float, s: float, l: float, key: str) -> bool:
    """Return True if (h, s, l) falls within the named color region."""
    h_min, h_max, s_min, s_max, l_min, l_max = _REGIONS[key]
    return h_min <= h <= h_max and s_min <= s <= s_max and l_min <= l <= l_max


# ──────────────────────────────────────────────────────────────────────────────
# Archetype Definitions
#
# Fields:
#   sat_range          (min, max) — ideal average HSL saturation
#   sat_hard_ceil      penalty applied if avg_sat > this (far above range)
#   sat_hard_floor     penalty applied if avg_sat < this (far below range)
#   l_range            (min, max) — ideal average HSL lightness
#   l_hard_floor       penalty if avg_l < this (too dark for this archetype)
#   hue_range          (min, max) or None — mandatory hue gate for chromatic colors
#   spread_max         hue spread above which the score is not boosted
#   spread_penalty     hue spread above which a penalty is applied
#   preferred_temp     "warm" | "cool" | None
#   sig_garments       garment types that positively signal this archetype
#   excl_garments      garment types that EXCLUDE this archetype (hard penalty)
#   requires_garment   at least one of these must be present (or penalty)
#   requires_garment_penalty    penalty when requires_garment is not met
#   require_combo      (a, b) — BOTH must be present in garment_labels (no full_body)
#   sig_regions        color regions that are signature for this archetype
#   excl_regions       color regions that contradict this archetype
#   w_garment_sig      weight for sig_garment boost
#   w_garment_excl     weight for excl_garment penalty (negative)
#   w_region_sig       weight per garment in a sig region
#   w_region_excl      weight per garment in an excl region (negative)
# ──────────────────────────────────────────────────────────────────────────────
_ARCHETYPES: dict[str, dict] = {
    "classic": {
        "name": "Classic",
        "description": "timeless and polished, relying on proven colour combinations",
        "sat_range": (0.05, 0.50),
        "sat_hard_ceil": 0.65,
        "l_range": (0.14, 0.78),
        "spread_max": 90,
        "spread_penalty": 165,
        "preferred_temp": None,
        "sig_garments": [],
        "excl_garments": [],
        "sig_regions":  ["navy", "burgundy", "burgundy_b", "cream_beige", "charcoal", "white", "black"],
        "excl_regions": ["warm_red_lo", "warm_red_hi", "saffron", "gold_amber", "vivid"],
        "w_garment_sig": 0.00,
        "w_garment_excl": 0.00,
        "w_region_sig": 0.26,   # Stronger claim on Classic's home territory (navy, burgundy, etc.)
        "w_region_excl": -0.12,
    },
    "minimalist": {
        "name": "Minimalist",
        "description": "clean and restrained, using few colours with intention",
        "sat_range": (0.00, 0.22),
        "sat_hard_ceil": 0.38,      # Any vibrancy = not minimalist
        "l_range": (0.08, 0.92),
        "spread_max": 35,
        "spread_penalty": 70,
        "preferred_temp": None,
        "sig_garments": [],
        "excl_garments": [],
        "sig_regions":  ["achromatic", "charcoal", "white", "black", "cream_beige"],
        "excl_regions": ["warm_red_lo", "warm_red_hi", "saffron", "gold_amber", "earthy_brown", "vivid", "cool_jewel"],
        "w_garment_sig": 0.00,
        "w_garment_excl": 0.00,
        "w_region_sig": 0.25,
        "w_region_excl": -0.16,
    },
    "bold": {
        "name": "Bold / Maximalist",
        "description": "confident and expressive, using strong colours deliberately",
        "sat_range": (0.55, 1.00),
        "sat_hard_floor": 0.40,     # Muted = not bold
        "l_range": (0.18, 0.80),
        "spread_max": 360,
        "preferred_temp": None,
        "sig_garments": [],
        "excl_garments": [],
        "sig_regions":  ["vivid", "warm_red_lo", "warm_red_hi", "saffron", "gold_amber", "cool_jewel"],
        "excl_regions": ["achromatic", "charcoal", "cream_beige"],
        "w_garment_sig": 0.00,
        "w_garment_excl": 0.00,
        "w_region_sig": 0.22,
        "w_region_excl": -0.10,
    },
    "ethnic_traditional": {
        "name": "Traditional / Ethnic",
        "description": "rooted in cultural dress, often featuring rich and warm tones",
        "sat_range": (0.35, 1.00),
        "sat_hard_floor": 0.18,     # Washed-out colours contradict rich traditional palette
        "l_range": (0.15, 0.80),
        "spread_max": 200,
        "preferred_temp": "warm",
        # PRIMARY DISCRIMINATOR: traditional wear is defined by garment form.
        # A saree, kurta, sherwani, or dupatta is the first gate.
        "sig_garments": ["full_body", "outerwear"],
        "excl_garments": [],
        "requires_garment": ["full_body", "outerwear"],
        "requires_garment_penalty": -0.32,
        # COLOUR GATE: western palette colours (navy, cream/beige as staples, charcoal)
        # contradict traditional. saffron, gold, deep reds define it.
        "sig_regions":  ["warm_red_lo", "warm_red_hi", "saffron", "gold_amber",
                          "cool_jewel", "olive_sage", "burgundy", "burgundy_b"],
        "excl_regions": ["navy", "cream_beige", "charcoal", "achromatic", "white", "pastel"],
        "w_garment_sig": 0.28,
        "w_garment_excl": 0.00,
        "w_region_sig": 0.20,
        "w_region_excl": -0.12,
    },
    "streetwear": {
        "name": "Streetwear / Urban",
        "description": "relaxed and contemporary, using contrast and directional colour",
        "sat_range": (0.05, 0.80),
        "l_range": (0.08, 0.84),
        "spread_max": 200,
        "preferred_temp": None,
        # PRIMARY DISCRIMINATOR: streetwear = top + bottom, never a full-body garment.
        "sig_garments": ["top", "bottom"],
        "excl_garments": ["full_body"],
        "require_combo": ("top", "bottom"),
        # Navy is NOT excluded — navy hoodies, joggers, and bombers are legitimate streetwear.
        # Navy is also not a sig region here; it's neutral for Streetwear (neither signal nor penalty).
        # Classic gets a stronger region weight on navy, so a navy+white combo leans Classic
        # purely through the region score — the combo boost alone doesn't override it.
        "sig_regions":  ["black", "white", "charcoal", "vivid", "warm_red_lo", "warm_red_hi"],
        "excl_regions": ["saffron", "gold_amber", "earthy_brown", "olive_sage", "pastel"],
        "w_garment_sig": 0.14,  # Reduced from 0.18: combo presence is a signal, not a guarantee
        "w_garment_excl": -0.32,
        "w_region_sig": 0.18,
        "w_region_excl": -0.10,
    },
    "earthy": {
        "name": "Earthy / Natural",
        "description": "grounded and warm, using nature-inspired muted tones",
        "sat_range": (0.08, 0.75),  # Rust/terracotta HSL sat is naturally high even though they look earthy
        "sat_hard_ceil": 0.90,      # Only penalize true neons — warm reds can have S≈0.85
        "l_range": (0.15, 0.68),
        "hue_range": (14, 162),     # Widen slightly to fully capture rust (H≈14-18°)
        "spread_max": 115,
        "spread_penalty": 180,
        "preferred_temp": "warm",
        "sig_garments": [],
        "excl_garments": [],
        "sig_regions":  ["earthy_brown", "olive_sage", "cream_beige"],
        "excl_regions": ["vivid", "cool_jewel", "white", "black", "warm_red_lo", "warm_red_hi"],
        "w_garment_sig": 0.00,
        "w_garment_excl": 0.00,
        "w_region_sig": 0.25,
        "w_region_excl": -0.12,
    },
    "romantic": {
        "name": "Romantic / Soft",
        "description": "gentle and soft, with light tones and low contrast",
        # Romantic is defined by HIGH LIGHTNESS, not by saturation.
        # In HSL, a pale pink can have S=1.0 — that's a property of the HSL model,
        # not a sign that the colour is vivid. Use lightness as the gate.
        "sat_range": (0.06, 1.00),   # No upper saturation limit — L is the gatekeeper
        "l_range": (0.58, 0.94),
        "l_hard_floor": 0.42,        # Dark colour = not Romantic
        "spread_max": 90,
        "spread_penalty": 160,
        "preferred_temp": None,
        "sig_garments": [],
        "excl_garments": [],
        # pastel region now covers all high-lightness colours (any sat), so pink/lilac/peach match
        "sig_regions":  ["pastel", "cream_beige", "white"],
        # vivid excludes dark vivid only (L 0.22-0.78); light vivid (pastels) not caught here
        "excl_regions": ["black", "charcoal", "vivid", "warm_red_lo", "warm_red_hi",
                          "earthy_brown", "olive_sage", "navy"],
        "w_garment_sig": 0.00,
        "w_garment_excl": 0.00,
        "w_region_sig": 0.25,
        "w_region_excl": -0.14,
    },
}


# ──────────────────────────────────────────────────────────────────────────────
# Scoring
# ──────────────────────────────────────────────────────────────────────────────

def _score_archetype(
    archetype_def: dict,
    garment_colors: list[dict],
    garment_labels: list[str],
    hsl_values: list[tuple],
    hue_spread: float,
) -> float:
    """
    Compute how well an outfit matches one archetype.

    Scoring axes (approximate max contribution):
      Garment type  : ±0.32   (dominant discriminator)
      Saturation    : +0.20 / -0.22
      Lightness     : +0.12 / -0.10
      Color regions : +0.25 / -0.16
      Hue spread    : +0.10 / -0.08
      Hue range     : ±0.10   (earthy only)
      Temperature   : +0.08
    """
    if not hsl_values:
        return 0.0

    score = 0.0
    n = len(hsl_values)
    sat_values = [s for _, s, _ in hsl_values]
    l_values   = [l for _, _, l in hsl_values]
    avg_sat = float(np.mean(sat_values))
    avg_l   = float(np.mean(l_values))

    # ─── 1. GARMENT TYPE ────────────────────────────────────────────────────
    sig_garments  = archetype_def.get("sig_garments", [])
    excl_garments = archetype_def.get("excl_garments", [])
    w_sig  = archetype_def.get("w_garment_sig", 0.0)
    w_excl = archetype_def.get("w_garment_excl", 0.0)

    # Hard exclusion — apply full penalty per excluded garment type found
    for label in garment_labels:
        if label in excl_garments:
            score += w_excl   # e.g., -0.32 for streetwear + full_body
            break             # one instance is enough for the full penalty

    # Signature garment boost
    if sig_garments and w_sig > 0:
        # For archetypes with require_combo, boost only when BOTH are present
        combo = archetype_def.get("require_combo")
        if combo:
            a, b = combo
            has_full_body = "full_body" in garment_labels
            if a in garment_labels and b in garment_labels and not has_full_body:
                score += w_sig
            # No partial credit — the combo is the signal
        else:
            sig_found = [l for l in garment_labels if l in sig_garments]
            if sig_found:
                score += w_sig * min(1.0, len(sig_found) / len(sig_garments))

    # Required garment check (traditional needs full_body or outerwear)
    requires = archetype_def.get("requires_garment", [])
    if requires:
        has_required = any(l in requires for l in garment_labels)
        if not has_required:
            score += archetype_def.get("requires_garment_penalty", 0.0)

    # ─── 2. SATURATION ──────────────────────────────────────────────────────
    sat_min, sat_max = archetype_def["sat_range"]
    if sat_min <= avg_sat <= sat_max:
        width = sat_max - sat_min + 1e-6
        centrality = 1.0 - abs(avg_sat - (sat_min + sat_max) / 2) / (width / 2)
        score += 0.15 + 0.05 * max(0.0, centrality)
    elif avg_sat < sat_min:
        deficit = sat_min - avg_sat
        score += max(-0.12, 0.15 - deficit * 1.8)
    else:
        excess = avg_sat - sat_max
        score += max(-0.12, 0.15 - excess * 1.8)

    # Hard ceiling / floor (double penalty for being far outside range)
    if "sat_hard_ceil" in archetype_def and avg_sat > archetype_def["sat_hard_ceil"]:
        score -= 0.12
    if "sat_hard_floor" in archetype_def and avg_sat < archetype_def["sat_hard_floor"]:
        score -= 0.10

    # ─── 3. LIGHTNESS ───────────────────────────────────────────────────────
    l_min, l_max = archetype_def["l_range"]
    if l_min <= avg_l <= l_max:
        score += 0.12
    else:
        diff = min(abs(avg_l - l_min), abs(avg_l - l_max))
        score += max(-0.08, 0.12 - diff * 1.5)

    if "l_hard_floor" in archetype_def and avg_l < archetype_def["l_hard_floor"]:
        score -= 0.10  # e.g., dark colours = not Romantic

    # ─── 4. COLOR REGION MEMBERSHIP ─────────────────────────────────────────
    sig_regions  = archetype_def.get("sig_regions", [])
    excl_regions = archetype_def.get("excl_regions", [])
    w_region_sig  = archetype_def.get("w_region_sig", 0.20)
    w_region_excl = archetype_def.get("w_region_excl", -0.10)

    region_contribution = 0.0
    for gc, (h, s, l) in zip(garment_colors, hsl_values):
        if not gc.get("hex_color"):
            continue
        in_sig  = any(_in_region(h, s, l, r) for r in sig_regions)
        in_excl = any(_in_region(h, s, l, r) for r in excl_regions)
        if in_sig:
            region_contribution += w_region_sig / n
        if in_excl:
            region_contribution += w_region_excl / n  # negative

    score += max(-0.20, region_contribution)

    # ─── 5. HUE SPREAD ──────────────────────────────────────────────────────
    spread_max     = archetype_def.get("spread_max", 220)
    spread_penalty = archetype_def.get("spread_penalty", spread_max * 2)

    if hue_spread <= spread_max:
        score += 0.10
    elif hue_spread <= spread_penalty:
        score += 0.04
    else:
        score -= 0.06

    # ─── 6. HUE RANGE GATE (earthy only) ────────────────────────────────────
    hue_range = archetype_def.get("hue_range")
    if hue_range:
        h_min, h_max = hue_range
        chromatic = [(h, s) for h, s, _ in hsl_values if s > 0.12]
        if chromatic:
            in_range_count = sum(1 for h, _ in chromatic if h_min <= h <= h_max)
            ratio = in_range_count / len(chromatic)
            score += 0.10 * ratio - 0.10 * (1.0 - ratio)

    # ─── 7. TEMPERATURE PREFERENCE ──────────────────────────────────────────
    preferred_temp = archetype_def.get("preferred_temp")
    if preferred_temp:
        temps = [
            color_temperature(gc["hex_color"])[0]
            for gc in garment_colors
            if gc.get("hex_color")
        ]
        if temps:
            match_count = sum(1 for t in temps if t == preferred_temp)
            score += 0.08 * (match_count / len(temps))

    return round(min(1.0, max(0.0, score)), 3)


# ──────────────────────────────────────────────────────────────────────────────
# Hue spread helper
# ──────────────────────────────────────────────────────────────────────────────

def _hue_spread(hsl_values: list[tuple]) -> float:
    """Maximum pairwise hue angle difference, ignoring near-neutral colours."""
    chromatic_hues = [h for h, s, _ in hsl_values if s > 0.12]
    if len(chromatic_hues) < 2:
        return 0.0
    diffs = []
    for i in range(len(chromatic_hues)):
        for j in range(i + 1, len(chromatic_hues)):
            d = abs(chromatic_hues[i] - chromatic_hues[j])
            diffs.append(min(d, 360 - d))
    return max(diffs) if diffs else 0.0


# ──────────────────────────────────────────────────────────────────────────────
# Coherence
# ──────────────────────────────────────────────────────────────────────────────

def _compute_coherence(
    hsl_values: list[tuple],
    archetype_scores: dict,
) -> float:
    """
    Score how coherent the outfit is as a unified look.

    High coherence = pieces clearly belong to the same story.
    Uses the margin between first and second archetype as a signal of clarity.
    """
    if not hsl_values:
        return 0.50

    scores_sorted = sorted(archetype_scores.values(), reverse=True)
    top_score = scores_sorted[0] if scores_sorted else 0.0
    second_score = scores_sorted[1] if len(scores_sorted) > 1 else 0.0

    # Margin between best and second best: larger = clearer style direction
    margin = top_score - second_score
    archetype_signal = min(0.40, margin * 1.0 + top_score * 0.20)

    # Saturation consistency
    sats = [s for _, s, _ in hsl_values]
    sat_std = float(np.std(sats))
    sat_coherence = max(0.0, 0.30 - sat_std * 0.60)

    # Lightness variation (moderate = intentional, extreme = random)
    lights = [l for _, _, l in hsl_values]
    l_range = max(lights) - min(lights) if len(lights) > 1 else 0.0
    if 0.08 <= l_range <= 0.52:
        l_coherence = 0.25
    elif l_range < 0.08:
        l_coherence = 0.12
    else:
        l_coherence = 0.08

    return round(min(1.0, max(0.0, archetype_signal + sat_coherence + l_coherence)), 3)


# ──────────────────────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────────────────────

def analyze_style(
    garment_colors: list[dict],
    garment_labels: list[str],
) -> StyleResult:
    """
    Full style archetype analysis.

    Args:
        garment_colors: List of {"label": str, "hex_color": str | None, ...}
        garment_labels: Corresponding garment label strings.

    Returns:
        StyleResult with primary archetype, confidence, coherence, and all scores.
    """
    result = StyleResult()

    valid_colors = [gc for gc in garment_colors if gc.get("hex_color")]
    if not valid_colors:
        return result

    hsl_values = [hex_to_hsl(gc["hex_color"]) for gc in valid_colors]
    spread = _hue_spread(hsl_values)

    # Score every archetype
    for key, defn in _ARCHETYPES.items():
        s = _score_archetype(defn, valid_colors, garment_labels, hsl_values, spread)
        result.archetype_scores[defn["name"]] = s

    # Primary archetype and multi-label top archetypes
    if result.archetype_scores:
        best_name = max(result.archetype_scores, key=result.archetype_scores.get)
        best_score = result.archetype_scores[best_name]
        result.primary_archetype = best_name
        result.archetype_confidence = best_score

        for defn in _ARCHETYPES.values():
            if defn["name"] == best_name:
                result.description = defn["description"]
                break

        # Include all archetypes scoring within 75% of the top score.
        # Tighter threshold reduces contradictory signals sent to the LLM.
        threshold = best_score * 0.75
        result.top_archetypes = [
            name for name, score in sorted(result.archetype_scores.items(), key=lambda x: -x[1])
            if score >= threshold
        ]

    # Coherence
    result.coherence_score = _compute_coherence(hsl_values, result.archetype_scores)

    # Flags
    scores_sorted = sorted(result.archetype_scores.values(), reverse=True)
    top = scores_sorted[0] if scores_sorted else 0.0
    second = scores_sorted[1] if len(scores_sorted) > 1 else 0.0

    if top < 0.30:
        result.flags.append("unclear_style_direction")
    if (top - second) < 0.08 and top > 0.0:
        result.flags.append("unclear_style_direction")
    if result.coherence_score < 0.35:
        result.flags.append("low_coherence")

    logger.info(
        f"Style: archetype={result.primary_archetype} "
        f"(confidence={result.archetype_confidence}), "
        f"coherence={result.coherence_score}, "
        f"spread={spread:.1f}°"
    )
    return result

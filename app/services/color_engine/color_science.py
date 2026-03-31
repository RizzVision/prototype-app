"""
Core Color Science Utilities

Foundation module for all color analysis. Provides:
- Precise color space conversions (RGB, HSL, LAB, LCH)
- CIEDE2000 perceptual color difference
- Color temperature estimation (warm/cool/neutral)
- Human-readable color naming for TTS output
- Relative luminance and contrast ratio (WCAG-adapted)
"""

import colorsys
import math

import numpy as np
from skimage import color as skcolor


# ──────────────────────────────────────────────
# Color space conversions
# ──────────────────────────────────────────────

def hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def rgb_to_hex(r: int, g: int, b: int) -> str:
    return "#{:02X}{:02X}{:02X}".format(r, g, b)


def hex_to_rgb_float(hex_color: str) -> tuple[float, float, float]:
    r, g, b = hex_to_rgb(hex_color)
    return r / 255.0, g / 255.0, b / 255.0


def hex_to_hsl(hex_color: str) -> tuple[float, float, float]:
    """Returns (H in degrees [0-360], S in [0-1], L in [0-1])."""
    r, g, b = hex_to_rgb_float(hex_color)
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    return h * 360.0, s, l


def hex_to_lab(hex_color: str) -> tuple[float, float, float]:
    """Returns (L*, a*, b*) in CIELAB."""
    r, g, b = hex_to_rgb_float(hex_color)
    lab = skcolor.rgb2lab(np.array([[[r, g, b]]], dtype=np.float64))
    return float(lab[0, 0, 0]), float(lab[0, 0, 1]), float(lab[0, 0, 2])


def hex_to_lch(hex_color: str) -> tuple[float, float, float]:
    """Returns (L*, C* chroma, h° hue angle) in CIELCh."""
    l, a, b = hex_to_lab(hex_color)
    c = math.sqrt(a ** 2 + b ** 2)
    h = math.degrees(math.atan2(b, a)) % 360
    return l, c, h


# ──────────────────────────────────────────────
# CIEDE2000 - perceptual color difference
# ──────────────────────────────────────────────

def delta_e_ciede2000(hex1: str, hex2: str) -> float:
    """
    Compute CIEDE2000 color difference between two hex colors.

    This is the gold standard for perceptual color difference.
    A value of 1.0 is the just-noticeable difference (JND).

    Rough interpretation:
      0-1:   Imperceptible
      1-2:   Barely perceptible
      2-5:   Noticeable
      5-10:  Clearly different
      10-25: Very different colors
      25+:   Opposite colors
    """
    lab1 = np.array(hex_to_lab(hex1)).reshape(1, 1, 3)
    lab2 = np.array(hex_to_lab(hex2)).reshape(1, 1, 3)
    return float(skcolor.deltaE_ciede2000(lab1, lab2)[0, 0])


# ──────────────────────────────────────────────
# Color temperature
# ──────────────────────────────────────────────

def color_temperature(hex_color: str) -> tuple[str, float]:
    """
    Classify a color as warm, cool, or neutral and return a temperature score.

    Score range: -1.0 (coolest) to +1.0 (warmest), 0.0 = neutral.

    Based on the warm/cool division of the color wheel:
    - Warm: reds, oranges, yellows, warm greens (hue ~0-70°, 330-360°)
    - Cool: blues, purples, cool greens (hue ~150-270°)
    - Transitional: yellow-green (70-150°), red-violet (270-330°)

    Also considers saturation: desaturated colors are more neutral.
    """
    h, s, l = hex_to_hsl(hex_color)

    # Achromatic colors are neutral
    if s < 0.08:
        return "neutral", 0.0

    # Map hue to temperature score
    # Warm peak at ~30° (orange), cool peak at ~210° (blue)
    if h <= 70:
        # Red through yellow-orange: warm
        temp = 0.5 + 0.5 * (1.0 - abs(h - 30) / 70.0)
    elif h <= 150:
        # Yellow-green through green: transitional warm→cool
        temp = 0.5 * (1.0 - (h - 70) / 80.0)
    elif h <= 270:
        # Green-blue through blue-violet: cool
        temp = -0.5 - 0.5 * (1.0 - abs(h - 210) / 60.0)
    elif h <= 330:
        # Violet through red-violet: transitional cool→warm
        temp = -0.5 + 1.0 * ((h - 270) / 60.0)
    else:
        # Red: warm
        temp = 0.5 + 0.5 * ((h - 330) / 30.0)

    # Desaturated colors gravitate toward neutral
    temp *= min(1.0, s / 0.3)

    if temp > 0.15:
        label = "warm"
    elif temp < -0.15:
        label = "cool"
    else:
        label = "neutral"

    return label, round(temp, 3)


# ──────────────────────────────────────────────
# Relative luminance & contrast ratio
# ──────────────────────────────────────────────

def relative_luminance(hex_color: str) -> float:
    """WCAG 2.1 relative luminance (0.0 = black, 1.0 = white)."""
    r, g, b = hex_to_rgb_float(hex_color)

    def linearize(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)


def contrast_ratio(hex1: str, hex2: str) -> float:
    """
    WCAG contrast ratio between two colors.
    Range: 1.0 (identical) to 21.0 (black vs white).
    For clothing visibility, > 3.0 is clearly distinguishable.
    """
    l1 = relative_luminance(hex1)
    l2 = relative_luminance(hex2)
    lighter = max(l1, l2)
    darker = min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


# ──────────────────────────────────────────────
# Human-readable color naming for TTS
# ──────────────────────────────────────────────

# 16-sector hue map with natural color names
_HUE_NAMES = [
    (15, "red"),
    (30, "vermilion"),
    (45, "orange"),
    (60, "amber"),
    (75, "yellow"),
    (95, "chartreuse"),
    (120, "green"),
    (150, "emerald"),
    (175, "teal"),
    (200, "cyan"),
    (225, "azure"),
    (250, "blue"),
    (275, "indigo"),
    (300, "violet"),
    (330, "magenta"),
    (345, "crimson"),
    (360, "red"),
]


def name_color(hex_color: str) -> str:
    """
    Generate a human-readable color name from a hex value.

    Designed for TTS: returns names like "dark navy blue", "warm olive green",
    "pale dusty rose", "charcoal". Never returns hex codes or jargon.
    """
    h, s, l = hex_to_hsl(hex_color)

    # Handle achromatic colors (very low saturation)
    if s < 0.06:
        if l > 0.92:
            return "white"
        elif l > 0.75:
            return "light gray"
        elif l > 0.55:
            return "gray"
        elif l > 0.35:
            return "dark gray"
        elif l > 0.15:
            return "charcoal"
        else:
            return "black"

    # Near-achromatic (slightly tinted grays)
    if s < 0.15:
        if l > 0.75:
            return "off-white"
        elif l > 0.4:
            return "warm gray" if 20 < h < 60 else "cool gray"
        else:
            return "charcoal"

    # Find base hue name
    base_name = "red"
    for boundary, name in _HUE_NAMES:
        if h <= boundary:
            base_name = name
            break

    # Build modifiers
    parts = []

    # Lightness modifier
    if l > 0.82:
        parts.append("very light")
    elif l > 0.68:
        parts.append("light")
    elif l > 0.55:
        parts.append("soft")
    elif l < 0.18:
        parts.append("very dark")
    elif l < 0.30:
        parts.append("dark")
    elif l < 0.42:
        parts.append("deep")

    # Saturation modifier
    if s < 0.30:
        parts.append("muted")
    elif s > 0.85:
        parts.append("vivid")
    elif s > 0.70:
        parts.append("bright")

    # Special compound names for common fashion colors
    fashion_override = _fashion_color_name(h, s, l)
    if fashion_override:
        return fashion_override

    parts.append(base_name)
    return " ".join(parts)


def _fashion_color_name(h: float, s: float, l: float) -> str | None:
    """Override with common fashion/textile color names when applicable."""
    # Navy blue
    if 220 <= h <= 250 and l < 0.30 and s > 0.30:
        return "navy"
    # Burgundy / maroon
    if (h <= 10 or h >= 345) and l < 0.30 and s > 0.25:
        return "burgundy"
    # Olive
    if 70 <= h <= 100 and 0.15 < s < 0.55 and 0.25 < l < 0.50:
        return "olive"
    # Cream
    if 40 <= h <= 60 and s < 0.40 and l > 0.80:
        return "cream"
    # Beige / khaki
    if 30 <= h <= 50 and s < 0.45 and 0.55 < l < 0.80:
        return "beige"
    # Tan
    if 25 <= h <= 45 and 0.20 < s < 0.55 and 0.45 < l < 0.65:
        return "tan"
    # Coral
    if 5 <= h <= 25 and s > 0.50 and 0.55 < l < 0.75:
        return "coral"
    # Salmon
    if 5 <= h <= 20 and 0.35 < s < 0.65 and 0.60 < l < 0.80:
        return "salmon"
    # Lavender
    if 260 <= h <= 290 and s < 0.45 and l > 0.65:
        return "lavender"
    # Dusty rose / mauve
    if 320 <= h <= 350 and 0.15 < s < 0.45 and 0.45 < l < 0.70:
        return "dusty rose"
    # Teal
    if 170 <= h <= 195 and s > 0.30 and 0.25 < l < 0.50:
        return "teal"
    # Rust
    if 15 <= h <= 30 and 0.40 < s < 0.80 and 0.25 < l < 0.45:
        return "rust"
    # Mustard
    if 42 <= h <= 55 and s > 0.50 and 0.40 < l < 0.60:
        return "mustard"
    # Ivory
    if 40 <= h <= 65 and s < 0.30 and l > 0.85:
        return "ivory"
    # Plum
    if 280 <= h <= 310 and 0.20 < s < 0.55 and 0.20 < l < 0.40:
        return "plum"
    # Mint
    if 140 <= h <= 170 and s > 0.20 and l > 0.65:
        return "mint"
    # Sage
    if 100 <= h <= 140 and 0.10 < s < 0.35 and 0.40 < l < 0.65:
        return "sage"
    # Peach
    if 20 <= h <= 35 and 0.30 < s < 0.65 and 0.70 < l < 0.90:
        return "peach"
    # Maroon
    if (h <= 15 or h >= 340) and 0.15 < l < 0.25 and s > 0.30:
        return "maroon"
    # Gold
    if 42 <= h <= 52 and s > 0.65 and 0.45 < l < 0.65:
        return "gold"

    return None

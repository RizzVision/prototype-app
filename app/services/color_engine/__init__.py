"""
RizzVision Color Engine

Comprehensive color analysis system for outfit evaluation.
Public API exposes the master engine and all sub-analyzers.
"""

from app.services.color_engine.engine import ColorEngineResult, run_color_engine
from app.services.color_engine.color_science import (
    name_color,
    hex_to_hsl,
    hex_to_lab,
    hex_to_lch,
    delta_e_ciede2000,
    color_temperature,
    contrast_ratio,
)
from app.services.color_engine.harmony_analyzer import HarmonyDetail
from app.services.color_engine.skin_analysis import SkinToneResult
from app.services.color_engine.seasonal_analysis import SeasonalResult
from app.services.color_engine.proportion_analyzer import ProportionResult
from app.services.color_engine.occasion_engine import OccasionResult
from app.services.color_engine.style_profiler import StyleResult

__all__ = [
    "run_color_engine",
    "ColorEngineResult",
    "HarmonyDetail",
    "SkinToneResult",
    "SeasonalResult",
    "ProportionResult",
    "OccasionResult",
    "StyleResult",
    "name_color",
    "hex_to_hsl",
    "hex_to_lab",
    "hex_to_lch",
    "delta_e_ciede2000",
    "color_temperature",
    "contrast_ratio",
]

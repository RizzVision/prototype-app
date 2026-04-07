"""
CLIP-based Occasion Classifier — Zero-Shot

Uses OpenAI's CLIP model (openai/clip-vit-base-patch32) loaded via HuggingFace
`transformers` to classify outfit images against occasion-specific text prompts.

Multiple prompts are written per occasion, inspired by Theme-Matters dataset themes.
CLIP similarity is averaged across prompts then softmax-normalised to produce a
probability distribution over occasions.

Falls back to color-based heuristics when:
  - The PIL image is not supplied
  - CLIP fails to load (no internet, low memory, etc.)

The public interface is identical to the previous rule-based module so no other
files need to change except engine.py (which now passes the PIL image).
"""

import logging
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────────
# Occasion metadata
# ──────────────────────────────────────────────────────────────────────────────

#: Human-readable display names (also used as OccasionScore.occasion value)
OCCASION_DISPLAY: dict[str, str] = {
    "casual_daily":   "Everyday casual",
    "date_night":     "Date or evening out",
    "office":         "Office or workplace",
    "festival":       "Festival or celebration",
    "puja_temple":    "Puja or temple visit",
    "formal_event":   "Formal event or dinner",
    "indian_wedding": "Indian wedding or reception",
}

#: Formality anchor values (0 = casual, 1 = very formal)
OCCASION_FORMALITY: dict[str, float] = {
    "casual_daily":   0.15,
    "date_night":     0.50,
    "office":         0.55,
    "festival":       0.60,
    "puja_temple":    0.65,
    "formal_event":   0.80,
    "indian_wedding": 0.85,
}

#: Multiple text prompts per occasion.
#: CLIP similarity is averaged across all prompts in a group, then compared
#: across groups.  More prompts → more stable classification.
_OCCASION_PROMPTS: dict[str, list[str]] = {
    "casual_daily": [
        "a casual everyday outfit for daily activities",
        "casual comfortable clothing for a normal day",
        "relaxed casual jeans and t-shirt street style",
        "simple everyday wear with sneakers",
    ],
    "office": [
        "a professional business outfit for the office",
        "smart business casual work attire with a blazer",
        "neat professional clothing suitable for workplace meetings",
        "formal shirt and trousers for corporate environment",
    ],
    "formal_event": [
        "an elegant formal evening gown or suit for a gala",
        "sophisticated formal attire for a ceremony or cocktail party",
        "black tie formal wear for a special occasion",
        "refined formal dress or tuxedo for a dinner party",
    ],
    "indian_wedding": [
        "traditional Indian bridal or wedding guest outfit",
        "richly embroidered Indian ethnic wear for a wedding celebration",
        "colorful Indian lehenga or silk saree for a wedding ceremony",
        "ornate traditional Indian sherwani or heavy kurta for a wedding",
    ],
    "festival": [
        "vibrant colorful Indian festival outfit for Diwali or Navratri",
        "bright festive ethnic Indian clothing for a celebration",
        "traditional colorful Indian attire for a festival event",
        "festive Indian dress with bright embroidery and mirrors",
    ],
    "date_night": [
        "a chic stylish outfit for a romantic dinner date",
        "fashionable smart casual clothes for a date night out",
        "elegant evening outfit for a romantic occasion",
        "well-fitted stylish clothing for a dinner reservation",
    ],
    "puja_temple": [
        "traditional Indian attire for a temple visit or puja ceremony",
        "modest ethnic Indian clothing for a religious or spiritual occasion",
        "simple cotton kurta or saree for morning prayer",
        "respectful traditional Indian wear for worship or a religious festival",
    ],
}


# ──────────────────────────────────────────────────────────────────────────────
# Output dataclasses (interface-compatible with original occasion_engine)
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class OccasionScore:
    """Suitability score for a specific occasion."""
    occasion: str       # Human-readable name, e.g. "Everyday casual"
    score: float        # Softmax probability (0-1)
    reasoning: str      # Short description for the LLM context


@dataclass
class OccasionResult:
    """Full occasion analysis output."""
    formality_level: str = "unknown"   # casual | smart_casual | business | formal | festive
    formality_score: float = 0.0
    best_occasion: str = "Everyday casual"
    occasions: list = field(default_factory=list)   # list[OccasionScore]
    flags: list = field(default_factory=list)
    source: str = "clip"                            # "clip" | "color"


# ──────────────────────────────────────────────────────────────────────────────
# CLIP model — singleton, lazy-loaded
# ──────────────────────────────────────────────────────────────────────────────

class _CLIPOccasionModel:
    """
    Singleton wrapper around openai/clip-vit-base-patch32.

    Text embeddings for all occasion prompts are pre-computed once at load time
    and averaged per occasion so inference only requires one image forward pass.
    """

    _instance: Optional["_CLIPOccasionModel"] = None

    # Internal state
    _loaded: bool = False
    _load_attempted: bool = False  # prevent repeated retries after a failure
    _model = None
    _processor = None
    _text_features = None       # torch.Tensor shape (n_occasions, embed_dim)
    _occasion_order: list = []  # keys in the order their embeddings were computed

    @classmethod
    def get(cls) -> "_CLIPOccasionModel":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    # ------------------------------------------------------------------
    def load(self) -> bool:
        """Attempt to load CLIP. Returns True on success. Will not retry after failure."""
        if self._loaded:
            return True
        if self._load_attempted:
            return False  # Already tried and failed — don't retry on every request
        self._load_attempted = True
        try:
            import torch
            from transformers import CLIPModel, CLIPProcessor

            logger.info("Loading CLIP model (openai/clip-vit-base-patch32) …")
            self._model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
            self._processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
            self._model.eval()

            self._precompute_text_features(torch)
            self._loaded = True
            logger.info("CLIP model loaded and text embeddings pre-computed.")
            return True

        except Exception as exc:
            logger.warning(
                f"CLIP model failed to load — falling back to color scoring. Error: {exc}"
            )
            return False

    # ------------------------------------------------------------------
    def _precompute_text_features(self, torch) -> None:
        """
        Encode every prompt string and store one averaged embedding per occasion.
        This runs once at load time so inference is fast.
        """
        self._occasion_order = list(_OCCASION_PROMPTS.keys())

        all_prompts: list[str] = []
        prompt_counts: list[int] = []
        for key in self._occasion_order:
            prompts = _OCCASION_PROMPTS[key]
            all_prompts.extend(prompts)
            prompt_counts.append(len(prompts))

        with torch.inference_mode():
            text_inputs = self._processor(
                text=all_prompts,
                return_tensors="pt",
                padding=True,
                truncation=True,
                max_length=77,
            )
            raw_features = self._model.get_text_features(**text_inputs)
            # L2-normalise
            raw_features = raw_features / raw_features.norm(dim=-1, keepdim=True)

        # Average per-occasion
        averaged: list = []
        idx = 0
        for count in prompt_counts:
            chunk = raw_features[idx: idx + count]           # (n_prompts, D)
            avg = chunk.mean(dim=0, keepdim=True)            # (1, D)
            avg = avg / avg.norm(dim=-1, keepdim=True)       # re-normalise
            averaged.append(avg)
            idx += count

        self._text_features = torch.cat(averaged, dim=0)     # (n_occasions, D)

    # ------------------------------------------------------------------
    def classify(self, pil_image: Image.Image) -> dict[str, float]:
        """
        Return a dict mapping occasion key → softmax probability.

        The image is encoded once; cosine similarity is computed against all
        pre-computed occasion embeddings in a single matrix multiply.
        """
        import torch

        with torch.inference_mode():
            img_inputs = self._processor(images=pil_image, return_tensors="pt")
            img_feat = self._model.get_image_features(**img_inputs)
            img_feat = img_feat / img_feat.norm(dim=-1, keepdim=True)   # (1, D)

            # Temperature-scaled cosine similarity → (1, n_occasions)
            logits = (img_feat @ self._text_features.T) * 100.0
            probs = torch.softmax(logits, dim=-1).squeeze(0).cpu().numpy()

        return {key: float(p) for key, p in zip(self._occasion_order, probs)}


_clip_model = _CLIPOccasionModel.get()


# ──────────────────────────────────────────────────────────────────────────────
# Color-based fallback (simplified)
# ──────────────────────────────────────────────────────────────────────────────

def _analyze_by_color(garment_colors: list[dict]) -> dict[str, float]:
    """
    Derive rough occasion probabilities from HSL color statistics.
    Used when CLIP is unavailable or no image is supplied.
    """
    from app.services.color_engine.color_science import hex_to_hsl

    valid = [gc for gc in garment_colors if gc.get("hex_color")]
    if not valid:
        return {k: 1.0 / len(OCCASION_FORMALITY) for k in OCCASION_FORMALITY}

    hsl = [hex_to_hsl(gc["hex_color"]) for gc in valid]
    avg_sat = float(np.mean([s for _, s, _ in hsl]))
    avg_l   = float(np.mean([l for _, _, l in hsl]))

    scores: dict[str, float] = {
        "casual_daily":   0.5 + 0.3 * max(0.0, 1.0 - abs(avg_sat - 0.40) / 0.40),
        "office":         0.5 + 0.3 * max(0.0, 1.0 - avg_sat / 0.50),
        "formal_event":   0.5 + 0.2 * (1.0 - avg_l) + 0.1 * (1.0 - avg_sat),
        "indian_wedding": 0.5 + 0.4 * avg_sat * max(0.0, 1.0 - abs(avg_l - 0.45) / 0.45),
        "festival":       0.5 + 0.4 * min(1.0, avg_sat / 0.60),
        "date_night":     0.5 + 0.2 * (1.0 - avg_l) + 0.1 * avg_sat,
        "puja_temple":    0.4 + 0.2 * avg_sat,
    }

    total = sum(scores.values())
    return {k: v / total for k, v in scores.items()}


# ──────────────────────────────────────────────────────────────────────────────
# Formality derivation
# ──────────────────────────────────────────────────────────────────────────────

def _formality_from_scores(scores: dict[str, float]) -> tuple[str, float]:
    """Compute a weighted formality score from softmax probabilities."""
    weighted = sum(
        scores.get(k, 0.0) * OCCASION_FORMALITY[k]
        for k in OCCASION_FORMALITY
    )
    if weighted < 0.30:
        level = "casual"
    elif weighted < 0.48:
        level = "smart_casual"
    elif weighted < 0.65:
        level = "business"
    elif weighted < 0.78:
        level = "formal"
    else:
        level = "festive"
    return level, round(weighted, 3)


# ──────────────────────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────────────────────

def analyze_occasion(
    garment_colors: list[dict],
    garment_labels: list[str],
    pil_image: Optional[Image.Image] = None,
) -> OccasionResult:
    """
    Classify the outfit occasion using CLIP zero-shot (preferred) or color fallback.

    Args:
        garment_colors: From color extraction — list of {"label", "hex_color", …}
        garment_labels: Garment type strings (top, bottom, full_body, …)
        pil_image:      Full outfit PIL image. Required for CLIP path.

    Returns:
        OccasionResult with formality, best_occasion, and per-occasion scores.
    """
    source = "color"
    raw_scores: dict[str, float] = {}

    # ── 1. Attempt CLIP ──────────────────────────────────────────────────────
    if pil_image is not None:
        if not _clip_model._loaded:
            _clip_model.load()

        if _clip_model._loaded:
            try:
                raw_scores = _clip_model.classify(pil_image)
                source = "clip"
            except Exception as exc:
                logger.warning(f"CLIP inference failed: {exc} — falling back to color.")

    # ── 2. Color fallback ────────────────────────────────────────────────────
    if not raw_scores:
        raw_scores = _analyze_by_color(garment_colors)
        source = "color"

    # ── 3. Build result ──────────────────────────────────────────────────────
    formality_level, formality_score = _formality_from_scores(raw_scores)

    # Sort all occasions by score
    sorted_occasions = sorted(raw_scores.items(), key=lambda x: -x[1])
    best_key, best_score = sorted_occasions[0]
    best_display = OCCASION_DISPLAY.get(best_key, best_key)

    # Include all occasions that score at least 60% of the top score,
    # so a versatile item (e.g. a plain white shirt) gets multiple valid occasions
    # rather than being forced into one bucket.
    threshold = best_score * 0.60
    occasions = [
        OccasionScore(
            occasion=OCCASION_DISPLAY.get(k, k),
            score=round(v, 4),
            reasoning=(
                f"CLIP confidence: {v:.1%}"
                if source == "clip"
                else "Estimated from color analysis"
            ),
        )
        for k, v in sorted_occasions
        if v >= threshold
    ]

    result = OccasionResult(
        formality_level=formality_level,
        formality_score=formality_score,
        best_occasion=best_display,
        occasions=occasions,
        flags=[],
        source=source,
    )

    logger.info(
        f"Occasion [{source}]: top={best_display} ({best_score:.1%}), "
        f"suitable for {len(occasions)} occasions, "
        f"formality={formality_score:.2f} ({formality_level})"
    )
    return result

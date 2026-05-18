"""
TTS service — Kokoro neural voices for English + Hindi, espeak-ng for Tamil.

Kokoro:
  en → lang_code='a' (American English), voice='af_heart'
  hi → lang_code='h' (Hindi),            voice='hf_alpha'

Tamil (Kokoro does not support ta):
  espeak-ng -v ta  (robotic but functional; supports full Tamil script)

espeak-ng is also Kokoro's internal phonemizer, so it is always present.
"""

import io
import os
import subprocess
import tempfile
import logging
from threading import Lock

import numpy as np
import soundfile as sf

logger = logging.getLogger(__name__)

# ── Kokoro pipeline cache ─────────────────────────────────────────────────────
# Each KPipeline is ~300 MB in RAM. We keep one per language and load lazily.
_pipelines: dict = {}
_lock = Lock()

# Default voices — warm, clear, well-suited for accessibility
_KOKORO_CONFIGS = {
    "en": {"lang_code": "a", "voice": "af_heart"},
    "hi": {"lang_code": "h", "voice": "hf_alpha"},
}


def _get_pipeline(lang: str):
    """Return a cached KPipeline for the given language, loading on first call."""
    if lang not in _KOKORO_CONFIGS:
        return None
    with _lock:
        if lang not in _pipelines:
            from kokoro import KPipeline  # import here so startup isn't blocked
            cfg = _KOKORO_CONFIGS[lang]
            logger.info("Loading Kokoro pipeline for lang=%s …", lang)
            _pipelines[lang] = KPipeline(lang_code=cfg["lang_code"])
            logger.info("Kokoro pipeline ready for lang=%s", lang)
    return _pipelines[lang]


def _kokoro_wav(text: str, lang: str) -> bytes:
    """Synthesise text with Kokoro and return raw WAV bytes."""
    pipeline = _get_pipeline(lang)
    cfg = _KOKORO_CONFIGS[lang]

    # KPipeline.__call__ returns a generator of (graphemes, phonemes, audio_np)
    audio_chunks = []
    for _, _, audio in pipeline(text, voice=cfg["voice"]):
        if audio is not None:
            audio_chunks.append(audio)

    if not audio_chunks:
        raise RuntimeError("Kokoro returned no audio")

    audio_np = np.concatenate(audio_chunks)
    buf = io.BytesIO()
    sf.write(buf, audio_np, samplerate=24000, format="WAV")
    return buf.getvalue()


def _espeak_wav(text: str, lang_code: str = "ta") -> bytes:
    """
    Synthesise text with espeak-ng and return raw WAV bytes.
    Used as the Tamil fallback (espeak-ng supports ta, Kokoro does not).
    """
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        tmp = f.name
    try:
        subprocess.run(
            ["espeak-ng", "-v", lang_code, "-w", tmp, "--", text],
            check=True,
            capture_output=True,
            timeout=15,
        )
        with open(tmp, "rb") as f:
            return f.read()
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"espeak-ng failed: {exc.stderr.decode()}") from exc
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def generate(text: str, language: str = "en") -> bytes:
    """
    Generate TTS audio for the given text and language.
    Returns WAV bytes ready to serve directly.

    Supported languages:
      en  — Kokoro (af_heart voice, American English)
      hi  — Kokoro (hf_alpha voice, Hindi)
      ta  — espeak-ng (Tamil; Kokoro has no Tamil support)
    """
    text = text.strip()
    if not text:
        raise ValueError("Empty text")

    if language in _KOKORO_CONFIGS:
        return _kokoro_wav(text, language)
    elif language == "ta":
        return _espeak_wav(text, lang_code="ta")
    else:
        # Unknown language — fall back to English Kokoro
        logger.warning("Unknown language %r, falling back to en", language)
        return _kokoro_wav(text, "en")


def warmup():
    """
    Pre-load the English and Hindi Kokoro pipelines at startup so the first
    user request isn't slow. Called from main.py lifespan.
    """
    for lang in _KOKORO_CONFIGS:
        try:
            _get_pipeline(lang)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Kokoro warmup failed for lang=%s: %s", lang, exc)

"""
LLM Outfit Analysis — single Gemini Flash call per user interaction.

Receives only the image and the user's chosen occasion.
The LLM handles everything: garment identification, colour reading,
fit assessment, and the occasion verdict — no pre-computed scores fed in.
"""

import io
import json
import logging

from google import genai
from google.genai import types
from PIL import Image

from app.core.config import settings

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = """You are RizzVision, an AI outfit analyst designed for visually impaired users.
Your feedback will be read aloud by a screen reader. Every sentence must be short, clear, and spoken naturally.

RULES:
1. Be direct. Do not soften feedback to be polite.
2. Be humane. Explain why something works or does not.
3. Keep every sentence under 15 words. This will be read aloud.
4. Never use visual metaphors the user cannot reference. Avoid words like "looks sharp", "pops", "clean aesthetic", "eye-catching".
5. Use concrete language: "the dark blue shirt" not "the top piece". Be specific and vivid with colour names.
6. When describing garments, include tactile details: fabric weight impression, fit type, neckline, sleeve length.
7. For colour feedback: describe how the colours in the outfit work together. Mention contrast, tone, warmth/coolness.
8. Assess proportion and silhouette in fit feedback. Comment on how the pieces relate in terms of volume and shape.
9. The overall verdict must be one honest sentence. Not cruel. Not false.
10. The top fix must be the single most impactful change the user can make right now.
11. You understand Indian fashion vocabulary: kurta, dhoti, saree, sherwani, dupatta, salwar, churidar, lehenga, etc.
12. Count physically separate garments only. A shirt with a contrast collar or stripes is ONE garment. Only create separate entries for items that can be worn independently.
13. For occasion_verdict: the user has told you what occasion they are dressing for. Judge ONLY whether this specific outfit works for that occasion. Be funny, warm, and hype them up if it works. If it does not work, be gently humorous like a supportive friend, not a critic. Always end with a concrete fix if it does not work. Use one of these tones as inspiration (do not copy verbatim):
    WORKS examples: "Absolutely sending it. This is giving exactly the right energy for [occasion]."  /  "Certified [occasion] outfit. Nobody is ready for you."  /  "This is a full yes. Go do wonders."  /  "The [occasion] does not know what is about to hit it."  /  "Cleared for [occasion]. You are good to go, no notes."
    DOES NOT WORK examples: "Okay bestie, love the energy, but [occasion] is calling for something different. Swap [specific item] for something more [direction]."  /  "This is a vibe, just not the [occasion] vibe. [Specific fix] and you are sorted."  /  "Bold choice for [occasion]. Respectfully, [specific item] needs to sit this one out. Try [fix]."  /  "Not quite [occasion]-coded. [Specific change] and we are back in business."  /  "The outfit said yes but [occasion] said not today. [Concrete fix]."
14. For wardrobe_description: Write a rich, precise 3-4 sentence description of the SINGLE main garment for saving to the user's wardrobe. This description will be used later to visually re-identify the item from a photo. Include: exact garment type, exact colour name (not hex), pattern or texture if visible, fabric weight impression, fit (loose/slim/oversized/fitted), neckline and sleeve details, any distinctive features (logo, pocket, buttons, embroidery, print). Write as complete sentences. Do not mention the occasion.

Return ONLY valid JSON. No markdown. No preamble. No explanation outside the JSON.

Output schema:
{
  "garments": [{"name": "string", "description": "string"}],
  "color_feedback": "string",
  "fit_feedback": "string",
  "overall_verdict": "string",
  "top_fix": "string",
  "occasion_verdict": "string",
  "wardrobe_description": "string"
}

Field guidance:
- garments: List each visible garment with a tactile description including fabric weight impression, fit type, neckline, sleeve length.
- color_feedback: Describe how the colours in the outfit work together. Mention contrast, warmth/coolness, and whether they complement each other.
- fit_feedback: Assess proportion and silhouette only. No occasion prediction.
- overall_verdict: One sentence. Honest. Not cruel. Not false.
- top_fix: The single most impactful change the user can make right now.
- occasion_verdict: One to two sentences. Funny and warm if it works. Gently humorous with a concrete fix if it does not. Always references the specific occasion the user chose.
- wardrobe_description: 3-4 sentences describing the single main garment for wardrobe identification. Include type, exact colour, pattern/texture, fabric impression, fit, neckline, sleeves, and any distinctive features."""

REPAIR_PROMPT = """The previous response was not valid JSON. Here is the raw response:

{raw_response}

Please return ONLY valid JSON matching this exact schema, nothing else:
{{
  "garments": [{{"name": "string", "description": "string"}}],
  "color_feedback": "string",
  "fit_feedback": "string",
  "overall_verdict": "string",
  "top_fix": "string",
  "occasion_verdict": "string",
  "wardrobe_description": "string"
}}"""

_client = None


def _get_client():
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.GEMINI_API_KEY)
    return _client


def _parse_llm_json(text: str) -> dict:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        cleaned = "\n".join(lines)
    return json.loads(cleaned)


def _validate_feedback(data: dict) -> dict:
    required_fields = {
        "garments": [],
        "color_feedback": "Colour analysis is not available for this image.",
        "fit_feedback": "Fit analysis is not available for this image.",
        "overall_verdict": "I was unable to fully assess this outfit.",
        "top_fix": "Try taking a clearer photo for better feedback.",
        "occasion_verdict": "",
        "wardrobe_description": "",
    }
    for field_name, default in required_fields.items():
        if field_name not in data or not data[field_name]:
            data[field_name] = default
    if isinstance(data["garments"], list):
        data["garments"] = [
            g for g in data["garments"]
            if isinstance(g, dict) and "name" in g and "description" in g
        ]
    return data


def get_outfit_feedback(img: Image.Image, occasion: str = "") -> dict:
    """
    Single Gemini Flash call for outfit analysis.

    Args:
        img: PIL image of the outfit.
        occasion: User's chosen occasion label (e.g. "Date Night").

    Returns:
        Validated dict with garments, color_feedback, fit_feedback,
        overall_verdict, top_fix, occasion_verdict.
    """
    from app.services.image_ingestion import ImageQualityError

    client = _get_client()

    img_bytes_io = io.BytesIO()
    img.save(img_bytes_io, format="JPEG", quality=85)
    img_bytes = img_bytes_io.getvalue()

    occasion_line = (
        f"\nUSER'S OCCASION: {occasion}\n"
        f"Judge the occasion_verdict field against this occasion specifically."
        if occasion else
        "\nUSER'S OCCASION: not specified. Leave occasion_verdict as an empty string."
    )

    user_prompt = f"Analyse this outfit photo and provide structured feedback as JSON.{occasion_line}"

    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        max_output_tokens=600,
        temperature=0.4,
    )

    response = None
    try:
        response = client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=[
                types.Part.from_bytes(data=img_bytes, mime_type="image/jpeg"),
                user_prompt,
            ],
            config=config,
        )
        return _validate_feedback(_parse_llm_json(response.text))
    except json.JSONDecodeError:
        logger.warning("First LLM call returned malformed JSON — retrying with repair prompt")
        raw_response = response.text if response else "empty response"
    except Exception as e:
        logger.error(f"First LLM call failed: {e}")
        raw_response = str(e)

    try:
        repair_msg = REPAIR_PROMPT.format(raw_response=raw_response)
        response = client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=repair_msg,
            config=types.GenerateContentConfig(max_output_tokens=600, temperature=0.2),
        )
        return _validate_feedback(_parse_llm_json(response.text))
    except Exception as e:
        logger.error(f"Repair LLM call also failed: {e}")
        raise ImageQualityError(
            error_code="llm_parse_failed",
            user_message="Something went wrong generating your feedback. Please try again.",
        )

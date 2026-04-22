"""
API Layer (FastAPI)

All analysis is LLM-driven. The pipeline is:
  1. Validate image quality (brightness, sharpness)
  2. Verify clothing is present (SegFormer + CLIP gate)
  3. Single Gemini LLM call
  4. Shape output into TTS segments
"""

import logging
import time

from fastapi import APIRouter, UploadFile, File
from pydantic import BaseModel

from app.errors.handlers import ERROR_MESSAGES
from app.services.image_ingestion import ImageQualityError, ingest_image, check_image_quality
from app.services.garment_segmentation import segmentation_model
from app.services.llm_feedback import get_outfit_feedback
from app.services.response_shaper import shape_response

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/analyze")
async def analyze_outfit(
    image: UploadFile = File(...),
    occasion: str = "",
):
    """
    Analyse an outfit photo and return TTS-ready speech segments.

    Accepts: multipart/form-data with 'image' file and optional 'occasion' text field.

    Returns:
        speech_segments  — Ordered TTS segments [{id, text}]
        occasion_verdict — Humorous one-liner judging the outfit against the occasion
        skin_detected    — Always False (skin analysis removed)
        latency_ms       — Total processing time in ms
    """
    start_time = time.time()

    if not image or not image.filename:
        raise ImageQualityError(
            error_code="no_file_uploaded",
            user_message=ERROR_MESSAGES["no_file_uploaded"],
        )

    raw_bytes = await image.read()
    img = ingest_image(raw_bytes)
    check_image_quality(img)

    # Clothing presence gate (SegFormer pixel check + CLIP semantic check)
    segmentation_model.verify_clothing(img)

    # Single LLM call — image + occasion only
    llm_feedback = get_outfit_feedback(img, occasion=occasion)

    speech_segments = shape_response(llm_feedback)

    latency_ms = int((time.time() - start_time) * 1000)
    logger.info(f"Analysis complete in {latency_ms}ms | occasion={occasion or 'not specified'}")

    return {
        "speech_segments": speech_segments,
        "occasion_verdict": llm_feedback.get("occasion_verdict", ""),
        "wardrobe_description": llm_feedback.get("wardrobe_description", ""),
        "skin_detected": False,
        "latency_ms": latency_ms,
    }


@router.post("/shopping-analyze")
async def shopping_analyze(
    image: UploadFile = File(...),
    wardrobe: str = "",
):
    """
    Shopping mode: analyse the item in frame and compare it against the user's wardrobe.
    Returns TTS-ready feedback. If wardrobe is empty, gives a standalone style assessment.
    """
    from google import genai
    from google.genai import types as gtypes
    from app.core.config import settings
    import io as _io
    import json as _json

    start_time = time.time()

    if not image or not image.filename:
        raise ImageQualityError(
            error_code="no_file_uploaded",
            user_message=ERROR_MESSAGES["no_file_uploaded"],
        )

    raw_bytes = await image.read()
    img = ingest_image(raw_bytes)
    check_image_quality(img)
    segmentation_model.verify_clothing(img)

    has_wardrobe = bool(wardrobe and wardrobe.strip() and wardrobe.strip() != "[]")

    if has_wardrobe:
        wardrobe_section = f"The user's wardrobe:\n{wardrobe}"
        match_instruction = (
            "Tell the user which specific items in their wardrobe this would pair well with, "
            "and which items it would clash with. Be specific — name the items. "
            "If nothing pairs well, say so honestly."
        )
    else:
        wardrobe_section = "The user has no saved wardrobe items."
        match_instruction = (
            "The wardrobe is empty. Give a standalone style and fit assessment. "
            "Tell the user how this item would look on them and what it would generally pair well with."
        )

    client = genai.Client(api_key=settings.GEMINI_API_KEY)

    prompt = f"""You are RizzVision in shopping mode, speaking to a visually impaired user.
Your response is read aloud. Every sentence must be under 15 words. No markdown. No lists.
Use concrete, tactile language. Never say "looks good" — say WHY.

{wardrobe_section}

Task:
1. Briefly describe what you see (1-2 sentences, garment and colour).
2. {match_instruction}
3. One sentence on whether this is worth buying for their style.

Return ONLY valid JSON:
{{
  "item_description": "string",
  "wardrobe_match": "string",
  "buy_verdict": "string"
}}"""

    img_bytes_io = _io.BytesIO()
    img.save(img_bytes_io, format="JPEG", quality=85)
    img_bytes = img_bytes_io.getvalue()

    response = client.models.generate_content(
        model=settings.GEMINI_MODEL,
        contents=[
            gtypes.Part.from_bytes(data=img_bytes, mime_type="image/jpeg"),
            prompt,
        ],
        config=gtypes.GenerateContentConfig(max_output_tokens=400, temperature=0.4),
    )

    try:
        text = response.text.strip()
        if text.startswith("```"):
            text = "\n".join(l for l in text.split("\n") if not l.strip().startswith("```"))
        data = _json.loads(text)
    except Exception:
        data = {
            "item_description": "I can see a clothing item in frame.",
            "wardrobe_match": "Unable to assess wardrobe compatibility right now.",
            "buy_verdict": "Try again for a full assessment.",
        }

    speech_segments = []
    if data.get("item_description"):
        speech_segments.append({"id": "item", "text": data["item_description"]})
    if data.get("wardrobe_match"):
        speech_segments.append({"id": "match", "text": data["wardrobe_match"]})
    if data.get("buy_verdict"):
        speech_segments.append({"id": "verdict", "text": data["buy_verdict"]})

    analysis_context = (
        f"Assessment: {data.get('item_description', '')} {data.get('wardrobe_match', '')}"
    )

    latency_ms = int((time.time() - start_time) * 1000)

    return {
        "speech_segments": speech_segments,
        "has_wardrobe": has_wardrobe,
        "analysis_context": analysis_context,
        "latency_ms": latency_ms,
    }


class ShoppingFollowUpRequest(BaseModel):
    question: str
    last_analysis_context: str


@router.post("/shopping-followup")
async def shopping_followup(req: ShoppingFollowUpRequest):
    """Answer a follow-up question about the last scanned shopping item."""
    from google import genai
    from google.genai import types as gtypes
    from app.core.config import settings

    client = genai.Client(api_key=settings.GEMINI_API_KEY)

    prompt = (
        f"You are RizzVision, a fashion assistant for visually impaired users. "
        f"Your response will be read aloud. Keep it under 3 sentences. No markdown. "
        f"Context from the last scan: {req.last_analysis_context}\n\n"
        f"User question: {req.question}\n\n"
        f"Answer the question directly and concisely."
    )

    response = client.models.generate_content(
        model=settings.GEMINI_MODEL,
        contents=prompt,
        config=gtypes.GenerateContentConfig(max_output_tokens=200, temperature=0.4),
    )

    return {"answer": response.text.strip()}


class OutfitSuggestionRequest(BaseModel):
    occasion: str
    wardrobe: str
    anchor: str = ""


@router.post("/outfit-suggestion")
async def outfit_suggestion(req: OutfitSuggestionRequest):
    """
    Generate 1-2 outfit combinations from wardrobe items for a given occasion.
    Uses exact wardrobe item names, fun and hype tone, under 80 words.
    """
    from google import genai
    from google.genai import types
    from app.core.config import settings

    client = genai.Client(api_key=settings.GEMINI_API_KEY)

    anchor_line = f"\nBuild the outfit around: {req.anchor}" if req.anchor else ""

    prompt = (
        f"You are RizzVision, a bold and fun fashion assistant speaking to a visually impaired user. "
        f"Your response will be read aloud by a screen reader.\n\n"
        f"RULES:\n"
        f"1. ALWAYS refer to items by their EXACT name from the wardrobe list below. Never paraphrase or genericise.\n"
        f"2. Never use hex codes. Use the colour name as given in the item name.\n"
        f"3. Be short and punchy. The whole response must be under 80 words.\n"
        f"4. Be fun and confident — like a friend hyping them up. Use phrases like "
        f"   'You would absolutely slay in...', 'This combo is a vibe:', 'Trust me on this one:', "
        f"   'Nobody is ready for you in...', etc.\n"
        f"5. Give exactly 1 outfit combination if the wardrobe is small (under 4 items), "
        f"   or 2 combinations if there are 4 or more items.\n"
        f"6. Each combination is ONE sentence naming the exact items.\n"
        f"7. End with one short sentence on why it works for the occasion.\n"
        f"8. If the wardrobe is empty, say 'Your wardrobe is empty. Scan some clothes first and come back.'\n\n"
        f"Occasion: {req.occasion}{anchor_line}\n\n"
        f"Wardrobe (use these exact names):\n{req.wardrobe}"
    )

    response = client.models.generate_content(
        model=settings.GEMINI_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(max_output_tokens=250, temperature=0.7),
    )
    return {"suggestion": response.text}


class ContextChatRequest(BaseModel):
    message: str
    context: str          # The suggestion/result text the user is asking about
    feature: str          # Which feature: "scan", "mirror", "outfit", "shopping", "wardrobe"
    history: list[dict]   # [{"role": "user"|"assistant", "text": str}, ...]


@router.post("/context-chat")
async def context_chat(req: ContextChatRequest):
    """
    Feature-specific follow-up chatbot.

    Stays in the context of a particular suggestion/result. The conversation
    history is passed in full so the LLM has memory of the thread.
    Each feature has its own persona/framing so answers stay relevant.

    Returns: { answer: str }  — TTS-ready spoken response.
    """
    from google import genai
    from google.genai import types
    from app.core.config import settings

    feature_personas = {
        "scan": (
            "You are RizzVision's outfit analyst. The user has just received a full outfit analysis. "
            "Answer follow-up questions about the specific outfit described in the context — colours, fit, occasion suitability, what to change, etc. "
            "Be direct, warm, and specific. Reference the actual garments and details from the context."
        ),
        "mirror": (
            "You are RizzVision's auditory mirror. The user received instant outfit feedback. "
            "Answer follow-up questions about the outfit — how it looks, what to change, specific details. "
            "Be concise and helpful. Reference the actual analysis from the context."
        ),
        "outfit": (
            "You are RizzVision's personal stylist. The user received outfit combination suggestions from their wardrobe. "
            "Answer follow-up questions about why these pieces work together, alternatives, how to accessorise, or what else could work. "
            "Be enthusiastic and specific. Only refer to items that appear in the context."
        ),
        "shopping": (
            "You are RizzVision's shopping assistant. The user is in a store and received feedback on an item they are looking at. "
            "Answer follow-up questions about the item — fit, value, whether it suits them, what it would pair with. "
            "Be practical and decisive. Reference the item details from the context."
        ),
        "wardrobe": (
            "You are RizzVision's wardrobe assistant. The user is browsing their saved clothing items. "
            "Answer questions about specific items, combinations, or general wardrobe advice. "
            "Be helpful and organised. Reference the actual items listed in the context."
        ),
    }

    persona = feature_personas.get(req.feature, feature_personas["scan"])

    # Build conversation history for the LLM
    history_text = ""
    for turn in req.history[-6:]:  # last 6 turns keeps context tight
        role = "User" if turn["role"] == "user" else "Assistant"
        history_text += f"{role}: {turn['text']}\n"

    prompt = f"""{persona}

CONTEXT (what was shown to the user):
{req.context}

CONVERSATION SO FAR:
{history_text}
User: {req.message}

RULES:
- Your response will be read aloud. Keep every sentence under 15 words.
- No markdown. No bullet points. Speak naturally.
- Be specific — reference actual items, colours, and details from the context above.
- If the user asks about something not in the context, say so honestly.
- Keep your total response under 60 words.

Respond as the Assistant:"""

    try:
        client = genai.Client(api_key=settings.GEMINI_API_KEY)
        response = client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(max_output_tokens=200, temperature=0.5),
        )
        answer = response.text.strip()
        # Strip any "Assistant:" prefix the model might echo
        if answer.lower().startswith("assistant:"):
            answer = answer[10:].strip()
        return {"answer": answer}
    except Exception:
        return {"answer": "I could not process that question. Please try again."}


class IdentifyItemRequest(BaseModel):
    image_base64: str       # base64-encoded JPEG (no data URL prefix)
    wardrobe: list[dict]    # [{id, name, category, colorDescription, description}, ...]


@router.post("/identify-item")
async def identify_item(req: IdentifyItemRequest):
    """
    Match a photographed garment against the user's saved wardrobe items.

    Sends the image and full wardrobe descriptions to the LLM, which selects
    the best match (or says none found). Returns the matched item's id,
    a confidence label, and a spoken explanation.

    Returns:
        matched_id     — id of the matched wardrobe item, or null
        matched_name   — display name of the matched item, or null
        confidence     — "high" | "medium" | "low" | "none"
        spoken         — TTS-ready sentence explaining the match
    """
    import base64 as _b64
    import json as _json
    from google import genai
    from google.genai import types as gtypes
    from app.core.config import settings

    if not req.wardrobe:
        return {
            "matched_id": None,
            "matched_name": None,
            "confidence": "none",
            "spoken": "Your wardrobe is empty. Scan some clothing items first.",
        }

    # Decode image
    try:
        img_bytes = _b64.b64decode(req.image_base64)
        from PIL import Image
        import io as _io
        img = Image.open(_io.BytesIO(img_bytes)).convert("RGB")
        # Downscale for speed — identify doesn't need full res
        img.thumbnail((640, 640))
        buf = _io.BytesIO()
        img.save(buf, format="JPEG", quality=80)
        img_bytes = buf.getvalue()
    except Exception:
        return {
            "matched_id": None,
            "matched_name": None,
            "confidence": "none",
            "spoken": "Could not read the image. Please try again.",
        }

    # Build wardrobe list for the prompt
    wardrobe_lines = "\n".join(
        f"{i+1}. [ID:{item['id']}] {item['name']} ({item.get('colorDescription') or ''}) "
        f"— {item.get('category', '')}. {item.get('description') or ''}"
        for i, item in enumerate(req.wardrobe)
    )

    prompt = f"""You are RizzVision's clothing identifier. A visually impaired user is holding up a garment.
Your job: look at the photo and find which item in their wardrobe it most likely is.

WARDROBE:
{wardrobe_lines}

TASK:
1. Describe what garment you see in one short phrase (colour + type).
2. Pick the single best matching wardrobe item based on colour, type, and any visible details.
3. Rate your confidence: "high" if the match is clear, "medium" if likely but not certain, "low" if it is a guess.
4. If nothing in the wardrobe matches at all (very different garment), use confidence "none".

RULES:
- Your spoken sentence will be read aloud. Keep it under 20 words.
- Do not mention the ID in the spoken text — only in the JSON.
- If confidence is "none", set matched_id to null.

Return ONLY valid JSON:
{{
  "matched_id": "<id string or null>",
  "matched_name": "<item name or null>",
  "confidence": "high|medium|low|none",
  "spoken": "spoken sentence here"
}}"""

    try:
        client = genai.Client(api_key=settings.GEMINI_API_KEY)
        response = client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=[
                gtypes.Part.from_bytes(data=img_bytes, mime_type="image/jpeg"),
                prompt,
            ],
            config=gtypes.GenerateContentConfig(max_output_tokens=300, temperature=0.3),
        )
        text = response.text.strip()
        if text.startswith("```"):
            text = "\n".join(l for l in text.split("\n") if not l.strip().startswith("```"))
        data = _json.loads(text)

        # Validate matched_id is actually in the wardrobe
        valid_ids = {item["id"] for item in req.wardrobe}
        if data.get("matched_id") and data["matched_id"] not in valid_ids:
            data["matched_id"] = None
            data["matched_name"] = None
            data["confidence"] = "none"
            data["spoken"] = "I could not find a matching item in your wardrobe."

        return {
            "matched_id": data.get("matched_id"),
            "matched_name": data.get("matched_name"),
            "confidence": data.get("confidence", "none"),
            "spoken": data.get("spoken", "I was not able to identify this item."),
        }
    except Exception:
        return {
            "matched_id": None,
            "matched_name": None,
            "confidence": "none",
            "spoken": "Something went wrong. Please try again.",
        }


class VoiceQueryRequest(BaseModel):
    transcript: str
    current_screen: str = "home"
    wardrobe_summary: str = ""   # Plain text list of wardrobe items (may be empty)
    wardrobe_count: int = 0


@router.post("/voice-query")
async def voice_query(req: VoiceQueryRequest):
    """
    Free-form voice assistant endpoint.

    Receives a transcript of what the user said plus app context, and returns
    either a spoken answer or a structured command (or both) for the frontend to act on.

    The LLM decides whether the query is:
      - A question to answer (e.g. "how many items do I have?")
      - A navigation intent (e.g. "I want to check my wardrobe")
      - A feature question (e.g. "what can you do?")
      - An action on the current screen (e.g. "save this" on result screen)

    Returns:
        answer   — TTS-ready spoken response (always present)
        command  — Optional structured command for the frontend to execute
                   { type, screen?, id?, category? } — same shape as commandParser output
    """
    from google import genai
    from google.genai import types
    from app.core.config import settings

    client = genai.Client(api_key=settings.GEMINI_API_KEY)

    screen_descriptions = {
        "home":      "the main menu with buttons for Scan Clothing, Get Outfit Help, My Wardrobe, Shopping Mode, and Mirror",
        "scan":      "the Scan Clothing screen — captures outfit photos, analyses them, and saves items to the wardrobe",
        "wardrobe":  "the Wardrobe screen showing the user's saved clothing items",
        "outfit":    "the Outfit Help screen where the user picks an occasion to get outfit combination suggestions",
        "shopping":  "Shopping Mode — the camera auto-captures every few seconds for real-time wardrobe-aware feedback",
        "mirror":    "the Auditory Mirror — instant outfit feedback, nothing is saved",
        "editItem":  "the Edit Item screen for changing the name, category or description of a wardrobe item",
    }
    screen_label = screen_descriptions.get(req.current_screen, req.current_screen)

    wardrobe_section = (
        f"The user's wardrobe ({req.wardrobe_count} item{'s' if req.wardrobe_count != 1 else ''}):\n{req.wardrobe_summary}"
        if req.wardrobe_summary
        else "The user's wardrobe is currently empty."
    )

    prompt = f"""You are RizzVision, an AI fashion assistant for visually impaired users.
The user has just spoken to you. Respond as if you are a helpful, warm, knowledgeable friend.
Your answer WILL BE READ ALOUD — keep every sentence under 15 words. No markdown. No lists. Speak naturally.

APP CONTEXT
-----------
Current screen: {screen_label}
{wardrobe_section}

WHAT RizzVision CAN DO (use this to answer "what can you do" questions):
- Scan Clothing: photograph a clothing item, analyse it with AI, and save it to your wardrobe with a name and description
- Auditory Mirror: instantly hear what you are wearing right now — colours, fit, and a one-liner verdict — nothing is saved
- Shopping Mode: point the camera while shopping and hear real-time feedback on whether items match your wardrobe
- Get Outfit Help: say an occasion and hear which exact items from your wardrobe to combine
- My Wardrobe: browse, filter by category, or delete saved items
- Voice commands: say any instruction aloud — navigate, filter, save, read results, and more

USER SAID: "{req.transcript}"

INSTRUCTIONS:
1. Answer the question or respond to the request naturally and helpfully.
2. If the user wants to navigate somewhere, include a "command" field in your JSON.
3. Keep the spoken answer under 40 words total — TTS is slow, brevity is kind.
4. If you do not understand, say so clearly and suggest what the user can try.

Return ONLY valid JSON:
{{
  "answer": "spoken response here",
  "command": null
}}

OR if navigation/action is appropriate:
{{
  "answer": "spoken response here",
  "command": {{ "type": "NAVIGATE", "screen": "wardrobe" }}
}}

Valid command types and shapes:
  {{"type": "NAVIGATE", "screen": "<home|scan|wardrobe|outfit|shopping|mirror>"}}
  {{"type": "GO_BACK"}}
  {{"type": "READ_WARDROBE"}}
  {{"type": "FILTER_WARDROBE", "category": "<tops|bottoms|dresses|footwear|jewellery|null>"}}
  {{"type": "READ_RESULT"}}
  {{"type": "SAVE_ITEM"}}
  {{"type": "DISCARD_ITEM"}}
  {{"type": "SCAN_AGAIN"}}
  {{"type": "PAUSE_SCAN"}}
  {{"type": "RESUME_SCAN"}}
  {{"type": "CONFIRM"}}

Only include a command when the user clearly wants an action, not just information."""

    import json as _json

    try:
        response = client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(max_output_tokens=300, temperature=0.5),
        )
        text = response.text.strip()
        if text.startswith("```"):
            text = "\n".join(l for l in text.split("\n") if not l.strip().startswith("```"))
        data = _json.loads(text)
        return {
            "answer": data.get("answer", "I did not quite catch that. Could you rephrase?"),
            "command": data.get("command"),
        }
    except Exception:
        return {
            "answer": "I did not quite catch that. Try saying a command like 'my wardrobe' or 'scan clothing'.",
            "command": None,
        }

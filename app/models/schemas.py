from pydantic import BaseModel


class GarmentInfo(BaseModel):
    """A detected garment with its extracted color."""
    label: str
    hex_color: str | None


class GarmentLLM(BaseModel):
    """A garment as described by the LLM."""
    name: str
    description: str


class ColorHarmonyResult(BaseModel):
    """Output of the color harmony engine."""
    score: float
    label: str
    flags: list[str]
    hue_score: float
    lightness_score: float
    saturation_score: float


class LLMFeedback(BaseModel):
    """Structured feedback from the Gemini LLM call."""
    garments: list[GarmentLLM]
    color_feedback: str
    fit_feedback: str
    overall_verdict: str
    top_fix: str


class SpeechSegment(BaseModel):
    """A single TTS-ready speech segment."""
    id: str
    text: str


class AnalyzeResponse(BaseModel):
    """Full response from the /analyze endpoint."""
    speech_segments: list[SpeechSegment]
    color_score: float
    color_label: str
    latency_ms: int
    raw: dict


class ErrorResponse(BaseModel):
    """Error response with a spoken user message."""
    error_code: str
    user_message: str

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import base64, io, os
import httpx
from PIL import Image
from ultralytics import YOLO

MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "RizzVision YOLOv8m Final.pt")
model: YOLO | None = None
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
AUTH_TIMEOUT_SECONDS = float(os.getenv("SUPABASE_AUTH_TIMEOUT_SECONDS", "5"))


def _extract_bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(401, "Missing authorization token")
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Invalid authorization header")

    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(401, "Missing authorization token")
    return token


def _verify_supabase_user(authorization: str | None) -> str:
    token = _extract_bearer_token(authorization)

    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise HTTPException(500, "Supabase auth verification is not configured")

    try:
        response = httpx.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {token}",
            },
            timeout=AUTH_TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(503, "Auth verification unavailable") from exc

    if response.status_code != 200:
        raise HTTPException(401, "Invalid or expired auth token")

    user_data = response.json()
    user_id = user_data.get("id")
    if not user_id:
        raise HTTPException(401, "Invalid or expired auth token")

    return user_id


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model
    print(f"[RizzVision] Loading YOLOv8m from {MODEL_PATH} …")
    model = YOLO(MODEL_PATH)
    print("[RizzVision] Model ready.")
    yield
    model = None


app = FastAPI(title="RizzVision YOLO API", lifespan=lifespan)

ALLOWED_ORIGINS = [
    "http://localhost:5173",        # Vite dev server
    "http://localhost:4173",        # Vite preview
    "https://*.vercel.app",         # All Vercel deployments
    os.getenv("FRONTEND_URL", ""),  # Exact production Vercel URL (set in HF Space secrets)
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o for o in ALLOWED_ORIGINS if o],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class DetectRequest(BaseModel):
    image: str  # raw base64, no data-URI prefix


class Detection(BaseModel):
    label: str
    confidence: float
    box: list[float]  # [x1, y1, x2, y2]


class DetectResponse(BaseModel):
    detections: list[Detection]


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": model is not None}


@app.post("/detect", response_model=DetectResponse)
def detect(req: DetectRequest, authorization: str | None = Header(default=None)):
    _verify_supabase_user(authorization)

    if model is None:
        raise HTTPException(503, "Model not loaded")
    try:
        img = Image.open(io.BytesIO(base64.b64decode(req.image))).convert("RGB")
    except Exception as e:
        raise HTTPException(400, f"Invalid image: {e}")

    results = model(img, verbose=False)
    detections = []
    for r in results:
        for i in range(len(r.boxes)):
            detections.append(Detection(
                label=r.names[int(r.boxes.cls[i])],
                confidence=round(float(r.boxes.conf[i]), 4),
                box=[round(v, 1) for v in r.boxes.xyxy[i].tolist()],
            ))
    return DetectResponse(detections=detections)

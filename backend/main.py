from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import base64, io, os
from PIL import Image
from ultralytics import YOLO

MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "RizzVision YOLOv8m Final.pt")
model: YOLO | None = None


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
def detect(req: DetectRequest):
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

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import base64
import io
import os

# Lazy import to avoid early hang
model = None
MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "RizzVision YOLOv8m Final.pt")


def load_model():
    global model
    if model is None:
        try:
            print("[RizzVision] Loading YOLOv8m model...")
            from ultralytics import YOLO
            from PIL import Image
            model = YOLO(MODEL_PATH)
            print("[RizzVision] Model loaded successfully!")
        except Exception as e:
            print(f"[RizzVision] Model loading failed: {e}")
            raise
    return model


app = FastAPI(title="RizzVision YOLO API")

ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:4173",
    "https://*.vercel.app",
    os.getenv("FRONTEND_URL", ""),
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
    try:
        model_instance = load_model()
    except Exception as e:
        raise HTTPException(503, f"Model initialization failed: {str(e)}")

    try:
        from PIL import Image
        img = Image.open(io.BytesIO(base64.b64decode(req.image))).convert("RGB")
    except Exception as e:
        raise HTTPException(400, f"Invalid image: {e}")

    try:
        results = model_instance(img, verbose=False)
        detections = []
        for r in results:
            for i in range(len(r.boxes)):
                detections.append(
                    Detection(
                        label=r.names[int(r.boxes.cls[i])],
                        confidence=round(float(r.boxes.conf[i]), 4),
                        box=[round(v, 1) for v in r.boxes.xyxy[i].tolist()],
                    )
                )
        return DetectResponse(detections=detections)
    except Exception as e:
        raise HTTPException(500, f"Detection failed: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7860)

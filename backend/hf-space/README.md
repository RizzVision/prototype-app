---
title: RizzVision YOLO API
emoji: 👗
colorFrom: purple
colorTo: pink
sdk: docker
pinned: false
app_port: 7860
---

# RizzVision YOLO Garment Detection API

FastAPI backend serving YOLOv8m garment detection for the RizzVision prototype app (deployed on Vercel).

## Endpoints

- `GET /health` — liveness check, returns `{"status":"ok","model_loaded":true}`
- `POST /detect` — accepts `{"image": "<raw_base64>"}`, returns garment detections

## Environment secrets (set in Space Settings → Repository secrets)

| Key | Value |
|---|---|
| `FRONTEND_URL` | Your Vercel app URL, e.g. `https://your-app.vercel.app` |

## Setup (one-time)

```bash
# 1. Clone this Space
git clone https://huggingface.co/spaces/<your-username>/rizzvision-yolo-api
cd rizzvision-yolo-api

# 2. Enable Git LFS and track .pt files
git lfs install
git lfs track "*.pt"
git add .gitattributes

# 3. Copy the model file into models/
cp "/path/to/RizzVision YOLOv8m Final.pt" models/

# 4. Commit and push — HF builds the Docker image automatically
git add .
git commit -m "Add YOLOv8m garment detection model"
git push
```

Build takes ~5 minutes on first push. The Space URL will be:
`https://<username>-rizzvision-yolo-api.hf.space`

Set `VITE_YOLO_API_URL=https://<username>-rizzvision-yolo-api.hf.space` in your Vercel environment variables, then redeploy.

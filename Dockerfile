# RizzVision Backend — Hugging Face Spaces deployment
#
# HF Spaces requires port 7860.
# The PORT env var in .env is overridden by CMD below.
#
# First-run note: SegFormer (~250 MB) and CLIP (~350 MB) are downloaded from
# HuggingFace Hub on first startup and cached in /app/hf_cache.
# Subsequent restarts skip the download (cache persists for the lifetime of
# the Space's persistent storage).

FROM python:3.11

# System libs for image processing (already in full image, but explicit)
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Install CPU-only PyTorch first (avoids pulling the 2 GB CUDA wheel) ──────
RUN pip install --no-cache-dir \
    torch==2.3.1+cpu \
    torchvision==0.18.1+cpu \
    --index-url https://download.pytorch.org/whl/cpu

# ── Install remaining dependencies ───────────────────────────────────────────
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── Copy application code ─────────────────────────────────────────────────────
COPY . .

# ── HuggingFace model cache directory ────────────────────────────────────────
ENV HF_HOME=/app/hf_cache
ENV TRANSFORMERS_CACHE=/app/hf_cache

# ── Runtime config ────────────────────────────────────────────────────────────
# GEMINI_API_KEY must be set as a Space Secret (never baked into the image)
ENV HOST=0.0.0.0
ENV PORT=7860
ENV DEBUG=false
ENV LOG_LEVEL=INFO

EXPOSE 7860

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]

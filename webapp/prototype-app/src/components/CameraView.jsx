import { useRef, useEffect, useState, useCallback } from "react";
import { C, FONT } from "../utils/constants";
import { RESPONSES } from "../voice/voiceResponses";

export default function CameraView({ onCapture, onError, captureRef, onDescribe, autoCapture = false, captureInterval = 6000 }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const guidanceCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const facingModeRef = useRef("environment");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [facingMode, setFacingMode] = useState("environment");

  const startCamera = useCallback(async (facing) => {
    const mode = facing ?? facingModeRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 960 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => setReady(true);
      }
    } catch (err) {
      const msg = err.name === "NotAllowedError"
        ? "Camera permission denied. Please allow camera access."
        : "Could not access camera.";
      setError(msg);
      if (onError) onError(msg);
    }
  }, [onError]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setReady(false);
  }, []);

  const flipCamera = useCallback(async () => {
    const newMode = facingModeRef.current === "environment" ? "user" : "environment";
    facingModeRef.current = newMode;
    setFacingMode(newMode);
    stopCamera();
    await startCamera(newMode);
  }, [stopCamera, startCamera]);

  const captureFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.85);
  }, []);

  const estimateSubjectBox = useCallback((data, width, height) => {
    if (!data || !width || !height) return null;

    const sampleStep = 4;
    const borderPixels = [];
    const pushPixel = (x, y) => {
      const idx = (y * width + x) * 4;
      borderPixels.push([data[idx], data[idx + 1], data[idx + 2]]);
    };

    for (let x = 0; x < width; x += sampleStep) {
      pushPixel(x, 0);
      pushPixel(x, height - 1);
    }
    for (let y = sampleStep; y < height - sampleStep; y += sampleStep) {
      pushPixel(0, y);
      pushPixel(width - 1, y);
    }

    if (borderPixels.length === 0) return null;

    const background = borderPixels.reduce((acc, [r, g, b]) => {
      acc.r += r;
      acc.g += g;
      acc.b += b;
      return acc;
    }, { r: 0, g: 0, b: 0 });
    background.r /= borderPixels.length;
    background.g /= borderPixels.length;
    background.b /= borderPixels.length;

    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let activePixels = 0;

    for (let y = 0; y < height; y += sampleStep) {
      for (let x = 0; x < width; x += sampleStep) {
        const idx = (y * width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const delta = Math.abs(r - background.r) + Math.abs(g - background.g) + Math.abs(b - background.b);
        if (delta < 90) continue;
        activePixels++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    if (activePixels < 120 || maxX <= minX || maxY <= minY) return null;

    return {
      x1: minX / width,
      y1: minY / height,
      x2: maxX / width,
      y2: maxY / height,
      confidence: Math.min(1, activePixels / ((width * height) / 18)),
    };
  }, []);

  const playShutterSound = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const playClick = (freq, startTime, gainVal) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(freq, startTime);
        gain.gain.setValueAtTime(gainVal, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.04);
        osc.start(startTime);
        osc.stop(startTime + 0.04);
      };
      playClick(1200, ctx.currentTime, 0.4);
      playClick(900, ctx.currentTime + 0.05, 0.3);
    } catch (_) {}
  };

  const playReadyChime = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const playNote = (freq, startTime) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(freq, startTime);
        gain.gain.setValueAtTime(0.25, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.08);
        osc.start(startTime);
        osc.stop(startTime + 0.08);
      };
      playNote(523, ctx.currentTime);
      playNote(659, ctx.currentTime + 0.08);
    } catch (_) {}
  };

  const describeWhatsFocused = useCallback(() => {
    if (!ready || !videoRef.current || !guidanceCanvasRef.current) return;
    const video = videoRef.current;
    const gc = guidanceCanvasRef.current;
    gc.width  = Math.floor(video.videoWidth  / 2);
    gc.height = Math.floor(video.videoHeight / 2);
    const ctx2 = gc.getContext("2d");
    ctx2.drawImage(video, 0, 0, gc.width, gc.height);
    const imageData = ctx2.getImageData(0, 0, gc.width, gc.height);
    const box = estimateSubjectBox(imageData.data, gc.width, gc.height);

    let description;
    if (!box || box.confidence < 0.15) {
      description = RESPONSES.whatsInFocus.noClothing;
    } else {
      const area = (box.x2 - box.x1) * (box.y2 - box.y1);
      if (area < 0.06)      description = RESPONSES.whatsInFocus.tooSmall;
      else if (area > 0.85) description = RESPONSES.whatsInFocus.tooLarge;
      else                  description = RESPONSES.whatsInFocus.ready;
    }
    if (description === RESPONSES.whatsInFocus.ready) playReadyChime();
    if (onDescribe) onDescribe(description);
  }, [ready, estimateSubjectBox, onDescribe]);

  const handleCapture = useCallback(() => {
    playShutterSound();
    const dataUrl = captureFrame();
    if (dataUrl && onCapture) {
      const base64 = dataUrl.split(",")[1];
      onCapture(base64, dataUrl);
    }
  }, [captureFrame, onCapture]);

  useEffect(() => {
    startCamera();
    return stopCamera;
  }, [startCamera, stopCamera]);

  useEffect(() => {
    if (captureRef) captureRef.current = handleCapture;
  }, [captureRef, handleCapture]);

  useEffect(() => {
    if (!autoCapture || !ready) return;
    const id = setInterval(() => handleCapture(), captureInterval);
    return () => clearInterval(id);
  }, [autoCapture, captureInterval, ready, handleCapture]);

  if (error) {
    return (
      <div style={{
        flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
        padding: 40, textAlign: "center",
      }}>
        <p style={{ fontFamily: FONT, fontSize: 18, color: C.danger, lineHeight: 1.6 }}>
          {error}
        </p>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, position: "relative", background: "#000" }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        aria-hidden
        style={{
          width: "100%", height: "100%", objectFit: "cover",
          position: "absolute", top: 0, left: 0,
        }}
      />
      <canvas ref={canvasRef} style={{ display: "none" }} />
      <canvas ref={guidanceCanvasRef} style={{ display: "none" }} />

      {/* Static target zone — visual framing guide only */}
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <div style={{
          position: "absolute",
          top: "10%", left: "15%", width: "70%", height: "80%",
          border: "3px solid rgba(255,255,255,0.35)",
          borderRadius: 16,
          boxSizing: "border-box",
        }} />
      </div>

      {/* Flip camera button */}
      <div style={{ position: "absolute", top: 20, right: 20 }}>
        <button
          onClick={flipCamera}
          disabled={!ready}
          aria-label={facingMode === "environment" ? "Switch to front camera" : "Switch to back camera"}
          style={{
            width: 56, height: 56, borderRadius: "50%",
            background: "rgba(0,0,0,0.55)",
            border: `2px solid rgba(255,255,255,0.7)`,
            cursor: ready ? "pointer" : "not-allowed",
            display: "flex", alignItems: "center", justifyContent: "center",
            opacity: ready ? 1 : 0.4,
            boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
          }}
        >
          <svg aria-hidden viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7h2l2-2h10l2 2h2a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/>
            <path d="M9 13a3 3 0 1 0 6 0"/>
            <polyline points="15 10 15 13 12 13"/>
          </svg>
        </button>
      </div>

      {/* Bottom controls: Describe + Capture */}
      <div style={{
        position: "absolute", bottom: 40, left: 0, right: 0,
        display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
      }}>
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 28 }}>
          {/* Describe / What's in Focus button */}
          <button
            onClick={describeWhatsFocused}
            disabled={!ready}
            aria-label="Describe what is in frame"
            style={{
              width: 72, height: 72, borderRadius: "50%",
              background: ready ? "rgba(0,0,0,0.65)" : C.surface,
              border: "3px solid rgba(255,255,255,0.7)",
              cursor: ready ? "pointer" : "not-allowed",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 28, opacity: ready ? 1 : 0.4,
              boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
            }}
          >
            <span aria-hidden>👁</span>
          </button>

          {/* Primary capture button */}
          <button
            onClick={handleCapture}
            disabled={!ready}
            aria-label="Capture photo. Tap to scan clothing."
            style={{
              width: 88, height: 88, borderRadius: "50%",
              background: ready ? C.focus : C.surface,
              border: `4px solid ${C.white}`,
              cursor: ready ? "pointer" : "not-allowed",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 36, color: "#000", fontWeight: 900,
              boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
            }}
          >
            <span aria-hidden>📸</span>
          </button>
        </div>

        {/* Button labels */}
        <div style={{ display: "flex", justifyContent: "center", gap: 52, paddingTop: 4 }}>
          <span style={{ fontFamily: FONT, fontSize: 12, color: "rgba(255,255,255,0.7)", width: 72, textAlign: "center" }}>What's in Focus</span>
          <span style={{ fontFamily: FONT, fontSize: 12, color: "rgba(255,255,255,0.7)", width: 88, textAlign: "center" }}>Capture</span>
        </div>
      </div>

      {!ready && !error && (
        <div style={{
          position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
          fontFamily: FONT, fontSize: 18, color: C.muted,
        }}>
          Starting camera...
        </div>
      )}
    </div>
  );
}

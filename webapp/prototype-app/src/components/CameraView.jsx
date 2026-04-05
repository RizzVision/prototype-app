import { useRef, useEffect, useState, useCallback } from "react";
import { C, FONT } from "../utils/constants";

export default function CameraView({ onCapture, onError, autoCapture = false, captureInterval = 4000, guidanceMode = false, onGuidanceSample, captureRef, guidanceStatus = "idle", subjectBox = null }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const guidanceCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const intervalRef = useRef(null);
  const guidanceIntervalRef = useRef(null);
  const facingModeRef = useRef("environment");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [facingMode, setFacingMode] = useState("environment");

  const guideColor = (() => {
    if (guidanceStatus === "too_dark" || guidanceStatus === "too_bright") return "#FFD600";
    if (guidanceStatus === "ready") return "#44CC77";
    if (["no_clothing", "off_center", "too_far", "too_close"].includes(guidanceStatus)) return "#FF5555";
    if (guidanceStatus === "busy_background") return "#FFD600";
    return "#888888";
  })();

  const guideText = (() => {
    switch (guidanceStatus) {
      case "too_dark":    return "Too dark — find brighter light";
      case "too_bright":  return "Too bright — avoid direct light";
      case "no_clothing": return "Point camera at clothing";
      case "too_far":     return "Move closer";
      case "too_close":   return "Move back";
      case "off_center":  return "Centre the clothing";
      case "busy_background": return "Use a plain background";
      case "ready":       return "Hold steady…";
      default:            return "Hold clothing here";
    }
  })();

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
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (guidanceIntervalRef.current) clearInterval(guidanceIntervalRef.current);
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

  const handleCapture = useCallback(() => {
    const dataUrl = captureFrame();
    if (dataUrl && onCapture) {
      const base64 = dataUrl.split(",")[1];
      onCapture(base64, dataUrl);
    }
  }, [captureFrame, onCapture]);

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

    const bgVariance = borderPixels.reduce((sum, [r, g, b]) => {
      return sum + Math.abs(r - background.r) + Math.abs(g - background.g) + Math.abs(b - background.b);
    }, 0) / (borderPixels.length * 3);

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
      backgroundVariance: bgVariance,
    };
  }, []);

  const sampleGuidanceFrame = useCallback(() => {
    if (!videoRef.current || !guidanceCanvasRef.current || !ready) return;
    const video = videoRef.current;
    const gc = guidanceCanvasRef.current;
    gc.width  = Math.floor(video.videoWidth  / 2);
    gc.height = Math.floor(video.videoHeight / 2);
    const ctx = gc.getContext("2d");
    ctx.drawImage(video, 0, 0, gc.width, gc.height);
    const data = ctx.getImageData(0, 0, gc.width, gc.height).data;
    let total = 0, count = 0;
    for (let i = 0; i < data.length; i += 16) {
      total += (data[i] + data[i + 1] + data[i + 2]) / 3;
      count++;
    }
    const brightness = count > 0 ? total / count : 128;
    const base64 = gc.toDataURL("image/jpeg", 0.4).split(",")[1];
    const subjectBox = estimateSubjectBox(data, gc.width, gc.height);
    if (onGuidanceSample) {
      onGuidanceSample(base64, brightness, video.videoWidth, video.videoHeight, { subjectBox });
    }
  }, [ready, onGuidanceSample, estimateSubjectBox]);

  useEffect(() => {
    startCamera();
    return stopCamera;
  }, [startCamera, stopCamera]);

  useEffect(() => {
    if (autoCapture && ready) {
      intervalRef.current = setInterval(handleCapture, captureInterval);
      return () => clearInterval(intervalRef.current);
    }
  }, [autoCapture, ready, handleCapture, captureInterval]);

  useEffect(() => {
    if (guidanceMode && ready) {
      guidanceIntervalRef.current = setInterval(sampleGuidanceFrame, 3000);
      return () => clearInterval(guidanceIntervalRef.current);
    }
  }, [guidanceMode, ready, sampleGuidanceFrame]);

  useEffect(() => {
    if (captureRef) captureRef.current = handleCapture;
  }, [captureRef, handleCapture]);

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

      {/* Guide frame overlay — visual aid for positioning clothing */}
      {guidanceMode && (
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>

          {/* Target zone border */}
          <div style={{
            position: "absolute",
            top: "10%", left: "15%", width: "70%", height: "80%",
            border: `3px solid ${guideColor}`,
            borderRadius: 16,
            boxSizing: "border-box",
            transition: "border-color 0.4s ease",
            boxShadow: guidanceStatus === "ready" ? `0 0 0 4px ${guideColor}44` : "none",
          }} />

          {/* Status label */}
          <div style={{
            position: "absolute",
            top: "calc(10% - 30px)",
            left: "15%", width: "70%",
            textAlign: "center",
            fontFamily: FONT, fontSize: 13, fontWeight: 700,
            color: guideColor,
            textShadow: "0 1px 4px rgba(0,0,0,0.9)",
            letterSpacing: "0.05em",
            transition: "color 0.4s ease",
          }}>
            {guideText}
          </div>

          {/* Directional arrows */}
          {guidanceStatus === "too_far" && (
            <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", fontSize: 48, color: "#FF5555", textShadow: "0 2px 8px rgba(0,0,0,0.8)" }}>↕</div>
          )}
          {guidanceStatus === "too_close" && (
            <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", fontSize: 48, color: "#FF5555", textShadow: "0 2px 8px rgba(0,0,0,0.8)" }}>↔</div>
          )}
          {guidanceStatus === "off_center" && subjectBox && (() => {
            const cx = (subjectBox.x1 + subjectBox.x2) / 2;
            const cy = (subjectBox.y1 + subjectBox.y2) / 2;
            const dx = cx - 0.5;
            const dy = cy - 0.5;
            const arrow = Math.abs(dx) > Math.abs(dy)
              ? (dx < 0 ? "→" : "←")
              : (dy < 0 ? "↓" : "↑");
            return (
              <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", fontSize: 56, color: "#FF5555", textShadow: "0 2px 8px rgba(0,0,0,0.8)" }}>{arrow}</div>
            );
          })()}

          {/* Green ready pulse */}
          {guidanceStatus === "ready" && (
            <div style={{
              position: "absolute",
              top: "10%", left: "15%", width: "70%", height: "80%",
              borderRadius: 16,
              background: "rgba(68,204,119,0.08)",
              animation: "pulse 1s ease-in-out infinite",
            }} />
          )}
          <style>{`@keyframes pulse { 0%,100% { opacity:0.4 } 50% { opacity:1 } }`}</style>
        </div>
      )}

      {/* Flip camera button — always visible when camera is ready */}
      <div style={{
        position: "absolute", top: 20, right: 20,
      }}>
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

      {(!autoCapture || guidanceMode) && (
        <div style={{
          position: "absolute", bottom: 40, left: 0, right: 0,
          display: "flex", justifyContent: "center",
        }}>
          <button
            onClick={handleCapture}
            disabled={!ready}
            aria-label={guidanceMode ? "Capture photo. Tap to scan now, or wait for auto-capture." : "Capture photo. Tap to scan clothing."}
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
      )}

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

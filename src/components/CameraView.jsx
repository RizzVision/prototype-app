import { useRef, useEffect, useState, useCallback } from "react";
import { C, FONT } from "../utils/constants";

export default function CameraView({ onCapture, onError, autoCapture = false, captureInterval = 4000 }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const intervalRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 960 } },
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
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setReady(false);
  }, []);

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

      {!autoCapture && (
        <div style={{
          position: "absolute", bottom: 40, left: 0, right: 0,
          display: "flex", justifyContent: "center",
        }}>
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

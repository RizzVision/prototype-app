import { useRef, useEffect, useState, useCallback } from "react";
import { C, FONT } from "../utils/constants";
import { RESPONSES } from "../voice/voiceResponses";

// Clothing-related COCO-SSD classes and person (who is wearing clothes)
const CLOTHING_CLASSES = new Set([
  "person", "tie", "handbag", "backpack", "suitcase", "umbrella",
]);

// Lazy-load COCO-SSD model once across all instances
let cocoModel = null;
let cocoLoading = false;
let cocoCallbacks = [];

async function getCocoModel() {
  if (cocoModel) return cocoModel;
  if (cocoLoading) {
    return new Promise((resolve) => cocoCallbacks.push(resolve));
  }
  cocoLoading = true;
  try {
    const cocoSsd = await import("@tensorflow-models/coco-ssd");
    await import("@tensorflow/tfjs");
    const model = await cocoSsd.load({ base: "lite_mobilenet_v2" });
    cocoModel = model;
    cocoCallbacks.forEach((cb) => cb(model));
    cocoCallbacks = [];
    return model;
  } catch {
    cocoLoading = false;
    return null;
  }
}

function buildDescription(predictions, videoWidth, videoHeight) {
  if (!predictions || predictions.length === 0) {
    return RESPONSES.whatsInFocus.noClothing;
  }

  // Filter to confident detections
  const confident = predictions.filter((p) => p.score >= 0.4);
  if (confident.length === 0) return RESPONSES.whatsInFocus.noClothing;

  // Check if there's a person (someone wearing clothes) or clothing accessory
  const clothingDetections = confident.filter((p) => CLOTHING_CLASSES.has(p.class));
  const allClasses = confident.map((p) => p.class);

  if (clothingDetections.length === 0) {
    // Describe what IS visible if it's not clothing-related
    const topClass = confident[0].class;
    return `I can see ${topClass === "cell phone" ? "a phone" : `a ${topClass}`} in the frame. Please point the camera at clothing you want to scan.`;
  }

  // Find the best clothing/person detection
  const best = clothingDetections.reduce((a, b) => (a.score > b.score ? a : b));
  const [x, y, w, h] = best.bbox;
  const area = (w * h) / (videoWidth * videoHeight);
  const cx = (x + w / 2) / videoWidth;
  const cy = (y + h / 2) / videoHeight;

  // Framing feedback
  if (area < 0.05) return RESPONSES.whatsInFocus.tooSmall;
  if (area > 0.88) return RESPONSES.whatsInFocus.tooLarge;

  // Position guidance
  let position = "";
  if (cx < 0.35) position = "Move camera slightly right. ";
  else if (cx > 0.65) position = "Move camera slightly left. ";
  if (cy < 0.3) position += "Move camera slightly down. ";
  else if (cy > 0.7) position += "Move camera slightly up. ";

  // Count non-person items visible
  const otherItems = allClasses.filter((c) => c !== "person");

  let description = "";
  if (best.class === "person") {
    if (otherItems.length > 0) {
      description = `Person wearing clothing detected. Also visible: ${otherItems.join(", ")}. `;
    } else {
      description = "Person wearing clothing is in frame. ";
    }
  } else {
    description = `${best.class} detected in frame. `;
  }

  if (position) {
    description += position;
  } else {
    description += RESPONSES.whatsInFocus.ready;
  }

  return description.trim();
}

export default function CameraView({ onCapture, onError, captureRef, onDescribe, autoCapture = false, captureInterval = 6000 }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const guidanceCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const facingModeRef = useRef("environment");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [facingMode, setFacingMode] = useState("environment");
  const [modelReady, setModelReady] = useState(false);

  // Preload model as soon as component mounts
  useEffect(() => {
    getCocoModel().then((m) => {
      if (m) setModelReady(true);
    });
  }, []);

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

  const describeWhatsFocused = useCallback(async () => {
    if (!ready || !videoRef.current) return;

    // Fall back to pixel contrast if model not ready yet
    if (!modelReady || !cocoModel) {
      if (onDescribe) onDescribe("Still loading detection model. Please wait a moment.");
      return;
    }

    try {
      const video = videoRef.current;
      const predictions = await cocoModel.detect(video);
      const description = buildDescription(predictions, video.videoWidth, video.videoHeight);
      if (description === RESPONSES.whatsInFocus.ready) playReadyChime();
      if (onDescribe) onDescribe(description);
    } catch {
      if (onDescribe) onDescribe("Could not analyze the frame. Try again.");
    }
  }, [ready, modelReady, onDescribe]);

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

      {/* Model loading indicator */}
      {!modelReady && ready && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute", top: 12, left: 12,
            background: "rgba(0,0,0,0.7)", borderRadius: 10, padding: "5px 12px",
          }}
        >
          <span style={{ fontFamily: FONT, fontSize: 12, color: C.muted }}>Loading detection…</span>
        </div>
      )}

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

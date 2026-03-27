import { useState, useEffect, useCallback, useRef } from "react";
import Screen from "../components/Screen";
import BigButton from "../components/BigButton";
import CameraView from "../components/CameraView";
import { useApp } from "../contexts/AppContext";
import { useVoice } from "../contexts/VoiceContext";
import { useWardrobe } from "../contexts/WardrobeContext";
import { detectClothing } from "../services/clothingDetection";
import { detectWithYolo } from "../services/yoloApi";
import { uploadClothingImage } from "../utils/storage";
import { SCREENS, C, FONT } from "../utils/constants";
import { RESPONSES } from "../voice/voiceResponses";

export default function ScanScreen() {
  const { navigate } = useApp();
  const { speak } = useVoice();
  const { addItem } = useWardrobe();
  const [phase, setPhase] = useState("camera"); // camera | loading | result | saving
  const [result, setResult] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const capturedBase64Ref = useRef(null);
  const canvasRef = useRef(null);

  // Guidance mode state
  const [guidanceMode, setGuidanceMode] = useState(true);
  const [guidanceReady, setGuidanceReady] = useState(false);
  const captureRef = useRef(null);
  const countdownTimerRef = useRef(null);
  const guidanceActiveRef = useRef(true);
  const yoloGuidanceBusyRef = useRef(false);
  const yoloUnavailableRef = useRef(false);
  const lastSpokenRef = useRef({ msg: "", ts: 0 });
  const DEBOUNCE_MS = 8000;

  useEffect(() => {
    if (phase === "camera") {
      speak(guidanceMode
        ? "Camera ready. Hold it still, I will guide you into position."
        : RESPONSES.scanReady);
    }
  }, [phase, speak, guidanceMode]);

  // Guidance: debounced speak
  const speakGuidance = useCallback((msg) => {
    const now = Date.now();
    if (msg === lastSpokenRef.current.msg && now - lastSpokenRef.current.ts < DEBOUNCE_MS) return;
    lastSpokenRef.current = { msg, ts: now };
    speak(msg);
  }, [speak]);

  // Guidance: cancel auto-capture countdown
  const cancelCountdown = useCallback(() => {
    if (countdownTimerRef.current) { clearTimeout(countdownTimerRef.current); countdownTimerRef.current = null; }
    setGuidanceReady(false);
  }, []);

  // Guidance: trigger capture programmatically
  const triggerCapture = useCallback(() => {
    if (!guidanceActiveRef.current) return;
    guidanceActiveRef.current = false;
    cancelCountdown();
    setGuidanceMode(false);
    if (captureRef.current) captureRef.current();
  }, [cancelCountdown]);

  // Guidance: 3-second countdown then auto-capture
  const startCountdown = useCallback(() => {
    speak(RESPONSES.guidance.goodPosition);
    if (countdownTimerRef.current) clearTimeout(countdownTimerRef.current);
    countdownTimerRef.current = setTimeout(() => {
      if (!guidanceActiveRef.current) return;
      speak(RESPONSES.guidance.countdown2);
      countdownTimerRef.current = setTimeout(() => {
        if (!guidanceActiveRef.current) return;
        speak(RESPONSES.guidance.countdown1);
        countdownTimerRef.current = setTimeout(() => {
          if (!guidanceActiveRef.current) return;
          triggerCapture();
        }, 1000);
      }, 1000);
    }, 1000);
  }, [speak, triggerCapture]);

  // Guidance: process each sampled frame
  const handleGuidanceSample = useCallback(async (base64, brightness, videoW, videoH) => {
    if (!guidanceActiveRef.current) return;
    if (yoloGuidanceBusyRef.current) return;

    // Tier 1: brightness (instant, client-side)
    if (brightness < 40)  { speakGuidance(RESPONSES.guidance.tooDark);  cancelCountdown(); return; }
    if (brightness > 220) { speakGuidance(RESPONSES.guidance.tooBright); cancelCountdown(); return; }

    // Tier 2: spatial framing via YOLO
    if (yoloUnavailableRef.current) {
      speakGuidance(RESPONSES.guidance.backendOnly);
      return;
    }
    yoloGuidanceBusyRef.current = true;
    let detections = null;
    try {
      detections = await Promise.race([
        detectWithYolo(base64),
        new Promise((_, reject) => setTimeout(() => reject(new Error("GUIDANCE_TIMEOUT")), 3000)),
      ]);
    } catch {
      yoloGuidanceBusyRef.current = false;
      if (!guidanceActiveRef.current) return;
      yoloUnavailableRef.current = true;
      speakGuidance(RESPONSES.guidance.backendOnly);
      return;
    }
    yoloGuidanceBusyRef.current = false;
    if (!guidanceActiveRef.current) return;

    if (!detections || detections.length === 0) {
      cancelCountdown();
      speakGuidance(RESPONSES.guidance.noClothing);
      return;
    }

    const best = detections.reduce((a, b) => b.confidence > a.confidence ? b : a);
    const [x1, y1, x2, y2] = best.box;
    const areaRatio = ((x2 - x1) * (y2 - y1)) / (videoW * videoH);
    const centerX = (x1 + x2) / 2 / videoW;
    const centerY = (y1 + y2) / 2 / videoH;
    const offsetX = centerX - 0.5;
    const offsetY = centerY - 0.5;

    if (areaRatio < 0.15) { cancelCountdown(); speakGuidance(RESPONSES.guidance.tooFar);   return; }
    if (areaRatio > 0.80) { cancelCountdown(); speakGuidance(RESPONSES.guidance.tooClose);  return; }
    if (Math.abs(offsetX) > 0.2) {
      cancelCountdown();
      speakGuidance(offsetX > 0 ? RESPONSES.guidance.moveLeft : RESPONSES.guidance.moveRight);
      return;
    }
    if (Math.abs(offsetY) > 0.2) {
      cancelCountdown();
      speakGuidance(offsetY > 0 ? RESPONSES.guidance.moveUp : RESPONSES.guidance.moveDown);
      return;
    }

    // All checks passed — start countdown if not already running
    if (!guidanceReady) {
      setGuidanceReady(true);
      startCountdown();
    }
  }, [speakGuidance, guidanceReady, cancelCountdown, startCountdown]);

  // Unmount cleanup
  useEffect(() => {
    return () => {
      guidanceActiveRef.current = false;
      if (countdownTimerRef.current) clearTimeout(countdownTimerRef.current);
    };
  }, []);

  // Draw image + bounding box onto canvas when result arrives
  useEffect(() => {
    if (!canvasRef.current || !previewUrl || !result) return;
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);

      if (result.bbox) {
        const { x1, y1, x2, y2 } = result.bbox;
        const lw = Math.max(4, canvas.width * 0.006);

        // Bounding box
        ctx.strokeStyle = "#FFD600";
        ctx.lineWidth = lw;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

        // Label badge above box
        const label = result.name;
        const fontSize = Math.max(24, Math.round(canvas.width * 0.04));
        ctx.font = `bold ${fontSize}px sans-serif`;
        const padX = 16, padY = 10;
        const textW = ctx.measureText(label).width;
        const badgeY = Math.max(0, y1 - fontSize - padY * 2 - lw);
        ctx.fillStyle = "#FFD600";
        ctx.fillRect(x1, badgeY, textW + padX * 2, fontSize + padY * 2);
        ctx.fillStyle = "#000";
        ctx.fillText(label, x1 + padX, badgeY + fontSize + padY * 0.6);
      }
    };
    img.src = previewUrl;
  }, [result, previewUrl]);

  const handleCapture = useCallback(async (base64, dataUrl) => {
    guidanceActiveRef.current = false;
    cancelCountdown();
    setGuidanceMode(false);
    setPhase("loading");
    setPreviewUrl(dataUrl);
    capturedBase64Ref.current = base64;
    speak(RESPONSES.scanning);

    try {
      const detected = await detectClothing(base64);
      setResult(detected);
      setPhase("result");
      speak(RESPONSES.scanComplete(detected.description));
    } catch (err) {
      if (err.message === "NO_DETECTION") {
        speak(RESPONSES.noDetection);
      } else if (err.message === "AUTH_REQUIRED") {
        speak(RESPONSES.authRequired);
      } else if (err.message === "BACKEND_UNAVAILABLE") {
        speak(RESPONSES.backendUnavailable);
      } else {
        speak(RESPONSES.error);
      }
      setPhase("camera");
    }
  }, [speak, cancelCountdown]);

  const handleSave = useCallback(async () => {
    if (!result) return;
    setPhase("saving");

    let imageUrl = null;
    try {
      if (capturedBase64Ref.current) {
        imageUrl = await uploadClothingImage(capturedBase64Ref.current);
      }
    } catch (err) {
      console.warn("Image upload failed, saving without image:", err);
    }

    try {
      await addItem({
        name: result.name,
        type: result.type,
        category: result.category,
        color: result.color,
        colorDescription: result.colorDescription,
        pattern: result.pattern,
        gender: result.gender,
        description: result.description,
        imageUrl,
      });
      speak(RESPONSES.saved(result.name));
      setTimeout(() => navigate(SCREENS.WARDROBE), 1500);
    } catch (err) {
      console.error("Failed to save item:", err);
      speak(RESPONSES.error);
      setPhase("result");
    }
  }, [result, addItem, speak, navigate]);

  const handleDiscard = useCallback(() => {
    speak(RESPONSES.discarded);
    setResult(null);
    setPreviewUrl(null);
    // Re-enable guidance for the next scan attempt
    guidanceActiveRef.current = true;
    yoloGuidanceBusyRef.current = false;
    yoloUnavailableRef.current = false;
    lastSpokenRef.current = { msg: "", ts: 0 };
    setGuidanceMode(true);
    setGuidanceReady(false);
    setPhase("camera");
  }, [speak]);

  const handleOutfitHelp = useCallback(async () => {
    if (!result) return;

    let imageUrl = null;
    try {
      if (capturedBase64Ref.current) {
        imageUrl = await uploadClothingImage(capturedBase64Ref.current);
      }
    } catch {
      // Non-blocking
    }

    try {
      await addItem({
        name: result.name,
        type: result.type,
        category: result.category,
        color: result.color,
        colorDescription: result.colorDescription,
        pattern: result.pattern,
        gender: result.gender,
        description: result.description,
        imageUrl,
      });
      navigate(SCREENS.OUTFIT, { anchorItem: result });
    } catch (err) {
      console.error("Failed to save item:", err);
      speak(RESPONSES.error);
    }
  }, [result, addItem, navigate, speak]);

  if (phase === "camera") {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <CameraView
          onCapture={handleCapture}
          onError={(msg) => speak(msg)}
          guidanceMode={guidanceMode}
          onGuidanceSample={handleGuidanceSample}
          captureRef={captureRef}
        />
      </div>
    );
  }

  if (phase === "loading" || phase === "saving") {
    const title = phase === "saving" ? "Saving..." : "Scanning...";
    const subtitle = phase === "saving" ? "Saving to your wardrobe." : "Analyzing your clothing item.";
    return (
      <Screen title={title} subtitle={subtitle}>
        {previewUrl && (
          <img
            src={previewUrl}
            alt="Captured clothing"
            style={{ width: "100%", borderRadius: 16, marginBottom: 20, maxHeight: 300, objectFit: "cover" }}
          />
        )}
        <div
          role="status"
          aria-label={phase === "saving" ? "Saving to your wardrobe" : "Scanning clothing item"}
          style={{ display: "flex", justifyContent: "center", padding: 40 }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 48, height: 48, borderRadius: "50%",
              border: `4px solid ${C.focus}`,
              borderTopColor: "transparent",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </Screen>
    );
  }

  // Result phase
  return (
    <Screen title={result?.name || "Scan Result"} subtitle="Here is what I found.">
      <canvas
        ref={canvasRef}
        aria-label={`Detected clothing: ${result?.name}`}
        style={{ width: "100%", borderRadius: 16, marginBottom: 20, maxHeight: 300, display: "block" }}
      />

      <div style={{
        background: C.surface, borderRadius: 16, padding: 20,
        border: `1px solid ${C.border}`, marginBottom: 20,
      }}>
        <div style={{ fontFamily: FONT, fontSize: 17, color: C.text, lineHeight: 1.7 }}>
          {result?.description}
        </div>
        <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {[result?.type, result?.gender].filter(Boolean).map((tag, i) => (
            <span key={i} style={{
              background: C.border, borderRadius: 10, padding: "4px 12px",
              fontFamily: FONT, fontSize: 13, color: C.muted,
            }}>{tag}</span>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <BigButton
          label="Save to Wardrobe"
          hint="Add this item to your wardrobe"
          icon="✓"
          variant="success"
          onClick={handleSave}
        />
        <BigButton
          label="What Goes With This?"
          hint="Get outfit recommendations for this item"
          icon="👔"
          variant="primary"
          onClick={handleOutfitHelp}
        />
        <BigButton
          label="Scan Again"
          hint="Discard and scan another item"
          icon="📸"
          onClick={handleDiscard}
        />
      </div>
    </Screen>
  );
}

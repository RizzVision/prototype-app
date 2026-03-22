import { useState, useEffect, useCallback, useRef } from "react";
import Screen from "../components/Screen";
import BigButton from "../components/BigButton";
import CameraView from "../components/CameraView";
import { useApp } from "../contexts/AppContext";
import { useVoice } from "../contexts/VoiceContext";
import { useWardrobe } from "../contexts/WardrobeContext";
import { detectClothing } from "../services/clothingDetection";
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

  useEffect(() => {
    if (phase === "camera") {
      speak(RESPONSES.scanReady);
    }
  }, [phase, speak]);

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
  }, [speak]);

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
        <CameraView onCapture={handleCapture} onError={(msg) => speak(msg)} />
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
        <div style={{
          display: "flex", justifyContent: "center", padding: 40,
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: "50%",
            border: `4px solid ${C.focus}`,
            borderTopColor: "transparent",
            animation: "spin 0.8s linear infinite",
          }} />
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

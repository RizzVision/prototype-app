import { useState, useEffect, useCallback } from "react";
import Screen from "../components/Screen";
import BigButton from "../components/BigButton";
import CameraView from "../components/CameraView";
import { useApp } from "../contexts/AppContext";
import { useVoice } from "../contexts/VoiceContext";
import { useWardrobe } from "../contexts/WardrobeContext";
import { detectClothing } from "../services/clothingDetection";
import { SCREENS, C, FONT } from "../utils/constants";
import { RESPONSES } from "../voice/voiceResponses";

export default function ScanScreen() {
  const { navigate } = useApp();
  const { speak } = useVoice();
  const { addItem } = useWardrobe();
  const [phase, setPhase] = useState("camera"); // camera | loading | result
  const [result, setResult] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);

  useEffect(() => {
    if (phase === "camera") {
      speak(RESPONSES.scanReady);
    }
  }, [phase, speak]);

  const handleCapture = useCallback(async (base64, dataUrl) => {
    setPhase("loading");
    setPreviewUrl(dataUrl);
    speak(RESPONSES.scanning);

    try {
      const detected = await detectClothing(base64);
      setResult(detected);
      setPhase("result");
      speak(RESPONSES.scanComplete(detected.description));
    } catch (err) {
      speak(RESPONSES.error);
      setPhase("camera");
    }
  }, [speak]);

  const handleSave = useCallback(() => {
    if (!result) return;
    addItem({
      name: result.name,
      type: result.type,
      category: result.category,
      color: result.color,
      colorDescription: result.colorDescription,
      pattern: result.pattern,
      gender: result.gender,
      description: result.description,
    });
    speak(RESPONSES.saved(result.name));
    setTimeout(() => navigate(SCREENS.WARDROBE), 1500);
  }, [result, addItem, speak, navigate]);

  const handleDiscard = useCallback(() => {
    speak(RESPONSES.discarded);
    setResult(null);
    setPreviewUrl(null);
    setPhase("camera");
  }, [speak]);

  const handleOutfitHelp = useCallback(() => {
    if (!result) return;
    addItem({
      name: result.name,
      type: result.type,
      category: result.category,
      color: result.color,
      colorDescription: result.colorDescription,
      pattern: result.pattern,
      gender: result.gender,
      description: result.description,
    });
    navigate(SCREENS.OUTFIT, { anchorItem: result });
  }, [result, addItem, navigate]);

  if (phase === "camera") {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <CameraView onCapture={handleCapture} onError={(msg) => speak(msg)} />
      </div>
    );
  }

  if (phase === "loading") {
    return (
      <Screen title="Scanning..." subtitle="Analyzing your clothing item.">
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
      {previewUrl && (
        <img
          src={previewUrl}
          alt="Captured clothing"
          style={{ width: "100%", borderRadius: 16, marginBottom: 20, maxHeight: 300, objectFit: "cover" }}
        />
      )}

      <div style={{
        background: C.surface, borderRadius: 16, padding: 20,
        border: `1px solid ${C.border}`, marginBottom: 20,
      }}>
        <div style={{ fontFamily: FONT, fontSize: 17, color: C.text, lineHeight: 1.7 }}>
          {result?.description}
        </div>
        <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {[result?.color, result?.pattern, result?.type, result?.gender].filter(Boolean).map((tag, i) => (
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

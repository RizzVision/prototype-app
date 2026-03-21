import { useState, useCallback, useEffect } from "react";
import Screen from "../components/Screen";
import BigButton from "../components/BigButton";
import CameraView from "../components/CameraView";
import { useVoice } from "../contexts/VoiceContext";
import { getMirrorAssessment } from "../services/outfitRecommendation";
import { C, FONT } from "../utils/constants";
import { RESPONSES } from "../voice/voiceResponses";

export default function MirrorScreen() {
  const { speak } = useVoice();
  const [phase, setPhase] = useState("camera"); // camera | loading | result
  const [assessment, setAssessment] = useState("");
  const [previewUrl, setPreviewUrl] = useState(null);

  useEffect(() => {
    speak(RESPONSES.mirrorReady);
  }, [speak]);

  const handleCapture = useCallback(async (base64, dataUrl) => {
    setPhase("loading");
    setPreviewUrl(dataUrl);
    speak(RESPONSES.mirrorAnalyzing);

    try {
      const result = await getMirrorAssessment(base64);
      setAssessment(result);
      setPhase("result");
      speak(result);
    } catch {
      speak(RESPONSES.error);
      setPhase("camera");
    }
  }, [speak]);

  const reset = useCallback(() => {
    setPhase("camera");
    setAssessment("");
    setPreviewUrl(null);
    speak(RESPONSES.mirrorReady);
  }, [speak]);

  if (phase === "camera") {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <CameraView onCapture={handleCapture} onError={(msg) => speak(msg)} />
      </div>
    );
  }

  if (phase === "loading") {
    return (
      <Screen title="Analyzing..." subtitle="Looking at your outfit.">
        {previewUrl && (
          <img
            src={previewUrl}
            alt="Your outfit"
            style={{ width: "100%", borderRadius: 16, marginBottom: 20, maxHeight: 300, objectFit: "cover" }}
          />
        )}
        <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
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
    <Screen title="Auditory Mirror" subtitle="Here is my honest assessment.">
      {previewUrl && (
        <img
          src={previewUrl}
          alt="Your outfit"
          style={{ width: "100%", borderRadius: 16, marginBottom: 20, maxHeight: 300, objectFit: "cover" }}
        />
      )}

      <div style={{
        background: C.surface, borderRadius: 16, padding: 20,
        border: `1px solid ${C.border}`, marginBottom: 20,
      }}>
        <p style={{
          fontFamily: FONT, fontSize: 17, color: C.text, lineHeight: 1.8,
          margin: 0, whiteSpace: "pre-wrap",
        }}>{assessment}</p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <BigButton
          label="Read Again"
          hint="Hear the assessment again"
          icon="🔊"
          onClick={() => speak(assessment)}
        />
        <BigButton
          label="Try Again"
          hint="Take another photo"
          icon="📸"
          variant="primary"
          onClick={reset}
        />
      </div>
    </Screen>
  );
}

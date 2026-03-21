import { useState, useCallback, useEffect } from "react";
import Screen from "../components/Screen";
import BigButton from "../components/BigButton";
import CameraView from "../components/CameraView";
import { useVoice } from "../contexts/VoiceContext";
import { useWardrobe } from "../contexts/WardrobeContext";
import { getShoppingFeedback } from "../services/outfitRecommendation";
import { C, FONT } from "../utils/constants";
import { RESPONSES } from "../voice/voiceResponses";

export default function ShoppingScreen() {
  const { speak } = useVoice();
  const { items } = useWardrobe();
  const [scanning, setScanning] = useState(true);
  const [feedback, setFeedback] = useState("");
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    speak(RESPONSES.shoppingStart);
  }, [speak]);

  const handleCapture = useCallback(async (base64) => {
    if (processing) return;
    setProcessing(true);

    try {
      const result = await getShoppingFeedback(base64, items);
      setFeedback(result);
      speak(result);
    } catch {
      // Silently skip failed captures in continuous mode
    } finally {
      setProcessing(false);
    }
  }, [items, speak, processing]);

  const toggleScanning = useCallback(() => {
    if (scanning) {
      setScanning(false);
      speak(RESPONSES.shoppingPaused);
    } else {
      setScanning(true);
      speak(RESPONSES.shoppingResumed);
    }
  }, [scanning, speak]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Camera area — top half */}
      <div style={{ flex: 1, position: "relative", minHeight: "40vh" }}>
        {scanning ? (
          <CameraView
            onCapture={handleCapture}
            autoCapture={true}
            captureInterval={5000}
          />
        ) : (
          <div style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            background: "#000", height: "100%",
          }}>
            <p style={{ fontFamily: FONT, fontSize: 20, color: C.muted }}>Paused</p>
          </div>
        )}

        {/* Processing indicator */}
        {processing && (
          <div style={{
            position: "absolute", top: 12, left: 12,
            background: "rgba(0,0,0,0.7)", borderRadius: 12, padding: "6px 14px",
          }}>
            <span style={{ fontFamily: FONT, fontSize: 13, color: C.focus }}>Analyzing...</span>
          </div>
        )}
      </div>

      {/* Feedback area — bottom half */}
      <div style={{
        padding: 20, background: C.bg,
        borderTop: `2px solid ${C.border}`,
        maxHeight: "50vh", overflowY: "auto",
      }}>
        <div style={{
          fontFamily: FONT, fontSize: 12, color: C.focus,
          letterSpacing: "0.3em", textTransform: "uppercase", marginBottom: 8,
        }}>SHOPPING MODE</div>

        {feedback ? (
          <div style={{
            background: C.surface, borderRadius: 14, padding: 16,
            border: `1px solid ${C.border}`, marginBottom: 16,
          }}>
            <p style={{ fontFamily: FONT, fontSize: 17, color: C.text, lineHeight: 1.7, margin: 0 }}>
              {feedback}
            </p>
          </div>
        ) : (
          <p style={{ fontFamily: FONT, fontSize: 17, color: C.muted, lineHeight: 1.7, marginBottom: 16 }}>
            Point your camera at clothing items for real-time feedback.
          </p>
        )}

        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <BigButton
              label={scanning ? "Pause" : "Resume"}
              icon={scanning ? "⏸" : "▶"}
              variant={scanning ? "danger" : "success"}
              onClick={toggleScanning}
            />
          </div>
          <div style={{ flex: 1 }}>
            <BigButton
              label="Read Again"
              icon="🔊"
              onClick={() => feedback && speak(feedback)}
              disabled={!feedback}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * ShoppingScreen — Continuous outfit scanning while shopping.
 *
 * Auto-captures every 6 s and sends each frame to the RizzVision backend.
 * Speaks a concise 2-segment summary so the user can make fast purchase decisions.
 *
 * Accessibility:
 *  - Results announced via ARIA live region and spoken immediately.
 *  - Image quality errors (too dark, blurry) are announced assertively.
 *  - Pause / Resume buttons have descriptive aria-labels.
 *  - "Read Again" replays the last analysis.
 */

import { useState, useCallback, useEffect } from "react";
import Screen from "../components/Screen";
import BigButton from "../components/BigButton";
import CameraView from "../components/CameraView";
import { useAnnounce } from "../components/LiveRegions";
import { useVoice } from "../contexts/VoiceContext";
import { analyzeOutfit, ImageQualityError } from "../services/rizzVisionApi";
import { C, FONT } from "../utils/constants";
import { RESPONSES } from "../voice/voiceResponses";

function scoreColor(score) {
  if (score >= 0.65) return C.success;
  if (score >= 0.45) return C.focus;
  return C.danger;
}

export default function ShoppingScreen() {
  const { speak } = useVoice();
  const { announce, LiveRegions } = useAnnounce();

  const [scanning, setScanning] = useState(true);
  const [result, setResult] = useState(null);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    speak(RESPONSES.shoppingStart);
    announce(RESPONSES.shoppingStart, "polite");
  }, [speak, announce]);

  useEffect(() => {
    const handler = (e) => {
      const cmd = e.detail;
      if (cmd.type === "PAUSE_SCAN" && scanning) toggleScanning();
      else if (cmd.type === "RESUME_SCAN" && !scanning) toggleScanning();
      else if (cmd.type === "READ_RESULT") speakLastResult();
    };
    window.addEventListener("voiceCommand", handler);
    return () => window.removeEventListener("voiceCommand", handler);
  }, [scanning, toggleScanning, speakLastResult]);

  const handleCapture = useCallback(async (base64) => {
    if (processing) return;
    setProcessing(true);

    try {
      const analysis = await analyzeOutfit(base64);
      setResult(analysis);

      // Speak a concise 2-segment summary for fast in-store decisions
      const segments = analysis.speech_segments ?? [];
      const summary = segments.length
        ? segments.slice(0, 2).map((s) => s.text).join("  ")
        : `Color score: ${analysis.color_label}. Best for ${analysis.best_occasion}.`;

      announce(summary, "polite");
      speak(summary);
    } catch (err) {
      // Image quality errors — speak them; skip other errors silently in continuous mode
      if (err instanceof ImageQualityError) {
        announce(err.userMessage, "assertive");
        speak(err.userMessage);
      }
    } finally {
      setProcessing(false);
    }
  }, [processing, speak, announce]);

  const toggleScanning = useCallback(() => {
    if (scanning) {
      setScanning(false);
      speak(RESPONSES.shoppingPaused);
      announce(RESPONSES.shoppingPaused, "polite");
    } else {
      setScanning(true);
      speak(RESPONSES.shoppingResumed);
      announce(RESPONSES.shoppingResumed, "polite");
    }
  }, [scanning, speak, announce]);

  const speakLastResult = useCallback(() => {
    if (result?.speech_segments?.length) {
      speak(result.speech_segments.map((s) => s.text).join("  "));
    }
  }, [result, speak]);

  const sc = result ? scoreColor(result.color_score ?? 0) : C.muted;

  return (
    <>
      <LiveRegions />
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>

        {/* Camera — top portion */}
        <div style={{ flex: 1, position: "relative", minHeight: "40vh" }}>
          {scanning ? (
            <CameraView
              onCapture={handleCapture}
              autoCapture={true}
              captureInterval={6000}
              onError={(msg) => { announce(msg, "assertive"); speak(msg); }}
            />
          ) : (
            <div
              role="status"
              aria-label="Scanning paused"
              style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                background: "#000", height: "100%", minHeight: "40vh",
              }}
            >
              <p style={{ fontFamily: FONT, fontSize: 20, color: C.muted }}>Paused</p>
            </div>
          )}

          {/* Processing indicator */}
          {processing && (
            <div
              aria-hidden="true"
              style={{
                position: "absolute", top: 12, left: 12,
                background: "rgba(0,0,0,0.75)", borderRadius: 12, padding: "6px 14px",
              }}
            >
              <span style={{ fontFamily: FONT, fontSize: 13, color: C.focus }}>Analyzing…</span>
            </div>
          )}
        </div>

        {/* Result + controls — bottom portion */}
        <div style={{
          padding: 20, background: C.bg,
          borderTop: `2px solid ${C.border}`,
          maxHeight: "52vh", overflowY: "auto",
        }}>
          <div style={{
            fontFamily: FONT, fontSize: 12, color: C.focus,
            letterSpacing: "0.3em", textTransform: "uppercase", marginBottom: 12,
          }}>
            SHOPPING MODE
          </div>

          {result ? (
            <>
              {/* Score + Occasion mini-cards */}
              <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                <div
                  aria-label={`Color score ${Math.round((result.color_score ?? 0) * 100)} percent, ${result.color_label}`}
                  style={{
                    background: C.surface, borderRadius: 12, padding: "10px 14px",
                    border: `2px solid ${sc}`, textAlign: "center", flex: 1,
                  }}
                >
                  <div style={{ fontFamily: FONT, fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                    Score
                  </div>
                  <div style={{ fontFamily: FONT, fontSize: 22, fontWeight: 700, color: sc }}>
                    {Math.round((result.color_score ?? 0) * 100)}%
                  </div>
                  <div style={{ fontFamily: FONT, fontSize: 12, color: C.muted, textTransform: "capitalize" }}>
                    {result.color_label}
                  </div>
                </div>

                {result.best_occasion && (
                  <div style={{
                    background: C.surface, borderRadius: 12, padding: "10px 14px",
                    border: `1px solid ${C.border}`, flex: 1,
                  }}>
                    <div style={{ fontFamily: FONT, fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                      Occasion
                    </div>
                    <div style={{ fontFamily: FONT, fontSize: 14, fontWeight: 600, color: C.text, lineHeight: 1.3, marginTop: 4 }}>
                      {result.best_occasion}
                    </div>
                  </div>
                )}
              </div>

              {/* First speech segment preview */}
              {result.speech_segments?.[0] && (
                <div style={{
                  background: C.surface, borderRadius: 12, padding: 14,
                  border: `1px solid ${C.border}`, marginBottom: 14,
                }}>
                  <p style={{ fontFamily: FONT, fontSize: 15, color: C.text, lineHeight: 1.7, margin: 0 }}>
                    {result.speech_segments[0].text}
                  </p>
                </div>
              )}
            </>
          ) : (
            <p aria-live="polite" style={{ fontFamily: FONT, fontSize: 17, color: C.muted, lineHeight: 1.7, marginBottom: 14 }}>
              Point at clothing items. I will analyze them every few seconds.
            </p>
          )}

          {/* Controls */}
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <BigButton
                label={scanning ? "Pause" : "Resume"}
                hint={scanning ? "Pause automatic scanning" : "Resume automatic scanning"}
                icon={scanning ? "⏸" : "▶"}
                variant={scanning ? "danger" : "success"}
                onClick={toggleScanning}
              />
            </div>
            <div style={{ flex: 1 }}>
              <BigButton
                label="Read Again"
                hint="Hear the last analysis read aloud"
                icon="🔊"
                disabled={!result}
                onClick={speakLastResult}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

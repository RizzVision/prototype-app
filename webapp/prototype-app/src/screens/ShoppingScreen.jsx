/**
 * ShoppingScreen — Live wardrobe-aware shopping assistant.
 *
 * Captures every 8 s and tells the user:
 *   - What the item is
 *   - Whether it matches anything in their wardrobe (or standalone advice if wardrobe is empty)
 *   - Whether it's worth buying
 *
 * After a result, the user can ask one follow-up question via voice or text input.
 * Adding items to the wardrobe is intentionally disabled in this mode.
 */

import { useState, useCallback, useEffect } from "react";
import Screen from "../components/Screen";
import BigButton from "../components/BigButton";
import CameraView from "../components/CameraView";
import ContextChat from "../components/ContextChat";
import { useAnnounce } from "../components/LiveRegions";
import { useVoice } from "../contexts/VoiceContext";
import { useWardrobe } from "../contexts/WardrobeContext";
import { analyzeForShopping, ImageQualityError } from "../services/rizzVisionApi";
import { C, FONT } from "../utils/constants";
import { RESPONSES } from "../voice/voiceResponses";

export default function ShoppingScreen() {
  const { speak } = useVoice();
  const { announce, LiveRegions } = useAnnounce();
  const { items: wardrobeItems } = useWardrobe();

  const [scanning, setScanning] = useState(true);
  const [result, setResult] = useState(null);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    const msg = RESPONSES.shoppingStart;
    speak(msg);
    announce(msg, "polite");
  }, [speak, announce]);

  const handleCapture = useCallback(async (base64) => {
    if (processing) return;
    setProcessing(true);
    setFollowUpAnswer(null);
    setFollowUpQuestion("");

    try {
      const analysis = await analyzeForShopping(base64, wardrobeItems);
      setResult(analysis);

      const segments = analysis.speech_segments ?? [];
      const summary = segments.map((s) => s.text).join("  ");
      if (summary) {
        announce(summary, "polite");
        speak(summary);
      }
    } catch (err) {
      if (err instanceof ImageQualityError) {
        announce(err.userMessage, "assertive");
        speak(err.userMessage);
      }
    } finally {
      setProcessing(false);
    }
  }, [processing, wardrobeItems, speak, announce]);

  const toggleScanning = useCallback(() => {
    setScanning((prev) => {
      const next = !prev;
      const msg = next ? RESPONSES.shoppingResumed : RESPONSES.shoppingPaused;
      speak(msg);
      announce(msg, "polite");
      return next;
    });
  }, [speak, announce]);

  const speakLastResult = useCallback(() => {
    if (result?.speech_segments?.length) {
      speak(result.speech_segments.map((s) => s.text).join("  "));
    }
  }, [result, speak]);

  // Voice commands
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

  const emptyWardrobe = wardrobeItems.length === 0;

  return (
    <>
      <LiveRegions />
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>

        {/* Camera */}
        <div style={{ flex: 1, position: "relative", minHeight: "40vh" }}>
          {scanning ? (
            <CameraView
              onCapture={handleCapture}
              autoCapture={true}
              captureInterval={8000}
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

          {/* Wardrobe status badge */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute", top: 12, right: 12,
              background: "rgba(0,0,0,0.75)", borderRadius: 12, padding: "6px 14px",
            }}
          >
            <span style={{ fontFamily: FONT, fontSize: 12, color: emptyWardrobe ? C.muted : C.success }}>
              {emptyWardrobe ? "No wardrobe" : `${wardrobeItems.length} items`}
            </span>
          </div>
        </div>

        {/* Results + controls */}
        <div style={{
          padding: 20, background: C.bg,
          borderTop: `2px solid ${C.border}`,
          maxHeight: "58vh", overflowY: "auto",
        }}>
          <div style={{
            fontFamily: FONT, fontSize: 12, color: C.focus,
            letterSpacing: "0.3em", textTransform: "uppercase", marginBottom: 12,
          }}>
            SHOPPING MODE
          </div>

          {/* Empty wardrobe notice */}
          {emptyWardrobe && !result && (
            <div style={{
              background: C.surface, borderRadius: 12, padding: 14,
              border: `1px solid ${C.border}`, marginBottom: 14,
            }}>
              <p style={{ fontFamily: FONT, fontSize: 14, color: C.muted, lineHeight: 1.6, margin: 0 }}>
                Your wardrobe is empty. I will tell you how each item looks on its own and what it would generally pair with.
              </p>
            </div>
          )}

          {result ? (
            <>
              {/* Occasions + Styles */}
              {(result.suitable_occasions?.length > 0 || result.top_archetypes?.length > 0) && (
                <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                  {result.suitable_occasions?.length > 0 && (
                    <div style={{
                      background: C.surface, borderRadius: 12, padding: "10px 14px",
                      border: `1px solid ${C.border}`, flex: 1,
                    }}>
                      <div style={{ fontFamily: FONT, fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>
                        Works for
                      </div>
                      {result.suitable_occasions.map((occ) => (
                        <div key={occ} style={{ fontFamily: FONT, fontSize: 13, color: C.text, lineHeight: 1.5 }}>
                          {occ}
                        </div>
                      ))}
                    </div>
                  )}
                  {result.top_archetypes?.length > 0 && (
                    <div style={{
                      background: C.surface, borderRadius: 12, padding: "10px 14px",
                      border: `1px solid ${C.border}`, flex: 1,
                    }}>
                      <div style={{ fontFamily: FONT, fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>
                        Style
                      </div>
                      {result.top_archetypes.map((arch) => (
                        <div key={arch} style={{ fontFamily: FONT, fontSize: 13, color: C.text, lineHeight: 1.5 }}>
                          {arch}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Speech segments */}
              {result.speech_segments?.map((seg) => (
                <div key={seg.id} style={{
                  background: C.surface, borderRadius: 12, padding: 14,
                  border: `1px solid ${C.border}`, marginBottom: 10,
                }}>
                  <div style={{ fontFamily: FONT, fontSize: 10, color: C.focus, textTransform: "uppercase", letterSpacing: "0.2em", marginBottom: 6 }}>
                    {seg.id === "item" ? "Item" : seg.id === "match" ? (emptyWardrobe ? "Style Advice" : "Wardrobe Match") : "Verdict"}
                  </div>
                  <p style={{ fontFamily: FONT, fontSize: 15, color: C.text, lineHeight: 1.7, margin: 0 }}>
                    {seg.text}
                  </p>
                </div>
              ))}

              {/* Follow-up chatbot — full multi-turn conversation about this item */}
              <ContextChat
                context={result.speech_segments?.map((s) => s.text).join("\n") || ""}
                feature="shopping"
                speak={speak}
                announce={announce}
              />
            </>
          ) : (
            <p aria-live="polite" style={{ fontFamily: FONT, fontSize: 17, color: C.muted, lineHeight: 1.7, marginBottom: 14 }}>
              {emptyWardrobe
                ? "Point at any clothing item. I will tell you how it looks and what it pairs with."
                : "Point at clothing items. I will tell you if they match your wardrobe."}
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

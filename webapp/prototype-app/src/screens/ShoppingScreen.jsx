/**
 * ShoppingScreen — real-time wardrobe-aware shopping assistant.
 *
 * Keeps the camera feed mounted and samples frames for Groq/Llama analysis.
 * There is no manual capture path in this mode.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import CameraView from "../components/CameraView";
import ContextChat from "../components/ContextChat";
import { useAnnounce } from "../components/LiveRegions";
import { useLocale } from "../contexts/LocaleContext";
import { useVoice } from "../contexts/VoiceContext";
import { useWardrobe } from "../contexts/WardrobeContext";
import { analyzeForShopping, ImageQualityError } from "../services/rizzVisionApi";
import { C, FONT } from "../utils/constants";

const LIVE_CAPTURE_INTERVAL_MS = 6500;

export default function ShoppingScreen() {
  const { language } = useLocale();
  const { speak } = useVoice();
  const { announce, LiveRegions } = useAnnounce();
  const { items: wardrobeItems } = useWardrobe();

  const [liveEnabled, setLiveEnabled] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);

  const analyzingRef = useRef(false);
  const lastSpokenKeyRef = useRef("");

  const emptyWardrobe = wardrobeItems.length === 0;

  useEffect(() => {
    const msg = emptyWardrobe
      ? "Live shopping mode active. I will use Llama to describe clothing and give style advice."
      : "Live shopping mode active. I will use Llama to compare clothing with your wardrobe.";
    speak(msg);
    announce(msg, "polite");
  }, [emptyWardrobe, speak, announce]);

  const buildSpeechSummary = useCallback((analysis) => {
    const item = analysis.speech_segments?.find((segment) => segment.id === "item")?.text;
    const match = analysis.speech_segments?.find((segment) => segment.id === "match")?.text;
    const verdict = analysis.speech_segments?.find((segment) => segment.id === "verdict")?.text;
    return [item, match, verdict].filter(Boolean).join("  ");
  }, []);

  const speakAnalysisIfNew = useCallback((analysis) => {
    const summary = buildSpeechSummary(analysis);
    if (!summary) return;

    const key = summary.toLowerCase().replace(/\s+/g, " ").trim();
    announce(summary, "polite");
    if (key !== lastSpokenKeyRef.current) {
      speak(summary);
      lastSpokenKeyRef.current = key;
    }
  }, [announce, buildSpeechSummary, speak]);

  const handleLiveFrame = useCallback(async (base64) => {
    if (!liveEnabled || analyzingRef.current) return;

    analyzingRef.current = true;
    setAnalyzing(true);
    setErrorMsg("");

    try {
      const analysis = await analyzeForShopping(base64, wardrobeItems, language);
      setResult(analysis);
      setDetailsOpen(false);
      speakAnalysisIfNew(analysis);
    } catch (err) {
      if (err instanceof ImageQualityError) {
        setErrorMsg(err.userMessage);
        announce(err.userMessage, "polite");
      } else {
        const msg = "Live shopping analysis is having trouble. I will keep trying.";
        setErrorMsg(msg);
        announce(msg, "polite");
      }
    } finally {
      analyzingRef.current = false;
      setAnalyzing(false);
    }
  }, [announce, language, liveEnabled, speakAnalysisIfNew, wardrobeItems]);

  const toggleLive = useCallback(() => {
    setLiveEnabled((enabled) => {
      const next = !enabled;
      const msg = next ? "Live shopping assistance resumed." : "Live shopping assistance paused.";
      speak(msg);
      announce(msg, "polite");
      return next;
    });
  }, [announce, speak]);

  const speakLastResult = useCallback(() => {
    if (result) {
      const summary = buildSpeechSummary(result);
      if (summary) speak(summary);
    } else if (errorMsg) {
      speak(errorMsg);
    }
  }, [buildSpeechSummary, errorMsg, result, speak]);

  useEffect(() => {
    const handler = (e) => {
      const cmd = e.detail;
      if (cmd.type === "PAUSE_SCAN" && liveEnabled) toggleLive();
      else if (cmd.type === "RESUME_SCAN" && !liveEnabled) toggleLive();
      else if (cmd.type === "READ_RESULT") speakLastResult();
    };
    window.addEventListener("voiceCommand", handler);
    return () => window.removeEventListener("voiceCommand", handler);
  }, [liveEnabled, speakLastResult, toggleLive]);

  const verdictSeg = result?.speech_segments?.find((segment) => segment.id === "verdict");
  const detailSegs = result?.speech_segments?.filter((segment) => segment.id !== "verdict") ?? [];
  const verdictColor = verdictSeg?.text.match(/worth|works|great/i) ? C.success
    : verdictSeg?.text.match(/clash|avoid|not worth/i) ? C.danger
    : C.focus;

  return (
    <>
      <LiveRegions />
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={{ flex: 1, position: "relative", minHeight: "44vh", display: "flex", flexDirection: "column" }}>
          <CameraView
            onCapture={handleLiveFrame}
            onError={(msg) => { announce(msg, "assertive"); speak(msg); }}
            autoCapture={liveEnabled}
            captureInterval={LIVE_CAPTURE_INTERVAL_MS}
            showControls={false}
          />

          <div style={{
            position: "absolute", top: 12, right: 12,
            background: "rgba(0,0,0,0.78)", borderRadius: 12,
            padding: "6px 14px",
          }}>
            <span style={{ fontFamily: FONT, fontSize: 12, color: emptyWardrobe ? C.muted : C.success }}>
              {emptyWardrobe ? "No wardrobe" : `${wardrobeItems.length} items`}
            </span>
          </div>

          <div
            aria-live="polite"
            style={{
              position: "absolute", top: 12, left: 12,
              background: "rgba(0,0,0,0.82)",
              borderRadius: 12,
              border: `1px solid ${analyzing ? C.focus : liveEnabled ? C.success : C.border}`,
              padding: "8px 14px",
            }}
          >
            <span style={{ fontFamily: FONT, fontSize: 13, color: analyzing ? C.focus : liveEnabled ? C.success : C.muted }}>
              {analyzing ? "Llama is checking..." : liveEnabled ? "Live assist on" : "Live assist paused"}
            </span>
          </div>
        </div>

        <div style={{
          padding: 20,
          background: C.bg,
          borderTop: `2px solid ${C.border}`,
          maxHeight: "56vh",
          overflowY: "auto",
        }}>
          <div style={{
            fontFamily: FONT,
            fontSize: 12,
            color: C.focus,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            marginBottom: 12,
          }}>
            LIVE SHOPPING MODE
          </div>

          {!result && !errorMsg && (
            <p aria-live="polite" style={{ fontFamily: FONT, fontSize: 17, color: C.muted, lineHeight: 1.7, marginBottom: 14 }}>
              {emptyWardrobe
                ? "Point the camera at clothing. Llama will give standalone style advice."
                : "Point the camera at clothing. Llama will compare it with your wardrobe."}
            </p>
          )}

          {errorMsg && !result && (
            <div role="status" style={{
              background: "#2A0E0E",
              border: `1px solid ${C.danger}`,
              borderRadius: 12,
              padding: 14,
              marginBottom: 14,
            }}>
              <p style={{ fontFamily: FONT, fontSize: 15, color: C.danger, lineHeight: 1.6, margin: 0 }}>
                {errorMsg}
              </p>
            </div>
          )}

          {result && (
            <>
              {(result.suitable_occasions?.length > 0 || result.top_archetypes?.length > 0) && (
                <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                  {result.suitable_occasions?.length > 0 && (
                    <div style={{ background: C.surface, borderRadius: 12, padding: "10px 14px", border: `1px solid ${C.border}`, flex: 1 }}>
                      <div style={{ fontFamily: FONT, fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>
                        Works for
                      </div>
                      {result.suitable_occasions.map((occasion) => (
                        <div key={occasion} style={{ fontFamily: FONT, fontSize: 13, color: C.text, lineHeight: 1.5 }}>
                          {occasion}
                        </div>
                      ))}
                    </div>
                  )}
                  {result.top_archetypes?.length > 0 && (
                    <div style={{ background: C.surface, borderRadius: 12, padding: "10px 14px", border: `1px solid ${C.border}`, flex: 1 }}>
                      <div style={{ fontFamily: FONT, fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>
                        Style
                      </div>
                      {result.top_archetypes.map((archetype) => (
                        <div key={archetype} style={{ fontFamily: FONT, fontSize: 13, color: C.text, lineHeight: 1.5 }}>
                          {archetype}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {verdictSeg && (
                <div style={{
                  background: C.surface,
                  borderRadius: 14,
                  padding: "12px 16px",
                  border: `2px solid ${verdictColor}`,
                  marginBottom: 12,
                }}>
                  <div style={{ fontFamily: FONT, fontSize: 10, color: verdictColor, textTransform: "uppercase", letterSpacing: "0.2em", marginBottom: 4 }}>
                    Verdict
                  </div>
                  <p style={{ fontFamily: FONT, fontSize: 16, color: C.text, lineHeight: 1.6, margin: 0 }}>
                    {verdictSeg.text}
                  </p>
                </div>
              )}

              {detailSegs.length > 0 && (
                <>
                  <button
                    onClick={() => setDetailsOpen((open) => !open)}
                    style={{
                      fontFamily: FONT,
                      fontSize: 13,
                      color: C.focus,
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      marginBottom: 8,
                      padding: 0,
                    }}
                  >
                    {detailsOpen ? "Hide details ▲" : "Show details ▼"}
                  </button>
                  {detailsOpen && detailSegs.map((segment) => (
                    <div key={segment.id} style={{
                      background: C.surface,
                      borderRadius: 12,
                      padding: 14,
                      border: `1px solid ${C.border}`,
                      marginBottom: 10,
                    }}>
                      <div style={{ fontFamily: FONT, fontSize: 10, color: C.focus, textTransform: "uppercase", letterSpacing: "0.2em", marginBottom: 6 }}>
                        {segment.id === "item" ? "Item" : emptyWardrobe ? "Style Advice" : "Wardrobe Match"}
                      </div>
                      <p style={{ fontFamily: FONT, fontSize: 15, color: C.text, lineHeight: 1.7, margin: 0 }}>
                        {segment.text}
                      </p>
                    </div>
                  ))}
                </>
              )}

              <ContextChat
                context={result.speech_segments?.map((segment) => segment.text).join("\n") || ""}
                feature="shopping"
                speak={speak}
                announce={announce}
              />
            </>
          )}

          <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
            <button
              type="button"
              onClick={toggleLive}
              style={{
                flex: 1,
                minHeight: 64,
                borderRadius: 14,
                border: "none",
                background: liveEnabled ? C.danger : C.success,
                color: liveEnabled ? C.white : "#000",
                fontFamily: FONT,
                fontSize: 18,
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              {liveEnabled ? "Pause Live" : "Resume Live"}
            </button>
            <button
              type="button"
              disabled={!result && !errorMsg}
              onClick={speakLastResult}
              style={{
                flex: 1,
                minHeight: 64,
                borderRadius: 14,
                border: `2px solid ${C.border}`,
                background: C.surface,
                color: result || errorMsg ? C.text : C.muted,
                fontFamily: FONT,
                fontSize: 18,
                fontWeight: 900,
                cursor: result || errorMsg ? "pointer" : "not-allowed",
                opacity: result || errorMsg ? 1 : 0.45,
              }}
            >
              Read Again
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

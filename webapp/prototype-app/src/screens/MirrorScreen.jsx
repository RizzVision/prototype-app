/**
 * MirrorScreen — Auditory mirror using RizzVision full outfit analysis.
 *
 * Accessibility:
 *  - Intro spoken on mount.
 *  - All results announced via live region and spoken via TTS.
 *  - Image quality errors (too dark, blurry, etc.) announced assertively.
 *  - "Read Again" re-speaks entire analysis.
 */

import { useState, useCallback, useEffect, useRef } from "react";
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

export default function MirrorScreen() {
  const { speak } = useVoice();
  const { announce, LiveRegions } = useAnnounce();

  const [phase, setPhase] = useState("camera"); // camera | analyzing | error | result
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [previewUrl, setPreviewUrl] = useState(null);
  const resultRef = useRef(null);

  useEffect(() => {
    speak(RESPONSES.mirrorReady);
    announce(RESPONSES.mirrorReady, "polite");
  }, [speak, announce]);

  useEffect(() => {
    if (phase === "result" && resultRef.current) resultRef.current.focus();
  }, [phase]);

  useEffect(() => {
    const handler = (e) => {
      const cmd = e.detail;
      if (cmd.type === "SCAN_AGAIN") reset();
      else if (cmd.type === "SAVE_ITEM") speak("Mirror mode does not save items. Use Scan Clothing to save to your wardrobe.");
      else if (cmd.type === "READ_RESULT" && phase === "result") speakResult();
    };
    window.addEventListener("voiceCommand", handler);
    return () => window.removeEventListener("voiceCommand", handler);
  }, [phase, reset, speak, speakResult]);

  const handleCapture = useCallback(async (base64, dataUrl) => {
    setPhase("analyzing");
    setPreviewUrl(dataUrl);
    announce("Analyzing your outfit. Please wait.", "polite");
    speak(RESPONSES.mirrorAnalyzing);

    try {
      const analysis = await analyzeOutfit(base64);
      setResult(analysis);
      setPhase("result");

      if (analysis.speech_segments?.length) {
        const fullText = analysis.speech_segments.map((s) => s.text).join("  ");
        announce(fullText, "polite");
        speak(fullText);
      }
    } catch (err) {
      const msg =
        err instanceof ImageQualityError ? err.userMessage
        : err.message || RESPONSES.error;
      setErrorMsg(msg);
      announce(msg, "assertive");
      speak(msg);
      setPhase("error");
    }
  }, [speak, announce]);

  const reset = useCallback(() => {
    setPhase("camera");
    setResult(null);
    setErrorMsg("");
    setPreviewUrl(null);
    speak(RESPONSES.mirrorReady);
    announce(RESPONSES.mirrorReady, "polite");
  }, [speak, announce]);

  const speakResult = useCallback(() => {
    if (result?.speech_segments?.length) {
      speak(result.speech_segments.map((s) => s.text).join("  "));
    }
  }, [result, speak]);

  // ── Camera ─────────────────────────────────────────────────────────────────
  if (phase === "camera") {
    return (
      <>
        <LiveRegions />
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <CameraView
            onCapture={handleCapture}
            onError={(msg) => { announce(msg, "assertive"); speak(msg); }}
          />
        </div>
      </>
    );
  }

  // ── Analyzing ──────────────────────────────────────────────────────────────
  if (phase === "analyzing") {
    return (
      <Screen title="Analyzing..." subtitle="Reading your outfit.">
        <LiveRegions />
        {previewUrl && (
          <img
            src={previewUrl}
            alt="Your outfit being analyzed"
            style={{ width: "100%", borderRadius: 16, marginBottom: 20, maxHeight: 320, objectFit: "cover" }}
          />
        )}
        <div
          role="status"
          aria-label="Analyzing outfit. Please wait."
          style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 40, gap: 20 }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 56, height: 56, borderRadius: "50%",
              border: `4px solid ${C.focus}`,
              borderTopColor: "transparent",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <p aria-live="polite" style={{ fontFamily: FONT, color: C.muted, fontSize: 15, margin: 0 }}>
            Reading colors, style, and occasion…
          </p>
        </div>
      </Screen>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (phase === "error") {
    return (
      <Screen title="Photo Issue" subtitle="Could not analyze this photo.">
        <LiveRegions />
        {previewUrl && (
          <img
            src={previewUrl}
            alt="Photo that could not be processed"
            style={{
              width: "100%", borderRadius: 16, marginBottom: 20,
              maxHeight: 280, objectFit: "cover", opacity: 0.55,
            }}
          />
        )}
        <div
          role="alert"
          aria-live="assertive"
          style={{
            background: "#2A0E0E", borderRadius: 16, padding: 20,
            border: `1px solid ${C.danger}`, marginBottom: 24,
          }}
        >
          <p style={{ fontFamily: FONT, fontSize: 17, color: C.danger, lineHeight: 1.75, margin: 0 }}>
            {errorMsg}
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <BigButton label="Try Again" hint="Take another photo" icon="📸" variant="primary" onClick={reset} />
          <BigButton label="Read Error" hint="Hear the error message again" icon="🔊" onClick={() => speak(errorMsg)} />
        </div>
      </Screen>
    );
  }

  // ── Result ─────────────────────────────────────────────────────────────────
  const score = result?.color_score ?? 0;
  const sc = scoreColor(score);
  const scoreLabel = result?.color_label || "";
  const occasion = result?.best_occasion || "";
  const archetype = result?.style_archetype || "";

  return (
    <Screen title="Auditory Mirror" subtitle="Here is my honest assessment.">
      <LiveRegions />

      <h2
        ref={resultRef}
        tabIndex={-1}
        aria-label={`Analysis complete. Color score: ${scoreLabel}, ${Math.round(score * 100)} percent. Best occasion: ${occasion}.`}
        style={{ position: "absolute", left: -9999, top: "auto", width: 1, height: 1, overflow: "hidden" }}
      />

      {previewUrl && (
        <img
          src={previewUrl}
          alt="Your outfit"
          style={{ width: "100%", borderRadius: 16, marginBottom: 16, maxHeight: 320, objectFit: "cover" }}
        />
      )}

      {/* Score + Occasion */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <div style={{
          flex: 1, background: C.surface, borderRadius: 14, padding: "14px 16px",
          border: `2px solid ${sc}`, textAlign: "center",
        }}>
          <div style={{ fontFamily: FONT, fontSize: 11, color: C.muted, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 4 }}>
            Color Score
          </div>
          <div style={{ fontFamily: FONT, fontSize: 28, fontWeight: 700, color: sc }}>
            {Math.round(score * 100)}%
          </div>
          <div style={{ fontFamily: FONT, fontSize: 13, color: C.muted, textTransform: "capitalize" }}>
            {scoreLabel}
          </div>
        </div>

        {occasion && (
          <div style={{
            flex: 1, background: C.surface, borderRadius: 14, padding: "14px 16px",
            border: `1px solid ${C.border}`, textAlign: "center",
          }}>
            <div style={{ fontFamily: FONT, fontSize: 11, color: C.muted, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 4 }}>
              Best For
            </div>
            <div style={{ fontFamily: FONT, fontSize: 15, fontWeight: 600, color: C.text, lineHeight: 1.3 }}>
              {occasion}
            </div>
          </div>
        )}
      </div>

      {/* Style archetype */}
      {archetype && (
        <div style={{
          background: C.surface, borderRadius: 12, padding: "10px 16px",
          border: `1px solid ${C.border}`, marginBottom: 14,
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <span style={{ fontFamily: FONT, fontSize: 12, color: C.muted }}>Style</span>
          <span style={{ fontFamily: FONT, fontSize: 15, color: C.text, fontWeight: 600 }}>{archetype}</span>
        </div>
      )}

      {/* Full analysis transcript */}
      {result?.speech_segments?.length > 0 && (
        <div
          aria-label="Full outfit analysis"
          style={{
            background: C.surface, borderRadius: 14, padding: 18,
            border: `1px solid ${C.border}`, marginBottom: 20,
            maxHeight: 240, overflowY: "auto",
          }}
        >
          {result.speech_segments.map((seg) => (
            <p key={seg.id} style={{
              fontFamily: FONT, fontSize: 15, color: C.text, lineHeight: 1.8,
              margin: "0 0 10px 0",
            }}>
              {seg.text}
            </p>
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <BigButton
          label="Read Again"
          hint="Hear the full assessment read aloud again"
          icon="🔊"
          onClick={speakResult}
        />
        <BigButton
          label="Try Again"
          hint="Take a new photo for a fresh assessment"
          icon="📸"
          variant="primary"
          onClick={reset}
        />
      </div>
    </Screen>
  );
}

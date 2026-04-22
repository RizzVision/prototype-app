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
import ContextChat from "../components/ContextChat";


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

  const handleCapture = useCallback(async (base64, dataUrl) => {
    setPhase("analyzing");
    setPreviewUrl(dataUrl);
    announce("Analyzing your outfit. Please wait.", "polite");
    speak(RESPONSES.mirrorAnalyzing);

    try {
      const analysis = await analyzeOutfit(base64);
      setResult(analysis);
      setPhase("result");

      // Auto-speak the short description on arrival
      if (analysis.speech_segments?.length) {
        const segMap = {};
        for (const s of analysis.speech_segments) segMap[s.id] = s.text;
        const shortParts = [
          segMap["garments"],
          segMap["overall_verdict"],
        ].filter(Boolean);
        const shortText = shortParts.join("  ");
        announce(shortText, "polite");
        speak(shortText);
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

  const speakShort = useCallback(() => {
    if (!result) return;
    const segMap = {};
    for (const s of result.speech_segments || []) segMap[s.id] = s.text;
    const parts = [
      segMap["garments"],
      segMap["overall_verdict"],
    ].filter(Boolean);
    if (parts.length) speak(parts.join("  "));
  }, [result, speak]);

  const speakLong = useCallback(() => {
    if (!result) return;
    const parts = (result.speech_segments || []).map((s) => s.text);
    if (parts.length) speak(parts.join("  "));
  }, [result, speak]);

  // Voice command listener — placed after all callbacks to avoid TDZ in prod build
  useEffect(() => {
    const handler = (e) => {
      const cmd = e.detail;
      if (cmd.type === "SCAN_AGAIN") reset();
      else if (cmd.type === "SAVE_ITEM") speak("Mirror mode only gives instant feedback. To save items to your wardrobe, go back and use Scan Clothing instead.");
      else if (cmd.type === "READ_RESULT" && phase === "result") speakLong();
    };
    window.addEventListener("voiceCommand", handler);
    return () => window.removeEventListener("voiceCommand", handler);
  }, [phase, reset, speak, speakLong]);

  // ── Camera ─────────────────────────────────────────────────────────────────
  if (phase === "camera") {
    return (
      <>
        <LiveRegions />
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          {/* Distinction banner */}
          <div
            role="note"
            aria-label="Mirror mode: instant feedback only. Nothing is saved to your wardrobe. Use Scan Clothing to save items."
            style={{
              background: "rgba(0,0,0,0.72)",
              borderBottom: "1px solid rgba(255,255,255,0.12)",
              padding: "10px 16px",
              display: "flex",
              alignItems: "center",
              gap: 10,
              zIndex: 10,
            }}
          >
            <span aria-hidden style={{ fontSize: 18 }}>🪞</span>
            <div>
              <div style={{ fontFamily: "inherit", fontSize: 13, color: "#fff", fontWeight: 700, lineHeight: 1.3 }}>
                Instant feedback — nothing saved
              </div>
              <div style={{ fontFamily: "inherit", fontSize: 11, color: "rgba(255,255,255,0.55)", marginTop: 2 }}>
                Use Scan Clothing to add items to your wardrobe
              </div>
            </div>
          </div>
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
  const mirrorChatContext = result
    ? (result.speech_segments || []).map((s) => s.text).join("\n")
    : "";

  return (
    <Screen title="Auditory Mirror" subtitle="Instant feedback — not saved to wardrobe.">
      <LiveRegions />

      <h2
        ref={resultRef}
        tabIndex={-1}
        aria-label="Analysis complete."
        style={{ position: "absolute", left: -9999, top: "auto", width: 1, height: 1, overflow: "hidden" }}
      />

      {previewUrl && (
        <img
          src={previewUrl}
          alt="Your outfit"
          style={{ width: "100%", borderRadius: 16, marginBottom: 16, maxHeight: 320, objectFit: "cover" }}
        />
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

      {/* Follow-up chatbot — anchored to this mirror result */}
      {mirrorChatContext && (
        <ContextChat
          context={mirrorChatContext}
          feature="mirror"
          speak={speak}
          announce={announce}
        />
      )}

      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <BigButton
          label="Short Description"
          hint="Hear a quick summary: what you're wearing and the overall verdict"
          icon="🔊"
          onClick={speakShort}
        />
        <BigButton
          label="Long Description"
          hint="Hear the full breakdown: garments, colour feedback, fit, verdict, and top fix"
          icon="📋"
          onClick={speakLong}
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

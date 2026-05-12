/**
 * ShoppingScreen — wardrobe-aware shopping assistant.
 *
 * Uses the same capture flow as Scan Clothing:
 * camera -> captured preview -> Groq shopping analysis -> result/error.
 * Adding items to the wardrobe is intentionally disabled in this mode.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import Screen from "../components/Screen";
import BigButton from "../components/BigButton";
import CameraView from "../components/CameraView";
import ContextChat from "../components/ContextChat";
import { useAnnounce } from "../components/LiveRegions";
import { useLocale } from "../contexts/LocaleContext";
import { useVoice } from "../contexts/VoiceContext";
import { useWardrobe } from "../contexts/WardrobeContext";
import { analyzeForShopping, ImageQualityError } from "../services/rizzVisionApi";
import { C, FONT } from "../utils/constants";

export default function ShoppingScreen() {
  const { language } = useLocale();
  const { speak } = useVoice();
  const { announce, LiveRegions } = useAnnounce();
  const { items: wardrobeItems } = useWardrobe();

  const [phase, setPhase] = useState("camera"); // camera | analyzing | result | error
  const [previewUrl, setPreviewUrl] = useState(null);
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);

  const captureRef = useRef(null);
  const describeRef = useRef(null);

  const emptyWardrobe = wardrobeItems.length === 0;

  useEffect(() => {
    if (phase === "camera") {
      const msg = emptyWardrobe
        ? "Shopping mode ready. Point at clothing and tap Capture for Groq style advice."
        : "Shopping mode ready. Point at clothing and tap Capture to compare it with your wardrobe.";
      speak(msg);
      announce(msg, "polite");
    }
  }, [phase, emptyWardrobe, speak, announce]);

  const handleDescribe = useCallback((description) => {
    announce(description, "polite");
    speak(description);
  }, [speak, announce]);

  const speakAnalysis = useCallback((analysis) => {
    const text = (analysis.speech_segments ?? []).map((segment) => segment.text).join("  ");
    if (text) {
      speak(text);
      announce(text, "polite");
    }
  }, [speak, announce]);

  const handleCapture = useCallback(async (base64, dataUrl) => {
    setPhase("analyzing");
    setPreviewUrl(dataUrl);
    setResult(null);
    setErrorMsg("");
    setDetailsOpen(false);

    const msg = emptyWardrobe
      ? "Checking this item with Groq. One moment."
      : "Checking this item against your wardrobe with Groq. One moment.";
    speak(msg);
    announce(msg, "polite");

    try {
      const analysis = await analyzeForShopping(base64, wardrobeItems, language);
      setResult(analysis);
      speakAnalysis(analysis);
      setPhase("result");
    } catch (err) {
      const userMessage = err instanceof ImageQualityError
        ? err.userMessage
        : "I could not analyze this item right now. Please try again.";
      setErrorMsg(userMessage);
      speak(userMessage);
      announce(userMessage, "assertive");
      setPhase("error");
    }
  }, [emptyWardrobe, wardrobeItems, language, speak, announce, speakAnalysis]);

  const reset = useCallback(() => {
    setPreviewUrl(null);
    setResult(null);
    setErrorMsg("");
    setDetailsOpen(false);
    setPhase("camera");
  }, []);

  const speakLastResult = useCallback(() => {
    if (result) speakAnalysis(result);
    else if (errorMsg) speak(errorMsg);
  }, [result, errorMsg, speakAnalysis, speak]);

  useEffect(() => {
    const handler = (e) => {
      const cmd = e.detail;
      if (cmd.type === "DESCRIBE_FRAME" && phase === "camera") describeRef.current?.();
      else if (cmd.type === "READ_RESULT") speakLastResult();
      else if (cmd.type === "DISCARD_ITEM") reset();
    };
    window.addEventListener("voiceCommand", handler);
    return () => window.removeEventListener("voiceCommand", handler);
  }, [phase, speakLastResult, reset]);

  const handleUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      const base64 = dataUrl.split(",")[1];
      handleCapture(base64, dataUrl);
    };
    reader.readAsDataURL(file);
  }, [handleCapture]);

  if (phase === "camera") {
    return (
      <>
        <LiveRegions />
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <CameraView
            onCapture={handleCapture}
            onError={(msg) => { announce(msg, "assertive"); speak(msg); }}
            onDescribe={handleDescribe}
            captureRef={captureRef}
            describeRef={describeRef}
          />

          <div style={{
            position: "absolute", top: 12, right: 12,
            background: "rgba(0,0,0,0.75)", borderRadius: 12,
            padding: "6px 14px",
          }}>
            <span style={{ fontFamily: FONT, fontSize: 12, color: emptyWardrobe ? C.muted : C.success }}>
              {emptyWardrobe ? "No wardrobe" : `${wardrobeItems.length} items`}
            </span>
          </div>

          <div style={{
            position: "absolute", bottom: 140, left: 0, right: 0,
            display: "flex", justifyContent: "center", zIndex: 10,
          }}>
            <label
              aria-label="Upload a shopping photo from your gallery"
              style={{
                background: "rgba(0,0,0,0.65)",
                border: "2px solid rgba(255,255,255,0.5)",
                borderRadius: 14,
                color: "#fff",
                fontFamily: FONT,
                fontSize: 14,
                fontWeight: 600,
                padding: "10px 20px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span aria-hidden>🖼</span> Upload from Gallery
              <input type="file" accept="image/*" onChange={handleUpload} style={{ display: "none" }} aria-hidden />
            </label>
          </div>
        </div>
      </>
    );
  }

  if (phase === "analyzing") {
    return (
      <Screen title="Checking Item..." subtitle="Groq is comparing this item with your wardrobe.">
        <LiveRegions />
        {previewUrl && (
          <img
            src={previewUrl}
            alt="Shopping item being analyzed"
            style={{ width: "100%", borderRadius: 16, marginBottom: 20, maxHeight: 320, objectFit: "cover" }}
          />
        )}
        <div role="status" aria-label="Analyzing shopping item" style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 40, gap: 20 }}>
          <div aria-hidden="true" style={{
            width: 56, height: 56, borderRadius: "50%",
            border: `4px solid ${C.focus}`, borderTopColor: "transparent",
            animation: "spin 0.8s linear infinite",
          }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <p aria-live="polite" style={{ fontFamily: FONT, color: C.muted, fontSize: 15, margin: 0 }}>
            Analyzing with Groq...
          </p>
        </div>
      </Screen>
    );
  }

  if (phase === "error") {
    return (
      <Screen title="Photo Issue" subtitle="Please retake the photo.">
        <LiveRegions />
        {previewUrl && (
          <img
            src={previewUrl}
            alt="Photo that could not be processed"
            style={{ width: "100%", borderRadius: 16, marginBottom: 20, maxHeight: 280, objectFit: "cover", opacity: 0.55 }}
          />
        )}
        <div role="alert" aria-live="assertive" style={{
          background: "#2A0E0E", borderRadius: 16, padding: 20,
          border: `1px solid ${C.danger}`, marginBottom: 24,
        }}>
          <p style={{ fontFamily: FONT, fontSize: 17, color: C.danger, lineHeight: 1.75, margin: 0 }}>{errorMsg}</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <BigButton label="Retake Photo" hint="Go back to camera" icon="📸" variant="primary" onClick={reset} />
          <BigButton label="Read Error Again" hint="Hear the error message again" icon="🔊" onClick={speakLastResult} />
        </div>
      </Screen>
    );
  }

  const verdictSeg = result?.speech_segments?.find((segment) => segment.id === "verdict");
  const detailSegs = result?.speech_segments?.filter((segment) => segment.id !== "verdict") ?? [];
  const verdictColor = verdictSeg?.text.match(/worth|works|great/i) ? C.success
    : verdictSeg?.text.match(/clash|avoid|not worth/i) ? C.danger
    : C.focus;

  return (
    <Screen title="Shopping Advice" subtitle={emptyWardrobe ? "Standalone style advice." : "Compared with your wardrobe."}>
      <LiveRegions />

      {previewUrl && (
        <img
          src={previewUrl}
          alt="Analyzed shopping item"
          style={{ width: "100%", borderRadius: 16, marginBottom: 16, maxHeight: 280, objectFit: "cover" }}
        />
      )}

      {(result?.suitable_occasions?.length > 0 || result?.top_archetypes?.length > 0) && (
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
          background: C.surface, borderRadius: 14, padding: "12px 16px",
          border: `2px solid ${verdictColor}`, marginBottom: 12,
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
              fontFamily: FONT, fontSize: 13, color: C.focus,
              background: "none", border: "none", cursor: "pointer",
              marginBottom: 8, padding: 0,
            }}
          >
            {detailsOpen ? "Hide details ▲" : "Show details ▼"}
          </button>
          {detailsOpen && detailSegs.map((segment) => (
            <div key={segment.id} style={{
              background: C.surface, borderRadius: 12, padding: 14,
              border: `1px solid ${C.border}`, marginBottom: 10,
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
        context={result?.speech_segments?.map((segment) => segment.text).join("\n") || ""}
        feature="shopping"
        speak={speak}
        announce={announce}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 18 }}>
        <BigButton label="Scan Another Item" hint="Go back to camera" icon="📸" variant="primary" onClick={reset} />
        <BigButton label="Read Again" hint="Hear the shopping advice again" icon="🔊" onClick={speakLastResult} />
      </div>
    </Screen>
  );
}

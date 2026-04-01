/**
 * ScanScreen — Full outfit analysis via RizzVision backend.
 *
 * Accessibility design:
 *  - All state transitions announced via ARIA live regions (assertive for errors).
 *  - Every result is spoken aloud via speech synthesis immediately on arrival.
 *  - Error messages come directly from the backend as spoken sentences.
 *  - Buttons have descriptive aria-labels with hints for screen readers.
 *  - Focus moves to the result heading when analysis completes.
 *  - Image quality errors (too dark, blurry, etc.) are announced assertively
 *    and the user is prompted to retake the photo.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import Screen from "../components/Screen";
import BigButton from "../components/BigButton";
import CameraView from "../components/CameraView";
import { useAnnounce } from "../components/LiveRegions";
import { useApp } from "../contexts/AppContext";
import { useVoice } from "../contexts/VoiceContext";
import { useWardrobe } from "../contexts/WardrobeContext";
import { analyzeOutfit, ImageQualityError } from "../services/rizzVisionApi";
import { uploadClothingImage } from "../utils/storage";
import { SCREENS, C, FONT } from "../utils/constants";
import { RESPONSES } from "../voice/voiceResponses";

function scoreColor(score) {
  if (score >= 0.65) return C.success;
  if (score >= 0.45) return C.focus;
  return C.danger;
}

function inferCategory(label) {
  if (!label) return "tops";
  const l = label.toLowerCase();
  if (["shirt","blouse","jacket","hoodie","top","coat","sweater","cardigan","t-shirt","tshirt"].some(k => l.includes(k))) return "tops";
  if (["jeans","trouser","pant","skirt","legging","shorts","short"].some(k => l.includes(k))) return "bottoms";
  if (["dress","jumpsuit","co-ord","coord"].some(k => l.includes(k))) return "dresses";
  if (["shoe","boot","sandal","sneaker","heel","loafer","trainer","slipper"].some(k => l.includes(k))) return "footwear";
  if (["necklace","earring","ring","bracelet","watch","bangle","pendant"].some(k => l.includes(k))) return "jewellery";
  return "tops";
}

export default function ScanScreen() {
  const { navigate } = useApp();
  const { speak } = useVoice();
  const { addItem } = useWardrobe();
  const { announce, LiveRegions } = useAnnounce();

  const [phase, setPhase] = useState("camera"); // camera | analyzing | error | result | saving
  const [result, setResult] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [guidanceState, setGuidanceState] = useState("idle"); // idle | too_dark | too_bright | no_clothing | too_far | too_close | off_center | ready
  const [subjectBox, setSubjectBox] = useState(null);

  const capturedBase64Ref = useRef(null);
  const captureRef = useRef(null);
  const resultHeadingRef = useRef(null);

  // Guidance refs — local brightness only (YOLO removed)
  const guidanceActiveRef = useRef(true);
  const guidanceReadyRef = useRef(false);
  const countdownRef = useRef(null);
  const lastSpokenRef = useRef({ msg: "", ts: 0 });
  const DEBOUNCE_MS = 6000;

  useEffect(() => {
    if (phase === "camera") {
      speak(RESPONSES.scanReady);
      announce("Camera ready. Point at your outfit and tap capture.", "polite");
    }
  }, [phase, speak, announce]);

  useEffect(() => {
    return () => {
      guidanceActiveRef.current = false;
      if (countdownRef.current) clearTimeout(countdownRef.current);
    };
  }, []);

  // Move focus to result heading so screen readers announce it immediately
  useEffect(() => {
    if (phase === "result" && resultHeadingRef.current) {
      resultHeadingRef.current.focus();
    }
  }, [phase]);


  const speakGuidance = useCallback((msg) => {
    const now = Date.now();
    if (msg === lastSpokenRef.current.msg && now - lastSpokenRef.current.ts < DEBOUNCE_MS) return;
    lastSpokenRef.current = { msg, ts: now };
    speak(msg);
  }, [speak]);

  const cancelCountdown = useCallback(() => {
    if (countdownRef.current) { clearTimeout(countdownRef.current); countdownRef.current = null; }
    guidanceReadyRef.current = false;
  }, []);

  const triggerCapture = useCallback(() => {
    if (!guidanceActiveRef.current) return;
    guidanceActiveRef.current = false;
    cancelCountdown();
    if (captureRef.current) captureRef.current();
  }, [cancelCountdown]);

  const startCountdown = useCallback(() => {
    if (guidanceReadyRef.current) return;
    guidanceReadyRef.current = true;
    speak(RESPONSES.guidance.goodPosition);
    countdownRef.current = setTimeout(() => {
      if (!guidanceActiveRef.current) return;
      speak(RESPONSES.guidance.countdown2);
      countdownRef.current = setTimeout(() => {
        if (!guidanceActiveRef.current) return;
        speak(RESPONSES.guidance.countdown1);
        countdownRef.current = setTimeout(() => triggerCapture(), 1000);
      }, 1000);
    }, 1000);
  }, [speak, triggerCapture]);

  const handleGuidanceSample = useCallback((_base64, brightness, _videoW, _videoH, { subjectBox: sb } = {}) => {
    if (!guidanceActiveRef.current) return;
    setSubjectBox(sb || null);
    const subjectBox = sb;

    // 1. Lighting — highest priority
    if (brightness < 40) {
      cancelCountdown();
      guidanceReadyRef.current = false;
      setGuidanceState("too_dark");
      speakGuidance(RESPONSES.guidance.tooDark);
      return;
    }
    if (brightness > 220) {
      cancelCountdown();
      guidanceReadyRef.current = false;
      setGuidanceState("too_bright");
      speakGuidance(RESPONSES.guidance.tooBright);
      return;
    }

    // 2. Clothing presence
    if (!subjectBox || subjectBox.confidence < 0.15) {
      cancelCountdown();
      guidanceReadyRef.current = false;
      setGuidanceState("no_clothing");
      speakGuidance(RESPONSES.guidance.noClothing);
      return;
    }

    // 3. Subject size
    const area = (subjectBox.x2 - subjectBox.x1) * (subjectBox.y2 - subjectBox.y1);
    if (area < 0.10) {
      cancelCountdown();
      guidanceReadyRef.current = false;
      setGuidanceState("too_far");
      speakGuidance(RESPONSES.guidance.tooFar);
      return;
    }
    if (area > 0.75) {
      cancelCountdown();
      guidanceReadyRef.current = false;
      setGuidanceState("too_close");
      speakGuidance(RESPONSES.guidance.tooClose);
      return;
    }

    // 4. Centering
    const centerX = (subjectBox.x1 + subjectBox.x2) / 2;
    const centerY = (subjectBox.y1 + subjectBox.y2) / 2;
    if (Math.abs(centerX - 0.5) > 0.25) {
      cancelCountdown();
      guidanceReadyRef.current = false;
      setGuidanceState("off_center");
      speakGuidance(centerX < 0.5 ? RESPONSES.guidance.moveRight : RESPONSES.guidance.moveLeft);
      return;
    }
    if (Math.abs(centerY - 0.5) > 0.3) {
      cancelCountdown();
      guidanceReadyRef.current = false;
      setGuidanceState("off_center");
      speakGuidance(centerY < 0.5 ? RESPONSES.guidance.moveDown : RESPONSES.guidance.moveUp);
      return;
    }

    // 5. All conditions met — start countdown
    setGuidanceState("ready");
    if (!guidanceReadyRef.current) startCountdown();
  }, [cancelCountdown, speakGuidance, startCountdown]);

  const handleCapture = useCallback(async (base64, dataUrl) => {
    guidanceActiveRef.current = false;
    cancelCountdown();
    setPhase("analyzing");
    setPreviewUrl(dataUrl);
    capturedBase64Ref.current = base64;
    announce("Analyzing your outfit. Please wait.", "polite");
    speak(RESPONSES.analyzing);

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
  }, [speak, cancelCountdown, announce]);

  const handleSave = useCallback(async () => {
    if (!result) return;
    setPhase("saving");
    announce("Saving to your wardrobe.", "polite");

    let imageUrl = null;
    try {
      if (capturedBase64Ref.current) imageUrl = await uploadClothingImage(capturedBase64Ref.current);
    } catch {
      const msg = "Could not save image. Item saved without a photo.";
      announce(msg, "polite");
      speak(msg);
    }

    const primary = result.raw?.garment_details?.[0];
    const fullDescription = result.speech_segments?.map((s) => s.text).join("  ") || "";
    try {
      await addItem({
        name: primary?.display_name || primary?.label || "Outfit",
        type: primary?.label || "outfit",
        category: inferCategory(primary?.label),
        color: primary?.hex_color || "#000000",
        colorDescription: primary?.color_name || "",
        pattern: primary?.pattern || "solid",
        gender: "unisex",
        description: fullDescription,
        imageUrl,
      });
      const itemName = primary?.display_name || "item";
      speak(RESPONSES.saved(itemName));
      announce(RESPONSES.saved(itemName), "polite");
      setTimeout(() => navigate(SCREENS.WARDROBE), 1500);
    } catch {
      speak(RESPONSES.error);
      setPhase("result");
    }
  }, [result, addItem, speak, navigate, announce]);

  const reset = useCallback(() => {
    setResult(null);
    setPreviewUrl(null);
    setErrorMsg("");
    setGuidanceState("idle");
    guidanceActiveRef.current = true;
    guidanceReadyRef.current = false;
    lastSpokenRef.current = { msg: "", ts: 0 };
    setPhase("camera");
  }, []);

  const speakResult = useCallback(() => {
    if (result?.speech_segments?.length) {
      speak(result.speech_segments.map((s) => s.text).join("  "));
    }
  }, [result, speak]);

  // Voice command listener — placed after all callbacks to avoid TDZ in prod build
  useEffect(() => {
    const handler = (e) => {
      const cmd = e.detail;
      if (cmd.type === "SAVE_ITEM" && phase === "result") handleSave();
      else if (cmd.type === "DISCARD_ITEM" && phase === "result") reset();
      else if (cmd.type === "READ_RESULT" && phase === "result") speakResult();
    };
    window.addEventListener("voiceCommand", handler);
    return () => window.removeEventListener("voiceCommand", handler);
  }, [phase, handleSave, reset, speakResult]);

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

  // ── Camera ─────────────────────────────────────────────────────────────────
  if (phase === "camera") {
    return (
      <>
        <LiveRegions />
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <CameraView
            onCapture={handleCapture}
            onError={(msg) => { announce(msg, "assertive"); speak(msg); }}
            guidanceMode={true}
            onGuidanceSample={handleGuidanceSample}
            captureRef={captureRef}
            guidanceStatus={guidanceState}
            subjectBox={subjectBox}
          />
          {/* Upload button overlay */}
          <div style={{
            position: "absolute", bottom: 140, left: 0, right: 0,
            display: "flex", justifyContent: "center", zIndex: 10,
          }}>
            <label
              aria-label="Upload a photo from your gallery instead of using camera"
              style={{
                background: "rgba(0,0,0,0.65)",
                border: `2px solid rgba(255,255,255,0.5)`,
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
              <input
                type="file"
                accept="image/*"
                onChange={handleUpload}
                style={{ display: "none" }}
                aria-hidden
              />
            </label>
          </div>
        </div>
      </>
    );
  }

  // ── Analyzing / Saving ─────────────────────────────────────────────────────
  if (phase === "analyzing" || phase === "saving") {
    const subtitle =
      phase === "saving" ? "Saving to your wardrobe." : "Reading colors, occasion, and style.";
    return (
      <Screen title={phase === "saving" ? "Saving..." : "Analyzing..."} subtitle={subtitle}>
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
          aria-label={subtitle}
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
            {subtitle}
          </p>
        </div>
      </Screen>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (phase === "error") {
    return (
      <Screen title="Photo Issue" subtitle="Please retake the photo.">
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
          <BigButton
            label="Retake Photo"
            hint="Go back to camera and take another photo"
            icon="📸"
            variant="primary"
            onClick={reset}
          />
          <BigButton
            label="Read Error Again"
            hint="Hear the error message again"
            icon="🔊"
            onClick={() => speak(errorMsg)}
          />
        </div>
      </Screen>
    );
  }

  // ── Result ─────────────────────────────────────────────────────────────────
  const score = result?.color_score ?? 0;
  const sc = scoreColor(score);
  const scoreLabel = result?.color_label || "unknown";
  const occasion = result?.best_occasion || "";
  const archetype = result?.style_archetype || "";

  return (
    <Screen title="Outfit Analysis" subtitle={`Color score: ${scoreLabel}`}>
      <LiveRegions />

      {/* Hidden heading receives focus to announce result to screen readers */}
      <h2
        ref={resultHeadingRef}
        tabIndex={-1}
        aria-label={`Analysis complete. Color score: ${scoreLabel}, ${Math.round(score * 100)} percent.`}
        style={{ position: "absolute", left: -9999, top: "auto", width: 1, height: 1, overflow: "hidden" }}
      />

      {previewUrl && (
        <img
          src={previewUrl}
          alt="Your analyzed outfit"
          style={{ width: "100%", borderRadius: 16, marginBottom: 16, maxHeight: 320, objectFit: "cover" }}
        />
      )}

      {/* Color Score */}
      <div
        role="region"
        aria-label={`Color score ${Math.round(score * 100)} percent, ${scoreLabel}.`}
        style={{ marginBottom: 14 }}
      >
        <div style={{
          background: C.surface, borderRadius: 14, padding: "14px 16px",
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
      </div>

      {/* Style archetype pill */}
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

      {/* Scrollable speech-segment transcript */}
      {result?.speech_segments?.length > 0 && (
        <div
          aria-label="Full outfit analysis transcript"
          style={{
            background: C.surface, borderRadius: 14, padding: 18,
            border: `1px solid ${C.border}`, marginBottom: 20,
            maxHeight: 220, overflowY: "auto",
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
          label="Read Analysis Again"
          hint="Hear the complete outfit analysis read aloud"
          icon="🔊"
          onClick={speakResult}
        />
        <BigButton
          label="Save to Wardrobe"
          hint="Save this outfit image to your wardrobe"
          icon="✓"
          variant="success"
          onClick={handleSave}
        />
        <BigButton
          label="Analyze Another Outfit"
          hint="Go back to the camera and analyze a different outfit"
          icon="📸"
          onClick={reset}
        />
      </div>
    </Screen>
  );
}

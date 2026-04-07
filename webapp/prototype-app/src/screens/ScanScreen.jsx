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


function hexDistance(a, b) {
  if (!a || !b) return 999;
  const parse = (hex) => {
    const h = hex.replace("#", "");
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  };
  const [r1,g1,b1] = parse(a);
  const [r2,g2,b2] = parse(b);
  return Math.sqrt((r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2);
}

function findDuplicate(garment, existingItems) {
  const cat = inferCategory(garment.label);
  for (const item of existingItems) {
    if (item.category !== cat) continue;
    if (hexDistance(item.color, garment.hex_color) < 65) return item;
  }
  return null;
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
  const { addItem, items: wardrobeItems } = useWardrobe();
  const { announce, LiveRegions } = useAnnounce();

  const [phase, setPhase] = useState("camera"); // camera | analyzing | error | result | saving | confirm_duplicate
  const [result, setResult] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");

  const [duplicateInfo, setDuplicateInfo] = useState(null); // { existing, incoming }

  const capturedBase64Ref = useRef(null);
  const captureRef = useRef(null);
  const resultHeadingRef = useRef(null);

  useEffect(() => {
    if (phase === "camera") {
      speak(RESPONSES.scanReady);
      announce("Camera ready. Point at your outfit, tap Describe to check framing, then tap Capture.", "polite");
    }
  }, [phase, speak, announce]);

  // Move focus to result heading so screen readers announce it immediately
  useEffect(() => {
    if (phase === "result" && resultHeadingRef.current) {
      resultHeadingRef.current.focus();
    }
  }, [phase]);


  const handleDescribe = useCallback((description) => {
    announce(description, "polite");
    speak(description);
  }, [speak, announce]);

  const playSuccessSound = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const playNote = (freq, startTime) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(freq, startTime);
        gain.gain.setValueAtTime(0.2, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.12);
        osc.start(startTime);
        osc.stop(startTime + 0.12);
      };
      playNote(880, ctx.currentTime);
      playNote(660, ctx.currentTime + 0.1);
    } catch (_) {}
  };

  const handleCapture = useCallback(async (base64, dataUrl) => {
    setPhase("analyzing");
    setPreviewUrl(dataUrl);
    capturedBase64Ref.current = base64;
    announce("Analyzing your outfit. Please wait.", "polite");
    speak(RESPONSES.analyzing);

    try {
      const analysis = await analyzeOutfit(base64);
      playSuccessSound();
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

  const doSave = useCallback(async () => {
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

    const garments = result.raw?.garment_details || [];
    const fullDescription = result.speech_segments?.map((s) => s.text).join("  ") || "";
    try {
      if (garments.length === 0) {
        await addItem({
          name: "Outfit",
          type: "outfit",
          category: "tops",
          color: "#000000",
          colorDescription: "",
          pattern: "solid",
          gender: "unisex",
          description: fullDescription,
          imageUrl,
        });
      } else {
        for (const g of garments) {
          await addItem({
            name: g.display_name || g.label || "Item",
            type: g.label || "outfit",
            category: inferCategory(g.label),
            color: g.hex_color || "#000000",
            colorDescription: g.color_name || "",
            pattern: g.pattern || "solid",
            gender: "unisex",
            description: fullDescription,
            imageUrl,
          });
        }
      }
      const count = garments.length;
      const savedMsg = count > 1
        ? `${count} items saved to your wardrobe.`
        : RESPONSES.saved(garments[0]?.display_name || "item");
      speak(savedMsg);
      announce(savedMsg, "polite");
      setTimeout(() => navigate(SCREENS.WARDROBE), 1500);
    } catch {
      speak(RESPONSES.error);
      setPhase("result");
    }
  }, [result, addItem, speak, navigate, announce]);

  const handleSave = useCallback(() => {
    if (!result) return;
    const garments = result.raw?.garment_details || [];
    // Check each garment for a duplicate in the wardrobe
    for (const g of garments) {
      const match = findDuplicate(g, wardrobeItems);
      if (match) {
        const incomingName = g.display_name || g.label || "this item";
        const msg = `You already have a similar item: ${match.name}. Is what you want to save different?`;
        setDuplicateInfo({ existing: match, incoming: g, incomingName });
        setPhase("confirm_duplicate");
        speak(msg);
        announce(msg, "assertive");
        return;
      }
    }
    doSave();
  }, [result, wardrobeItems, doSave, speak, announce]);

  const reset = useCallback(() => {
    setResult(null);
    setPreviewUrl(null);
    setErrorMsg("");
    setDuplicateInfo(null);
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
            onDescribe={handleDescribe}
            captureRef={captureRef}
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

  // ── Duplicate Confirmation ─────────────────────────────────────────────────
  if (phase === "confirm_duplicate" && duplicateInfo) {
    const { existing, incomingName } = duplicateInfo;
    return (
      <Screen title="Already in Wardrobe" subtitle="A similar item was found.">
        <LiveRegions />
        <div
          role="alert"
          style={{
            background: C.surface, borderRadius: 16, padding: 20,
            border: `2px solid ${C.focus}`, marginBottom: 24,
          }}
        >
          <p style={{ fontFamily: FONT, fontSize: 16, color: C.text, lineHeight: 1.75, margin: 0 }}>
            You already have <strong>{existing.name}</strong> in your wardrobe.
            {existing.colorDescription ? ` It is described as ${existing.colorDescription}.` : ""}
            {" "}Is what you want to save different?
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <BigButton
            label="Yes, save as new item"
            hint={`Save ${incomingName} as a new separate item`}
            icon="✓"
            variant="success"
            onClick={doSave}
          />
          <BigButton
            label="No, skip saving"
            hint="Do not save. This is the same item."
            icon="✕"
            onClick={() => {
              const msg = "Not saved. Going back to your analysis.";
              speak(msg);
              announce(msg, "polite");
              setPhase("result");
              setDuplicateInfo(null);
            }}
          />
          <BigButton
            label="Read existing item"
            hint={`Hear the description of the item already in your wardrobe: ${existing.name}`}
            icon="🔊"
            onClick={() => {
              const desc = existing.description
                ? `${existing.name}. ${existing.description}`
                : `${existing.name}, saved on ${new Date(existing.dateAdded).toLocaleDateString()}.`;
              speak(desc);
            }}
          />
        </div>
      </Screen>
    );
  }

  // ── Result ─────────────────────────────────────────────────────────────────
  const occasions = result?.suitable_occasions ?? [];
  const archetypes = result?.top_archetypes ?? [];

  return (
    <Screen title="Outfit Analysis" subtitle={occasions[0] || "Analysis complete"}>
      <LiveRegions />

      {/* Hidden heading receives focus to announce result to screen readers */}
      <h2
        ref={resultHeadingRef}
        tabIndex={-1}
        aria-label={`Analysis complete. Works for: ${occasions.join(", ") || "various occasions"}.`}
        style={{ position: "absolute", left: -9999, top: "auto", width: 1, height: 1, overflow: "hidden" }}
      />

      {previewUrl && (
        <img
          src={previewUrl}
          alt="Your analyzed outfit"
          style={{ width: "100%", borderRadius: 16, marginBottom: 16, maxHeight: 320, objectFit: "cover" }}
        />
      )}

      {/* Occasions + Archetypes */}
      {(occasions.length > 0 || archetypes.length > 0) && (
        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          {occasions.length > 0 && (
            <div style={{
              flex: 1, background: C.surface, borderRadius: 14, padding: "14px 16px",
              border: `1px solid ${C.border}`,
            }}>
              <div style={{ fontFamily: FONT, fontSize: 11, color: C.muted, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 6 }}>
                Works for
              </div>
              {occasions.map((occ) => (
                <div key={occ} style={{ fontFamily: FONT, fontSize: 13, color: C.text, lineHeight: 1.6 }}>{occ}</div>
              ))}
            </div>
          )}
          {archetypes.length > 0 && (
            <div style={{
              flex: 1, background: C.surface, borderRadius: 14, padding: "14px 16px",
              border: `1px solid ${C.border}`,
            }}>
              <div style={{ fontFamily: FONT, fontSize: 11, color: C.muted, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 6 }}>
                Style
              </div>
              {archetypes.map((arch) => (
                <div key={arch} style={{ fontFamily: FONT, fontSize: 13, color: C.text, lineHeight: 1.6 }}>{arch}</div>
              ))}
            </div>
          )}
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

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
import { useLocale } from "../contexts/LocaleContext";
import { useWardrobe } from "../contexts/WardrobeContext";
import { analyzeOutfit, ImageQualityError } from "../services/rizzVisionApi";
import { SCREENS, OCCASIONS, C, FONT } from "../utils/constants";
import { RESPONSES } from "../voice/voiceResponses";
import ChoiceList from "../components/ChoiceList";
import ContextChat from "../components/ContextChat";


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
  const { language } = useLocale();
  const { addItem, items: wardrobeItems } = useWardrobe();
  const { announce, LiveRegions } = useAnnounce();

  const [phase, setPhase] = useState("occasion"); // occasion | camera | analyzing | error | result | naming | saving | confirm_duplicate
  const [selectedOccasion, setSelectedOccasion] = useState(null);
  const [result, setResult] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [duplicateInfo, setDuplicateInfo] = useState(null); // { existing, incoming }
  // Custom names: array of { garment, customName } matching result.raw.garment_details order
  const [customNames, setCustomNames] = useState([]);
  const [namingIndex, setNamingIndex] = useState(0); // which garment we are naming

  const capturedBase64Ref = useRef(null);
  const captureRef = useRef(null);
  const resultHeadingRef = useRef(null);
  const nameInputRef = useRef(null);

  useEffect(() => {
    if (phase === "occasion") {
      speak("What occasion are you dressing for? Pick one so I can judge your outfit for it.");
      announce("Pick an occasion to dress for.", "polite");
    } else if (phase === "camera") {
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

  // The initial auto-speak is handled inside handleCapture.
  // This effect is intentionally left empty — no double-speak on phase change.

  // Focus the name input when naming phase starts or moves to next garment
  useEffect(() => {
    if (phase === "naming" && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [phase, namingIndex]);


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
      const occasionLabel = OCCASIONS.find(o => o.id === selectedOccasion)?.label || "";
      const analysis = await analyzeOutfit(base64, occasionLabel, language);
      const garments = analysis.raw?.garment_details || [];

      // If multiple garments detected, reject and ask user to scan one at a time
      if (garments.length > 1) {
        const msg = `I can see ${garments.length} items in this photo. Please scan one clothing item at a time for accurate wardrobe entries.`;
        announce(msg, "assertive");
        speak(msg);
        setPhase("error");
        setErrorMsg(msg);
        return;
      }

      playSuccessSound();
      setResult(analysis);
      setPhase("result");

      // Auto-speak the short description on arrival
      if (analysis.speech_segments?.length) {
        const segMap = {};
        for (const s of analysis.speech_segments) segMap[s.id] = s.text;
        const shortParts = [
          segMap["garments"],
          segMap["overall_verdict"],
          analysis.occasion_verdict,
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
  }, [speak, announce, language]);

  const doSave = useCallback(async (namesOverride) => {
    if (!result) return;
    setPhase("saving");
    announce("Saving to your wardrobe.", "polite");

    const names = namesOverride ?? customNames;

    // Use the LLM-generated wardrobe_description if present — it's a 3-4 sentence
    // identification-optimised description (type, exact colour, texture, fit, distinctive features).
    // Fall back to stitching TTS segments only if the field is missing (old API responses).
    let richDescription = result.wardrobe_description?.trim() || "";

    if (!richDescription) {
      const segMap = {};
      for (const seg of result.speech_segments || []) segMap[seg.id] = seg.text;
      function firstSentence(text) {
        if (!text) return "";
        const m = text.match(/[^.!?]+[.!?]/);
        return m ? m[0].trim() : text.split(" ").slice(0, 18).join(" ");
      }
      richDescription = [
        segMap["garments"] || "",
        firstSentence(segMap["color_feedback"] || ""),
        firstSentence(segMap["fit_feedback"] || ""),
      ].filter(Boolean).join(" ").replace(/\s{2,}/g, " ").trim();
    }

    const garments = result.raw?.garment_details || [];
    const g = garments[0]; // always single garment at this point

    try {
      await addItem({
        name: names[0]?.customName || g?.display_name || g?.label || "Item",
        type: g?.label || "item",
        category: inferCategory(g?.label),
        color: g?.hex_color || "#000000",
        colorDescription: g?.color_name || "",
        pattern: "solid",
        gender: "unisex",
        description: richDescription,
      });

      const savedMsg = RESPONSES.saved(names[0]?.customName || g?.display_name || "item");
      speak(savedMsg);
      announce(savedMsg, "polite");
      setTimeout(() => navigate(SCREENS.WARDROBE), 1500);
    } catch {
      speak(RESPONSES.error);
      setPhase("result");
    }
  }, [result, customNames, addItem, speak, navigate, announce]);

  const handleSave = useCallback(() => {
    if (!result) return;
    const garments = result.raw?.garment_details || [];
    const g = garments[0];

    // Check for duplicate
    if (g) {
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

    // Go to naming phase
    const detectedName = g?.color_name
      ? `${g.color_name} ${g.display_name || g.label || "item"}`
      : g?.display_name || g?.label || "item";
    const initial = [{ garment: g || {}, customName: "" }];
    setCustomNames(initial);
    setNamingIndex(0);
    const msg = `Before saving, would you like to give this a custom name? For example: white polo, black t-shirt, or camo cargo pants. Leave blank to keep the detected name: ${detectedName}.`;
    speak(msg);
    announce(msg, "polite");
    setPhase("naming");
  }, [result, wardrobeItems, speak, announce]);

  const reset = useCallback(() => {
    setResult(null);
    setPreviewUrl(null);
    setErrorMsg("");
    setDuplicateInfo(null);
    setSelectedOccasion(null);
    setPhase("occasion");
  }, []);

  /**
   * Short description: what they're wearing + overall verdict + occasion verdict.
   * Gives the user a quick gist without all the detail.
   */
  const speakShort = useCallback(() => {
    if (!result) return;
    const segMap = {};
    for (const s of result.speech_segments || []) segMap[s.id] = s.text;
    const parts = [
      segMap["garments"],
      segMap["overall_verdict"],
      result.occasion_verdict,
    ].filter(Boolean);
    if (parts.length) speak(parts.join("  "));
  }, [result, speak]);

  /**
   * Long description: full ordered breakdown — garments, color, fit, verdict,
   * top fix, then occasion verdict.
   */
  const speakLong = useCallback(() => {
    if (!result) return;
    const parts = (result.speech_segments || []).map((s) => s.text);
    if (result.occasion_verdict) parts.push(result.occasion_verdict);
    if (parts.length) speak(parts.join("  "));
  }, [result, speak]);

  // Voice command listener — placed after all callbacks to avoid TDZ in prod build
  useEffect(() => {
    const handler = (e) => {
      const cmd = e.detail;
      if (cmd.type === "SAVE_ITEM" && phase === "result") handleSave();
      else if (cmd.type === "DISCARD_ITEM" && phase === "result") reset();
      else if (cmd.type === "READ_RESULT" && phase === "result") speakLong();
    };
    window.addEventListener("voiceCommand", handler);
    return () => window.removeEventListener("voiceCommand", handler);
  }, [phase, handleSave, reset, speakLong]);

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

  // ── Occasion Picker ────────────────────────────────────────────────────────
  if (phase === "occasion") {
    return (
      <Screen title="What's the occasion?" subtitle="I'll judge your outfit for it.">
        <LiveRegions />
        <div style={{ marginBottom: 20 }}>
          <ChoiceList
            heading="Pick an occasion"
            items={OCCASIONS}
            selected={selectedOccasion}
            onSelect={setSelectedOccasion}
            announce={announce}
          />
        </div>
        <BigButton
          label="Scan Item"
          hint={selectedOccasion
            ? `Scan outfit for ${OCCASIONS.find(o => o.id === selectedOccasion)?.label}`
            : "Select an occasion first, then tap to scan"}
          icon="📸"
          variant="primary"
          disabled={!selectedOccasion}
          onClick={() => {
            const label = OCCASIONS.find(o => o.id === selectedOccasion)?.label || "";
            speak(`Got it. Scanning for ${label}. Point the camera at your outfit.`);
            setPhase("camera");
          }}
        />
        <div style={{ marginTop: 12 }}>
          <BigButton
            label="Back"
            hint="Go back to the main menu"
            icon="←"
            onClick={() => navigate(SCREENS.HOME)}
          />
        </div>
      </Screen>
    );
  }

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
            onClick={() => {
              setDuplicateInfo(null);
              const g = result.raw?.garment_details?.[0];
              const detectedName = g?.color_name
                ? `${g.color_name} ${g.display_name || g.label || "item"}`
                : g?.display_name || g?.label || "item";
              setCustomNames([{ garment: g || {}, customName: "" }]);
              setNamingIndex(0);
              const msg = `Would you like a custom name for this item? Detected as: ${detectedName}. Leave blank to keep it.`;
              speak(msg);
              announce(msg, "polite");
              setPhase("naming");
            }}
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

  // ── Custom Naming ──────────────────────────────────────────────────────────
  if (phase === "naming" && customNames.length > 0) {
    const current = customNames[0];
    const garment = current?.garment;
    const detectedName = garment?.color_name
      ? `${garment.color_name} ${garment.display_name || garment.label || "item"}`
      : garment?.display_name || garment?.label || "item";

    const commitName = (value) => {
      const updated = [{ ...current, customName: value.trim() }];
      doSave(updated);
    };

    return (
      <Screen title="Name Your Item" subtitle="Optional — you can skip this">
        <LiveRegions />
        <div
          role="region"
          aria-label="Custom name for this clothing item"
          style={{ marginBottom: 20 }}
        >
          <p style={{ fontFamily: FONT, fontSize: 15, color: C.muted, lineHeight: 1.7, marginBottom: 8 }}>
            Detected as: <strong style={{ color: C.text }}>{detectedName}</strong>
          </p>
          <p style={{ fontFamily: FONT, fontSize: 14, color: C.muted, lineHeight: 1.6, marginBottom: 16 }}>
            Tip: description + clothing type — e.g. <em style={{ color: C.focus }}>white polo</em>, <em style={{ color: C.focus }}>black t-shirt</em>, <em style={{ color: C.focus }}>camo cargo pants</em>.
          </p>
          <input
            ref={nameInputRef}
            type="text"
            value={current?.customName ?? ""}
            onChange={(e) => {
              setCustomNames([{ ...current, customName: e.target.value }]);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName(current?.customName ?? "");
            }}
            placeholder={`e.g. ${detectedName}`}
            aria-label={`Custom name for this item. Detected as ${detectedName}. Leave blank to keep detected name.`}
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: C.surface,
              border: `2px solid ${C.border}`,
              borderRadius: 12,
              padding: "14px 16px",
              fontFamily: FONT,
              fontSize: 16,
              color: C.text,
              outline: "none",
              marginBottom: 16,
            }}
            onFocus={(e) => e.target.style.borderColor = C.focus}
            onBlur={(e) => e.target.style.borderColor = C.border}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <BigButton
              label="Save to Wardrobe"
              hint={`Save with name: ${current?.customName?.trim() || detectedName}`}
              icon="✓"
              variant="success"
              onClick={() => commitName(current?.customName ?? "")}
            />
            <BigButton
              label="Skip — Keep Detected Name"
              hint={`Use the auto-detected name: ${detectedName}`}
              icon="↷"
              onClick={() => commitName("")}
            />
          </div>
        </div>
      </Screen>
    );
  }

  // ── Result ─────────────────────────────────────────────────────────────────
  const occasionLabel = OCCASIONS.find(o => o.id === selectedOccasion)?.label || "";
  const occasionVerdict = result?.occasion_verdict || "";

  // Build a plain-text context string for the follow-up chatbot
  const scanChatContext = result ? [
    occasionLabel && `Occasion: ${occasionLabel}`,
    ...(result.speech_segments || []).map((s) => s.text),
    occasionVerdict && `Occasion verdict: ${occasionVerdict}`,
  ].filter(Boolean).join("\n") : "";

  return (
    <Screen title="Outfit Analysis" subtitle={occasionLabel || "Analysis complete"}>
      <LiveRegions />

      {/* Hidden heading receives focus to announce result to screen readers */}
      <h2
        ref={resultHeadingRef}
        tabIndex={-1}
        aria-label={`Analysis complete${occasionLabel ? ` for ${occasionLabel}` : ""}.${occasionVerdict ? " " + occasionVerdict : ""}`}
        style={{ position: "absolute", left: -9999, top: "auto", width: 1, height: 1, overflow: "hidden" }}
      />

      {previewUrl && (
        <img
          src={previewUrl}
          alt="Your analyzed outfit"
          style={{ width: "100%", borderRadius: 16, marginBottom: 16, maxHeight: 320, objectFit: "cover" }}
        />
      )}

      {/* Occasion verdict card */}
      {occasionVerdict && (
        <div style={{
          background: C.surface, borderRadius: 14, padding: "16px 18px", marginBottom: 14,
          border: `2px solid ${C.focus}`,
        }}>
          <div style={{ fontFamily: FONT, fontSize: 11, color: C.focus, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 6 }}>
            {occasionLabel ? `${occasionLabel} verdict` : "Occasion verdict"}
          </div>
          <p style={{ fontFamily: FONT, fontSize: 15, color: C.text, lineHeight: 1.75, margin: 0 }}>
            {occasionVerdict}
          </p>
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

      {/* Follow-up chatbot — anchored to this scan result */}
      {scanChatContext && (
        <ContextChat
          context={scanChatContext}
          feature="scan"
          speak={speak}
          announce={announce}
        />
      )}

      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <BigButton
          label="Short Description"
          hint="Hear a quick summary: what you're wearing, the verdict, and whether it works for your occasion"
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

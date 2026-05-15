import { useState, useEffect, useCallback, useRef } from "react";
import Screen from "../components/Screen";
import BigButton from "../components/BigButton";
import CameraView from "../components/CameraView";
import { useAnnounce } from "../components/LiveRegions";
import { useApp } from "../contexts/AppContext";
import { useVoice } from "../contexts/VoiceContext";
import { useLocale } from "../contexts/LocaleContext";
import { useWardrobe } from "../contexts/WardrobeContext";
import { quickScan, ImageQualityError } from "../services/rizzVisionApi";
import { uploadClothingImage } from "../utils/storage";
import { SCREENS, C, FONT } from "../utils/constants";
import { RESPONSES } from "../voice/voiceResponses";

export default function ScanScreen() {
  const { navigate, descriptionMode, toggleDescriptionMode } = useApp();
  const { speak } = useVoice();
  const { language } = useLocale();
  const { addItem } = useWardrobe();
  const { announce, LiveRegions } = useAnnounce();

  // phase: camera | analyzing | naming | saving | error
  const [phase, setPhase] = useState("camera");
  const [previewUrl, setPreviewUrl] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [scanResult, setScanResult] = useState(null); // {suggested_name, category, short_description, color}
  const [customName, setCustomName] = useState("");
  const capturedBase64Ref = useRef(null);

  const captureRef = useRef(null);
  const describeRef = useRef(null);
  const nameInputRef = useRef(null);

  useEffect(() => {
    if (phase === "camera") {
      speak(RESPONSES.scanReady);
      announce(RESPONSES.scanReady, "polite");
    }
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase === "naming" && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [phase]);

  useEffect(() => {
    if (phase !== "naming" || !scanResult?.short_description) return;
    const desc = scanResult.short_description;
    speak(desc);
    announce(desc, "polite");
  }, [descriptionMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDescribe = useCallback((description) => {
    announce(description, "polite");
    speak(description);
  }, [speak, announce]);

  const handleCapture = useCallback(async (base64, dataUrl) => {
    setPhase("analyzing");
    setPreviewUrl(dataUrl);
    capturedBase64Ref.current = base64;
    announce("Identifying your clothing item. Please wait.", "polite");
    speak("Identifying the item. One moment.");

    try {
      const result = await quickScan(base64, language);
      setScanResult(result);
      setCustomName(result.suggested_name || "");

      const desc = result.short_description || result.suggested_name;
      speak(desc);
      announce(desc, "polite");
      setPhase("naming");
    } catch (err) {
      const msg = err instanceof ImageQualityError
        ? err.userMessage
        : "Could not identify the item. Please try a clearer photo.";
      setErrorMsg(msg);
      announce(msg, "assertive");
      speak(msg);
      setPhase("error");
    }
  }, [speak, announce, language]);

  const handleSave = useCallback(async () => {
    if (!scanResult) return;
    const name = customName.trim() || scanResult.suggested_name || "Clothing Item";
    setPhase("saving");
    announce("Saving to your wardrobe.", "polite");

    try {
      let imageUrl = null;
      if (capturedBase64Ref.current) {
        try {
          imageUrl = await uploadClothingImage(capturedBase64Ref.current);
        } catch {
          // image upload failure is non-fatal — save text data anyway
        }
      }

      await addItem({
        name,
        type: scanResult.category || "tops",
        category: scanResult.category || "tops",
        color: "",
        colorDescription: scanResult.color || "",
        pattern: "solid",
        gender: "unisex",
        description: scanResult.short_description || "",
        imageUrl,
      });

      const savedMsg = RESPONSES.saved(name);
      speak(savedMsg);
      announce(savedMsg, "polite");
      setTimeout(() => navigate(SCREENS.WARDROBE), 1500);
    } catch {
      speak(RESPONSES.error);
      setPhase("naming");
    }
  }, [scanResult, customName, addItem, speak, navigate, announce]);

  const reset = useCallback(() => {
    setScanResult(null);
    setPreviewUrl(null);
    setErrorMsg("");
    setCustomName("");
    capturedBase64Ref.current = null;
    setPhase("camera");
  }, []);

  // Voice commands
  useEffect(() => {
    const handler = (e) => {
      const cmd = e.detail;
      if (cmd.type === "SAVE_ITEM" && phase === "naming") handleSave();
      else if (cmd.type === "DISCARD_ITEM") reset();
      else if (cmd.type === "DESCRIBE_FRAME" && phase === "camera") describeRef.current?.();
    };
    window.addEventListener("voiceCommand", handler);
    return () => window.removeEventListener("voiceCommand", handler);
  }, [phase, handleSave, reset]);

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

  // ── Camera ──────────────────────────────────────────────────────────────────
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
            position: "absolute", bottom: 140, left: 0, right: 0,
            display: "flex", justifyContent: "center", zIndex: 10,
          }}>
            <label
              aria-label="Upload a photo from your gallery"
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

  // ── Analyzing / Saving ───────────────────────────────────────────────────────
  if (phase === "analyzing" || phase === "saving") {
    const subtitle = phase === "saving" ? "Saving to your wardrobe." : "Identifying your item…";
    return (
      <Screen title={phase === "saving" ? "Saving…" : "Identifying…"} subtitle={subtitle}>
        <LiveRegions />
        {previewUrl && (
          <img
            src={previewUrl}
            alt="Clothing item being identified"
            style={{ width: "100%", borderRadius: 16, marginBottom: 20, maxHeight: 320, objectFit: "cover" }}
          />
        )}
        <div role="status" aria-label={subtitle} style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 40, gap: 20 }}>
          <div aria-hidden="true" style={{
            width: 56, height: 56, borderRadius: "50%",
            border: `4px solid ${C.focus}`, borderTopColor: "transparent",
            animation: "spin 0.8s linear infinite",
          }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <p aria-live="polite" style={{ fontFamily: FONT, color: C.muted, fontSize: 15, margin: 0 }}>{subtitle}</p>
        </div>
      </Screen>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────
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
          <BigButton label="Read Error Again" hint="Hear the error message again" icon="🔊" onClick={() => speak(errorMsg)} />
        </div>
      </Screen>
    );
  }

  // ── Naming & Save ────────────────────────────────────────────────────────────
  return (
    <Screen title="Save to Wardrobe" subtitle="Name this item">
      <LiveRegions />

      {previewUrl && (
        <img
          src={previewUrl}
          alt="Clothing item to save"
          style={{ width: "100%", borderRadius: 16, marginBottom: 16, maxHeight: 280, objectFit: "cover" }}
        />
      )}

      {scanResult?.short_description && (() => {
        const displayDesc = scanResult.short_description;
        return (
          <>
            <div style={{
              background: C.surface, borderRadius: 14, padding: "14px 18px",
              border: `1px solid ${C.border}`, marginBottom: 12,
            }}>
              <p style={{ fontFamily: FONT, fontSize: 15, color: C.text, lineHeight: 1.75, margin: 0 }}>
                {displayDesc}
              </p>
            </div>
            <BigButton
              label={descriptionMode === "short" ? "Full Description" : "Brief Description"}
              hint={descriptionMode === "short" ? "Hear the complete description" : "Hear a shorter summary"}
              icon={descriptionMode === "short" ? "📋" : "🔊"}
              onClick={toggleDescriptionMode}
            />
            <div style={{ marginBottom: 8 }} />
          </>
        );
      })()}

      <div role="region" aria-label="Name this clothing item" style={{ marginBottom: 20 }}>
        <label
          htmlFor="item-name-input"
          style={{ fontFamily: FONT, fontSize: 13, color: C.muted, display: "block", marginBottom: 8 }}
        >
          Item name — tap to edit
        </label>
        <input
          id="item-name-input"
          ref={nameInputRef}
          type="text"
          value={customName}
          onChange={(e) => setCustomName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          placeholder={scanResult?.suggested_name || "e.g. Navy Blue Polo"}
          aria-label={`Name for this item. Current: ${customName || scanResult?.suggested_name || "untitled"}`}
          style={{
            width: "100%", boxSizing: "border-box",
            background: C.surface, border: `2px solid ${C.border}`,
            borderRadius: 12, padding: "14px 16px",
            fontFamily: FONT, fontSize: 16, color: C.text, outline: "none",
            marginBottom: 16,
          }}
          onFocus={(e) => e.target.style.borderColor = C.focus}
          onBlur={(e) => e.target.style.borderColor = C.border}
        />

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <BigButton
            label="Save to Wardrobe"
            hint={`Save as: ${customName.trim() || scanResult?.suggested_name || "Clothing Item"}`}
            icon="✓"
            variant="success"
            onClick={handleSave}
          />
          <BigButton
            label="Retake Photo"
            hint="Discard this and take a new photo"
            icon="📸"
            onClick={reset}
          />
        </div>
      </div>
    </Screen>
  );
}

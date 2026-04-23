/**
 * IdentifyScreen — Match a physical garment to a saved wardrobe item.
 *
 * The user points the camera at a piece of clothing they are holding.
 * The LLM compares the photo against all wardrobe item descriptions
 * and names the closest match with a confidence level.
 *
 * Entry points:
 *  - Wardrobe screen: "Identify a Garment" button
 *  - Outfit screen: "Identify an Item" button after suggestions are shown
 *    (navParams.hintItems can carry the specific items mentioned in the suggestion)
 */

import { useState, useCallback, useEffect } from "react";
import Screen from "../components/Screen";
import BigButton from "../components/BigButton";
import CameraView from "../components/CameraView";
import { useAnnounce } from "../components/LiveRegions";
import { useLocale } from "../contexts/LocaleContext";
import { useVoice } from "../contexts/VoiceContext";
import { useWardrobe } from "../contexts/WardrobeContext";
import { useApp } from "../contexts/AppContext";
import { identifyWardrobeItem } from "../services/rizzVisionApi";
import { C, FONT } from "../utils/constants";

const CONFIDENCE_COLOR = {
  high:   "#44CC77",
  medium: "#FFD600",
  low:    "#FF9933",
  none:   "#FF5555",
};

const CONFIDENCE_LABEL = {
  high:   "Strong match",
  medium: "Likely match",
  low:    "Possible match",
  none:   "No match found",
};

export default function IdentifyScreen() {
  const { language } = useLocale();
  const { speak } = useVoice();
  const { announce, LiveRegions } = useAnnounce();
  const { items: wardrobeItems } = useWardrobe();
  const { navParams } = useApp();

  // Optional: a subset of items the outfit screen suggested (to give the user context)
  const hintItems = navParams?.hintItems || null;

  const [phase, setPhase] = useState("camera"); // camera | identifying | result
  const [result, setResult] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);

  useEffect(() => {
    const intro = hintItems?.length
      ? `Point the camera at the garment you want to identify. I will match it to your wardrobe. The outfit suggestion mentioned: ${hintItems.join(", ")}.`
      : "Point the camera at a garment. I will tell you which saved item it is.";
    speak(intro);
    announce(intro, "polite");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCapture = useCallback(async (base64, dataUrl) => {
    if (wardrobeItems.length === 0) {
      const msg = "Your wardrobe is empty. Scan some clothing items first.";
      speak(msg);
      announce(msg, "assertive");
      return;
    }
    setPhase("identifying");
    setPreviewUrl(dataUrl);
    const msg = "Checking your wardrobe. One moment.";
    speak(msg);
    announce(msg, "polite");

    const res = await identifyWardrobeItem(base64, wardrobeItems, language);
    setResult(res);
    setPhase("result");
    speak(res.spoken);
    announce(res.spoken, "polite");
  }, [wardrobeItems, speak, announce, language]);

  const handleDescribe = useCallback((desc) => {
    speak(desc);
    announce(desc, "polite");
  }, [speak, announce]);

  const reset = useCallback(() => {
    setPhase("camera");
    setResult(null);
    setPreviewUrl(null);
    const msg = "Ready. Point the camera at another garment.";
    speak(msg);
    announce(msg, "polite");
  }, [speak, announce]);

  // ── Empty wardrobe ──────────────────────────────────────────────────────────
  if (wardrobeItems.length === 0) {
    return (
      <Screen title="Identify Garment" subtitle="No items in wardrobe.">
        <LiveRegions />
        <p style={{ fontFamily: FONT, fontSize: 17, color: C.muted, lineHeight: 1.7, marginBottom: 24 }}>
          Your wardrobe is empty. Scan some clothing items first so I can identify them.
        </p>
      </Screen>
    );
  }

  // ── Camera ──────────────────────────────────────────────────────────────────
  if (phase === "camera") {
    return (
      <>
        <LiveRegions />
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          {/* Info banner */}
          <div
            role="note"
            aria-label="Point at a garment to identify it from your wardrobe."
            style={{
              background: "rgba(0,0,0,0.72)",
              borderBottom: "1px solid rgba(255,255,255,0.12)",
              padding: "10px 16px",
              display: "flex", alignItems: "center", gap: 10,
              zIndex: 10,
            }}
          >
            <span aria-hidden style={{ fontSize: 18 }}>🔍</span>
            <div>
              <div style={{ fontFamily: "inherit", fontSize: 13, color: "#fff", fontWeight: 700, lineHeight: 1.3 }}>
                Identify a garment
              </div>
              <div style={{ fontFamily: "inherit", fontSize: 11, color: "rgba(255,255,255,0.55)", marginTop: 2 }}>
                {wardrobeItems.length} item{wardrobeItems.length !== 1 ? "s" : ""} in wardrobe to match against
              </div>
            </div>
          </div>

          {/* Hint strip — shown when arriving from outfit screen */}
          {hintItems?.length > 0 && (
            <div
              aria-label={`Outfit mentioned: ${hintItems.join(", ")}`}
              style={{
                background: `${C.focus}18`,
                borderBottom: `1px solid ${C.focus}44`,
                padding: "8px 16px",
              }}
            >
              <span style={{ fontFamily: FONT, fontSize: 12, color: C.focus }}>
                Outfit mentioned: {hintItems.join(" · ")}
              </span>
            </div>
          )}

          <CameraView
            onCapture={handleCapture}
            onDescribe={handleDescribe}
            onError={(msg) => { announce(msg, "assertive"); speak(msg); }}
          />
        </div>
      </>
    );
  }

  // ── Identifying ─────────────────────────────────────────────────────────────
  if (phase === "identifying") {
    return (
      <Screen title="Identifying..." subtitle="Matching against your wardrobe.">
        <LiveRegions />
        {previewUrl && (
          <img
            src={previewUrl}
            alt="Garment being identified"
            style={{ width: "100%", borderRadius: 16, marginBottom: 20, maxHeight: 320, objectFit: "cover" }}
          />
        )}
        <div
          role="status"
          aria-label="Matching garment to wardrobe. Please wait."
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
          <p style={{ fontFamily: FONT, color: C.muted, fontSize: 15, margin: 0 }}>
            Comparing to {wardrobeItems.length} saved item{wardrobeItems.length !== 1 ? "s" : ""}…
          </p>
        </div>
      </Screen>
    );
  }

  // ── Result ──────────────────────────────────────────────────────────────────
  const matchedItem = result?.matched_id
    ? wardrobeItems.find((i) => i.id === result.matched_id)
    : null;

  const confidenceColor = CONFIDENCE_COLOR[result?.confidence] || C.muted;
  const confidenceLabel = CONFIDENCE_LABEL[result?.confidence] || "Unknown";

  return (
    <Screen title="Match Result" subtitle={result?.matched_name ? `Found: ${result.matched_name}` : "No match found"}>
      <LiveRegions />

      {previewUrl && (
        <img
          src={previewUrl}
          alt="The garment you photographed"
          style={{ width: "100%", borderRadius: 16, marginBottom: 16, maxHeight: 280, objectFit: "cover" }}
        />
      )}

      {/* Confidence badge + spoken result */}
      <div
        role="region"
        aria-label="Identification result"
        style={{
          background: C.surface, borderRadius: 16, padding: 20,
          border: `2px solid ${confidenceColor}44`,
          marginBottom: 16,
        }}
      >
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          background: `${confidenceColor}22`,
          border: `1px solid ${confidenceColor}66`,
          borderRadius: 20, padding: "5px 14px",
          marginBottom: 14,
        }}>
          <div style={{
            width: 10, height: 10, borderRadius: "50%",
            background: confidenceColor, flexShrink: 0,
          }} />
          <span style={{ fontFamily: FONT, fontSize: 13, color: confidenceColor, fontWeight: 700 }}>
            {confidenceLabel}
          </span>
        </div>

        <p style={{ fontFamily: FONT, fontSize: 18, color: C.text, lineHeight: 1.75, margin: 0 }}>
          {result?.spoken}
        </p>
      </div>

      {/* Matched item detail card */}
      {matchedItem && (
        <div
          aria-label={`Matched item details: ${matchedItem.name}`}
          style={{
            background: C.surface, borderRadius: 14, padding: 16,
            border: `1px solid ${C.border}`, marginBottom: 16,
          }}
        >
          <div style={{ fontFamily: FONT, fontSize: 10, color: C.focus, textTransform: "uppercase", letterSpacing: "0.2em", marginBottom: 8 }}>
            From your wardrobe
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {matchedItem.color && (
              <div style={{
                width: 36, height: 36, borderRadius: "50%",
                background: matchedItem.color,
                border: `2px solid ${C.border}`,
                flexShrink: 0,
              }} />
            )}
            <div>
              <div style={{ fontFamily: FONT, fontSize: 17, color: C.text, fontWeight: 700 }}>
                {matchedItem.name}
              </div>
              <div style={{ fontFamily: FONT, fontSize: 13, color: C.muted, marginTop: 2 }}>
                {matchedItem.colorDescription || matchedItem.category} · {matchedItem.category}
              </div>
              {matchedItem.description && (
                <div style={{ fontFamily: FONT, fontSize: 13, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>
                  {matchedItem.description}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <BigButton
          label="Read Result Again"
          hint="Hear the identification result read aloud"
          icon="🔊"
          onClick={() => speak(result?.spoken || "No result.")}
        />
        <BigButton
          label="Try Another Garment"
          hint="Photograph a different garment to identify"
          icon="📸"
          variant="primary"
          onClick={reset}
        />
      </div>
    </Screen>
  );
}

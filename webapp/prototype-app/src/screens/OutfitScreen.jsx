import { useState, useEffect, useCallback } from "react";
import Screen from "../components/Screen";
import BigButton from "../components/BigButton";
import ChoiceList from "../components/ChoiceList";
import ContextChat from "../components/ContextChat";
import { useLocale } from "../contexts/LocaleContext";
import { useApp } from "../contexts/AppContext";
import { useVoice } from "../contexts/VoiceContext";
import { useAnnounce } from "../components/LiveRegions";
import { useWardrobe } from "../contexts/WardrobeContext";
import { getOutfitSuggestion } from "../services/outfitRecommendation";
import { OCCASIONS, SCREENS, C, FONT } from "../utils/constants";
import { RESPONSES } from "../voice/voiceResponses";

const MIN_WARDROBE_FOR_PAIRING = 5;

export default function OutfitScreen() {
  const { language } = useLocale();
  const { navParams, navigate } = useApp();
  const { speak } = useVoice();
  const { announce, LiveRegions } = useAnnounce();
  const { items } = useWardrobe();

  // phases: occasion → mode → loading → result
  const [phase, setPhase] = useState("occasion");
  const [occasion, setOccasion] = useState(null);
  const [suggestionMode, setSuggestionMode] = useState(null); // "wardrobe" | "general"
  const [result, setResult] = useState("");

  const anchorItem = navParams?.anchorItem || null;
  const canUseWardrobe = items.length >= MIN_WARDROBE_FOR_PAIRING;

  useEffect(() => {
    if (items.length === 0) {
      speak("Your wardrobe is empty. Add some items first by scanning clothing.");
      return;
    }
    if (anchorItem) {
      speak(`Building an outfit around your ${anchorItem.name}. What occasion are you dressing for?`);
    } else {
      speak(RESPONSES.outfitPrompt);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOccasionSelect = useCallback((id) => {
    setOccasion(id);
  }, []);

  const proceedFromOccasion = useCallback(() => {
    if (!occasion) return;
    if (canUseWardrobe) {
      setPhase("mode");
      speak("Would you like suggestions based on your wardrobe, or general advice?");
      announce("Choose suggestion type: wardrobe-based or general.", "polite");
    } else {
      setSuggestionMode("general");
      setPhase("loading");
    }
  }, [occasion, canUseWardrobe, speak, announce]);

  const generateOutfit = useCallback(async (mode) => {
    if (!occasion) return;
    setPhase("loading");
    speak(RESPONSES.generating);

    const occasionLabel = OCCASIONS.find(o => o.id === occasion)?.label || occasion;

    try {
      const response = await getOutfitSuggestion({
        items: mode === "general" ? [] : items,
        occasion: occasionLabel,
        anchorItem: mode === "general" ? null : anchorItem,
        mode,
        locale: language,
      });
      setResult(response);
      setPhase("result");
      speak(response);
    } catch {
      speak(RESPONSES.error);
      setPhase("occasion");
    }
  }, [occasion, items, anchorItem, speak, language]);

  const handleModeSelect = useCallback((mode) => {
    setSuggestionMode(mode);
    generateOutfit(mode);
  }, [generateOutfit]);

  useEffect(() => {
    const handler = (e) => {
      const cmd = e.detail;
      if (cmd.type === "SELECT_OCCASION" && phase === "occasion") {
        handleOccasionSelect(cmd.id);
        speak(OCCASIONS.find(o => o.id === cmd.id)?.label ?? cmd.id);
      } else if (cmd.type === "CONFIRM") {
        if (phase === "occasion" && occasion) proceedFromOccasion();
      } else if (cmd.type === "READ_RESULT" && phase === "result") {
        speak(result);
      }
    };
    window.addEventListener("voiceCommand", handler);
    return () => window.removeEventListener("voiceCommand", handler);
  }, [phase, occasion, result, handleOccasionSelect, proceedFromOccasion, speak]);

  if (items.length === 0) {
    return (
      <Screen title="Outfit Help" subtitle="You need items in your wardrobe first.">
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <p style={{ fontFamily: FONT, fontSize: 18, color: C.muted, lineHeight: 1.7, marginBottom: 24 }}>
            Scan some clothing items to build your wardrobe, then come back for outfit suggestions.
          </p>
          <BigButton
            label="Scan Clothing"
            icon="📸"
            variant="primary"
            onClick={() => navigate(SCREENS.SCAN)}
          />
        </div>
      </Screen>
    );
  }

  // ── Occasion picker ──────────────────────────────────────────────────────────
  if (phase === "occasion") {
    return (
      <Screen
        title="Outfit Help"
        subtitle={anchorItem ? `Building around: ${anchorItem.name}` : "What's the occasion?"}
      >
        <LiveRegions />
        <ChoiceList
          heading="Pick your occasion"
          items={OCCASIONS}
          selected={occasion}
          onSelect={handleOccasionSelect}
        />
        <div style={{ marginTop: 16 }}>
          <BigButton
            label="Next"
            hint="Continue to suggestion options"
            variant="primary"
            disabled={!occasion}
            onClick={proceedFromOccasion}
          />
        </div>
      </Screen>
    );
  }

  // ── Mode picker (only shown if 5+ wardrobe items) ────────────────────────────
  if (phase === "mode") {
    const occasionLabel = OCCASIONS.find(o => o.id === occasion)?.label || occasion;
    return (
      <Screen
        title="Outfit Help"
        subtitle={`For ${occasionLabel}`}
      >
        <LiveRegions />
        <p style={{ fontFamily: FONT, fontSize: 16, color: C.muted, lineHeight: 1.7, marginBottom: 24 }}>
          You have {items.length} items in your wardrobe. How would you like your suggestions?
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <button
            onClick={() => handleModeSelect("wardrobe")}
            aria-label="Use my wardrobe — pair items from my saved clothing"
            style={{
              background: C.surface,
              border: `2px solid ${C.focus}`,
              borderRadius: 18,
              padding: "20px 24px",
              textAlign: "left",
              cursor: "pointer",
              color: C.text,
              fontFamily: FONT,
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Based on My Wardrobe</div>
            <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.5 }}>
              Pairs specific items from your {items.length} saved pieces — tells you exactly what to wear together.
            </div>
          </button>
          <button
            onClick={() => handleModeSelect("general")}
            aria-label="General advice — broad styling tips for the occasion"
            style={{
              background: C.surface,
              border: `2px solid ${C.border}`,
              borderRadius: 18,
              padding: "20px 24px",
              textAlign: "left",
              cursor: "pointer",
              color: C.text,
              fontFamily: FONT,
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>General Advice</div>
            <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.5 }}>
              Broad styling tips and colour combinations for the occasion — not specific to your wardrobe.
            </div>
          </button>
        </div>
        <div style={{ marginTop: 16 }}>
          <BigButton
            label="Back"
            hint="Go back to occasion selection"
            onClick={() => setPhase("occasion")}
          />
        </div>
      </Screen>
    );
  }

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (phase === "loading") {
    return (
      <Screen title="Styling you up..." subtitle="Give me a second.">
        <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
          <div style={{
            width: 48, height: 48, borderRadius: "50%",
            border: `4px solid ${C.focus}`,
            borderTopColor: "transparent",
            animation: "spin 0.8s linear infinite",
          }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </Screen>
    );
  }

  // ── Result ───────────────────────────────────────────────────────────────────
  const occasionLabel = OCCASIONS.find(o => o.id === occasion)?.label || occasion;
  const outfitChatContext = result
    ? `Occasion: ${occasionLabel}\nSuggestion type: ${suggestionMode === "wardrobe" ? "wardrobe-based pairings" : "general advice"}\nOutfit suggestion: ${result}`
    : "";

  const mentionedItems = items
    .filter((item) => result && result.toLowerCase().includes(item.name.toLowerCase()))
    .map((item) => item.name);

  return (
    <Screen title="Your Outfit" subtitle={`For ${occasionLabel}`}>
      <LiveRegions />
      <div
        role="region"
        aria-label="Outfit suggestion"
        style={{
          background: C.surface, borderRadius: 16, padding: 20,
          border: `1px solid ${C.border}`, marginBottom: 16,
        }}
      >
        <p style={{
          fontFamily: FONT, fontSize: 18, color: C.text, lineHeight: 1.8, margin: 0,
        }}>{result}</p>
      </div>

      {outfitChatContext && (
        <ContextChat
          context={outfitChatContext}
          feature="outfit"
          speak={speak}
          announce={announce}
        />
      )}

      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <BigButton
          label="Read Again"
          hint="Hear the outfit suggestion again"
          icon="🔊"
          onClick={() => speak(result)}
        />
        {suggestionMode === "wardrobe" && mentionedItems.length > 0 && (
          <BigButton
            label="Identify an Item"
            hint="Point the camera at a garment to find out which saved item it is"
            icon="🔍"
            onClick={() => navigate(SCREENS.IDENTIFY, { hintItems: mentionedItems })}
          />
        )}
        <BigButton
          label="Try Different Options"
          hint="Choose a new occasion or suggestion type"
          icon="🔄"
          onClick={() => { setPhase("occasion"); setOccasion(null); setResult(""); setSuggestionMode(null); }}
        />
      </div>
    </Screen>
  );
}

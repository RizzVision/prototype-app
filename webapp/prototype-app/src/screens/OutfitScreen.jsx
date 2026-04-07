import { useState, useEffect, useCallback } from "react";
import Screen from "../components/Screen";
import BigButton from "../components/BigButton";
import ChoiceList from "../components/ChoiceList";
import { useApp } from "../contexts/AppContext";
import { useVoice } from "../contexts/VoiceContext";
import { useWardrobe } from "../contexts/WardrobeContext";
import { getOutfitSuggestion } from "../services/outfitRecommendation";
import { OCCASIONS, SCREENS, C, FONT } from "../utils/constants";
import { RESPONSES } from "../voice/voiceResponses";

function getShortSuggestion(text) {
  if (!text) return "";
  const sentences = text.split(". ");
  return sentences.length > 1 ? sentences[0] + ". " + sentences[1] + "." : sentences[0];
}

export default function OutfitScreen() {
  const { navParams, navigate, descriptionMode, toggleDescriptionMode } = useApp();
  const { speak } = useVoice();
  const { items } = useWardrobe();
  const [phase, setPhase] = useState("occasion"); // occasion | loading | result
  const [occasion, setOccasion] = useState(null);
  const [result, setResult] = useState("");

  const anchorItem = navParams?.anchorItem || null;

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

  const generateOutfit = useCallback(async () => {
    if (!occasion) return;
    setPhase("loading");
    speak(RESPONSES.generating);

    const occasionLabel = OCCASIONS.find(o => o.id === occasion)?.label || occasion;

    try {
      const response = await getOutfitSuggestion({
        items,
        occasion: occasionLabel,
        anchorItem,
      });
      setResult(response);
      setPhase("result");
      speak(descriptionMode === "short" ? getShortSuggestion(response) : response);
    } catch {
      speak(RESPONSES.error);
      setPhase("occasion");
    }
  }, [occasion, items, anchorItem, speak]);

  useEffect(() => {
    const handler = (e) => {
      const cmd = e.detail;
      if (cmd.type === "SELECT_OCCASION" && phase === "occasion") {
        handleOccasionSelect(cmd.id);
        speak(OCCASIONS.find(o => o.id === cmd.id)?.label ?? cmd.id);
      } else if (cmd.type === "CONFIRM") {
        if (phase === "occasion" && occasion) generateOutfit();
      } else if (cmd.type === "READ_RESULT" && phase === "result") {
        speak(descriptionMode === "short" ? getShortSuggestion(result) : result);
      }
    };
    window.addEventListener("voiceCommand", handler);
    return () => window.removeEventListener("voiceCommand", handler);
  }, [phase, occasion, result, handleOccasionSelect, generateOutfit, speak]);

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

  if (phase === "occasion") {
    return (
      <Screen
        title="Outfit Help"
        subtitle={anchorItem ? `Building around: ${anchorItem.name}` : "What's the occasion?"}
      >
        <ChoiceList
          heading="Pick your occasion"
          items={OCCASIONS}
          selected={occasion}
          onSelect={handleOccasionSelect}
        />
        <div style={{ marginTop: 16 }}>
          <BigButton
            label="Get My Outfit"
            hint="Generate outfit suggestions for the selected occasion"
            variant="primary"
            disabled={!occasion}
            onClick={generateOutfit}
          />
        </div>
      </Screen>
    );
  }

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

  // Result phase
  const displayedResult = descriptionMode === "short" ? getShortSuggestion(result) : result;

  return (
    <Screen title="Your Outfits" subtitle={`For ${OCCASIONS.find(o => o.id === occasion)?.label || occasion}`}>
      <div style={{
        background: C.surface, borderRadius: 16, padding: 20,
        border: `1px solid ${C.border}`, marginBottom: 20,
      }}>
        <pre style={{
          fontFamily: FONT, fontSize: 17, color: C.text, lineHeight: 1.8,
          whiteSpace: "pre-wrap", margin: 0,
        }}>{displayedResult}</pre>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <BigButton
          label="Read Again"
          hint="Hear the suggestions again"
          icon="🔊"
          onClick={() => speak(displayedResult)}
        />
        <BigButton
          label={descriptionMode === "short" ? "Switch to Long Description" : "Switch to Short Description"}
          hint={descriptionMode === "short"
            ? "Short summaries are on. Tap to switch to full descriptions."
            : "Full descriptions are on. Tap to switch to short summaries."}
          icon="📝"
          onClick={() => {
            toggleDescriptionMode();
            const msg = descriptionMode === "short"
              ? "Switched to long descriptions."
              : "Switched to short descriptions.";
            speak(msg);
            setTimeout(() => speak(descriptionMode === "short" ? result : getShortSuggestion(result)), 1200);
          }}
        />
        <BigButton
          label="Try Different Options"
          hint="Choose a new occasion"
          icon="🔄"
          onClick={() => { setPhase("occasion"); setOccasion(null); setResult(""); }}
        />
      </div>
    </Screen>
  );
}

import { useState, useEffect, useCallback } from "react";
import Screen from "../components/Screen";
import BigButton from "../components/BigButton";
import ChoiceList from "../components/ChoiceList";
import { useApp } from "../contexts/AppContext";
import { useVoice } from "../contexts/VoiceContext";
import { useWardrobe } from "../contexts/WardrobeContext";
import { getOutfitSuggestion } from "../services/outfitRecommendation";
import { OCCASIONS, MOODS, SCREENS, C, FONT } from "../utils/constants";
import { RESPONSES } from "../voice/voiceResponses";

export default function OutfitScreen() {
  const { navParams, navigate } = useApp();
  const { speak } = useVoice();
  const { items } = useWardrobe();
  const [phase, setPhase] = useState("occasion"); // occasion | mood | loading | result
  const [occasion, setOccasion] = useState(null);
  const [mood, setMood] = useState(null);
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

  useEffect(() => {
    const handler = (e) => {
      const cmd = e.detail;
      if (cmd.type === "SELECT_OCCASION" && phase === "occasion") {
        handleOccasionSelect(cmd.id);
        speak(OCCASIONS.find(o => o.id === cmd.id)?.label ?? cmd.id);
      } else if (cmd.type === "SELECT_MOOD" && phase === "mood") {
        handleMoodSelect(cmd.id);
        speak(MOODS.find(m => m.id === cmd.id)?.label ?? cmd.id);
      } else if (cmd.type === "CONFIRM") {
        if (phase === "occasion" && occasion) proceedToMood();
        else if (phase === "mood" && mood) generateOutfit();
      } else if (cmd.type === "READ_RESULT" && phase === "result") {
        speak(result);
      }
    };
    window.addEventListener("voiceCommand", handler);
    return () => window.removeEventListener("voiceCommand", handler);
  }, [phase, occasion, mood, result, handleOccasionSelect, handleMoodSelect, proceedToMood, generateOutfit, speak]);

  const handleOccasionSelect = useCallback((id) => {
    setOccasion(id);
  }, []);

  const handleMoodSelect = useCallback((id) => {
    setMood(id);
  }, []);

  const proceedToMood = useCallback(() => {
    if (!occasion) return;
    const label = OCCASIONS.find(o => o.id === occasion)?.label || occasion;
    speak(RESPONSES.moodPrompt(label));
    setPhase("mood");
  }, [occasion, speak]);

  const generateOutfit = useCallback(async () => {
    if (!mood) return;
    setPhase("loading");
    speak(RESPONSES.generating);

    const occasionLabel = OCCASIONS.find(o => o.id === occasion)?.label || occasion;
    const moodLabel = MOODS.find(m => m.id === mood)?.label || mood;

    try {
      const response = await getOutfitSuggestion({
        items,
        occasion: occasionLabel,
        mood: moodLabel,
        anchorItem,
      });
      setResult(response);
      setPhase("result");
      speak(response);
    } catch {
      speak(RESPONSES.error);
      setPhase("occasion");
    }
  }, [mood, occasion, items, anchorItem, speak]);

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
        subtitle={anchorItem ? `Building around: ${anchorItem.name}` : "What occasion are you dressing for?"}
      >
        <ChoiceList
          heading="Occasion"
          items={OCCASIONS}
          selected={occasion}
          onSelect={handleOccasionSelect}
        />
        <div style={{ marginTop: 16 }}>
          <BigButton
            label="Next"
            variant="primary"
            disabled={!occasion}
            onClick={proceedToMood}
          />
        </div>
      </Screen>
    );
  }

  if (phase === "mood") {
    return (
      <Screen title="Outfit Help" subtitle="What vibe are you going for?">
        <ChoiceList
          heading="Mood"
          items={MOODS}
          selected={mood}
          onSelect={handleMoodSelect}
        />
        <div style={{ marginTop: 16 }}>
          <BigButton
            label="Get Suggestions"
            variant="primary"
            disabled={!mood}
            onClick={generateOutfit}
          />
        </div>
      </Screen>
    );
  }

  if (phase === "loading") {
    return (
      <Screen title="Thinking..." subtitle="Putting together some looks for you.">
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
  return (
    <Screen title="Your Outfits" subtitle={`For ${OCCASIONS.find(o => o.id === occasion)?.label || occasion}`}>
      <div style={{
        background: C.surface, borderRadius: 16, padding: 20,
        border: `1px solid ${C.border}`, marginBottom: 20,
      }}>
        <pre style={{
          fontFamily: FONT, fontSize: 17, color: C.text, lineHeight: 1.8,
          whiteSpace: "pre-wrap", margin: 0,
        }}>{result}</pre>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <BigButton
          label="Try Different Options"
          hint="Choose a new occasion and mood"
          icon="🔄"
          onClick={() => { setPhase("occasion"); setOccasion(null); setMood(null); setResult(""); }}
        />
        <BigButton
          label="Read Again"
          hint="Hear the suggestions again"
          icon="🔊"
          onClick={() => speak(result)}
        />
      </div>
    </Screen>
  );
}

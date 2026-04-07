import { useEffect, useRef } from "react";
import Screen from "../components/Screen";
import BigButton from "../components/BigButton";
import MicButton from "../components/MicButton";
import { useApp } from "../contexts/AppContext";
import { useAuth } from "../contexts/AuthContext";
import { useVoice } from "../contexts/VoiceContext";
import { SCREENS } from "../utils/constants";
import { RESPONSES } from "../voice/voiceResponses";

export default function HomeScreen() {
  const { navigate, descriptionMode, toggleDescriptionMode } = useApp();
  const { signOut } = useAuth();
  const { speak, isListening, toggleListening } = useVoice();

  useEffect(() => {
    const timer = setTimeout(() => speak(RESPONSES.welcome), 400);
    return () => clearTimeout(timer);
  }, [speak]);

  // Only speak tips when mic transitions from off → on (not on initial mount)
  const prevListeningRef = useRef(null);
  useEffect(() => {
    if (prevListeningRef.current === false && isListening) {
      speak("You can say things like: identify my outfit, what should I wear, my wardrobe, mirror, or shopping mode.");
    }
    prevListeningRef.current = isListening;
  }, [isListening, speak]);

  return (
    <Screen title="Rizzvision" subtitle="Your fashion assistant. Tap or speak.">
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        gap: 20, marginTop: 16,
      }}>
        <MicButton
          isListening={isListening}
          onClick={toggleListening}
          size={120}
        />

        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          style={{ fontSize: 14, color: "#888", textAlign: "center", marginBottom: 8 }}
        >
          {isListening ? "Listening — say a command" : "Tap to start listening"}
        </div>

        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 14 }}>
          <BigButton
            label="Scan Clothing"
            hint="Identify and save items to your wardrobe. Use this to build your collection."
            icon="📸"
            variant="primary"
            onClick={() => navigate(SCREENS.SCAN)}
          />
          <BigButton
            label="Get Outfit Help"
            hint="Get outfit recommendations from your wardrobe"
            icon="👔"
            onClick={() => navigate(SCREENS.OUTFIT)}
          />
          <BigButton
            label="My Wardrobe"
            hint="View and manage your saved clothing items"
            icon="🗄️"
            onClick={() => navigate(SCREENS.WARDROBE)}
          />
        </div>

        <div style={{
          width: "100%", display: "flex", gap: 14, marginTop: 8,
        }}>
          <div style={{ flex: 1 }}>
            <BigButton
              label="Shopping Mode"
              hint="Get real-time feedback while shopping"
              icon="🛍️"
              onClick={() => navigate(SCREENS.SHOPPING)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <BigButton
              label="Mirror"
              hint="Check today's outfit before going out. No saving — instant feedback only."
              icon="🪞"
              onClick={() => navigate(SCREENS.MIRROR)}
            />
          </div>
        </div>

        <BigButton
          label={descriptionMode === "short" ? "Description: Short" : "Description: Long"}
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
          }}
        />

        <div style={{ marginTop: 8 }}>
          <BigButton
            label="Sign Out"
            hint="Sign out of your account"
            icon="→"
            variant="danger"
            onClick={signOut}
          />
        </div>
      </div>
    </Screen>
  );
}

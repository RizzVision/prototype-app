import { useEffect } from "react";
import Screen from "../components/Screen";
import BigButton from "../components/BigButton";
import MicButton from "../components/MicButton";
import { useApp } from "../contexts/AppContext";
import { useAuth } from "../contexts/AuthContext";
import { useVoice } from "../contexts/VoiceContext";
import { SCREENS } from "../utils/constants";
import { RESPONSES } from "../voice/voiceResponses";

export default function HomeScreen() {
  const { navigate } = useApp();
  const { signOut } = useAuth();
  const { speak, isListening, toggleListening } = useVoice();

  useEffect(() => {
    const timer = setTimeout(() => speak(RESPONSES.welcome), 500);
    return () => clearTimeout(timer);
  }, [speak]);

  useEffect(() => {
    if (isListening) speak("Try: scan clothing, my wardrobe, outfit help, shopping mode, or mirror.");
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
            hint="Open camera to identify a clothing item"
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
              hint="Get an honest assessment of your outfit"
              icon="🪞"
              onClick={() => navigate(SCREENS.MIRROR)}
            />
          </div>
        </div>

        <div style={{ marginTop: 24 }}>
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

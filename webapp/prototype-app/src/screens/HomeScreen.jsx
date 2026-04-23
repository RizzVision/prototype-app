import { useEffect } from "react";
import Screen from "../components/Screen";
import BigButton from "../components/BigButton";
import MicButton from "../components/MicButton";
import { useApp } from "../contexts/AppContext";
import { useAuth } from "../contexts/AuthContext";
import { useLocale } from "../contexts/LocaleContext";
import { useVoice } from "../contexts/VoiceContext";
import { SCREENS } from "../utils/constants";
import { RESPONSES } from "../voice/voiceResponses";

export default function HomeScreen() {
  const { navigate } = useApp();
  const { signOut } = useAuth();
  const { t } = useLocale();
  const { speak, isListening, isThinking, toggleListening } = useVoice();

  useEffect(() => {
    const timer = setTimeout(() => speak(RESPONSES.welcome), 500);
    return () => clearTimeout(timer);
  }, [speak]);

  useEffect(() => {
    try {
      const alreadyPrompted = localStorage.getItem("rizzv_language_hint_given") === "1";
      if (alreadyPrompted) return;

      const id = setTimeout(() => {
        speak(t("home.languageVoiceHint"));
        localStorage.setItem("rizzv_language_hint_given", "1");
      }, 1800);

      return () => clearTimeout(id);
    } catch {
      // Ignore storage errors; voice hint remains best-effort.
    }
  }, [speak, t]);

  useEffect(() => {
    if (isListening) speak(t("home.listeningHelp"));
  }, [isListening, speak, t]);

  return (
    <Screen title={t("home.title")} subtitle={t("home.subtitle")}>
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
          {isThinking ? t("home.statusThinking") : isListening ? t("home.statusListening") : t("home.statusIdle")}
        </div>

        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 14 }}>
          <BigButton
            label={t("home.scanLabel")}
            hint={t("home.scanHint")}
            icon="📸"
            variant="primary"
            onClick={() => navigate(SCREENS.SCAN)}
          />
          <BigButton
            label={t("home.outfitLabel")}
            hint={t("home.outfitHint")}
            icon="👔"
            onClick={() => navigate(SCREENS.OUTFIT)}
          />
          <BigButton
            label={t("home.wardrobeLabel")}
            hint={t("home.wardrobeHint")}
            icon="🗄️"
            onClick={() => navigate(SCREENS.WARDROBE)}
          />
        </div>

        <div style={{
          width: "100%", display: "flex", gap: 14, marginTop: 8,
        }}>
          <div style={{ flex: 1 }}>
            <BigButton
              label={t("home.shoppingLabel")}
              hint={t("home.shoppingHint")}
              icon="🛍️"
              onClick={() => navigate(SCREENS.SHOPPING)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <BigButton
              label={t("home.mirrorLabel")}
              hint={t("home.mirrorHint")}
              icon="🪞"
              onClick={() => navigate(SCREENS.MIRROR)}
            />
          </div>
        </div>

        <div style={{ marginTop: 24 }}>
          <BigButton
            label={t("home.signOutLabel")}
            hint={t("home.signOutHint")}
            icon="→"
            variant="danger"
            onClick={signOut}
          />
        </div>
      </div>
    </Screen>
  );
}

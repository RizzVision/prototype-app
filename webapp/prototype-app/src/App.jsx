import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { AppProvider, useApp } from "./contexts/AppContext";
import { WardrobeProvider } from "./contexts/WardrobeContext";
import { VoiceProvider, useVoice } from "./contexts/VoiceContext";
import { useAnnounce } from "./components/LiveRegions";
import VoiceStatus from "./components/VoiceStatus";
import AuthScreen from "./screens/AuthScreen";
import AuthCallbackScreen from "./screens/AuthCallbackScreen";
import HomeScreen from "./screens/HomeScreen";
import ScanScreen from "./screens/ScanScreen";
import WardrobeScreen from "./screens/WardrobeScreen";
import OutfitScreen from "./screens/OutfitScreen";
import ShoppingScreen from "./screens/ShoppingScreen";
import MirrorScreen from "./screens/MirrorScreen";
import EditItemScreen from "./screens/EditItemScreen";
import { SCREENS, C, FONT } from "./utils/constants";
import { playNav } from "./utils/sounds";

const SCREEN_TITLES = {
  [SCREENS.HOME]:      "Home",
  [SCREENS.SCAN]:      "Scan Clothing",
  [SCREENS.WARDROBE]:  "My Wardrobe",
  [SCREENS.OUTFIT]:    "Outfit Help",
  [SCREENS.SHOPPING]:  "Shopping Mode",
  [SCREENS.MIRROR]:    "Mirror",
  [SCREENS.EDIT_ITEM]: "Edit Item",
};

function ScreenRouter() {
  const { screen } = useApp();

  switch (screen) {
    case SCREENS.HOME:     return <HomeScreen />;
    case SCREENS.SCAN:     return <ScanScreen />;
    case SCREENS.WARDROBE: return <WardrobeScreen />;
    case SCREENS.OUTFIT:   return <OutfitScreen />;
    case SCREENS.SHOPPING: return <ShoppingScreen />;
    case SCREENS.MIRROR:   return <MirrorScreen />;
    case SCREENS.EDIT_ITEM: return <EditItemScreen />;
    default:               return <HomeScreen />;
  }
}

function StatusIndicator() {
  const { isListening, isSpeaking } = useVoice();
  return <VoiceStatus isListening={isListening} isSpeaking={isSpeaking} />;
}

function BackButton() {
  const { screen, canGoBack, goBack } = useApp();
  const isFullScreen = screen === SCREENS.SCAN || screen === SCREENS.SHOPPING || screen === SCREENS.MIRROR;

  if (!canGoBack) return null;

  if (isFullScreen) {
    return (
      <button
        onClick={goBack}
        aria-label="Go back to previous screen"
        style={{
          position: "absolute", top: 16, left: 16, zIndex: 50,
          background: "rgba(0,0,0,0.6)",
          border: `2px solid ${C.border}`,
          borderRadius: 14,
          color: C.text,
          fontFamily: FONT,
          fontSize: 16,
          fontWeight: 700,
          padding: "10px 18px",
          cursor: "pointer",
          display: "flex", alignItems: "center", gap: 8,
        }}
      >
        <span aria-hidden>←</span> Back
      </button>
    );
  }

  return (
    <div style={{ padding: "12px 20px 0", flexShrink: 0 }}>
      <button
        onClick={goBack}
        aria-label="Go back to previous screen"
        style={{
          background: "transparent",
          border: `2px solid ${C.border}`,
          borderRadius: 14,
          color: C.text,
          fontFamily: FONT,
          fontSize: 16,
          fontWeight: 700,
          padding: "10px 18px",
          cursor: "pointer",
          display: "flex", alignItems: "center", gap: 8,
        }}
      >
        <span aria-hidden>←</span> Back
      </button>
    </div>
  );
}

function SkipLink() {
  const [focused, setFocused] = useState(false);
  return (
    <a
      href="#main"
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        position: focused ? "static" : "absolute",
        left: focused ? "auto" : -9999,
        background: C.focus,
        color: "#000",
        fontFamily: FONT,
        fontWeight: 700,
        fontSize: 16,
        padding: "12px 20px",
        zIndex: 200,
        borderRadius: 8,
        textDecoration: "none",
        display: "block",
      }}
    >
      Skip to main content
    </a>
  );
}

function AppShell() {
  const { announce, LiveRegions } = useAnnounce();
  const { screen } = useApp();

  // On every screen change: update document title, announce new screen, move focus to <main>
  useEffect(() => {
    const label = SCREEN_TITLES[screen] ?? "Rizzvision";
    document.title = `${label} — Rizzvision`;
    playNav();
    announce(label, "assertive");
    // Small delay allows the new screen's DOM to render before focusing
    const id = setTimeout(() => {
      document.getElementById("main")?.focus();
    }, 100);
    return () => clearTimeout(id);
  }, [screen, announce]);

  const handleScreenCommand = useCallback((cmd) => {
    window.dispatchEvent(new CustomEvent("voiceCommand", { detail: cmd }));
  }, []);

  return (
    <VoiceProvider announce={announce} onScreenCommand={handleScreenCommand}>
      <div style={{
        width: "100%", maxWidth: 430, margin: "0 auto",
        height: "100vh", background: C.bg,
        display: "flex", flexDirection: "column",
        fontFamily: FONT, overflow: "hidden",
        position: "relative",
      }}>
        <SkipLink />
        <LiveRegions />
        <StatusIndicator />
        <BackButton />
        <ScreenRouter />
      </div>
    </VoiceProvider>
  );
}

function AuthGate() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{
        width: "100%", maxWidth: 430, margin: "0 auto",
        height: "100vh", background: C.bg,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        fontFamily: FONT,
      }}>
        <div role="status" aria-label="Loading, please wait">
          <div
            aria-hidden="true"
            style={{
              width: 48, height: 48, borderRadius: "50%",
              border: `4px solid ${C.focus}`,
              borderTopColor: "transparent",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div style={{
        width: "100%", maxWidth: 430, margin: "0 auto",
        height: "100vh", background: C.bg,
        display: "flex", flexDirection: "column",
        fontFamily: FONT, overflow: "hidden",
      }}>
        <AuthScreen />
      </div>
    );
  }

  return (
    <AppProvider>
      <WardrobeProvider>
        <AppShell />
      </WardrobeProvider>
    </AppProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<AuthGate />} />
        <Route path="/auth/callback" element={<AuthCallbackScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}

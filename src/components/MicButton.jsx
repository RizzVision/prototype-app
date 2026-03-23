import { C, FONT } from "../utils/constants";

const prefersReducedMotion = typeof window !== "undefined"
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function MicButton({ isListening, onClick, size = 120 }) {
  return (
    <button
      onClick={onClick}
      aria-label={isListening ? "Stop listening. Tap to stop voice input." : "Start listening. Tap to speak a command."}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: isListening
          ? `linear-gradient(135deg, ${C.focus}, #cc9900)`
          : C.surface,
        border: `3px solid ${isListening ? C.focus : C.border}`,
        color: isListening ? "#000" : C.text,
        fontSize: size * 0.35,
        fontWeight: 900,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        animation: (isListening && !prefersReducedMotion) ? "pulse 1.5s ease infinite, ripple 1.5s ease infinite" : "none",
        transition: "background 0.2s, border-color 0.2s",
        WebkitTapHighlightColor: "rgba(255,214,0,0.25)",
        flexShrink: 0,
      }}
    >
      <span aria-hidden style={{ fontSize: size * 0.4 }}>
        {isListening ? "..." : "🎤"}
      </span>
    </button>
  );
}

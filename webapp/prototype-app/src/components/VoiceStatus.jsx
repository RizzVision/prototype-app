import { C, FONT } from "../utils/constants";

/**
 * Fixed-position status pill showing the current voice state.
 * Three states: listening (yellow), thinking/processing (orange), speaking (green).
 * All states have ARIA live region so screen readers also get the change.
 */
export default function VoiceStatus({ isListening, isSpeaking, isThinking }) {
  const active = isThinking || isListening || isSpeaking;
  if (!active) return null;

  const label = isThinking ? "Thinking..." : isListening ? "Listening..." : "Speaking...";
  const color = isThinking ? "#FF8C00" : isListening ? C.focus : C.success;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={label}
      style={{
        position: "fixed",
        top: 12,
        right: 12,
        background: C.surface,
        border: `2px solid ${color}`,
        borderRadius: 24,
        padding: "8px 16px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        zIndex: 100,
        animation: "fadeUp 0.2s ease",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: color,
          animation: isThinking
            ? "spin 0.9s linear infinite"
            : "pulse 1s ease infinite",
        }}
      />
      <span style={{ fontFamily: FONT, fontSize: 13, color, fontWeight: 700 }}>
        {label}
      </span>
      <style>{`
        @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.35 } }
        @keyframes spin  { to { transform: rotate(360deg) } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(-4px) } to { opacity:1; transform:translateY(0) } }
      `}</style>
    </div>
  );
}

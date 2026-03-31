import { C, FONT } from "../utils/constants";

export default function VoiceStatus({ isListening, isSpeaking }) {
  if (!isListening && !isSpeaking) return null;

  const label = isListening ? "Listening..." : "Speaking...";
  const color = isListening ? C.focus : C.success;

  return (
    <div
      role="status"
      aria-live="polite"
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
      <div style={{
        width: 10, height: 10, borderRadius: "50%",
        background: color,
        animation: "pulse 1s ease infinite",
      }} />
      <span style={{ fontFamily: FONT, fontSize: 13, color, fontWeight: 700 }}>
        {label}
      </span>
    </div>
  );
}

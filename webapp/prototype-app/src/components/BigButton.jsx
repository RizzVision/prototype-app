import { C, FONT } from "../utils/constants";

export default function BigButton({ label, hint, icon, onClick, variant = "default", disabled, type = "button" }) {
  const bg = variant === "primary"  ? C.focus
           : variant === "success"  ? C.success
           : variant === "danger"   ? C.danger
           : C.surface;
  const fg = (variant === "primary" || variant === "success") ? "#000" : C.text;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={hint ? `${label}. ${hint}` : label}
      aria-disabled={disabled}
      style={{
        width: "100%",
        minHeight: 88,
        background: disabled ? "#1A1A1A" : bg,
        border: `2px solid ${disabled ? C.border : variant === "default" ? C.border : bg}`,
        borderRadius: 20,
        color: disabled ? C.muted : fg,
        fontFamily: FONT,
        fontSize: 20,
        fontWeight: 800,
        letterSpacing: "0.02em",
        cursor: disabled ? "not-allowed" : "pointer",
        display: "flex",
        alignItems: "center",
        gap: 18,
        padding: "0 28px",
        textAlign: "left",
        transition: "opacity 0.15s",
        opacity: disabled ? 0.45 : 1,
        WebkitTapHighlightColor: "rgba(255,214,0,0.25)",
      }}
    >
      {icon && <span aria-hidden style={{ fontSize: 34, flexShrink: 0 }}>{icon}</span>}
      <span style={{ flex: 1 }}>{label}</span>
    </button>
  );
}

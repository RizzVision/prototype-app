import { C, FONT } from "../utils/constants";

export default function ChoiceList({ heading, items, selected, onSelect, announce }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div
        role="heading" aria-level={2}
        style={{
          fontFamily: FONT, fontSize: 13, fontWeight: 700, color: C.focus,
          letterSpacing: "0.22em", textTransform: "uppercase", marginBottom: 12,
        }}
      >{heading}</div>

      <div role="radiogroup" aria-label={heading}
        style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map(item => {
          const isSelected = selected === item.id;
          return (
            <button
              key={item.id}
              role="radio"
              aria-checked={isSelected}
              aria-label={`${item.label}${item.desc ? ". " + item.desc : ""}${isSelected ? ". Selected." : ""}`}
              onClick={() => {
                onSelect(item.id);
                if (announce) announce(`${item.label} selected.`, "assertive");
              }}
              style={{
                width: "100%",
                minHeight: 80,
                background: isSelected ? "rgba(255,214,0,0.10)" : C.surface,
                border: `2px solid ${isSelected ? C.focus : C.border}`,
                borderRadius: 18,
                color: isSelected ? C.focus : C.text,
                fontFamily: FONT,
                fontSize: 19,
                fontWeight: isSelected ? 800 : 500,
                display: "flex",
                alignItems: "center",
                gap: 16,
                padding: "0 22px",
                textAlign: "left",
                cursor: "pointer",
                WebkitTapHighlightColor: "rgba(255,214,0,0.2)",
              }}
            >
              {item.icon && <span aria-hidden style={{ fontSize: 28, flexShrink: 0 }}>{item.icon}</span>}
              <div style={{ flex: 1 }}>
                <div>{item.label}</div>
                {item.desc && (
                  <div style={{ fontSize: 14, color: isSelected ? "#ccaa00" : C.muted, marginTop: 3, fontWeight: 400 }}>
                    {item.desc}
                  </div>
                )}
              </div>
              <div aria-hidden style={{
                width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                border: `2px solid ${isSelected ? C.focus : "#444"}`,
                background: isSelected ? C.focus : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 17, color: "#000", fontWeight: 900,
              }}>{isSelected ? "✓" : ""}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

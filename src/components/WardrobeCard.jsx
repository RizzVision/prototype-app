import { useState, useEffect } from "react";
import { C, FONT } from "../utils/constants";
import { getImageUrl } from "../utils/storage";

export default function WardrobeCard({ item, onTap, onDelete }) {
  const desc = `${item.color} ${item.pattern || ""} ${item.type}`.trim();
  const [thumbUrl, setThumbUrl] = useState(null);

  useEffect(() => {
    if (item.imageUrl) {
      getImageUrl(item.imageUrl).then(url => setThumbUrl(url));
    }
  }, [item.imageUrl]);

  return (
    <div style={{
      display: "flex", gap: 12, alignItems: "center",
      animation: "fadeUp 0.25s ease",
    }}>
      <button
        onClick={() => onTap(item)}
        aria-label={`${item.name}. ${desc}. Tap to hear description.`}
        style={{
          flex: 1,
          minHeight: 84,
          background: C.surface,
          border: `2px solid ${C.border}`,
          borderRadius: 18,
          color: C.text,
          fontFamily: FONT,
          fontSize: 18,
          fontWeight: 600,
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "14px 22px",
          textAlign: "left",
          cursor: "pointer",
          WebkitTapHighlightColor: "rgba(255,214,0,0.2)",
        }}
      >
        {thumbUrl && (
          <img
            src={thumbUrl}
            alt={item.name}
            style={{
              width: 48, height: 48, borderRadius: 10,
              objectFit: "cover", flexShrink: 0,
            }}
          />
        )}
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700 }}>{item.name}</div>
          <div style={{ fontSize: 14, color: C.muted, marginTop: 4 }}>{desc}</div>
        </div>
        <span aria-hidden style={{ fontSize: 22, color: C.muted }}>🔊</span>
      </button>
      {onDelete && (
        <button
          onClick={() => onDelete(item.id)}
          aria-label={`Delete ${item.name}`}
          style={{
            width: 48, height: 48, borderRadius: 14, flexShrink: 0,
            background: "transparent", border: `2px solid ${C.danger}`,
            color: C.danger, fontSize: 20, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >✕</button>
      )}
    </div>
  );
}

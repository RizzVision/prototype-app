import { useState, useEffect } from "react";
import { C, FONT } from "../utils/constants";
import { getImageUrl } from "../utils/storage";

export default function WardrobeCard({ item, onTap, onDelete, onEdit }) {
  const [thumbUrl, setThumbUrl] = useState(null);

  useEffect(() => {
    if (!item.imageUrl) return;
    let cancelled = false;
    getImageUrl(item.imageUrl)
      .then((url) => { if (!cancelled) setThumbUrl(url); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [item.imageUrl]);

  const subtitle = item.description
    || `${item.colorDescription || item.color || ""} ${item.pattern || ""} ${item.type || item.category || ""}`.trim();

  return (
    <div style={{
      display: "flex", gap: 12, alignItems: "center",
      animation: "fadeUp 0.25s ease",
    }}>
      <button
        onClick={() => onTap(item)}
        aria-label={`${item.name}. ${subtitle}. Tap to hear full description.`}
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
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt=""
            aria-hidden
            style={{
              width: 52, height: 52, borderRadius: 10,
              objectFit: "cover", flexShrink: 0,
            }}
          />
        ) : (
          <div aria-hidden style={{
            width: 52, height: 52, borderRadius: 10, flexShrink: 0,
            background: C.border, display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: 22,
          }}>
            👕
          </div>
        )}
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700 }}>{item.name}</div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>
            {subtitle.length > 80 ? subtitle.slice(0, 80) + "…" : subtitle}
          </div>
        </div>
        <span aria-hidden style={{ fontSize: 22, color: C.muted }}>🔊</span>
      </button>
      {(onEdit || onDelete) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
          {onEdit && (
            <button
              onClick={() => onEdit(item)}
              aria-label={`Edit ${item.name}`}
              style={{
                width: 48, height: 48, borderRadius: 14,
                background: "transparent", border: `2px solid ${C.focus}`,
                color: C.focus, fontSize: 18, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >✎</button>
          )}
          {onDelete && (
            <button
              onClick={() => onDelete(item.id)}
              aria-label={`Delete ${item.name}`}
              style={{
                width: 48, height: 48, borderRadius: 14,
                background: "transparent", border: `2px solid ${C.danger}`,
                color: C.danger, fontSize: 20, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >✕</button>
          )}
        </div>
      )}
    </div>
  );
}

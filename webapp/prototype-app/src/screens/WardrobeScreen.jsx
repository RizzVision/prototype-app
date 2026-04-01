import { useState, useEffect, useCallback } from "react";
import Screen from "../components/Screen";
import BigButton from "../components/BigButton";
import WardrobeCard from "../components/WardrobeCard";
import { useWardrobe } from "../contexts/WardrobeContext";
import { useVoice } from "../contexts/VoiceContext";
import { useApp } from "../contexts/AppContext";
import { SCREENS, C, FONT, CATEGORIES } from "../utils/constants";
import { RESPONSES } from "../voice/voiceResponses";

export default function WardrobeScreen() {
  const { items, loading, removeItem, removeLast } = useWardrobe();
  const { speak } = useVoice();
  const { navigate } = useApp();
  const [filter, setFilter] = useState(null);

  const filtered = filter ? items.filter(i => i.category === filter) : items;

  useEffect(() => {
    if (items.length === 0) {
      speak(RESPONSES.wardrobeEmpty);
    } else {
      speak(RESPONSES.wardrobeCount(items.length));
    }
  }, [items, speak]);

  const readAll = useCallback(() => {
    if (filtered.length === 0) {
      speak(RESPONSES.wardrobeEmpty);
      return;
    }
    const text = filtered.map((item, i) =>
      `Item ${i + 1}: ${item.name}. ${item.color} ${item.pattern || ""} ${item.type || item.category}.`
    ).join(" ");
    speak(`You have ${filtered.length} items. ${text}`);
  }, [filtered, speak]);

  const handleTap = useCallback((item) => {
    speak(item.description || `${item.name}. ${item.color} ${item.pattern || ""} ${item.type || item.category}.`);
  }, [speak]);

  const handleDelete = useCallback((id) => {
    const item = items.find(i => i.id === id);
    removeItem(id, item?.imageUrl);
    if (item) speak(RESPONSES.itemDeleted(item.name));
  }, [items, removeItem, speak]);

  const handleEdit = useCallback((item) => {
    navigate(SCREENS.EDIT_ITEM, { item });
  }, [navigate]);

  // Handle screen-specific voice commands forwarded from VoiceContext
  useEffect(() => {
    const handler = (e) => {
      const cmd = e.detail;
      if (cmd.type === "READ_WARDROBE") readAll();
      else if (cmd.type === "FILTER_WARDROBE") setFilter(cmd.category);
    };
    window.addEventListener("voiceCommand", handler);
    return () => window.removeEventListener("voiceCommand", handler);
  }, [readAll]);

  if (loading) {
    return (
      <Screen title="My Wardrobe" subtitle="Loading your items...">
        <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
          <div style={{
            width: 48, height: 48, borderRadius: "50%",
            border: `4px solid ${C.focus}`,
            borderTopColor: "transparent",
            animation: "spin 0.8s linear infinite",
          }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </Screen>
    );
  }

  if (items.length === 0) {
    return (
      <Screen title="My Wardrobe" subtitle="Your wardrobe is empty.">
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <div style={{ fontSize: 48, marginBottom: 20 }}>🗄️</div>
          <p style={{ fontFamily: FONT, fontSize: 18, color: C.muted, lineHeight: 1.7, marginBottom: 24 }}>
            Scan your first clothing item to start building your wardrobe.
          </p>
          <BigButton
            label="Scan Clothing"
            icon="📸"
            variant="primary"
            onClick={() => navigate(SCREENS.SCAN)}
          />
        </div>
      </Screen>
    );
  }

  return (
    <Screen
      title="My Wardrobe"
      subtitle={`${filtered.length} item${filtered.length !== 1 ? "s" : ""}${filter ? ` in ${filter}` : ""}`}
    >
      {/* Filter chips */}
      <div style={{
        display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap",
      }}>
        <FilterChip label="All" active={!filter} onClick={() => setFilter(null)} />
        {CATEGORIES.map(cat => (
          <FilterChip
            key={cat.id}
            label={cat.label}
            active={filter === cat.id}
            onClick={() => setFilter(cat.id)}
          />
        ))}
      </div>

      {/* Read All button */}
      <div style={{ marginBottom: 16 }}>
        <BigButton
          label="Read My Wardrobe"
          hint="Hear all items read aloud"
          icon="🔊"
          onClick={readAll}
        />
      </div>

      {/* Item list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {filtered.map(item => (
          <WardrobeCard
            key={item.id}
            item={item}
            onTap={handleTap}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        ))}
      </div>
    </Screen>
  );
}

function FilterChip({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      style={{
        background: active ? C.focus : C.surface,
        color: active ? "#000" : C.text,
        border: `2px solid ${active ? C.focus : C.border}`,
        borderRadius: 20,
        padding: "8px 16px",
        fontFamily: FONT,
        fontSize: 14,
        fontWeight: active ? 800 : 500,
        cursor: "pointer",
        minHeight: 40,
      }}
    >
      {label}
    </button>
  );
}

import { useState, useEffect, useRef } from "react";
import Screen from "../components/Screen";
import BigButton from "../components/BigButton";
import { useApp } from "../contexts/AppContext";
import { useWardrobe } from "../contexts/WardrobeContext";
import { useVoice } from "../contexts/VoiceContext";
import { C, FONT, CATEGORIES } from "../utils/constants";
import { RESPONSES } from "../voice/voiceResponses";

export default function EditItemScreen() {
  const { navParams, goBack } = useApp();
  const { editItem } = useWardrobe();
  const { speak } = useVoice();
  const item = navParams?.item;

  const [formValues, setFormValues] = useState({
    name: item?.name ?? "",
    category: item?.category ?? "",
    color: item?.color ?? "",
    pattern: item?.pattern ?? "",
    description: item?.description ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (item) speak(`Editing ${item.name}. Tap a field to change it, then tap Save. Say confirm to save.`);
  }, []);

  // Keep a ref to the latest handleSave to avoid stale closure in the voice listener
  const handleSaveRef = useRef(handleSave);
  useEffect(() => { handleSaveRef.current = handleSave; });

  useEffect(() => {
    const handler = (e) => {
      if (e.detail?.type === "CONFIRM" && !saving) handleSaveRef.current();
    };
    window.addEventListener("voiceCommand", handler);
    return () => window.removeEventListener("voiceCommand", handler);
  }, [saving]);

  if (!item) {
    goBack();
    return null;
  }

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await editItem(item.id, formValues);
      speak(RESPONSES.itemUpdated(item.name));
      goBack();
    } catch {
      speak(RESPONSES.error);
      setError("Failed to save. Please try again.");
      setSaving(false);
    }
  };

  const field = (label, key, multiline = false) => (
    <div style={{ marginBottom: 20 }}>
      <label
        htmlFor={`edit-${key}`}
        style={{ display: "block", fontFamily: FONT, fontSize: 13, color: C.muted,
          letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 8 }}
      >
        {label}
      </label>
      {multiline ? (
        <textarea
          id={`edit-${key}`}
          value={formValues[key]}
          onChange={e => setFormValues(v => ({ ...v, [key]: e.target.value }))}
          aria-label={`${label}. Current value: ${formValues[key]}`}
          rows={3}
          style={{
            width: "100%", boxSizing: "border-box",
            background: C.surface, border: `2px solid ${C.border}`,
            borderRadius: 14, padding: "14px 16px",
            fontFamily: FONT, fontSize: 16, color: C.text,
            resize: "vertical", outline: "none",
          }}
          onFocus={e => { e.target.style.borderColor = C.focus; speak(`${label}. Current value: ${formValues[key] || "empty"}`); }}
          onBlur={e => (e.target.style.borderColor = C.border)}
        />
      ) : (
        <input
          id={`edit-${key}`}
          type="text"
          value={formValues[key]}
          onChange={e => setFormValues(v => ({ ...v, [key]: e.target.value }))}
          aria-label={`${label}. Current value: ${formValues[key]}`}
          style={{
            width: "100%", boxSizing: "border-box",
            background: C.surface, border: `2px solid ${C.border}`,
            borderRadius: 14, padding: "14px 16px",
            fontFamily: FONT, fontSize: 16, color: C.text,
            outline: "none",
          }}
          onFocus={e => { e.target.style.borderColor = C.focus; speak(`${label}. Current value: ${formValues[key] || "empty"}`); }}
          onBlur={e => (e.target.style.borderColor = C.border)}
        />
      )}
    </div>
  );

  return (
    <Screen title="Edit Item" subtitle={item.name}>
      {field("Name", "name")}

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: FONT, fontSize: 13, color: C.muted,
          letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 8 }}>
          Category
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {CATEGORIES.map(cat => {
            const active = formValues.category === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => { setFormValues(v => ({ ...v, category: cat.id })); speak(`Category set to ${cat.label}`); }}
                aria-pressed={active}
                aria-label={`Category: ${cat.label}`}
                style={{
                  background: active ? C.focus : C.surface,
                  color: active ? "#000" : C.text,
                  border: `2px solid ${active ? C.focus : C.border}`,
                  borderRadius: 20, padding: "8px 16px",
                  fontFamily: FONT, fontSize: 14,
                  fontWeight: active ? 800 : 500,
                  cursor: "pointer", minHeight: 40,
                }}
              >
                {cat.icon} {cat.label}
              </button>
            );
          })}
        </div>
      </div>

      {field("Color", "color")}
      {field("Pattern", "pattern")}
      {field("Description", "description", true)}

      {error && (
        <p role="alert" style={{ fontFamily: FONT, fontSize: 14, color: C.danger, marginBottom: 16 }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <BigButton
          label={saving ? "Saving..." : "Save Changes"}
          hint="Save your edits to this item"
          icon="✓"
          variant="success"
          onClick={handleSave}
          disabled={saving}
        />
        <BigButton
          label="Cancel"
          hint="Discard changes and go back"
          icon="✕"
          onClick={goBack}
          disabled={saving}
        />
      </div>
    </Screen>
  );
}

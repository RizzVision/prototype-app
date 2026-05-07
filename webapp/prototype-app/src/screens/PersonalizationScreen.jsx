import { useCallback, useEffect, useRef, useState } from "react";
import { C, FONT, PATTERN_OPTIONS, COLOR_CHIP_OPTIONS } from "../utils/constants";
import { getPersonalization, savePersonalization, uploadProfilePhoto, getProfilePhotoUrl } from "../utils/storage";

const SECTION_STYLE = {
  marginBottom: 28,
};

const LABEL_STYLE = {
  display: "block",
  color: C.muted,
  fontSize: 12,
  fontFamily: FONT,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  marginBottom: 10,
};

const INPUT_STYLE = {
  background: C.surface,
  border: `1.5px solid ${C.border}`,
  borderRadius: 10,
  color: C.text,
  fontFamily: FONT,
  fontSize: 16,
  padding: "12px 14px",
  width: "100%",
  boxSizing: "border-box",
  outline: "none",
  minHeight: 48,
};

function ChipRow({ options, selected, onToggle, colorMode }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {options.map((opt) => {
        const label = colorMode ? opt.label : opt;
        const isOn = selected.includes(label.toLowerCase());
        return (
          <button
            key={label}
            onClick={() => onToggle(label.toLowerCase())}
            aria-pressed={isOn}
            style={{
              display: "flex",
              alignItems: "center",
              gap: colorMode ? 6 : 0,
              padding: colorMode ? "8px 12px" : "8px 14px",
              borderRadius: 20,
              border: `2px solid ${isOn ? C.focus : C.border}`,
              background: isOn ? "rgba(255,214,0,0.12)" : C.surface,
              color: isOn ? C.focus : C.text,
              fontFamily: FONT,
              fontSize: 14,
              fontWeight: isOn ? 700 : 400,
              cursor: "pointer",
              minHeight: 40,
              transition: "border-color 0.15s, color 0.15s",
            }}
          >
            {colorMode && (
              <span
                aria-hidden
                style={{
                  width: 16, height: 16, borderRadius: "50%",
                  background: opt.hex,
                  border: `1.5px solid ${C.border}`,
                  flexShrink: 0,
                }}
              />
            )}
            {label}
          </button>
        );
      })}
    </div>
  );
}

function RefPhotoSlot({ url, onAdd, onRemove, index }) {
  const inputRef = useRef();
  return (
    <div style={{ position: "relative", width: "30%", aspectRatio: "1" }}>
      {url ? (
        <>
          <img
            src={url}
            alt={`Reference outfit ${index + 1}`}
            style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 10, border: `1.5px solid ${C.border}` }}
          />
          <button
            onClick={onRemove}
            aria-label={`Remove reference outfit ${index + 1}`}
            style={{
              position: "absolute", top: 4, right: 4,
              background: "rgba(0,0,0,0.7)", border: "none",
              borderRadius: "50%", width: 24, height: 24,
              color: C.text, fontSize: 13, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            ×
          </button>
        </>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          aria-label={`Add reference outfit ${index + 1}`}
          style={{
            width: "100%", height: "100%", minHeight: 80,
            background: C.surface, border: `1.5px dashed ${C.border}`,
            borderRadius: 10, color: C.muted, fontSize: 24,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          +
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onAdd(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

export default function PersonalizationScreen() {
  const [profile, setProfile] = useState({
    height_cm: "",
    weight_kg: "",
    color_likes: [],
    color_dislikes: [],
    pattern_prefs: [],
    style_notes: "",
    reference_outfit_urls: [],
  });
  const [refPhotoUrls, setRefPhotoUrls] = useState([null, null, null]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPersonalization().then(async (data) => {
      if (data && data.user_id) {
        setProfile({
          height_cm: data.height_cm ?? "",
          weight_kg: data.weight_kg ?? "",
          color_likes: data.color_likes ?? [],
          color_dislikes: data.color_dislikes ?? [],
          pattern_prefs: data.pattern_prefs ?? [],
          style_notes: data.style_notes ?? "",
          reference_outfit_urls: data.reference_outfit_urls ?? [],
        });
        const urls = await Promise.all(
          (data.reference_outfit_urls ?? []).slice(0, 3).map(p => getProfilePhotoUrl(p))
        );
        setRefPhotoUrls([urls[0] ?? null, urls[1] ?? null, urls[2] ?? null]);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const toggleChip = useCallback((field, value) => {
    setProfile(prev => {
      const arr = prev[field];
      return {
        ...prev,
        [field]: arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value],
      };
    });
  }, []);

  const handleRefPhoto = useCallback(async (index, file) => {
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const dataUrl = e.target.result;
        const base64 = dataUrl.split(",")[1];
        const path = await uploadProfilePhoto(base64);
        setProfile(prev => {
          const urls = [...(prev.reference_outfit_urls || [])];
          urls[index] = path;
          return { ...prev, reference_outfit_urls: urls };
        });
        setRefPhotoUrls(prev => {
          const next = [...prev];
          next[index] = dataUrl;
          return next;
        });
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setToast({ type: "error", msg: "Photo upload failed. Try again." });
    }
  }, []);

  const removeRefPhoto = useCallback((index) => {
    setProfile(prev => {
      const urls = [...(prev.reference_outfit_urls || [])];
      urls[index] = null;
      return { ...prev, reference_outfit_urls: urls.filter(Boolean) };
    });
    setRefPhotoUrls(prev => {
      const next = [...prev];
      next[index] = null;
      return next;
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const toSave = {
        ...profile,
        height_cm: profile.height_cm ? parseInt(profile.height_cm, 10) : null,
        weight_kg: profile.weight_kg ? parseInt(profile.weight_kg, 10) : null,
        reference_outfit_urls: profile.reference_outfit_urls.filter(Boolean),
      };
      await savePersonalization(toSave);
      setToast({ type: "success", msg: "Style profile saved!" });
    } catch {
      setToast({ type: "error", msg: "Could not save. Please try again." });
    } finally {
      setSaving(false);
      setTimeout(() => setToast(null), 3000);
    }
  };

  if (loading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: C.muted, fontFamily: FONT, fontSize: 16 }}>Loading your profile…</div>
      </div>
    );
  }

  return (
    <div
      id="main"
      tabIndex={-1}
      style={{
        flex: 1, overflowY: "auto", padding: "20px 20px 40px",
        fontFamily: FONT, color: C.text,
      }}
    >
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 4px", color: C.text }}>
        My Style Profile
      </h1>
      <p style={{ fontSize: 14, color: C.muted, margin: "0 0 28px" }}>
        Optional — helps RizzVision tailor advice to you.
      </p>

      {/* Measurements */}
      <div style={SECTION_STYLE}>
        <span style={LABEL_STYLE}>Measurements (optional)</span>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={{ ...LABEL_STYLE, marginBottom: 6 }} htmlFor="height">Height (cm)</label>
            <input
              id="height"
              type="number"
              inputMode="numeric"
              placeholder="e.g. 165"
              value={profile.height_cm}
              onChange={e => setProfile(p => ({ ...p, height_cm: e.target.value }))}
              style={INPUT_STYLE}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ ...LABEL_STYLE, marginBottom: 6 }} htmlFor="weight">Weight (kg)</label>
            <input
              id="weight"
              type="number"
              inputMode="numeric"
              placeholder="e.g. 60"
              value={profile.weight_kg}
              onChange={e => setProfile(p => ({ ...p, weight_kg: e.target.value }))}
              style={INPUT_STYLE}
            />
          </div>
        </div>
      </div>

      {/* Color Likes */}
      <div style={SECTION_STYLE}>
        <span style={LABEL_STYLE}>Colors I love</span>
        <ChipRow
          options={COLOR_CHIP_OPTIONS}
          selected={profile.color_likes}
          onToggle={v => toggleChip("color_likes", v)}
          colorMode
        />
      </div>

      {/* Color Dislikes */}
      <div style={SECTION_STYLE}>
        <span style={LABEL_STYLE}>Colors I avoid</span>
        <ChipRow
          options={COLOR_CHIP_OPTIONS}
          selected={profile.color_dislikes}
          onToggle={v => toggleChip("color_dislikes", v)}
          colorMode
        />
      </div>

      {/* Pattern Preferences */}
      <div style={SECTION_STYLE}>
        <span style={LABEL_STYLE}>Pattern preferences</span>
        <ChipRow
          options={PATTERN_OPTIONS}
          selected={profile.pattern_prefs}
          onToggle={v => toggleChip("pattern_prefs", v)}
          colorMode={false}
        />
      </div>

      {/* Style Notes */}
      <div style={SECTION_STYLE}>
        <label style={LABEL_STYLE} htmlFor="style-notes">Style notes (optional)</label>
        <textarea
          id="style-notes"
          placeholder="e.g. I prefer minimalist looks, avoid anything too flashy"
          value={profile.style_notes}
          onChange={e => setProfile(p => ({ ...p, style_notes: e.target.value }))}
          rows={3}
          style={{ ...INPUT_STYLE, resize: "vertical", lineHeight: 1.5 }}
        />
      </div>

      {/* Reference Outfits */}
      <div style={SECTION_STYLE}>
        <span style={LABEL_STYLE}>Reference outfits (up to 3)</span>
        <p style={{ fontSize: 13, color: C.muted, margin: "0 0 12px" }}>
          Photos of outfits you love — helps RizzVision understand your style.
        </p>
        <div style={{ display: "flex", gap: "5%" }}>
          {[0, 1, 2].map(i => (
            <RefPhotoSlot
              key={i}
              index={i}
              url={refPhotoUrls[i]}
              onAdd={file => handleRefPhoto(i, file)}
              onRemove={() => removeRefPhoto(i)}
            />
          ))}
        </div>
      </div>

      {/* Save Button */}
      <button
        onClick={handleSave}
        disabled={saving}
        style={{
          width: "100%", padding: "16px 0",
          background: saving ? C.border : C.focus,
          color: "#000", fontFamily: FONT, fontSize: 17, fontWeight: 800,
          border: "none", borderRadius: 14, cursor: saving ? "not-allowed" : "pointer",
          minHeight: 56, marginTop: 8,
          transition: "background 0.15s",
        }}
      >
        {saving ? "Saving…" : "Save Profile"}
      </button>

      {/* Toast */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            marginTop: 16,
            padding: "14px 18px",
            borderRadius: 12,
            background: toast.type === "success" ? "rgba(68,204,119,0.15)" : "rgba(255,85,85,0.15)",
            border: `1.5px solid ${toast.type === "success" ? C.success : C.danger}`,
            color: toast.type === "success" ? C.success : C.danger,
            fontFamily: FONT, fontSize: 15, textAlign: "center",
          }}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}

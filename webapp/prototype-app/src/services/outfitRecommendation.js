const BASE_URL = (import.meta.env.VITE_RIZZVISION_API_URL || "http://localhost:8000").replace(/\/$/, "");

function formatWardrobe(items) {
  if (items.length === 0) return "The wardrobe is empty.";
  return items.map((item, i) => {
    const colorLabel = item.colorDescription || item.color_description || item.color || "";
    const parts = [item.name];
    if (colorLabel && !colorLabel.startsWith("#")) parts.push(`(${colorLabel})`);
    if (item.category) parts.push(`— ${item.category}`);
    return `${i + 1}. ${parts.join(" ")}`;
  }).join("\n");
}

export async function getOutfitSuggestion({ items, occasion, anchorItem, mode = "wardrobe", locale = "en" }) {
  const wardrobeDesc = mode === "general" ? "" : formatWardrobe(items);
  const anchorLine = anchorItem
    ? `The user wants to build an outfit around: ${anchorItem.name}.`
    : "";

  let res;
  try {
    res = await fetch(`${BASE_URL}/outfit-suggestion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ occasion, wardrobe: wardrobeDesc, anchor: anchorLine, mode, locale }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    throw new Error(
      err.name === "TimeoutError"
        ? "Outfit suggestion timed out. Please try again."
        : "Could not reach the server. Please check your connection."
    );
  }

  if (!res.ok) throw new Error("Could not get outfit suggestion. Please try again.");
  const data = await res.json();
  return data.suggestion;
}

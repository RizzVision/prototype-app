const BASE_URL = (import.meta.env.VITE_RIZZVISION_API_URL || "http://localhost:8000").replace(/\/$/, "");

function formatWardrobe(items) {
  if (items.length === 0) return "The wardrobe is empty.";
  return items.map((item, i) =>
    `${i + 1}. ${item.name} — ${item.color}, ${item.pattern || "solid"}, ${item.category || item.type}`
  ).join("\n");
}

export async function getOutfitSuggestion({ items, occasion, mood, anchorItem }) {
  const wardrobeDesc = formatWardrobe(items);
  const anchorLine = anchorItem
    ? `The user wants to build an outfit around: ${anchorItem.name} — ${anchorItem.color}, ${anchorItem.pattern || "solid"}, ${anchorItem.type}.`
    : "";

  const res = await fetch(`${BASE_URL}/outfit-suggestion`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ occasion, mood, wardrobe: wardrobeDesc, anchor: anchorLine }),
  });

  if (!res.ok) throw new Error("Could not get outfit suggestion. Please try again.");
  const data = await res.json();
  return data.suggestion;
}

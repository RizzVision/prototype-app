import { generateText, analyzeImage } from "./claudeApi";

function formatWardrobe(items) {
  if (items.length === 0) return "The wardrobe is empty.";
  return items.map((item, i) =>
    `${i + 1}. ${item.name} — ${item.color}, ${item.pattern || "solid"}, ${item.category || item.type}`
  ).join("\n");
}

export async function getOutfitSuggestion({ items, occasion, mood, anchorItem }) {
  const wardrobeDesc = formatWardrobe(items);

  const anchorLine = anchorItem
    ? `\nThe user just scanned this item and wants to build an outfit around it: ${anchorItem.name} — ${anchorItem.color}, ${anchorItem.pattern || "solid"}, ${anchorItem.type}.\n`
    : "";

  const prompt = `You are a confident, direct fashion stylist having a voice conversation with a blind user. Describe every colour using vivid sensory language — what it feels like, what it reminds you of, how warm or cool it is — not just the colour name. Never assume the user can see anything.

Occasion: ${occasion}
Mood: ${mood}
${anchorLine}
Their wardrobe:
${wardrobeDesc}

Give 2 outfit combinations from their wardrobe. Be direct and specific. No filler. Write in a natural, spoken tone — this will be read aloud by a screen reader.

Format:
Outfit one: [name it]
What to wear: [list the pieces]
How the colours feel: [sensory description of the colour story]
Why it works: [one to two direct sentences]

Outfit two: [name it]
What to wear: [list the pieces]
How the colours feel: [sensory description]
Why it works: [one to two direct sentences]

One thing to avoid: [one clear warning]

If the wardrobe is empty or has too few items, say so directly and suggest what to add.`;

  return await generateText(prompt);
}

export async function getShoppingFeedback(base64Image, wardrobeItems) {
  const wardrobeDesc = formatWardrobe(wardrobeItems);

  const prompt = `You are a direct fashion assistant helping a blind user shop for clothes. They are holding up a clothing item in a store.

Their current wardrobe:
${wardrobeDesc}

Analyze this item and give a brief, direct assessment in 2-3 sentences:
1. What this item is (type, color with sensory description)
2. Whether it works with their existing wardrobe and why
3. Whether it's a versatile addition or not

Be honest. No filler. This will be read aloud.`;

  return await analyzeImage(base64Image, prompt);
}

export async function getMirrorAssessment(base64Image) {
  const prompt = `You are a confident, honest fashion assistant helping a blind user understand how their outfit looks. They just took a photo of themselves wearing an outfit.

Give a direct, honest assessment in 3-4 sentences:
1. Describe what they're wearing (colors with sensory language, garment types)
2. Whether the colors work together and why
3. The overall impression (casual, formal, balanced, unbalanced, etc.)
4. One specific suggestion if something could be improved

Rules:
- No sugarcoating
- No hedging
- Clear judgment
- Use sensory color descriptions (warmth, coolness, what it reminds you of)
- This will be read aloud to a blind user`;

  return await analyzeImage(base64Image, prompt);
}

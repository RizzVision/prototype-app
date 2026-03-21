import { analyzeImage } from "./claudeApi";

const DETECTION_PROMPT = `You are a fashion assistant for visually impaired users. Analyze this clothing item photo and respond with ONLY valid JSON (no markdown, no backticks).

Return this exact JSON structure:
{
  "name": "a short name like 'Blue Denim Jacket'",
  "type": "one of: top, bottom, dress, footwear, jewellery, outerwear, accessory",
  "category": "one of: tops, bottoms, dresses, footwear, jewellery",
  "color": "the primary color name",
  "colorDescription": "a vivid sensory description of the color — what it feels like, what it reminds you of, how warm or cool it is. Two sentences max.",
  "pattern": "one of: solid, stripes, plaid, floral, polka dots, abstract, animal print, geometric, paisley, tie-dye",
  "gender": "one of: masculine, feminine, gender neutral, unisex",
  "description": "A natural spoken description of this item. Two to three sentences. Describe the garment type, color using sensory language, and any notable details. This will be read aloud to a blind user."
}`;

export async function detectClothing(base64Image) {
  const response = await analyzeImage(base64Image, DETECTION_PROMPT);

  try {
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in response");
    return JSON.parse(jsonMatch[0]);
  } catch {
    // If parsing fails, return a basic result from the text
    return {
      name: "Clothing Item",
      type: "unknown",
      category: "tops",
      color: "unknown",
      colorDescription: "",
      pattern: "solid",
      gender: "unisex",
      description: response.slice(0, 300),
    };
  }
}

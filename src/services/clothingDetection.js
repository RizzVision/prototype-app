import { analyzeImage } from "./claudeApi";
import { detectWithYolo } from "./yoloApi";

const BASE_DETECTION_PROMPT = `You are a fashion assistant for visually impaired users. Analyze this clothing item photo and respond with ONLY valid JSON (no markdown, no backticks).

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

/**
 * Format YOLO detections into a context block for Claude.
 * Only includes detections at or above 40% confidence.
 */
function buildYoloContext(detections) {
  const confident = detections.filter((d) => d.confidence >= 0.4);
  if (confident.length === 0) return null;

  const lines = confident
    .map((d) => `  - ${d.label} (confidence: ${Math.round(d.confidence * 100)}%)`)
    .join("\n");

  return `[YOLO_CONTEXT — use as ground truth for garment identification]
The on-device detector identified:
${lines}
Use these labels to inform "type", "category", and "name". Fill color, pattern, gender, colorDescription, and description from the image itself.
[END YOLO_CONTEXT]

`;
}

export async function detectClothing(base64Image) {
  // Attempt fast local/remote YOLO detection first
  const yoloDetections = await detectWithYolo(base64Image);

  // Build prompt — enriched with YOLO context if available, plain otherwise
  let prompt = BASE_DETECTION_PROMPT;
  if (yoloDetections && yoloDetections.length > 0) {
    const ctx = buildYoloContext(yoloDetections);
    if (ctx) prompt = ctx + BASE_DETECTION_PROMPT;
  }

  const response = await analyzeImage(base64Image, prompt);

  try {
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

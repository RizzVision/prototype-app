/**
 * Free-form voice assistant — fallback for unrecognised transcripts.
 *
 * Sends the transcript + current app context to the backend /voice-query
 * endpoint and returns { answer, command }.
 *
 * The backend uses Gemini to either answer the question conversationally
 * or identify a structured command intent (navigate, filter, etc.).
 */

const BASE_URL = (import.meta.env.VITE_RIZZVISION_API_URL || "http://localhost:8000").replace(/\/$/, "");

/**
 * Ask the assistant a free-form question.
 *
 * @param {string} transcript      What the user said (lowercased, trimmed).
 * @param {string} currentScreen   Current screen ID from SCREENS constants.
 * @param {Array}  wardrobeItems   Full wardrobe items array from WardrobeContext.
 * @returns {Promise<{ answer: string, command: object|null }>}
 */
export async function askAssistant(transcript, currentScreen, wardrobeItems = []) {
  const wardrobeSummary = wardrobeItems.length
    ? wardrobeItems
        .map((item) => `- ${item.name}${item.category ? ` (${item.category})` : ""}${item.description ? ": " + item.description.slice(0, 60) : ""}`)
        .join("\n")
    : "";

  try {
    const res = await fetch(`${BASE_URL}/voice-query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript,
        current_screen: currentScreen,
        wardrobe_summary: wardrobeSummary,
        wardrobe_count: wardrobeItems.length,
      }),
    });

    if (!res.ok) throw new Error(`voice-query failed: ${res.status}`);
    return await res.json();
  } catch {
    return {
      answer: "I could not reach the server. Please check your connection.",
      command: null,
    };
  }
}

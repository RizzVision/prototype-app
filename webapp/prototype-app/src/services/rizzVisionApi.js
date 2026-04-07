/**
 * RizzVision Backend API Service
 *
 * Calls the RizzVision FastAPI backend (POST /analyze) with an outfit image.
 * Converts raw base64 to multipart/form-data before sending.
 *
 * Error contract:
 *   - Image quality issues (too dark, blurry, etc.) → throws ImageQualityError
 *     with .code and .userMessage populated from the backend's spoken message.
 *   - Server / network errors → throws plain Error.
 */

const BASE_URL = (import.meta.env.VITE_RIZZVISION_API_URL || "http://localhost:8000").replace(/\/$/, "");

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert raw base64 (no data URL prefix) to a Blob. */
function base64ToBlob(base64, mimeType = "image/jpeg") {
  const byteString = atob(base64);
  const ab = new ArrayBuffer(byteString.length);
  const ua = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ua[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mimeType });
}

/** Structured error for image quality failures (too dark, blurry, etc.) */
export class ImageQualityError extends Error {
  constructor(userMessage, code = "quality_error") {
    super(userMessage);
    this.name = "ImageQualityError";
    this.userMessage = userMessage;
    this.code = code;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Analyze an outfit image with the full RizzVision pipeline.
 *
 * @param {string} base64 Raw base64 image string (no "data:image/..." prefix).
 * @returns {Promise<AnalysisResult>} Full analysis including speech_segments,
 *   color_score, color_label, best_occasion, style_archetype, raw engine data.
 *
 * @throws {ImageQualityError} When the backend rejects the image (422).
 *   Use .userMessage for a spoken sentence ready for TTS.
 * @throws {Error} For network errors or unexpected server failures.
 */
export async function analyzeOutfit(base64) {
  const blob = base64ToBlob(base64);
  const formData = new FormData();
  formData.append("image", blob, "outfit.jpg");

  let res;
  try {
    res = await fetch(`${BASE_URL}/analyze`, {
      method: "POST",
      body: formData,
    });
  } catch (networkErr) {
    throw new Error(
      "Could not reach the analysis server. Please check your connection and try again."
    );
  }

  if (res.ok) {
    return await res.json();
  }

  // Parse error body
  let errorBody;
  try {
    errorBody = await res.json();
  } catch {
    throw new Error(`Server returned an unexpected error (${res.status}).`);
  }

  // 422 = image quality rejection from backend — has user_message ready for TTS
  if (res.status === 422) {
    throw new ImageQualityError(
      errorBody.user_message || "There was an issue with the photo. Please try again.",
      errorBody.error_code || "quality_error"
    );
  }

  // 500 or other — backend may include a user_message
  throw new Error(
    errorBody.user_message ||
    errorBody.detail ||
    `Analysis failed (${res.status}). Please try again.`
  );
}

/**
 * Shopping mode analysis — wardrobe-aware live feedback.
 *
 * @param {string} base64 Raw base64 image string.
 * @param {Array}  wardrobeItems Array of wardrobe item objects (may be empty).
 * @returns {Promise<ShoppingAnalysisResult>}
 */
export async function analyzeForShopping(base64, wardrobeItems = []) {
  const blob = base64ToBlob(base64);
  const formData = new FormData();
  formData.append("image", blob, "outfit.jpg");

  // Summarise wardrobe into a readable text block for the LLM
  const wardrobeSummary = wardrobeItems.length
    ? wardrobeItems
        .map((item) => `- ${item.name || item.type}: ${item.color || ""} ${item.description || ""}`.trim())
        .join("\n")
    : "";
  formData.append("wardrobe", wardrobeSummary);

  let res;
  try {
    res = await fetch(`${BASE_URL}/shopping-analyze`, {
      method: "POST",
      body: formData,
    });
  } catch {
    throw new Error("Could not reach the analysis server. Please check your connection and try again.");
  }

  if (res.ok) return await res.json();

  let errorBody;
  try { errorBody = await res.json(); } catch { throw new Error(`Server error (${res.status}).`); }

  if (res.status === 422) {
    throw new ImageQualityError(
      errorBody.user_message || "There was an issue with the photo. Please try again.",
      errorBody.error_code || "quality_error"
    );
  }
  throw new Error(errorBody.user_message || errorBody.detail || `Analysis failed (${res.status}).`);
}

/**
 * Ask a follow-up question about the last scanned shopping item.
 *
 * @param {string} question           The user's question.
 * @param {string} lastAnalysisContext Context string returned by analyzeForShopping.
 * @returns {Promise<{answer: string}>}
 */
export async function askShoppingFollowUp(question, lastAnalysisContext) {
  let res;
  try {
    res = await fetch(`${BASE_URL}/shopping-followup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, last_analysis_context: lastAnalysisContext }),
    });
  } catch {
    throw new Error("Could not reach the analysis server.");
  }
  if (res.ok) return await res.json();
  throw new Error(`Follow-up failed (${res.status}).`);
}

/**
 * Quick health check — returns true if the backend is reachable.
 */
export async function pingBackend() {
  try {
    const res = await fetch(`${BASE_URL}/health`, {
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

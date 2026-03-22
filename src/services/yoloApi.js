const YOLO_BASE_URL = import.meta.env.VITE_YOLO_API_URL || "http://localhost:8000";

/**
 * Run YOLO garment detection on a base64 image.
 *
 * @param {string} base64Image - Raw base64 string (no data-URI prefix)
 * @returns {Promise<Array<{label:string, confidence:number, box:number[]}> | null>}
 *   Array of detections, or null if the backend is unavailable or times out.
 */
export async function detectWithYolo(base64Image) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${YOLO_BASE_URL}/detect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: base64Image }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      throw new Error("BACKEND_UNAVAILABLE");
    }
    const data = await res.json();
    return data.detections ?? null;
  } catch (err) {
    if (err.name === "AbortError") throw new Error("BACKEND_UNAVAILABLE");
    throw err;
  }
}

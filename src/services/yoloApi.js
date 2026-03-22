const YOLO_BASE_URL = import.meta.env.VITE_YOLO_API_URL || "http://localhost:8000";
import { supabase } from "../lib/supabase";

async function getAuthHeaders() {
  if (!supabase) {
    throw new Error("AUTH_NOT_CONFIGURED");
  }

  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) {
    throw new Error("AUTH_SESSION_ERROR");
  }
  if (!session?.access_token) {
    throw new Error("AUTH_REQUIRED");
  }

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.access_token}`,
  };
}

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
    const headers = await getAuthHeaders();
    const res = await fetch(`${YOLO_BASE_URL}/detect`, {
      method: "POST",
      headers,
      body: JSON.stringify({ image: base64Image }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.status === 401) {
      throw new Error("AUTH_REQUIRED");
    }
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

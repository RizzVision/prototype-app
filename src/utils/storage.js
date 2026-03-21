const WARDROBE_KEY = "rizzvision_wardrobe";

export function loadWardrobe() {
  try {
    const data = localStorage.getItem(WARDROBE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function saveWardrobe(items) {
  try {
    localStorage.setItem(WARDROBE_KEY, JSON.stringify(items));
  } catch {
    // localStorage full or unavailable
  }
}

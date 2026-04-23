export const SUPPORTED_LOCALES = [
  { code: "en", label: "English", nativeLabel: "English", speechLocale: "en-IN", dir: "ltr" },
  { code: "hi", label: "Hindi", nativeLabel: "हिन्दी", speechLocale: "hi-IN", dir: "ltr" },
  { code: "ta", label: "Tamil", nativeLabel: "தமிழ்", speechLocale: "ta-IN", dir: "ltr" },
  { code: "te", label: "Telugu", nativeLabel: "తెలుగు", speechLocale: "te-IN", dir: "ltr" },
  { code: "bn", label: "Bengali", nativeLabel: "বাংলা", speechLocale: "bn-IN", dir: "ltr" },
  { code: "mr", label: "Marathi", nativeLabel: "मराठी", speechLocale: "mr-IN", dir: "ltr" },
  { code: "gu", label: "Gujarati", nativeLabel: "ગુજરાતી", speechLocale: "gu-IN", dir: "ltr" },
  { code: "kn", label: "Kannada", nativeLabel: "ಕನ್ನಡ", speechLocale: "kn-IN", dir: "ltr" },
  { code: "ml", label: "Malayalam", nativeLabel: "മലയാളം", speechLocale: "ml-IN", dir: "ltr" },
  { code: "pa", label: "Punjabi", nativeLabel: "ਪੰਜਾਬੀ", speechLocale: "pa-IN", dir: "ltr" },
];

export const DEFAULT_LOCALE = "en";

export function getLocaleConfig(code) {
  return SUPPORTED_LOCALES.find((locale) => locale.code === code) || SUPPORTED_LOCALES[0];
}

export function resolveLocale(input) {
  if (!input || typeof input !== "string") return DEFAULT_LOCALE;

  const normalized = input.toLowerCase();
  if (SUPPORTED_LOCALES.some((l) => l.code === normalized)) return normalized;

  const base = normalized.split("-")[0];
  if (SUPPORTED_LOCALES.some((l) => l.code === base)) return base;

  return DEFAULT_LOCALE;
}

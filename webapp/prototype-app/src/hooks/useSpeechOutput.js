import { useState, useRef, useCallback, useEffect } from "react";

const synth = typeof window !== "undefined" ? window.speechSynthesis : null;

// Ranked preference: best quality Indian English voices first, then general English
const EN_VOICE_PREFERENCE = [
  "Rishi",                    // iOS 16+ Indian English (male)
  "Neel",                     // iOS 17+ Indian English (male)
  "Veena",                    // macOS Indian English (female)
  "Google हिन्दी",            // skip — wrong language, intentionally unreachable
  "Google UK English Female", // Android Chrome — high quality
  "Google UK English Male",
  "Samantha",                 // iOS/macOS en-US — high quality fallback
  "Alex",                     // macOS en-US — highest quality on Apple
];

const LANGUAGE_VOICE_HINTS = {
  hi: ["Google हिन्दी", "Lekha", "Aditi"],
  ta: ["Google தமிழ்"],
  te: ["Google తెలుగు"],
  bn: ["Google বাংলা"],
  mr: ["Google मराठी"],
  gu: ["Google ગુજરાતી"],
  kn: ["Google ಕನ್ನಡ"],
  ml: ["Google മലയാളം"],
  pa: ["Google ਪੰਜਾਬੀ"],
};

function pickBestVoice(speechLocale = "en-IN") {
  if (!synth) return null;
  const voices = synth.getVoices();
  if (!voices.length) return null;

  const language = speechLocale.toLowerCase().split("-")[0];
  const localeMatch = voices.find((voice) => voice.lang.toLowerCase() === speechLocale.toLowerCase());
  if (localeMatch) return localeMatch;

  const localePrefix = voices.find((voice) => voice.lang.toLowerCase().startsWith(`${language}-`));
  if (localePrefix) return localePrefix;

  const hintedVoices = LANGUAGE_VOICE_HINTS[language] || [];
  for (const name of hintedVoices) {
    const found = voices.find((voice) => voice.name === name);
    if (found) return found;
  }

  if (language === "en") {
    for (const name of EN_VOICE_PREFERENCE) {
      const found = voices.find((voice) => voice.name === name);
      if (found) return found;
    }
  }

  return voices.find((voice) => voice.lang.toLowerCase().startsWith("en")) ?? voices[0] ?? null;
}

// Exported for use outside the hook (e.g., stopping speech on navigation)
export function stopSpeech() { synth?.cancel(); }

export default function useSpeechOutput({ speechLocale = "en-IN" } = {}) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const lastUtteranceRef = useRef("");
  const voiceRef = useRef(null);

  // Pick the best voice once voices are available
  useEffect(() => {
    if (!synth) return;
    voiceRef.current = pickBestVoice(speechLocale);

    const updateVoice = () => {
      voiceRef.current = pickBestVoice(speechLocale);
    };

    synth.addEventListener("voiceschanged", updateVoice);
    return () => synth.removeEventListener("voiceschanged", updateVoice);
  }, [speechLocale]);

  const stop = useCallback(() => {
    if (!synth) return;
    synth.cancel();
    setIsSpeaking(false);
  }, []);

  const speak = useCallback((text, { priority = "assertive" } = {}) => {
    if (!synth || !text) return;

    // Always interrupt current speech
    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    utterance.lang = speechLocale;

    // Use best available voice if already loaded
    if (voiceRef.current) utterance.voice = voiceRef.current;

    lastUtteranceRef.current = text;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    // Chrome bug workaround: resume synthesis if paused
    if (synth.paused) synth.resume();

    synth.speak(utterance);
  }, [speechLocale]);

  const repeat = useCallback(() => {
    if (lastUtteranceRef.current) {
      speak(lastUtteranceRef.current);
    }
  }, [speak]);

  return { speak, stop, repeat, isSpeaking };
}

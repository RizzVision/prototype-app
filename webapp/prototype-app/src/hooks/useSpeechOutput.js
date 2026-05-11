import { useState, useRef, useCallback, useEffect } from "react";

const synth = typeof window !== "undefined" ? window.speechSynthesis : null;

// Ranked by voice quality — checked before any locale fallback for English.
// Neural/online voices (Google, Microsoft Edge) are significantly clearer
// than the default system en-IN voice on most Android devices.
const EN_VOICE_PREFERENCE = [
  // Microsoft Edge neural voices (Windows / Edge browser) — highest quality
  "Microsoft Aria Online (Natural) - English (United States)",
  "Microsoft Jenny Online (Natural) - English (United States)",
  "Microsoft Ravi Online (Natural) - English (India)",
  "Microsoft Neerja Online (Natural) - English (India)",
  // iOS / macOS
  "Rishi",   // iOS 16+ Indian English
  "Neel",    // iOS 17+ Indian English
  "Veena",   // macOS Indian English (female)
  "Samantha", // iOS/macOS en-US
  "Alex",    // macOS en-US
  // Android Chrome — Google online voices
  "Google UK English Female",
  "Google UK English Male",
  "Google US English",
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

  // For English: always check the quality preference list FIRST.
  // The default locale match often returns a robotic en-IN system voice
  // that sounds worse than the Google/Microsoft online voices.
  if (language === "en") {
    for (const name of EN_VOICE_PREFERENCE) {
      const found = voices.find((v) => v.name === name);
      if (found) return found;
    }
    // Fall back to any en-IN or en-* voice
    return (
      voices.find((v) => v.lang.toLowerCase() === speechLocale.toLowerCase()) ??
      voices.find((v) => v.lang.toLowerCase().startsWith("en-")) ??
      voices[0] ??
      null
    );
  }

  // Non-English: use the hints list, then locale match
  const hintedVoices = LANGUAGE_VOICE_HINTS[language] || [];
  for (const name of hintedVoices) {
    const found = voices.find((v) => v.name === name);
    if (found) return found;
  }
  return (
    voices.find((v) => v.lang.toLowerCase() === speechLocale.toLowerCase()) ??
    voices.find((v) => v.lang.toLowerCase().startsWith(`${language}-`)) ??
    voices.find((v) => v.lang.toLowerCase().startsWith("en-")) ??
    voices[0] ??
    null
  );
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
    utterance.rate = 0.92;  // slightly slower = clearer on mobile TTS engines
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

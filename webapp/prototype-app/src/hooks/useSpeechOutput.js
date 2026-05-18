import { useState, useRef, useCallback, useEffect } from "react";

const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
const BASE_URL = (import.meta.env.VITE_RIZZVISION_API_URL || "http://localhost:8000").replace(/\/$/, "");

// Ranked by voice quality — checked before any locale fallback for English.
const EN_VOICE_PREFERENCE = [
  "Microsoft Aria Online (Natural) - English (United States)",
  "Microsoft Jenny Online (Natural) - English (United States)",
  "Microsoft Ravi Online (Natural) - English (India)",
  "Microsoft Neerja Online (Natural) - English (India)",
  "Rishi",
  "Neel",
  "Veena",
  "Samantha",
  "Alex",
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

  if (language === "en") {
    for (const name of EN_VOICE_PREFERENCE) {
      const found = voices.find((v) => v.name === name);
      if (found) return found;
    }
    return (
      voices.find((v) => v.lang.toLowerCase() === speechLocale.toLowerCase()) ??
      voices.find((v) => v.lang.toLowerCase().startsWith("en-")) ??
      voices[0] ??
      null
    );
  }

  const hintedVoices = LANGUAGE_VOICE_HINTS[language] || [];
  for (const name of hintedVoices) {
    const found = voices.find((v) => v.name === name);
    if (found) return found;
  }
  return (
    voices.find((v) => v.lang.toLowerCase() === speechLocale.toLowerCase()) ??
    voices.find((v) => v.lang.toLowerCase().startsWith(`${language}-`)) ??
    null
  );
}

export function stopSpeech() { synth?.cancel(); }

export default function useSpeechOutput({ speechLocale = "en-IN" } = {}) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const lastUtteranceRef = useRef("");
  const voiceRef = useRef(null);
  const audioRef = useRef(null);

  useEffect(() => {
    if (!synth) return;
    voiceRef.current = pickBestVoice(speechLocale);
    const updateVoice = () => { voiceRef.current = pickBestVoice(speechLocale); };
    synth.addEventListener("voiceschanged", updateVoice);
    return () => synth.removeEventListener("voiceschanged", updateVoice);
  }, [speechLocale]);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    synth?.cancel();
    setIsSpeaking(false);
  }, []);

  const _fallbackSpeak = useCallback((text) => {
    if (!synth || !text) return;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.92;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    utterance.lang = speechLocale;
    if (voiceRef.current) utterance.voice = voiceRef.current;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    if (synth.paused) synth.resume();
    synth.speak(utterance);
  }, [speechLocale]);

  const speak = useCallback(async (text) => {
    if (!text) return;
    lastUtteranceRef.current = text;
    stop();

    // Derive language code from speechLocale (e.g. "hi-IN" → "hi")
    const lang = speechLocale.toLowerCase().split("-")[0] || "en";

    try {
      const fd = new FormData();
      fd.append("text", text);
      fd.append("language", lang);
      const res = await fetch(`${BASE_URL}/tts`, { method: "POST", body: fd });
      if (!res.ok) throw new Error(`TTS ${res.status}`);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      setIsSpeaking(true);
      audio.onended = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(url);
        if (audioRef.current === audio) audioRef.current = null;
      };
      audio.onerror = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(url);
        if (audioRef.current === audio) audioRef.current = null;
        _fallbackSpeak(text);
      };
      audio.play();
    } catch {
      _fallbackSpeak(text);
    }
  }, [speechLocale, stop, _fallbackSpeak]);

  const repeat = useCallback(() => {
    if (lastUtteranceRef.current) speak(lastUtteranceRef.current);
  }, [speak]);

  return { speak, stop, repeat, isSpeaking };
}

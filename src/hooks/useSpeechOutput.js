import { useState, useRef, useCallback, useEffect } from "react";

const synth = typeof window !== "undefined" ? window.speechSynthesis : null;

// Ranked preference: best quality Indian English voices first, then general English
const VOICE_PREFERENCE = [
  "Rishi",                    // iOS 16+ Indian English (male)
  "Neel",                     // iOS 17+ Indian English (male)
  "Veena",                    // macOS Indian English (female)
  "Google हिन्दी",            // skip — wrong language, intentionally unreachable
  "Google UK English Female", // Android Chrome — high quality
  "Google UK English Male",
  "Samantha",                 // iOS/macOS en-US — high quality fallback
  "Alex",                     // macOS en-US — highest quality on Apple
];

function pickBestVoice() {
  if (!synth) return null;
  const voices = synth.getVoices();
  if (!voices.length) return null;

  // Try exact name matches first
  for (const name of VOICE_PREFERENCE) {
    const found = voices.find(v => v.name === name);
    if (found) return found;
  }

  // Then try any en-IN locale voice
  const enIN = voices.find(v => v.lang.startsWith("en-IN"));
  if (enIN) return enIN;

  // Then any English voice
  return voices.find(v => v.lang.startsWith("en")) ?? voices[0] ?? null;
}

export default function useSpeechOutput() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const lastUtteranceRef = useRef("");
  const voiceRef = useRef(null);

  // Pick the best voice once voices are available
  useEffect(() => {
    if (!synth) return;
    voiceRef.current = pickBestVoice();
    synth.addEventListener("voiceschanged", () => {
      voiceRef.current = pickBestVoice();
    });
  }, []);

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
    utterance.lang = "en-IN";

    // Use best available voice if already loaded
    if (voiceRef.current) utterance.voice = voiceRef.current;

    lastUtteranceRef.current = text;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    // Chrome bug workaround: resume synthesis if paused
    if (synth.paused) synth.resume();

    synth.speak(utterance);
  }, []);

  const repeat = useCallback(() => {
    if (lastUtteranceRef.current) {
      speak(lastUtteranceRef.current);
    }
  }, [speak]);

  return { speak, stop, repeat, isSpeaking };
}

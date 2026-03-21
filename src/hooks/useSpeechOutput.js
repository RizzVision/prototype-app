import { useState, useRef, useCallback } from "react";

export default function useSpeechOutput() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const lastUtteranceRef = useRef("");
  const synth = typeof window !== "undefined" ? window.speechSynthesis : null;

  const stop = useCallback(() => {
    if (!synth) return;
    synth.cancel();
    setIsSpeaking(false);
  }, [synth]);

  const speak = useCallback((text, { priority = "assertive" } = {}) => {
    if (!synth || !text) return;

    // Always interrupt current speech
    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    utterance.lang = "en-IN";

    lastUtteranceRef.current = text;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    // Chrome bug workaround: resume synthesis if paused
    if (synth.paused) synth.resume();

    synth.speak(utterance);
  }, [synth]);

  const repeat = useCallback(() => {
    if (lastUtteranceRef.current) {
      speak(lastUtteranceRef.current);
    }
  }, [speak]);

  return { speak, stop, repeat, isSpeaking };
}

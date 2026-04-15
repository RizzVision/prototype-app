import { useState, useRef, useCallback, useEffect } from "react";
import { playMicOn, playMicOff } from "../utils/sounds";

const SpeechRecognition = typeof window !== "undefined"
  ? window.SpeechRecognition || window.webkitSpeechRecognition
  : null;

export default function useVoiceInput({ onResult, continuous = true, lang = "en-IN" } = {}) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [supported, setSupported] = useState(true);
  const recognitionRef = useRef(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    if (!SpeechRecognition) {
      setSupported(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = continuous;
    recognition.interimResults = true;
    recognition.lang = lang;

    recognition.onresult = (event) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      if (interim) setInterimTranscript(interim);
      if (final) {
        setTranscript(final);
        setInterimTranscript("");
        if (onResultRef.current) onResultRef.current(final.trim().toLowerCase());
      }
    };

    recognition.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      // Permission denied — stop trying, mark unsupported
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        if (recognitionRef.current) recognitionRef.current._shouldListen = false;
        setIsListening(false);
        setSupported(false);
        return;
      }
      // Hardware/network errors: stop retrying to avoid infinite restart loops
      if (event.error === "audio-capture" || event.error === "network") {
        if (recognitionRef.current) recognitionRef.current._shouldListen = false;
        setIsListening(false);
        return;
      }
      console.warn("Speech recognition error:", event.error);
    };

    recognition.onend = () => {
      // Paused for TTS — do nothing; resumeListening() will restart when TTS ends
      if (recognitionRef.current?._paused) return;
      if (recognitionRef.current?._shouldListen) {
        try { recognition.start(); } catch { setIsListening(false); }
      } else {
        setIsListening(false);
      }
    };

    recognitionRef.current = recognition;
    recognitionRef.current._shouldListen = false;
    recognitionRef.current._paused = false;

    return () => {
      if (recognitionRef.current) recognitionRef.current._shouldListen = false;
      try { recognition.stop(); } catch {}
    };
  }, [continuous, lang]);

  const startListening = useCallback(() => {
    if (!recognitionRef.current) return;
    recognitionRef.current._shouldListen = true;
    recognitionRef.current._paused = false;
    try {
      recognitionRef.current.start();
      setIsListening(true);
      playMicOn();
    } catch {
      // start() failed (e.g. already running) — reset flag so onend doesn't loop
      recognitionRef.current._shouldListen = false;
    }
  }, []);

  const stopListening = useCallback(() => {
    if (!recognitionRef.current) return;
    recognitionRef.current._shouldListen = false;
    recognitionRef.current._paused = false;
    try { recognitionRef.current.stop(); } catch {}
    setIsListening(false);
    playMicOff();
  }, []);

  // Pause recognition during TTS without changing user-visible isListening state.
  // onend will see _paused=true and skip the auto-restart.
  const pauseListening = useCallback(() => {
    if (!recognitionRef.current) return;
    recognitionRef.current._paused = true;
    try { recognitionRef.current.stop(); } catch {}
  }, []);

  // Resume recognition after TTS ends, but only if the user still wants to listen.
  const resumeListening = useCallback(() => {
    if (!recognitionRef.current) return;
    recognitionRef.current._paused = false;
    if (recognitionRef.current._shouldListen) {
      try { recognitionRef.current.start(); } catch {}
    }
  }, []);

  const toggleListening = useCallback(() => {
    if (isListening) stopListening();
    else startListening();
  }, [isListening, startListening, stopListening]);

  return {
    isListening,
    transcript,
    interimTranscript,
    supported,
    startListening,
    stopListening,
    pauseListening,
    resumeListening,
    toggleListening,
  };
}

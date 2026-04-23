import { createContext, useContext, useCallback, useRef, useState, useEffect } from "react";
import useVoiceInput from "../hooks/useVoiceInput";
import useSpeechOutput from "../hooks/useSpeechOutput";
import { useLocale } from "./LocaleContext";
import { parseCommand } from "../voice/commandParser";
import { askAssistant } from "../voice/voiceAssistant";
import { useApp } from "./AppContext";
import { useWardrobe } from "./WardrobeContext";
import { RESPONSES, setResponseLanguage } from "../voice/voiceResponses";

const VoiceContext = createContext();

export function VoiceProvider({ children, announce, onScreenCommand }) {
  const { language, locale, locales, setLanguage, t } = useLocale();
  const { navigate, goBack, screen } = useApp();
  const { removeLast, items } = useWardrobe();
  const { speak, stop, repeat, isSpeaking } = useSpeechOutput({ speechLocale: locale.speechLocale });

  useEffect(() => {
    setResponseLanguage(language);
  }, [language]);

  // Prevent concurrent assistant calls (debounce by flight)
  const assistantInFlightRef = useRef(false);
  const [isThinking, setIsThinking] = useState(false);

  /**
   * Execute a structured command object — shared between the fast-path parser
   * and the LLM assistant so both code paths dispatch identically.
   */
  const executeCommand = useCallback((command) => {
    switch (command.type) {
      case "NAVIGATE":
        speak(RESPONSES.goBack);
        navigate(command.screen);
        break;
      case "GO_BACK":
        speak(RESPONSES.goBack);
        goBack();
        break;
      case "REPEAT":
        repeat();
        break;
      case "STOP_SPEAKING":
        stop();
        break;
      case "DELETE_LAST_ITEM": {
        const last = removeLast();
        if (last) speak(RESPONSES.itemDeleted(last.name));
        else speak(RESPONSES.noItemToDelete);
        break;
      }
      case "SET_LANGUAGE": {
        if (!command.code) {
          speak(t("app.languageUnknown"));
          break;
        }

        const target = locales.find((item) => item.code === command.code);
        if (!target) {
          speak(t("app.languageUnknown"));
          break;
        }

        setLanguage(command.code);
        const confirmation = `${t("app.languageChangedPrefix")} ${target.nativeLabel}.`;
        speak(confirmation);
        if (announce) announce(confirmation, "polite");
        break;
      }
      case "LIST_LANGUAGES": {
        const spokenList = locales.map((item) => item.nativeLabel).join(", ");
        speak(`${t("app.languagesAvailablePrefix")} ${spokenList}.`);
        break;
      }
      case "READ_WARDROBE":
      case "FILTER_WARDROBE":
      case "SAVE_ITEM":
      case "DISCARD_ITEM":
      case "SCAN_AGAIN":
      case "PAUSE_SCAN":
      case "RESUME_SCAN":
      case "SUGGEST_CHANGES":
      case "CONFIRM":
      case "READ_RESULT":
      case "SELECT_OCCASION":
      case "SELECT_MOOD":
        if (onScreenCommand) onScreenCommand(command);
        break;
      default:
        break;
    }
  }, [navigate, goBack, speak, stop, repeat, removeLast, onScreenCommand, locales, setLanguage, t, announce]);

  /**
   * Play a subtle two-tone "thinking" chime so the user knows
   * the app heard them and is processing (covers the async wait).
   */
  const playThinkingChime = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [[440, 0], [520, 0.12]].forEach(([freq, delay]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.12, ctx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.18);
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + 0.18);
      });
    } catch (_) {}
  }, []);

  const handleVoiceResult = useCallback(async (transcript) => {
    // Fast path — known command patterns
    const command = parseCommand(transcript);
    if (command) {
      executeCommand(command);
      return;
    }

    // Don't fire two assistant calls at once
    if (assistantInFlightRef.current) return;
    assistantInFlightRef.current = true;

    // Acknowledge immediately so the user knows we heard them
    playThinkingChime();
    setIsThinking(true);
    if (announce) announce(t("app.processingQuestion"), "polite");

    try {
      const { answer, command: llmCommand } = await askAssistant(transcript, screen, items, language);

      // Speak the answer
      if (answer) {
        speak(answer);
        if (announce) announce(answer, "polite");
      }

      // Execute any action the LLM identified
      if (llmCommand && llmCommand.type) {
        // Small delay so the spoken answer starts before navigation fires
        setTimeout(() => executeCommand(llmCommand), 800);
      }
    } catch {
      speak(t("app.fallbackVoiceError"));
    } finally {
      assistantInFlightRef.current = false;
      setIsThinking(false);
    }
  }, [screen, items, speak, announce, executeCommand, playThinkingChime, t, language]);

  const { isListening, transcript, supported, startListening, stopListening, toggleListening } =
    useVoiceInput({ onResult: handleVoiceResult, lang: locale.speechLocale });

  return (
    <VoiceContext.Provider value={{
      speak, stop, repeat, isSpeaking,
      isListening, isThinking, transcript, supported,
      startListening, stopListening, toggleListening,
    }}>
      {children}
    </VoiceContext.Provider>
  );
}

export function useVoice() {
  return useContext(VoiceContext);
}

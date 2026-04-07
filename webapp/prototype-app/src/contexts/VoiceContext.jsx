import { createContext, useContext, useCallback, useEffect } from "react";
import useVoiceInput from "../hooks/useVoiceInput";
import useSpeechOutput from "../hooks/useSpeechOutput";
import { parseCommand } from "../voice/commandParser";
import { useApp } from "./AppContext";
import { useWardrobe } from "./WardrobeContext";
import { RESPONSES } from "../voice/voiceResponses";

const VoiceContext = createContext();

export function VoiceProvider({ children, announce, onScreenCommand }) {
  const { navigate, goBack, descriptionMode, toggleDescriptionMode, setDescriptionMode } = useApp();
  const { removeLast, items } = useWardrobe();
  const { speak, stop, repeat, isSpeaking } = useSpeechOutput();

  const handleVoiceResult = useCallback((transcript) => {
    const command = parseCommand(transcript);
    if (!command) return;

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
      case "SET_DESC_MODE": {
        setDescriptionMode(command.mode);
        const msg = command.mode === "short" ? RESPONSES.shortDescOn : RESPONSES.longDescOn;
        speak(msg);
        if (announce) announce(msg, "polite");
        break;
      }
      case "TOGGLE_DESC_MODE": {
        toggleDescriptionMode();
        const nextMode = descriptionMode === "short" ? "long" : "short";
        const msg = nextMode === "short" ? RESPONSES.shortDescOn : RESPONSES.longDescOn;
        speak(msg);
        if (announce) announce(msg, "polite");
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
        // Forward screen-specific commands
        if (onScreenCommand) onScreenCommand(command);
        break;
      default:
        break;
    }
  }, [navigate, goBack, speak, stop, repeat, removeLast, onScreenCommand, descriptionMode, toggleDescriptionMode, setDescriptionMode, announce]);

  const { isListening, transcript, supported, startListening, stopListening, toggleListening } =
    useVoiceInput({ onResult: handleVoiceResult });

  return (
    <VoiceContext.Provider value={{
      speak, stop, repeat, isSpeaking,
      isListening, transcript, supported,
      startListening, stopListening, toggleListening,
    }}>
      {children}
    </VoiceContext.Provider>
  );
}

export function useVoice() {
  return useContext(VoiceContext);
}

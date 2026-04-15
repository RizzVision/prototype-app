import { createContext, useContext, useReducer, useCallback } from "react";
import { SCREENS } from "../utils/constants";

const AppContext = createContext();

function reducer(state, action) {
  switch (action.type) {
    case "NAVIGATE":
      return {
        ...state,
        screen: action.screen,
        screenHistory: [...state.screenHistory, state.screen],
        navParams: action.params || null,
      };
    case "GO_BACK": {
      if (state.screenHistory.length === 0) return state;
      const history = [...state.screenHistory];
      const prev = history.pop();
      return { ...state, screen: prev, screenHistory: history, navParams: null };
    }
    case "SET_PARAMS":
      return { ...state, navParams: action.params };
    case "TOGGLE_DESC_MODE": {
      const next = state.descriptionMode === "short" ? "long" : "short";
      safeLocalSet("rizzv_desc_mode", next);
      return { ...state, descriptionMode: next };
    }
    case "SET_DESC_MODE": {
      safeLocalSet("rizzv_desc_mode", action.mode);
      return { ...state, descriptionMode: action.mode };
    }
    default:
      return state;
  }
}

function safeLocalGet(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

function safeLocalSet(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, {
    screen: SCREENS.HOME,
    screenHistory: [],
    navParams: null,
    descriptionMode: safeLocalGet("rizzv_desc_mode", "short"),
  });

  const navigate = useCallback((screen, params) => {
    dispatch({ type: "NAVIGATE", screen, params });
  }, []);

  const goBack = useCallback(() => {
    dispatch({ type: "GO_BACK" });
  }, []);

  const toggleDescriptionMode = useCallback(() => {
    dispatch({ type: "TOGGLE_DESC_MODE" });
  }, []);

  const setDescriptionMode = useCallback((mode) => {
    dispatch({ type: "SET_DESC_MODE", mode });
  }, []);

  const canGoBack = state.screenHistory.length > 0;

  return (
    <AppContext.Provider value={{ ...state, navigate, goBack, canGoBack, toggleDescriptionMode, setDescriptionMode }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}

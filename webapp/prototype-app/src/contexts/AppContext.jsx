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
    default:
      return state;
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, {
    screen: SCREENS.HOME,
    screenHistory: [],
    navParams: null,
  });

  const navigate = useCallback((screen, params) => {
    dispatch({ type: "NAVIGATE", screen, params });
  }, []);

  const goBack = useCallback(() => {
    dispatch({ type: "GO_BACK" });
  }, []);

  const canGoBack = state.screenHistory.length > 0;

  return (
    <AppContext.Provider value={{ ...state, navigate, goBack, canGoBack }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}

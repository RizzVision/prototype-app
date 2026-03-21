import { createContext, useContext, useReducer, useEffect, useCallback } from "react";
import { loadWardrobe, addWardrobeItem, removeWardrobeItem } from "../utils/storage";
import { useAuth } from "./AuthContext";

const WardrobeContext = createContext();

function reducer(state, action) {
  switch (action.type) {
    case "SET_ITEMS":
      return { ...state, items: action.items, loading: false, error: null };
    case "ADD_ITEM":
      return { ...state, items: [...state.items, action.item] };
    case "REMOVE_ITEM":
      return { ...state, items: state.items.filter(i => i.id !== action.id) };
    case "LOADING":
      return { ...state, loading: true, error: null };
    case "ERROR":
      return { ...state, error: action.error, loading: false };
    default:
      return state;
  }
}

export function WardrobeProvider({ children }) {
  const { user } = useAuth();
  const [state, dispatch] = useReducer(reducer, {
    items: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (!user) {
      dispatch({ type: "SET_ITEMS", items: [] });
      return;
    }
    dispatch({ type: "LOADING" });
    loadWardrobe()
      .then(items => dispatch({ type: "SET_ITEMS", items }))
      .catch(err => dispatch({ type: "ERROR", error: err.message }));
  }, [user]);

  const addItem = useCallback(async (item) => {
    const saved = await addWardrobeItem(item);
    dispatch({ type: "ADD_ITEM", item: saved });
    return saved;
  }, []);

  const removeItem = useCallback(async (id) => {
    dispatch({ type: "REMOVE_ITEM", id });
    try {
      await removeWardrobeItem(id);
    } catch {
      const items = await loadWardrobe();
      dispatch({ type: "SET_ITEMS", items });
    }
  }, []);

  const removeLast = useCallback(async () => {
    const last = state.items[state.items.length - 1];
    if (last) await removeItem(last.id);
    return last;
  }, [state.items, removeItem]);

  const getItems = useCallback((category) => {
    if (!category) return state.items;
    return state.items.filter(i => i.category === category);
  }, [state.items]);

  return (
    <WardrobeContext.Provider value={{
      items: state.items,
      loading: state.loading,
      error: state.error,
      addItem,
      removeItem,
      removeLast,
      getItems,
    }}>
      {children}
    </WardrobeContext.Provider>
  );
}

export function useWardrobe() {
  return useContext(WardrobeContext);
}

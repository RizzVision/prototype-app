import { createContext, useContext, useReducer, useEffect } from "react";
import { loadWardrobe, saveWardrobe } from "../utils/storage";

const WardrobeContext = createContext();

let nextId = Date.now();

function reducer(state, action) {
  switch (action.type) {
    case "ADD_ITEM": {
      const item = { ...action.item, id: nextId++, dateAdded: new Date().toISOString() };
      return { ...state, items: [...state.items, item] };
    }
    case "REMOVE_ITEM":
      return { ...state, items: state.items.filter(i => i.id !== action.id) };
    case "REMOVE_LAST": {
      if (state.items.length === 0) return state;
      return { ...state, items: state.items.slice(0, -1) };
    }
    case "LOAD":
      return { ...state, items: action.items };
    default:
      return state;
  }
}

export function WardrobeProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, { items: [] });

  useEffect(() => {
    const saved = loadWardrobe();
    if (saved.length > 0) {
      dispatch({ type: "LOAD", items: saved });
      nextId = Math.max(...saved.map(i => i.id || 0), nextId) + 1;
    }
  }, []);

  useEffect(() => {
    saveWardrobe(state.items);
  }, [state.items]);

  const addItem = (item) => dispatch({ type: "ADD_ITEM", item });
  const removeItem = (id) => dispatch({ type: "REMOVE_ITEM", id });
  const removeLast = () => {
    const last = state.items[state.items.length - 1];
    dispatch({ type: "REMOVE_LAST" });
    return last;
  };
  const getItems = (category) => {
    if (!category) return state.items;
    return state.items.filter(i => i.category === category);
  };

  return (
    <WardrobeContext.Provider value={{ items: state.items, addItem, removeItem, removeLast, getItems }}>
      {children}
    </WardrobeContext.Provider>
  );
}

export function useWardrobe() {
  return useContext(WardrobeContext);
}

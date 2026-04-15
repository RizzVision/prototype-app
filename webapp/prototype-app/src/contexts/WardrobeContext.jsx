import { createContext, useContext, useReducer, useEffect, useCallback } from "react";
import { loadWardrobe, addWardrobeItem, removeWardrobeItem, deleteClothingImage, updateWardrobeItem } from "../utils/storage";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthContext";

function rowToItem(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    category: row.category,
    color: row.color,
    colorDescription: row.color_description,
    pattern: row.pattern,
    gender: row.gender,
    description: row.description,
    imageUrl: row.image_url,
    dateAdded: row.date_added,
  };
}

const WardrobeContext = createContext();

function reducer(state, action) {
  switch (action.type) {
    case "SET_ITEMS":
      return { ...state, items: action.items, loading: false, error: null };
    case "ADD_ITEM": {
      // Guard against real-time subscription delivering the INSERT before addItem resolves
      const alreadyExists = state.items.some(i => i.id === action.item.id);
      if (alreadyExists) return state;
      return { ...state, items: [action.item, ...state.items] };
    }
    case "REMOVE_ITEM":
      return { ...state, items: state.items.filter(i => i.id !== action.id) };
    case "UPSERT_ITEM": {
      const exists = state.items.some(i => i.id === action.item.id);
      if (exists) return state;
      return { ...state, items: [action.item, ...state.items] };
    }
    case "EDIT_ITEM":
      return { ...state, items: state.items.map(i => i.id === action.id ? { ...i, ...action.updates } : i) };
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

  useEffect(() => {
    if (!user || !supabase) return;
    const channel = supabase
      .channel(`wardrobe_items:${user.id}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "wardrobe_items",
        filter: `user_id=eq.${user.id}`,
      }, (payload) => {
        if (payload.eventType === "INSERT") {
          dispatch({ type: "UPSERT_ITEM", item: rowToItem(payload.new) });
        } else if (payload.eventType === "UPDATE") {
          dispatch({ type: "EDIT_ITEM", id: payload.new.id, updates: rowToItem(payload.new) });
        } else if (payload.eventType === "DELETE") {
          dispatch({ type: "REMOVE_ITEM", id: payload.old.id });
          if (payload.old.image_url) deleteClothingImage(payload.old.image_url);
        }
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [user]);

  const addItem = useCallback(async (item) => {
    const saved = await addWardrobeItem(item);
    dispatch({ type: "ADD_ITEM", item: saved });
    return saved;
  }, []);

  const removeItem = useCallback(async (id, imageUrl) => {
    const item = state.items.find(i => i.id === id);
    const resolvedImageUrl = imageUrl ?? item?.imageUrl ?? null;
    dispatch({ type: "REMOVE_ITEM", id });
    try {
      await removeWardrobeItem(id);
      await deleteClothingImage(resolvedImageUrl);
    } catch {
      const items = await loadWardrobe();
      dispatch({ type: "SET_ITEMS", items });
    }
  }, [state.items]);

  const removeLast = useCallback(async () => {
    const last = state.items[state.items.length - 1];
    if (last) await removeItem(last.id);
    return last;
  }, [state.items, removeItem]);

  const getItems = useCallback((category) => {
    if (!category) return state.items;
    return state.items.filter(i => i.category === category);
  }, [state.items]);

  const editItem = useCallback(async (id, updates) => {
    dispatch({ type: "EDIT_ITEM", id, updates });
    try {
      const saved = await updateWardrobeItem(id, updates);
      dispatch({ type: "EDIT_ITEM", id, updates: saved });
      return saved;
    } catch (err) {
      const items = await loadWardrobe();
      dispatch({ type: "SET_ITEMS", items });
      throw err;
    }
  }, []);

  return (
    <WardrobeContext.Provider value={{
      items: state.items,
      loading: state.loading,
      error: state.error,
      addItem,
      removeItem,
      removeLast,
      getItems,
      editItem,
    }}>
      {children}
    </WardrobeContext.Provider>
  );
}

export function useWardrobe() {
  return useContext(WardrobeContext);
}

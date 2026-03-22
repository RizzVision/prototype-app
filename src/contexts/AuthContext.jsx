import { createContext, useContext, useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

const AuthContext = createContext();

const OAUTH_REDIRECT_URL =
  import.meta.env.VITE_SUPABASE_OAUTH_REDIRECT_URL || `${window.location.origin}/auth/callback`;

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(() => Boolean(supabase));

  useEffect(() => {
    if (!supabase) {
      return;
    }

    supabase.auth
      .getSession()
      .then(({ data: { session }, error }) => {
        if (error) {
          console.error("Failed to restore auth session:", error.message);
        }
        setUser(session?.user ?? null);
      })
      .finally(() => {
        setLoading(false);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signUp = (email, password) =>
    supabase ? supabase.auth.signUp({ email, password }) : Promise.reject(new Error("Supabase not configured"));

  const signIn = (email, password) =>
    supabase ? supabase.auth.signInWithPassword({ email, password }) : Promise.reject(new Error("Supabase not configured"));

  const signInWithGoogle = () =>
    supabase
      ? supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: OAUTH_REDIRECT_URL,
            queryParams: {
              access_type: "offline",
              prompt: "consent",
            },
          },
        })
      : Promise.reject(new Error("Supabase not configured"));

  const signOut = () =>
    supabase ? supabase.auth.signOut() : Promise.resolve();

  return (
    <AuthContext.Provider value={{ user, loading, signUp, signIn, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

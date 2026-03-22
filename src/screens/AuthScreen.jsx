import { useState } from "react";
import Screen from "../components/Screen";
import BigButton from "../components/BigButton";
import { useAuth } from "../contexts/AuthContext";
import { C, FONT } from "../utils/constants";

const inputStyle = {
  width: "100%",
  minHeight: 56,
  background: C.surface,
  border: `2px solid ${C.border}`,
  borderRadius: 14,
  color: C.text,
  fontFamily: FONT,
  fontSize: 18,
  padding: "14px 20px",
  boxSizing: "border-box",
  outline: "none",
};

export default function AuthScreen() {
  const { signIn, signUp, signInWithGoogle } = useAuth();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);

  const isBusy = submitting || googleSubmitting;

  const mapAuthError = (message) => {
    if (!message) return "Something went wrong. Please try again.";
    const normalized = message.toLowerCase();

    if (normalized.includes("invalid login credentials")) {
      return "Email or password is incorrect.";
    }
    if (normalized.includes("email not confirmed")) {
      return "Check your inbox and confirm your email before signing in.";
    }
    if (normalized.includes("already registered")) {
      return "That email is already registered. Try signing in instead.";
    }
    if (normalized.includes("password should be at least")) {
      return "Password must be at least 6 characters long.";
    }
    return message;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const { error: authError } = isSignUp
        ? await signUp(email, password)
        : await signIn(email, password);

      if (authError) {
        setError(mapAuthError(authError.message));
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setGoogleSubmitting(true);

    try {
      const { error: authError } = await signInWithGoogle();
      if (authError) {
        setError(mapAuthError(authError.message));
      }
    } catch {
      setError("Google sign-in is unavailable right now. Please try again.");
    } finally {
      setGoogleSubmitting(false);
    }
  };

  return (
    <Screen
      title={isSignUp ? "Create Account" : "Welcome Back"}
      subtitle={isSignUp ? "Sign up to save your wardrobe." : "Sign in to access your wardrobe."}
    >
      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={isBusy}
        aria-label="Sign in with Google"
        style={{
          width: "100%",
          minHeight: 56,
          borderRadius: 14,
          border: `2px solid ${C.border}`,
          background: C.surface,
          color: C.text,
          fontFamily: FONT,
          fontSize: 17,
          fontWeight: 700,
          cursor: isBusy ? "not-allowed" : "pointer",
          opacity: isBusy ? 0.6 : 1,
        }}
      >
        {googleSubmitting ? "Redirecting to Google..." : "Continue with Google"}
      </button>

      <div
        aria-hidden
        style={{
          margin: "14px 0",
          width: "100%",
          borderTop: `1px solid ${C.border}`,
        }}
      />

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontFamily: FONT, fontSize: 14, color: C.muted, letterSpacing: "0.05em" }}>
            EMAIL
          </span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            aria-label="Email address"
            style={inputStyle}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontFamily: FONT, fontSize: 14, color: C.muted, letterSpacing: "0.05em" }}>
            PASSWORD
          </span>
          <input
            type="password"
            autoComplete={isSignUp ? "new-password" : "current-password"}
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 6 characters"
            aria-label="Password"
            style={inputStyle}
          />
        </label>

        {error && (
          <div
            role="alert"
            aria-live="assertive"
            style={{
              background: "rgba(255,85,85,0.12)",
              border: `1px solid ${C.danger}`,
              borderRadius: 12,
              padding: "12px 16px",
              fontFamily: FONT,
              fontSize: 15,
              color: C.danger,
            }}
          >
            {error}
          </div>
        )}

        <BigButton
          label={submitting ? "Please wait..." : isSignUp ? "Sign Up" : "Sign In"}
          hint={isSignUp ? "Create a new account" : "Sign in to your account"}
          icon={isSignUp ? "✨" : "→"}
          variant="primary"
          disabled={isBusy}
        />
      </form>

      <button
        onClick={() => { setIsSignUp(!isSignUp); setError(null); }}
        disabled={isBusy}
        aria-label={isSignUp ? "Switch to sign in" : "Switch to sign up"}
        style={{
          background: "transparent",
          border: "none",
          color: C.focus,
          fontFamily: FONT,
          fontSize: 16,
          fontWeight: 700,
          cursor: isBusy ? "not-allowed" : "pointer",
          opacity: isBusy ? 0.5 : 1,
          padding: "20px 0",
          width: "100%",
          textAlign: "center",
        }}
      >
        {isSignUp ? "Already have an account? Sign in" : "Don't have an account? Sign up"}
      </button>
    </Screen>
  );
}

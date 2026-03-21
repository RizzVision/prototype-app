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
  const { signIn, signUp } = useAuth();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const { error: authError } = isSignUp
        ? await signUp(email, password)
        : await signIn(email, password);

      if (authError) {
        setError(authError.message);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen
      title={isSignUp ? "Create Account" : "Welcome Back"}
      subtitle={isSignUp ? "Sign up to save your wardrobe." : "Sign in to access your wardrobe."}
    >
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
          onClick={handleSubmit}
          disabled={submitting}
        />
      </form>

      <button
        onClick={() => { setIsSignUp(!isSignUp); setError(null); }}
        aria-label={isSignUp ? "Switch to sign in" : "Switch to sign up"}
        style={{
          background: "transparent",
          border: "none",
          color: C.focus,
          fontFamily: FONT,
          fontSize: 16,
          fontWeight: 700,
          cursor: "pointer",
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

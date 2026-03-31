import { useEffect, useMemo, useState } from "react";
import { C, FONT } from "../utils/constants";
import { useAuth } from "../contexts/AuthContext";

function getOAuthErrorFromUrl() {
  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));

  const error = searchParams.get("error") || hashParams.get("error");
  const description = searchParams.get("error_description") || hashParams.get("error_description");

  if (!error && !description) return null;
  return description || error;
}

export default function AuthCallbackScreen() {
  const { user, loading } = useAuth();
  const [timedOut, setTimedOut] = useState(false);
  const callbackError = useMemo(() => getOAuthErrorFromUrl(), []);

  useEffect(() => {
    if (callbackError) return;
    if (loading) return;

    if (user) {
      window.location.replace("/");
      return;
    }

    const timer = setTimeout(() => {
      setTimedOut(true);
    }, 3000);

    return () => clearTimeout(timer);
  }, [callbackError, loading, user]);

  const message = callbackError
    ? callbackError
    : timedOut
      ? "Google sign-in did not complete. Please try again."
      : "Finishing sign-in...";

  return (
    <div
      style={{
        width: "100%",
        maxWidth: 430,
        margin: "0 auto",
        height: "100vh",
        background: C.bg,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        boxSizing: "border-box",
        fontFamily: FONT,
      }}
    >
      {!callbackError && !timedOut ? (
        <>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              border: `4px solid ${C.focus}`,
              borderTopColor: "transparent",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </>
      ) : null}

      <p
        role="status"
        aria-live="polite"
        style={{
          marginTop: 18,
          color: callbackError || timedOut ? C.danger : C.text,
          textAlign: "center",
          fontSize: 16,
          lineHeight: 1.4,
        }}
      >
        {message}
      </p>

      {(callbackError || timedOut) ? (
        <button
          onClick={() => window.location.replace("/")}
          style={{
            marginTop: 18,
            minHeight: 48,
            padding: "0 18px",
            borderRadius: 12,
            border: `2px solid ${C.border}`,
            background: C.surface,
            color: C.text,
            fontFamily: FONT,
            fontSize: 16,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Back to Login
        </button>
      ) : null}
    </div>
  );
}
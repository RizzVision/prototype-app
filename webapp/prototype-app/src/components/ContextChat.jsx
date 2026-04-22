/**
 * ContextChat — an in-screen follow-up chat panel.
 *
 * Sits at the bottom of any result screen. Collapsed by default.
 * Supports both text input and voice input (microphone button).
 * Conversation history stays in memory for the lifetime of this component —
 * intentionally ephemeral so each feature visit starts fresh.
 *
 * Props:
 *   context  {string}  The suggestion/result text the user is asking about.
 *   feature  {string}  "scan" | "mirror" | "outfit" | "shopping" | "wardrobe"
 *   speak    {fn}      speak(text) from useVoice()
 *   announce {fn}      announce(text, priority) from useAnnounce()
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { askContextChat } from "../services/rizzVisionApi";
import { C, FONT } from "../utils/constants";

const PLACEHOLDERS = {
  scan:      "e.g. Why does this colour not work?",
  mirror:    "e.g. What should I change first?",
  outfit:    "e.g. Can I swap one of these items?",
  shopping:  "e.g. Would this work for a wedding?",
  wardrobe:  "e.g. What goes with my white polo?",
};

export default function ContextChat({ context, feature, speak, announce }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState([]);  // [{role, text}]
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const inputRef = useRef(null);
  const bottomRef = useRef(null);
  const recognitionRef = useRef(null);

  // Scroll to bottom when history grows
  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, open]);

  // Focus input when panel opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 80);
  }, [open]);

  const submit = useCallback(async (text) => {
    const q = text.trim();
    if (!q || loading) return;
    setInput("");

    const userTurn = { role: "user", text: q };
    const nextHistory = [...history, userTurn];
    setHistory(nextHistory);
    setLoading(true);

    try {
      const { answer } = await askContextChat(q, context, feature, history);
      const assistantTurn = { role: "assistant", text: answer };
      setHistory([...nextHistory, assistantTurn]);
      speak(answer);
      announce(answer, "polite");
    } catch {
      const errMsg = "Something went wrong. Please try again.";
      setHistory([...nextHistory, { role: "assistant", text: errMsg }]);
      speak(errMsg);
    } finally {
      setLoading(false);
    }
  }, [history, context, feature, loading, speak, announce]);

  // ── Voice input ──────────────────────────────────────────────────────────────
  const startVoice = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      speak("Voice input is not supported in this browser.");
      return;
    }
    const rec = new SR();
    rec.lang = "en-IN";
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      const transcript = e.results[0][0].transcript.trim();
      setInput(transcript);
      setListening(false);
      // Auto-submit voice input
      submit(transcript);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);

    recognitionRef.current = rec;
    rec.start();
    setListening(true);
    speak("Listening. Ask your question.");
  }, [speak, submit]);

  const stopVoice = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div
      role="region"
      aria-label="Follow-up chat about this result"
      style={{ marginTop: 16 }}
    >
      {/* Toggle button */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="context-chat-panel"
        style={{
          width: "100%",
          background: open ? C.surface : "transparent",
          border: `2px solid ${open ? C.focus : C.border}`,
          borderRadius: open ? "14px 14px 0 0" : 14,
          padding: "14px 18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          fontFamily: FONT,
          color: open ? C.focus : C.muted,
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: "0.06em",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span aria-hidden>💬</span>
          Ask a follow-up question
          {history.length > 0 && (
            <span style={{
              background: C.focus, color: "#000",
              borderRadius: 10, padding: "1px 7px",
              fontSize: 11, fontWeight: 900,
            }}>
              {Math.floor(history.length / 2)}
            </span>
          )}
        </span>
        <span aria-hidden style={{ fontSize: 16 }}>{open ? "▲" : "▼"}</span>
      </button>

      {/* Chat panel */}
      {open && (
        <div
          id="context-chat-panel"
          style={{
            background: C.surface,
            border: `2px solid ${C.focus}`,
            borderTop: "none",
            borderRadius: "0 0 14px 14px",
            padding: "0 0 14px 0",
            maxHeight: 340,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* History */}
          <div
            role="log"
            aria-label="Conversation history"
            aria-live="polite"
            style={{
              overflowY: "auto",
              flex: 1,
              padding: "14px 16px 0",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              maxHeight: 220,
            }}
          >
            {history.length === 0 && (
              <p style={{ fontFamily: FONT, fontSize: 14, color: C.muted, margin: 0, lineHeight: 1.6 }}>
                Ask anything about this result. Your questions and answers stay here.
              </p>
            )}
            {history.map((turn, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: turn.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                <div
                  role={turn.role === "assistant" ? "status" : undefined}
                  aria-label={turn.role === "assistant" ? `Assistant: ${turn.text}` : undefined}
                  style={{
                    maxWidth: "82%",
                    background: turn.role === "user" ? C.focus : "#252525",
                    color: turn.role === "user" ? "#000" : C.text,
                    borderRadius: turn.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                    padding: "10px 14px",
                    fontFamily: FONT,
                    fontSize: 14,
                    lineHeight: 1.6,
                  }}
                >
                  {turn.text}
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                <div style={{
                  background: "#252525", borderRadius: "14px 14px 14px 4px",
                  padding: "10px 18px", fontFamily: FONT, fontSize: 20, color: C.muted,
                  letterSpacing: 4,
                }}>
                  <span aria-label="Thinking" role="status">•••</span>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input row */}
          <div style={{
            display: "flex", gap: 8, padding: "10px 14px 0",
            borderTop: `1px solid ${C.border}`, marginTop: 10,
          }}>
            {/* Mic button */}
            <button
              onClick={listening ? stopVoice : startVoice}
              aria-label={listening ? "Stop voice input" : "Start voice input — speak your question"}
              aria-pressed={listening}
              style={{
                width: 44, height: 44, flexShrink: 0,
                borderRadius: "50%",
                background: listening ? C.focus : C.surface,
                border: `2px solid ${listening ? C.focus : C.border}`,
                color: listening ? "#000" : C.muted,
                fontSize: 18,
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer",
                animation: listening ? "pulse 1s ease infinite" : "none",
              }}
            >
              <span aria-hidden>{listening ? "⏹" : "🎤"}</span>
              <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
            </button>

            {/* Text input */}
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit(input)}
              placeholder={PLACEHOLDERS[feature] || "Ask anything about this result…"}
              aria-label="Type your follow-up question"
              disabled={loading || listening}
              style={{
                flex: 1,
                background: "#1A1A1A",
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                padding: "10px 14px",
                fontFamily: FONT,
                fontSize: 14,
                color: C.text,
                outline: "none",
                opacity: loading || listening ? 0.5 : 1,
              }}
              onFocus={(e) => e.target.style.borderColor = C.focus}
              onBlur={(e) => e.target.style.borderColor = C.border}
            />

            {/* Send button */}
            <button
              onClick={() => submit(input)}
              disabled={!input.trim() || loading || listening}
              aria-label="Send question"
              style={{
                width: 44, height: 44, flexShrink: 0,
                borderRadius: 10,
                background: input.trim() && !loading && !listening ? C.focus : C.surface,
                color: input.trim() && !loading && !listening ? "#000" : C.muted,
                border: "none",
                fontFamily: FONT,
                fontSize: 18,
                fontWeight: 900,
                cursor: input.trim() && !loading && !listening ? "pointer" : "not-allowed",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <span aria-hidden>→</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

import { useRef, useCallback } from "react";

const SR_ONLY = { position: "absolute", left: -9999, width: 1, height: 1, overflow: "hidden" };

// Module-level refs shared between hook and component
const _politeRef = { current: null };
const _assertRef = { current: null };

export function LiveRegions() {
  return (
    <>
      <div
        ref={(el) => { _politeRef.current = el; }}
        aria-live="polite"
        aria-atomic="true"
        style={SR_ONLY}
      />
      <div
        ref={(el) => { _assertRef.current = el; }}
        aria-live="assertive"
        aria-atomic="true"
        style={SR_ONLY}
      />
    </>
  );
}

export function useAnnounce() {
  const announce = useCallback((msg, priority = "polite") => {
    const ref = priority === "assertive" ? _assertRef : _politeRef;
    if (!ref.current) return;
    ref.current.textContent = "";
    setTimeout(() => { if (ref.current) ref.current.textContent = msg; }, 80);
  }, []);

  return { announce, LiveRegions };
}

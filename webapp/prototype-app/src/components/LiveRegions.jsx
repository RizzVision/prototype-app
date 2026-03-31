import { useRef, useCallback } from "react";

const SR_ONLY = { position: "absolute", left: -9999, width: 1, height: 1, overflow: "hidden" };

export function useAnnounce() {
  const politeRef  = useRef(null);
  const assertRef  = useRef(null);

  const announce = useCallback((msg, priority = "polite") => {
    const ref = priority === "assertive" ? assertRef : politeRef;
    if (!ref.current) return;
    ref.current.textContent = "";
    setTimeout(() => { if (ref.current) ref.current.textContent = msg; }, 80);
  }, []);

  function LiveRegions() {
    return (
      <>
        <div ref={politeRef} aria-live="polite" aria-atomic="true" style={SR_ONLY} />
        <div ref={assertRef} aria-live="assertive" aria-atomic="true" style={SR_ONLY} />
      </>
    );
  }

  return { announce, LiveRegions };
}

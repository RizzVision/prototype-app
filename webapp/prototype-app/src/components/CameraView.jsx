import { useRef, useEffect, useState, useCallback } from "react";
import { C, FONT } from "../utils/constants";
import { describeFrame } from "../services/rizzVisionApi";
import { useLocale } from "../contexts/LocaleContext";

export default function CameraView({
  onCapture,
  onError,
  captureRef,
  describeRef,
  onDescribe,
  autoCapture = false,
  captureInterval = 5000,
}) {
  const { language } = useLocale();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const facingModeRef = useRef("environment");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [facingMode, setFacingMode] = useState("environment");
  const [describing, setDescribing] = useState(false);

  const onErrorRef = useRef(onError);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  const onDescribeRef = useRef(onDescribe);
  useEffect(() => { onDescribeRef.current = onDescribe; }, [onDescribe]);

  const startCamera = useCallback(async (facing) => {
    const mode = facing ?? facingModeRef.current;

    const attachStream = (stream) => {
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      setError(null);
      setReady(false);
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;

      let rafId = null;
      const markReady = () => {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          setReady(true);
          if (rafId) cancelAnimationFrame(rafId);
          return;
        }
        rafId = requestAnimationFrame(markReady);
      };

      video.addEventListener("loadedmetadata", markReady, { once: true });
      video.addEventListener("canplay", markReady, { once: true });
      video.addEventListener("loadeddata", markReady, { once: true });
      video.play().then(markReady).catch(markReady);
      markReady();
    };

    const showError = (err) => {
      const msg = err.name === "NotAllowedError"
        ? "Camera permission denied. Please allow camera access."
        : "Could not access camera. Please check your device settings.";
      setError(msg);
      if (onErrorRef.current) onErrorRef.current(msg);
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode }, width: { ideal: 1280 }, height: { ideal: 960 } },
      });
      attachStream(stream);
    } catch (err) {
      if (err.name === "NotAllowedError") { showError(err); return; }
      try {
        attachStream(await navigator.mediaDevices.getUserMedia({ video: true }));
      } catch (fallback) {
        showError(fallback);
      }
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setReady(false);
  }, []);

  const flipCamera = useCallback(async () => {
    const newMode = facingModeRef.current === "environment" ? "user" : "environment";
    facingModeRef.current = newMode;
    setFacingMode(newMode);
    stopCamera();
    await startCamera(newMode);
  }, [stopCamera, startCamera]);

  const captureFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    if (!video.videoWidth || !video.videoHeight) return null;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.85);
  }, []);

  const playShutterSound = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const playClick = (freq, startTime, gainVal) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(freq, startTime);
        gain.gain.setValueAtTime(gainVal, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.04);
        osc.start(startTime); osc.stop(startTime + 0.04);
      };
      playClick(1200, ctx.currentTime, 0.4);
      playClick(900, ctx.currentTime + 0.05, 0.3);
    } catch {
      // Audio feedback is optional; camera capture should still work without it.
    }
  };

  const onCaptureRef = useRef(onCapture);
  useEffect(() => { onCaptureRef.current = onCapture; }, [onCapture]);

  const handleCapture = useCallback(() => {
    playShutterSound();
    const dataUrl = captureFrame();
    if (dataUrl && onCaptureRef.current) {
      const base64 = dataUrl.split(",")[1];
      onCaptureRef.current(base64, dataUrl);
    }
  }, [captureFrame]);

  // Gemini-powered describe — replaces COCO-SSD
  const triggerDescribe = useCallback(async () => {
    if (!ready || describing) return;
    const dataUrl = captureFrame();
    if (!dataUrl) return;

    setDescribing(true);
    if (onDescribeRef.current) onDescribeRef.current("Looking at the frame…");

    try {
      const base64 = dataUrl.split(",")[1];
      const { description } = await describeFrame(base64, language);
      if (onDescribeRef.current) onDescribeRef.current(description);
    } catch {
      if (onDescribeRef.current) onDescribeRef.current("Could not describe the frame. Please try again.");
    } finally {
      setDescribing(false);
    }
  }, [ready, describing, captureFrame, language]);

  useEffect(() => {
    startCamera();
    return stopCamera;
  }, [startCamera, stopCamera]);

  useEffect(() => {
    if (captureRef) captureRef.current = handleCapture;
  }, [captureRef, handleCapture]);

  useEffect(() => {
    if (describeRef) describeRef.current = triggerDescribe;
  }, [describeRef, triggerDescribe]);

  // Auto-capture timer (shopping mode)
  useEffect(() => {
    if (!autoCapture || !ready) return;
    const id = setInterval(() => handleCapture(), captureInterval);
    return () => clearInterval(id);
  }, [autoCapture, captureInterval, ready, handleCapture]);

  if (error) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 40, textAlign: "center" }}>
        <p style={{ fontFamily: FONT, fontSize: 18, color: C.danger, lineHeight: 1.6 }}>{error}</p>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, position: "relative", background: "#000" }}>
      <video
        ref={videoRef} autoPlay playsInline muted aria-hidden
        style={{ width: "100%", height: "100%", objectFit: "cover", position: "absolute", top: 0, left: 0 }}
      />
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {/* Target zone */}
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <div style={{
          position: "absolute", top: "10%", left: "15%", width: "70%", height: "80%",
          border: "3px solid rgba(255,255,255,0.35)", borderRadius: 16, boxSizing: "border-box",
        }} />
      </div>

      {/* Flip camera */}
      <div style={{ position: "absolute", top: 20, right: 20 }}>
        <button
          onClick={flipCamera} disabled={!ready}
          aria-label={facingMode === "environment" ? "Switch to front camera" : "Switch to back camera"}
          style={{
            width: 56, height: 56, borderRadius: "50%",
            background: "rgba(0,0,0,0.55)", border: "2px solid rgba(255,255,255,0.7)",
            cursor: ready ? "pointer" : "not-allowed",
            display: "flex", alignItems: "center", justifyContent: "center",
            opacity: ready ? 1 : 0.4, boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
          }}
        >
          <svg aria-hidden viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7h2l2-2h10l2 2h2a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/>
            <path d="M9 13a3 3 0 1 0 6 0"/><polyline points="15 10 15 13 12 13"/>
          </svg>
        </button>
      </div>

      {/* Bottom controls */}
      <div style={{
        position: "absolute", bottom: 40, left: 0, right: 0,
        display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
      }}>
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 28 }}>
          {/* Describe button — calls Gemini */}
          <button
            onClick={triggerDescribe}
            disabled={!ready || describing}
            aria-label={describing ? "Describing frame…" : "Describe what is in frame using AI"}
            style={{
              width: 72, height: 72, borderRadius: "50%",
              background: describing ? C.focus : "rgba(0,0,0,0.65)",
              border: "3px solid rgba(255,255,255,0.7)",
              cursor: ready && !describing ? "pointer" : "not-allowed",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 28, opacity: ready ? 1 : 0.4,
              boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
              animation: describing ? "pulse 1s ease infinite" : "none",
            }}
          >
            <span aria-hidden>{describing ? "⏳" : "👁"}</span>
            <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }`}</style>
          </button>

          {/* Capture button */}
          <button
            onClick={handleCapture} disabled={!ready}
            aria-label="Capture photo"
            style={{
              width: 88, height: 88, borderRadius: "50%",
              background: ready ? C.focus : C.surface,
              border: `4px solid ${C.white}`,
              cursor: ready ? "pointer" : "not-allowed",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 36, color: "#000", fontWeight: 900,
              boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
            }}
          >
            <span aria-hidden>📸</span>
          </button>
        </div>

        <div style={{ display: "flex", justifyContent: "center", gap: 52, paddingTop: 4 }}>
          <span style={{ fontFamily: FONT, fontSize: 12, color: "rgba(255,255,255,0.7)", width: 72, textAlign: "center" }}>
            {describing ? "Describing…" : "What's Here?"}
          </span>
          <span style={{ fontFamily: FONT, fontSize: 12, color: "rgba(255,255,255,0.7)", width: 88, textAlign: "center" }}>Capture</span>
        </div>
      </div>

      {!ready && !error && (
        <div style={{
          position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
          fontFamily: FONT, fontSize: 18, color: C.muted,
        }}>
          Starting camera...
        </div>
      )}
    </div>
  );
}

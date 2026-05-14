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
  showControls = true,
}) {
  const { language } = useLocale();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const facingModeRef = useRef("environment");
  const retryRef = useRef(0);
  const startIdRef = useRef(0);
  const blackFrameCheckRef = useRef(null);
  const activeDeviceIdRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [facingMode, setFacingMode] = useState("environment");
  const [describing, setDescribing] = useState(false);
  const [cameraStatus, setCameraStatus] = useState("Starting camera...");
  const [frameVisible, setFrameVisible] = useState(false);

  const onErrorRef = useRef(onError);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  const onDescribeRef = useRef(onDescribe);
  useEffect(() => { onDescribeRef.current = onDescribe; }, [onDescribe]);

  const requestStream = useCallback(async (constraints, timeoutMs = 7000) => {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new DOMException("Camera request timed out.", "TimeoutError"));
      }, timeoutMs);
    });

    try {
      return await Promise.race([
        navigator.mediaDevices.getUserMedia(constraints),
        timeout,
      ]);
    } finally {
      clearTimeout(timeoutId);
    }
  }, []);

  const startCamera = useCallback(async (facing, deviceId) => {
    const mode = facing ?? facingModeRef.current;
    const startId = startIdRef.current + 1;
    startIdRef.current = startId;
    setCameraStatus("Starting camera...");
    setFrameVisible(false);

    const attachStream = (stream) => {
      if (startId !== startIdRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      setError(null);
      setPermissionDenied(false);
      setReady(false);
      setFrameVisible(false);
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");

      let rafId = null;
      const markReady = () => {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          setReady(true);
          setCameraStatus("");
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

      setTimeout(() => {
        if (startId === startIdRef.current && (!video.videoWidth || !video.videoHeight)) {
          setCameraStatus("Camera opened, but video has not started. Tap Start camera.");
        }
      }, 2500);
    };

    const showError = (err) => {
      const msg = err.name === "NotAllowedError"
        ? "Camera permission denied. Please allow camera access."
        : "Could not access camera. Please check your device settings.";
      setPermissionDenied(err.name === "NotAllowedError");
      setError(msg);
      if (onErrorRef.current) onErrorRef.current(msg);
    };

    const stopCurrentStream = () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };

    const makeConstraints = () => ({
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
        : { facingMode: { ideal: mode }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    });

    try {
      stopCurrentStream();
      const stream = await requestStream(makeConstraints());
      activeDeviceIdRef.current = stream.getVideoTracks()[0]?.getSettings?.().deviceId || deviceId || null;
      attachStream(stream);
    } catch (err) {
      if (err.name === "NotAllowedError") { showError(err); return; }
      try {
        setCameraStatus("Trying default camera...");
        stopCurrentStream();
        const stream = await requestStream({ video: true });
        activeDeviceIdRef.current = stream.getVideoTracks()[0]?.getSettings?.().deviceId || null;
        attachStream(stream);
      } catch (fallback) {
        showError(fallback);
      }
    }
  }, [requestStream]);

  const stopCamera = useCallback(() => {
    startIdRef.current += 1;
    if (blackFrameCheckRef.current) {
      clearTimeout(blackFrameCheckRef.current);
      blackFrameCheckRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setReady(false);
    setFrameVisible(false);
  }, []);

  const flipCamera = useCallback(async () => {
    const newMode = facingModeRef.current === "environment" ? "user" : "environment";
    facingModeRef.current = newMode;
    setFacingMode(newMode);
    stopCamera();
    retryRef.current = 0;
    activeDeviceIdRef.current = null;
    await startCamera(newMode);
  }, [stopCamera, startCamera]);

  const resumeVideo = useCallback(async () => {
    const video = videoRef.current;
    if (!video) {
      await startCamera(facingModeRef.current);
      return;
    }

    try {
      await video.play();
      if (video.videoWidth && video.videoHeight) {
        setReady(true);
        setCameraStatus("");
      } else if (!streamRef.current) {
        await startCamera(facingModeRef.current);
      } else {
        setCameraStatus("Waiting for camera frames...");
      }
    } catch {
      await startCamera(facingModeRef.current);
    }
  }, [startCamera]);

  const retryCamera = useCallback(async () => {
    setError(null);
    setPermissionDenied(false);
    retryRef.current = 0;
    activeDeviceIdRef.current = null;
    await startCamera(facingModeRef.current);
  }, [startCamera]);

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

  const getFrameBrightness = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) return null;

    const size = 24;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, size, size);
    const pixels = ctx.getImageData(0, 0, size, size).data;
    let total = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      total += 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
    }
    return total / (pixels.length / 4);
  }, []);

  const recoverFromBlackFrame = useCallback(async () => {
    const devices = await navigator.mediaDevices?.enumerateDevices?.().catch(() => []) || [];
    const cameras = devices.filter((device) => device.kind === "videoinput");
    const currentIndex = cameras.findIndex((device) => device.deviceId === activeDeviceIdRef.current);
    const nextDevice = cameras.length > 1
      ? cameras[(currentIndex + 1 + cameras.length) % cameras.length]
      : null;

    if (retryRef.current >= Math.max(2, cameras.length + 1)) {
      setCameraStatus("Camera is open but the image is black. Try the camera switch button or check camera privacy settings.");
      return;
    }

    retryRef.current += 1;
    setCameraStatus("Camera image is black. Trying another camera...");

    if (nextDevice && nextDevice.deviceId !== activeDeviceIdRef.current) {
      stopCamera();
      await startCamera(undefined, nextDevice.deviceId);
      return;
    }

    const nextMode = retryRef.current % 2 === 1
      ? (facingModeRef.current === "environment" ? "user" : "environment")
      : undefined;

    if (nextMode) {
      facingModeRef.current = nextMode;
      setFacingMode(nextMode);
    }

    stopCamera();
    await startCamera(nextMode);
  }, [startCamera, stopCamera]);

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
    if (!ready) return;
    if (blackFrameCheckRef.current) clearTimeout(blackFrameCheckRef.current);

    blackFrameCheckRef.current = setTimeout(() => {
      const brightness = getFrameBrightness();
      if (brightness !== null && brightness < 3) {
        setFrameVisible(false);
        recoverFromBlackFrame();
      } else if (brightness !== null) {
        retryRef.current = 0;
        setFrameVisible(true);
        setCameraStatus("");
      }
    }, 1200);

    return () => {
      if (blackFrameCheckRef.current) clearTimeout(blackFrameCheckRef.current);
    };
  }, [ready, getFrameBrightness, recoverFromBlackFrame]);

  useEffect(() => {
    if (captureRef) captureRef.current = handleCapture;
  }, [captureRef, handleCapture]);

  useEffect(() => {
    if (describeRef) describeRef.current = triggerDescribe;
  }, [describeRef, triggerDescribe]);

  // Auto-capture timer (shopping mode)
  useEffect(() => {
    if (!autoCapture || !ready || !frameVisible) return;
    const id = setInterval(() => handleCapture(), captureInterval);
    return () => clearInterval(id);
  }, [autoCapture, captureInterval, ready, frameVisible, handleCapture]);

  if (error) {
    return (
      <div style={{
        flex: 1, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: 32, textAlign: "center", gap: 16,
      }}>
        <p style={{ fontFamily: FONT, fontSize: 18, color: C.danger, lineHeight: 1.6, margin: 0 }}>
          {error}
        </p>
        {permissionDenied && (
          <p style={{ fontFamily: FONT, fontSize: 14, color: C.muted, lineHeight: 1.6, margin: 0 }}>
            Allow camera for {window.location.origin}, then refresh or tap retry.
          </p>
        )}
        <button
          type="button"
          onClick={retryCamera}
          style={{
            fontFamily: FONT, fontSize: 16, fontWeight: 800,
            color: "#000", background: C.focus,
            border: "none", borderRadius: 12,
            padding: "12px 18px", cursor: "pointer",
          }}
        >
          Retry camera
        </button>
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

      {showControls && (
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
      )}

      {(!ready || cameraStatus) && !error && (
        <div style={{
          position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
          width: "80%", textAlign: "center",
          fontFamily: FONT, fontSize: 18, color: C.muted, lineHeight: 1.5,
          display: "flex", flexDirection: "column", alignItems: "center", gap: 16,
        }}>
          <span>{cameraStatus || "Starting camera..."}</span>
          {cameraStatus && cameraStatus !== "Starting camera..." && (
            <button
              type="button"
              onClick={resumeVideo}
              style={{
                fontFamily: FONT, fontSize: 16, fontWeight: 800,
                color: "#000", background: C.focus,
                border: "none", borderRadius: 12,
                padding: "12px 18px", cursor: "pointer",
              }}
            >
              Start camera
            </button>
          )}
        </div>
      )}
    </div>
  );
}

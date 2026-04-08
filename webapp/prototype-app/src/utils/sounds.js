let _ctx = null;
function getCtx() {
  if (!_ctx || _ctx.state === "closed")
    _ctx = new (window.AudioContext || window.webkitAudioContext)();
  return _ctx;
}
function tone(c, freq, start, dur, gain = 0.2, type = "sine") {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(gain, start);
  g.gain.exponentialRampToValueAtTime(0.001, start + dur);
  osc.connect(g); g.connect(c.destination);
  osc.start(start); osc.stop(start + dur);
}
export function playTap()              { try { const c = getCtx(); tone(c, 800, c.currentTime, 0.035, 0.06); } catch {} }
export function playSuccess()          { try { const c = getCtx(); const t = c.currentTime; tone(c, 880, t, 0.11); tone(c, 1046, t + 0.12, 0.11); } catch {} }
export function playError()            { try { const c = getCtx(); const t = c.currentTime; tone(c, 220, t, 0.12, 0.25, "sawtooth"); tone(c, 160, t + 0.13, 0.12, 0.2, "sawtooth"); } catch {} }
export function playNav()              { try { const c = getCtx(); tone(c, 440, c.currentTime, 0.08, 0.12); } catch {} }
export function playMicOn()            { try { const c = getCtx(); const t = c.currentTime; tone(c, 440, t, 0.06, 0.18); tone(c, 880, t + 0.07, 0.06, 0.15); } catch {} }
export function playMicOff()           { try { const c = getCtx(); const t = c.currentTime; tone(c, 660, t, 0.06, 0.18); tone(c, 440, t + 0.07, 0.06, 0.15); } catch {} }
export function playCommandRecognized(){ try { const c = getCtx(); tone(c, 1046, c.currentTime, 0.06, 0.12); } catch {} }
export function playSaved()            { try { const c = getCtx(); const t = c.currentTime; tone(c, 523, t, 0.08); tone(c, 659, t + 0.09, 0.08); tone(c, 784, t + 0.18, 0.08); } catch {} }
export function playDeleted()          { try { const c = getCtx(); const t = c.currentTime; tone(c, 440, t, 0.055, 0.18); tone(c, 330, t + 0.065, 0.055, 0.15); } catch {} }

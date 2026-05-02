<!-- BEGIN:agent-overview -->
# Agent Customization Guide: RizzVision Prototype App

This is a **voice-first accessibility-focused prototype** with non-standard architecture. Read this before making changes—many patterns differ from typical React/FastAPI apps.

**Status**: ⚠️ **No automated tests** — testing is manual (curl + browser).  
**Deployment**: Frontend → Vercel (auto-deploy); Backend → HuggingFace Spaces (manual).

<!-- END:agent-overview -->

## Architecture Overview

<!-- BEGIN:navigation-architecture -->
### Non-Standard: Stack-Based Navigation (No URL Routing)

This app **does NOT use React Router**. Navigation is context stack-based:

- `AppContext` maintains a **history stack** (`screenHistory: []`)
- `navigate(screen, params)` **pushes** a screen onto the stack
- `goBack()` **pops** from the stack
- `App.jsx` contains a **switch/dispatcher** that renders `screenHistory[currentIndex]`
- Screen names are constants: `SCREENS.HOME`, `SCREENS.SCAN`, `SCREENS.WARDROBE`, etc. (see `src/utils/constants.js`)

**Example**:
```javascript
// Don't do this:
navigate('/wardrobe') // ❌ No URL routing

// Do this:
navigate(SCREENS.WARDROBE) // ✓ Push to stack
goBack() // ✓ Pop from stack
```

**Implication**: Back navigation is a pop, not a history.back(). No browser back button integration.

<!-- END:navigation-architecture -->

<!-- BEGIN:state-management -->
### State Management: 4 Context Providers

**Always check which context is responsible for a state piece:**

| Context | Responsibility | Key Methods | Location |
|---------|-----------------|------------|----------|
| **AppContext** | Screen stack & navigation | `navigate()`, `goBack()`, `toggleDescriptionMode()` | `src/contexts/AppContext.jsx` |
| **AuthContext** | Supabase user session | `login()`, `logout()`, `signUpWithGoogle()` | `src/contexts/AuthContext.jsx` |
| **WardrobeContext** | Wardrobe items + real-time sync | `addItem()`, `removeItem()`, `editItem()` | `src/contexts/WardrobeContext.jsx` |
| **VoiceContext** | Voice input/output + LLM think state | `startListening()`, `stopListening()`, `speak()` | `src/contexts/VoiceContext.jsx` |

**Critical pattern—deduplication in WardrobeContext**:
The `postgres_changes` subscription can deliver an INSERT before the API response returns. Guard against duplicates:

```javascript
const addItem = (item) => {
  // ✓ Check if already exists by ID or color hex distance
  const exists = state.items.some(i => i.id === item.id);
  if (exists) return; // Skip duplicate
  
  dispatch({ type: 'ADD_ITEM', payload: item });
};
```

<!-- END:state-management -->

<!-- BEGIN:backend-pipeline -->
### Backend: 7-Stage Analysis Pipeline (`POST /analyze`)

**Understand the full flow before modifying `/analyze` endpoint:**

```
Image Input
  ↓ [1. Ingest/Validate] → Check file exists, format valid
  ↓ [2. Quality Gate] → Brightness (40-230), sharpness (>100), file size OK
  ↓ [3. Resize] → Target 512px; keep aspect ratio
  ↓ [4. Clothing Check] → SegFormer B2 semantic segmentation + CLIP verification
  ↓ [5. Color Engine] → 6 parallel analyzers (harmony, skin tone, seasonal, proportion, occasion, style)
  ↓ [6. Gemini LLM Call] → Single LLM invocation with optional occasion context
  ↓ [7. Response Shaping] → Convert LLM output to TTS-ready speech segments
  ↓ Return JSON
{ speech_segments: [...], occasion_verdict: "...", wardrobe_description: "..." }
```

**Key stages**:
- **Quality Gate failure** → Return HTTP 422 with `{ error_code, user_message }` (TTS-ready)
- **Model downloads** → First run: ~5 min (600MB SegFormer + CLIP); cached in `/app/hf_cache` thereafter
- **Occasion context is optional** — LLM call includes it if provided; gracefully handles absence

**Entry point**: `app/api/routes.py` → `POST /analyze` handler

<!-- END:backend-pipeline -->

<!-- BEGIN:voice-first-design -->
### Voice-First Design: Command Parsing & LLM Fallback

Voice input follows a **two-tier dispatch**:

1. **Fast-path regex matching** (`src/voice/commandParser.js`)
   - 50+ built-in intents (e.g., "show me my wardrobe", "take a photo")
   - Regex patterns for each intent
   - Executes immediately on match
   
2. **LLM fallback** (`src/services/rizzVisionApi.js` → `chatWithAssistant()`)
   - Only if no regex match
   - Calls backend `/chat` endpoint with Gemini
   - Slower but flexible

**Don't skip the command parser**—it handles common intents 10x faster than LLM.

**Voice output**:
- Uses Web Speech Synthesis API (en-IN default)
- Hooks: `useSpeechOutput()` in `src/hooks/useSpeechOutput.js`
- All state changes announced via ARIA live regions (`src/components/LiveRegions.jsx`)

<!-- END:voice-first-design -->

<!-- BEGIN:error-handling -->
### Error Handling: Never Show Error Codes

**Rule**: All errors must include a **TTS-ready human-readable message**.

**Backend example**:
```python
# ✗ Bad
raise Exception("INVALID_IMAGE_FORMAT")

# ✓ Good
raise ImageQualityError(
    error_code="INVALID_IMAGE_FORMAT",
    user_message="Sorry, that image format isn't supported. Please try a photo of clothing."
)
```

**Frontend catches and announces**:
```javascript
try {
  const result = await analyzeOutfit(imageBlob);
} catch (err) {
  if (err instanceof ImageQualityError) {
    speak(err.user_message); // ← TTS-ready
  }
}
```

<!-- END:error-handling -->

## Code Organization Patterns

<!-- BEGIN:file-structure -->
### Where Everything Lives

| Concern | Location | Notes |
|---------|----------|-------|
| **Screens** (navigable views) | `webapp/prototype-app/src/screens/` | 10 screen components; each manages local phase state |
| **Reusable components** | `webapp/prototype-app/src/components/` | BigButton, CameraView, LiveRegions, ContextChat |
| **Navigation + global state** | `webapp/prototype-app/src/contexts/` | 4 context providers |
| **Voice command dispatcher** | `webapp/prototype-app/src/voice/commandParser.js` | Fast-path regex matching |
| **Supabase CRUD** | `webapp/prototype-app/src/utils/storage.js` | `loadWardrobe()`, `addWardrobeItem()`, etc. |
| **API client** | `webapp/prototype-app/src/services/rizzVisionApi.js` | `analyzeOutfit()`, `chatWithAssistant()` |
| **Constants** | `webapp/prototype-app/src/utils/constants.js` | SCREENS, Colors (C), OCCASIONS, FONT |
| **FastAPI routes** | `app/api/routes.py` | `POST /analyze`, `POST /chat`, `POST /shopping-analyze` |
| **Config** | `app/core/config.py` | Settings; loads .env; warns if GEMINI_API_KEY missing |
| **Image processing** | `app/services/image_ingestion.py` | Quality checks, resize, compression |
| **Segmentation** | `app/services/garment_segmentation.py` | SegFormer B2 model; verifies clothing presence |
| **Color analyzers** | `app/services/color_engine/` | harmony, skin_analysis, seasonal, proportion, occasion, style_profiler |
| **LLM integration** | `app/services/llm_feedback.py` | Single Gemini call; orchestrated by color engine |
| **Response shaping** | `app/services/response_shaper.py` | Converts LLM output to speech segments |

<!-- END:file-structure -->

<!-- BEGIN:accessibility-conventions -->
### Accessibility-First Design Conventions

**Font & Colors** (defined in `src/utils/constants.js`):
```javascript
FONT: 'Atkinson Hyperlegible' // Dyslexia-friendly
C: {
  bg: '#0D0D0D',      // Dark background
  text: '#F0F0F0',    // High contrast text
  focus: '#FFD600',   // Vibrant yellow focus ring
  accent: '#FF006E'   // Magenta accents
}
```

**Touch targets**: Minimum 48px on all interactive elements.

**Announcements**: ARIA live regions announce state changes:
```javascript
// In LiveRegions.jsx
<div role="status" aria-live="polite" aria-atomic="true">
  {announcement}
</div>
<div role="status" aria-live="assertive" aria-atomic="true">
  {urgentAnnouncement} // For errors
</div>
```

**When adding UI components**:
1. Include `aria-label` or `aria-labelledby`
2. Ensure touch targets ≥ 48px
3. Use focus colors from `C` constants
4. Test with screen reader (macOS VoiceOver)

<!-- END:accessibility-conventions -->

<!-- BEGIN:supabase-realtime -->
### Real-Time Sync Pattern: Supabase Subscriptions

**WardrobeContext subscribes to `postgres_changes`**:

```javascript
// In WardrobeContext.jsx
useEffect(() => {
  const subscription = supabase
    .channel('wardrobe_changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'wardrobe_items' },
      (payload) => {
        if (payload.eventType === 'INSERT') {
          // ⚠️ CRITICAL: Check for duplicates (API response may arrive later)
          const exists = state.items.some(i => i.id === payload.new.id);
          if (!exists) dispatch({ type: 'ADD_ITEM', payload: payload.new });
        }
      }
    )
    .subscribe();
  
  return () => subscription.unsubscribe();
}, []);
```

**Important**:
- Subscriptions are **eventually consistent**; may lag seconds
- Always add **deduplication guards** when syncing
- Test race conditions: add item, then subscribe, verify no duplicates

<!-- END:supabase-realtime -->

## Development Workflow

<!-- BEGIN:commands-reference -->
### Build/Test/Run Commands

**Frontend** (`webapp/prototype-app/`):
```bash
npm run dev       # Vite dev server → http://localhost:5173
npm run build     # Production build to dist/
npm run preview   # Preview production build
npm run lint      # ESLint
```

**Backend** (repo root):
```bash
# Dev server
uvicorn main:app --reload  # http://localhost:8000

# Production (HuggingFace Spaces)
uvicorn main:app --host 0.0.0.0 --port 7860

# Health check
curl http://localhost:8000/health

# Test image analysis
curl -F "image=@outfit.jpg" http://localhost:8000/analyze
```

**Environment setup**:
```bash
# Frontend
cd webapp/prototype-app
cp .env.local.example .env.local
# Fill in: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_SUPABASE_OAUTH_REDIRECT_URL

# Backend
cp .env.example .env
# Fill in: GEMINI_API_KEY (required)
# Optional: Supabase keys (defaults in config.py if missing)
```

<!-- END:commands-reference -->

<!-- BEGIN:common-issues -->
### Common Development Issues

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| Backend LLM calls fail silently | `GEMINI_API_KEY` missing | Check `.env`; backend logs warnings |
| First `/analyze` is slow (~5 min) | Model download (SegFormer + CLIP) | Subsequent calls use `/app/hf_cache` |
| Microphone/camera won't activate | Browser permissions blocked | Ensure HTTPS or localhost; check console |
| WardrobeContext doesn't sync | Supabase not configured | Fill in `VITE_SUPABASE_*` env vars |
| Double-adding items | Race condition: subscription + API response | Deduplication guard is already in place; check if it's being bypassed |
| Voice commands don't work | Command not in parser regex | Check `src/voice/commandParser.js`; add intent if needed |

<!-- END:common-issues -->

<!-- BEGIN:testing-approach -->
### Testing: Manual Only (No Automated Tests)

⚠️ **Status**: Zero test framework; testing is purely manual.

**Backend testing** (curl commands):
```bash
# Health check
curl http://localhost:8000/health

# Analyze outfit
curl -F "image=@path/to/image.jpg" http://localhost:8000/analyze

# Check error handling
curl -F "image=@corrupted.txt" http://localhost:8000/analyze
```

**Frontend testing**:
1. Browser DevTools (Network, Console)
2. Manual UI interactions via voice/clicks
3. Screen reader testing (macOS VoiceOver)

**After deployment**:
- Check Vercel deployment status (frontend)
- Check HuggingFace Spaces logs (backend)
- Manual end-to-end test via deployed URLs

**Implications**:
- No regression tests → breaking changes may slip through
- No integration tests → frontend/backend mismatches only caught in production
- **Always test locally before pushing**

<!-- END:testing-approach -->

<!-- BEGIN:deployment-paths -->
### Deployment

**Frontend → Vercel** (auto-deploy from git):
- Build command: `cd webapp/prototype-app && npm install && npm run build`
- Output directory: `webapp/prototype-app/dist`
- SPA rewrite: all routes → `/index.html`

**Backend → HuggingFace Spaces** (manual):
- Dockerfile at repo root
- Base image: `python:3.11` (CPU-only; no CUDA)
- Models cached in `/app/hf_cache`
- Port: 7860 (HF Spaces default)

**Note**: No staging environment—deployments go directly to production.

<!-- END:deployment-paths -->

## Code Patterns & Conventions

<!-- BEGIN:screen-component-pattern -->
### Screen Component Pattern

Each screen is a controlled component that:
1. Manages **local phase state** (e.g., "recording", "analyzing", "result")
2. Optionally registers a **voice command handler** with VoiceContext
3. Renders based on phase

**Example template**:
```javascript
// src/screens/ScanScreen.jsx
const ScanScreen = () => {
  const [phase, setPhase] = useState('idle'); // local phase
  const { navigate } = useContext(AppContext);
  const { registerScreenHandler, stopListening } = useContext(VoiceContext);
  
  // Register voice commands for this screen only
  useEffect(() => {
    const handler = (intent) => {
      if (intent === 'RETAKE_PHOTO') {
        setPhase('idle');
      } else if (intent === 'USE_PHOTO') {
        analyzeAndNavigate();
      }
    };
    registerScreenHandler(handler);
    return () => stopListening(); // Cleanup
  }, []);
  
  // Render based on phase
  switch (phase) {
    case 'idle':
      return <CameraView onCapture={() => setPhase('preview')} />;
    case 'preview':
      return <PhotoPreview onConfirm={() => analyzeAndNavigate()} />;
    case 'analyzing':
      return <LoadingSpinner text="Analyzing outfit..." />;
    case 'result':
      return <ResultCard result={result} />;
  }
};
```

<!-- END:screen-component-pattern -->

<!-- BEGIN:component-composition -->
### Component Composition

**Reusable components** are in `src/components/`:
- `BigButton.jsx` — Large touch-friendly button (48px min)
- `CameraView.jsx` — Camera capture wrapper
- `LiveRegions.jsx` — ARIA announcements
- `ContextChat.jsx` — Chat interface
- Others as needed

**Pattern**: Props are minimal; components pull context as needed.

```javascript
// ✓ Good—component pulls its own context
const MyComponent = ({ onAction }) => {
  const { wardrobe } = useContext(WardrobeContext);
  return <div onClick={() => onAction(wardrobe)}>...</div>;
};

// ✗ Bad—too many prop drills
const MyComponent = ({ wardrobe, user, onAction, theme, ... }) => { ... };
```

<!-- END:component-composition -->

<!-- BEGIN:api-client-pattern -->
### API Client Pattern (`src/services/rizzVisionApi.js`)

All backend calls go through this client. Add new endpoints here first:

```javascript
export const analyzeOutfit = async (imageBlob, occasion) => {
  const formData = new FormData();
  formData.append('image', imageBlob);
  if (occasion) formData.append('occasion', occasion);
  
  const response = await fetch(`${API_BASE}/analyze`, {
    method: 'POST',
    body: formData,
  });
  
  if (!response.ok) {
    const { error_code, user_message } = await response.json();
    throw new ImageQualityError(error_code, user_message);
  }
  
  return response.json();
};
```

**Always**:
1. Include TTS-ready error messages
2. Throw typed errors (e.g., `ImageQualityError`)
3. Handle network timeouts gracefully

<!-- END:api-client-pattern -->

<!-- BEGIN:color-constants -->
### Color & Constant Management

All magic strings/colors go in `src/utils/constants.js`:

```javascript
export const SCREENS = {
  HOME: 'HOME',
  SCAN: 'SCAN',
  WARDROBE: 'WARDROBE',
  // ...
};

export const C = {
  bg: '#0D0D0D',
  text: '#F0F0F0',
  focus: '#FFD600',
  // ...
};

export const OCCASIONS = ['casual', 'formal', 'sporty'];
```

**Never hardcode colors or screen names**—always use constants.

<!-- END:color-constants -->

## Agent Checklist

<!-- BEGIN:agent-dos-donts -->
### DO
✓ Use context-based navigation (no URL routing)  
✓ Check `commandParser.js` before adding LLM calls  
✓ Include TTS-ready error messages in all API responses  
✓ Add deduplication guards in WardrobeContext  
✓ Test manually via curl + browser DevTools  
✓ Follow high-contrast accessible design patterns  
✓ Pull context as needed (avoid prop drilling)  
✓ Register screen-specific voice handlers in useEffect  
✓ Use constants for colors and screen names  

### DON'T
✗ Don't assume React Router; screens are dispatcher-based  
✗ Don't return error codes to users; always include human-readable messages  
✗ Don't skip deduplication guards in WardrobeContext sync  
✗ Don't expect automated tests to catch regressions  
✗ Don't assume GEMINI_API_KEY is always configured  
✗ Don't hardcode colors or magic strings  
✗ Don't use relative imports across screens (use index.js exports)  
✗ Don't modify touch target sizes below 48px  
✗ Don't assume browser `history` API is available (use `goBack()` instead)  

<!-- END:agent-dos-donts -->

<!-- BEGIN:critical-files -->
### Critical Files to Understand First

1. **[CLAUDE.md](CLAUDE.md)** — Quick reference (commands, architecture overview)
2. **[webapp/prototype-app/src/contexts/AppContext.jsx](webapp/prototype-app/src/contexts/AppContext.jsx)** — Navigation model; read to understand screen stack
3. **[app/api/routes.py](app/api/routes.py)** — Backend pipeline entry point
4. **[webapp/prototype-app/src/screens/ScanScreen.jsx](webapp/prototype-app/src/screens/ScanScreen.jsx)** — Complex screen example (phase management, voice handlers)
5. **[webapp/prototype-app/src/voice/commandParser.js](webapp/prototype-app/src/voice/commandParser.js)** — Voice intent dispatch; add intents here
6. **[webapp/prototype-app/src/utils/constants.js](webapp/prototype-app/src/utils/constants.js)** — All magic strings/colors

<!-- END:critical-files -->

## Common Tasks

<!-- BEGIN:adding-a-screen -->
### Task: Add a New Screen

1. Create `src/screens/MyNewScreen.jsx` with phase state management
2. Import and register in `App.jsx` dispatcher
3. Add constant `SCREENS.MY_NEW_SCREEN` to `constants.js`
4. Register voice handler (if voice commands needed) in screen's useEffect
5. Test navigation via `navigate(SCREENS.MY_NEW_SCREEN, params)`

**Template**:
```javascript
// src/screens/MyNewScreen.jsx
import { useContext } from 'react';
import { AppContext } from '../contexts/AppContext';

export const MyNewScreen = () => {
  const { navigate, goBack } = useContext(AppContext);
  
  return (
    <div style={{ background: C.bg, color: C.text }}>
      <button onClick={() => goBack()}>Back</button>
      {/* Content */}
    </div>
  );
};
```

<!-- END:adding-a-screen -->

<!-- BEGIN:adding-api-endpoint -->
### Task: Add a Backend Endpoint

1. Add route handler in `app/api/routes.py`
2. Create schema in `app/models/schemas.py` (Pydantic)
3. Add error handler in `app/errors/handlers.py` with TTS-ready message
4. Export client function from `src/services/rizzVisionApi.js`
5. Test with curl before using in frontend

**Example**:
```python
# app/api/routes.py
@router.post("/my-endpoint")
async def my_endpoint(request: MyRequestSchema):
    try:
        # Do work
        return { "result": "success" }
    except ValueError as e:
        raise CustomError(
            error_code="MY_ERROR",
            user_message="Sorry, something went wrong. Please try again."
        )
```

<!-- END:adding-api-endpoint -->

<!-- BEGIN:adding-voice-intent -->
### Task: Add a Voice Intent

1. Open `src/voice/commandParser.js`
2. Add regex pattern and intent name
3. Register handler in screen's useEffect
4. Test with browser DevTools voice simulator

**Example**:
```javascript
// src/voice/commandParser.js
const INTENTS = {
  // ...existing...
  SHOW_RECOMMENDATIONS: {
    patterns: ['show me recommendations', 'what should i wear'],
    handler: async (context) => {
      // Dispatch action; return text to speak
      return "Here are today's recommendations...";
    }
  }
};
```

<!-- END:adding-voice-intent -->

---

**Last updated**: May 2026  
**Version**: 1.0 (Initial release for AI agents)

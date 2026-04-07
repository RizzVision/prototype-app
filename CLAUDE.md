# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Frontend (`webapp/prototype-app/`)
```bash
npm run dev       # Dev server on http://localhost:5173
npm run build     # Production build to dist/
npm run preview   # Preview production build
npm run lint      # ESLint
```

### Backend (repo root)
```bash
uvicorn main:app --reload              # Dev server on http://localhost:8000
uvicorn main:app --host 0.0.0.0 --port 7860  # Production (HuggingFace Spaces)
curl http://localhost:8000/health      # Health check
curl -F "image=@outfit.jpg" http://localhost:8000/analyze  # Test analysis
```

### Environment Setup
- Frontend: copy `webapp/prototype-app/.env.local.example` → `.env.local`, fill in `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_OAUTH_REDIRECT_URL`
- Backend: copy `.env.example` → `.env`, fill in `GEMINI_API_KEY` (required), Supabase keys (optional)

## Architecture

### Frontend: Screen-Based Navigation (No React Router for screens)
The app uses a custom **stack-based navigation** system, not URL routing:
- `AppContext` (`src/contexts/AppContext.jsx`) maintains a screen history stack
- `navigate(screen, params)` pushes; `goBack()` pops
- `App.jsx` renders the current screen via a switch/dispatcher
- Screen names are constants in `src/utils/constants.js` (HOME, SCAN, WARDROBE, OUTFIT, SHOPPING, MIRROR, EDIT_ITEM)

### State: Four React Contexts
1. **AppContext** — screen navigation + history
2. **AuthContext** — Supabase user session
3. **WardrobeContext** — wardrobe items with Supabase real-time sync (`postgres_changes`)
4. **VoiceContext** — Web Speech API input/output + command dispatch

### Voice-First Design
- **Input:** Web Speech Recognition (continuous mode, en-IN locale)
- **Commands:** `src/voice/commandParser.js` regex-matches spoken phrases to intents
- **Output:** Web Speech Synthesis via `src/hooks/useSpeechOutput.js`
- Screens register a `onScreenCommand` callback with VoiceContext for local command handling
- All state changes announced via ARIA live regions (`src/components/LiveRegions.jsx`)

### Backend: 7-Stage Analysis Pipeline (`POST /analyze`)
```
Image → Ingest/Validate → Segment (SegFormer B2) → Extract Colors (K-means)
  → Color Engine (6 parallel analyzers) → Gemini LLM Feedback
  → Shape Response → Return speech_segments + scores
```

**Color Engine** (`app/services/color_engine/engine.py`) orchestrates six analyzers:
- `harmony_analyzer.py` — hue/lightness/saturation/temperature/contrast
- `skin_analysis.py` — skin tone detection + garment compatibility
- `seasonal_analysis.py` — seasonal color theory
- `proportion_analyzer.py` — 60-30-10 balance rules
- `occasion_engine.py` — CLIP-based formality scoring
- `style_profiler.py` — style archetype detection (classic/bohemian/minimalist/etc.)

**Error handling:** Image quality failures return HTTP 422 with `{ error_code, user_message }` where `user_message` is TTS-ready. Frontend catches as `ImageQualityError` and announces it.

**Model caching:** HuggingFace models stored in `HF_HOME=/app/hf_cache`. First run downloads ~600MB (SegFormer + CLIP); subsequent runs use cache.

### Key File Locations
| Concern | Path |
|---|---|
| Screen components | `webapp/prototype-app/src/screens/` |
| Reusable components | `webapp/prototype-app/src/components/` |
| Navigation/global state | `webapp/prototype-app/src/contexts/` |
| Voice commands | `webapp/prototype-app/src/voice/commandParser.js` |
| Supabase CRUD | `webapp/prototype-app/src/utils/storage.js` |
| API client | `webapp/prototype-app/src/services/rizzVisionApi.js` |
| Color constants | `webapp/prototype-app/src/utils/constants.js` |
| FastAPI routes | `app/api/routes.py` |
| Analysis pipeline | `app/services/` |
| Pydantic schemas | `app/models/schemas.py` |

### Styling Conventions
- High-contrast dark theme: bg `#0D0D0D`, text `#F0F0F0`, focus `#FFD600`
- Atkinson Hyperlegible font (dyslexia-friendly)
- Inline styles per component; color name constants in `constants.js`
- Minimum 48px touch targets on all interactive elements

### Deployment
- **Frontend:** Vercel (auto-deploy from git push)
- **Backend:** HuggingFace Spaces (Dockerfile at repo root)
- **Database/Auth:** Supabase hosted PostgreSQL + Supabase Auth (email + Google OAuth)

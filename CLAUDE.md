# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mixed In AI is an Electron desktop application for DJs that combines AI-powered audio analysis (Python backend) with a React frontend. It detects musical properties (BPM, key, energy, cue points), manages DJ libraries, and helps plan harmonically compatible sets.

## Commands

### Development
```bash
npm install                       # Install Node dependencies
pip install -r requirements.txt   # Install Python dependencies
npm run dev                       # Dev mode: webpack watch + electron with live reload
npm start                         # Build + launch electron app
```

### Building
```bash
npm run build            # Webpack production build → dist/bundle.js
npm run dist:mac         # Build macOS app
npm run dist:win         # Build Windows app
npm run dist:linux       # Build Linux app
```

### Testing
```bash
python test_analyzer.py                       # Unit test analyzer with generated sine wave
python test_harmonic_mixing.py                # Harmonic mixing tests
python test_exports_cli.py                    # Export format tests
python test_stems_cli.py                      # Stem separation tests
python src/backend/tools/test_mix_scorecard.py  # Mix quality scoring tests
```

No test runner or lint configuration exists — tests are standalone Python scripts run individually.

### Environment Variables
- `MIXEDIN_PYTHON`: Override Python interpreter path
- `ANALYSIS_TIMEOUT_MS`: Analysis timeout (default 180000ms)
- `QUICK_ANALYSIS_TIMEOUT_MS`: Quick analysis timeout (default 30000ms)
- `BATCH_ANALYSIS_TIMEOUT_MS`: Batch analysis timeout (default 600000ms)
- `DEBUG`: Enable verbose logging

## Architecture

### Three-Layer Structure

```
┌─────────────────────────────────────────────────────┐
│  React UI (src/renderer/)                           │
│  - App.jsx orchestrates views and state             │
│  - Views: analyze, library, dj-mix, set-planner     │
└─────────────────────────────────────────────────────┘
         ↕ IPC via electronAPI (context bridge)
┌─────────────────────────────────────────────────────┐
│  Electron Main Process (src/main.js)                │
│  - Spawns Python subprocess for analysis            │
│  - Handles file dialogs, exports, IPC routing       │
│  - Builds Rekordbox XML in-process                  │
└─────────────────────────────────────────────────────┘
         ↕ Subprocess (JSON on stdout, progress on stderr)
┌─────────────────────────────────────────────────────┐
│  Python Backend (src/backend/)                      │
│  - analyzer.py: main entry, cache management        │
│  - pipeline/: 7-stage modular analysis              │
│  - tools/: DJ utilities, export formats             │
└─────────────────────────────────────────────────────┘
```

### IPC Protocol

Python subprocesses communicate via stdio:
- **stdout**: Final JSON result (parsed by main.js)
- **stderr**: Logging and progress updates (JSON lines for batch: `{type: 'progress', current, total, file}`)

Main.js sets subprocess env vars: `OPENBLAS_NUM_THREADS=1`, `OMP_NUM_THREADS=1`, `PYTHONUNBUFFERED=1`, `PYTHONIOENCODING=utf-8`, `NUMBA_NUM_THREADS=1` to avoid threading conflicts and ensure clean output.

Key IPC channels:
- `analyze-audio-file` — spawns `analyzer.py <path>`, full analysis
- `analyze-audio-file-quick` — spawns `analyzer.py <path> --quick`, BPM/key only
- `analyze-audio-files-batch` — spawns `batch_analyzer.py <paths...>`, parallel with progress
- `select-audio-files` — Electron file dialog (mp3, wav, flac, aiff, m4a)
- `export-rekordbox-xml` — builds XML in-process (not Python)
- `export-serato`, `export-traktor`, `export-set-plan-serato`, `export-set-plan-traktor`
- `separate-stems` — spawns `stems/separator.py`

### Python Backend (`src/backend/`)

- **analyzer.py**: Main entry point. `AudioAnalyzer` class with `analyze_audio()` (full) and `analyze_quick()` (BPM/key only). CLI: `python analyzer.py <file_path> [--quick]`
- **CacheManager**: SQLite at `~/.mixed_in_ai_cache.db` with WAL mode, mtime-based invalidation, waveform stored as binary BLOBs via struct.pack
- **pipeline/**: CuePipeline runs 7 stages sequentially:
  1. AubioStage (BPM/beat grid) → 2. PyAudioStage (onset detection) → 3. AnalyzerStage (key detection via Krumhansl-Schmuckler) → 4. ChorusHookStage (vocal peaks) → 5. BridgeEnergyGapStage (energy drops) → 6. AutoCueStage (beat snapping) → 7. HotCueStage (A-E cue selection)
- **batch_analyzer.py**: Parallel processing via ThreadPoolExecutor, progress on stderr, results on stdout
- **tools/**: harmonic_mixing.py, energy_analysis.py, export_serato.py, export_traktor.py, id3_tagger.py
- **stems/separator.py**: Demucs integration for stem separation

### Data Flow

```
UI drops files → electronAPI.analyzeAudioFile[sBatch]() → IPC → main.js spawns python
→ CacheManager check (mtime) → CuePipeline runs 7 stages → JSON stdout → main.js parses
→ returns to renderer → addToLibrary() → setState + debounced localStorage save (2s)
```

### Frontend State Model (`src/renderer/App.jsx`)

App.jsx is the central state controller (~62KB). Key state:
- `currentView`: `'analyze' | 'set-planner' | 'library' | 'dj-mix' | 'settings'`
- `analyzedTracks`: Array of `{id, file, analysis, addedAt, rating, notes, tags}` — persisted to localStorage with 2s debounce + emergency save on beforeunload
- `analysis` / `analysisSet`: Single/batch analysis results
- `setPlan`: Output from `setPlanner.js` algorithm
- `analysisQuality`: `'quick' | 'full'` — persisted to localStorage
- `theme`: `'dark' | 'light'` — persisted to localStorage

### Key Frontend Components

- `LibraryTable.jsx`: Virtualized track list using react-window FixedSizeList
- `DJMixView.jsx` / `DJDeck.jsx`: Dual-deck interface with waveforms, hot cues, loops
- `MixerPanel.jsx`: Crossfader, EQ (3-band), filters, effects, loops, hot cue pads
- `audioEngine.js`: Web Audio API playback engine with effects chain (reverb, delay, EQ, filters)
- `SetPlannerView.jsx` / `setPlanner.js`: Set planning with scoring (harmonic 55%, energy 20%, smoothness 15%, BPM 10%)
- `CamelotWheel.jsx`: Interactive Camelot wheel visualization for harmonic mixing
- `SmartSuggestions.jsx` / `trackSuggestions.js`: Next-track recommendation engine
- `cuePersistence.js`: localStorage persistence for hot cues and loops per track (keyed by path hash)

### Key Backend Algorithms

- **Hot Cue Selection** (hotcue_stage.py): Priority order drop > outro > chorus > bridge > intro > vocal, 5 max cues, 6-second minimum spacing
- **Harmonic Mixing** (harmonic_mixing.py): Camelot wheel compatibility with 8 mixing techniques
- **Energy Analysis**: Multi-band breakdown (sub-bass through treble), 1-10 scale
- **Key Detection**: Krumhansl-Schmuckler algorithm on STFT chromagrams

## Adding New Features

### New DJ Software Export
1. Create `src/backend/tools/export_<format>.py`
2. Add IPC handler in `src/main.js`: `ipcMain.handle('export-<format>', ...)`
3. Expose in `src/preload.js` via `contextBridge.exposeInMainWorld`
4. Add UI trigger in relevant view

### New Analysis Stage
1. Create `src/backend/pipeline/<stage>_stage.py` extending BaseStage
2. Implement `run(self, y, sr, metadata)` method
3. Register in `src/backend/pipeline/pipeline.py` stage list
4. Note: stages receive accumulated metadata from prior stages and must return updated metadata

### New React Component
1. Create `src/renderer/<ComponentName>.jsx` with functional component
2. Create corresponding `src/renderer/<componentName>.css` for styles
3. Import and use in parent component (typically App.jsx or a view)

## Conventions

- React: Functional components with hooks, PascalCase filenames for JSX
- Python: Type hints, docstrings, stderr for logging (stdout reserved for JSON output)
- Console logging uses prefixes: `[MAIN]`, `[PYTHON]`, `[PRELOAD]`
- CSS: Component-scoped files, CSS variables for theming (`--bg-primary`, `--text-primary`, etc.) defined in `theme.css`
- Python interpreter discovery: checks `MIXEDIN_PYTHON` env → system paths → venv paths; caches result to avoid 200-500ms per-call overhead
- Python exit codes: 0 (success), 1 (setup error), 2 (analysis failed)
- Webpack entry: `src/renderer/index.js` → `dist/bundle.js`, target `electron-renderer`
- No linter or formatter configured

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mixed In AI is an Electron desktop application for DJs that combines AI-powered audio analysis (Python backend) with a React frontend. It detects musical properties (BPM, key, energy, cue points), manages DJ libraries, and helps plan harmonically compatible sets.

## Commands

### Development
```bash
npm install              # Install Node dependencies
pip install -r requirements.txt  # Install Python dependencies
npm run dev              # Dev mode: webpack watch + electron with live reload
npm start                # Build + launch electron app
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
python test_analyzer.py           # Unit test analyzer with generated sine wave
python test_harmonic_mixing.py    # Harmonic mixing tests
python test_exports_cli.py        # Export format tests
python test_stems_cli.py          # Stem separation tests
```

### Environment Variables
- `MIXEDIN_PYTHON`: Override Python interpreter path
- `ANALYSIS_TIMEOUT_MS`: Analysis timeout (default 180000ms)
- `DEBUG`: Enable verbose logging

## Architecture

### Three-Layer Structure

```
┌─────────────────────────────────────────────────────┐
│  React UI (src/renderer/)                           │
│  - App.jsx orchestrates views and state             │
│  - LibraryTable, DJMixView, SetPlannerView          │
└─────────────────────────────────────────────────────┘
         ↕ IPC via electronAPI (context bridge)
┌─────────────────────────────────────────────────────┐
│  Electron Main Process (src/main.js)                │
│  - Spawns Python subprocess for analysis            │
│  - Handles file dialogs, exports, IPC routing       │
└─────────────────────────────────────────────────────┘
         ↕ Subprocess (JSON on stdout/stderr)
┌─────────────────────────────────────────────────────┐
│  Python Backend (src/backend/)                      │
│  - analyzer.py: main entry, cache management        │
│  - pipeline/: 7-stage modular analysis              │
│  - tools/: DJ utilities, export formats             │
└─────────────────────────────────────────────────────┘
```

### Python Backend (`src/backend/`)

- **analyzer.py**: Main entry point for audio analysis, spawned as subprocess
- **pipeline/**: Modular analysis stages executed in sequence:
  - AubioStage (BPM/beat grid) → PyAudioStage (onset detection) → AnalyzerStage (key detection) → ChorusHookStage (vocal peaks) → BridgeEnergyGapStage (energy drops) → AutoCueStage (beat snapping) → HotCueStage (A-E cue selection)
- **tools/**: DJ-specific utilities (harmonic_mixing.py, energy_analysis.py, export_*.py, id3_tagger.py)
- **batch_analyzer.py**: Multi-file parallel processing with progress reporting
- **stems/separator.py**: Demucs integration for stem separation

### Data Flow

```
UI → electronAPI.analyzeAudioFile() → IPC → main.js spawns python analyzer.py
→ CuePipeline runs 7 stages → JSON stdout → main.js parses → returns to renderer
```

Batch analysis uses `batch_analyzer.py` with ThreadPoolExecutor, emitting progress on stderr.

### Caching

- **Backend**: SQLite cache at `~/.mixed_in_ai_cache.db` (file path lookup, mtime invalidation)
- **Frontend**: localStorage for `analyzedTracks` state

### Key Frontend Components

- `App.jsx`: Main controller, orchestrates file upload/analysis, manages tabs
- `LibraryTable.jsx`: Virtualized track list using react-window
- `DJMixView.jsx` / `DJDeck.jsx`: Dual-deck practice interface with waveforms
- `SetPlannerView.jsx`: Automated setlist builder with energy curves
- `setPlanner.js`: Set planning algorithm (harmonic 55%, energy 20%, smoothness 15%, BPM 10%)

### Key Backend Algorithms

- **Hot Cue Selection** (hotcue_stage.py): Priority order drop > outro > chorus > bridge > intro > vocal, 5 max cues, 6-second minimum spacing
- **Harmonic Mixing** (harmonic_mixing.py): Camelot wheel compatibility with 8 mixing techniques
- **Energy Analysis**: Multi-band breakdown (sub-bass through treble), 1-10 scale

## Adding New Features

### New DJ Software Export
1. Create `src/backend/tools/export_<format>.py`
2. Add IPC handler in `src/main.js`: `ipcMain.handle('export-<format>', ...)`
3. Expose in `src/preload.js`
4. Add UI trigger in relevant view

### New Analysis Stage
1. Create `src/backend/pipeline/<stage>_stage.py` extending BaseStage
2. Implement `run(self, y, sr, metadata)` method
3. Register in `src/backend/pipeline/pipeline.py` stage list

### New React Component
1. Create `src/renderer/<ComponentName>.jsx` with functional component
2. Create corresponding `src/renderer/<componentName>.css` for styles
3. Import and use in parent component (typically App.jsx or a view)

## Conventions

- React: Functional components with hooks, PascalCase filenames for JSX
- Python: Type hints, docstrings, stderr for logging (stdout reserved for JSON output)
- Console logging uses prefixes: [MAIN], [PYTHON], [PRELOAD]
- CSS: Component-scoped files, CSS variables for theming (--bg-primary, --text-primary, etc.)
- Python interpreter discovery: checks MIXEDIN_PYTHON env, system paths, then venv paths

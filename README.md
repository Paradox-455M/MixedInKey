# Mixed In AI

An industry‑level alternative to Mixed In Key — a cross‑platform Electron + Python desktop app for DJs that analyzes audio files and automatically detects musically significant information like Hot Cues, DJ Cues, musical key, BPM, vocals, chorus/hook, and song structure.


## ✨ What’s inside

- AI‑driven cue intelligence (genre‑aware, beat‑aligned, energy + harmonic signals)
- Full Hot Cue system (A–E) inspired by pro workflows
- Modular, conflict‑aware pipeline (stages for beats, structure, chorus/hook, bridge)
- Detailed confidence, reason, and tier on every cue for explainability
- Modern UI showing DJ Cues and Hot Cues side‑by‑side with playback


## 🔥 Hot Cues (A–E)

Hot Cues are generated from the final merged cue set and mapped as follows:

- A = Intro (first musical start after silence; beat‑aligned)
- B = First Vocal / Verse (prefer before main drop; fallback: first chorus)
- C = Chorus (prefer first chorus after drop; fallback: next vocal)
- D = Drop (main energy peak; confidence + position scoring; beat‑snapped)
- E = Outro (last structured ending; fallback: last phrase/end)

Quality guarantees:

- Alias matching (intro/mix_in, chorus/hook, drop/climax, outro/mix_out, vocal/verse)
- Minimum spacing of 6s to avoid clustering
- Backfill to reach five anchors whenever the music allows

Implementation: `src/backend/pipeline/hotcue_stage.py`


## 🧠 Pipeline architecture

Stages live in `src/backend/pipeline/` and communicate via a normalized dictionary:

- `autocue_stage.py` — optional external intro/outro hints (safe fallbacks)
- `aubio_stage.py` — onset and beat detection (with `librosa` fallback)
- `pyaudio_stage.py` — boundary detection via pyAudioAnalysis (RMS fallback)
- `analyzer_stage.py` — wraps the main analyzer (drops, vocals, sections)
+- `chorus_hook_stage.py` — harmonic centroid + spectral contrast (chorus/hook)
- `bridge_energy_gap.py` — energy valley detection (bridge/energy gap)
- `hotcue_stage.py` — maps final cues to A–E Hot Cues (spacing + backfill)
- `pipeline.py` — orchestrator: priority merge, conflict resolution, selective beat‑snapping, validity rules, logs

Pipeline output:

```json
{
  "cues": [...],         // final DJ Cue set
  "hotcues": [...],      // A–E hot cues
  "beatgrid": [...],
  "duration": 210.32,
  "stages": {...},       // per‑stage outputs
  "logs": [...]          // merge/snap decisions
}
```


## 🛠️ Install

Prereqs: Node.js v16+, Python 3.8+

```bash
npm install
pip install -r requirements.txt
```


## ▶️ Run

Dev (Electron + React):

```bash
npm run dev
```

CLI analyzer test:

```bash
python -m src.backend.test_analyzer /path/to/track.mp3
```


## 📦 Project structure

```
src/
├─ main.js                # Electron main process
├─ preload.js             # IPC bridge
├─ renderer/              # React UI (DJ Cues + Hot Cues)
└─ backend/               # Python analyzer + pipeline
   ├─ analyzer.py
   └─ pipeline/
      ├─ autocue_stage.py
      ├─ aubio_stage.py
      ├─ pyaudio_stage.py
      ├─ analyzer_stage.py
      ├─ chorus_hook_stage.py
      ├─ bridge_energy_gap.py
      ├─ hotcue_stage.py
      └─ pipeline.py
```


## 🧪 Features (high‑level)

- Key detection (Camelot), multi‑algo BPM, energy profile
- Genre‑adaptive intro/drop; phrase detection (8/16 bars)
- Harmonic cue alignment (tension peaks / stability windows)
- MFCC vocal gate (ZCR + band ratios + H/P ratio)
- Confidence, tier, and reason labeling for every cue


## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes with tests if applicable
4. Open a pull request


## 📄 License

MIT


## 🔗 Links

- Repo: `https://github.com/Paradox-455M/MixedInKey`


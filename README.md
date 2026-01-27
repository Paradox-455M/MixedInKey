# Mixed In AI

**Mixed In AI** is an advanced audio analysis tool designed for DJs and producers. It leverages AI and signal processing to analyze tracks for Key (Camelot notation), BPM, Energy levels, and structural Cue Points (Intro, Drop, Breakdown, Outro). It helps DJs build harmonically compatible sets and practice transitions with a built-in dual-deck player.

## 🚀 Features Implemented

### 🎵 Core Audio Analysis
*   **Advanced Detection:** Automatically detects **BPM**, **Key** (Camelot Wheel), and **Energy Level** (1-10).
*   **Structure Analysis:** Identifies key structural segments:
    *   🟢 **Intro**
    *   🔴 **Drop**
    *   🔵 **Breakdown**
    *   🟠 **Outro**
    *   🟣 **Vocals/Chorus**
*   **Batch Processing:** Multi-threaded analysis for processing entire folders quickly.
*   **Persistent Caching:** Instant re-loading of previously analyzed tracks using `~/.mixed_in_ai_cache.json`.

### 🎛️ DJ Mix View (Practice Mode)
*   **Dual Interactive Decks:** Two fully functional decks (Deck A & Deck B) for testing blends.
*   **Waveform Visualization:** High-performance canvas-based waveforms with color-coded cue markers.
*   **Smart Library Suggestions:** Automatically suggests compatible tracks for the active deck based on harmonic mixing rules.
*   **Session History:** Tracks your mix session and allows exporting the history.
*   **Playback Controls:** Play, pause, and seek directly on the waveform.

### 📝 Set Planner
*   **Automated Playlist Building:** Generates set lists following specific energy curves (e.g., "Warm-up → Peak → Reset").
*   **Transition Visualizer:** visually aligns the "Mix Out" of one track with the "Mix In" of the next to preview overlaps.
*   **Harmonic Mixing:** Ensures key compatibility between consecutive tracks.

### 💾 Library & Export
*   **Library Management:** Search, sort, and filter tracks by BPM, Key, and Energy.
*   **Multi-Platform Export:** Export your playlists and cue points to:
    *   **Rekordbox** (.xml)
    *   **Serato** (.crate)
    *   **Traktor** (.nml)

## 🛠️ Technology Stack
*   **Frontend:** React, Electron, Canvas API (for waveforms)
*   **Backend:** Python (librosa, numpy, scipy) for audio signal processing
*   **Communication:** IPC between Electron (Node.js) and Python

## 🔮 Future Roadmap

We have exciting plans to further enhance Mixed In AI:

*   **Stem Separation:** Integration of Spleeter/Demucs for real-time isolation of Vocals, Drums, Bass, and Other instruments.
*   **AI Mashup Generator:** Intelligent suggestions for mashups based on phrasing and harmonic compatibility.
*   **Cloud Sync:** Synchronize analysis data and playlists across multiple devices.
*   **Advanced Metadata:** AI-driven Genre classification and Mood detection.
*   **Real-time Effects:** Basic EQ (Low/Mid/High) and filters in the DJ Mix view for more realistic transition practice.
*   **MIDI Support:** Control the DJ Mix decks using external MIDI controllers.

## 📦 Installation & Setup

1.  **Install Dependencies:**
    ```bash
    npm install
    pip install -r requirements.txt
    ```

2.  **Run Development Mode:**
    ```bash
    npm start
    ```
    *This launches the Electron app and the Python backend server.*

3.  **Build for Production:**
    ```bash
    npm run make
    ```

---
*Mixed In AI - Elevate your mix with data-driven insights.*

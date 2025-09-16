# Mixed In AI 🎵

An industry-level alternative to Mixed In Key — a cross-platform Electron desktop app for DJs that analyzes audio files and automatically detects musically significant information like cue points, musical key, BPM, and song structure.

## ✨ Features

### Core Analysis
- **🎼 Musical Key Detection**: Detects key using Camelot wheel format (8A, 12B, etc.)
- **⚡ BPM Analysis**: Accurate tempo detection using multiple algorithms
- **🎯 Hot Cue Points**: Automatically detects intro, drops, breakdowns, and outro
- **📊 Song Structure**: Identifies verse, chorus, bridge, and other sections
- **🌊 Waveform Visualization**: Interactive waveform with cue point markers
- **📤 Export Support**: Export analysis in formats compatible with DJ software
- **🎨 Modern UI**: Beautiful, responsive interface with dark theme
- **🔄 Drag & Drop**: Easy file upload via drag-and-drop or file picker

### Advanced DJ Features
- **🎵 Harmonic Mixing**: Find compatible keys for seamless transitions using the Camelot wheel
- **⚡ Energy Level Analysis**: 1-10 energy rating system with detailed metrics
- **🚀 Power Block Mixing**: Rapid transitions between tracks in the same key with energy variation
- **🔥 Energy Boost Mixing**: Sudden energy increases using high-energy tracks
- **🎯 Beat Jumping**: Jump to specific cue points for creative transitions
- **📈 Energy Flow Management**: Build or release energy in your sets
- **🎛️ Rhythmic Layering**: Layer tracks with compatible BPM and keys
- **⚖️ Dynamic Contrast**: Create contrast through dramatic energy changes

## 🏗️ Architecture

```
mixed-in-ai/
├── src/
│   ├── main.js              # Electron main process
│   ├── preload.js           # IPC bridge
│   ├── renderer/            # React frontend
│   │   ├── App.js          # Main React component
│   │   ├── index.js        # React entry point
│   │   └── styles.css      # Styling
│   └── backend/
│       ├── analyzer.py      # Main Python analyzer
│       └── tools/           # Specialized analysis modules
├── package.json             # Node.js dependencies
├── requirements.txt         # Python dependencies
└── webpack.config.js       # Build configuration
```

## 🚀 Quick Start

### Prerequisites

- **Node.js** (v16 or higher)
- **Python** (v3.8 or higher)
- **npm** or **yarn**

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd mixed-in-ai
   ```

2. **Install Node.js dependencies**
   ```bash
   npm install
   ```

3. **Install Python dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Start development server**
   ```bash
   npm run dev
   ```

### Building for Distribution

```bash
# Build for current platform
npm run dist

# Build for specific platforms
npm run dist:mac    # macOS
npm run dist:win    # Windows
npm run dist:linux  # Linux
```

## 🎯 Usage

1. **Launch the app** - The app will open with a drag-and-drop interface
2. **Upload audio files** - Drag and drop MP3, WAV, FLAC, AIFF, or M4A files
3. **Wait for analysis** - The app will analyze your audio file using AI algorithms
4. **View results** - See detected key, BPM, cue points, and song structure
5. **Export analysis** - Save results in formats compatible with your DJ software

## 🔧 Technical Details

### Audio Analysis Pipeline

1. **Key Detection**: Uses Essentia + Librosa hybrid approach
2. **BPM Analysis**: Combines Librosa, Essentia, and Madmom algorithms
3. **Cue Point Detection**: 
   - Onset detection for drops
   - Energy analysis for breakdowns
   - Beat tracking for structure
4. **Song Structure**: Uses MFCC-based segmentation
5. **Energy Analysis**: RMS, spectral, rhythmic, and dynamic energy metrics
6. **Harmonic Mixing**: Camelot wheel compatibility analysis
7. **Advanced Techniques**: Power block, energy boost, and beat jumping analysis

### Supported Audio Formats

- MP3
- WAV
- FLAC
- AIFF
- M4A

### Export Formats

- JSON (compatible with Rekordbox, Serato, Traktor)
- CSV
- TXT

## 🛠️ Development

### Project Structure

```
src/
├── main.js                 # Electron main process
├── preload.js             # IPC bridge
├── renderer/              # React frontend
│   ├── App.js            # Main component
│   ├── index.js          # Entry point
│   └── styles.css        # Styling
└── backend/              # Python backend
    ├── analyzer.py       # Main analyzer
    └── tools/            # Analysis modules
        ├── key_detection.py
        └── rhythm_analysis.py
```

### Key Technologies

**Frontend:**
- Electron (desktop app framework)
- React (UI framework)
- WaveSurfer.js (waveform visualization)
- React Dropzone (file upload)

**Backend:**
- Python 3.8+
- Librosa (audio analysis)
- Essentia (music analysis)
- Madmom (beat tracking)
- NumPy (numerical computing)
- Harmonic Mixing (Camelot wheel system)
- Energy Analysis (multi-metric energy classification)
- Advanced Mixing (power block, energy boost, beat jumping)

### Development Commands

```bash
# Start development
npm run dev

# Build frontend
npm run build

# Watch for changes
npm run watch

# Package for distribution
npm run dist
```

## 🎵 Analysis Features

### Key Detection
- **Camelot Wheel Format**: 8A, 12B, etc.
- **Confidence Scoring**: Multiple algorithm agreement
- **Compatible Keys**: Shows harmonically compatible keys

### BPM Analysis
- **Multi-Algorithm**: Librosa + Essentia + Madmom
- **Outlier Filtering**: Removes inaccurate readings
- **Confidence Metrics**: Beat regularity analysis

### Cue Point Detection
- **Intro**: First downbeat detection
- **Drops**: Onset cluster analysis
- **Breakdowns**: Energy-based detection
- **Outro**: End section identification

### Song Structure
- **Segmentation**: MFCC-based section detection
- **Structure Types**: Intro, verse, chorus, bridge, outro
- **Timing**: Precise start/end times for each section

### Energy Analysis
- **Energy Rating**: 1-10 classification system
- **Energy Metrics**: RMS, spectral, rhythmic, and dynamic energy
- **Energy Profile**: Track energy changes over time
- **Energy Peaks/Valleys**: Identify high and low energy sections

### Harmonic Mixing
- **Camelot Wheel**: Industry-standard key compatibility system
- **Compatible Keys**: Find harmonically compatible keys for seamless transitions
- **Mixing Techniques**: Relative major/minor, parallel keys, subdominant/dominant
- **Compatibility Scoring**: Detailed scoring for each harmonic relationship

### Advanced Mixing Techniques
- **Power Block Mixing**: Rapid transitions between tracks in the same key
- **Energy Boost Mixing**: Sudden energy increases using high-energy tracks
- **Beat Jumping**: Jump to specific cue points for creative transitions
- **Rhythmic Layering**: Layer tracks with compatible BPM and keys
- **Dynamic Contrast**: Create contrast through dramatic energy changes

## 🔒 Security

- **Context Isolation**: Electron security best practices
- **File Validation**: Audio file type verification
- **Error Handling**: Graceful failure handling
- **No Network Access**: All processing is local

## 📦 Distribution

The app is packaged using Electron Builder and supports:

- **macOS**: `.dmg` and `.pkg` formats
- **Windows**: `.exe` installer
- **Linux**: `.AppImage` and `.deb` packages

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.

## 🙏 Acknowledgments

- **Librosa**: Audio analysis library
- **Essentia**: Music analysis toolkit
- **Madmom**: Beat tracking algorithms
- **Electron**: Cross-platform desktop framework
- **React**: UI framework

---

**Built with ❤️ for the DJ community** 
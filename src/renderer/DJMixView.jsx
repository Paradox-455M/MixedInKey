import React, { useState, memo, useRef, useEffect, useCallback } from 'react';
import { Download, Keyboard } from 'lucide-react';
import DJDeck from './DJDeck';
import BPMMatch from './BPMMatch';
import MixerPanel from './MixerPanel';
import SimilarTracksPanel from './SimilarTracksPanel';
import LibraryTable from './LibraryTable';
import audioEngine from './audioEngine';
import { loadTrackCues, loadTrackLoop, saveTrackCues, saveTrackLoop, hasStoredCues, hasStoredLoop } from './cuePersistence';
import CamelotWheel from './CamelotWheel';
import SmartSuggestions from './SmartSuggestions';
import './djMixView.css';

const DJMixView = ({
    analyzedTracks,
    onAnalyzeFile,
    onLoadToDeck
}) => {
    const [deckA, setDeckA] = useState(null);
    const [deckB, setDeckB] = useState(null);
    const [activeDeckId, setActiveDeckId] = useState('A');
    const [mixSession, setMixSession] = useState([]);
    const [similarSourceTrack, setSimilarSourceTrack] = useState(null);
    const [showShortcuts, setShowShortcuts] = useState(false);
    const [audioEngineReady, setAudioEngineReady] = useState(false);
    const [showCamelotWheel, setShowCamelotWheel] = useState(false);

    // Performance state (loops and hot cues) - lifted here for sharing between MixerPanel and DJDeck
    const [loopA, setLoopA] = useState({ active: false, start: null, end: null, size: 4 });
    const [loopB, setLoopB] = useState({ active: false, start: null, end: null, size: 4 });
    const [cuesA, setCuesA] = useState(new Array(8).fill(null));
    const [cuesB, setCuesB] = useState(new Array(8).fill(null));

    const deckARef = useRef(null);
    const deckBRef = useRef(null);

    const activeTrack = activeDeckId === 'A' ? deckA : deckB;

    // Load saved cues/loops when track changes, or reset if none saved
    useEffect(() => {
        const filePath = deckA?.file?.path;
        if (!filePath) {
            setLoopA({ active: false, start: null, end: null, size: 4 });
            setCuesA(new Array(8).fill(null));
            return;
        }

        // Try to load saved cues
        const savedCues = loadTrackCues(filePath);
        if (savedCues) {
            setCuesA(savedCues);
            console.log('[DJMixView] Loaded saved cues for Deck A');
        } else {
            setCuesA(new Array(8).fill(null));
        }

        // Try to load saved loop
        const savedLoop = loadTrackLoop(filePath);
        if (savedLoop) {
            setLoopA({ ...savedLoop.loop, active: false }); // Load but don't auto-activate
            console.log('[DJMixView] Loaded saved loop for Deck A');
        } else {
            setLoopA({ active: false, start: null, end: null, size: 4 });
        }
    }, [deckA?.file?.path]);

    useEffect(() => {
        const filePath = deckB?.file?.path;
        if (!filePath) {
            setLoopB({ active: false, start: null, end: null, size: 4 });
            setCuesB(new Array(8).fill(null));
            return;
        }

        // Try to load saved cues
        const savedCues = loadTrackCues(filePath);
        if (savedCues) {
            setCuesB(savedCues);
            console.log('[DJMixView] Loaded saved cues for Deck B');
        } else {
            setCuesB(new Array(8).fill(null));
        }

        // Try to load saved loop
        const savedLoop = loadTrackLoop(filePath);
        if (savedLoop) {
            setLoopB({ ...savedLoop.loop, active: false });
            console.log('[DJMixView] Loaded saved loop for Deck B');
        } else {
            setLoopB({ active: false, start: null, end: null, size: 4 });
        }
    }, [deckB?.file?.path]);

    // Handlers for loop and cue changes
    const handleLoopChange = useCallback((deckId, loop) => {
        if (deckId === 'A') setLoopA(loop);
        else setLoopB(loop);
    }, []);

    const handleCuesChange = useCallback((deckId, cues) => {
        if (deckId === 'A') setCuesA(cues);
        else setCuesB(cues);
    }, []);

    // Save cues to persistent storage
    const handleSaveCues = useCallback((deckId) => {
        const track = deckId === 'A' ? deckA : deckB;
        const cues = deckId === 'A' ? cuesA : cuesB;
        const loop = deckId === 'A' ? loopA : loopB;

        if (!track?.file?.path) return false;

        const metadata = {
            name: track.file.name,
            bpm: track.analysis?.bpm,
            key: track.analysis?.key
        };

        // Save cues
        saveTrackCues(track.file.path, cues, metadata);

        // Save loop if set
        if (loop.start !== null && loop.end !== null) {
            saveTrackLoop(track.file.path, loop, metadata);
        }

        return true;
    }, [deckA, deckB, cuesA, cuesB, loopA, loopB]);

    // Check if track has saved cues
    const hasSavedCuesA = deckA?.file?.path ? hasStoredCues(deckA.file.path) : false;
    const hasSavedCuesB = deckB?.file?.path ? hasStoredCues(deckB.file.path) : false;

    // Initialize audio engine
    useEffect(() => {
        const initAudio = async () => {
            try {
                await audioEngine.initialize();
                setAudioEngineReady(true);
            } catch (err) {
                console.error('Failed to initialize audio engine:', err);
            }
        };
        initAudio();
    }, []);

    // Connect audio elements to engine with retry logic
    useEffect(() => {
        if (!audioEngineReady || !deckA) return;

        let attempts = 0;
        const maxAttempts = 5;
        const delays = [100, 200, 400, 800, 1000]; // Exponential backoff

        const tryConnect = () => {
            const audioEl = deckARef.current?.getAudioElement?.();
            if (audioEl) {
                audioEngine.connectMediaElement('A', audioEl);
                console.log('[DJMixView] Connected Deck A audio element');
            } else if (attempts < maxAttempts) {
                attempts++;
                setTimeout(tryConnect, delays[attempts - 1]);
            } else {
                console.warn('[DJMixView] Failed to connect Deck A after max attempts');
            }
        };

        const timer = setTimeout(tryConnect, delays[0]);
        return () => clearTimeout(timer);
    }, [deckA, audioEngineReady]);

    useEffect(() => {
        if (!audioEngineReady || !deckB) return;

        let attempts = 0;
        const maxAttempts = 5;
        const delays = [100, 200, 400, 800, 1000]; // Exponential backoff

        const tryConnect = () => {
            const audioEl = deckBRef.current?.getAudioElement?.();
            if (audioEl) {
                audioEngine.connectMediaElement('B', audioEl);
                console.log('[DJMixView] Connected Deck B audio element');
            } else if (attempts < maxAttempts) {
                attempts++;
                setTimeout(tryConnect, delays[attempts - 1]);
            } else {
                console.warn('[DJMixView] Failed to connect Deck B after max attempts');
            }
        };

        const timer = setTimeout(tryConnect, delays[0]);
        return () => clearTimeout(timer);
    }, [deckB, audioEngineReady]);

    // Resume audio context on interaction
    const handleUserInteraction = useCallback(() => {
        if (audioEngineReady) audioEngine.resume();
    }, [audioEngineReady]);

    const handleLoadTrack = async (file, deckId) => {
        const existing = analyzedTracks.find(t => t.file.path === file.path);
        if (existing) {
            loadTrackToDeck(existing, deckId);
        } else {
            try {
                const result = await onAnalyzeFile(file);
                loadTrackToDeck({ file, analysis: result }, deckId);
            } catch (err) {
                console.error("Failed to analyze track:", err);
            }
        }
    };

    const loadTrackToDeck = (track, deckId) => {
        if (deckId === 'A') setDeckA(track);
        else setDeckB(track);

        setMixSession(prev => {
            const lastTrack = prev[prev.length - 1];
            if (!lastTrack || lastTrack.file.path !== track.file.path) {
                return [...prev, track];
            }
            return prev;
        });
    };

    const handleLibraryTrackSelect = (track) => {
        const targetDeck = activeDeckId === 'A' ? 'B' : 'A';
        loadTrackToDeck(track, targetDeck);
        setActiveDeckId(targetDeck);
    };

    const handleExportMix = async () => {
        if (mixSession.length === 0) return;
        try {
            const playlistName = `Mix ${new Date().toISOString().slice(0, 10)}`;
            const tracks = mixSession.map(t => {
                // Find if this track has performance cues set
                const isOnDeckA = deckA?.file?.path === t.file.path;
                const isOnDeckB = deckB?.file?.path === t.file.path;
                const performanceCuesForTrack = isOnDeckA ? cuesA : (isOnDeckB ? cuesB : null);
                const performanceLoopForTrack = isOnDeckA ? loopA : (isOnDeckB ? loopB : null);

                return {
                    path: t.file.path,
                    name: t.file.name,
                    artist: t.analysis.artist || 'Unknown',
                    key: t.analysis.key,
                    bpm: t.analysis.bpm,
                    analysis: t.analysis,
                    // Include performance cues and loops if available
                    performanceCues: performanceCuesForTrack,
                    performanceLoop: performanceLoopForTrack
                };
            });
            const exportPath = await window.electronAPI.exportRekordboxXml({
                playlistName, tracks, includeCuePoints: true
            });
            if (exportPath) alert(`Exported to: ${exportPath}`);
        } catch (err) {
            console.error('Export failed:', err);
        }
    };

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            const activeDeck = activeDeckId === 'A' ? deckARef.current : deckBRef.current;

            switch (e.code) {
                case 'Space':
                    e.preventDefault();
                    activeDeck?.togglePlay();
                    break;
                case 'Digit1':
                    e.preventDefault();
                    setActiveDeckId('A');
                    break;
                case 'Digit2':
                    e.preventDefault();
                    setActiveDeckId('B');
                    break;
                case 'KeyQ':
                    e.preventDefault();
                    deckARef.current?.togglePlay();
                    break;
                case 'KeyW':
                    e.preventDefault();
                    deckBRef.current?.togglePlay();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    activeDeck?.seek(e.shiftKey ? -1 : -5);
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    activeDeck?.seek(e.shiftKey ? 1 : 5);
                    break;
                case 'Home':
                    e.preventDefault();
                    activeDeck?.seekTo(0);
                    break;
                case 'Slash':
                    if (e.shiftKey) {
                        e.preventDefault();
                        setShowShortcuts(prev => !prev);
                    }
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeDeckId]);

    return (
        <div className="dj-mix-view" onClick={handleUserInteraction}>
            {/* Header */}
            <div className="mix-header-actions">
                <button
                    className="shortcuts-hint-btn"
                    onClick={() => setShowShortcuts(prev => !prev)}
                    title="Keyboard Shortcuts (?)"
                >
                    <Keyboard size={16} />
                </button>
                <button
                    className="export-button"
                    onClick={handleExportMix}
                    disabled={mixSession.length === 0}
                >
                    <Download size={16} />
                    Export ({mixSession.length})
                </button>
            </div>

            {/* Shortcuts Panel */}
            {showShortcuts && (
                <div className="shortcuts-panel">
                    <div className="shortcuts-header">
                        <h4>Keyboard Shortcuts</h4>
                        <button className="shortcuts-close" onClick={() => setShowShortcuts(false)}>×</button>
                    </div>
                    <div className="shortcuts-grid">
                        <div className="shortcut-item"><kbd>Space</kbd><span>Play/Pause</span></div>
                        <div className="shortcut-item"><kbd>1</kbd>/<kbd>2</kbd><span>Switch Deck</span></div>
                        <div className="shortcut-item"><kbd>Q</kbd>/<kbd>W</kbd><span>Play A/B</span></div>
                        <div className="shortcut-item"><kbd>←</kbd>/<kbd>→</kbd><span>Seek ±5s</span></div>
                        <div className="shortcut-item"><kbd>Home</kbd><span>Jump to start</span></div>
                        <div className="shortcut-item"><kbd>?</kbd><span>This panel</span></div>
                    </div>
                </div>
            )}

            {/* Stacked Decks Layout */}
            <div className="decks-stacked">
                <DJDeck
                    ref={deckARef}
                    id="A"
                    track={deckA}
                    isActive={activeDeckId === 'A'}
                    onActivate={() => setActiveDeckId('A')}
                    onLoadTrack={(file) => handleLoadTrack(file, 'A')}
                    onClear={() => setDeckA(null)}
                    performanceLoop={loopA}
                    performanceCues={cuesA}
                />
                <DJDeck
                    ref={deckBRef}
                    id="B"
                    track={deckB}
                    isActive={activeDeckId === 'B'}
                    onActivate={() => setActiveDeckId('B')}
                    onLoadTrack={(file) => handleLoadTrack(file, 'B')}
                    onClear={() => setDeckB(null)}
                    performanceLoop={loopB}
                    performanceCues={cuesB}
                />
            </div>

            {/* BPM Match & Camelot Wheel Row */}
            <div className="mix-info-row">
                <BPMMatch deckA={deckA} deckB={deckB} />

                <button
                    className={`camelot-toggle-btn ${showCamelotWheel ? 'active' : ''}`}
                    onClick={() => setShowCamelotWheel(prev => !prev)}
                    title="Toggle Camelot Wheel"
                >
                    <span className="camelot-icon">&#9673;</span>
                    <span>Camelot</span>
                </button>
            </div>

            {/* Camelot Wheel Panel */}
            {showCamelotWheel && (
                <div className="camelot-panel">
                    <CamelotWheel
                        currentKeyA={deckA?.analysis?.key}
                        currentKeyB={deckB?.analysis?.key}
                        size={180}
                        showLabels={true}
                    />
                </div>
            )}

            {/* Mixer Panel - Tabbed controls for EQ, FX, Performance */}
            <MixerPanel
                deckARef={deckARef}
                deckBRef={deckBRef}
                deckATrack={deckA}
                deckBTrack={deckB}
                loopA={loopA}
                loopB={loopB}
                cuesA={cuesA}
                cuesB={cuesB}
                onLoopChange={handleLoopChange}
                onCuesChange={handleCuesChange}
                onSaveCues={handleSaveCues}
                hasSavedCuesA={hasSavedCuesA}
                hasSavedCuesB={hasSavedCuesB}
            />

            {/* Smart Suggestions */}
            {activeTrack && (
                <SmartSuggestions
                    sourceTrack={activeTrack}
                    allTracks={analyzedTracks}
                    onSelectTrack={handleLibraryTrackSelect}
                    maxSuggestions={5}
                />
            )}

            {/* Library Section */}
            <div className="mix-library-section">
                <h3 className="section-title">
                    Library
                    {activeTrack && <span className="suggestion-subtitle"> — Compatible with Deck {activeDeckId}</span>}
                </h3>

                {similarSourceTrack && (
                    <SimilarTracksPanel
                        sourceTrack={similarSourceTrack}
                        allTracks={analyzedTracks}
                        onClose={() => setSimilarSourceTrack(null)}
                        onSelectTrack={(track) => {
                            handleLibraryTrackSelect(track);
                            setSimilarSourceTrack(null);
                        }}
                    />
                )}

                <LibraryTable
                    tracks={analyzedTracks}
                    currentTrack={activeTrack}
                    onTrackSelect={handleLibraryTrackSelect}
                    onFindSimilar={(track) => setSimilarSourceTrack(track)}
                    multiSelect={false}
                />
            </div>
        </div>
    );
};

export default memo(DJMixView);

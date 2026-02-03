import React, { useState, memo, useRef, useEffect, useCallback } from 'react';
import { Download, Keyboard } from 'lucide-react';
import DJDeck from './DJDeck';
import BPMMatch from './BPMMatch';
import MixerPanel from './MixerPanel';
import SimilarTracksPanel from './SimilarTracksPanel';
import LibraryTable from './LibraryTable';
import audioEngine from './audioEngine';
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

    const deckARef = useRef(null);
    const deckBRef = useRef(null);

    const activeTrack = activeDeckId === 'A' ? deckA : deckB;

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

    // Connect audio elements to engine
    useEffect(() => {
        if (!audioEngineReady || !deckA) return;
        const timer = setTimeout(() => {
            const audioEl = deckARef.current?.getAudioElement?.();
            if (audioEl) audioEngine.connectMediaElement('A', audioEl);
        }, 100);
        return () => clearTimeout(timer);
    }, [deckA, audioEngineReady]);

    useEffect(() => {
        if (!audioEngineReady || !deckB) return;
        const timer = setTimeout(() => {
            const audioEl = deckBRef.current?.getAudioElement?.();
            if (audioEl) audioEngine.connectMediaElement('B', audioEl);
        }, 100);
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
            const tracks = mixSession.map(t => ({
                path: t.file.path,
                name: t.file.name,
                artist: t.analysis.artist || 'Unknown',
                key: t.analysis.key,
                bpm: t.analysis.bpm
            }));
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

            {/* Two Decks Side by Side */}
            <div className="decks-container">
                <DJDeck
                    ref={deckARef}
                    id="A"
                    track={deckA}
                    isActive={activeDeckId === 'A'}
                    onActivate={() => setActiveDeckId('A')}
                    onLoadTrack={(file) => handleLoadTrack(file, 'A')}
                    onClear={() => setDeckA(null)}
                />
                <DJDeck
                    ref={deckBRef}
                    id="B"
                    track={deckB}
                    isActive={activeDeckId === 'B'}
                    onActivate={() => setActiveDeckId('B')}
                    onLoadTrack={(file) => handleLoadTrack(file, 'B')}
                    onClear={() => setDeckB(null)}
                />
            </div>

            {/* BPM Match - Simple display between decks info */}
            <BPMMatch deckA={deckA} deckB={deckB} />

            {/* Mixer Panel - Tabbed controls for EQ, FX, Performance */}
            <MixerPanel
                deckARef={deckARef}
                deckBRef={deckBRef}
                deckATrack={deckA}
                deckBTrack={deckB}
            />

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

import React, { useState, useCallback, useEffect, useRef, memo } from 'react';
import { Link2, Link2Off, RefreshCw } from 'lucide-react';
import './beatSync.css';

const BeatSync = memo(({
    deckARef,
    deckBRef,
    deckABpm = 120,
    deckBBpm = 120,
    deckADownbeats = [],
    deckBDownbeats = [],
    onSyncDeck
}) => {
    const [syncLock, setSyncLock] = useState(false);
    const [masterDeck, setMasterDeck] = useState('A');
    const [beatPhaseA, setBeatPhaseA] = useState(0);
    const [beatPhaseB, setBeatPhaseB] = useState(0);

    const animationRef = useRef(null);

    // Calculate beat phase (0-3 for 4 beats in a bar)
    const calculateBeatPhase = useCallback((currentTime, downbeats, bpm) => {
        if (!downbeats || downbeats.length === 0) {
            // Fallback: calculate based on assumed 0 start
            const beatDuration = 60 / bpm;
            const beatPosition = currentTime / beatDuration;
            return Math.floor(beatPosition % 4);
        }

        // Find the closest downbeat before current time
        let closestDownbeat = 0;
        for (const db of downbeats) {
            if (db <= currentTime) {
                closestDownbeat = db;
            } else {
                break;
            }
        }

        const beatDuration = 60 / bpm;
        const timeSinceDownbeat = currentTime - closestDownbeat;
        const beatPosition = timeSinceDownbeat / beatDuration;
        return Math.floor(beatPosition % 4);
    }, []);

    // Update beat phases
    useEffect(() => {
        const updatePhases = () => {
            const deckA = deckARef?.current;
            const deckB = deckBRef?.current;

            if (deckA?.hasTrack?.() && deckA?.isPlaying?.()) {
                const timeA = deckA.getCurrentTime?.() || 0;
                setBeatPhaseA(calculateBeatPhase(timeA, deckADownbeats, deckABpm));
            }

            if (deckB?.hasTrack?.() && deckB?.isPlaying?.()) {
                const timeB = deckB.getCurrentTime?.() || 0;
                setBeatPhaseB(calculateBeatPhase(timeB, deckBDownbeats, deckBBpm));
            }

            animationRef.current = requestAnimationFrame(updatePhases);
        };

        animationRef.current = requestAnimationFrame(updatePhases);

        return () => {
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
        };
    }, [deckARef, deckBRef, deckABpm, deckBBpm, deckADownbeats, deckBDownbeats, calculateBeatPhase]);

    // Sync deck B to deck A's BPM
    const handleSyncBtoA = useCallback(() => {
        if (!deckABpm || !deckBBpm) return;

        const pitchChange = ((deckABpm / deckBBpm) - 1) * 100;
        onSyncDeck?.('B', pitchChange, deckABpm);
    }, [deckABpm, deckBBpm, onSyncDeck]);

    // Sync deck A to deck B's BPM
    const handleSyncAtoB = useCallback(() => {
        if (!deckABpm || !deckBBpm) return;

        const pitchChange = ((deckBBpm / deckABpm) - 1) * 100;
        onSyncDeck?.('A', pitchChange, deckBBpm);
    }, [deckABpm, deckBBpm, onSyncDeck]);

    // Toggle sync lock
    const handleSyncLockToggle = useCallback(() => {
        setSyncLock(prev => !prev);
    }, []);

    // Toggle master deck
    const handleMasterToggle = useCallback(() => {
        setMasterDeck(prev => prev === 'A' ? 'B' : 'A');
    }, []);

    // Check if decks are in sync (within 0.5 BPM)
    const isInSync = Math.abs(deckABpm - deckBBpm) < 0.5;

    // Check if beat phases are aligned
    const phasesAligned = beatPhaseA === beatPhaseB;

    return (
        <div className="beat-sync">
            <div className="beat-sync-header">
                <RefreshCw size={14} />
                <span>SYNC</span>
            </div>

            {/* BPM Comparison */}
            <div className="sync-bpm-display">
                <div className="sync-deck-bpm">
                    <span className="deck-label">A</span>
                    <span className="bpm-value">{deckABpm.toFixed(1)}</span>
                </div>
                <div className={`sync-status ${isInSync ? 'synced' : ''}`}>
                    {isInSync ? '=' : Math.abs(deckABpm - deckBBpm).toFixed(1)}
                </div>
                <div className="sync-deck-bpm">
                    <span className="bpm-value">{deckBBpm.toFixed(1)}</span>
                    <span className="deck-label">B</span>
                </div>
            </div>

            {/* Beat Phase Indicators */}
            <div className="beat-phase-display">
                <div className="phase-deck">
                    {[0, 1, 2, 3].map(i => (
                        <div
                            key={`a-${i}`}
                            className={`phase-dot ${beatPhaseA === i ? 'active' : ''}`}
                            style={{ backgroundColor: beatPhaseA === i ? '#8b5cf6' : undefined }}
                        />
                    ))}
                </div>
                <div className={`phase-status ${phasesAligned && isInSync ? 'aligned' : ''}`}>
                    {phasesAligned && isInSync ? 'LOCKED' : 'PHASE'}
                </div>
                <div className="phase-deck">
                    {[0, 1, 2, 3].map(i => (
                        <div
                            key={`b-${i}`}
                            className={`phase-dot ${beatPhaseB === i ? 'active' : ''}`}
                            style={{ backgroundColor: beatPhaseB === i ? '#ec4899' : undefined }}
                        />
                    ))}
                </div>
            </div>

            {/* Sync Buttons */}
            <div className="sync-buttons">
                <button
                    className="sync-btn sync-to-a"
                    onClick={handleSyncBtoA}
                    title="Sync B → A"
                >
                    B→A
                </button>
                <button
                    className={`sync-lock-btn ${syncLock ? 'active' : ''}`}
                    onClick={handleSyncLockToggle}
                    title={syncLock ? 'Unlock Sync' : 'Lock Sync'}
                >
                    {syncLock ? <Link2 size={14} /> : <Link2Off size={14} />}
                </button>
                <button
                    className="sync-btn sync-to-b"
                    onClick={handleSyncAtoB}
                    title="Sync A → B"
                >
                    A→B
                </button>
            </div>

            {/* Master Deck Selector */}
            <div className="master-selector">
                <span className="master-label">MASTER:</span>
                <button
                    className={`master-btn ${masterDeck === 'A' ? 'active' : ''}`}
                    onClick={() => setMasterDeck('A')}
                >
                    A
                </button>
                <button
                    className={`master-btn ${masterDeck === 'B' ? 'active' : ''}`}
                    onClick={() => setMasterDeck('B')}
                >
                    B
                </button>
            </div>
        </div>
    );
});

export default BeatSync;

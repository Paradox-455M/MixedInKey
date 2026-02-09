import React, { useState, useCallback, memo } from 'react';
import { Link, Unlink, ArrowRight, ArrowLeft, RefreshCw } from 'lucide-react';
import audioEngine from './audioEngine';
import './syncControl.css';

/**
 * Sync Control Component
 * Allows tempo and phase sync between decks
 */
const SyncControl = memo(({
    deckARef,
    deckBRef,
    bpmA,
    bpmB,
    downbeatsA,
    downbeatsB,
    onTempoChange
}) => {
    const [syncState, setSyncState] = useState({
        deckASync: false,  // Deck A synced to B
        deckBSync: false   // Deck B synced to A
    });
    const [lastSync, setLastSync] = useState(null);

    // Calculate sync info
    const syncInfo = audioEngine.getSyncInfo(bpmA, bpmB);

    // Sync Deck A to Deck B's tempo
    const handleSyncAToB = useCallback(() => {
        if (!bpmA || !bpmB) return;

        const result = audioEngine.syncTempo('A', 'B', bpmA, bpmB);
        if (result) {
            setSyncState(prev => ({ ...prev, deckASync: true }));
            setLastSync({ deck: 'A', ...result });
            onTempoChange?.('A', result.playbackRate);
        }
    }, [bpmA, bpmB, onTempoChange]);

    // Sync Deck B to Deck A's tempo
    const handleSyncBToA = useCallback(() => {
        if (!bpmA || !bpmB) return;

        const result = audioEngine.syncTempo('B', 'A', bpmB, bpmA);
        if (result) {
            setSyncState(prev => ({ ...prev, deckBSync: true }));
            setLastSync({ deck: 'B', ...result });
            onTempoChange?.('B', result.playbackRate);
        }
    }, [bpmA, bpmB, onTempoChange]);

    // Phase align Deck A to Deck B
    const handlePhaseAlignAToB = useCallback(() => {
        const currentTimeA = deckARef?.current?.getCurrentTime?.() || 0;
        const currentTimeB = deckBRef?.current?.getCurrentTime?.() || 0;

        const result = audioEngine.alignPhase(
            'A',
            downbeatsA,
            currentTimeA,
            downbeatsB,
            currentTimeB,
            bpmB
        );

        if (result?.aligned) {
            setLastSync({ deck: 'A', type: 'phase', ...result });
        }
    }, [deckARef, deckBRef, downbeatsA, downbeatsB, bpmB]);

    // Phase align Deck B to Deck A
    const handlePhaseAlignBToA = useCallback(() => {
        const currentTimeA = deckARef?.current?.getCurrentTime?.() || 0;
        const currentTimeB = deckBRef?.current?.getCurrentTime?.() || 0;

        const result = audioEngine.alignPhase(
            'B',
            downbeatsB,
            currentTimeB,
            downbeatsA,
            currentTimeA,
            bpmA
        );

        if (result?.aligned) {
            setLastSync({ deck: 'B', type: 'phase', ...result });
        }
    }, [deckARef, deckBRef, downbeatsA, downbeatsB, bpmA]);

    // Reset sync state
    const handleUnsync = useCallback((deckId) => {
        audioEngine.setPlaybackRate(deckId, 1);
        setSyncState(prev => ({
            ...prev,
            [deckId === 'A' ? 'deckASync' : 'deckBSync']: false
        }));
        onTempoChange?.(deckId, 1);
    }, [onTempoChange]);

    const canSync = syncInfo.canSync && bpmA && bpmB;

    return (
        <div className="sync-control">
            <div className="sync-header">
                <Link size={12} />
                <span>SYNC</span>
            </div>

            <div className="sync-info">
                <div className="sync-deck">
                    <span className="sync-deck-label">A</span>
                    <span className="sync-bpm">{bpmA?.toFixed(1) || '--'}</span>
                </div>
                <div className="sync-diff">
                    <span className={`diff-value ${syncInfo.canSync ? 'compatible' : 'incompatible'}`}>
                        {syncInfo.percentDifference}%
                    </span>
                </div>
                <div className="sync-deck">
                    <span className="sync-bpm">{bpmB?.toFixed(1) || '--'}</span>
                    <span className="sync-deck-label">B</span>
                </div>
            </div>

            <div className="sync-actions">
                {/* Sync A to B */}
                <div className="sync-action-group">
                    <button
                        className={`sync-btn ${syncState.deckASync ? 'active' : ''}`}
                        onClick={syncState.deckASync ? () => handleUnsync('A') : handleSyncAToB}
                        disabled={!canSync}
                        title={syncState.deckASync ? 'Unsync Deck A' : 'Sync A to B tempo'}
                    >
                        {syncState.deckASync ? <Unlink size={10} /> : <ArrowRight size={10} />}
                        <span>A→B</span>
                    </button>
                    <button
                        className="phase-btn"
                        onClick={handlePhaseAlignAToB}
                        disabled={!canSync}
                        title="Align A phase to B"
                    >
                        <RefreshCw size={10} />
                    </button>
                </div>

                {/* Sync B to A */}
                <div className="sync-action-group">
                    <button
                        className={`sync-btn ${syncState.deckBSync ? 'active' : ''}`}
                        onClick={syncState.deckBSync ? () => handleUnsync('B') : handleSyncBToA}
                        disabled={!canSync}
                        title={syncState.deckBSync ? 'Unsync Deck B' : 'Sync B to A tempo'}
                    >
                        {syncState.deckBSync ? <Unlink size={10} /> : <ArrowLeft size={10} />}
                        <span>B→A</span>
                    </button>
                    <button
                        className="phase-btn"
                        onClick={handlePhaseAlignBToA}
                        disabled={!canSync}
                        title="Align B phase to A"
                    >
                        <RefreshCw size={10} />
                    </button>
                </div>
            </div>

            {lastSync && (
                <div className="sync-status">
                    {lastSync.type === 'phase' ? (
                        <span>Phase: {lastSync.phaseShiftMs?.toFixed(0)}ms</span>
                    ) : (
                        <span>Deck {lastSync.deck}: {lastSync.percentChange}%</span>
                    )}
                </div>
            )}
        </div>
    );
});

SyncControl.displayName = 'SyncControl';

export default SyncControl;

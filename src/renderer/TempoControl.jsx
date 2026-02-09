import React, { useState, useCallback, useEffect, useRef, memo } from 'react';
import { Lock, Unlock, RefreshCw, Plus, Minus } from 'lucide-react';
import audioEngine from './audioEngine';
import './tempoControl.css';

/**
 * Professional Tempo/Pitch Control with Key Lock
 * Allows tempo adjustment (±8%) without affecting musical key
 */
const TempoControl = memo(({
    deckId,
    baseBpm = 120,
    deckRef,
    onTempoChange,
    compact = false
}) => {
    const [tempo, setTempo] = useState(0); // -8 to +8 percent
    const [keyLock, setKeyLock] = useState(false);
    const [isSynced, setIsSynced] = useState(false);
    const sliderRef = useRef(null);

    // Calculate actual BPM
    const actualBpm = baseBpm * (1 + tempo / 100);
    const playbackRate = 1 + tempo / 100;

    // Apply tempo change to audio
    useEffect(() => {
        if (deckRef?.current?.getAudioElement) {
            const audioEl = deckRef.current.getAudioElement();
            if (audioEl) {
                audioEl.playbackRate = playbackRate;
            }
        }
        audioEngine.setPlaybackRate(deckId, playbackRate);
        onTempoChange?.(actualBpm, playbackRate);
    }, [tempo, deckId, deckRef, playbackRate, actualBpm, onTempoChange]);

    // Apply key lock
    useEffect(() => {
        audioEngine.setKeyLock(deckId, keyLock);
    }, [keyLock, deckId]);

    const handleSliderChange = useCallback((e) => {
        const value = parseFloat(e.target.value);
        setTempo(value);
    }, []);

    const handleSliderMouseDown = useCallback((e) => {
        const slider = sliderRef.current;
        if (!slider) return;

        const updateValue = (clientY) => {
            const rect = slider.getBoundingClientRect();
            const percentage = 1 - (clientY - rect.top) / rect.height;
            const value = Math.max(-8, Math.min(8, (percentage - 0.5) * 16));
            setTempo(Math.round(value * 10) / 10);
        };

        const handleMouseMove = (moveE) => {
            updateValue(moveE.clientY);
        };

        const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        updateValue(e.clientY);
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }, []);

    const handleNudge = useCallback((direction) => {
        setTempo(prev => {
            const newValue = prev + direction * 0.1;
            return Math.max(-8, Math.min(8, Math.round(newValue * 10) / 10));
        });
    }, []);

    const handleReset = useCallback(() => {
        setTempo(0);
    }, []);

    const handleSync = useCallback(() => {
        // This would sync to the other deck's BPM
        setIsSynced(!isSynced);
        // TODO: Implement actual sync logic with other deck
    }, [isSynced]);

    const toggleKeyLock = useCallback(() => {
        setKeyLock(prev => !prev);
    }, []);

    // Double-click to reset
    const handleDoubleClick = useCallback(() => {
        setTempo(0);
    }, []);

    if (compact) {
        return (
            <div className="tempo-control-compact">
                <div className="tempo-header">
                    <span className="tempo-label">TEMPO</span>
                    <button
                        className={`key-lock-btn ${keyLock ? 'active' : ''}`}
                        onClick={toggleKeyLock}
                        title={keyLock ? 'Key Lock ON' : 'Key Lock OFF'}
                    >
                        {keyLock ? <Lock size={10} /> : <Unlock size={10} />}
                    </button>
                </div>
                <div className="tempo-value-compact">
                    <span className={`bpm-display ${tempo !== 0 ? 'modified' : ''}`}>
                        {actualBpm.toFixed(1)}
                    </span>
                    <span className="tempo-percent">
                        {tempo >= 0 ? '+' : ''}{tempo.toFixed(1)}%
                    </span>
                </div>
                <input
                    type="range"
                    min="-8"
                    max="8"
                    step="0.1"
                    value={tempo}
                    onChange={handleSliderChange}
                    onDoubleClick={handleDoubleClick}
                    className="tempo-slider-horizontal"
                />
            </div>
        );
    }

    return (
        <div className="tempo-control">
            {/* BPM Display */}
            <div className="tempo-display">
                <div className={`bpm-value ${tempo !== 0 ? 'modified' : ''}`}>
                    {actualBpm.toFixed(1)}
                </div>
                <div className="bpm-label">BPM</div>
            </div>

            {/* Tempo Percentage */}
            <div className="tempo-percent-display">
                <span className={tempo >= 0 ? 'positive' : 'negative'}>
                    {tempo >= 0 ? '+' : ''}{tempo.toFixed(1)}%
                </span>
            </div>

            {/* Vertical Fader */}
            <div className="tempo-fader-container">
                <div className="tempo-scale">
                    <span>+8</span>
                    <span>+4</span>
                    <span>0</span>
                    <span>-4</span>
                    <span>-8</span>
                </div>
                <div
                    className="tempo-fader"
                    ref={sliderRef}
                    onMouseDown={handleSliderMouseDown}
                    onDoubleClick={handleDoubleClick}
                >
                    <div className="tempo-fader-track">
                        <div className="tempo-fader-center" />
                        <div
                            className="tempo-fader-fill"
                            style={{
                                height: `${Math.abs(tempo) / 8 * 50}%`,
                                top: tempo >= 0 ? `${50 - tempo / 8 * 50}%` : '50%'
                            }}
                        />
                        <div
                            className="tempo-fader-thumb"
                            style={{
                                top: `${50 - tempo / 16 * 100}%`
                            }}
                        />
                    </div>
                </div>
            </div>

            {/* Nudge Buttons */}
            <div className="tempo-nudge">
                <button className="nudge-btn" onClick={() => handleNudge(1)} title="Nudge +0.1%">
                    <Plus size={12} />
                </button>
                <button className="nudge-btn" onClick={() => handleNudge(-1)} title="Nudge -0.1%">
                    <Minus size={12} />
                </button>
            </div>

            {/* Control Buttons */}
            <div className="tempo-controls">
                <button
                    className={`tempo-btn key-lock ${keyLock ? 'active' : ''}`}
                    onClick={toggleKeyLock}
                    title={keyLock ? 'Key Lock ON - Pitch preserved' : 'Key Lock OFF'}
                >
                    {keyLock ? <Lock size={14} /> : <Unlock size={14} />}
                    <span>KEY</span>
                </button>
                <button
                    className="tempo-btn reset"
                    onClick={handleReset}
                    title="Reset to original tempo"
                >
                    <RefreshCw size={14} />
                </button>
                <button
                    className={`tempo-btn sync ${isSynced ? 'active' : ''}`}
                    onClick={handleSync}
                    title="Sync to other deck"
                >
                    SYNC
                </button>
            </div>
        </div>
    );
});

TempoControl.displayName = 'TempoControl';

/**
 * Sync button component for quick deck synchronization
 */
export const SyncButton = memo(({ deckId, otherDeckBpm, currentBpm, onSync }) => {
    const [synced, setSynced] = useState(false);

    const handleSync = useCallback(() => {
        if (otherDeckBpm && currentBpm) {
            const tempoChange = ((otherDeckBpm / currentBpm) - 1) * 100;
            onSync?.(tempoChange);
            setSynced(true);
            setTimeout(() => setSynced(false), 1000);
        }
    }, [otherDeckBpm, currentBpm, onSync]);

    return (
        <button
            className={`sync-button ${synced ? 'synced' : ''}`}
            onClick={handleSync}
            disabled={!otherDeckBpm}
            title={otherDeckBpm ? `Sync to ${otherDeckBpm.toFixed(1)} BPM` : 'No other deck loaded'}
        >
            SYNC
        </button>
    );
});

SyncButton.displayName = 'SyncButton';

export default TempoControl;

import React, { useState, useCallback, useRef, memo } from 'react';
import { Gauge, ChevronUp, ChevronDown, Lock } from 'lucide-react';
import './pitchControls.css';

const PITCH_RANGES = [6, 10, 16, 100]; // Percentage ranges

const PitchControls = memo(({
    audioRef,
    originalBpm = 120,
    onPitchChange,
    onBpmChange
}) => {
    const [pitch, setPitch] = useState(0); // -range to +range percent
    const [pitchRange, setPitchRange] = useState(10); // ±10% default
    const [keyLock, setKeyLock] = useState(false);
    const [isBending, setIsBending] = useState(null); // 'up' or 'down' or null

    const bendIntervalRef = useRef(null);

    // Calculate current BPM based on pitch
    const currentBpm = originalBpm * (1 + pitch / 100);

    // Update playback rate
    const updatePlaybackRate = useCallback((newPitch) => {
        if (!audioRef?.current) return;

        const rate = 1 + newPitch / 100;
        audioRef.current.playbackRate = rate;

        // Note: preservesPitch is for key lock (not all browsers support it)
        if ('preservesPitch' in audioRef.current) {
            audioRef.current.preservesPitch = keyLock;
        }

        onPitchChange?.(newPitch);
        onBpmChange?.(originalBpm * rate);
    }, [audioRef, keyLock, originalBpm, onPitchChange, onBpmChange]);

    // Handle pitch fader change
    const handlePitchChange = useCallback((newPitch) => {
        const clampedPitch = Math.max(-pitchRange, Math.min(pitchRange, newPitch));
        setPitch(clampedPitch);
        updatePlaybackRate(clampedPitch);
    }, [pitchRange, updatePlaybackRate]);

    // Handle fader drag
    const handleFaderMouseDown = useCallback((e) => {
        const fader = e.currentTarget;
        const rect = fader.getBoundingClientRect();

        const updateFromMouse = (clientY) => {
            const y = clientY - rect.top;
            const percentage = 1 - (y / rect.height);
            const newPitch = (percentage * 2 - 1) * pitchRange;
            handlePitchChange(newPitch);
        };

        updateFromMouse(e.clientY);

        const handleMove = (moveE) => updateFromMouse(moveE.clientY);
        const handleUp = () => {
            document.removeEventListener('mousemove', handleMove);
            document.removeEventListener('mouseup', handleUp);
        };

        document.addEventListener('mousemove', handleMove);
        document.addEventListener('mouseup', handleUp);
    }, [pitchRange, handlePitchChange]);

    // Pitch bend (temporary speed adjustment)
    const startBend = useCallback((direction) => {
        if (!audioRef?.current) return;

        setIsBending(direction);
        const bendAmount = direction === 'up' ? 0.04 : -0.04; // 4% bend

        const originalRate = audioRef.current.playbackRate;
        audioRef.current.playbackRate = originalRate + bendAmount;

        // Clear any existing interval
        if (bendIntervalRef.current) {
            clearInterval(bendIntervalRef.current);
        }
    }, [audioRef]);

    const stopBend = useCallback(() => {
        if (!audioRef?.current) return;

        setIsBending(null);
        // Restore original pitch-adjusted rate
        audioRef.current.playbackRate = 1 + pitch / 100;

        if (bendIntervalRef.current) {
            clearInterval(bendIntervalRef.current);
            bendIntervalRef.current = null;
        }
    }, [audioRef, pitch]);

    // Reset pitch to 0
    const handleReset = useCallback(() => {
        setPitch(0);
        updatePlaybackRate(0);
    }, [updatePlaybackRate]);

    // Toggle key lock
    const handleKeyLockToggle = useCallback(() => {
        setKeyLock(prev => {
            const newKeyLock = !prev;
            if (audioRef?.current && 'preservesPitch' in audioRef.current) {
                audioRef.current.preservesPitch = newKeyLock;
            }
            return newKeyLock;
        });
    }, [audioRef]);

    // Cycle pitch range
    const cyclePitchRange = useCallback(() => {
        const currentIndex = PITCH_RANGES.indexOf(pitchRange);
        const nextIndex = (currentIndex + 1) % PITCH_RANGES.length;
        const newRange = PITCH_RANGES[nextIndex];
        setPitchRange(newRange);

        // Clamp current pitch to new range
        if (Math.abs(pitch) > newRange) {
            const clampedPitch = Math.sign(pitch) * newRange;
            setPitch(clampedPitch);
            updatePlaybackRate(clampedPitch);
        }
    }, [pitchRange, pitch, updatePlaybackRate]);

    // Calculate fader position
    const faderPosition = ((pitch / pitchRange + 1) / 2) * 100;

    return (
        <div className="pitch-controls">
            <div className="pitch-header">
                <Gauge size={14} />
                <span>TEMPO</span>
            </div>

            <div className="pitch-display">
                <div className="pitch-bpm">
                    {currentBpm.toFixed(1)}
                    <span className="bpm-label">BPM</span>
                </div>
                <div className={`pitch-percent ${pitch > 0 ? 'positive' : pitch < 0 ? 'negative' : ''}`}>
                    {pitch > 0 ? '+' : ''}{pitch.toFixed(1)}%
                </div>
            </div>

            <div className="pitch-fader-section">
                {/* Pitch Bend Up */}
                <button
                    className={`pitch-bend-btn ${isBending === 'up' ? 'active' : ''}`}
                    onMouseDown={() => startBend('up')}
                    onMouseUp={stopBend}
                    onMouseLeave={stopBend}
                >
                    <ChevronUp size={14} />
                </button>

                {/* Pitch Fader */}
                <div
                    className="pitch-fader"
                    onMouseDown={handleFaderMouseDown}
                    onDoubleClick={handleReset}
                >
                    <div className="pitch-fader-track">
                        <div className="pitch-fader-center" />
                        <div className="pitch-fader-marks">
                            {[-pitchRange, -pitchRange/2, 0, pitchRange/2, pitchRange].map(mark => (
                                <div
                                    key={mark}
                                    className={`pitch-mark ${mark === 0 ? 'center' : ''}`}
                                    style={{ bottom: `${((mark / pitchRange + 1) / 2) * 100}%` }}
                                >
                                    <span>{mark > 0 ? '+' : ''}{mark}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div
                        className="pitch-fader-thumb"
                        style={{ bottom: `${faderPosition}%` }}
                    />
                </div>

                {/* Pitch Bend Down */}
                <button
                    className={`pitch-bend-btn ${isBending === 'down' ? 'active' : ''}`}
                    onMouseDown={() => startBend('down')}
                    onMouseUp={stopBend}
                    onMouseLeave={stopBend}
                >
                    <ChevronDown size={14} />
                </button>
            </div>

            <div className="pitch-options">
                {/* Range Selector */}
                <button
                    className="pitch-range-btn"
                    onClick={cyclePitchRange}
                    title="Pitch Range"
                >
                    ±{pitchRange}%
                </button>

                {/* Key Lock */}
                <button
                    className={`key-lock-btn ${keyLock ? 'active' : ''}`}
                    onClick={handleKeyLockToggle}
                    title="Key Lock (Master Tempo)"
                >
                    <Lock size={12} />
                </button>

                {/* Reset */}
                <button
                    className="pitch-reset-btn"
                    onClick={handleReset}
                    title="Reset to 0%"
                >
                    0
                </button>
            </div>
        </div>
    );
});

export default PitchControls;

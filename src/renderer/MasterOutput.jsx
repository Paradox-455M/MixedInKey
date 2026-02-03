import React, { useState, useCallback, useEffect, useRef, memo } from 'react';
import { Volume2, Headphones, AlertTriangle } from 'lucide-react';
import './masterOutput.css';

// Stereo VU Meter Component
const StereoVUMeter = memo(({ leftLevel, rightLevel }) => {
    const segments = 16;
    const leftSegments = Math.round(leftLevel * segments);
    const rightSegments = Math.round(rightLevel * segments);

    const getSegmentColor = (index, total) => {
        if (index >= total - 2) return '#ef4444'; // Red (clipping)
        if (index >= total - 4) return '#f59e0b'; // Orange (warning)
        if (index >= total - 6) return '#eab308'; // Yellow
        return '#10b981'; // Green
    };

    return (
        <div className="stereo-vu-meter">
            <div className="vu-channel">
                <span className="vu-channel-label">L</span>
                <div className="vu-bar">
                    {Array.from({ length: segments }).map((_, i) => {
                        const isActive = i < leftSegments;
                        return (
                            <div
                                key={`l-${i}`}
                                className={`vu-segment ${isActive ? 'active' : ''}`}
                                style={{
                                    backgroundColor: isActive ? getSegmentColor(i, segments) : undefined
                                }}
                            />
                        );
                    })}
                </div>
            </div>
            <div className="vu-channel">
                <span className="vu-channel-label">R</span>
                <div className="vu-bar">
                    {Array.from({ length: segments }).map((_, i) => {
                        const isActive = i < rightSegments;
                        return (
                            <div
                                key={`r-${i}`}
                                className={`vu-segment ${isActive ? 'active' : ''}`}
                                style={{
                                    backgroundColor: isActive ? getSegmentColor(i, segments) : undefined
                                }}
                            />
                        );
                    })}
                </div>
            </div>
            <div className="vu-scale">
                <span>-∞</span>
                <span>-12</span>
                <span>-6</span>
                <span>0</span>
            </div>
        </div>
    );
});

// Master Volume Knob
const MasterKnob = memo(({ value, onChange }) => {
    const normalizedValue = value;
    const rotation = -135 + normalizedValue * 270;

    const handleMouseDown = (e) => {
        const startY = e.clientY;
        const startValue = value;

        const handleMove = (moveE) => {
            const deltaY = startY - moveE.clientY;
            const newValue = Math.max(0, Math.min(1, startValue + deltaY / 100));
            onChange?.(newValue);
        };

        const handleUp = () => {
            document.removeEventListener('mousemove', handleMove);
            document.removeEventListener('mouseup', handleUp);
        };

        document.addEventListener('mousemove', handleMove);
        document.addEventListener('mouseup', handleUp);
    };

    return (
        <div className="master-knob-container">
            <div className="master-knob-label">MASTER</div>
            <div
                className="master-knob"
                onMouseDown={handleMouseDown}
                onDoubleClick={() => onChange?.(0.8)}
            >
                <div className="master-knob-track">
                    <svg viewBox="0 0 100 100">
                        <circle
                            cx="50"
                            cy="50"
                            r="40"
                            fill="none"
                            stroke="#27272a"
                            strokeWidth="6"
                            strokeDasharray="188.5"
                            strokeDashoffset="62.8"
                            transform="rotate(135 50 50)"
                        />
                        <circle
                            cx="50"
                            cy="50"
                            r="40"
                            fill="none"
                            stroke="#f59e0b"
                            strokeWidth="6"
                            strokeDasharray="188.5"
                            strokeDashoffset={188.5 - normalizedValue * 188.5}
                            transform="rotate(135 50 50)"
                        />
                    </svg>
                </div>
                <div
                    className="master-knob-dial"
                    style={{ transform: `rotate(${rotation}deg)` }}
                >
                    <div className="master-knob-indicator" />
                </div>
            </div>
            <div className="master-knob-value">{Math.round(value * 100)}%</div>
        </div>
    );
});

// PFL (Pre-Fader Listen) Button
const PFLButton = memo(({ deckId, active, onClick }) => (
    <button
        className={`pfl-btn ${active ? 'active' : ''}`}
        onClick={() => onClick(deckId)}
        title={`Cue Deck ${deckId} to headphones`}
    >
        <Headphones size={12} />
        <span>{deckId}</span>
    </button>
));

// Main Master Output Component
const MasterOutput = memo(({
    audioEngine,
    deckALevel = 0,
    deckBLevel = 0,
    onMasterVolumeChange
}) => {
    const [masterVolume, setMasterVolume] = useState(0.8);
    const [masterLevel, setMasterLevel] = useState({ left: 0, right: 0 });
    const [pflState, setPflState] = useState({ A: false, B: false });
    const [isClipping, setIsClipping] = useState(false);

    const levelPollRef = useRef(null);
    const clipTimeoutRef = useRef(null);

    // Simulate stereo master level from deck levels
    useEffect(() => {
        const updateMasterLevel = () => {
            // Combine deck levels (simplified stereo simulation)
            const combinedLevel = Math.min(1, (deckALevel + deckBLevel) * masterVolume);

            // Add slight stereo variation
            const leftLevel = Math.min(1, combinedLevel * (1 + (Math.random() - 0.5) * 0.1));
            const rightLevel = Math.min(1, combinedLevel * (1 + (Math.random() - 0.5) * 0.1));

            setMasterLevel({ left: leftLevel, right: rightLevel });

            // Check for clipping
            if (combinedLevel > 0.95) {
                setIsClipping(true);
                if (clipTimeoutRef.current) {
                    clearTimeout(clipTimeoutRef.current);
                }
                clipTimeoutRef.current = setTimeout(() => setIsClipping(false), 500);
            }

            levelPollRef.current = requestAnimationFrame(updateMasterLevel);
        };

        levelPollRef.current = requestAnimationFrame(updateMasterLevel);

        return () => {
            if (levelPollRef.current) {
                cancelAnimationFrame(levelPollRef.current);
            }
            if (clipTimeoutRef.current) {
                clearTimeout(clipTimeoutRef.current);
            }
        };
    }, [deckALevel, deckBLevel, masterVolume]);

    // Handle master volume change
    const handleMasterVolumeChange = useCallback((value) => {
        setMasterVolume(value);
        onMasterVolumeChange?.(value);

        // Update audio engine master gain if available
        if (audioEngine?.masterGain) {
            audioEngine.masterGain.gain.value = value;
        }
    }, [audioEngine, onMasterVolumeChange]);

    // Toggle PFL for a deck
    const handlePFLToggle = useCallback((deckId) => {
        setPflState(prev => ({
            ...prev,
            [deckId]: !prev[deckId]
        }));
        // Note: Actual headphone routing would require additional audio engine support
    }, []);

    return (
        <div className="master-output">
            <div className="master-output-header">
                <Volume2 size={14} />
                <span>MASTER OUT</span>
                {isClipping && (
                    <div className="clip-indicator">
                        <AlertTriangle size={12} />
                        <span>CLIP</span>
                    </div>
                )}
            </div>

            <div className="master-output-content">
                {/* Stereo VU Meters */}
                <StereoVUMeter
                    leftLevel={masterLevel.left}
                    rightLevel={masterLevel.right}
                />

                {/* Master Volume */}
                <MasterKnob
                    value={masterVolume}
                    onChange={handleMasterVolumeChange}
                />

                {/* PFL Section */}
                <div className="pfl-section">
                    <div className="pfl-label">CUE</div>
                    <div className="pfl-buttons">
                        <PFLButton
                            deckId="A"
                            active={pflState.A}
                            onClick={handlePFLToggle}
                        />
                        <PFLButton
                            deckId="B"
                            active={pflState.B}
                            onClick={handlePFLToggle}
                        />
                    </div>
                </div>
            </div>

            {/* Output Level Display */}
            <div className="output-level-display">
                <span className="output-db">
                    {masterLevel.left > 0
                        ? `${(20 * Math.log10(masterLevel.left)).toFixed(1)} dB`
                        : '-∞ dB'
                    }
                </span>
            </div>
        </div>
    );
});

export default MasterOutput;

import React, { useState, useCallback, useEffect, useRef, memo } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import './mixerControls.css';

// Rotary Knob Component
const Knob = memo(({
    value,
    min = -24,
    max = 12,
    onChange,
    label,
    size = 40,
    color = '#8b5cf6',
    showValue = true,
    formatValue = (v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}`,
    disabled = false
}) => {
    const knobRef = useRef(null);
    const isDragging = useRef(false);
    const startY = useRef(0);
    const startValue = useRef(0);

    const normalizedValue = (value - min) / (max - min);
    const rotation = -135 + normalizedValue * 270; // -135 to +135 degrees

    const handleMouseDown = (e) => {
        if (disabled) return;
        isDragging.current = true;
        startY.current = e.clientY;
        startValue.current = value;
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    const handleMouseMove = useCallback((e) => {
        if (!isDragging.current) return;
        const deltaY = startY.current - e.clientY;
        const range = max - min;
        const sensitivity = range / 100; // 100px for full range
        const newValue = Math.max(min, Math.min(max, startValue.current + deltaY * sensitivity));
        onChange?.(newValue);
    }, [min, max, onChange]);

    const handleMouseUp = useCallback(() => {
        isDragging.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
    }, [handleMouseMove]);

    const handleDoubleClick = () => {
        if (disabled) return;
        onChange?.(0); // Reset to center
    };

    return (
        <div className={`knob-container ${disabled ? 'disabled' : ''}`}>
            {label && <div className="knob-label">{label}</div>}
            <div
                ref={knobRef}
                className="knob"
                style={{ width: size, height: size }}
                onMouseDown={handleMouseDown}
                onDoubleClick={handleDoubleClick}
            >
                <div className="knob-track">
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
                            stroke={color}
                            strokeWidth="6"
                            strokeDasharray="188.5"
                            strokeDashoffset={188.5 - normalizedValue * 188.5}
                            transform="rotate(135 50 50)"
                            style={{ transition: 'stroke-dashoffset 0.05s' }}
                        />
                    </svg>
                </div>
                <div
                    className="knob-dial"
                    style={{ transform: `rotate(${rotation}deg)` }}
                >
                    <div className="knob-indicator" style={{ backgroundColor: color }} />
                </div>
            </div>
            {showValue && (
                <div className="knob-value">{formatValue(value)}</div>
            )}
        </div>
    );
});

// Vertical Fader Component
const Fader = memo(({ value, onChange, label, height = 120, color = '#8b5cf6' }) => {
    const faderRef = useRef(null);
    const isDragging = useRef(false);

    const handleMouseDown = (e) => {
        isDragging.current = true;
        updateValue(e);
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    const handleMouseMove = (e) => {
        if (!isDragging.current) return;
        updateValue(e);
    };

    const handleMouseUp = () => {
        isDragging.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
    };

    const updateValue = (e) => {
        if (!faderRef.current) return;
        const rect = faderRef.current.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const newValue = 1 - Math.max(0, Math.min(1, y / rect.height));
        onChange?.(newValue);
    };

    return (
        <div className="fader-container">
            {label && <div className="fader-label">{label}</div>}
            <div
                ref={faderRef}
                className="fader"
                style={{ height }}
                onMouseDown={handleMouseDown}
            >
                <div className="fader-track">
                    <div
                        className="fader-fill"
                        style={{
                            height: `${value * 100}%`,
                            backgroundColor: color
                        }}
                    />
                </div>
                <div
                    className="fader-thumb"
                    style={{ bottom: `${value * 100}%` }}
                />
            </div>
            <div className="fader-value">{Math.round(value * 100)}%</div>
        </div>
    );
});

// Horizontal Crossfader Component
const Crossfader = memo(({ value, onChange }) => {
    const faderRef = useRef(null);
    const isDragging = useRef(false);

    const handleMouseDown = (e) => {
        isDragging.current = true;
        updateValue(e);
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    const handleMouseMove = (e) => {
        if (!isDragging.current) return;
        updateValue(e);
    };

    const handleMouseUp = () => {
        isDragging.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
    };

    const updateValue = (e) => {
        if (!faderRef.current) return;
        const rect = faderRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const newValue = Math.max(0, Math.min(1, x / rect.width));
        onChange?.(newValue);
    };

    const handleDoubleClick = () => {
        onChange?.(0.5); // Reset to center
    };

    return (
        <div className="crossfader-container">
            <span className="crossfader-label">A</span>
            <div
                ref={faderRef}
                className="crossfader"
                onMouseDown={handleMouseDown}
                onDoubleClick={handleDoubleClick}
            >
                <div className="crossfader-track" />
                <div
                    className="crossfader-thumb"
                    style={{ left: `${value * 100}%` }}
                />
            </div>
            <span className="crossfader-label">B</span>
        </div>
    );
});

// VU Meter Component
const VUMeter = memo(({ level, label }) => {
    const segments = 12;
    const activeSegments = Math.round(level * segments);

    return (
        <div className="vu-meter">
            {label && <div className="vu-label">{label}</div>}
            <div className="vu-segments">
                {Array.from({ length: segments }).map((_, i) => {
                    const isActive = i < activeSegments;
                    let color = '#10b981'; // Green
                    if (i >= segments - 2) color = '#ef4444'; // Red for top 2
                    else if (i >= segments - 4) color = '#f59e0b'; // Orange for next 2

                    return (
                        <div
                            key={i}
                            className={`vu-segment ${isActive ? 'active' : ''}`}
                            style={{ backgroundColor: isActive ? color : undefined }}
                        />
                    );
                })}
            </div>
        </div>
    );
});

// Kill Button Component
const KillButton = memo(({ active, onClick, label }) => (
    <button
        className={`kill-btn ${active ? 'active' : ''}`}
        onClick={onClick}
        title={`Kill ${label}`}
    >
        {active ? <VolumeX size={12} /> : label}
    </button>
));

// EQ Channel Strip Component
const EQStrip = memo(({
    deckId,
    eqValues,
    eqKills,
    volume,
    gain,
    level,
    onEQChange,
    onKillToggle,
    onVolumeChange,
    onGainChange
}) => {
    return (
        <div className="eq-strip">
            <div className="eq-strip-header">DECK {deckId}</div>

            {/* Gain Knob */}
            <Knob
                value={gain}
                min={-12}
                max={12}
                onChange={(v) => onGainChange?.(deckId, v)}
                label="GAIN"
                size={36}
                color="#f59e0b"
                formatValue={(v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}`}
            />

            {/* EQ Knobs with Kill buttons */}
            <div className="eq-band">
                <Knob
                    value={eqValues.high}
                    min={-24}
                    max={12}
                    onChange={(v) => onEQChange?.(deckId, 'high', v)}
                    label="HI"
                    size={36}
                    color="#3b82f6"
                    disabled={eqKills.high}
                />
                <KillButton
                    active={eqKills.high}
                    onClick={() => onKillToggle?.(deckId, 'high')}
                    label="HI"
                />
            </div>

            <div className="eq-band">
                <Knob
                    value={eqValues.mid}
                    min={-24}
                    max={12}
                    onChange={(v) => onEQChange?.(deckId, 'mid', v)}
                    label="MID"
                    size={36}
                    color="#10b981"
                    disabled={eqKills.mid}
                />
                <KillButton
                    active={eqKills.mid}
                    onClick={() => onKillToggle?.(deckId, 'mid')}
                    label="MID"
                />
            </div>

            <div className="eq-band">
                <Knob
                    value={eqValues.low}
                    min={-24}
                    max={12}
                    onChange={(v) => onEQChange?.(deckId, 'low', v)}
                    label="LOW"
                    size={36}
                    color="#ef4444"
                    disabled={eqKills.low}
                />
                <KillButton
                    active={eqKills.low}
                    onClick={() => onKillToggle?.(deckId, 'low')}
                    label="LOW"
                />
            </div>

            {/* Volume Fader and VU Meter */}
            <div className="channel-output">
                <VUMeter level={level} />
                <Fader
                    value={volume}
                    onChange={(v) => onVolumeChange?.(deckId, v)}
                    height={100}
                    color={deckId === 'A' ? '#8b5cf6' : '#ec4899'}
                />
            </div>
        </div>
    );
});

// Main Mixer Controls Component
const MixerControls = ({
    audioEngine,
    deckAState,
    deckBState,
    deckALevel = 0,
    deckBLevel = 0,
    crossfaderValue = 0.5,
    onCrossfaderChange
}) => {
    const [eqA, setEqA] = useState({ low: 0, mid: 0, high: 0 });
    const [eqB, setEqB] = useState({ low: 0, mid: 0, high: 0 });
    const [killsA, setKillsA] = useState({ low: false, mid: false, high: false });
    const [killsB, setKillsB] = useState({ low: false, mid: false, high: false });
    const [volumeA, setVolumeA] = useState(1);
    const [volumeB, setVolumeB] = useState(1);
    const [gainA, setGainA] = useState(0);
    const [gainB, setGainB] = useState(0);

    const handleEQChange = useCallback((deckId, band, value) => {
        if (deckId === 'A') {
            setEqA(prev => ({ ...prev, [band]: value }));
        } else {
            setEqB(prev => ({ ...prev, [band]: value }));
        }
        audioEngine?.setEQ(deckId, band, value);
    }, [audioEngine]);

    const handleKillToggle = useCallback((deckId, band) => {
        if (deckId === 'A') {
            setKillsA(prev => {
                const newKills = { ...prev, [band]: !prev[band] };
                audioEngine?.setEQKill(deckId, band, newKills[band]);
                return newKills;
            });
        } else {
            setKillsB(prev => {
                const newKills = { ...prev, [band]: !prev[band] };
                audioEngine?.setEQKill(deckId, band, newKills[band]);
                return newKills;
            });
        }
    }, [audioEngine]);

    const handleVolumeChange = useCallback((deckId, value) => {
        if (deckId === 'A') {
            setVolumeA(value);
        } else {
            setVolumeB(value);
        }
        audioEngine?.setVolume(deckId, value);
    }, [audioEngine]);

    const handleGainChange = useCallback((deckId, value) => {
        if (deckId === 'A') {
            setGainA(value);
        } else {
            setGainB(value);
        }
        audioEngine?.setGain(deckId, value);
    }, [audioEngine]);

    return (
        <div className="mixer-controls">
            <EQStrip
                deckId="A"
                eqValues={eqA}
                eqKills={killsA}
                volume={volumeA}
                gain={gainA}
                level={deckALevel}
                onEQChange={handleEQChange}
                onKillToggle={handleKillToggle}
                onVolumeChange={handleVolumeChange}
                onGainChange={handleGainChange}
            />

            <div className="mixer-center">
                <div className="mixer-master">
                    <div className="master-label">MASTER</div>
                </div>
                <Crossfader
                    value={crossfaderValue}
                    onChange={onCrossfaderChange}
                />
            </div>

            <EQStrip
                deckId="B"
                eqValues={eqB}
                eqKills={killsB}
                volume={volumeB}
                gain={gainB}
                level={deckBLevel}
                onEQChange={handleEQChange}
                onKillToggle={handleKillToggle}
                onVolumeChange={handleVolumeChange}
                onGainChange={handleGainChange}
            />
        </div>
    );
};

export default memo(MixerControls);

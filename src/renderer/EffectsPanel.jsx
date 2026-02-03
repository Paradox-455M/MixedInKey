import React, { useState, useCallback, memo } from 'react';
import { Filter, Clock, Waves } from 'lucide-react';
import './effectsPanel.css';

// Rotary Knob Component (reused from MixerControls pattern)
const EffectKnob = memo(({
    value,
    min = 0,
    max = 1,
    onChange,
    label,
    size = 36,
    color = '#8b5cf6',
    formatValue = (v) => `${Math.round(v * 100)}%`,
    disabled = false
}) => {
    const normalizedValue = (value - min) / (max - min);
    const rotation = -135 + normalizedValue * 270;

    const handleMouseDown = (e) => {
        if (disabled) return;

        const startY = e.clientY;
        const startValue = value;

        const handleMove = (moveE) => {
            const deltaY = startY - moveE.clientY;
            const range = max - min;
            const sensitivity = range / 100;
            const newValue = Math.max(min, Math.min(max, startValue + deltaY * sensitivity));
            onChange?.(newValue);
        };

        const handleUp = () => {
            document.removeEventListener('mousemove', handleMove);
            document.removeEventListener('mouseup', handleUp);
        };

        document.addEventListener('mousemove', handleMove);
        document.addEventListener('mouseup', handleUp);
    };

    const handleDoubleClick = () => {
        if (!disabled) {
            onChange?.(min); // Reset to minimum
        }
    };

    return (
        <div className={`effect-knob-container ${disabled ? 'disabled' : ''}`}>
            <div className="effect-knob-label">{label}</div>
            <div
                className="effect-knob"
                style={{ width: size, height: size }}
                onMouseDown={handleMouseDown}
                onDoubleClick={handleDoubleClick}
            >
                <div className="effect-knob-track">
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
                    className="effect-knob-dial"
                    style={{ transform: `rotate(${rotation}deg)` }}
                >
                    <div className="effect-knob-indicator" style={{ backgroundColor: color }} />
                </div>
            </div>
            <div className="effect-knob-value">{formatValue(value)}</div>
        </div>
    );
});

// Filter Effect Component
const FilterEffect = memo(({ deckId, audioEngine, enabled, onToggle }) => {
    const [filterFreq, setFilterFreq] = useState(1000);
    const [filterType, setFilterType] = useState('lowpass');
    const [filterQ, setFilterQ] = useState(1);

    const handleFreqChange = useCallback((value) => {
        // Logarithmic scale: 20Hz to 20kHz
        const minLog = Math.log10(20);
        const maxLog = Math.log10(20000);
        const freq = Math.pow(10, minLog + (maxLog - minLog) * value);
        setFilterFreq(freq);
        audioEngine?.setFilter(deckId, freq, filterType, filterQ);
    }, [deckId, audioEngine, filterType, filterQ]);

    const handleQChange = useCallback((value) => {
        const q = 0.5 + value * 9.5; // 0.5 to 10
        setFilterQ(q);
        audioEngine?.setFilter(deckId, filterFreq, filterType, q);
    }, [deckId, audioEngine, filterFreq, filterType]);

    const handleTypeChange = useCallback((type) => {
        setFilterType(type);
        audioEngine?.setFilter(deckId, filterFreq, type, filterQ);
    }, [deckId, audioEngine, filterFreq, filterQ]);

    const handleToggle = useCallback(() => {
        const newEnabled = !enabled;
        onToggle(deckId, 'filter', newEnabled);
        audioEngine?.setFilterEnabled(deckId, newEnabled);
    }, [deckId, audioEngine, enabled, onToggle]);

    // Normalize freq back to 0-1 for display
    const normalizedFreq = (Math.log10(filterFreq) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20));
    const normalizedQ = (filterQ - 0.5) / 9.5;

    return (
        <div className={`effect-unit ${enabled ? 'active' : ''}`}>
            <div className="effect-header">
                <Filter size={14} />
                <span>FILTER</span>
                <button
                    className={`effect-toggle-btn ${enabled ? 'on' : ''}`}
                    onClick={handleToggle}
                >
                    {enabled ? 'ON' : 'OFF'}
                </button>
            </div>
            <div className="effect-controls">
                <EffectKnob
                    value={normalizedFreq}
                    onChange={handleFreqChange}
                    label="FREQ"
                    color="#3b82f6"
                    formatValue={() => filterFreq < 1000
                        ? `${Math.round(filterFreq)}Hz`
                        : `${(filterFreq / 1000).toFixed(1)}k`}
                    disabled={!enabled}
                />
                <EffectKnob
                    value={normalizedQ}
                    onChange={handleQChange}
                    label="RES"
                    color="#3b82f6"
                    formatValue={() => `${filterQ.toFixed(1)}`}
                    disabled={!enabled}
                />
                <div className="filter-type-selector">
                    <button
                        className={`filter-type-btn ${filterType === 'lowpass' ? 'active' : ''}`}
                        onClick={() => handleTypeChange('lowpass')}
                        disabled={!enabled}
                    >
                        LP
                    </button>
                    <button
                        className={`filter-type-btn ${filterType === 'highpass' ? 'active' : ''}`}
                        onClick={() => handleTypeChange('highpass')}
                        disabled={!enabled}
                    >
                        HP
                    </button>
                    <button
                        className={`filter-type-btn ${filterType === 'bandpass' ? 'active' : ''}`}
                        onClick={() => handleTypeChange('bandpass')}
                        disabled={!enabled}
                    >
                        BP
                    </button>
                </div>
            </div>
        </div>
    );
});

// Delay Effect Component
const DelayEffect = memo(({ deckId, audioEngine, enabled, onToggle, bpm = 120 }) => {
    const [delayTime, setDelayTime] = useState(0.25);
    const [feedback, setFeedback] = useState(0.3);
    const [mix, setMix] = useState(0.5);

    // Sync delay time to BPM
    const beatTimes = {
        '1/4': 60 / bpm / 4,
        '1/2': 60 / bpm / 2,
        '1': 60 / bpm,
        '2': (60 / bpm) * 2,
        '4': (60 / bpm) * 4
    };

    const handleTimeChange = useCallback((value) => {
        // 0.05s to 2s
        const time = 0.05 + value * 1.95;
        setDelayTime(time);
        audioEngine?.setDelay(deckId, time, feedback, mix);
    }, [deckId, audioEngine, feedback, mix]);

    const handleSyncTime = useCallback((division) => {
        const time = beatTimes[division];
        setDelayTime(time);
        audioEngine?.setDelay(deckId, time, feedback, mix);
    }, [deckId, audioEngine, feedback, mix, beatTimes]);

    const handleFeedbackChange = useCallback((value) => {
        setFeedback(value);
        audioEngine?.setDelay(deckId, delayTime, value, mix);
    }, [deckId, audioEngine, delayTime, mix]);

    const handleMixChange = useCallback((value) => {
        setMix(value);
        audioEngine?.setDelay(deckId, delayTime, feedback, value);
    }, [deckId, audioEngine, delayTime, feedback]);

    const handleToggle = useCallback(() => {
        const newEnabled = !enabled;
        onToggle(deckId, 'delay', newEnabled);
        audioEngine?.setDelayEnabled(deckId, newEnabled);
    }, [deckId, audioEngine, enabled, onToggle]);

    const normalizedTime = (delayTime - 0.05) / 1.95;

    return (
        <div className={`effect-unit ${enabled ? 'active' : ''}`}>
            <div className="effect-header">
                <Clock size={14} />
                <span>DELAY</span>
                <button
                    className={`effect-toggle-btn ${enabled ? 'on' : ''}`}
                    onClick={handleToggle}
                >
                    {enabled ? 'ON' : 'OFF'}
                </button>
            </div>
            <div className="effect-controls">
                <EffectKnob
                    value={normalizedTime}
                    onChange={handleTimeChange}
                    label="TIME"
                    color="#10b981"
                    formatValue={() => `${(delayTime * 1000).toFixed(0)}ms`}
                    disabled={!enabled}
                />
                <EffectKnob
                    value={feedback}
                    onChange={handleFeedbackChange}
                    label="FDBK"
                    color="#10b981"
                    disabled={!enabled}
                />
                <EffectKnob
                    value={mix}
                    onChange={handleMixChange}
                    label="MIX"
                    color="#10b981"
                    disabled={!enabled}
                />
            </div>
            <div className="delay-sync-buttons">
                {Object.keys(beatTimes).map(div => (
                    <button
                        key={div}
                        className={`sync-btn ${Math.abs(delayTime - beatTimes[div]) < 0.01 ? 'active' : ''}`}
                        onClick={() => handleSyncTime(div)}
                        disabled={!enabled}
                    >
                        {div}
                    </button>
                ))}
            </div>
        </div>
    );
});

// Main Effects Panel Component
const EffectsPanel = ({ audioEngine, deckATrack, deckBTrack }) => {
    const [effectsState, setEffectsState] = useState({
        A: { filter: false, delay: false },
        B: { filter: false, delay: false }
    });

    const handleEffectToggle = useCallback((deckId, effectType, enabled) => {
        setEffectsState(prev => ({
            ...prev,
            [deckId]: { ...prev[deckId], [effectType]: enabled }
        }));
    }, []);

    const deckABpm = deckATrack?.analysis?.bpm || 120;
    const deckBBpm = deckBTrack?.analysis?.bpm || 120;

    return (
        <div className="effects-panel">
            <div className="effects-panel-header">
                <Waves size={16} />
                <span>EFFECTS</span>
            </div>

            <div className="effects-grid">
                {/* Deck A Effects */}
                <div className="effects-deck">
                    <div className="effects-deck-label">DECK A</div>
                    <FilterEffect
                        deckId="A"
                        audioEngine={audioEngine}
                        enabled={effectsState.A.filter}
                        onToggle={handleEffectToggle}
                    />
                    <DelayEffect
                        deckId="A"
                        audioEngine={audioEngine}
                        enabled={effectsState.A.delay}
                        onToggle={handleEffectToggle}
                        bpm={deckABpm}
                    />
                </div>

                {/* Deck B Effects */}
                <div className="effects-deck">
                    <div className="effects-deck-label">DECK B</div>
                    <FilterEffect
                        deckId="B"
                        audioEngine={audioEngine}
                        enabled={effectsState.B.filter}
                        onToggle={handleEffectToggle}
                    />
                    <DelayEffect
                        deckId="B"
                        audioEngine={audioEngine}
                        enabled={effectsState.B.delay}
                        onToggle={handleEffectToggle}
                        bpm={deckBBpm}
                    />
                </div>
            </div>
        </div>
    );
};

export default memo(EffectsPanel);

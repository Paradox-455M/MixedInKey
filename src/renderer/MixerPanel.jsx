import React, { useState, useCallback, useEffect, useRef, memo } from 'react';
import {
    Sliders, Sparkles, Disc, ChevronDown, ChevronUp,
    Volume2, VolumeX, Filter, Clock, Repeat
} from 'lucide-react';
import audioEngine from './audioEngine';
import './mixerPanel.css';

// ============================================
// EFFECT DEFINITIONS
// ============================================
const EFFECTS = [
    { id: 'filter', name: 'FILTER', color: '#3b82f6', icon: Filter },
    { id: 'echo', name: 'ECHO', color: '#10b981', icon: Clock },
    { id: 'flanger', name: 'FLANGER', color: '#8b5cf6', icon: Filter },
    { id: 'phaser', name: 'PHASER', color: '#ec4899', icon: Filter },
    { id: 'reverb', name: 'REVERB', color: '#f59e0b', icon: Filter },
    { id: 'crush', name: 'CRUSH', color: '#ef4444', icon: Filter }
];

const LOOP_SIZES = [0.5, 1, 2, 4, 8, 16];
const PAD_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];

// ============================================
// KNOB COMPONENT - Reusable rotary control
// ============================================
const Knob = memo(({
    value,
    min = 0,
    max = 1,
    onChange,
    label,
    size = 44,
    color = '#8b5cf6',
    formatValue = (v) => Math.round(v * 100),
    disabled = false,
    defaultValue = 0
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
        if (!disabled) onChange?.(defaultValue);
    };

    return (
        <div className={`mp-knob-wrap ${disabled ? 'disabled' : ''}`}>
            {label && <div className="mp-knob-label">{label}</div>}
            <div
                className="mp-knob"
                style={{ width: size, height: size }}
                onMouseDown={handleMouseDown}
                onDoubleClick={handleDoubleClick}
            >
                <svg viewBox="0 0 100 100" className="mp-knob-track">
                    <circle cx="50" cy="50" r="42" fill="none" stroke="#1f1f23" strokeWidth="8"
                        strokeDasharray="198" strokeDashoffset="66" transform="rotate(135 50 50)" />
                    <circle cx="50" cy="50" r="42" fill="none" stroke={color} strokeWidth="8"
                        strokeDasharray="198" strokeDashoffset={198 - normalizedValue * 198}
                        transform="rotate(135 50 50)" className="mp-knob-fill" />
                </svg>
                <div className="mp-knob-dial" style={{ transform: `rotate(${rotation}deg)` }}>
                    <div className="mp-knob-dot" style={{ background: color }} />
                </div>
            </div>
            <div className="mp-knob-value">{formatValue(value)}</div>
        </div>
    );
});

// ============================================
// CROSSFADER COMPONENT
// ============================================
const Crossfader = memo(({ value, onChange }) => {
    const trackRef = useRef(null);

    const handleMouseDown = (e) => {
        const update = (ev) => {
            if (!trackRef.current) return;
            const rect = trackRef.current.getBoundingClientRect();
            const x = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
            onChange?.(x);
        };

        const handleUp = () => {
            document.removeEventListener('mousemove', update);
            document.removeEventListener('mouseup', handleUp);
        };

        update(e);
        document.addEventListener('mousemove', update);
        document.addEventListener('mouseup', handleUp);
    };

    return (
        <div className="mp-crossfader">
            <span className="mp-cf-label">A</span>
            <div ref={trackRef} className="mp-cf-track" onMouseDown={handleMouseDown}>
                <div className="mp-cf-thumb" style={{ left: `${value * 100}%` }} />
            </div>
            <span className="mp-cf-label">B</span>
        </div>
    );
});

// ============================================
// VOLUME FADER COMPONENT
// ============================================
const VolumeFader = memo(({ value, onChange, color = '#8b5cf6' }) => {
    const trackRef = useRef(null);

    const handleMouseDown = (e) => {
        const update = (ev) => {
            if (!trackRef.current) return;
            const rect = trackRef.current.getBoundingClientRect();
            const y = 1 - Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
            onChange?.(y);
        };

        const handleUp = () => {
            document.removeEventListener('mousemove', update);
            document.removeEventListener('mouseup', handleUp);
        };

        update(e);
        document.addEventListener('mousemove', update);
        document.addEventListener('mouseup', handleUp);
    };

    return (
        <div className="mp-vfader">
            <div ref={trackRef} className="mp-vfader-track" onMouseDown={handleMouseDown}>
                <div className="mp-vfader-fill" style={{ height: `${value * 100}%`, background: color }} />
                <div className="mp-vfader-thumb" style={{ bottom: `${value * 100}%` }} />
            </div>
        </div>
    );
});

// ============================================
// VU METER COMPONENT
// ============================================
const VUMeter = memo(({ level }) => {
    const segments = 10;
    const active = Math.round(level * segments);

    return (
        <div className="mp-vu">
            {Array.from({ length: segments }).map((_, i) => {
                const isOn = i < active;
                let color = '#10b981';
                if (i >= 8) color = '#ef4444';
                else if (i >= 6) color = '#f59e0b';
                return <div key={i} className={`mp-vu-seg ${isOn ? 'on' : ''}`}
                    style={{ background: isOn ? color : undefined }} />;
            })}
        </div>
    );
});

// ============================================
// KILL BUTTON COMPONENT
// ============================================
const KillButton = memo(({ active, onClick, label }) => (
    <button className={`mp-kill-btn ${active ? 'active' : ''}`} onClick={onClick}>
        {active ? <VolumeX size={10} /> : label}
    </button>
));

// ============================================
// EQ STRIP COMPONENT (Single Deck)
// ============================================
const EQStrip = memo(({
    deckId, eqValues, kills, volume, level,
    onEQChange, onKillToggle, onVolumeChange
}) => {
    const color = deckId === 'A' ? '#8b5cf6' : '#ec4899';

    return (
        <div className="mp-eq-strip">
            <div className="mp-eq-header">DECK {deckId}</div>
            <div className="mp-eq-knobs">
                <div className="mp-eq-row">
                    <Knob value={eqValues.high} min={-24} max={12} defaultValue={0}
                        onChange={(v) => onEQChange(deckId, 'high', v)}
                        label="HI" size={38} color="#3b82f6" disabled={kills.high}
                        formatValue={(v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}`} />
                    <KillButton active={kills.high} onClick={() => onKillToggle(deckId, 'high')} label="H" />
                </div>
                <div className="mp-eq-row">
                    <Knob value={eqValues.mid} min={-24} max={12} defaultValue={0}
                        onChange={(v) => onEQChange(deckId, 'mid', v)}
                        label="MID" size={38} color="#10b981" disabled={kills.mid}
                        formatValue={(v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}`} />
                    <KillButton active={kills.mid} onClick={() => onKillToggle(deckId, 'mid')} label="M" />
                </div>
                <div className="mp-eq-row">
                    <Knob value={eqValues.low} min={-24} max={12} defaultValue={0}
                        onChange={(v) => onEQChange(deckId, 'low', v)}
                        label="LOW" size={38} color="#ef4444" disabled={kills.low}
                        formatValue={(v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}`} />
                    <KillButton active={kills.low} onClick={() => onKillToggle(deckId, 'low')} label="L" />
                </div>
            </div>
            <div className="mp-eq-output">
                <VUMeter level={level} />
                <VolumeFader value={volume} onChange={(v) => onVolumeChange(deckId, v)} color={color} />
            </div>
        </div>
    );
});

// ============================================
// MIXER TAB CONTENT
// ============================================
const MixerTab = memo(({
    eqA, eqB, killsA, killsB, volumeA, volumeB, crossfader, levelA, levelB,
    onEQChange, onKillToggle, onVolumeChange, onCrossfaderChange
}) => {
    return (
        <div className="mp-mixer-tab">
            <EQStrip deckId="A" eqValues={eqA} kills={killsA} volume={volumeA} level={levelA}
                onEQChange={onEQChange} onKillToggle={onKillToggle} onVolumeChange={onVolumeChange} />

            <div className="mp-mixer-center">
                <div className="mp-master-label">MASTER</div>
                <Crossfader value={crossfader} onChange={onCrossfaderChange} />
            </div>

            <EQStrip deckId="B" eqValues={eqB} kills={killsB} volume={volumeB} level={levelB}
                onEQChange={onEQChange} onKillToggle={onKillToggle} onVolumeChange={onVolumeChange} />
        </div>
    );
});

// ============================================
// EFFECT UNIT COMPONENT
// ============================================
const EffectUnit = memo(({ effect, enabled, value, onToggle, onChange }) => {
    return (
        <div className={`mp-effect-unit ${enabled ? 'active' : ''}`} style={{ '--fx-color': effect.color }}>
            <button className={`mp-fx-power ${enabled ? 'on' : ''}`} onClick={onToggle}>
                <div className="mp-fx-power-dot" />
            </button>
            <div className="mp-fx-label">{effect.name}</div>
            <Knob
                value={value}
                min={0}
                max={1}
                defaultValue={0.5}
                onChange={onChange}
                label=""
                size={40}
                color={effect.color}
                disabled={!enabled}
                formatValue={(v) => Math.round(v * 100)}
            />
        </div>
    );
});

// ============================================
// EFFECTS TAB CONTENT
// ============================================
const EffectsTab = memo(({ effectsA, effectsB, onEffectToggle, onEffectChange }) => {
    const DeckEffects = ({ deckId, effects }) => (
        <div className="mp-fx-deck">
            <div className="mp-fx-deck-header">DECK {deckId}</div>
            <div className="mp-fx-grid">
                {EFFECTS.map(fx => (
                    <EffectUnit
                        key={fx.id}
                        effect={fx}
                        enabled={effects[fx.id].enabled}
                        value={effects[fx.id].value}
                        onToggle={() => onEffectToggle(deckId, fx.id)}
                        onChange={(v) => onEffectChange(deckId, fx.id, v)}
                    />
                ))}
            </div>
        </div>
    );

    return (
        <div className="mp-fx-tab">
            <DeckEffects deckId="A" effects={effectsA} />
            <DeckEffects deckId="B" effects={effectsB} />
        </div>
    );
});

// ============================================
// PERFORMANCE TAB CONTENT
// ============================================
const PerformanceTab = memo(({
    deckARef, deckBRef, bpmA, bpmB,
    loopA, loopB, cuesA, cuesB,
    onLoopChange, onCuesChange
}) => {
    const PerformanceDeck = ({ deckId, loop, cues, bpm, deckRef }) => {
        const beatDuration = 60 / bpm;
        const getAudioElement = () => deckRef?.current?.getAudioElement?.();

        // Loop enforcement
        useEffect(() => {
            const audioEl = getAudioElement();
            if (!audioEl || !loop.active || loop.start === null || loop.end === null) return;
            const check = () => {
                if (audioEl.currentTime >= loop.end) {
                    audioEl.currentTime = loop.start;
                }
            };
            const interval = setInterval(check, 10);
            return () => clearInterval(interval);
        }, [loop.active, loop.start, loop.end]);

        const handleSetLoop = (size) => {
            const audioEl = getAudioElement();
            if (!audioEl) return;
            const loopDuration = size * beatDuration;
            const start = audioEl.currentTime;
            const end = start + loopDuration;
            onLoopChange(deckId, { active: true, start, end, size });
        };

        const handleToggleLoop = () => {
            if (loop.start !== null && loop.end !== null) {
                onLoopChange(deckId, { ...loop, active: !loop.active });
            }
        };

        const handleClearLoop = () => {
            onLoopChange(deckId, { active: false, start: null, end: null, size: 4 });
        };

        const handleSetCue = (idx) => {
            const audioEl = getAudioElement();
            if (!audioEl) return;
            const newCues = [...cues];
            newCues[idx] = { time: audioEl.currentTime, color: PAD_COLORS[idx] };
            onCuesChange(deckId, newCues);
        };

        const handleTriggerCue = (idx) => {
            const audioEl = getAudioElement();
            if (!audioEl || !cues[idx]) return;
            audioEl.currentTime = cues[idx].time;
        };

        const handleDeleteCue = (idx) => {
            const newCues = [...cues];
            newCues[idx] = null;
            onCuesChange(deckId, newCues);
        };

        const formatTime = (s) => {
            if (s === null || s === undefined) return '--:--';
            const mins = Math.floor(s / 60);
            const secs = Math.floor(s % 60);
            const ms = Math.floor((s % 1) * 10);
            return `${mins}:${secs.toString().padStart(2, '0')}.${ms}`;
        };

        return (
            <div className="mp-perf-deck">
                <div className="mp-perf-deck-label">DECK {deckId}</div>

                {/* Loop Controls */}
                <div className="mp-loop-section">
                    <div className="mp-loop-header">
                        <Repeat size={12} />
                        <span>LOOP</span>
                        {loop.active && <span className="mp-loop-badge">{loop.size} beats</span>}
                    </div>
                    <div className="mp-loop-sizes">
                        {LOOP_SIZES.map(size => (
                            <button key={size}
                                className={`mp-loop-btn ${loop.size === size && loop.active ? 'active' : ''}`}
                                onClick={() => handleSetLoop(size)}>
                                {size < 1 ? `1/${Math.round(1/size)}` : size}
                            </button>
                        ))}
                    </div>
                    <div className="mp-loop-actions">
                        <button className={`mp-loop-toggle ${loop.active ? 'active' : ''}`}
                            onClick={handleToggleLoop} disabled={loop.start === null}>
                            <Repeat size={14} />
                        </button>
                        <button className="mp-loop-clear" onClick={handleClearLoop}
                            disabled={loop.start === null}>CLR</button>
                    </div>
                </div>

                {/* Hot Cues */}
                <div className="mp-cues-section">
                    <div className="mp-cues-header">
                        <span>HOT CUES</span>
                        <span className="mp-cues-count">{cues.filter(Boolean).length}/8</span>
                    </div>
                    <div className="mp-cue-grid">
                        {cues.map((cue, idx) => (
                            <button key={idx}
                                className={`mp-cue-pad ${cue ? 'set' : ''}`}
                                style={{ '--pad-color': PAD_COLORS[idx] }}
                                onClick={() => cue ? handleTriggerCue(idx) : handleSetCue(idx)}
                                onContextMenu={(e) => { e.preventDefault(); handleDeleteCue(idx); }}
                                title={cue ? `${formatTime(cue.time)} - Right-click to delete` : `Set Cue ${idx + 1}`}>
                                <span className="mp-cue-num">{idx + 1}</span>
                                {cue && <span className="mp-cue-time">{formatTime(cue.time)}</span>}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="mp-perf-tab">
            <PerformanceDeck deckId="A" loop={loopA} cues={cuesA} bpm={bpmA} deckRef={deckARef} />
            <PerformanceDeck deckId="B" loop={loopB} cues={cuesB} bpm={bpmB} deckRef={deckBRef} />
        </div>
    );
});

// ============================================
// MAIN MIXER PANEL COMPONENT
// All state is lifted here to persist across tab switches
// ============================================
const MixerPanel = ({ deckARef, deckBRef, deckATrack, deckBTrack }) => {
    const [expanded, setExpanded] = useState(true);
    const [activeTab, setActiveTab] = useState('mixer');

    // ========== MIXER STATE (persisted) ==========
    const [eqA, setEqA] = useState({ low: 0, mid: 0, high: 0 });
    const [eqB, setEqB] = useState({ low: 0, mid: 0, high: 0 });
    const [killsA, setKillsA] = useState({ low: false, mid: false, high: false });
    const [killsB, setKillsB] = useState({ low: false, mid: false, high: false });
    const [volumeA, setVolumeA] = useState(1);
    const [volumeB, setVolumeB] = useState(1);
    const [crossfader, setCrossfader] = useState(0.5);
    const [levelA, setLevelA] = useState(0);
    const [levelB, setLevelB] = useState(0);

    // ========== EFFECTS STATE (persisted) ==========
    const [effectsA, setEffectsA] = useState(() =>
        EFFECTS.reduce((acc, fx) => ({ ...acc, [fx.id]: { enabled: false, value: 0.5 } }), {})
    );
    const [effectsB, setEffectsB] = useState(() =>
        EFFECTS.reduce((acc, fx) => ({ ...acc, [fx.id]: { enabled: false, value: 0.5 } }), {})
    );

    // ========== PERFORMANCE STATE (persisted) ==========
    const [loopA, setLoopA] = useState({ active: false, start: null, end: null, size: 4 });
    const [loopB, setLoopB] = useState({ active: false, start: null, end: null, size: 4 });
    const [cuesA, setCuesA] = useState(new Array(8).fill(null));
    const [cuesB, setCuesB] = useState(new Array(8).fill(null));

    const bpmA = deckATrack?.analysis?.bpm || 120;
    const bpmB = deckBTrack?.analysis?.bpm || 120;

    // ========== VU METER UPDATES ==========
    useEffect(() => {
        const interval = setInterval(() => {
            setLevelA(audioEngine.getLevel('A'));
            setLevelB(audioEngine.getLevel('B'));
        }, 50);
        return () => clearInterval(interval);
    }, []);

    // ========== MIXER HANDLERS ==========
    const handleEQChange = useCallback((deckId, band, value) => {
        if (deckId === 'A') setEqA(prev => ({ ...prev, [band]: value }));
        else setEqB(prev => ({ ...prev, [band]: value }));
        audioEngine.setEQ(deckId, band, value);
    }, []);

    const handleKillToggle = useCallback((deckId, band) => {
        if (deckId === 'A') {
            setKillsA(prev => {
                const newKills = { ...prev, [band]: !prev[band] };
                audioEngine.setEQKill(deckId, band, newKills[band]);
                return newKills;
            });
        } else {
            setKillsB(prev => {
                const newKills = { ...prev, [band]: !prev[band] };
                audioEngine.setEQKill(deckId, band, newKills[band]);
                return newKills;
            });
        }
    }, []);

    const handleVolumeChange = useCallback((deckId, value) => {
        if (deckId === 'A') setVolumeA(value);
        else setVolumeB(value);
        audioEngine.setVolume(deckId, value);
    }, []);

    const handleCrossfaderChange = useCallback((value) => {
        setCrossfader(value);
        audioEngine.setCrossfader(value);
    }, []);

    // ========== EFFECTS HANDLERS ==========
    const applyEffect = useCallback((deckId, effectId, enabled, value, bpm) => {
        switch (effectId) {
            case 'filter':
                if (enabled) {
                    const freq = 20 * Math.pow(1000, value);
                    audioEngine.setFilter(deckId, freq, 'lowpass', 1 + value * 4);
                }
                audioEngine.setFilterEnabled?.(deckId, enabled);
                break;
            case 'echo':
                if (enabled) {
                    const beatDuration = 60 / bpm;
                    const delayTime = beatDuration * (0.25 + value * 1.75);
                    audioEngine.setDelay?.(deckId, delayTime, 0.2 + value * 0.5, 0.3 + value * 0.4);
                }
                audioEngine.setDelayEnabled?.(deckId, enabled);
                break;
            default:
                break;
        }
    }, []);

    const handleEffectToggle = useCallback((deckId, effectId) => {
        const setEffects = deckId === 'A' ? setEffectsA : setEffectsB;
        const effects = deckId === 'A' ? effectsA : effectsB;
        const bpm = deckId === 'A' ? bpmA : bpmB;

        setEffects(prev => {
            const newEnabled = !prev[effectId].enabled;
            applyEffect(deckId, effectId, newEnabled, prev[effectId].value, bpm);
            return { ...prev, [effectId]: { ...prev[effectId], enabled: newEnabled } };
        });
    }, [effectsA, effectsB, bpmA, bpmB, applyEffect]);

    const handleEffectChange = useCallback((deckId, effectId, value) => {
        const setEffects = deckId === 'A' ? setEffectsA : setEffectsB;
        const effects = deckId === 'A' ? effectsA : effectsB;
        const bpm = deckId === 'A' ? bpmA : bpmB;

        setEffects(prev => {
            if (prev[effectId].enabled) {
                applyEffect(deckId, effectId, true, value, bpm);
            }
            return { ...prev, [effectId]: { ...prev[effectId], value } };
        });
    }, [effectsA, effectsB, bpmA, bpmB, applyEffect]);

    // ========== PERFORMANCE HANDLERS ==========
    const handleLoopChange = useCallback((deckId, loop) => {
        if (deckId === 'A') setLoopA(loop);
        else setLoopB(loop);
    }, []);

    const handleCuesChange = useCallback((deckId, cues) => {
        if (deckId === 'A') setCuesA(cues);
        else setCuesB(cues);
    }, []);

    const tabs = [
        { id: 'mixer', label: 'Mixer', icon: Sliders },
        { id: 'effects', label: 'FX', icon: Sparkles },
        { id: 'performance', label: 'Performance', icon: Disc }
    ];

    return (
        <div className={`mixer-panel ${expanded ? 'expanded' : 'collapsed'}`}>
            {/* Tab Bar */}
            <div className="mp-tab-bar">
                <div className="mp-tabs">
                    {tabs.map(tab => (
                        <button key={tab.id}
                            className={`mp-tab ${activeTab === tab.id ? 'active' : ''}`}
                            onClick={() => { setActiveTab(tab.id); setExpanded(true); }}>
                            <tab.icon size={14} />
                            <span>{tab.label}</span>
                        </button>
                    ))}
                </div>
                <button className="mp-collapse-btn" onClick={() => setExpanded(!expanded)}>
                    {expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                </button>
            </div>

            {/* Tab Content */}
            {expanded && (
                <div className="mp-content">
                    {activeTab === 'mixer' && (
                        <MixerTab
                            eqA={eqA} eqB={eqB}
                            killsA={killsA} killsB={killsB}
                            volumeA={volumeA} volumeB={volumeB}
                            crossfader={crossfader}
                            levelA={levelA} levelB={levelB}
                            onEQChange={handleEQChange}
                            onKillToggle={handleKillToggle}
                            onVolumeChange={handleVolumeChange}
                            onCrossfaderChange={handleCrossfaderChange}
                        />
                    )}
                    {activeTab === 'effects' && (
                        <EffectsTab
                            effectsA={effectsA}
                            effectsB={effectsB}
                            onEffectToggle={handleEffectToggle}
                            onEffectChange={handleEffectChange}
                        />
                    )}
                    {activeTab === 'performance' && (
                        <PerformanceTab
                            deckARef={deckARef}
                            deckBRef={deckBRef}
                            bpmA={bpmA}
                            bpmB={bpmB}
                            loopA={loopA}
                            loopB={loopB}
                            cuesA={cuesA}
                            cuesB={cuesB}
                            onLoopChange={handleLoopChange}
                            onCuesChange={handleCuesChange}
                        />
                    )}
                </div>
            )}
        </div>
    );
};

export default memo(MixerPanel);

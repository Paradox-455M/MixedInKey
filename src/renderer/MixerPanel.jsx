import React, { useState, useCallback, useEffect, useRef, memo } from 'react';
import {
    Sliders, Sparkles, Disc, ChevronDown, ChevronUp,
    Volume2, VolumeX, Filter, Clock, Repeat, Activity, Save, HardDrive
} from 'lucide-react';
import audioEngine from './audioEngine';
import BeatJumpControls from './BeatJumpControls';
import SpectrumAnalyzer, { FrequencyBands } from './SpectrumAnalyzer';
import LUFSMeter, { LUFSMeterHorizontal } from './LUFSMeter';
import TempoControl from './TempoControl';
import SyncControl from './SyncControl';
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

// ============================================
// EFFECT PRESETS
// ============================================
const EFFECT_PRESETS = [
    {
        id: 'clean',
        name: 'Clean',
        description: 'No effects',
        effects: {}
    },
    {
        id: 'dub',
        name: 'Dub Echo',
        description: 'Classic dub delay',
        effects: { echo: { enabled: true, value: 0.6 } }
    },
    {
        id: 'space',
        name: 'Space Out',
        description: 'Reverb + Phaser',
        effects: {
            reverb: { enabled: true, value: 0.5 },
            phaser: { enabled: true, value: 0.4 }
        }
    },
    {
        id: 'sweep',
        name: 'Filter Sweep',
        description: 'Filter ready for sweep',
        effects: { filter: { enabled: true, value: 0.3 } }
    },
    {
        id: 'jet',
        name: 'Jet Flanger',
        description: 'Classic jet sound',
        effects: { flanger: { enabled: true, value: 0.7 } }
    },
    {
        id: 'lofi',
        name: 'Lo-Fi',
        description: 'Crushed + filtered',
        effects: {
            crush: { enabled: true, value: 0.5 },
            filter: { enabled: true, value: 0.4 }
        }
    },
    {
        id: 'buildup',
        name: 'Build Up',
        description: 'Echo + Reverb for drops',
        effects: {
            echo: { enabled: true, value: 0.4 },
            reverb: { enabled: true, value: 0.3 }
        }
    }
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
    size = 36,  // Reduced from 44 for compact layout
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
                        label="HI" size={34} color="#3b82f6" disabled={kills.high}
                        formatValue={(v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}`} />
                    <KillButton active={kills.high} onClick={() => onKillToggle(deckId, 'high')} label="H" />
                </div>
                <div className="mp-eq-row">
                    <Knob value={eqValues.mid} min={-24} max={12} defaultValue={0}
                        onChange={(v) => onEQChange(deckId, 'mid', v)}
                        label="MID" size={34} color="#10b981" disabled={kills.mid}
                        formatValue={(v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}`} />
                    <KillButton active={kills.mid} onClick={() => onKillToggle(deckId, 'mid')} label="M" />
                </div>
                <div className="mp-eq-row">
                    <Knob value={eqValues.low} min={-24} max={12} defaultValue={0}
                        onChange={(v) => onEQChange(deckId, 'low', v)}
                        label="LOW" size={34} color="#ef4444" disabled={kills.low}
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
    onEQChange, onKillToggle, onVolumeChange, onCrossfaderChange,
    // Sync props
    deckARef, deckBRef, bpmA, bpmB, downbeatsA, downbeatsB, onTempoChange
}) => {
    return (
        <div className="mp-mixer-tab">
            <EQStrip deckId="A" eqValues={eqA} kills={killsA} volume={volumeA} level={levelA}
                onEQChange={onEQChange} onKillToggle={onKillToggle} onVolumeChange={onVolumeChange} />

            <div className="mp-mixer-center">
                <SyncControl
                    deckARef={deckARef}
                    deckBRef={deckBRef}
                    bpmA={bpmA}
                    bpmB={bpmB}
                    downbeatsA={downbeatsA}
                    downbeatsB={downbeatsB}
                    onTempoChange={onTempoChange}
                />
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
                size={32}
                color={effect.color}
                disabled={!enabled}
                formatValue={(v) => Math.round(v * 100)}
            />
        </div>
    );
});

// ============================================
// PRESET SELECTOR COMPONENT
// ============================================
const PresetSelector = memo(({ currentPreset, onSelectPreset, deckId }) => (
    <div className="mp-preset-selector">
        <label className="mp-preset-label">PRESET</label>
        <select
            className="mp-preset-dropdown"
            value={currentPreset}
            onChange={(e) => onSelectPreset(deckId, e.target.value)}
        >
            {EFFECT_PRESETS.map(preset => (
                <option key={preset.id} value={preset.id}>
                    {preset.name}
                </option>
            ))}
        </select>
    </div>
));

// ============================================
// EFFECTS TAB CONTENT
// ============================================
const EffectsTab = memo(({
    effectsA, effectsB,
    presetA, presetB,
    onEffectToggle, onEffectChange, onSelectPreset
}) => {
    const DeckEffects = ({ deckId, effects, preset }) => (
        <div className="mp-fx-deck">
            <div className="mp-fx-deck-header">
                <span>DECK {deckId}</span>
                <PresetSelector
                    currentPreset={preset}
                    onSelectPreset={onSelectPreset}
                    deckId={deckId}
                />
            </div>
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
            <DeckEffects deckId="A" effects={effectsA} preset={presetA} />
            <DeckEffects deckId="B" effects={effectsB} preset={presetB} />
        </div>
    );
});

// ============================================
// PERFORMANCE DECK COMPONENT (extracted for stability)
// ============================================
const PerformanceDeck = memo(({
    deckId, loop, cues, bpm, deckRef, downbeats,
    onLoopChange, onCuesChange, onSaveCues, hasSavedCues
}) => {
    const [saveStatus, setSaveStatus] = useState(null); // 'saving' | 'saved' | null
    const beatDuration = 60 / bpm;

    // Use ref to store latest audio element getter to avoid stale closures
    const audioElRef = useRef(null);

    // Stable getter function that updates the ref
    const getAudioElement = useCallback(() => {
        const el = deckRef?.current?.getAudioElement?.();
        audioElRef.current = el;
        return el;
    }, [deckRef]);

    const getCurrentTime = useCallback(() => {
        return deckRef?.current?.getCurrentTime?.() || 0;
    }, [deckRef]);

    // Beat jump handler
    const handleBeatJump = useCallback((jumpSeconds) => {
        deckRef?.current?.seek?.(jumpSeconds);
    }, [deckRef]);

    // Loop enforcement with proper dependencies
    useEffect(() => {
        if (!loop.active || loop.start === null || loop.end === null) return;

        const check = () => {
            const audioEl = getAudioElement();
            if (!audioEl) return;
            if (audioEl.currentTime >= loop.end) {
                audioEl.currentTime = loop.start;
            }
        };

        // Run immediately and then on interval
        check();
        const interval = setInterval(check, 16); // ~60fps for smoother loop
        return () => clearInterval(interval);
    }, [loop.active, loop.start, loop.end, getAudioElement]);

    const handleSetLoop = useCallback((size) => {
        const audioEl = getAudioElement();
        if (!audioEl) {
            console.warn(`[MixerPanel] Deck ${deckId}: No audio element for loop`);
            return;
        }
        const loopDuration = size * beatDuration;
        const start = audioEl.currentTime;
        const end = start + loopDuration;
        onLoopChange(deckId, { active: true, start, end, size });
    }, [deckId, beatDuration, getAudioElement, onLoopChange]);

    const handleToggleLoop = useCallback(() => {
        if (loop.start !== null && loop.end !== null) {
            onLoopChange(deckId, { ...loop, active: !loop.active });
        }
    }, [deckId, loop, onLoopChange]);

    const handleClearLoop = useCallback(() => {
        onLoopChange(deckId, { active: false, start: null, end: null, size: 4 });
    }, [deckId, onLoopChange]);

    const handleSetCue = useCallback((idx) => {
        const audioEl = getAudioElement();
        if (!audioEl) {
            console.warn(`[MixerPanel] Deck ${deckId}: No audio element for cue`);
            return;
        }
        const newCues = [...cues];
        newCues[idx] = { time: audioEl.currentTime, color: PAD_COLORS[idx] };
        onCuesChange(deckId, newCues);
    }, [deckId, cues, getAudioElement, onCuesChange]);

    const handleTriggerCue = useCallback((idx) => {
        const audioEl = getAudioElement();
        if (!audioEl || !cues[idx]) {
            console.warn(`[MixerPanel] Deck ${deckId}: Cannot trigger cue - no audio or cue`);
            return;
        }
        audioEl.currentTime = cues[idx].time;
    }, [deckId, cues, getAudioElement]);

    const handleDeleteCue = useCallback((idx) => {
        const newCues = [...cues];
        newCues[idx] = null;
        onCuesChange(deckId, newCues);
    }, [deckId, cues, onCuesChange]);

    // Track click state for distinguishing single vs double click
    const clickTimeoutRef = useRef(null);
    const handleCuePadClick = useCallback((idx, cue) => {
        // Clear any pending single-click action
        if (clickTimeoutRef.current) {
            clearTimeout(clickTimeoutRef.current);
            clickTimeoutRef.current = null;
        }

        if (!cue) {
            // Empty pad - set cue immediately
            handleSetCue(idx);
        } else {
            // Pad has cue - delay to check for double-click
            clickTimeoutRef.current = setTimeout(() => {
                handleTriggerCue(idx);
                clickTimeoutRef.current = null;
            }, 200); // 200ms window for double-click
        }
    }, [handleSetCue, handleTriggerCue]);

    const handleCuePadDoubleClick = useCallback((idx, cue) => {
        // Cancel the pending single-click trigger
        if (clickTimeoutRef.current) {
            clearTimeout(clickTimeoutRef.current);
            clickTimeoutRef.current = null;
        }
        // Delete the cue
        if (cue) {
            handleDeleteCue(idx);
        }
    }, [handleDeleteCue]);

    const formatTime = (s) => {
        if (s === null || s === undefined) return '--:--';
        const mins = Math.floor(s / 60);
        const secs = Math.floor(s % 60);
        const ms = Math.floor((s % 1) * 10);
        return `${mins}:${secs.toString().padStart(2, '0')}.${ms}`;
    };

    const handleSave = useCallback(() => {
        setSaveStatus('saving');
        const success = onSaveCues?.(deckId);
        if (success) {
            setSaveStatus('saved');
            setTimeout(() => setSaveStatus(null), 2000);
        } else {
            setSaveStatus(null);
        }
    }, [deckId, onSaveCues]);

    const hasCuesOrLoop = cues.some(Boolean) || (loop.start !== null && loop.end !== null);

    return (
        <div className="mp-perf-deck">
            <div className="mp-perf-deck-header">
                <span className="mp-perf-deck-label">DECK {deckId}</span>
                {hasSavedCues && (
                    <span className="mp-memory-badge" title="Has saved memory cues">
                        <HardDrive size={10} /> MEM
                    </span>
                )}
            </div>

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
                            onClick={() => handleCuePadClick(idx, cue)}
                            onDoubleClick={() => handleCuePadDoubleClick(idx, cue)}
                            onContextMenu={(e) => { e.preventDefault(); handleDeleteCue(idx); }}
                            title={cue ? `${formatTime(cue.time)} - Double-click or right-click to delete` : `Set Cue ${idx + 1}`}>
                            <span className="mp-cue-num">{idx + 1}</span>
                            {cue && <span className="mp-cue-time">{formatTime(cue.time)}</span>}
                        </button>
                    ))}
                </div>
                {/* Save to Memory Button */}
                <button
                    className={`mp-save-cues-btn ${saveStatus || ''} ${hasSavedCues ? 'has-saved' : ''}`}
                    onClick={handleSave}
                    disabled={!hasCuesOrLoop || saveStatus === 'saving'}
                    title={hasSavedCues ? 'Update saved cues' : 'Save cues to memory'}
                >
                    <Save size={12} />
                    <span>
                        {saveStatus === 'saving' ? 'Saving...' :
                         saveStatus === 'saved' ? 'Saved!' :
                         hasSavedCues ? 'Update' : 'Save to Memory'}
                    </span>
                </button>
            </div>

            {/* Beat Jump Controls */}
            <BeatJumpControls
                bpm={bpm}
                onJump={handleBeatJump}
                downbeats={downbeats}
                currentTime={getCurrentTime()}
            />
        </div>
    );
});

// ============================================
// PERFORMANCE TAB CONTENT
// ============================================
const PerformanceTab = memo(({
    deckARef, deckBRef, bpmA, bpmB,
    loopA, loopB, cuesA, cuesB,
    onLoopChange, onCuesChange,
    onSaveCues, hasSavedCuesA, hasSavedCuesB,
    downbeatsA, downbeatsB
}) => {
    return (
        <div className="mp-perf-tab">
            <PerformanceDeck
                deckId="A"
                loop={loopA}
                cues={cuesA}
                bpm={bpmA}
                deckRef={deckARef}
                downbeats={downbeatsA}
                onLoopChange={onLoopChange}
                onCuesChange={onCuesChange}
                onSaveCues={onSaveCues}
                hasSavedCues={hasSavedCuesA}
            />
            <PerformanceDeck
                deckId="B"
                loop={loopB}
                cues={cuesB}
                bpm={bpmB}
                deckRef={deckBRef}
                downbeats={downbeatsB}
                onLoopChange={onLoopChange}
                onCuesChange={onCuesChange}
                onSaveCues={onSaveCues}
                hasSavedCues={hasSavedCuesB}
            />
        </div>
    );
});

// ============================================
// METERS TAB CONTENT - Spectrum, LUFS, Tempo
// ============================================
const MetersTab = memo(({ deckARef, deckBRef, bpmA, bpmB }) => {
    const [tempoA, setTempoA] = useState(0);
    const [tempoB, setTempoB] = useState(0);

    const handleTempoChangeA = useCallback((actualBpm, playbackRate) => {
        // Tempo changed on deck A
    }, []);

    const handleTempoChangeB = useCallback((actualBpm, playbackRate) => {
        // Tempo changed on deck B
    }, []);

    return (
        <div className="mp-meters-tab">
            <div className="mp-meters-deck">
                <div className="mp-meters-deck-header">DECK A</div>
                <div className="mp-meters-row">
                    <div className="mp-meter-section">
                        <div className="mp-meter-label">SPECTRUM</div>
                        <SpectrumAnalyzer
                            deckId="A"
                            width={180}
                            height={50}
                            barCount={24}
                            showLabels={false}
                            colorScheme="default"
                        />
                    </div>
                    <div className="mp-meter-section">
                        <div className="mp-meter-label">LUFS</div>
                        <LUFSMeterHorizontal deckId="A" width={120} height={16} />
                    </div>
                </div>
                <div className="mp-meters-tempo">
                    <TempoControl
                        deckId="A"
                        baseBpm={bpmA}
                        deckRef={deckARef}
                        onTempoChange={handleTempoChangeA}
                        compact={true}
                    />
                </div>
            </div>

            <div className="mp-meters-divider" />

            <div className="mp-meters-deck">
                <div className="mp-meters-deck-header">DECK B</div>
                <div className="mp-meters-row">
                    <div className="mp-meter-section">
                        <div className="mp-meter-label">SPECTRUM</div>
                        <SpectrumAnalyzer
                            deckId="B"
                            width={180}
                            height={50}
                            barCount={24}
                            showLabels={false}
                            colorScheme="default"
                        />
                    </div>
                    <div className="mp-meter-section">
                        <div className="mp-meter-label">LUFS</div>
                        <LUFSMeterHorizontal deckId="B" width={120} height={16} />
                    </div>
                </div>
                <div className="mp-meters-tempo">
                    <TempoControl
                        deckId="B"
                        baseBpm={bpmB}
                        deckRef={deckBRef}
                        onTempoChange={handleTempoChangeB}
                        compact={true}
                    />
                </div>
            </div>
        </div>
    );
});

// ============================================
// MAIN MIXER PANEL COMPONENT
// All state is lifted here to persist across tab switches
// ============================================
const MixerPanel = ({
    deckARef, deckBRef, deckATrack, deckBTrack,
    // Performance state lifted to parent (DJMixView) for sharing with DJDeck
    loopA, loopB, cuesA, cuesB,
    onLoopChange, onCuesChange,
    // Memory cues
    onSaveCues, hasSavedCuesA, hasSavedCuesB
}) => {
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
    const [presetA, setPresetA] = useState('clean');
    const [presetB, setPresetB] = useState('clean');

    // Performance state is now received from props (loopA, loopB, cuesA, cuesB)

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
        // Use the unified setEffect method for all effects
        audioEngine.setEffect(deckId, effectId, { enabled, value, bpm });
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

    const handleSelectPreset = useCallback((deckId, presetId) => {
        const preset = EFFECT_PRESETS.find(p => p.id === presetId);
        if (!preset) return;

        const setEffects = deckId === 'A' ? setEffectsA : setEffectsB;
        const setPreset = deckId === 'A' ? setPresetA : setPresetB;
        const bpm = deckId === 'A' ? bpmA : bpmB;

        // Update preset selection
        setPreset(presetId);

        // Build new effects state from preset
        setEffects(prev => {
            const newEffects = { ...prev };

            // First, disable all effects
            EFFECTS.forEach(fx => {
                newEffects[fx.id] = { enabled: false, value: 0.5 };
                applyEffect(deckId, fx.id, false, 0.5, bpm);
            });

            // Then, apply preset effects
            Object.entries(preset.effects).forEach(([effectId, settings]) => {
                newEffects[effectId] = {
                    enabled: settings.enabled,
                    value: settings.value
                };
                applyEffect(deckId, effectId, settings.enabled, settings.value, bpm);
            });

            return newEffects;
        });
    }, [bpmA, bpmB, applyEffect]);

    // Performance handlers now come from props (onLoopChange, onCuesChange)

    const tabs = [
        { id: 'mixer', label: 'Mixer', icon: Sliders },
        { id: 'effects', label: 'FX', icon: Sparkles },
        { id: 'performance', label: 'Performance', icon: Disc },
        { id: 'meters', label: 'Meters', icon: Activity }
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
                            deckARef={deckARef}
                            deckBRef={deckBRef}
                            bpmA={bpmA}
                            bpmB={bpmB}
                            downbeatsA={deckATrack?.analysis?.downbeats || []}
                            downbeatsB={deckBTrack?.analysis?.downbeats || []}
                        />
                    )}
                    {activeTab === 'effects' && (
                        <EffectsTab
                            effectsA={effectsA}
                            effectsB={effectsB}
                            presetA={presetA}
                            presetB={presetB}
                            onEffectToggle={handleEffectToggle}
                            onEffectChange={handleEffectChange}
                            onSelectPreset={handleSelectPreset}
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
                            onLoopChange={onLoopChange}
                            onCuesChange={onCuesChange}
                            onSaveCues={onSaveCues}
                            hasSavedCuesA={hasSavedCuesA}
                            hasSavedCuesB={hasSavedCuesB}
                            downbeatsA={deckATrack?.analysis?.downbeats || []}
                            downbeatsB={deckBTrack?.analysis?.downbeats || []}
                        />
                    )}
                    {activeTab === 'meters' && (
                        <MetersTab
                            deckARef={deckARef}
                            deckBRef={deckBRef}
                            bpmA={bpmA}
                            bpmB={bpmB}
                        />
                    )}
                </div>
            )}
        </div>
    );
};

export default memo(MixerPanel);

/**
 * Effect Rack - Inspired by Mixxx's Effect System
 *
 * Features:
 * - Multiple effects per deck with on/off toggles
 * - Single knob control per effect (meta-knob concept)
 * - Effect chain with superknob
 * - Tempo-synced LFO effects
 * - Dry/Wet mix control
 */

import React, { useState, useCallback, useEffect, useRef, memo } from 'react';
import {
    Power, Waves, Wind, Timer, Radio, Disc3, Volume2,
    ChevronDown, ChevronUp, RotateCcw, Zap
} from 'lucide-react';
import audioEngine from './audioEngine';
import './effectRack.css';

// ============================================
// EFFECT DEFINITIONS (Manifest-style)
// ============================================
const EFFECT_MANIFEST = {
    filter: {
        id: 'filter',
        name: 'Filter',
        shortName: 'FLTR',
        icon: Waves,
        color: '#3b82f6',
        description: 'High-pass and low-pass filter with resonance',
        parameters: {
            frequency: { min: 20, max: 20000, default: 1000, scale: 'logarithmic', unit: 'Hz' },
            resonance: { min: 0.5, max: 10, default: 1, scale: 'linear', unit: 'Q' }
        },
        // Superknob mapping: left = HPF, right = LPF
        superknobMode: 'bipolar'
    },
    echo: {
        id: 'echo',
        name: 'Echo',
        shortName: 'ECHO',
        icon: Timer,
        color: '#10b981',
        description: 'Tempo-synced delay with feedback',
        parameters: {
            time: { min: 0.05, max: 2, default: 0.25, scale: 'linear', unit: 's' },
            feedback: { min: 0, max: 0.9, default: 0.3, scale: 'linear', unit: '%' },
            mix: { min: 0, max: 1, default: 0.5, scale: 'linear', unit: '%' }
        },
        tempoSync: true,
        beatDivisions: ['1/4', '1/2', '1', '2']
    },
    flanger: {
        id: 'flanger',
        name: 'Flanger',
        shortName: 'FLNG',
        icon: Wind,
        color: '#8b5cf6',
        description: 'Classic flanger with LFO modulation',
        parameters: {
            depth: { min: 0, max: 1, default: 0.5, scale: 'linear', unit: '%' },
            rate: { min: 0.1, max: 10, default: 1, scale: 'logarithmic', unit: 'Hz' },
            feedback: { min: 0, max: 0.9, default: 0.5, scale: 'linear', unit: '%' }
        },
        tempoSync: true
    },
    phaser: {
        id: 'phaser',
        name: 'Phaser',
        shortName: 'PHSR',
        icon: Radio,
        color: '#ec4899',
        description: 'Multi-stage phaser with LFO',
        parameters: {
            depth: { min: 0, max: 1, default: 0.7, scale: 'linear', unit: '%' },
            rate: { min: 0.1, max: 5, default: 0.5, scale: 'logarithmic', unit: 'Hz' },
            stages: { min: 2, max: 12, default: 4, scale: 'integral', unit: '' }
        },
        tempoSync: true
    },
    reverb: {
        id: 'reverb',
        name: 'Reverb',
        shortName: 'VERB',
        icon: Disc3,
        color: '#f59e0b',
        description: 'Room reverb with decay control',
        parameters: {
            decay: { min: 0.1, max: 10, default: 2, scale: 'logarithmic', unit: 's' },
            damping: { min: 0, max: 1, default: 0.5, scale: 'linear', unit: '%' },
            mix: { min: 0, max: 1, default: 0.3, scale: 'linear', unit: '%' }
        }
    },
    bitcrush: {
        id: 'bitcrush',
        name: 'Bitcrush',
        shortName: 'CRSH',
        icon: Zap,
        color: '#ef4444',
        description: 'Lo-fi bit reduction and sample rate crush',
        parameters: {
            bits: { min: 1, max: 16, default: 8, scale: 'integral', unit: 'bit' },
            rate: { min: 0.01, max: 1, default: 1, scale: 'linear', unit: '%' }
        }
    }
};

// ============================================
// SINGLE KNOB COMPONENT
// ============================================
const EffectKnob = memo(({ value, onChange, color = '#8b5cf6', size = 48, disabled = false }) => {
    const knobRef = useRef(null);
    const normalized = Math.max(0, Math.min(1, value));
    const rotation = -135 + normalized * 270;

    const handleMouseDown = (e) => {
        if (disabled) return;
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
        <div
            ref={knobRef}
            className={`er-knob ${disabled ? 'disabled' : ''}`}
            style={{ width: size, height: size }}
            onMouseDown={handleMouseDown}
            onDoubleClick={() => !disabled && onChange?.(0.5)}
        >
            <svg viewBox="0 0 100 100" className="er-knob-track">
                <circle cx="50" cy="50" r="42" fill="none" stroke="#1f1f23" strokeWidth="8"
                    strokeDasharray="198" strokeDashoffset="66" transform="rotate(135 50 50)" />
                <circle cx="50" cy="50" r="42" fill="none" stroke={disabled ? '#3f3f46' : color} strokeWidth="8"
                    strokeDasharray="198" strokeDashoffset={198 - normalized * 198}
                    transform="rotate(135 50 50)" className="er-knob-fill" />
            </svg>
            <div className="er-knob-dial" style={{ transform: `rotate(${rotation}deg)` }}>
                <div className="er-knob-dot" style={{ background: disabled ? '#3f3f46' : color }} />
            </div>
        </div>
    );
});

// ============================================
// EFFECT UNIT COMPONENT (Single Effect)
// ============================================
const EffectUnit = memo(({
    effectId,
    deckId,
    enabled,
    knobValue,
    onToggle,
    onKnobChange,
    bpm = 120
}) => {
    const effect = EFFECT_MANIFEST[effectId];
    if (!effect) return null;

    const Icon = effect.icon;

    return (
        <div className={`er-effect-unit ${enabled ? 'active' : ''}`}>
            {/* Effect Header with Toggle */}
            <button
                className={`er-toggle ${enabled ? 'on' : ''}`}
                onClick={() => onToggle(effectId)}
                title={`${enabled ? 'Disable' : 'Enable'} ${effect.name}`}
            >
                <Power size={12} />
            </button>

            {/* Effect Icon & Name */}
            <div className="er-effect-info">
                <Icon size={14} style={{ color: enabled ? effect.color : '#52525b' }} />
                <span className="er-effect-name">{effect.shortName}</span>
            </div>

            {/* Main Knob */}
            <EffectKnob
                value={knobValue}
                onChange={(v) => onKnobChange(effectId, v)}
                color={effect.color}
                size={44}
                disabled={!enabled}
            />

            {/* Value Display */}
            <div className="er-knob-value">
                {Math.round(knobValue * 100)}%
            </div>
        </div>
    );
});

// ============================================
// DECK EFFECT CHAIN
// ============================================
const DeckEffectChain = memo(({ deckId, bpm, audioEngineRef }) => {
    // Effect states: { effectId: { enabled: bool, knobValue: number } }
    const [effects, setEffects] = useState({
        filter: { enabled: false, knobValue: 0.5 },
        echo: { enabled: false, knobValue: 0.5 },
        flanger: { enabled: false, knobValue: 0.5 },
        phaser: { enabled: false, knobValue: 0.5 },
        reverb: { enabled: false, knobValue: 0.3 },
        bitcrush: { enabled: false, knobValue: 0.5 }
    });

    // Superknob controls all enabled effects
    const [superknob, setSuperknob] = useState(0.5);
    const [superknobLinked, setSuperknobLinked] = useState(false);

    // Handle effect toggle
    const handleToggle = useCallback((effectId) => {
        setEffects(prev => ({
            ...prev,
            [effectId]: { ...prev[effectId], enabled: !prev[effectId].enabled }
        }));

        // Apply to audio engine
        const newEnabled = !effects[effectId].enabled;
        applyEffectToEngine(deckId, effectId, newEnabled, effects[effectId].knobValue);
    }, [deckId, effects]);

    // Handle knob change
    const handleKnobChange = useCallback((effectId, value) => {
        setEffects(prev => ({
            ...prev,
            [effectId]: { ...prev[effectId], knobValue: value }
        }));

        // Apply to audio engine if enabled
        if (effects[effectId].enabled) {
            applyEffectToEngine(deckId, effectId, true, value);
        }
    }, [deckId, effects]);

    // Handle superknob change (controls all linked effects)
    const handleSuperknobChange = useCallback((value) => {
        setSuperknob(value);

        if (superknobLinked) {
            // Update all enabled effects
            const updatedEffects = { ...effects };
            Object.keys(updatedEffects).forEach(effectId => {
                if (updatedEffects[effectId].enabled) {
                    updatedEffects[effectId].knobValue = value;
                    applyEffectToEngine(deckId, effectId, true, value);
                }
            });
            setEffects(updatedEffects);
        }
    }, [deckId, effects, superknobLinked]);

    // Apply effect to audio engine
    const applyEffectToEngine = (deckId, effectId, enabled, value) => {
        // This would connect to the enhanced audioEngine
        // For now, we'll use the existing filter/delay if available
        switch (effectId) {
            case 'filter':
                if (enabled) {
                    // Map 0-1 to 20Hz-20kHz logarithmically
                    const freq = 20 * Math.pow(1000, value);
                    audioEngine.setFilter(deckId, freq, 'lowpass', 1 + value * 4);
                }
                audioEngine.setFilterEnabled?.(deckId, enabled);
                break;
            case 'echo':
                if (enabled) {
                    const beatDuration = 60 / (bpm || 120);
                    const delayTime = beatDuration * (0.25 + value * 1.75); // 1/4 to 2 beats
                    audioEngine.setDelay?.(deckId, delayTime, 0.2 + value * 0.5, 0.3 + value * 0.4);
                }
                audioEngine.setDelayEnabled?.(deckId, enabled);
                break;
            // Additional effects would be implemented in the audio engine
            default:
                console.log(`Effect ${effectId} not yet implemented in audio engine`);
        }
    };

    const color = deckId === 'A' ? '#8b5cf6' : '#ec4899';

    return (
        <div className="er-deck-chain">
            <div className="er-chain-header">
                <span className="er-deck-label">DECK {deckId}</span>
                <div className="er-superknob-section">
                    <button
                        className={`er-link-btn ${superknobLinked ? 'active' : ''}`}
                        onClick={() => setSuperknobLinked(!superknobLinked)}
                        title={superknobLinked ? 'Unlink Superknob' : 'Link all effects to Superknob'}
                    >
                        LINK
                    </button>
                    <div className="er-superknob">
                        <span className="er-super-label">SUPER</span>
                        <EffectKnob
                            value={superknob}
                            onChange={handleSuperknobChange}
                            color={color}
                            size={40}
                            disabled={!superknobLinked}
                        />
                    </div>
                </div>
            </div>

            <div className="er-effects-grid">
                {Object.keys(EFFECT_MANIFEST).map(effectId => (
                    <EffectUnit
                        key={effectId}
                        effectId={effectId}
                        deckId={deckId}
                        enabled={effects[effectId].enabled}
                        knobValue={effects[effectId].knobValue}
                        onToggle={handleToggle}
                        onKnobChange={handleKnobChange}
                        bpm={bpm}
                    />
                ))}
            </div>
        </div>
    );
});

// ============================================
// MAIN EFFECT RACK COMPONENT
// ============================================
const EffectRack = ({ deckATrack, deckBTrack, expanded = true, onToggleExpand }) => {
    const [isExpanded, setIsExpanded] = useState(expanded);

    const bpmA = deckATrack?.analysis?.bpm || 120;
    const bpmB = deckBTrack?.analysis?.bpm || 120;

    return (
        <div className={`effect-rack ${isExpanded ? 'expanded' : 'collapsed'}`}>
            <div className="er-header">
                <div className="er-title">
                    <Waves size={16} />
                    <span>EFFECT RACK</span>
                </div>
                <button
                    className="er-collapse-btn"
                    onClick={() => setIsExpanded(!isExpanded)}
                >
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
            </div>

            {isExpanded && (
                <div className="er-content">
                    <DeckEffectChain deckId="A" bpm={bpmA} />
                    <div className="er-divider" />
                    <DeckEffectChain deckId="B" bpm={bpmB} />
                </div>
            )}
        </div>
    );
};

export default memo(EffectRack);

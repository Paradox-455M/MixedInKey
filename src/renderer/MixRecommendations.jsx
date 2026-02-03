import React, { useMemo, memo } from 'react';
import { Zap, Clock, Music, Gauge, Target } from 'lucide-react';
import './mixRecommendations.css';

// Scoring weights for mix point recommendations
const WEIGHTS = {
    phrase_alignment: 0.30,
    key_compatibility: 0.25,
    energy_match: 0.20,
    cue_alignment: 0.15,
    bpm_match: 0.10
};

// Camelot wheel for key compatibility
const CAMELOT_WHEEL = {
    'C': '8B', 'C#': '3B', 'Db': '3B', 'D': '10B', 'D#': '5B', 'Eb': '5B',
    'E': '12B', 'F': '7B', 'F#': '2B', 'Gb': '2B', 'G': '9B', 'G#': '4B',
    'Ab': '4B', 'A': '11B', 'A#': '6B', 'Bb': '6B', 'B': '1B',
    'Cm': '5A', 'C#m': '12A', 'Dbm': '12A', 'Dm': '7A', 'D#m': '2A', 'Ebm': '2A',
    'Em': '9A', 'Fm': '4A', 'F#m': '11A', 'Gbm': '11A', 'Gm': '6A', 'G#m': '1A',
    'Abm': '1A', 'Am': '8A', 'A#m': '3A', 'Bbm': '3A', 'Bm': '10A'
};

const MixRecommendations = ({ deckA, deckB, onHighlightPoint }) => {
    const recommendations = useMemo(() => {
        if (!deckA?.analysis || !deckB?.analysis) return [];

        const trackA = deckA.analysis;
        const trackB = deckB.analysis;

        // Get potential out points from track A
        const outPoints = getOutPoints(trackA);
        // Get potential in points from track B
        const inPoints = getInPoints(trackB);

        // Calculate global compatibility scores
        const keyScore = calculateKeyCompatibility(trackA, trackB);
        const bpmScore = calculateBpmCompatibility(trackA, trackB);

        // Score all combinations
        const allCombos = [];
        for (const outPoint of outPoints) {
            for (const inPoint of inPoints) {
                const { score, reasons } = scoreMixPoint(
                    trackA, trackB, outPoint, inPoint, keyScore, bpmScore
                );
                allCombos.push({
                    outPoint,
                    inPoint,
                    score: Math.round(score),
                    reasons,
                    overlapBars: calculateOverlapBars(outPoint, inPoint)
                });
            }
        }

        // Sort by score and return top 3
        allCombos.sort((a, b) => b.score - a.score);
        return allCombos.slice(0, 3);
    }, [deckA?.analysis, deckB?.analysis]);

    if (!deckA?.analysis || !deckB?.analysis) {
        return (
            <div className="mix-recommendations empty">
                <div className="mix-rec-header">
                    <Target size={16} />
                    <span>Mix Recommendations</span>
                </div>
                <div className="mix-rec-empty">
                    Load tracks on both decks to see mix recommendations
                </div>
            </div>
        );
    }

    return (
        <div className="mix-recommendations">
            <div className="mix-rec-header">
                <Target size={16} />
                <span>Mix Recommendations</span>
                <span className="mix-rec-subtitle">
                    {deckA.file?.name?.slice(0, 20)}... to {deckB.file?.name?.slice(0, 20)}...
                </span>
            </div>

            <div className="mix-rec-list">
                {recommendations.map((rec, idx) => (
                    <div
                        key={idx}
                        className={`mix-rec-card ${idx === 0 ? 'best' : ''}`}
                        onClick={() => onHighlightPoint?.(rec)}
                    >
                        <div className="mix-rec-score-section">
                            <div className={`mix-rec-score ${getScoreClass(rec.score)}`}>
                                {rec.score}
                            </div>
                            <div className="mix-rec-rank">#{idx + 1}</div>
                        </div>

                        <div className="mix-rec-details">
                            <div className="mix-rec-points">
                                <div className="mix-point out">
                                    <span className="point-label">OUT</span>
                                    <span className="point-time">{formatTime(rec.outPoint.time)}</span>
                                    <span className="point-type">{rec.outPoint.label}</span>
                                </div>
                                <div className="mix-arrow">
                                    <svg width="24" height="12" viewBox="0 0 24 12">
                                        <path
                                            d="M0 6h20M16 1l5 5-5 5"
                                            stroke="currentColor"
                                            strokeWidth="1.5"
                                            fill="none"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        />
                                    </svg>
                                </div>
                                <div className="mix-point in">
                                    <span className="point-label">IN</span>
                                    <span className="point-time">{formatTime(rec.inPoint.time)}</span>
                                    <span className="point-type">{rec.inPoint.label}</span>
                                </div>
                            </div>

                            <div className="mix-rec-reasons">
                                {rec.reasons.slice(0, 3).map((reason, rIdx) => (
                                    <span
                                        key={rIdx}
                                        className={`reason-badge ${getReasonClass(reason.score)}`}
                                        title={`${reason.label}: ${reason.score}%`}
                                    >
                                        {getReasonIcon(reason.label)}
                                        {reason.score}
                                    </span>
                                ))}
                            </div>

                            <div className="mix-rec-overlap">
                                <Clock size={12} />
                                <span>{rec.overlapBars} bar overlap</span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// Helper functions

function getOutPoints(track) {
    const points = [];
    const duration = track.duration || 300;
    const cuePoints = track.cue_points || [];
    const phraseMarkers = track.phrase_markers || [];

    // Look for outro cue
    const outroCue = cuePoints.find(c =>
        (c.name + (c.type || '')).toLowerCase().includes('outro')
    );
    if (outroCue) {
        points.push({
            time: outroCue.time,
            type: 'outro',
            label: outroCue.name || 'Outro',
            source: 'cue'
        });
    }

    // Look for last drop
    const drops = cuePoints.filter(c =>
        (c.name + (c.type || '')).toLowerCase().includes('drop')
    );
    if (drops.length > 0) {
        const lastDrop = drops.reduce((a, b) => a.time > b.time ? a : b);
        const phraseDuration = getPhraseDuration(track.bpm || 128, 16);
        const outTime = lastDrop.time + phraseDuration;
        if (outTime < duration) {
            points.push({
                time: outTime,
                type: 'post_drop',
                label: 'After Last Drop',
                source: 'derived'
            });
        }
    }

    // Add phrase boundaries in last third
    const lastThird = duration * 0.66;
    for (const phrase of phraseMarkers) {
        if (phrase.time >= lastThird && (phrase.bar_length || 8) >= 8) {
            points.push({
                time: phrase.time,
                type: 'phrase',
                label: `${phrase.bar_length || 8}-bar`,
                source: 'phrase',
                barLength: phrase.bar_length || 8
            });
        }
    }

    // Default fallback
    if (points.length === 0) {
        points.push({
            time: duration * 0.75,
            type: 'default',
            label: 'Default (75%)',
            source: 'default'
        });
    }

    return points;
}

function getInPoints(track) {
    const points = [];
    const duration = track.duration || 300;
    const cuePoints = track.cue_points || [];
    const phraseMarkers = track.phrase_markers || [];

    // Start of track
    points.push({
        time: 0,
        type: 'start',
        label: 'Track Start',
        source: 'default'
    });

    // Look for intro cue
    const introCue = cuePoints.find(c =>
        (c.name + (c.type || '')).toLowerCase().includes('intro')
    );
    if (introCue && introCue.time > 0) {
        points.push({
            time: introCue.time,
            type: 'intro',
            label: introCue.name || 'Intro',
            source: 'cue'
        });
    }

    // Look for first drop
    const drops = cuePoints.filter(c =>
        (c.name + (c.type || '')).toLowerCase().includes('drop')
    );
    if (drops.length > 0) {
        const firstDrop = drops.reduce((a, b) => a.time < b.time ? a : b);
        points.push({
            time: firstDrop.time,
            type: 'drop',
            label: firstDrop.name || 'Drop',
            source: 'cue'
        });
    }

    // Early phrase boundaries
    const firstThird = duration * 0.33;
    for (const phrase of phraseMarkers) {
        if (phrase.time <= firstThird && phrase.time > 0 && (phrase.bar_length || 8) >= 8) {
            points.push({
                time: phrase.time,
                type: 'phrase',
                label: `${phrase.bar_length || 8}-bar`,
                source: 'phrase',
                barLength: phrase.bar_length || 8
            });
        }
    }

    return points;
}

function getPhraseDuration(bpm, bars) {
    const beatsPerBar = 4;
    const secondsPerBeat = 60 / bpm;
    return bars * beatsPerBar * secondsPerBeat;
}

function calculateKeyCompatibility(trackA, trackB) {
    const keyA = trackA.key || '';
    const keyB = trackB.key || '';

    if (!keyA || !keyB) return 50;

    const camelotA = toCamelot(keyA);
    const camelotB = toCamelot(keyB);

    if (!camelotA || !camelotB) return 50;

    // Same key = perfect
    if (camelotA === camelotB) return 100;

    const numA = parseInt(camelotA.slice(0, -1));
    const modeA = camelotA.slice(-1);
    const numB = parseInt(camelotB.slice(0, -1));
    const modeB = camelotB.slice(-1);

    // Same number, different mode (relative major/minor) = 90
    if (numA === numB && modeA !== modeB) return 90;

    // Adjacent on wheel (same mode, ±1) = 80
    if (modeA === modeB) {
        const diff = Math.abs(numA - numB);
        if (diff === 1 || diff === 11) return 80;
    }

    // Otherwise lower compatibility
    return 25;
}

function toCamelot(key) {
    // Already Camelot format
    if (/^\d{1,2}[AB]$/.test(key)) return key;

    // Normalize key string
    const normalized = key.replace('minor', 'm').replace('Minor', 'm')
        .replace('major', '').replace('Major', '')
        .replace(/\s+/g, '').trim();

    return CAMELOT_WHEEL[normalized] || null;
}

function calculateBpmCompatibility(trackA, trackB) {
    const bpmA = trackA.bpm || 0;
    const bpmB = trackB.bpm || 0;

    if (!bpmA || !bpmB) return 50;

    const pitchPercent = Math.abs((bpmB - bpmA) / bpmA) * 100;

    if (pitchPercent <= 2) return 100;
    if (pitchPercent <= 5) return 85;
    if (pitchPercent <= 8) return 60;
    if (pitchPercent <= 12) return 40;
    return 20;
}

function scoreMixPoint(trackA, trackB, outPoint, inPoint, keyScore, bpmScore) {
    const reasons = [];

    // Phrase alignment
    const phraseScore = calculatePhraseAlignmentScore(outPoint, inPoint);
    reasons.push({ label: 'Phrase', score: Math.round(phraseScore) });

    // Key (pre-calculated)
    reasons.push({ label: 'Key', score: Math.round(keyScore) });

    // Energy
    const energyScore = calculateEnergyMatchScore(trackA, trackB, outPoint, inPoint);
    reasons.push({ label: 'Energy', score: Math.round(energyScore) });

    // Cue alignment
    const cueScore = calculateCueAlignmentScore(outPoint, inPoint);
    reasons.push({ label: 'Cue', score: Math.round(cueScore) });

    // BPM (pre-calculated)
    reasons.push({ label: 'BPM', score: Math.round(bpmScore) });

    const totalScore =
        phraseScore * WEIGHTS.phrase_alignment +
        keyScore * WEIGHTS.key_compatibility +
        energyScore * WEIGHTS.energy_match +
        cueScore * WEIGHTS.cue_alignment +
        bpmScore * WEIGHTS.bpm_match;

    return { score: totalScore, reasons };
}

function calculatePhraseAlignmentScore(outPoint, inPoint) {
    let score = 50;

    if (outPoint.source === 'phrase') {
        score += 25;
        if ((outPoint.barLength || 8) >= 16) score += 15;
        if ((outPoint.barLength || 8) >= 32) score += 10;
    }

    if (inPoint.source === 'phrase') {
        score += 25;
        if ((inPoint.barLength || 8) >= 16) score += 15;
        if ((inPoint.barLength || 8) >= 32) score += 10;
    }

    return Math.min(100, score);
}

function calculateEnergyMatchScore(trackA, trackB, outPoint, inPoint) {
    const energyA = trackA.overall_energy || 5;
    const energyB = trackB.overall_energy || 5;

    // Get energy at specific points if energy_profile available
    let energyAtOut = energyA;
    let energyAtIn = energyB;

    const profileA = trackA.energy_profile || [];
    const profileB = trackB.energy_profile || [];

    if (profileA.length > 0 && trackA.duration) {
        const idx = Math.min(
            Math.floor((outPoint.time / trackA.duration) * profileA.length),
            profileA.length - 1
        );
        energyAtOut = profileA[idx]?.energy ?? energyA;
    }

    if (profileB.length > 0 && trackB.duration) {
        const idx = Math.min(
            Math.floor((inPoint.time / trackB.duration) * profileB.length),
            profileB.length - 1
        );
        energyAtIn = profileB[idx]?.energy ?? energyB;
    }

    const diff = energyAtIn - energyAtOut;

    if (diff >= -1 && diff <= 2) return 100;
    if (diff >= -2 && diff <= 3) return 80;
    if (diff >= -3 && diff <= 4) return 60;
    return 40;
}

function calculateCueAlignmentScore(outPoint, inPoint) {
    let score = 50;

    if (outPoint.source === 'cue') {
        score += 25;
        if (outPoint.type === 'outro') score += 15;
    }

    if (inPoint.source === 'cue') {
        score += 25;
        if (inPoint.type === 'intro') score += 15;
    }

    if (outPoint.type === 'outro' && inPoint.type === 'intro') {
        score += 10;
    }

    return Math.min(100, score);
}

function calculateOverlapBars(outPoint, inPoint) {
    if (outPoint.type === 'outro' && inPoint.type === 'intro') return 16;
    if (outPoint.type === 'drop' || inPoint.type === 'drop') return 8;
    if (outPoint.source === 'phrase' || inPoint.source === 'phrase') {
        return Math.max(outPoint.barLength || 8, inPoint.barLength || 8);
    }
    return 16;
}

function formatTime(seconds) {
    if (seconds == null || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function getScoreClass(score) {
    if (score >= 80) return 'excellent';
    if (score >= 60) return 'good';
    if (score >= 40) return 'moderate';
    return 'poor';
}

function getReasonClass(score) {
    if (score >= 80) return 'high';
    if (score >= 60) return 'medium';
    return 'low';
}

function getReasonIcon(label) {
    switch (label) {
        case 'Phrase': return <Target size={10} />;
        case 'Key': return <Music size={10} />;
        case 'Energy': return <Zap size={10} />;
        case 'Cue': return <Clock size={10} />;
        case 'BPM': return <Gauge size={10} />;
        default: return null;
    }
}

export default memo(MixRecommendations);

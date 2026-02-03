import React, { useMemo, memo } from 'react';
import { X, Sparkles, Music, Zap, Gauge } from 'lucide-react';
import { getKeyColor } from './keyUtils';
import './similarTracksPanel.css';

// Similarity weights
const WEIGHTS = {
    harmonic: 0.50,   // Key compatibility (Camelot wheel)
    energy: 0.25,     // Energy level similarity
    bpm: 0.25         // Tempo (with half/double time check)
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

const SimilarTracksPanel = ({
    sourceTrack,
    allTracks,
    onClose,
    onSelectTrack,
    maxResults = 10
}) => {
    const similarTracks = useMemo(() => {
        if (!sourceTrack?.analysis || !allTracks?.length) return [];

        const sourceAnalysis = sourceTrack.analysis;
        const results = [];

        for (const track of allTracks) {
            // Skip the source track itself
            if (track.file?.path === sourceTrack.file?.path) continue;

            const similarity = calculateSimilarity(sourceAnalysis, track.analysis);
            if (similarity.total > 0) {
                results.push({
                    track,
                    similarity
                });
            }
        }

        // Sort by total similarity descending
        results.sort((a, b) => b.similarity.total - a.similarity.total);

        return results.slice(0, maxResults);
    }, [sourceTrack, allTracks, maxResults]);

    if (!sourceTrack) return null;

    return (
        <div className="similar-tracks-panel">
            <div className="similar-panel-header">
                <div className="similar-panel-title">
                    <Sparkles size={16} />
                    <span>Similar to</span>
                </div>
                <div className="similar-source-track">
                    <span className="source-name">{sourceTrack.file?.name}</span>
                    <span
                        className="source-key"
                        style={{ backgroundColor: getKeyColor(sourceTrack.analysis?.key) }}
                    >
                        {sourceTrack.analysis?.key}
                    </span>
                    <span className="source-bpm">{Math.round(sourceTrack.analysis?.bpm || 0)} BPM</span>
                </div>
                <button className="close-btn" onClick={onClose}>
                    <X size={18} />
                </button>
            </div>

            <div className="similar-tracks-list">
                {similarTracks.length === 0 ? (
                    <div className="no-similar-tracks">
                        No similar tracks found in your library
                    </div>
                ) : (
                    similarTracks.map(({ track, similarity }, idx) => (
                        <div
                            key={track.file?.path || idx}
                            className="similar-track-row"
                            onClick={() => onSelectTrack?.(track)}
                        >
                            <div className="similarity-score-badge" style={{
                                backgroundColor: getSimilarityColor(similarity.total)
                            }}>
                                {Math.round(similarity.total)}%
                            </div>

                            <div className="similar-track-info">
                                <div className="similar-track-name">
                                    <Music size={14} />
                                    <span>{track.file?.name}</span>
                                </div>
                                <div className="similar-track-meta">
                                    <span
                                        className="similar-key"
                                        style={{ backgroundColor: getKeyColor(track.analysis?.key) }}
                                    >
                                        {track.analysis?.key}
                                    </span>
                                    <span className="similar-bpm">
                                        {Math.round(track.analysis?.bpm || 0)} BPM
                                    </span>
                                    <span className="similar-energy">
                                        <Zap size={10} />
                                        {track.analysis?.energy_analysis?.energy_level || track.analysis?.overall_energy || 5}
                                    </span>
                                </div>
                            </div>

                            <div className="similarity-breakdown">
                                <div
                                    className="breakdown-item"
                                    title={`Key: ${Math.round(similarity.harmonic)}%`}
                                >
                                    <Music size={10} />
                                    <div className="breakdown-bar">
                                        <div
                                            className="breakdown-fill harmonic"
                                            style={{ width: `${similarity.harmonic}%` }}
                                        />
                                    </div>
                                </div>
                                <div
                                    className="breakdown-item"
                                    title={`Energy: ${Math.round(similarity.energy)}%`}
                                >
                                    <Zap size={10} />
                                    <div className="breakdown-bar">
                                        <div
                                            className="breakdown-fill energy"
                                            style={{ width: `${similarity.energy}%` }}
                                        />
                                    </div>
                                </div>
                                <div
                                    className="breakdown-item"
                                    title={`BPM: ${Math.round(similarity.bpm)}%`}
                                >
                                    <Gauge size={10} />
                                    <div className="breakdown-bar">
                                        <div
                                            className="breakdown-fill bpm"
                                            style={{ width: `${similarity.bpm}%` }}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

// Calculate similarity between two tracks
function calculateSimilarity(sourceAnalysis, targetAnalysis) {
    if (!sourceAnalysis || !targetAnalysis) {
        return { total: 0, harmonic: 0, energy: 0, bpm: 0 };
    }

    // 1. Harmonic similarity (key compatibility)
    const harmonicScore = calculateHarmonicSimilarity(
        sourceAnalysis.key,
        targetAnalysis.key
    );

    // 2. Energy similarity
    const energyScore = calculateEnergySimilarity(
        sourceAnalysis.energy_analysis?.energy_level || sourceAnalysis.overall_energy || 5,
        targetAnalysis.energy_analysis?.energy_level || targetAnalysis.overall_energy || 5
    );

    // 3. BPM similarity (with half/double time check)
    const bpmScore = calculateBpmSimilarity(
        sourceAnalysis.bpm,
        targetAnalysis.bpm
    );

    // Weighted total
    const total = (
        harmonicScore * WEIGHTS.harmonic +
        energyScore * WEIGHTS.energy +
        bpmScore * WEIGHTS.bpm
    );

    return {
        total,
        harmonic: harmonicScore,
        energy: energyScore,
        bpm: bpmScore
    };
}

function calculateHarmonicSimilarity(keyA, keyB) {
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

    // Adjacent on wheel (same mode, ±1) = 85
    if (modeA === modeB) {
        const diff = Math.abs(numA - numB);
        if (diff === 1 || diff === 11) return 85;
    }

    // Two steps away on wheel = 70
    if (modeA === modeB) {
        const diff = Math.abs(numA - numB);
        if (diff === 2 || diff === 10) return 70;
    }

    // Adjacent number but different mode = 60
    const numDiff = Math.abs(numA - numB);
    if ((numDiff === 1 || numDiff === 11) && modeA !== modeB) return 60;

    // Otherwise low compatibility
    return 25;
}

function toCamelot(key) {
    // Already Camelot format
    if (/^\d{1,2}[AB]$/.test(key)) return key;

    // Normalize key string
    const normalized = key
        .replace('minor', 'm').replace('Minor', 'm')
        .replace('major', '').replace('Major', '')
        .replace(/\s+/g, '').trim();

    return CAMELOT_WHEEL[normalized] || null;
}

function calculateEnergySimilarity(energyA, energyB) {
    // Energy is typically 1-10 scale
    const diff = Math.abs(energyA - energyB);

    if (diff <= 0.5) return 100;
    if (diff <= 1) return 90;
    if (diff <= 2) return 75;
    if (diff <= 3) return 60;
    if (diff <= 4) return 45;
    return 30;
}

function calculateBpmSimilarity(bpmA, bpmB) {
    if (!bpmA || !bpmB) return 50;

    // Direct comparison
    const directDiff = Math.abs(bpmA - bpmB);
    const directPercent = (directDiff / bpmA) * 100;

    // Check half/double time
    const halfTimeDiff = Math.abs(bpmA - bpmB * 2);
    const halfTimePercent = (halfTimeDiff / bpmA) * 100;

    const doubleTimeDiff = Math.abs(bpmA * 2 - bpmB);
    const doubleTimePercent = (doubleTimeDiff / (bpmA * 2)) * 100;

    // Use the best match
    const bestPercent = Math.min(directPercent, halfTimePercent, doubleTimePercent);

    if (bestPercent <= 2) return 100;
    if (bestPercent <= 4) return 90;
    if (bestPercent <= 6) return 80;
    if (bestPercent <= 8) return 70;
    if (bestPercent <= 10) return 60;
    if (bestPercent <= 15) return 45;
    return 25;
}

function getSimilarityColor(score) {
    if (score >= 80) return '#10b981';  // Green
    if (score >= 60) return '#f59e0b';  // Orange
    if (score >= 40) return '#f97316';  // Dark orange
    return '#ef4444';  // Red
}

export default memo(SimilarTracksPanel);

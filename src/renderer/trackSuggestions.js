/**
 * Smart Track Suggestions Algorithm
 * Recommends tracks based on harmonic compatibility, BPM, energy, and other factors
 */

// Camelot wheel compatibility map
const CAMELOT_POSITIONS = {
    '1A': { musical: 'Abm', compatible: ['1A', '2A', '12A', '1B'] },
    '2A': { musical: 'Ebm', compatible: ['2A', '3A', '1A', '2B'] },
    '3A': { musical: 'Bbm', compatible: ['3A', '4A', '2A', '3B'] },
    '4A': { musical: 'Fm', compatible: ['4A', '5A', '3A', '4B'] },
    '5A': { musical: 'Cm', compatible: ['5A', '6A', '4A', '5B'] },
    '6A': { musical: 'Gm', compatible: ['6A', '7A', '5A', '6B'] },
    '7A': { musical: 'Dm', compatible: ['7A', '8A', '6A', '7B'] },
    '8A': { musical: 'Am', compatible: ['8A', '9A', '7A', '8B'] },
    '9A': { musical: 'Em', compatible: ['9A', '10A', '8A', '9B'] },
    '10A': { musical: 'Bm', compatible: ['10A', '11A', '9A', '10B'] },
    '11A': { musical: 'F#m', compatible: ['11A', '12A', '10A', '11B'] },
    '12A': { musical: 'C#m', compatible: ['12A', '1A', '11A', '12B'] },
    '1B': { musical: 'B', compatible: ['1B', '2B', '12B', '1A'] },
    '2B': { musical: 'Gb', compatible: ['2B', '3B', '1B', '2A'] },
    '3B': { musical: 'Db', compatible: ['3B', '4B', '2B', '3A'] },
    '4B': { musical: 'Ab', compatible: ['4B', '5B', '3B', '4A'] },
    '5B': { musical: 'Eb', compatible: ['5B', '6B', '4B', '5A'] },
    '6B': { musical: 'Bb', compatible: ['6B', '7B', '5B', '6A'] },
    '7B': { musical: 'F', compatible: ['7B', '8B', '6B', '7A'] },
    '8B': { musical: 'C', compatible: ['8B', '9B', '7B', '8A'] },
    '9B': { musical: 'G', compatible: ['9B', '10B', '8B', '9A'] },
    '10B': { musical: 'D', compatible: ['10B', '11B', '9B', '10A'] },
    '11B': { musical: 'A', compatible: ['11B', '12B', '10B', '11A'] },
    '12B': { musical: 'E', compatible: ['12B', '1B', '11B', '12A'] }
};

/**
 * Convert musical key to Camelot notation
 */
export const keyToCamelot = (key) => {
    if (!key) return null;

    // Already Camelot format
    if (/^\d+[AB]$/.test(key)) return key;

    // Find in positions
    for (const [camelot, data] of Object.entries(CAMELOT_POSITIONS)) {
        if (data.musical.toLowerCase() === key.toLowerCase()) {
            return camelot;
        }
    }

    return null;
};

/**
 * Check if two keys are harmonically compatible
 */
export const areKeysCompatible = (key1, key2) => {
    const camelot1 = keyToCamelot(key1);
    const camelot2 = keyToCamelot(key2);

    if (!camelot1 || !camelot2) return false;

    const data = CAMELOT_POSITIONS[camelot1];
    return data?.compatible.includes(camelot2);
};

/**
 * Get harmonic compatibility score (0-100)
 */
export const getHarmonicScore = (key1, key2) => {
    const camelot1 = keyToCamelot(key1);
    const camelot2 = keyToCamelot(key2);

    if (!camelot1 || !camelot2) return 0;

    // Same key = perfect
    if (camelot1 === camelot2) return 100;

    // Compatible = great
    const data = CAMELOT_POSITIONS[camelot1];
    if (data?.compatible.includes(camelot2)) return 85;

    // Check if 2 steps away
    const num1 = parseInt(camelot1);
    const num2 = parseInt(camelot2);
    const letter1 = camelot1.slice(-1);
    const letter2 = camelot2.slice(-1);

    if (letter1 === letter2) {
        const diff = Math.abs(num1 - num2);
        if (diff === 2 || diff === 10) return 60; // 2 steps on wheel
        if (diff === 7 || diff === 5) return 40;  // Energy boost
    }

    return 20; // Not compatible
};

/**
 * Get BPM compatibility score (0-100)
 */
export const getBpmScore = (bpm1, bpm2, maxDiff = 6) => {
    if (!bpm1 || !bpm2) return 0;

    const diff = Math.abs(bpm1 - bpm2);
    const percentDiff = (diff / bpm1) * 100;

    // Perfect match
    if (diff <= 1) return 100;

    // Within 3%
    if (percentDiff <= 3) return 90;

    // Within 6%
    if (percentDiff <= 6) return 70;

    // Within 10%
    if (percentDiff <= 10) return 50;

    // Half-time / Double-time compatibility
    const ratio = bpm1 / bpm2;
    if (Math.abs(ratio - 2) < 0.1 || Math.abs(ratio - 0.5) < 0.1) return 60;

    return Math.max(0, 30 - percentDiff);
};

/**
 * Get energy compatibility score (0-100)
 */
export const getEnergyScore = (energy1, energy2, transition = 'similar') => {
    if (!energy1 || !energy2) return 50;

    const diff = Math.abs(energy1 - energy2);

    switch (transition) {
        case 'similar':
            // Want similar energy
            if (diff <= 1) return 100;
            if (diff <= 2) return 80;
            if (diff <= 3) return 60;
            return Math.max(0, 40 - diff * 5);

        case 'build':
            // Want to increase energy
            if (energy2 > energy1 && energy2 - energy1 <= 2) return 100;
            if (energy2 > energy1 && energy2 - energy1 <= 3) return 80;
            if (energy2 === energy1) return 60;
            return 30;

        case 'drop':
            // Want to decrease energy
            if (energy1 > energy2 && energy1 - energy2 <= 2) return 100;
            if (energy1 > energy2 && energy1 - energy2 <= 3) return 80;
            if (energy2 === energy1) return 60;
            return 30;

        default:
            return 50;
    }
};

/**
 * Calculate overall compatibility score for a track
 */
export const calculateTrackScore = (sourceTrack, candidateTrack, options = {}) => {
    const {
        harmonicWeight = 0.40,
        bpmWeight = 0.30,
        energyWeight = 0.20,
        recencyWeight = 0.10,
        transitionType = 'similar'
    } = options;

    const sourceAnalysis = sourceTrack.analysis || {};
    const candidateAnalysis = candidateTrack.analysis || {};

    // Calculate individual scores
    const harmonicScore = getHarmonicScore(
        sourceAnalysis.key,
        candidateAnalysis.key
    );

    const bpmScore = getBpmScore(
        sourceAnalysis.bpm,
        candidateAnalysis.bpm
    );

    const energyScore = getEnergyScore(
        sourceAnalysis.energy_analysis?.energy_level || sourceAnalysis.energy_level,
        candidateAnalysis.energy_analysis?.energy_level || candidateAnalysis.energy_level,
        transitionType
    );

    // Recency bonus (prefer recently added tracks slightly)
    const recencyScore = 50; // Neutral if no data

    // Calculate weighted total
    const totalScore = (
        harmonicScore * harmonicWeight +
        bpmScore * bpmWeight +
        energyScore * energyWeight +
        recencyScore * recencyWeight
    );

    return {
        total: Math.round(totalScore),
        harmonic: Math.round(harmonicScore),
        bpm: Math.round(bpmScore),
        energy: Math.round(energyScore),
        reasons: getReasons(harmonicScore, bpmScore, energyScore, sourceAnalysis, candidateAnalysis)
    };
};

/**
 * Generate human-readable reasons for the suggestion
 */
const getReasons = (harmonicScore, bpmScore, energyScore, source, candidate) => {
    const reasons = [];

    if (harmonicScore >= 85) {
        reasons.push('Perfect harmonic match');
    } else if (harmonicScore >= 60) {
        reasons.push('Compatible keys');
    }

    if (bpmScore >= 90) {
        reasons.push('BPM match');
    } else if (bpmScore >= 60) {
        reasons.push('Similar tempo');
    }

    if (energyScore >= 80) {
        reasons.push('Good energy flow');
    }

    return reasons;
};

/**
 * Get suggested tracks sorted by compatibility
 */
export const getSuggestedTracks = (sourceTrack, allTracks, options = {}) => {
    const {
        limit = 10,
        excludeSource = true,
        minScore = 40,
        ...scoreOptions
    } = options;

    if (!sourceTrack || !allTracks?.length) return [];

    // Score all tracks
    const scored = allTracks
        .filter(track => {
            // Exclude source track
            if (excludeSource && track.file?.path === sourceTrack.file?.path) {
                return false;
            }
            return true;
        })
        .map(track => ({
            track,
            score: calculateTrackScore(sourceTrack, track, scoreOptions)
        }))
        .filter(item => item.score.total >= minScore)
        .sort((a, b) => b.score.total - a.score.total);

    return scored.slice(0, limit);
};

export default {
    keyToCamelot,
    areKeysCompatible,
    getHarmonicScore,
    getBpmScore,
    getEnergyScore,
    calculateTrackScore,
    getSuggestedTracks
};

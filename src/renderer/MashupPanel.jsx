import React, { useMemo } from 'react';
import { Sparkles, Play, ArrowRight, Zap } from 'lucide-react';

const MashupPanel = ({ currentTrack, libraryTracks, onTrackSelect }) => {
    // Camelot Logic
    const getCompatibility = (trackA, trackB) => {
        if (!trackA?.analysis?.key || !trackB?.analysis?.key) return 0;

        const keyA = trackA.analysis.key;
        const keyB = trackB.analysis.key;

        // Parse keys (e.g. "8A")
        const matchA = keyA.match(/(\d+)([AB])/);
        const matchB = keyB.match(/(\d+)([AB])/);

        if (!matchA || !matchB) return 0;

        const numA = parseInt(matchA[1]);
        const letterA = matchA[2];
        const numB = parseInt(matchB[1]);
        const letterB = matchB[2];

        // Perfect match
        if (keyA === keyB) return 100;

        // Relative Major/Minor (8A <-> 8B)
        if (numA === numB && letterA !== letterB) return 90;

        // +/- 1 Hour (Dominant/Subdominant)
        const diff = Math.abs(numA - numB);
        const isAdjacent = diff === 1 || diff === 11;
        if (isAdjacent && letterA === letterB) return 80;

        // Energy Boost (+1 semitone / +7 hours) - complex theory but useful for mashups
        // Simplifying for "Mashup" suggestions: +2 or -2 hours can work for energy changes

        return 0;
    };

    const suggestions = useMemo(() => {
        if (!currentTrack || !libraryTracks) return [];

        return libraryTracks
            .filter(t => t.file.path !== currentTrack.file.path) // Exclude self
            .map(t => {
                const keyScore = getCompatibility(currentTrack, t);

                // BPM Score
                const bpmA = currentTrack.analysis.bpm;
                const bpmB = t.analysis.bpm;
                const bpmDiff = Math.abs(bpmA - bpmB);
                const bpmScore = Math.max(0, 100 - (bpmDiff * 5)); // -5 points per BPM diff

                // Total Score (Key is more important)
                const totalScore = (keyScore * 0.7) + (bpmScore * 0.3);

                return { track: t, score: totalScore, keyScore, bpmScore };
            })
            .filter(item => item.score > 60) // Only relevant matches
            .sort((a, b) => b.score - a.score)
            .slice(0, 5); // Top 5
    }, [currentTrack, libraryTracks]);

    if (!currentTrack || suggestions.length === 0) return null;

    return (
        <div className="mashup-panel">
            <div className="mashup-header">
                <Sparkles size={18} className="mashup-icon" />
                <h3>Mashup Ideas</h3>
            </div>

            <div className="mashup-list">
                {suggestions.map((item, idx) => (
                    <div key={idx} className="mashup-card" onClick={() => onTrackSelect(item.track)}>
                        <div className="mashup-score">
                            <div className="score-ring" style={{
                                borderColor: item.score >= 90 ? '#10b981' : '#f59e0b'
                            }}>
                                {Math.round(item.score)}%
                            </div>
                        </div>
                        <div className="mashup-info">
                            <div className="mashup-title">{item.track.file.name}</div>
                            <div className="mashup-meta">
                                <span className="mashup-key">{item.track.analysis.key}</span>
                                <span className="mashup-bpm">{Math.round(item.track.analysis.bpm)} BPM</span>
                            </div>
                        </div>
                        <div className="mashup-action">
                            <Play size={16} />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default MashupPanel;

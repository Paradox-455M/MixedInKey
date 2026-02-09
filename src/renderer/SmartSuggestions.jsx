import React, { useMemo, memo, useState } from 'react';
import { Sparkles, TrendingUp, TrendingDown, Minus, Music, ChevronDown, ChevronUp } from 'lucide-react';
import { getSuggestedTracks } from './trackSuggestions';
import { getKeyColor } from './keyUtils';
import './smartSuggestions.css';

/**
 * Smart Track Suggestions Component
 * Shows AI-recommended next tracks based on harmonic, BPM, and energy compatibility
 */
const SmartSuggestions = memo(({
    sourceTrack,
    allTracks,
    onSelectTrack,
    maxSuggestions = 5
}) => {
    const [transitionType, setTransitionType] = useState('similar');
    const [expanded, setExpanded] = useState(true);

    // Get suggestions based on current settings
    const suggestions = useMemo(() => {
        if (!sourceTrack || !allTracks?.length) return [];

        return getSuggestedTracks(sourceTrack, allTracks, {
            limit: maxSuggestions,
            transitionType,
            minScore: 35
        });
    }, [sourceTrack, allTracks, maxSuggestions, transitionType]);

    if (!sourceTrack) {
        return (
            <div className="smart-suggestions empty">
                <div className="suggestions-header">
                    <Sparkles size={14} />
                    <span>Smart Suggestions</span>
                </div>
                <p className="no-suggestions">Load a track to get suggestions</p>
            </div>
        );
    }

    return (
        <div className={`smart-suggestions ${expanded ? 'expanded' : 'collapsed'}`}>
            <div className="suggestions-header" onClick={() => setExpanded(prev => !prev)}>
                <div className="header-title">
                    <Sparkles size={14} />
                    <span>Smart Suggestions</span>
                    <span className="suggestion-count">({suggestions.length})</span>
                </div>
                <div className="header-controls">
                    <div className="transition-selector">
                        <button
                            className={`transition-btn ${transitionType === 'build' ? 'active' : ''}`}
                            onClick={(e) => { e.stopPropagation(); setTransitionType('build'); }}
                            title="Find tracks to build energy"
                        >
                            <TrendingUp size={12} />
                        </button>
                        <button
                            className={`transition-btn ${transitionType === 'similar' ? 'active' : ''}`}
                            onClick={(e) => { e.stopPropagation(); setTransitionType('similar'); }}
                            title="Find tracks with similar energy"
                        >
                            <Minus size={12} />
                        </button>
                        <button
                            className={`transition-btn ${transitionType === 'drop' ? 'active' : ''}`}
                            onClick={(e) => { e.stopPropagation(); setTransitionType('drop'); }}
                            title="Find tracks to reduce energy"
                        >
                            <TrendingDown size={12} />
                        </button>
                    </div>
                    {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </div>
            </div>

            {expanded && (
                <div className="suggestions-list">
                    {suggestions.length === 0 ? (
                        <p className="no-suggestions">No compatible tracks found</p>
                    ) : (
                        suggestions.map(({ track, score }, index) => (
                            <div
                                key={track.file?.path || index}
                                className="suggestion-item"
                                onClick={() => onSelectTrack?.(track)}
                            >
                                <div className="suggestion-rank">{index + 1}</div>
                                <div className="suggestion-info">
                                    <div className="suggestion-name">
                                        <Music size={12} />
                                        <span>{track.file?.name || 'Unknown'}</span>
                                    </div>
                                    <div className="suggestion-meta">
                                        <span className="meta-bpm">{Math.round(track.analysis?.bpm || 0)}</span>
                                        <span
                                            className="meta-key"
                                            style={{ backgroundColor: getKeyColor(track.analysis?.key) }}
                                        >
                                            {track.analysis?.key || 'N/A'}
                                        </span>
                                        <span className="meta-energy">
                                            E{track.analysis?.energy_analysis?.energy_level || track.analysis?.energy_level || '?'}
                                        </span>
                                    </div>
                                </div>
                                <div className="suggestion-score">
                                    <div className="score-bar">
                                        <div
                                            className="score-fill"
                                            style={{ width: `${score.total}%` }}
                                        />
                                    </div>
                                    <span className="score-value">{score.total}%</span>
                                </div>
                                <div className="suggestion-reasons">
                                    {score.reasons.slice(0, 2).map((reason, i) => (
                                        <span key={i} className="reason-tag">{reason}</span>
                                    ))}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
});

SmartSuggestions.displayName = 'SmartSuggestions';

export default SmartSuggestions;

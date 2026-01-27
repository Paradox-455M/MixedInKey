import React, { useState, useMemo } from 'react';
import {
    ArrowUpDown,
    ArrowUp,
    ArrowDown,
    Music,
    TrendingUp,
    TrendingDown,
    Minus
} from 'lucide-react';
import { getKeyColor } from './keyUtils';
import './setPlanner.css';

const SetPlannerTable = ({
    tracks,
    transitions,
    onTrackClick,
    currentTrackIndex
}) => {
    const [sortConfig, setSortConfig] = useState({ key: null, direction: 'ascending' });

    const processedTracks = useMemo(() => {
        let result = tracks.map((track, index) => ({
            ...track,
            index: index + 1,
            transitionScore: index > 0 ? transitions[index - 1]?.score : null,
            transitionFrom: index > 0 ? tracks[index - 1] : null,
            transitionTo: index < tracks.length - 1 ? tracks[index + 1] : null
        }));

        // Sort if configured
        if (sortConfig.key) {
            result.sort((a, b) => {
                let aVal = a[sortConfig.key];
                let bVal = b[sortConfig.key];

                // Handle numeric values
                if (sortConfig.key === 'bpm' || sortConfig.key === 'energy' || sortConfig.key === 'transitionScore') {
                    aVal = parseFloat(aVal) || 0;
                    bVal = parseFloat(bVal) || 0;
                }

                // Handle Camelot key sorting (numeric part first, then A/B)
                if (sortConfig.key === 'key') {
                    const aMatch = String(aVal || '').match(/(\d+)([AB])/);
                    const bMatch = String(bVal || '').match(/(\d+)([AB])/);
                    if (aMatch && bMatch) {
                        const aNum = parseInt(aMatch[1]);
                        const bNum = parseInt(bMatch[1]);
                        if (aNum !== bNum) {
                            return sortConfig.direction === 'ascending' ? aNum - bNum : bNum - aNum;
                        }
                        return sortConfig.direction === 'ascending' 
                            ? aMatch[2].localeCompare(bMatch[2])
                            : bMatch[2].localeCompare(aMatch[2]);
                    }
                }

                if (aVal < bVal) return sortConfig.direction === 'ascending' ? -1 : 1;
                if (aVal > bVal) return sortConfig.direction === 'ascending' ? 1 : -1;
                return 0;
            });
        }

        return result;
    }, [tracks, transitions, sortConfig]);

    const requestSort = (key) => {
        let direction = 'ascending';
        if (sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        setSortConfig({ key, direction });
    };

    const getSortIcon = (name) => {
        if (sortConfig.key !== name) return <ArrowUpDown size={14} className="sort-icon" />;
        return sortConfig.direction === 'ascending' ? <ArrowUp size={14} /> : <ArrowDown size={14} />;
    };

    const getScoreColor = (score) => {
        if (score === null || score === undefined) return '#94a3b8';
        if (score >= 85) return '#10b981'; // Green
        if (score >= 70) return '#f59e0b'; // Orange
        return '#ef4444'; // Red
    };

    const getScoreBadge = (score) => {
        if (score === null || score === undefined) return null;
        return (
            <span 
                className="transition-score-badge"
                style={{ backgroundColor: getScoreColor(score) }}
            >
                {score}%
            </span>
        );
    };

    const getEnergyBar = (energy) => {
        const energyValue = parseFloat(energy) || 0;
        const percentage = Math.min(100, Math.max(0, (energyValue / 10) * 100));
        return (
            <div className="energy-bar-container">
                <div 
                    className="energy-bar-fill"
                    style={{ 
                        width: `${percentage}%`,
                        backgroundColor: getEnergyColor(energyValue)
                    }}
                />
                <span className="energy-value">{energyValue.toFixed(1)}</span>
            </div>
        );
    };

    const getEnergyColor = (energy) => {
        const val = parseFloat(energy) || 0;
        if (val <= 2) return '#4338ca'; // Low energy - blue
        if (val <= 4) return '#7c3aed'; // Medium-low - purple
        if (val <= 6) return '#8b5cf6'; // Medium - light purple
        if (val <= 8) return '#a855f7'; // High - pink-purple
        return '#c084fc'; // Very high - light pink
    };

    const formatTime = (seconds) => {
        if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return 'N/A';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <div className="set-planner-table-container">
            <div className="set-planner-table-wrapper">
                <table className="set-planner-table">
                    <thead>
                        <tr>
                            <th className="col-index" onClick={() => requestSort('index')}>
                                # {getSortIcon('index')}
                            </th>
                            <th className="col-track" onClick={() => requestSort('fileName')}>
                                Track {getSortIcon('fileName')}
                            </th>
                            <th className="col-bpm" onClick={() => requestSort('bpm')}>
                                BPM {getSortIcon('bpm')}
                            </th>
                            <th className="col-key" onClick={() => requestSort('key')}>
                                Key {getSortIcon('key')}
                            </th>
                            <th className="col-energy" onClick={() => requestSort('energy')}>
                                Energy {getSortIcon('energy')}
                            </th>
                            <th className="col-structure">Structure</th>
                            <th className="col-transition" onClick={() => requestSort('transitionScore')}>
                                Transition {getSortIcon('transitionScore')}
                            </th>
                            <th className="col-mix">Mix Points</th>
                        </tr>
                    </thead>
                    <tbody>
                        {processedTracks.map((track, idx) => {
                            const isCurrent = currentTrackIndex === idx;
                            const transition = idx > 0 ? transitions[idx - 1] : null;
                            
                            return (
                                <tr
                                    key={track.id || idx}
                                    className={`set-planner-row ${isCurrent ? 'current-track' : ''}`}
                                    onClick={() => onTrackClick && onTrackClick(track, idx)}
                                >
                                    <td className="col-index">
                                        <div className="track-index">{track.index}</div>
                                    </td>
                                    <td className="col-track">
                                        <div className="track-name-cell">
                                            <Music size={14} className="track-icon" />
                                            <span className="track-name">{track.fileName}</span>
                                        </div>
                                    </td>
                                    <td className="col-bpm">
                                        {track.bpm ? Math.round(track.bpm) : 'N/A'}
                                    </td>
                                    <td className="col-key">
                                        <span
                                            className="key-pill"
                                            style={{
                                                backgroundColor: getKeyColor(track.key),
                                                color: '#fff',
                                                textShadow: '0 1px 2px rgba(0,0,0,0.5)'
                                            }}
                                        >
                                            {track.key || 'N/A'}
                                        </span>
                                    </td>
                                    <td className="col-energy">
                                        {getEnergyBar(track.energy)}
                                    </td>
                                    <td className="col-structure">
                                        <MiniCueTimeline track={track} />
                                    </td>
                                    <td className="col-transition">
                                        {transition ? (
                                            <div className="transition-cell">
                                                {getScoreBadge(transition.score)}
                                                {transition.bpmDiff !== null && (
                                                    <div className="transition-details">
                                                        <span className="bpm-diff">
                                                            {transition.bpmDiff > 0 ? (
                                                                <TrendingUp size={12} />
                                                            ) : transition.bpmDiff < 0 ? (
                                                                <TrendingDown size={12} />
                                                            ) : (
                                                                <Minus size={12} />
                                                            )}
                                                            {Math.abs(transition.bpmDiff).toFixed(1)}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <span className="no-transition">—</span>
                                        )}
                                    </td>
                                    <td className="col-mix">
                                        <div className="mix-points">
                                            <div className="mix-point">
                                                <span className="mix-label">In:</span>
                                                <span className="mix-time">{formatTime(track.mixInTime)}</span>
                                            </div>
                                            <div className="mix-point">
                                                <span className="mix-label">Out:</span>
                                                <span className="mix-time">{formatTime(track.mixOutTime)}</span>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default SetPlannerTable;

const MiniCueTimeline = ({ track }) => {
    const cues = track.analysis?.cue_points || [];
    const duration = track.duration || track.analysis?.duration || 300; 
    
    return (
        <div className="mini-timeline">
            {cues.map((cue, i) => {
                 const pct = Math.min(100, Math.max(0, (cue.time / duration) * 100));
                 let color = '#94a3b8'; // default slate-400
                 const type = (cue.type || '').toLowerCase();
                 const name = (cue.name || '').toLowerCase();
                 
                 if (type.includes('drop') || name.includes('drop')) color = '#ef4444';
                 else if (type.includes('break') || name.includes('break')) color = '#3b82f6';
                 else if (type.includes('intro') || name.includes('intro')) color = '#10b981';
                 else if (type.includes('outro') || name.includes('outro')) color = '#f59e0b';
                 else if (type.includes('chorus') || name.includes('chorus')) color = '#8b5cf6';
                 else if (type.includes('verse') || name.includes('verse')) color = '#6366f1';
                 
                 return (
                     <div 
                        key={i} 
                        className="mini-cue-marker"
                        style={{ left: `${pct}%`, backgroundColor: color }}
                        title={`${cue.name}`}
                     />
                 );
            })}
        </div>
    );
};

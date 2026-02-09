import React, { useState, useMemo, useCallback, useRef, useEffect, memo } from 'react';
import { FixedSizeList as List } from 'react-window';
import {
    Search,
    ArrowUpDown,
    ArrowUp,
    ArrowDown,
    Filter,
    Music,
    Play,
    Pause,
    Plus,
    CheckCircle,
    Sparkles,
    Star
} from 'lucide-react';
import './library.css';
import './loudnessIndicator.css';
import './trackNotes.css';
import { getKeyColor } from './keyUtils';
import LoudnessIndicator from './LoudnessIndicator';
import EnergySparkline from './EnergySparkline';

// Pre-computed Camelot wheel compatibility map for O(1) lookups
const COMPATIBLE_KEYS_MAP = new Map();
for (let num = 1; num <= 12; num++) {
    for (const letter of ['A', 'B']) {
        const key = `${num}${letter}`;
        const compatible = new Set([
            key,
            `${num === 12 ? 1 : num + 1}${letter}`,
            `${num === 1 ? 12 : num - 1}${letter}`,
            `${num}${letter === 'A' ? 'B' : 'A'}`
        ]);
        COMPATIBLE_KEYS_MAP.set(key, compatible);
    }
}

const LibraryTable = ({
    tracks,
    onTrackSelect,
    currentTrack,
    isPlaying,
    onPlayPause,
    onAddToSet,
    multiSelect = false,
    selectedTracks = [],
    onToggleTrack = null,
    onFindSimilar = null,
    onUpdateRating = null,
    showRating = false
}) => {
    const [sortConfig, setSortConfig] = useState({ key: null, direction: 'ascending' });
    const [filterText, setFilterText] = useState('');
    const [showCompatibleOnly, setShowCompatibleOnly] = useState(false);
    const [containerHeight, setContainerHeight] = useState(400);
    const containerRef = useRef(null);

    // Measure container height for virtualized list
    useEffect(() => {
        const updateHeight = () => {
            if (containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect();
                // Subtract header height (40px)
                setContainerHeight(Math.max(200, rect.height - 40));
            }
        };
        updateHeight();
        window.addEventListener('resize', updateHeight);
        return () => window.removeEventListener('resize', updateHeight);
    }, []);

    // O(1) key compatibility check
    const isKeyCompatible = useCallback((trackKey, referenceKey) => {
        if (!trackKey || !referenceKey) return false;
        const compatibleSet = COMPATIBLE_KEYS_MAP.get(referenceKey);
        return compatibleSet ? compatibleSet.has(trackKey) : false;
    }, []);

    const processedTracks = useMemo(() => {
        let result = [...tracks];

        // Filter by text
        if (filterText) {
            const lowerFilter = filterText.toLowerCase();
            result = result.filter(t =>
                (t.file.name || '').toLowerCase().includes(lowerFilter) ||
                (t.analysis.key || '').toLowerCase().includes(lowerFilter) ||
                (t.analysis.bpm || '').toString().includes(lowerFilter)
            );
        }

        // Filter by compatibility
        if (showCompatibleOnly && currentTrack?.analysis?.key) {
            const compatibleSet = COMPATIBLE_KEYS_MAP.get(currentTrack.analysis.key);
            if (compatibleSet) {
                result = result.filter(t => compatibleSet.has(t.analysis.key));
            }
        }

        // Sort
        if (sortConfig.key) {
            result.sort((a, b) => {
                let aVal, bVal;

                if (sortConfig.key === 'name') {
                    aVal = a.file.name;
                    bVal = b.file.name;
                } else if (sortConfig.key === 'rating') {
                    aVal = a.rating || 0;
                    bVal = b.rating || 0;
                } else {
                    aVal = a.analysis[sortConfig.key];
                    bVal = b.analysis[sortConfig.key];
                }

                // Handle numeric values
                if (sortConfig.key === 'bpm' || sortConfig.key === 'energy_level' || sortConfig.key === 'rating') {
                    aVal = parseFloat(aVal) || 0;
                    bVal = parseFloat(bVal) || 0;
                }

                if (aVal < bVal) return sortConfig.direction === 'ascending' ? -1 : 1;
                if (aVal > bVal) return sortConfig.direction === 'ascending' ? 1 : -1;
                return 0;
            });
        }

        return result;
    }, [tracks, filterText, sortConfig, showCompatibleOnly, currentTrack]);

    // Create a Set for fast multi-select lookup
    const selectedTrackPaths = useMemo(() => {
        return new Set(selectedTracks.map(t => t.file?.path || t.id));
    }, [selectedTracks]);

    const requestSort = useCallback((key) => {
        setSortConfig(prev => ({
            key,
            direction: prev.key === key && prev.direction === 'ascending' ? 'descending' : 'ascending'
        }));
    }, []);

    const getSortIcon = useCallback((name) => {
        if (sortConfig.key !== name) return <ArrowUpDown size={14} className="text-gray-400" />;
        return sortConfig.direction === 'ascending' ? <ArrowUp size={14} /> : <ArrowDown size={14} />;
    }, [sortConfig]);

    // Memoized row renderer for virtualized list
    const Row = useCallback(({ index, style }) => {
        const track = processedTracks[index];
        if (!track) return null;

        const isSelected = currentTrack === track;
        const isCompatible = currentTrack && !isSelected &&
            isKeyCompatible(track.analysis.key, currentTrack.analysis.key);
        const isMultiSelected = multiSelect && (
            selectedTrackPaths.has(track.file?.path) || selectedTrackPaths.has(track.id)
        );

        return (
            <div
                style={style}
                className={`library-row ${isSelected ? 'selected' : ''} ${isCompatible ? 'compatible' : ''} ${isMultiSelected ? 'multi-selected' : ''}`}
                onClick={() => {
                    if (multiSelect && onToggleTrack) {
                        onToggleTrack(track);
                    } else if (onTrackSelect) {
                        onTrackSelect(track);
                    }
                }}
            >
                {multiSelect && (
                    <div className="col-checkbox" onClick={(e) => e.stopPropagation()}>
                        <div className="checkbox-wrapper">
                            {isMultiSelected && <CheckCircle size={18} className="checkbox-checked" />}
                        </div>
                    </div>
                )}
                <div className="col-name">
                    <div className="track-name-cell">
                        <Music size={14} className="track-icon" />
                        <span className="track-name-text">{track.file.name}</span>
                    </div>
                </div>
                <div className="col-bpm">{Math.round(track.analysis.bpm)}</div>
                <div className="col-key">
                    <span
                        className={`key-pill ${isCompatible ? 'match' : ''}`}
                        style={{
                            backgroundColor: getKeyColor(track.analysis.key),
                            color: '#fff',
                            textShadow: '0 1px 2px rgba(0,0,0,0.5)'
                        }}
                    >
                        {track.analysis.key}
                    </span>
                </div>
                <div className="col-energy">
                    <EnergySparkline
                        energyData={track.analysis.energy_analysis?.energy_curve}
                        energyLevel={track.analysis.energy_analysis?.energy_level || 5}
                        width={60}
                        height={20}
                        isCompatible={isCompatible}
                    />
                </div>
                <div className="col-loudness">
                    <LoudnessIndicator
                        lufs={track.analysis.audio_stats?.lufs}
                        gainToTarget={track.analysis.audio_stats?.gain_to_target}
                        compact={true}
                    />
                </div>
                {showRating && (
                    <div className="col-rating">
                        <div className="rating-stars-compact">
                            {[1, 2, 3, 4, 5].map(star => (
                                <Star
                                    key={star}
                                    size={12}
                                    className={`star ${star <= (track.rating || 0) ? 'filled' : ''}`}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        const newRating = track.rating === star ? 0 : star;
                                        onUpdateRating?.(track.id || track.file?.path, newRating);
                                    }}
                                />
                            ))}
                        </div>
                    </div>
                )}
                {onFindSimilar && (
                    <div className="col-actions">
                        <button
                            className="find-similar-btn"
                            onClick={(e) => {
                                e.stopPropagation();
                                onFindSimilar(track);
                            }}
                            title="Find similar tracks"
                        >
                            <Sparkles size={14} />
                        </button>
                    </div>
                )}
            </div>
        );
    }, [processedTracks, currentTrack, multiSelect, selectedTrackPaths, onTrackSelect, onToggleTrack, isKeyCompatible, onFindSimilar, showRating, onUpdateRating]);

    return (
        <div className="library-container">
            {/* Toolbar */}
            <div className="library-toolbar">
                <div className="search-bar">
                    <Search size={16} />
                    <input
                        type="text"
                        placeholder="Search tracks..."
                        value={filterText}
                        onChange={(e) => setFilterText(e.target.value)}
                    />
                </div>

                <div className="filter-controls">
                    <button
                        className={`filter-btn ${showCompatibleOnly ? 'active' : ''}`}
                        onClick={() => setShowCompatibleOnly(!showCompatibleOnly)}
                        disabled={!currentTrack?.analysis?.key}
                        title={currentTrack ? `Show tracks compatible with ${currentTrack.analysis.key}` : "Select a track first"}
                    >
                        <Filter size={16} />
                        <span>Compatible Keys</span>
                    </button>
                    <span className="track-count">{processedTracks.length} tracks</span>
                </div>
            </div>

            {/* Virtualized Table */}
            <div className="library-table-wrapper" ref={containerRef}>
                {/* Fixed Header */}
                <div className="library-header">
                    {multiSelect && <div className="col-checkbox"></div>}
                    <div className="col-name header-cell" onClick={() => requestSort('name')}>
                        Track {getSortIcon('name')}
                    </div>
                    <div className="col-bpm header-cell" onClick={() => requestSort('bpm')}>
                        BPM {getSortIcon('bpm')}
                    </div>
                    <div className="col-key header-cell" onClick={() => requestSort('key')}>
                        Key {getSortIcon('key')}
                    </div>
                    <div className="col-energy header-cell" onClick={() => requestSort('energy')}>
                        Energy {getSortIcon('energy')}
                    </div>
                    <div className="col-loudness header-cell">
                        LUFS
                    </div>
                    {showRating && (
                        <div className="col-rating header-cell" onClick={() => requestSort('rating')}>
                            Rating {getSortIcon('rating')}
                        </div>
                    )}
                    {onFindSimilar && <div className="col-actions header-cell"></div>}
                </div>

                {/* Virtualized List */}
                <List
                    height={containerHeight}
                    itemCount={processedTracks.length}
                    itemSize={44}
                    width="100%"
                    className="library-virtual-list"
                >
                    {Row}
                </List>
            </div>
        </div>
    );
};

export default memo(LibraryTable);

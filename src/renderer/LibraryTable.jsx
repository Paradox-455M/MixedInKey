import React, { useState, useMemo } from 'react';
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
    CheckCircle
} from 'lucide-react';
import './library.css';
import { getKeyColor } from './keyUtils';

const LibraryTable = ({
    tracks,
    onTrackSelect,
    currentTrack,
    isPlaying,
    onPlayPause,
    onAddToSet,
    multiSelect = false,
    selectedTracks = [],
    onToggleTrack = null
}) => {
    const [sortConfig, setSortConfig] = useState({ key: null, direction: 'ascending' });
    const [filterText, setFilterText] = useState('');
    const [showCompatibleOnly, setShowCompatibleOnly] = useState(false);

    // Camelot Key Logic
    const getCompatibleKeys = (key) => {
        if (!key) return [];
        // Basic Camelot Wheel logic (current, +/- 1 hour, relative major/minor)
        // Format: "8A"
        const match = key.match(/(\d+)([AB])/);
        if (!match) return [];

        const num = parseInt(match[1]);
        const letter = match[2];

        const compatible = [key];

        // +/- 1 hour
        compatible.push(`${num === 12 ? 1 : num + 1}${letter}`);
        compatible.push(`${num === 1 ? 12 : num - 1}${letter}`);

        // Relative Major/Minor
        compatible.push(`${num}${letter === 'A' ? 'B' : 'A'}`);

        return compatible;
    };

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
            const compatibleKeys = getCompatibleKeys(currentTrack.analysis.key);
            result = result.filter(t => compatibleKeys.includes(t.analysis.key));
        }

        // Sort
        if (sortConfig.key) {
            result.sort((a, b) => {
                let aVal = sortConfig.key === 'name' ? a.file.name : a.analysis[sortConfig.key];
                let bVal = sortConfig.key === 'name' ? b.file.name : b.analysis[sortConfig.key];

                // Handle numeric values
                if (sortConfig.key === 'bpm' || sortConfig.key === 'energy_level') {
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

    const requestSort = (key) => {
        let direction = 'ascending';
        if (sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        setSortConfig({ key, direction });
    };

    const getSortIcon = (name) => {
        if (sortConfig.key !== name) return <ArrowUpDown size={14} className="text-gray-400" />;
        return sortConfig.direction === 'ascending' ? <ArrowUp size={14} /> : <ArrowDown size={14} />;
    };

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
                </div>
            </div>

            {/* Table */}
            <div className="library-table-wrapper">
                <table className="library-table">
                    <thead>
                        <tr>
                            {multiSelect && <th className="col-checkbox"></th>}
                            <th onClick={() => requestSort('name')}>Track {getSortIcon('name')}</th>
                            <th onClick={() => requestSort('bpm')}>BPM {getSortIcon('bpm')}</th>
                            <th onClick={() => requestSort('key')}>Key {getSortIcon('key')}</th>
                            <th onClick={() => requestSort('energy')}>Energy {getSortIcon('energy')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {processedTracks.map((track, idx) => {
                            const isSelected = currentTrack === track;
                            const isCompatible = currentTrack && !isSelected &&
                                getCompatibleKeys(currentTrack.analysis.key).includes(track.analysis.key);
                            const isMultiSelected = multiSelect && selectedTracks.some(t => 
                                (t.id && t.id === track.id) || 
                                (t.file?.path === track.file?.path)
                            );

                            return (
                                <tr
                                    key={idx}
                                    className={`
                    ${isSelected ? 'selected' : ''} 
                    ${isCompatible ? 'compatible' : ''}
                    ${isMultiSelected ? 'multi-selected' : ''}
                  `}
                                    onClick={() => {
                                        if (multiSelect && onToggleTrack) {
                                            onToggleTrack(track);
                                        } else if (onTrackSelect) {
                                            onTrackSelect(track);
                                        }
                                    }}
                                >
                                    {multiSelect && (
                                        <td className="col-checkbox" onClick={(e) => e.stopPropagation()}>
                                            <div className="checkbox-wrapper">
                                                {isMultiSelected && <CheckCircle size={18} className="checkbox-checked" />}
                                            </div>
                                        </td>
                                    )}
                                    <td className="col-name">
                                        <div className="track-name-cell">
                                            <Music size={14} className="track-icon" />
                                            {track.file.name}
                                        </div>
                                    </td>
                                    <td className="col-bpm">{Math.round(track.analysis.bpm)}</td>
                                    <td className="col-key">
                                        <span
                                            className={`key-pill ${isCompatible ? 'match' : ''}`}
                                            style={{
                                                backgroundColor: getKeyColor(track.analysis.key),
                                                color: '#fff', // White text on colored background
                                                textShadow: '0 1px 2px rgba(0,0,0,0.5)'
                                            }}
                                        >
                                            {track.analysis.key}
                                        </span>
                                    </td>
                                    <td className="col-energy">
                                        <div className="energy-bar">
                                            <div
                                                className="energy-fill"
                                                style={{
                                                    width: `${(track.analysis.energy_analysis?.energy_level || 5) * 10}%`,
                                                    backgroundColor: isCompatible ? '#10b981' : '#8b5cf6'
                                                }}
                                            />
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

export default LibraryTable;

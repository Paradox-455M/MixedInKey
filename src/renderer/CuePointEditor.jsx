import React, { useState, memo } from 'react';
import { X, Plus, Trash2, Edit2, Check, Flag } from 'lucide-react';

const CUE_COLORS = [
    { name: 'Red', color: '#ef4444' },
    { name: 'Orange', color: '#f59e0b' },
    { name: 'Yellow', color: '#eab308' },
    { name: 'Green', color: '#10b981' },
    { name: 'Blue', color: '#3b82f6' },
    { name: 'Purple', color: '#8b5cf6' },
    { name: 'Pink', color: '#ec4899' },
    { name: 'White', color: '#ffffff' }
];

const CuePointEditor = ({
    cuePoints = [],
    duration = 0,
    onAddCue,
    onUpdateCue,
    onDeleteCue,
    onSeekToCue,
    onClose
}) => {
    const [editingId, setEditingId] = useState(null);
    const [editName, setEditName] = useState('');
    const [editColor, setEditColor] = useState('#ef4444');
    const [newCueName, setNewCueName] = useState('');
    const [newCueTime, setNewCueTime] = useState('');
    const [newCueColor, setNewCueColor] = useState('#ef4444');
    const [showAddForm, setShowAddForm] = useState(false);

    const formatTime = (seconds) => {
        if (!seconds && seconds !== 0) return '00:00.0';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 10);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms}`;
    };

    const parseTime = (timeStr) => {
        const parts = timeStr.split(':');
        if (parts.length === 2) {
            const mins = parseInt(parts[0]) || 0;
            const secsAndMs = parts[1].split('.');
            const secs = parseInt(secsAndMs[0]) || 0;
            const ms = secsAndMs[1] ? parseInt(secsAndMs[1]) / 10 : 0;
            return mins * 60 + secs + ms;
        }
        return parseFloat(timeStr) || 0;
    };

    const handleStartEdit = (cue) => {
        setEditingId(cue.id || cue.time);
        setEditName(cue.name);
        setEditColor(cue.color || '#ef4444');
    };

    const handleSaveEdit = (cue) => {
        onUpdateCue?.(cue.id || cue.time, {
            ...cue,
            name: editName,
            color: editColor
        });
        setEditingId(null);
    };

    const handleAddCue = () => {
        if (!newCueName.trim()) return;
        const time = parseTime(newCueTime);
        if (time < 0 || time > duration) return;

        onAddCue?.({
            id: `custom-${Date.now()}`,
            name: newCueName.trim(),
            time,
            color: newCueColor,
            type: 'custom',
            isCustom: true
        });

        setNewCueName('');
        setNewCueTime('');
        setShowAddForm(false);
    };

    // Sort cue points by time
    const sortedCues = [...cuePoints].sort((a, b) => a.time - b.time);

    return (
        <div className="cue-editor-panel">
            <div className="cue-editor-header">
                <h4>
                    <Flag size={16} />
                    Cue Points ({cuePoints.length})
                </h4>
                <button className="cue-editor-close" onClick={onClose}>
                    <X size={16} />
                </button>
            </div>

            <div className="cue-editor-list">
                {sortedCues.map((cue, idx) => {
                    const isEditing = editingId === (cue.id || cue.time);
                    const cueColor = cue.color || '#ef4444';

                    return (
                        <div
                            key={cue.id || `cue-${idx}`}
                            className={`cue-editor-item ${isEditing ? 'editing' : ''}`}
                            style={{ borderLeftColor: cueColor }}
                        >
                            {isEditing ? (
                                <div className="cue-edit-form">
                                    <input
                                        type="text"
                                        value={editName}
                                        onChange={(e) => setEditName(e.target.value)}
                                        className="cue-edit-name"
                                        placeholder="Cue name"
                                        autoFocus
                                    />
                                    <div className="cue-color-picker">
                                        {CUE_COLORS.map(c => (
                                            <button
                                                key={c.color}
                                                className={`color-swatch ${editColor === c.color ? 'selected' : ''}`}
                                                style={{ backgroundColor: c.color }}
                                                onClick={() => setEditColor(c.color)}
                                                title={c.name}
                                            />
                                        ))}
                                    </div>
                                    <div className="cue-edit-actions">
                                        <button
                                            className="cue-save-btn"
                                            onClick={() => handleSaveEdit(cue)}
                                        >
                                            <Check size={14} />
                                        </button>
                                        <button
                                            className="cue-cancel-btn"
                                            onClick={() => setEditingId(null)}
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div
                                        className="cue-item-info"
                                        onClick={() => onSeekToCue?.(cue.time)}
                                    >
                                        <span
                                            className="cue-item-marker"
                                            style={{ backgroundColor: cueColor }}
                                        />
                                        <span className="cue-item-name">{cue.name}</span>
                                        <span className="cue-item-time">{formatTime(cue.time)}</span>
                                    </div>
                                    <div className="cue-item-actions">
                                        <button
                                            className="cue-edit-btn"
                                            onClick={() => handleStartEdit(cue)}
                                            title="Edit cue"
                                        >
                                            <Edit2 size={12} />
                                        </button>
                                        {cue.isCustom && (
                                            <button
                                                className="cue-delete-btn"
                                                onClick={() => onDeleteCue?.(cue.id || cue.time)}
                                                title="Delete cue"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    );
                })}

                {cuePoints.length === 0 && (
                    <div className="cue-empty-state">
                        No cue points. Click on the waveform to add one.
                    </div>
                )}
            </div>

            {/* Add Cue Form */}
            {showAddForm ? (
                <div className="cue-add-form">
                    <input
                        type="text"
                        value={newCueName}
                        onChange={(e) => setNewCueName(e.target.value)}
                        placeholder="Cue name (e.g., Drop)"
                        className="cue-add-name"
                        autoFocus
                    />
                    <input
                        type="text"
                        value={newCueTime}
                        onChange={(e) => setNewCueTime(e.target.value)}
                        placeholder="Time (mm:ss.s)"
                        className="cue-add-time"
                    />
                    <div className="cue-color-picker small">
                        {CUE_COLORS.slice(0, 4).map(c => (
                            <button
                                key={c.color}
                                className={`color-swatch ${newCueColor === c.color ? 'selected' : ''}`}
                                style={{ backgroundColor: c.color }}
                                onClick={() => setNewCueColor(c.color)}
                                title={c.name}
                            />
                        ))}
                    </div>
                    <div className="cue-add-actions">
                        <button className="cue-confirm-add" onClick={handleAddCue}>
                            <Check size={14} /> Add
                        </button>
                        <button className="cue-cancel-add" onClick={() => setShowAddForm(false)}>
                            Cancel
                        </button>
                    </div>
                </div>
            ) : (
                <button
                    className="cue-add-btn"
                    onClick={() => setShowAddForm(true)}
                >
                    <Plus size={14} />
                    Add Cue Point
                </button>
            )}
        </div>
    );
};

export default memo(CuePointEditor);

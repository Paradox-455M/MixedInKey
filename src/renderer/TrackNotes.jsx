import React, { useState, useCallback, memo } from 'react';
import { Star, Tag, X, Plus, MessageSquare } from 'lucide-react';

const PRESET_TAGS = [
    'Peak Time',
    'Opener',
    'Closer',
    'Warm Up',
    'Vocal',
    'Instrumental',
    'Classic',
    'New',
    'Festival',
    'Underground'
];

const TrackNotes = ({
    trackId,
    notes = '',
    rating = 0,
    tags = [],
    onUpdateNotes,
    onUpdateRating,
    onUpdateTags,
    compact = false
}) => {
    const [isEditingNotes, setIsEditingNotes] = useState(false);
    const [localNotes, setLocalNotes] = useState(notes);
    const [showTagPicker, setShowTagPicker] = useState(false);
    const [customTag, setCustomTag] = useState('');

    const handleRatingClick = useCallback((newRating) => {
        // Toggle off if clicking same rating
        const finalRating = rating === newRating ? 0 : newRating;
        onUpdateRating?.(trackId, finalRating);
    }, [trackId, rating, onUpdateRating]);

    const handleSaveNotes = useCallback(() => {
        onUpdateNotes?.(trackId, localNotes);
        setIsEditingNotes(false);
    }, [trackId, localNotes, onUpdateNotes]);

    const handleAddTag = useCallback((tag) => {
        if (!tags.includes(tag)) {
            onUpdateTags?.(trackId, [...tags, tag]);
        }
        setShowTagPicker(false);
    }, [trackId, tags, onUpdateTags]);

    const handleRemoveTag = useCallback((tagToRemove) => {
        onUpdateTags?.(trackId, tags.filter(t => t !== tagToRemove));
    }, [trackId, tags, onUpdateTags]);

    const handleAddCustomTag = useCallback(() => {
        if (customTag.trim() && !tags.includes(customTag.trim())) {
            onUpdateTags?.(trackId, [...tags, customTag.trim()]);
            setCustomTag('');
            setShowTagPicker(false);
        }
    }, [trackId, customTag, tags, onUpdateTags]);

    // Compact mode for library table row
    if (compact) {
        return (
            <div className="track-notes-compact">
                <div className="rating-stars-compact">
                    {[1, 2, 3, 4, 5].map(star => (
                        <Star
                            key={star}
                            size={12}
                            className={`star ${star <= rating ? 'filled' : ''}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                handleRatingClick(star);
                            }}
                        />
                    ))}
                </div>
                {notes && (
                    <MessageSquare size={12} className="has-notes-icon" title={notes} />
                )}
            </div>
        );
    }

    return (
        <div className="track-notes-panel">
            {/* Rating */}
            <div className="rating-section">
                <label className="section-label">Rating</label>
                <div className="rating-stars">
                    {[1, 2, 3, 4, 5].map(star => (
                        <button
                            key={star}
                            className={`star-btn ${star <= rating ? 'filled' : ''}`}
                            onClick={() => handleRatingClick(star)}
                        >
                            <Star size={20} fill={star <= rating ? 'currentColor' : 'none'} />
                        </button>
                    ))}
                </div>
            </div>

            {/* Tags */}
            <div className="tags-section">
                <label className="section-label">Tags</label>
                <div className="tags-container">
                    {tags.map(tag => (
                        <span key={tag} className="tag">
                            {tag}
                            <button
                                className="tag-remove"
                                onClick={() => handleRemoveTag(tag)}
                            >
                                <X size={10} />
                            </button>
                        </span>
                    ))}
                    <button
                        className="add-tag-btn"
                        onClick={() => setShowTagPicker(!showTagPicker)}
                    >
                        <Plus size={12} />
                        Add Tag
                    </button>
                </div>

                {showTagPicker && (
                    <div className="tag-picker">
                        <div className="preset-tags">
                            {PRESET_TAGS.filter(t => !tags.includes(t)).map(tag => (
                                <button
                                    key={tag}
                                    className="preset-tag"
                                    onClick={() => handleAddTag(tag)}
                                >
                                    {tag}
                                </button>
                            ))}
                        </div>
                        <div className="custom-tag-input">
                            <input
                                type="text"
                                value={customTag}
                                onChange={(e) => setCustomTag(e.target.value)}
                                placeholder="Custom tag..."
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleAddCustomTag();
                                }}
                            />
                            <button onClick={handleAddCustomTag}>Add</button>
                        </div>
                    </div>
                )}
            </div>

            {/* Notes */}
            <div className="notes-section">
                <label className="section-label">Notes</label>
                {isEditingNotes ? (
                    <div className="notes-editor">
                        <textarea
                            value={localNotes}
                            onChange={(e) => setLocalNotes(e.target.value)}
                            placeholder="Add your notes about this track..."
                            rows={3}
                            autoFocus
                        />
                        <div className="notes-actions">
                            <button className="save-notes-btn" onClick={handleSaveNotes}>
                                Save
                            </button>
                            <button
                                className="cancel-notes-btn"
                                onClick={() => {
                                    setLocalNotes(notes);
                                    setIsEditingNotes(false);
                                }}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                ) : (
                    <div
                        className="notes-display"
                        onClick={() => setIsEditingNotes(true)}
                    >
                        {notes || <span className="notes-placeholder">Click to add notes...</span>}
                    </div>
                )}
            </div>
        </div>
    );
};

export default memo(TrackNotes);

import React, { useState, useCallback, memo } from 'react';
import { X } from 'lucide-react';
import './hotCuePads.css';

const PAD_COLORS = [
    '#ef4444', // Red
    '#f97316', // Orange
    '#eab308', // Yellow
    '#22c55e', // Green
    '#06b6d4', // Cyan
    '#3b82f6', // Blue
    '#8b5cf6', // Purple
    '#ec4899'  // Pink
];

const HotCuePad = memo(({
    index,
    cue,
    isPlaying,
    onSet,
    onTrigger,
    onDelete
}) => {
    const isEmpty = !cue;
    const color = cue?.color || PAD_COLORS[index % PAD_COLORS.length];

    const handleClick = useCallback((e) => {
        e.stopPropagation();
        if (isEmpty) {
            onSet(index);
        } else {
            onTrigger(index, cue.time);
        }
    }, [isEmpty, index, cue, onSet, onTrigger]);

    const handleRightClick = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isEmpty) {
            onDelete(index);
        }
    }, [isEmpty, index, onDelete]);

    return (
        <button
            className={`hot-cue-pad ${isEmpty ? 'empty' : 'set'} ${isPlaying ? 'playing' : ''}`}
            style={{
                '--pad-color': color,
                backgroundColor: isEmpty ? undefined : `${color}20`
            }}
            onClick={handleClick}
            onContextMenu={handleRightClick}
            title={isEmpty ? `Set Hot Cue ${index + 1}` : `${cue.name || `Cue ${index + 1}`} - Right-click to delete`}
        >
            <span className="pad-number">{index + 1}</span>
            {!isEmpty && (
                <>
                    <span className="pad-time">{formatTime(cue.time)}</span>
                    <div className="pad-indicator" style={{ backgroundColor: color }} />
                </>
            )}
        </button>
    );
});

const HotCuePads = memo(({
    audioRef,
    currentTime = 0,
    cues = [],
    onCuesChange,
    deckId = 'A'
}) => {
    // Create 8 pad slots, filled with existing cues
    const [pads, setPads] = useState(() => {
        const slots = new Array(8).fill(null);
        // Fill slots with existing cues
        cues.slice(0, 8).forEach((cue, idx) => {
            slots[idx] = cue;
        });
        return slots;
    });

    // Update pads when cues prop changes
    React.useEffect(() => {
        const slots = new Array(8).fill(null);
        cues.slice(0, 8).forEach((cue, idx) => {
            // Try to maintain cue positions if they have slot index
            const slotIndex = cue.slot !== undefined ? cue.slot : idx;
            if (slotIndex < 8 && !slots[slotIndex]) {
                slots[slotIndex] = cue;
            } else {
                // Find first empty slot
                const emptyIndex = slots.findIndex(s => s === null);
                if (emptyIndex !== -1) {
                    slots[emptyIndex] = cue;
                }
            }
        });
        setPads(slots);
    }, [cues]);

    const handleSetCue = useCallback((index) => {
        if (!audioRef?.current) return;

        const time = audioRef.current.currentTime;
        const newCue = {
            id: `hot-${deckId}-${index}-${Date.now()}`,
            name: `Cue ${index + 1}`,
            time,
            color: PAD_COLORS[index],
            slot: index,
            type: 'hot_cue'
        };

        const newPads = [...pads];
        newPads[index] = newCue;
        setPads(newPads);

        onCuesChange?.(newPads.filter(Boolean));
    }, [audioRef, pads, deckId, onCuesChange]);

    const handleTriggerCue = useCallback((index, time) => {
        if (!audioRef?.current) return;
        audioRef.current.currentTime = time;
    }, [audioRef]);

    const handleDeleteCue = useCallback((index) => {
        const newPads = [...pads];
        newPads[index] = null;
        setPads(newPads);
        onCuesChange?.(newPads.filter(Boolean));
    }, [pads, onCuesChange]);

    const handleClearAll = useCallback(() => {
        setPads(new Array(8).fill(null));
        onCuesChange?.([]);
    }, [onCuesChange]);

    const usedPads = pads.filter(Boolean).length;

    return (
        <div className="hot-cue-pads">
            <div className="hot-cue-header">
                <span>HOT CUES</span>
                <span className="pad-count">{usedPads}/8</span>
                {usedPads > 0 && (
                    <button
                        className="clear-all-btn"
                        onClick={handleClearAll}
                        title="Clear all hot cues"
                    >
                        <X size={12} />
                    </button>
                )}
            </div>

            <div className="hot-cue-grid">
                {pads.map((cue, index) => (
                    <HotCuePad
                        key={index}
                        index={index}
                        cue={cue}
                        isPlaying={cue && Math.abs(currentTime - cue.time) < 0.5}
                        onSet={handleSetCue}
                        onTrigger={handleTriggerCue}
                        onDelete={handleDeleteCue}
                    />
                ))}
            </div>

            <div className="hot-cue-hint">
                Click to set/trigger • Right-click to delete
            </div>
        </div>
    );
});

// Format time as MM:SS.ms
const formatTime = (seconds) => {
    if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms}`;
};

export default HotCuePads;

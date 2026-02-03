import React, { useState, useCallback, useEffect, memo } from 'react';
import { Repeat, ArrowLeftToLine, ArrowRightToLine, Minus, Plus } from 'lucide-react';
import './loopControls.css';

const LOOP_SIZES = [0.25, 0.5, 1, 2, 4, 8, 16, 32]; // In beats

const LoopControls = memo(({
    audioRef,
    bpm = 120,
    currentTime = 0,
    duration = 0,
    onLoopChange
}) => {
    const [isLooping, setIsLooping] = useState(false);
    const [loopStart, setLoopStart] = useState(null);
    const [loopEnd, setLoopEnd] = useState(null);
    const [selectedSize, setSelectedSize] = useState(4); // Default 4 beats

    // Calculate beat duration in seconds
    const beatDuration = 60 / bpm;

    // Handle loop enforcement
    useEffect(() => {
        if (!audioRef?.current || !isLooping || loopStart === null || loopEnd === null) return;

        const audio = audioRef.current;

        const checkLoop = () => {
            if (audio.currentTime >= loopEnd) {
                audio.currentTime = loopStart;
            }
        };

        const interval = setInterval(checkLoop, 10); // Check every 10ms

        return () => clearInterval(interval);
    }, [audioRef, isLooping, loopStart, loopEnd]);

    // Set loop at current position with selected beat length
    const handleSetLoop = useCallback(() => {
        if (!audioRef?.current) return;

        const loopDuration = selectedSize * beatDuration;
        const start = audioRef.current.currentTime;
        const end = Math.min(start + loopDuration, duration);

        setLoopStart(start);
        setLoopEnd(end);
        setIsLooping(true);
        onLoopChange?.({ start, end, size: selectedSize, active: true });
    }, [audioRef, selectedSize, beatDuration, duration, onLoopChange]);

    // Set loop in point
    const handleLoopIn = useCallback(() => {
        if (!audioRef?.current) return;
        const start = audioRef.current.currentTime;
        setLoopStart(start);

        if (loopEnd !== null && start < loopEnd) {
            setIsLooping(true);
            onLoopChange?.({ start, end: loopEnd, size: null, active: true });
        }
    }, [audioRef, loopEnd, onLoopChange]);

    // Set loop out point
    const handleLoopOut = useCallback(() => {
        if (!audioRef?.current) return;
        const end = audioRef.current.currentTime;
        setLoopEnd(end);

        if (loopStart !== null && end > loopStart) {
            setIsLooping(true);
            onLoopChange?.({ start: loopStart, end, size: null, active: true });
        }
    }, [audioRef, loopStart, onLoopChange]);

    // Toggle loop on/off
    const handleToggleLoop = useCallback(() => {
        if (loopStart !== null && loopEnd !== null) {
            const newLooping = !isLooping;
            setIsLooping(newLooping);
            onLoopChange?.({ start: loopStart, end: loopEnd, size: selectedSize, active: newLooping });
        }
    }, [isLooping, loopStart, loopEnd, selectedSize, onLoopChange]);

    // Double loop length
    const handleDoubleLoop = useCallback(() => {
        if (loopStart === null || loopEnd === null) return;

        const currentLength = loopEnd - loopStart;
        const newEnd = Math.min(loopStart + currentLength * 2, duration);
        setLoopEnd(newEnd);
        onLoopChange?.({ start: loopStart, end: newEnd, size: null, active: isLooping });
    }, [loopStart, loopEnd, duration, isLooping, onLoopChange]);

    // Halve loop length
    const handleHalveLoop = useCallback(() => {
        if (loopStart === null || loopEnd === null) return;

        const currentLength = loopEnd - loopStart;
        if (currentLength > beatDuration * 0.25) { // Minimum 1/4 beat
            const newEnd = loopStart + currentLength / 2;
            setLoopEnd(newEnd);
            onLoopChange?.({ start: loopStart, end: newEnd, size: null, active: isLooping });
        }
    }, [loopStart, loopEnd, beatDuration, isLooping, onLoopChange]);

    // Clear loop
    const handleClearLoop = useCallback(() => {
        setIsLooping(false);
        setLoopStart(null);
        setLoopEnd(null);
        onLoopChange?.(null);
    }, [onLoopChange]);

    // Set loop size and apply instantly
    const handleSizeClick = useCallback((size) => {
        setSelectedSize(size);

        // If we have a loop start, update the loop end
        if (loopStart !== null) {
            const loopDuration = size * beatDuration;
            const newEnd = Math.min(loopStart + loopDuration, duration);
            setLoopEnd(newEnd);
            setIsLooping(true);
            onLoopChange?.({ start: loopStart, end: newEnd, size, active: true });
        }
    }, [loopStart, beatDuration, duration, onLoopChange]);

    // Format loop size for display
    const formatSize = (size) => {
        if (size < 1) return `1/${Math.round(1 / size)}`;
        return String(size);
    };

    // Calculate loop length in beats for display
    const loopBeats = loopStart !== null && loopEnd !== null
        ? ((loopEnd - loopStart) / beatDuration).toFixed(1)
        : null;

    return (
        <div className="loop-controls">
            <div className="loop-header">
                <Repeat size={14} />
                <span>LOOP</span>
                {loopBeats && (
                    <span className="loop-length-badge">{loopBeats} beats</span>
                )}
            </div>

            <div className="loop-buttons-row">
                {/* Loop In/Out */}
                <button
                    className={`loop-btn loop-in ${loopStart !== null ? 'set' : ''}`}
                    onClick={handleLoopIn}
                    title="Set Loop In"
                >
                    <ArrowLeftToLine size={12} />
                    <span>IN</span>
                </button>

                {/* Loop Toggle */}
                <button
                    className={`loop-btn loop-toggle ${isLooping ? 'active' : ''}`}
                    onClick={handleToggleLoop}
                    disabled={loopStart === null || loopEnd === null}
                    title={isLooping ? 'Exit Loop' : 'Enter Loop'}
                >
                    <Repeat size={14} />
                </button>

                {/* Loop Out */}
                <button
                    className={`loop-btn loop-out ${loopEnd !== null ? 'set' : ''}`}
                    onClick={handleLoopOut}
                    title="Set Loop Out"
                >
                    <ArrowRightToLine size={12} />
                    <span>OUT</span>
                </button>
            </div>

            {/* Size Buttons */}
            <div className="loop-size-buttons">
                {LOOP_SIZES.map(size => (
                    <button
                        key={size}
                        className={`loop-size-btn ${selectedSize === size ? 'selected' : ''}`}
                        onClick={() => handleSizeClick(size)}
                    >
                        {formatSize(size)}
                    </button>
                ))}
            </div>

            {/* Size Adjustment */}
            <div className="loop-adjust-row">
                <button
                    className="loop-adjust-btn"
                    onClick={handleHalveLoop}
                    disabled={!isLooping}
                    title="Halve Loop"
                >
                    <Minus size={12} />
                    <span>/2</span>
                </button>
                <button
                    className="loop-clear-btn"
                    onClick={handleClearLoop}
                    disabled={loopStart === null && loopEnd === null}
                    title="Clear Loop"
                >
                    CLR
                </button>
                <button
                    className="loop-adjust-btn"
                    onClick={handleDoubleLoop}
                    disabled={!isLooping}
                    title="Double Loop"
                >
                    <Plus size={12} />
                    <span>×2</span>
                </button>
            </div>
        </div>
    );
});

export default LoopControls;

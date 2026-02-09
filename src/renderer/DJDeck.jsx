// Add audio logic to DJDeck
import React, { useRef, useState, useEffect, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import { useDropzone } from 'react-dropzone';
import { Music, X, Upload, Play, Pause, ZoomIn, ZoomOut, Flag, Crosshair, MoveHorizontal } from 'lucide-react';
import WaveformCanvas from './WaveformCanvas';
import WaveformOverview from './WaveformOverview';
import CuePointEditor from './CuePointEditor';
import { getKeyColor } from './keyUtils';
import './cueEditor.css';

const ZOOM_LEVELS = [1, 2, 4, 8];

const PAD_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];

const DJDeck = forwardRef(({
    id,
    track,
    isActive,
    onActivate,
    onLoadTrack,
    onClear,
    performanceLoop,  // { active, start, end, size } from MixerPanel
    performanceCues   // Array of 8 cue objects from MixerPanel
}, ref) => {
    const [hoveredCue, setHoveredCue] = useState(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [displayTime, setDisplayTime] = useState(0);  // Throttled time for display
    const [zoomLevel, setZoomLevel] = useState(1); // 1x, 2x, 4x, 8x
    const [showCueEditor, setShowCueEditor] = useState(false);
    const [customCues, setCustomCues] = useState([]); // User-added cue points
    const [scrollMode, setScrollMode] = useState(false); // Waveform scrolls, playhead centered
    const [quantizeEnabled, setQuantizeEnabled] = useState(false); // Snap to beats
    const [renderMode, setRenderMode] = useState('rgb'); // 'rgb' | 'single'
    const [waveformWidth, setWaveformWidth] = useState(600); // Dynamic width
    const deckRef = useRef(null);
    const audioRef = useRef(null);
    const waveformContainerRef = useRef(null);
    const currentTimeRef = useRef(0);  // Real-time tracking without re-renders
    const updateIntervalRef = useRef(null);

    // Measure waveform container width for responsive rendering
    useEffect(() => {
        const container = waveformContainerRef.current;
        if (!container) return;

        const updateWidth = () => {
            const width = container.clientWidth;
            if (width > 0) setWaveformWidth(width);
        };

        // Initial measurement
        updateWidth();

        // Resize observer for dynamic updates
        const resizeObserver = new ResizeObserver(updateWidth);
        resizeObserver.observe(container);

        return () => resizeObserver.disconnect();
    }, [track]);

    // Reset state when track changes
    useEffect(() => {
        setIsPlaying(false);
        setDisplayTime(0);
        setZoomLevel(1);
        setShowCueEditor(false);
        setCustomCues([]);
        // Keep scroll mode, quantize, and render mode preferences
        currentTimeRef.current = 0;
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
        }
    }, [track]);

    // Combine analysis cue points with custom cues
    const allCuePoints = useMemo(() => {
        const analysisCues = (track?.analysis?.cue_points || []).map(cue => ({
            ...cue,
            id: cue.id || `analysis-${cue.time}`,
            isCustom: false
        }));
        return [...analysisCues, ...customCues];
    }, [track?.analysis?.cue_points, customCues]);

    // Cue point handlers
    const handleAddCue = useCallback((cue) => {
        setCustomCues(prev => [...prev, cue]);
    }, []);

    const handleUpdateCue = useCallback((cueId, updatedCue) => {
        setCustomCues(prev => prev.map(c =>
            (c.id === cueId) ? { ...c, ...updatedCue } : c
        ));
    }, []);

    const handleDeleteCue = useCallback((cueId) => {
        setCustomCues(prev => prev.filter(c => c.id !== cueId));
    }, []);

    const handleSeekToCue = useCallback((time) => {
        if (audioRef.current && track) {
            audioRef.current.currentTime = time;
            currentTimeRef.current = time;
            setDisplayTime(time);
        }
    }, [track]);

    // Add cue at click position on waveform
    const handleWaveformRightClick = useCallback((e) => {
        e.preventDefault();
        if (!track || !deckRef.current) return;

        const rect = deckRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const width = rect.width;
        const duration = track.duration || track.analysis?.duration || 300;
        const clickTime = (x / width) * duration;

        // Add a new cue at click position
        const newCue = {
            id: `custom-${Date.now()}`,
            name: `Cue ${customCues.length + 1}`,
            time: clickTime,
            color: '#ef4444',
            type: 'custom',
            isCustom: true
        };
        setCustomCues(prev => [...prev, newCue]);
        setShowCueEditor(true);
    }, [track, customCues.length]);

    // Zoom handlers
    const handleZoomIn = useCallback((e) => {
        e.stopPropagation();
        setZoomLevel(prev => {
            const idx = ZOOM_LEVELS.indexOf(prev);
            return idx < ZOOM_LEVELS.length - 1 ? ZOOM_LEVELS[idx + 1] : prev;
        });
    }, []);

    const handleZoomOut = useCallback((e) => {
        e.stopPropagation();
        setZoomLevel(prev => {
            const idx = ZOOM_LEVELS.indexOf(prev);
            return idx > 0 ? ZOOM_LEVELS[idx - 1] : prev;
        });
    }, []);

    const handleWheel = useCallback((e) => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            if (e.deltaY < 0) {
                setZoomLevel(prev => {
                    const idx = ZOOM_LEVELS.indexOf(prev);
                    return idx < ZOOM_LEVELS.length - 1 ? ZOOM_LEVELS[idx + 1] : prev;
                });
            } else {
                setZoomLevel(prev => {
                    const idx = ZOOM_LEVELS.indexOf(prev);
                    return idx > 0 ? ZOOM_LEVELS[idx - 1] : prev;
                });
            }
        }
    }, []);

    // Calculate viewport position (center around playhead)
    const viewportStart = useMemo(() => {
        if (zoomLevel <= 1) return 0;
        const duration = track?.duration || track?.analysis?.duration || 1;
        const progress = displayTime / duration;
        // Keep playhead centered in viewport
        const viewportSize = 1 / zoomLevel;
        return Math.max(0, Math.min(1 - viewportSize, progress - viewportSize / 2));
    }, [zoomLevel, displayTime, track]);

    // Throttled display time updates (5fps instead of 4-10fps native events)
    useEffect(() => {
        if (isPlaying) {
            // Update display time at 5fps (every 200ms)
            updateIntervalRef.current = setInterval(() => {
                setDisplayTime(currentTimeRef.current);
            }, 200);
        } else {
            if (updateIntervalRef.current) {
                clearInterval(updateIntervalRef.current);
                updateIntervalRef.current = null;
            }
            // Sync display time when paused
            setDisplayTime(currentTimeRef.current);
        }

        return () => {
            if (updateIntervalRef.current) {
                clearInterval(updateIntervalRef.current);
            }
        };
    }, [isPlaying]);

    const togglePlay = useCallback((e) => {
        e.stopPropagation();
        if (!audioRef.current) return;

        if (isPlaying) {
            audioRef.current.pause();
        } else {
            audioRef.current.play();
        }
        setIsPlaying(!isPlaying);
    }, [isPlaying]);

    // Update ref without causing re-render
    const handleTimeUpdate = useCallback(() => {
        if (audioRef.current) {
            currentTimeRef.current = audioRef.current.currentTime;
        }
    }, []);

    const handleEnded = useCallback(() => {
        setIsPlaying(false);
        currentTimeRef.current = 0;
        setDisplayTime(0);
    }, []);

    // Expose deck controls to parent via ref
    useImperativeHandle(ref, () => ({
        play: () => {
            if (audioRef.current && track) {
                audioRef.current.play();
                setIsPlaying(true);
            }
        },
        pause: () => {
            if (audioRef.current) {
                audioRef.current.pause();
                setIsPlaying(false);
            }
        },
        togglePlay: () => {
            if (!audioRef.current || !track) return;
            if (isPlaying) {
                audioRef.current.pause();
                setIsPlaying(false);
            } else {
                audioRef.current.play();
                setIsPlaying(true);
            }
        },
        seek: (seconds) => {
            if (audioRef.current && track) {
                const newTime = Math.max(0, Math.min(
                    audioRef.current.currentTime + seconds,
                    audioRef.current.duration || 0
                ));
                audioRef.current.currentTime = newTime;
                currentTimeRef.current = newTime;
                setDisplayTime(newTime);
            }
        },
        seekTo: (time) => {
            if (audioRef.current && track) {
                const newTime = Math.max(0, Math.min(time, audioRef.current.duration || 0));
                audioRef.current.currentTime = newTime;
                currentTimeRef.current = newTime;
                setDisplayTime(newTime);
            }
        },
        isPlaying: () => isPlaying,
        getCurrentTime: () => currentTimeRef.current,
        hasTrack: () => !!track,
        getAudioElement: () => audioRef.current,
        getAudioRef: () => audioRef
    }), [isPlaying, track]);

    const onDrop = (acceptedFiles) => {
        if (acceptedFiles.length > 0) {
            onLoadTrack(acceptedFiles[0]);
        }
    };

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: { 'audio/*': [] },
        noClick: !!track, // Disable click if track exists
        noKeyboard: true
    });

    const handleMouseMove = (e) => {
        if (!track || !track.analysis || !deckRef.current) return;
        
        const rect = deckRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const width = rect.width;
        const duration = track.duration || track.analysis.duration || 300;
        
        // Find if hovering over a cue point (within 10px threshold)
        const hoverTime = (x / width) * duration;
        const cues = track.analysis.cue_points || [];
        
        // Pixels per second at this width
        const pxPerSec = width / duration;
        const thresholdSec = 10 / pxPerSec; // 10px threshold converted to seconds

        const nearbyCue = cues.find(cue => Math.abs(cue.time - hoverTime) < thresholdSec);
        setHoveredCue(nearbyCue || null);
    };

    const handleMouseLeave = () => {
        setHoveredCue(null);
    };

    // Snap time to nearest beat if quantize is enabled
    const quantizeTime = useCallback((time) => {
        if (!quantizeEnabled) return time;
        const downbeats = track?.analysis?.downbeats || [];
        if (downbeats.length === 0) return time;

        // Find nearest downbeat
        let nearestBeat = downbeats[0];
        let minDiff = Math.abs(time - nearestBeat);

        for (const beat of downbeats) {
            const diff = Math.abs(time - beat);
            if (diff < minDiff) {
                minDiff = diff;
                nearestBeat = beat;
            }
        }

        return nearestBeat;
    }, [quantizeEnabled, track?.analysis?.downbeats]);

    const handleWaveformClick = useCallback((e) => {
        e.stopPropagation();
        if (!track || !audioRef.current || !deckRef.current) return;

        const rect = deckRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const width = rect.width;
        const duration = track.duration || track.analysis?.duration || 300;

        let seekTime = (x / width) * duration;

        // Apply quantize if enabled
        seekTime = quantizeTime(seekTime);

        audioRef.current.currentTime = seekTime;
        currentTimeRef.current = seekTime;
        setDisplayTime(seekTime);
    }, [track, quantizeTime]);

    // Handle seek from overview waveform
    const handleOverviewSeek = useCallback((time) => {
        if (!audioRef.current || !track) return;
        const quantizedTime = quantizeTime(time);
        audioRef.current.currentTime = quantizedTime;
        currentTimeRef.current = quantizedTime;
        setDisplayTime(quantizedTime);
    }, [track, quantizeTime]);

    // Memoize waveform data to prevent unnecessary WaveformCanvas re-renders
    const memoizedWaveformData = useMemo(
        () => track?.analysis?.waveform_data || [],
        [track?.analysis?.waveform_data]
    );

    // Memoize RGB waveform data
    const memoizedRgbWaveformData = useMemo(
        () => track?.analysis?.rgb_waveform_data || null,
        [track?.analysis?.rgb_waveform_data]
    );

    // Get track duration
    const trackDuration = useMemo(
        () => track?.duration || track?.analysis?.duration || 0,
        [track?.duration, track?.analysis?.duration]
    );

    return (
        <div 
            className={`dj-deck ${isActive ? 'active' : ''}`}
            onClick={onActivate}
            {...getRootProps()}
        >
            <input {...getInputProps()} />
            
            {!track ? (
                <div className="deck-empty-state">
                    <div className="deck-id">DECK {id}</div>
                    <Upload size={48} className="deck-empty-icon" />
                    <p>{isDragActive ? 'Drop audio file here' : 'Drag & Drop a song'}</p>
                    <p className="deck-subtitle">or click to browse</p>
                </div>
            ) : (
                <div className="deck-content">
                    {/* Hidden Audio Element */}
                    <audio 
                        ref={audioRef}
                        src={`file://${track.file.path}`}
                        onTimeUpdate={handleTimeUpdate}
                        onEnded={handleEnded}
                    />

                    {/* Header */}
                    <div className="deck-header">
                        <div className="deck-id-badge">DECK {id}</div>
                        <div className="deck-meta">
                            <div className="deck-title">{track.file?.name || track.name}</div>
                            <div className="deck-details">
                                <span className="deck-bpm">
                                    {Math.round(track.analysis?.bpm || 0)} BPM
                                </span>
                                <span 
                                    className="deck-key"
                                    style={{ backgroundColor: getKeyColor(track.analysis?.key) }}
                                >
                                    {track.analysis?.key || 'N/A'}
                                </span>
                                <span className="deck-time">
                                    {formatTime(displayTime)} / {formatTime(track.duration || track.analysis?.duration)}
                                </span>
                            </div>
                        </div>
                        <div className="deck-controls">
                            <button
                                className={`deck-play-btn ${isPlaying ? 'playing' : ''}`}
                                onClick={togglePlay}
                            >
                                {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
                            </button>
                            <button
                                className={`deck-mode-btn ${quantizeEnabled ? 'active quantize' : ''}`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setQuantizeEnabled(prev => !prev);
                                }}
                                title={quantizeEnabled ? 'Quantize ON - Click to disable' : 'Quantize OFF - Click to enable'}
                            >
                                Q
                            </button>
                            <button
                                className={`deck-mode-btn ${scrollMode ? 'active scroll' : ''}`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setScrollMode(prev => !prev);
                                }}
                                title={scrollMode ? 'Scroll Mode - Playhead centered' : 'Static Mode - Playhead moves'}
                            >
                                <MoveHorizontal size={14} />
                            </button>
                            <button
                                className={`cue-editor-toggle ${showCueEditor ? 'active' : ''}`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setShowCueEditor(prev => !prev);
                                }}
                                title="Edit Cue Points"
                            >
                                <Flag size={14} />
                            </button>
                            <button
                                className="deck-clear-btn"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onClear();
                                }}
                            >
                                <X size={16} />
                            </button>
                        </div>
                    </div>

                    {/* Overview Waveform - shows when zoomed */}
                    {zoomLevel > 1 && (
                        <WaveformOverview
                            waveformData={memoizedWaveformData}
                            rgbWaveformData={memoizedRgbWaveformData}
                            renderMode={renderMode}
                            width={waveformWidth}
                            height={30}
                            color={id === 'A' ? '#8b5cf6' : '#ec4899'}
                            currentTime={displayTime}
                            duration={trackDuration}
                            zoom={zoomLevel}
                            viewportStart={viewportStart}
                            onSeek={handleOverviewSeek}
                        />
                    )}

                    {/* Waveform Area */}
                    <div
                        className="deck-waveform-container"
                        ref={(el) => {
                            waveformContainerRef.current = el;
                            deckRef.current = el;
                        }}
                        onMouseMove={handleMouseMove}
                        onMouseLeave={handleMouseLeave}
                        onClick={handleWaveformClick}
                        onContextMenu={handleWaveformRightClick}
                        onWheel={handleWheel}
                    >
                        <WaveformCanvas
                            waveformData={memoizedWaveformData}
                            rgbWaveformData={memoizedRgbWaveformData}
                            renderMode={renderMode}
                            width={waveformWidth}
                            height={120}
                            color={id === 'A' ? '#8b5cf6' : '#ec4899'}
                            zoom={zoomLevel}
                            viewportStart={viewportStart}
                            scrollMode={scrollMode}
                            currentTime={displayTime}
                            duration={trackDuration}
                        />

                        {/* Zoom Controls */}
                        <div className="deck-zoom-controls">
                            <button
                                className="zoom-btn"
                                onClick={handleZoomOut}
                                disabled={zoomLevel === 1}
                                title="Zoom Out"
                            >
                                <ZoomOut size={14} />
                            </button>
                            <span className="zoom-level">{zoomLevel}x</span>
                            <button
                                className="zoom-btn"
                                onClick={handleZoomIn}
                                disabled={zoomLevel === 8}
                                title="Zoom In"
                            >
                                <ZoomIn size={14} />
                            </button>
                            <button
                                className={`waveform-mode-btn ${renderMode === 'rgb' ? 'active' : ''}`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setRenderMode(prev => prev === 'rgb' ? 'single' : 'rgb');
                                }}
                                title={renderMode === 'rgb' ? 'RGB Waveform' : 'Single Color Waveform'}
                            >
                                RGB
                            </button>
                        </div>

                        {/* Playhead - always at center when zoomed or in scroll mode */}
                        <div
                            className={`deck-playhead ${scrollMode ? 'scroll-mode' : ''}`}
                            style={{
                                left: (zoomLevel > 1 || scrollMode) ? '50%' : `${(displayTime / (trackDuration || 1)) * 100}%`
                            }}
                        />
                        
                        {/* Cue Markers Overlay */}
                        <div className="deck-cues-overlay">
                            {allCuePoints.map((cue, idx) => {
                                const duration = track.duration || track.analysis?.duration || 300;
                                const leftPct = (cue.time / duration) * 100;

                                // For custom cues, use their color directly
                                if (cue.isCustom) {
                                    return (
                                        <div
                                            key={cue.id || idx}
                                            className="deck-cue-marker type-custom"
                                            style={{
                                                left: `${leftPct}%`,
                                                background: cue.color || '#ef4444'
                                            }}
                                        />
                                    );
                                }

                                // Determine cue type class for analysis cues
                                let cueClass = 'type-generic';
                                const nameLower = (cue.name || '').toLowerCase();
                                const typeLower = (cue.type || '').toLowerCase();

                                if (typeLower.includes('drop') || nameLower.includes('drop')) cueClass = 'type-drop';
                                else if (typeLower.includes('chorus') || nameLower.includes('chorus')) cueClass = 'type-chorus';
                                else if (typeLower.includes('build') || nameLower.includes('build')) cueClass = 'type-build';
                                else if (typeLower.includes('break') || nameLower.includes('break')) cueClass = 'type-breakdown';
                                else if (typeLower.includes('hook') || nameLower.includes('hook')) cueClass = 'type-hook';
                                else if (typeLower.includes('vocal') || nameLower.includes('vocal')) cueClass = 'type-vocal';
                                else if (typeLower.includes('intro') || nameLower.includes('intro')) cueClass = 'type-intro';
                                else if (typeLower.includes('outro') || nameLower.includes('outro')) cueClass = 'type-outro';

                                return (
                                    <div
                                        key={cue.id || idx}
                                        className={`deck-cue-marker ${cueClass}`}
                                        style={{ left: `${leftPct}%` }}
                                    />
                                );
                            })}
                        </div>

                        {/* Song Structure Overlay */}
                        <div className="deck-structure-overlay">
                            {(track.analysis?.song_structure || []).map((section, idx) => {
                                const dur = track.duration || track.analysis?.duration || 300;
                                const startPct = (section.start / dur) * 100;
                                const widthPct = (((section.end || section.start) - section.start) / dur) * 100;
                                return (
                                    <div
                                        key={`structure-${idx}`}
                                        className={`structure-section section-${section.type}`}
                                        style={{ left: `${startPct}%`, width: `${widthPct}%` }}
                                        title={`${section.type}${section.instance > 1 ? ' ' + section.instance : ''}`}
                                    >
                                        <span className="structure-label">{section.type}</span>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Phrase Markers Overlay */}
                        <div className="deck-phrases-overlay">
                            {(track.analysis?.phrase_markers || []).map((phrase, idx) => {
                                const duration = track.duration || track.analysis?.duration || 300;
                                const leftPct = (phrase.time / duration) * 100;

                                // Determine phrase class based on bar length
                                let phraseClass = 'phrase-8bar';
                                if (phrase.bar_length >= 32) phraseClass = 'phrase-32bar';
                                else if (phrase.bar_length >= 16) phraseClass = 'phrase-16bar';

                                return (
                                    <div
                                        key={`phrase-${idx}`}
                                        className={`deck-phrase-marker ${phraseClass}`}
                                        style={{ left: `${leftPct}%` }}
                                        title={`${phrase.bar_length}-bar phrase`}
                                    />
                                );
                            })}
                        </div>

                        {/* Loop Markers Overlay */}
                        <div className="deck-loops-overlay">
                            {(track.analysis?.loop_markers || []).map((loop, idx) => {
                                const duration = track.duration || track.analysis?.duration || 300;
                                const startPct = (loop.start_time / duration) * 100;
                                const widthPct = ((loop.end_time - loop.start_time) / duration) * 100;

                                return (
                                    <div
                                        key={`loop-${idx}`}
                                        className={`deck-loop-region loop-${loop.bar_length}bar`}
                                        style={{
                                            left: `${startPct}%`,
                                            width: `${widthPct}%`
                                        }}
                                        title={`${loop.bar_length}-bar loop (${Math.round(loop.confidence * 100)}% match)`}
                                    >
                                        <span className="loop-label">{loop.bar_length}</span>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Beat Grid Overlay */}
                        <div className="deck-beatgrid-overlay">
                            {(track.analysis?.downbeats || []).map((beatTime, idx) => {
                                const duration = track.duration || track.analysis?.duration || 300;
                                const leftPct = (beatTime / duration) * 100;
                                // Show downbeats (bar starts) more prominently
                                const isDownbeat = idx % 4 === 0;

                                return (
                                    <div
                                        key={`beat-${idx}`}
                                        className={`deck-beat-marker ${isDownbeat ? 'downbeat' : 'beat'}`}
                                        style={{ left: `${leftPct}%` }}
                                    />
                                );
                            })}
                        </div>

                        {/* Performance Loop Overlay */}
                        {performanceLoop?.active && performanceLoop.start !== null && performanceLoop.end !== null && (
                            <div className="deck-performance-loop-overlay">
                                {(() => {
                                    const duration = track.duration || track.analysis?.duration || 300;
                                    const startPct = (performanceLoop.start / duration) * 100;
                                    const endPct = (performanceLoop.end / duration) * 100;
                                    const widthPct = endPct - startPct;
                                    return (
                                        <div
                                            className="performance-loop-region active"
                                            style={{
                                                left: `${startPct}%`,
                                                width: `${widthPct}%`
                                            }}
                                            title={`${performanceLoop.size}-beat loop`}
                                        >
                                            <div className="loop-bracket loop-start" />
                                            <div className="loop-bracket loop-end" />
                                            <span className="loop-size-label">{performanceLoop.size}</span>
                                        </div>
                                    );
                                })()}
                            </div>
                        )}

                        {/* Performance Hot Cues Overlay */}
                        {performanceCues && (
                            <div className="deck-performance-cues-overlay">
                                {performanceCues.map((cue, idx) => {
                                    if (!cue) return null;
                                    const duration = track.duration || track.analysis?.duration || 300;
                                    const leftPct = (cue.time / duration) * 100;
                                    const color = PAD_COLORS[idx] || '#ef4444';
                                    return (
                                        <div
                                            key={`perf-cue-${idx}`}
                                            className="performance-cue-marker"
                                            style={{
                                                left: `${leftPct}%`,
                                                '--cue-color': color
                                            }}
                                            title={`Hot Cue ${idx + 1} - ${formatTime(cue.time)}`}
                                        >
                                            <div className="cue-flag">
                                                <span className="cue-number">{idx + 1}</span>
                                            </div>
                                            <div className="cue-line" />
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* Hover Tooltip */}
                        {hoveredCue && (
                            <div
                                className="cue-tooltip"
                                style={{
                                    left: `${(hoveredCue.time / (track.duration || track.analysis?.duration || 300)) * 100}%`
                                }}
                            >
                                <div className="tooltip-name">{hoveredCue.name}</div>
                                <div className="tooltip-time">{formatTime(hoveredCue.time)}</div>
                            </div>
                        )}
                    </div>

                    {/* Cue Point Editor */}
                    {showCueEditor && (
                        <CuePointEditor
                            cuePoints={allCuePoints}
                            duration={track.duration || track.analysis?.duration || 0}
                            onAddCue={handleAddCue}
                            onUpdateCue={handleUpdateCue}
                            onDeleteCue={handleDeleteCue}
                            onSeekToCue={handleSeekToCue}
                            onClose={() => setShowCueEditor(false)}
                        />
                    )}
                </div>
            )}
        </div>
    );
});

const formatTime = (seconds) => {
    if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

export default DJDeck;

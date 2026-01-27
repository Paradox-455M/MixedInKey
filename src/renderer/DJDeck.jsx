// Add audio logic to DJDeck
import React, { useRef, useState, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { Music, X, Upload, Play, Pause } from 'lucide-react';
import WaveformCanvas from './WaveformCanvas';
import { getKeyColor } from './keyUtils';

const DJDeck = ({ 
    id, 
    track, 
    isActive, 
    onActivate, 
    onLoadTrack, 
    onClear 
}) => {
    const [hoveredCue, setHoveredCue] = useState(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const deckRef = useRef(null);
    const audioRef = useRef(null);

    // Reset state when track changes
    useEffect(() => {
        setIsPlaying(false);
        setCurrentTime(0);
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
        }
    }, [track]);

    const togglePlay = (e) => {
        e.stopPropagation();
        if (!audioRef.current) return;
        
        if (isPlaying) {
            audioRef.current.pause();
        } else {
            audioRef.current.play();
        }
        setIsPlaying(!isPlaying);
    };

    const handleTimeUpdate = () => {
        if (audioRef.current) {
            setCurrentTime(audioRef.current.currentTime);
        }
    };

    const handleEnded = () => {
        setIsPlaying(false);
        setCurrentTime(0);
    };

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

    const handleWaveformClick = (e) => {
        e.stopPropagation();
        if (!track || !audioRef.current || !deckRef.current) return;

        const rect = deckRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const width = rect.width;
        const duration = track.duration || track.analysis.duration || 300;
        
        const seekTime = (x / width) * duration;
        audioRef.current.currentTime = seekTime;
        setCurrentTime(seekTime);
    };

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
                                    {formatTime(currentTime)} / {formatTime(track.duration || track.analysis?.duration)}
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

                    {/* Waveform Area */}
                    <div 
                        className="deck-waveform-container"
                        ref={deckRef}
                        onMouseMove={handleMouseMove}
                        onMouseLeave={handleMouseLeave}
                        onClick={handleWaveformClick}
                    >
                        <WaveformCanvas
                            waveformData={track.analysis?.waveform_data || []}
                            width={600} 
                            height={120}
                            color={id === 'A' ? '#8b5cf6' : '#ec4899'}
                        />
                        
                        {/* Playhead */}
                        <div 
                            className="deck-playhead"
                            style={{ 
                                left: `${(currentTime / (track.duration || track.analysis?.duration || 1)) * 100}%` 
                            }}
                        />
                        
                        {/* Cue Markers Overlay */}
                        <div className="deck-cues-overlay">
                            {(track.analysis?.cue_points || []).map((cue, idx) => {
                                const duration = track.duration || track.analysis?.duration || 300;
                                const leftPct = (cue.time / duration) * 100;
                                
                                // Determine cue type class
                                let cueClass = 'type-generic';
                                const nameLower = (cue.name || '').toLowerCase();
                                const typeLower = (cue.type || '').toLowerCase();
                                
                                if (typeLower.includes('drop') || nameLower.includes('drop')) cueClass = 'type-drop';
                                else if (typeLower.includes('break') || nameLower.includes('break')) cueClass = 'type-breakdown';
                                else if (typeLower.includes('intro') || nameLower.includes('intro')) cueClass = 'type-intro';
                                else if (typeLower.includes('outro') || nameLower.includes('outro')) cueClass = 'type-outro';

                                return (
                                    <div 
                                        key={idx}
                                        className={`deck-cue-marker ${cueClass}`}
                                        style={{ left: `${leftPct}%` }}
                                    />
                                );
                            })}
                        </div>

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
                </div>
            )}
        </div>
    );
};

const formatTime = (seconds) => {
    if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

export default DJDeck;

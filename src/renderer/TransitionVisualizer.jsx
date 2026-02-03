import React, { useMemo, memo } from 'react';
import './transitionVisualizer.css';
import WaveformCanvas from './WaveformCanvas';

const TransitionVisualizer = ({ fromTrack, toTrack, transition }) => {
    if (!fromTrack || !toTrack || !transition) return null;

    const fromDuration = fromTrack.duration || (fromTrack.analysis?.duration) || 300;
    const toDuration = toTrack.duration || (toTrack.analysis?.duration) || 300;

    const mixOutTime = transition.mixOutTime;
    const mixInTime = transition.mixInTime;
    
    // Scale: pixels per second
    const pxPerSec = 15;

    // We want to align mixOutTime (Track A) with mixInTime (Track B) in the center
    // Track A: mixOutTime is at center
    // Track B: mixInTime is at center

    const renderTimeline = (track, focalTime, alignToCenter = true, isOutgoing = false) => {
        const cues = track.analysis?.cue_points || [];
        const duration = track.duration || track.analysis?.duration || 300;
        const waveformData = track.analysis?.waveform_data || [];
        const trackWidth = duration * pxPerSec;
        
        return (
            <div className="track-timeline-container">
                <div className="track-info">
                    <span className="track-role">{isOutgoing ? 'OUT' : 'IN'}</span>
                    <span className="track-title">{track.fileName || track.name}</span>
                    <span className="track-time">@ {formatTime(focalTime)}</span>
                </div>
                <div className="timeline-viewport">
                    <div 
                        className="timeline-content"
                        style={{ 
                            transform: `translateX(calc(50% - ${focalTime * pxPerSec}px))`
                        }}
                    >
                        {/* Waveform Canvas */}
                        <div className="waveform-layer" style={{ width: `${trackWidth}px` }}>
                            {waveformData.length > 0 ? (
                                <WaveformCanvas 
                                    waveformData={waveformData}
                                    width={trackWidth}
                                    height={80} // Matches viewport height
                                    color={isOutgoing ? '#8b5cf6' : '#ec4899'} // Violet for Out, Pink for In
                                />
                            ) : (
                                // Fallback if no waveform data
                                <div 
                                    className="timeline-bar" 
                                    style={{ width: `${trackWidth}px` }} 
                                />
                            )}
                        </div>

                        {/* Cue Points Overlay */}
                        <div 
                            className="cues-layer" 
                            style={{ width: `${trackWidth}px` }}
                        >
                            {/* Cue Points */}
                            {cues.map((cue, idx) => {
                                // Determine color/style based on cue type
                                let cueClass = 'type-generic';
                                const nameLower = (cue.name || '').toLowerCase();
                                const typeLower = (cue.type || '').toLowerCase();
                                
                                if (typeLower.includes('drop') || nameLower.includes('drop')) cueClass = 'type-drop';
                                else if (typeLower.includes('break') || nameLower.includes('break')) cueClass = 'type-breakdown';
                                else if (typeLower.includes('intro') || nameLower.includes('intro')) cueClass = 'type-intro';
                                else if (typeLower.includes('outro') || nameLower.includes('outro')) cueClass = 'type-outro';
                                else if (typeLower.includes('chorus') || nameLower.includes('chorus')) cueClass = 'type-chorus';
                                else if (typeLower.includes('verse') || nameLower.includes('verse')) cueClass = 'type-verse';

                                return (
                                    <div 
                                        key={idx}
                                        className={`cue-marker ${cueClass}`}
                                        style={{ left: `${cue.time * pxPerSec}px` }}
                                        title={`${cue.name} (${formatTime(cue.time)})`}
                                    >
                                        <div className="cue-line" />
                                        <div className="cue-label">{cue.name}</div>
                                    </div>
                                );
                            })}
                            
                            {/* Mix Point Marker */}
                            <div 
                                className="mix-marker"
                                style={{ left: `${focalTime * pxPerSec}px` }}
                            >
                                <div className="mix-line" />
                                <div className="mix-label">{isOutgoing ? 'Mix Out' : 'Mix In'}</div>
                            </div>
                        </div>
                    </div>
                    {/* Center Line */}
                    <div className="center-line" />
                </div>
            </div>
        );
    };

    return (
        <div className="transition-visualizer">
            {renderTimeline(fromTrack, mixOutTime, true, true)}
            <div className="visualizer-gap">
                <div className="transition-info">
                    {transition.overlapBars} bars overlap • Transition Score: {transition.score}%
                </div>
            </div>
            {renderTimeline(toTrack, mixInTime, true, false)}
        </div>
    );
};

const formatTime = (seconds) => {
    if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return 'N/A';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

export default memo(TransitionVisualizer);

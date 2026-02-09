import React, { useRef, useMemo, memo, useCallback } from 'react';
import WaveformCanvas from './WaveformCanvas';

/**
 * StackedWaveformView - Two decks vertically aligned for visual beatmatching
 * Shows Deck A waveform above Deck B waveform with aligned beat grids
 */
const StackedWaveformView = memo(({
  deckA,
  deckB,
  timeA = 0,
  timeB = 0,
  isPlayingA = false,
  isPlayingB = false,
  zoom = 1,
  renderMode = 'rgb',
  onSeekA,
  onSeekB,
  width = 800
}) => {
  const containerRef = useRef(null);
  const waveformHeight = 80;

  // Get analysis data
  const analysisA = deckA?.analysis;
  const analysisB = deckB?.analysis;

  const durationA = deckA?.duration || analysisA?.duration || 0;
  const durationB = deckB?.duration || analysisB?.duration || 0;

  // Calculate viewport positions centered on playhead
  const viewportA = useMemo(() => {
    if (zoom <= 1 || durationA <= 0) return 0;
    const progress = timeA / durationA;
    const viewportSize = 1 / zoom;
    return Math.max(0, Math.min(1 - viewportSize, progress - viewportSize / 2));
  }, [zoom, timeA, durationA]);

  const viewportB = useMemo(() => {
    if (zoom <= 1 || durationB <= 0) return 0;
    const progress = timeB / durationB;
    const viewportSize = 1 / zoom;
    return Math.max(0, Math.min(1 - viewportSize, progress - viewportSize / 2));
  }, [zoom, timeB, durationB]);

  // Handle click to seek on waveform A
  const handleClickA = useCallback((e) => {
    if (!containerRef.current || !onSeekA || durationA <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const clickPosition = x / rect.width;

    if (zoom > 1) {
      const viewportSize = 1 / zoom;
      const actualPosition = viewportA + (clickPosition * viewportSize);
      onSeekA(actualPosition * durationA);
    } else {
      onSeekA(clickPosition * durationA);
    }
  }, [onSeekA, durationA, zoom, viewportA]);

  // Handle click to seek on waveform B
  const handleClickB = useCallback((e) => {
    if (!containerRef.current || !onSeekB || durationB <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const clickPosition = x / rect.width;

    if (zoom > 1) {
      const viewportSize = 1 / zoom;
      const actualPosition = viewportB + (clickPosition * viewportSize);
      onSeekB(actualPosition * durationB);
    } else {
      onSeekB(clickPosition * durationB);
    }
  }, [onSeekB, durationB, zoom, viewportB]);

  // Render beat grid overlay
  const renderBeatGrid = (downbeats, duration, viewport) => {
    if (!downbeats || downbeats.length === 0 || duration <= 0) return null;

    const viewportSize = zoom > 1 ? 1 / zoom : 1;
    const startTime = viewport * duration;
    const endTime = (viewport + viewportSize) * duration;

    return downbeats
      .filter(time => time >= startTime && time <= endTime)
      .map((beatTime, idx) => {
        const relativePosition = (beatTime - startTime) / (endTime - startTime);
        const isDownbeat = idx % 4 === 0;

        return (
          <div
            key={`beat-${idx}`}
            className={`stacked-beat-marker ${isDownbeat ? 'downbeat' : 'beat'}`}
            style={{
              left: `${relativePosition * 100}%`
            }}
          />
        );
      });
  };

  return (
    <div ref={containerRef} className="stacked-waveform-view">
      {/* Deck A Waveform */}
      <div className="stacked-deck">
        <div className="stacked-deck-label">
          <span className="deck-badge deck-a">A</span>
          <span className="deck-info">
            {analysisA?.bpm ? `${Math.round(analysisA.bpm)} BPM` : '-- BPM'}
          </span>
        </div>
        <div
          className="stacked-waveform-container"
          onClick={handleClickA}
          style={{ cursor: deckA ? 'pointer' : 'default' }}
        >
          {analysisA ? (
            <>
              <WaveformCanvas
                waveformData={analysisA.waveform_data}
                rgbWaveformData={analysisA.rgb_waveform_data}
                renderMode={renderMode}
                width={width}
                height={waveformHeight}
                color="#8b5cf6"
                zoom={zoom}
                viewportStart={viewportA}
              />
              {/* Beat grid overlay */}
              <div className="stacked-beatgrid-overlay">
                {renderBeatGrid(analysisA.downbeats, durationA, viewportA)}
              </div>
              {/* Playhead - always centered when zoomed */}
              <div
                className="stacked-playhead deck-a"
                style={{
                  left: zoom > 1 ? '50%' : `${(timeA / durationA) * 100}%`
                }}
              />
            </>
          ) : (
            <div className="stacked-empty">Load track to Deck A</div>
          )}
        </div>
      </div>

      {/* Center divider with time info */}
      <div className="stacked-divider">
        <div className="stacked-time-sync">
          {deckA && deckB && (
            <span className="sync-indicator">
              {Math.abs((analysisA?.bpm || 0) - (analysisB?.bpm || 0)) < 1
                ? '✓ BPM Matched'
                : `Δ ${Math.abs((analysisA?.bpm || 0) - (analysisB?.bpm || 0)).toFixed(1)} BPM`}
            </span>
          )}
        </div>
      </div>

      {/* Deck B Waveform */}
      <div className="stacked-deck">
        <div className="stacked-deck-label">
          <span className="deck-badge deck-b">B</span>
          <span className="deck-info">
            {analysisB?.bpm ? `${Math.round(analysisB.bpm)} BPM` : '-- BPM'}
          </span>
        </div>
        <div
          className="stacked-waveform-container"
          onClick={handleClickB}
          style={{ cursor: deckB ? 'pointer' : 'default' }}
        >
          {analysisB ? (
            <>
              <WaveformCanvas
                waveformData={analysisB.waveform_data}
                rgbWaveformData={analysisB.rgb_waveform_data}
                renderMode={renderMode}
                width={width}
                height={waveformHeight}
                color="#ec4899"
                zoom={zoom}
                viewportStart={viewportB}
              />
              {/* Beat grid overlay */}
              <div className="stacked-beatgrid-overlay">
                {renderBeatGrid(analysisB.downbeats, durationB, viewportB)}
              </div>
              {/* Playhead - always centered when zoomed */}
              <div
                className="stacked-playhead deck-b"
                style={{
                  left: zoom > 1 ? '50%' : `${(timeB / durationB) * 100}%`
                }}
              />
            </>
          ) : (
            <div className="stacked-empty">Load track to Deck B</div>
          )}
        </div>
      </div>
    </div>
  );
});

StackedWaveformView.displayName = 'StackedWaveformView';

export default StackedWaveformView;

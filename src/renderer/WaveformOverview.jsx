import React, { useRef, useEffect, useMemo, useCallback } from 'react';

/**
 * WaveformOverview - Mini full-track waveform with viewport indicator
 * Appears above main waveform when zoomed in, allows click-to-seek
 */
const WaveformOverview = React.memo(({
  waveformData,
  rgbWaveformData,
  renderMode = 'single',
  width,
  height = 30,
  color = '#8b5cf6',
  currentTime = 0,
  duration = 0,
  zoom = 1,
  viewportStart = 0,
  onSeek
}) => {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  // Calculate viewport indicator position and width
  const viewportIndicator = useMemo(() => {
    if (zoom <= 1) return null;
    const viewportSize = 1 / zoom;
    return {
      left: viewportStart * 100,
      width: viewportSize * 100
    };
  }, [zoom, viewportStart]);

  // Playhead position as percentage
  const playheadPosition = useMemo(() => {
    if (duration <= 0) return 0;
    return (currentTime / duration) * 100;
  }, [currentTime, duration]);

  // Handle click to seek
  const handleClick = useCallback((e) => {
    if (!containerRef.current || !onSeek || duration <= 0) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const clickPosition = x / rect.width;
    const seekTime = clickPosition * duration;

    onSeek(seekTime);
  }, [onSeek, duration]);

  // Create path from waveform data
  const createWaveformPath = (data, canvasWidth, canvasHeight) => {
    if (!data || !data.length) return null;

    const path = new Path2D();
    const totalPoints = data.length;
    const barWidth = canvasWidth / totalPoints;
    const centerY = canvasHeight / 2;

    for (let i = 0; i < totalPoints; i++) {
      const amplitude = data[i];
      const clampedAmp = Math.min(1, Math.max(0, amplitude));
      const x = i * barWidth;
      const barHeight = clampedAmp * canvasHeight * 0.85;
      const y = centerY - (barHeight / 2);

      path.rect(x, y, Math.max(barWidth, 0.5), barHeight);
    }

    return path;
  };

  // Render waveform to canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width || !height) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    if (renderMode === 'rgb' && rgbWaveformData) {
      // RGB mode
      const lowPath = createWaveformPath(rgbWaveformData.low, width, height);
      const midPath = createWaveformPath(rgbWaveformData.mid, width, height);
      const highPath = createWaveformPath(rgbWaveformData.high, width, height);

      ctx.globalCompositeOperation = 'screen';

      if (lowPath) {
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = '#ef4444';
        ctx.fill(lowPath);
      }

      if (midPath) {
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = '#22c55e';
        ctx.fill(midPath);
      }

      if (highPath) {
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = '#3b82f6';
        ctx.fill(highPath);
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    } else if (waveformData) {
      // Single color mode (dimmer for overview)
      const path = createWaveformPath(waveformData, width, height);
      if (path) {
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = color;
        ctx.fill(path);
        ctx.globalAlpha = 1;
      }
    }
  }, [waveformData, rgbWaveformData, width, height, color, renderMode]);

  // Only show overview when zoomed
  if (zoom <= 1) return null;

  return (
    <div
      ref={containerRef}
      className="waveform-overview"
      onClick={handleClick}
      style={{
        position: 'relative',
        width: `${width}px`,
        height: `${height}px`,
        cursor: 'pointer',
        borderRadius: '4px',
        overflow: 'hidden',
        background: 'rgba(0, 0, 0, 0.4)',
        marginBottom: '4px'
      }}
    >
      {/* Waveform canvas */}
      <canvas
        ref={canvasRef}
        style={{
          width: `${width}px`,
          height: `${height}px`,
          display: 'block'
        }}
      />

      {/* Viewport indicator */}
      {viewportIndicator && (
        <div
          className="overview-viewport"
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${viewportIndicator.left}%`,
            width: `${viewportIndicator.width}%`,
            background: 'rgba(139, 92, 246, 0.2)',
            border: '1px solid rgba(139, 92, 246, 0.5)',
            borderRadius: '2px',
            pointerEvents: 'none'
          }}
        />
      )}

      {/* Playhead */}
      <div
        className="overview-playhead"
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: `${playheadPosition}%`,
          width: '1px',
          background: '#fff',
          boxShadow: '0 0 3px rgba(255, 255, 255, 0.6)',
          pointerEvents: 'none'
        }}
      />
    </div>
  );
});

WaveformOverview.displayName = 'WaveformOverview';

export default WaveformOverview;

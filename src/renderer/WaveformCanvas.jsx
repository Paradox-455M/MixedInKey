import React, { useRef, useEffect, useMemo } from 'react';

// RGB Waveform color palette (professional DJ software style)
const RGB_COLORS = {
  low: '#ef4444',   // Red - bass (20-250 Hz)
  mid: '#22c55e',   // Green - mids (250-4000 Hz)
  high: '#3b82f6'   // Blue - highs (4000-20000 Hz)
};

const WaveformCanvas = React.memo(({
  waveformData,
  rgbWaveformData,      // { low: [], mid: [], high: [] }
  renderMode = 'single', // 'single' | 'rgb'
  width,
  height,
  color = '#8b5cf6',
  scale = 1,
  zoom = 1,
  viewportStart = 0
}) => {
  const canvasRef = useRef(null);

  // Calculate visible portion of waveform based on zoom
  // Use RGB data length if available, otherwise fall back to regular waveform
  const dataLength = useMemo(() => {
    if (rgbWaveformData?.low?.length > 0) {
      return rgbWaveformData.low.length;
    }
    return waveformData?.length || 0;
  }, [rgbWaveformData?.low?.length, waveformData?.length]);

  const visibleRange = useMemo(() => {
    if (zoom <= 1) {
      return { startIndex: 0, endIndex: null }; // null means use full length
    }
    if (dataLength === 0) return { startIndex: 0, endIndex: 0 };

    const visiblePoints = Math.floor(dataLength / zoom);
    const startIndex = Math.floor(viewportStart * (dataLength - visiblePoints));
    const endIndex = Math.min(startIndex + visiblePoints, dataLength);

    return { startIndex, endIndex };
  }, [dataLength, zoom, viewportStart]);

  // Get visible slice of data
  const getVisibleSlice = (data) => {
    if (!data || data.length === 0) return [];
    const { startIndex, endIndex } = visibleRange;
    if (endIndex === null) return data;
    return data.slice(startIndex, endIndex);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width || !height) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    // Set canvas dimensions with DPR for crisp rendering
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    // Check if we should render RGB mode
    const hasRgbData = rgbWaveformData &&
      rgbWaveformData.low?.length > 0 &&
      rgbWaveformData.mid?.length > 0 &&
      rgbWaveformData.high?.length > 0;

    const shouldRenderRgb = renderMode === 'rgb' && hasRgbData;

    if (shouldRenderRgb) {
      // RGB Mode: Draw three overlapping colored waveforms
      const lowData = getVisibleSlice(rgbWaveformData.low);
      const midData = getVisibleSlice(rgbWaveformData.mid);
      const highData = getVisibleSlice(rgbWaveformData.high);

      const totalPoints = lowData.length;
      if (totalPoints === 0) return;

      const barWidth = width / totalPoints;
      const centerY = height / 2;

      // Use additive blending for nice color mixing
      ctx.globalCompositeOperation = 'lighter';

      // Draw bass (red) - lower opacity so it doesn't overwhelm
      ctx.fillStyle = RGB_COLORS.low;
      ctx.globalAlpha = 0.8;
      for (let i = 0; i < totalPoints; i++) {
        const amplitude = (lowData[i] || 0) * scale;
        const barHeight = Math.min(1, Math.max(0, amplitude)) * height * 0.85;
        const x = i * barWidth;
        const y = centerY - barHeight / 2;
        ctx.fillRect(x, y, Math.max(barWidth - 0.5, 1), barHeight);
      }

      // Draw mids (green)
      ctx.fillStyle = RGB_COLORS.mid;
      ctx.globalAlpha = 0.7;
      for (let i = 0; i < totalPoints; i++) {
        const amplitude = (midData[i] || 0) * scale;
        const barHeight = Math.min(1, Math.max(0, amplitude)) * height * 0.85;
        const x = i * barWidth;
        const y = centerY - barHeight / 2;
        ctx.fillRect(x, y, Math.max(barWidth - 0.5, 1), barHeight);
      }

      // Draw highs (blue)
      ctx.fillStyle = RGB_COLORS.high;
      ctx.globalAlpha = 0.6;
      for (let i = 0; i < totalPoints; i++) {
        const amplitude = (highData[i] || 0) * scale;
        const barHeight = Math.min(1, Math.max(0, amplitude)) * height * 0.85;
        const x = i * barWidth;
        const y = centerY - barHeight / 2;
        ctx.fillRect(x, y, Math.max(barWidth - 0.5, 1), barHeight);
      }

      // Reset
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

    } else if (waveformData && waveformData.length > 0) {
      // Single color mode - fallback or when RGB not available
      const visibleData = getVisibleSlice(waveformData);
      const totalPoints = visibleData.length;
      if (totalPoints === 0) return;

      const barWidth = width / totalPoints;
      const centerY = height / 2;

      ctx.fillStyle = color;
      for (let i = 0; i < totalPoints; i++) {
        const amplitude = (visibleData[i] || 0) * scale;
        const barHeight = Math.min(1, Math.max(0, amplitude)) * height * 0.9;
        const x = i * barWidth;
        const y = centerY - barHeight / 2;
        ctx.fillRect(x, y, Math.max(barWidth - 0.5, 1), barHeight);
      }
    }
  }, [waveformData, rgbWaveformData, visibleRange, width, height, color, scale, renderMode, dataLength]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        display: 'block'
      }}
    />
  );
});

WaveformCanvas.displayName = 'WaveformCanvas';

export default WaveformCanvas;

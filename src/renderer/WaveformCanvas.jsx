import React, { useRef, useEffect, useMemo } from 'react';

const WaveformCanvas = React.memo(({
  waveformData,
  width,
  height,
  color = '#8b5cf6',
  scale = 1,
  zoom = 1,
  viewportStart = 0 // 0-1 range indicating where the viewport starts
}) => {
  const canvasRef = useRef(null);

  // Calculate visible portion of waveform based on zoom
  const visibleData = useMemo(() => {
    if (!waveformData || !waveformData.length) return [];
    if (zoom <= 1) return waveformData;

    const totalPoints = waveformData.length;
    const visiblePoints = Math.floor(totalPoints / zoom);
    const startIndex = Math.floor(viewportStart * (totalPoints - visiblePoints));
    const endIndex = Math.min(startIndex + visiblePoints, totalPoints);

    return waveformData.slice(startIndex, endIndex);
  }, [waveformData, zoom, viewportStart]);

  // Memoize path computation to avoid recalculating on every render
  const waveformPath = useMemo(() => {
    if (!visibleData || !visibleData.length || !width || !height) return null;

    const path = new Path2D();
    const totalPoints = visibleData.length;
    const barWidth = width / totalPoints;
    const centerY = height / 2;

    for (let i = 0; i < totalPoints; i++) {
      const amplitude = visibleData[i] * scale;
      const clampedAmp = Math.min(1, Math.max(0, amplitude));
      const x = i * barWidth;
      const barHeight = clampedAmp * height * 0.9; // Leave 10% padding
      const y = centerY - (barHeight / 2);

      path.rect(x, y, Math.max(barWidth, 0.5), barHeight);
    }

    return path;
  }, [visibleData, width, height, scale]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !waveformPath) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    // Set canvas dimensions with DPR for crisp rendering
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    // Scale context to match
    ctx.scale(dpr, dpr);

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw waveform with single batched fill operation
    ctx.fillStyle = color;
    ctx.fill(waveformPath);
  }, [waveformPath, width, height, color]);

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

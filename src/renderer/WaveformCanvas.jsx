import React, { useRef, useEffect } from 'react';

const WaveformCanvas = ({ 
  waveformData, 
  width, 
  height, 
  color = '#8b5cf6',
  scale = 1
}) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !waveformData || !waveformData.length) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    
    // Set canvas dimensions with DPR for crisp rendering
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    
    // Scale context to match
    ctx.scale(dpr, dpr);
    
    // Clear canvas
    ctx.clearRect(0, 0, width, height);
    
    // Draw waveform
    // We want to fill 'width' with 'waveformData.length' points
    // But realistically, width (px) is usually smaller or larger than data points.
    
    const totalPoints = waveformData.length;
    // Calculate bar width to fill the total width
    const barWidth = width / totalPoints;
    const centerY = height / 2;
    
    ctx.fillStyle = color;
    
    // Draw mirrored waveform
    ctx.beginPath();
    
    for (let i = 0; i < totalPoints; i++) {
        const amplitude = waveformData[i] * scale;
        // Limit amplitude
        const clampedAmp = Math.min(1, Math.max(0, amplitude));
        
        const x = i * barWidth;
        const barHeight = clampedAmp * height * 0.9; // Leave 10% padding
        
        // Draw centered bar
        const y = centerY - (barHeight / 2);
        
        // Use rect for crisp bars
        ctx.fillRect(x, y, Math.max(barWidth, 0.5), barHeight);
    }
  }, [waveformData, width, height, color, scale]);

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
};

export default WaveformCanvas;

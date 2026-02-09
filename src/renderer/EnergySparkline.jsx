import React, { useRef, useEffect, memo } from 'react';

/**
 * Energy Sparkline Component
 * Displays a mini energy curve graph for a track
 */
const EnergySparkline = memo(({
    energyData,  // Array of energy values over time
    energyLevel, // Overall energy level (1-10)
    width = 60,
    height = 20,
    color = '#8b5cf6',
    isCompatible = false
}) => {
    const canvasRef = useRef(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;

        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Background
        ctx.fillStyle = '#1a1a1e';
        ctx.fillRect(0, 0, width, height);

        // If we have energy data array, draw the sparkline
        if (energyData && Array.isArray(energyData) && energyData.length > 1) {
            drawSparkline(ctx, energyData, width, height, isCompatible ? '#22c55e' : color);
        } else {
            // Fall back to drawing a simple energy bar with variance
            drawSimpleEnergy(ctx, energyLevel || 5, width, height, isCompatible ? '#22c55e' : color);
        }
    }, [energyData, energyLevel, width, height, color, isCompatible]);

    return (
        <canvas
            ref={canvasRef}
            className="energy-sparkline"
            style={{
                width: `${width}px`,
                height: `${height}px`,
                borderRadius: '3px'
            }}
        />
    );
});

/**
 * Draw a sparkline from energy data array
 */
function drawSparkline(ctx, data, width, height, color) {
    const points = data.length;
    const maxValue = Math.max(...data, 1);
    const minValue = Math.min(...data, 0);
    const range = maxValue - minValue || 1;

    // Create gradient
    const gradient = ctx.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, color + '20');
    gradient.addColorStop(0.5, color + '60');
    gradient.addColorStop(1, color);

    // Draw filled area
    ctx.beginPath();
    ctx.moveTo(0, height);

    for (let i = 0; i < points; i++) {
        const x = (i / (points - 1)) * width;
        const normalizedValue = (data[i] - minValue) / range;
        const y = height - (normalizedValue * (height - 4)) - 2;
        if (i === 0) {
            ctx.lineTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }

    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Draw line on top
    ctx.beginPath();
    for (let i = 0; i < points; i++) {
        const x = (i / (points - 1)) * width;
        const normalizedValue = (data[i] - minValue) / range;
        const y = height - (normalizedValue * (height - 4)) - 2;
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
}

/**
 * Draw a simple energy representation when no detailed data is available
 * Creates a pseudo-random curve based on energy level
 */
function drawSimpleEnergy(ctx, energyLevel, width, height, color) {
    // Generate pseudo-random points based on energy level
    const numPoints = 12;
    const baseHeight = (energyLevel / 10) * (height - 4);
    const variance = (10 - energyLevel) * 0.5 + 2; // More variance for lower energy

    // Create a simple curve with some variation
    const points = [];
    for (let i = 0; i < numPoints; i++) {
        // Create a basic energy curve: low → high → peak → medium
        const position = i / (numPoints - 1);
        let modifier = 1;

        if (position < 0.2) {
            // Intro - building up
            modifier = 0.5 + position * 2;
        } else if (position < 0.4) {
            // First peak
            modifier = 0.9 + Math.sin(position * Math.PI * 5) * 0.1;
        } else if (position < 0.5) {
            // Breakdown
            modifier = 0.6 + (position - 0.4) * 2;
        } else if (position < 0.7) {
            // Main section/drop
            modifier = 1 + Math.sin((position - 0.5) * Math.PI * 3) * 0.15;
        } else if (position < 0.85) {
            // Second peak
            modifier = 0.95 + Math.sin((position - 0.7) * Math.PI * 4) * 0.1;
        } else {
            // Outro
            modifier = 0.9 - (position - 0.85) * 3;
        }

        points.push(baseHeight * modifier);
    }

    // Draw the pseudo-curve
    drawSparkline(ctx, points, width, height, color);
}

EnergySparkline.displayName = 'EnergySparkline';

export default EnergySparkline;

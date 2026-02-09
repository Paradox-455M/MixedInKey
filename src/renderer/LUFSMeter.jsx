import React, { useRef, useEffect, memo, useState } from 'react';
import audioEngine from './audioEngine';

/**
 * Professional LUFS Loudness Meter
 * Shows momentary, short-term loudness and peak level
 */
const LUFSMeter = memo(({ deckId, height = 120, width = 30 }) => {
    const canvasRef = useRef(null);
    const animationRef = useRef(null);
    const [peak, setPeak] = useState(0);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;

        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        const draw = () => {
            const loudness = audioEngine.getShortTermLoudness(deckId);
            setPeak(loudness.peak);

            ctx.clearRect(0, 0, width, height);

            // Background
            ctx.fillStyle = '#0a0a0f';
            ctx.fillRect(0, 0, width, height);

            // Scale markings (LUFS values)
            const scaleMarks = [0, -6, -12, -18, -24, -36, -48, -60];
            ctx.font = '7px monospace';
            ctx.fillStyle = '#3f3f46';
            ctx.textAlign = 'right';

            scaleMarks.forEach(mark => {
                const y = lufsToY(mark, height - 20);
                ctx.fillText(mark.toString(), width - 4, y + 3);
                ctx.fillRect(0, y, 2, 1);
            });

            // Meter bar area
            const barX = 4;
            const barWidth = width - 20;
            const barHeight = height - 20;

            // Background gradient for meter
            const bgGradient = ctx.createLinearGradient(barX, 10, barX, barHeight + 10);
            bgGradient.addColorStop(0, '#1a1a1e');
            bgGradient.addColorStop(1, '#1a1a1e');
            ctx.fillStyle = bgGradient;
            ctx.fillRect(barX, 10, barWidth, barHeight);

            // Color zones
            const zones = [
                { start: 0, end: -6, color: '#ef4444' },      // Red (clipping)
                { start: -6, end: -12, color: '#f97316' },    // Orange (hot)
                { start: -12, end: -18, color: '#eab308' },   // Yellow (loud)
                { start: -18, end: -24, color: '#22c55e' },   // Green (optimal)
                { start: -24, end: -48, color: '#3b82f6' },   // Blue (normal)
                { start: -48, end: -70, color: '#6366f1' }    // Indigo (quiet)
            ];

            // Draw momentary level
            const momentaryY = lufsToY(loudness.momentary, barHeight);
            const momentaryHeight = barHeight + 10 - momentaryY;

            if (momentaryHeight > 0) {
                // Create gradient based on level
                const gradient = ctx.createLinearGradient(barX, barHeight + 10, barX, momentaryY);
                zones.forEach(zone => {
                    const startY = lufsToY(zone.start, barHeight) / (barHeight + 10);
                    const endY = lufsToY(zone.end, barHeight) / (barHeight + 10);
                    if (startY >= 0 && startY <= 1) gradient.addColorStop(Math.max(0, 1 - startY), zone.color);
                    if (endY >= 0 && endY <= 1) gradient.addColorStop(Math.min(1, 1 - endY), zone.color);
                });

                ctx.fillStyle = gradient;
                ctx.fillRect(barX, momentaryY, barWidth / 2 - 1, momentaryHeight);
            }

            // Draw short-term level (slightly different position)
            const shortTermY = lufsToY(loudness.shortTerm, barHeight);
            const shortTermHeight = barHeight + 10 - shortTermY;

            if (shortTermHeight > 0) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
                ctx.fillRect(barX + barWidth / 2, shortTermY, barWidth / 2, shortTermHeight);
            }

            // Peak indicator line
            const peakLUFS = 20 * Math.log10(loudness.peak || 0.001);
            const peakY = lufsToY(Math.max(-70, peakLUFS), barHeight);
            ctx.fillStyle = loudness.peak > 0.9 ? '#ef4444' : '#ffffff';
            ctx.fillRect(barX, peakY, barWidth, 2);

            // LUFS value display
            ctx.font = 'bold 9px monospace';
            ctx.fillStyle = loudness.momentary > -6 ? '#ef4444' : '#e4e4e7';
            ctx.textAlign = 'center';
            ctx.fillText(loudness.momentary.toFixed(1), width / 2, height - 4);

            animationRef.current = requestAnimationFrame(draw);
        };

        const lufsToY = (lufs, maxHeight) => {
            // Map LUFS (-70 to 0) to Y position (maxHeight to 10)
            const normalized = (lufs + 70) / 70; // 0 to 1
            return 10 + (1 - normalized) * maxHeight;
        };

        draw();

        return () => {
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
        };
    }, [deckId, width, height]);

    const handleResetPeak = () => {
        audioEngine.resetPeak(deckId);
    };

    return (
        <div className="lufs-meter" onClick={handleResetPeak} title="Click to reset peak">
            <canvas
                ref={canvasRef}
                style={{
                    width: `${width}px`,
                    height: `${height}px`,
                    cursor: 'pointer'
                }}
            />
            <div className="lufs-label" style={{
                fontSize: '7px',
                color: '#52525b',
                textAlign: 'center',
                marginTop: '2px'
            }}>LUFS</div>
        </div>
    );
});

LUFSMeter.displayName = 'LUFSMeter';

/**
 * Horizontal LUFS meter for compact layouts
 */
export const LUFSMeterHorizontal = memo(({ deckId, width = 150, height = 20 }) => {
    const canvasRef = useRef(null);
    const animationRef = useRef(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;

        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        const draw = () => {
            const loudness = audioEngine.getShortTermLoudness(deckId);

            ctx.clearRect(0, 0, width, height);

            // Background
            ctx.fillStyle = '#1a1a1e';
            ctx.fillRect(0, 0, width - 35, height);

            // Calculate fill width
            const normalized = (loudness.momentary + 70) / 70;
            const fillWidth = normalized * (width - 35);

            // Color based on level
            let color = '#22c55e'; // Green
            if (loudness.momentary > -6) color = '#ef4444'; // Red
            else if (loudness.momentary > -12) color = '#f97316'; // Orange
            else if (loudness.momentary > -18) color = '#eab308'; // Yellow

            // Gradient fill
            const gradient = ctx.createLinearGradient(0, 0, fillWidth, 0);
            gradient.addColorStop(0, '#3b82f6');
            gradient.addColorStop(0.6, '#22c55e');
            gradient.addColorStop(0.85, '#eab308');
            gradient.addColorStop(1, color);

            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, fillWidth, height);

            // Peak line
            const peakLUFS = 20 * Math.log10(loudness.peak || 0.001);
            const peakNorm = (Math.max(-70, peakLUFS) + 70) / 70;
            const peakX = peakNorm * (width - 35);
            ctx.fillStyle = loudness.peak > 0.9 ? '#ef4444' : '#ffffff';
            ctx.fillRect(peakX - 1, 0, 2, height);

            // LUFS value
            ctx.font = 'bold 10px monospace';
            ctx.fillStyle = loudness.momentary > -6 ? '#ef4444' : '#a1a1aa';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(loudness.momentary.toFixed(1), width - 2, height / 2);

            animationRef.current = requestAnimationFrame(draw);
        };

        draw();

        return () => {
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
        };
    }, [deckId, width, height]);

    return (
        <canvas
            ref={canvasRef}
            className="lufs-meter-horizontal"
            style={{
                width: `${width}px`,
                height: `${height}px`,
                borderRadius: '3px'
            }}
            onClick={() => audioEngine.resetPeak(deckId)}
            title="Click to reset peak"
        />
    );
});

LUFSMeterHorizontal.displayName = 'LUFSMeterHorizontal';

export default LUFSMeter;

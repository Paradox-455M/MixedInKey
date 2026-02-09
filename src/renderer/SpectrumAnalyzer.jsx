import React, { useRef, useEffect, memo } from 'react';
import audioEngine from './audioEngine';

/**
 * Real-time Frequency Spectrum Analyzer
 * Shows bass/mid/high frequency bands with smooth animation
 */
const SpectrumAnalyzer = memo(({
    deckId,
    width = 200,
    height = 60,
    barCount = 32,
    showLabels = true,
    colorScheme = 'default' // 'default', 'rgb', 'monochrome'
}) => {
    const canvasRef = useRef(null);
    const animationRef = useRef(null);
    const smoothedDataRef = useRef(new Array(barCount).fill(0));

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;

        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        // Color schemes
        const getBarColor = (index, value, total) => {
            const position = index / total;

            if (colorScheme === 'rgb') {
                // Bass = Red, Mid = Green, High = Blue
                if (position < 0.33) {
                    return `rgba(239, 68, 68, ${0.6 + value * 0.4})`;
                } else if (position < 0.66) {
                    return `rgba(34, 197, 94, ${0.6 + value * 0.4})`;
                } else {
                    return `rgba(59, 130, 246, ${0.6 + value * 0.4})`;
                }
            } else if (colorScheme === 'monochrome') {
                const brightness = 100 + value * 155;
                return `rgb(${brightness}, ${brightness}, ${brightness})`;
            } else {
                // Default: Purple gradient
                const hue = 260 + position * 40; // Purple to pink
                const saturation = 70 + value * 30;
                const lightness = 40 + value * 30;
                return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
            }
        };

        const draw = () => {
            // Get spectrum data
            const spectrum = audioEngine.getSpectrum(deckId, barCount);

            // Smooth the data
            const smoothing = 0.7;
            for (let i = 0; i < barCount; i++) {
                smoothedDataRef.current[i] = smoothedDataRef.current[i] * smoothing + spectrum[i] * (1 - smoothing);
            }

            // Clear canvas
            ctx.clearRect(0, 0, width, height);

            // Draw background
            ctx.fillStyle = '#0a0a0f';
            ctx.fillRect(0, 0, width, height);

            // Calculate bar dimensions
            const barWidth = (width - (barCount - 1) * 1) / barCount;
            const maxBarHeight = height - (showLabels ? 12 : 4);

            // Draw bars
            for (let i = 0; i < barCount; i++) {
                const value = smoothedDataRef.current[i];
                const barHeight = Math.max(2, value * maxBarHeight);
                const x = i * (barWidth + 1);
                const y = height - barHeight - (showLabels ? 10 : 2);

                // Bar gradient
                const gradient = ctx.createLinearGradient(x, y + barHeight, x, y);
                gradient.addColorStop(0, getBarColor(i, value * 0.5, barCount));
                gradient.addColorStop(1, getBarColor(i, value, barCount));

                ctx.fillStyle = gradient;
                ctx.fillRect(x, y, barWidth, barHeight);

                // Peak indicator
                if (value > 0.8) {
                    ctx.fillStyle = '#ef4444';
                    ctx.fillRect(x, y, barWidth, 2);
                }
            }

            // Draw frequency labels
            if (showLabels) {
                ctx.font = '8px monospace';
                ctx.fillStyle = '#52525b';
                ctx.textAlign = 'center';

                const labels = ['SUB', 'BASS', 'MID', 'HIGH'];
                const positions = [0.1, 0.3, 0.6, 0.85];
                labels.forEach((label, i) => {
                    ctx.fillText(label, width * positions[i], height - 1);
                });
            }

            animationRef.current = requestAnimationFrame(draw);
        };

        draw();

        return () => {
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
        };
    }, [deckId, width, height, barCount, colorScheme, showLabels]);

    return (
        <canvas
            ref={canvasRef}
            className="spectrum-analyzer"
            style={{
                width: `${width}px`,
                height: `${height}px`,
                borderRadius: '4px'
            }}
        />
    );
});

SpectrumAnalyzer.displayName = 'SpectrumAnalyzer';

/**
 * Compact frequency band meters (5 bands)
 */
export const FrequencyBands = memo(({ deckId, height = 40 }) => {
    const canvasRef = useRef(null);
    const animationRef = useRef(null);
    const smoothedRef = useRef({ sub: 0, low: 0, mid: 0, presence: 0, high: 0 });

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.offsetWidth;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        const bands = [
            { key: 'sub', label: 'SUB', color: '#ef4444' },
            { key: 'low', label: 'BASS', color: '#f97316' },
            { key: 'mid', label: 'MID', color: '#22c55e' },
            { key: 'presence', label: 'PRES', color: '#3b82f6' },
            { key: 'high', label: 'HIGH', color: '#8b5cf6' }
        ];

        const draw = () => {
            const data = audioEngine.getFrequencyBands(deckId);

            // Smooth the data
            const smoothing = 0.75;
            Object.keys(smoothedRef.current).forEach(key => {
                smoothedRef.current[key] = smoothedRef.current[key] * smoothing + (data[key] || 0) * (1 - smoothing);
            });

            ctx.clearRect(0, 0, width, height);

            const bandWidth = (width - 20) / bands.length;
            const barHeight = height - 14;

            bands.forEach((band, i) => {
                const x = 4 + i * bandWidth;
                const value = smoothedRef.current[band.key];
                const fillHeight = value * barHeight;

                // Background
                ctx.fillStyle = '#1a1a1e';
                ctx.fillRect(x, 2, bandWidth - 4, barHeight);

                // Fill
                const gradient = ctx.createLinearGradient(x, barHeight, x, 2);
                gradient.addColorStop(0, band.color + '40');
                gradient.addColorStop(1, band.color);
                ctx.fillStyle = gradient;
                ctx.fillRect(x, 2 + barHeight - fillHeight, bandWidth - 4, fillHeight);

                // Label
                ctx.font = '7px monospace';
                ctx.fillStyle = '#52525b';
                ctx.textAlign = 'center';
                ctx.fillText(band.label, x + (bandWidth - 4) / 2, height - 2);
            });

            animationRef.current = requestAnimationFrame(draw);
        };

        draw();

        return () => {
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
        };
    }, [deckId, height]);

    return (
        <canvas
            ref={canvasRef}
            className="frequency-bands"
            style={{
                width: '100%',
                height: `${height}px`,
                borderRadius: '4px'
            }}
        />
    );
});

FrequencyBands.displayName = 'FrequencyBands';

export default SpectrumAnalyzer;

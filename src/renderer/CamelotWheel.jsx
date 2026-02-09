import React, { useState, useCallback, useMemo, memo } from 'react';
import { getKeyColor } from './keyUtils';
import './camelotWheel.css';

/**
 * Camelot Wheel Key Positions
 * Inner ring: Minor keys (A)
 * Outer ring: Major keys (B)
 */
const CAMELOT_POSITIONS = [
    // Number, Minor (A), Major (B)
    { num: 1, minor: 'Abm', major: 'B' },
    { num: 2, minor: 'Ebm', major: 'Gb' },
    { num: 3, minor: 'Bbm', major: 'Db' },
    { num: 4, minor: 'Fm', major: 'Ab' },
    { num: 5, minor: 'Cm', major: 'Eb' },
    { num: 6, minor: 'Gm', major: 'Bb' },
    { num: 7, minor: 'Dm', major: 'F' },
    { num: 8, minor: 'Am', major: 'C' },
    { num: 9, minor: 'Em', major: 'G' },
    { num: 10, minor: 'Bm', major: 'D' },
    { num: 11, minor: 'F#m', major: 'A' },
    { num: 12, minor: 'C#m', major: 'E' }
];

/**
 * Get compatible Camelot keys for a given key
 */
const getCompatibleKeys = (camelotKey) => {
    if (!camelotKey) return new Set();

    const match = camelotKey.match(/^(\d+)([AB])$/);
    if (!match) return new Set();

    const num = parseInt(match[1]);
    const letter = match[2];

    const compatible = new Set([
        camelotKey,
        `${num === 12 ? 1 : num + 1}${letter}`,  // +1
        `${num === 1 ? 12 : num - 1}${letter}`,  // -1
        `${num}${letter === 'A' ? 'B' : 'A'}`    // Same number, different letter
    ]);

    return compatible;
};

/**
 * Convert musical key to Camelot notation
 */
const keyToCamelot = (key) => {
    if (!key) return null;

    // Handle if already in Camelot format
    if (/^\d+[AB]$/.test(key)) return key;

    // Find matching position
    for (const pos of CAMELOT_POSITIONS) {
        if (pos.minor.toLowerCase() === key.toLowerCase()) {
            return `${pos.num}A`;
        }
        if (pos.major.toLowerCase() === key.toLowerCase()) {
            return `${pos.num}B`;
        }
    }

    return null;
};

/**
 * Interactive Camelot Wheel Component
 */
const CamelotWheel = memo(({
    currentKeyA,      // Current key on Deck A
    currentKeyB,      // Current key on Deck B
    onSelectKey,      // Called when a key segment is clicked
    size = 200,       // Wheel diameter
    showLabels = true
}) => {
    const [hoveredKey, setHoveredKey] = useState(null);

    // Convert to Camelot notation
    const camelotA = keyToCamelot(currentKeyA);
    const camelotB = keyToCamelot(currentKeyB);

    // Get compatible keys for both decks
    const compatibleWithA = useMemo(() => getCompatibleKeys(camelotA), [camelotA]);
    const compatibleWithB = useMemo(() => getCompatibleKeys(camelotB), [camelotB]);

    // Calculate segment dimensions
    const centerX = size / 2;
    const centerY = size / 2;
    const outerRadius = (size / 2) - 10;
    const middleRadius = outerRadius * 0.65;
    const innerRadius = outerRadius * 0.35;

    // Generate SVG path for a wheel segment
    const getSegmentPath = (startAngle, endAngle, innerR, outerR) => {
        const startRad = (startAngle - 90) * (Math.PI / 180);
        const endRad = (endAngle - 90) * (Math.PI / 180);

        const x1 = centerX + innerR * Math.cos(startRad);
        const y1 = centerY + innerR * Math.sin(startRad);
        const x2 = centerX + outerR * Math.cos(startRad);
        const y2 = centerY + outerR * Math.sin(startRad);
        const x3 = centerX + outerR * Math.cos(endRad);
        const y3 = centerY + outerR * Math.sin(endRad);
        const x4 = centerX + innerR * Math.cos(endRad);
        const y4 = centerY + innerR * Math.sin(endRad);

        return `M ${x1} ${y1} L ${x2} ${y2} A ${outerR} ${outerR} 0 0 1 ${x3} ${y3} L ${x4} ${y4} A ${innerR} ${innerR} 0 0 0 ${x1} ${y1}`;
    };

    // Get label position
    const getLabelPosition = (angle, radius) => {
        const rad = (angle - 90) * (Math.PI / 180);
        return {
            x: centerX + radius * Math.cos(rad),
            y: centerY + radius * Math.sin(rad)
        };
    };

    const handleSegmentClick = useCallback((camelotKey) => {
        onSelectKey?.(camelotKey);
    }, [onSelectKey]);

    const handleMouseEnter = useCallback((camelotKey) => {
        setHoveredKey(camelotKey);
    }, []);

    const handleMouseLeave = useCallback(() => {
        setHoveredKey(null);
    }, []);

    // Render segments
    const segments = useMemo(() => {
        const result = [];
        const segmentAngle = 360 / 12;

        CAMELOT_POSITIONS.forEach((pos, index) => {
            const startAngle = index * segmentAngle;
            const endAngle = (index + 1) * segmentAngle;
            const midAngle = startAngle + segmentAngle / 2;

            // Minor key (A) - Inner ring
            const keyA = `${pos.num}A`;
            const isActiveA = camelotA === keyA || camelotB === keyA;
            const isCompatibleA = compatibleWithA.has(keyA) || compatibleWithB.has(keyA);
            const isHoveredA = hoveredKey === keyA;

            result.push(
                <g key={keyA} className="camelot-segment">
                    <path
                        d={getSegmentPath(startAngle, endAngle, innerRadius, middleRadius)}
                        className={`segment-path ${isActiveA ? 'active' : ''} ${isCompatibleA ? 'compatible' : ''} ${isHoveredA ? 'hovered' : ''}`}
                        fill={getKeyColor(pos.minor)}
                        onClick={() => handleSegmentClick(keyA)}
                        onMouseEnter={() => handleMouseEnter(keyA)}
                        onMouseLeave={handleMouseLeave}
                    />
                    {showLabels && (
                        <text
                            x={getLabelPosition(midAngle, innerRadius + (middleRadius - innerRadius) / 2).x}
                            y={getLabelPosition(midAngle, innerRadius + (middleRadius - innerRadius) / 2).y}
                            className="segment-label"
                            dominantBaseline="middle"
                            textAnchor="middle"
                        >
                            {keyA}
                        </text>
                    )}
                </g>
            );

            // Major key (B) - Outer ring
            const keyB = `${pos.num}B`;
            const isActiveB = camelotA === keyB || camelotB === keyB;
            const isCompatibleB = compatibleWithA.has(keyB) || compatibleWithB.has(keyB);
            const isHoveredB = hoveredKey === keyB;

            result.push(
                <g key={keyB} className="camelot-segment">
                    <path
                        d={getSegmentPath(startAngle, endAngle, middleRadius, outerRadius)}
                        className={`segment-path ${isActiveB ? 'active' : ''} ${isCompatibleB ? 'compatible' : ''} ${isHoveredB ? 'hovered' : ''}`}
                        fill={getKeyColor(pos.major)}
                        onClick={() => handleSegmentClick(keyB)}
                        onMouseEnter={() => handleMouseEnter(keyB)}
                        onMouseLeave={handleMouseLeave}
                    />
                    {showLabels && (
                        <text
                            x={getLabelPosition(midAngle, middleRadius + (outerRadius - middleRadius) / 2).x}
                            y={getLabelPosition(midAngle, middleRadius + (outerRadius - middleRadius) / 2).y}
                            className="segment-label"
                            dominantBaseline="middle"
                            textAnchor="middle"
                        >
                            {keyB}
                        </text>
                    )}
                </g>
            );
        });

        return result;
    }, [camelotA, camelotB, compatibleWithA, compatibleWithB, hoveredKey, size, showLabels]);

    // Current deck indicators
    const deckIndicators = useMemo(() => {
        const indicators = [];

        if (camelotA) {
            const pos = CAMELOT_POSITIONS.find(p => `${p.num}A` === camelotA || `${p.num}B` === camelotA);
            if (pos) {
                const index = pos.num - 1;
                const angle = index * 30 + 15;
                const isMinor = camelotA.endsWith('A');
                const radius = isMinor ? (innerRadius + middleRadius) / 2 : (middleRadius + outerRadius) / 2;
                const { x, y } = getLabelPosition(angle, radius);
                indicators.push(
                    <circle
                        key="deck-a"
                        cx={x}
                        cy={y}
                        r={8}
                        className="deck-indicator deck-a"
                    />
                );
            }
        }

        if (camelotB) {
            const pos = CAMELOT_POSITIONS.find(p => `${p.num}A` === camelotB || `${p.num}B` === camelotB);
            if (pos) {
                const index = pos.num - 1;
                const angle = index * 30 + 15;
                const isMinor = camelotB.endsWith('A');
                const radius = isMinor ? (innerRadius + middleRadius) / 2 : (middleRadius + outerRadius) / 2;
                const { x, y } = getLabelPosition(angle, radius);
                indicators.push(
                    <circle
                        key="deck-b"
                        cx={x}
                        cy={y}
                        r={8}
                        className="deck-indicator deck-b"
                    />
                );
            }
        }

        return indicators;
    }, [camelotA, camelotB, size]);

    return (
        <div className="camelot-wheel-container">
            <svg
                width={size}
                height={size}
                viewBox={`0 0 ${size} ${size}`}
                className="camelot-wheel"
            >
                {/* Center circle */}
                <circle
                    cx={centerX}
                    cy={centerY}
                    r={innerRadius - 2}
                    className="wheel-center"
                />

                {/* Segments */}
                {segments}

                {/* Deck indicators */}
                {deckIndicators}
            </svg>

            {/* Legend */}
            <div className="camelot-legend">
                <div className="legend-item">
                    <span className="legend-dot deck-a" />
                    <span>Deck A: {currentKeyA || '--'}</span>
                </div>
                <div className="legend-item">
                    <span className="legend-dot deck-b" />
                    <span>Deck B: {currentKeyB || '--'}</span>
                </div>
            </div>

            {/* Hovered key info */}
            {hoveredKey && (
                <div className="camelot-hover-info">
                    <span className="hover-key">{hoveredKey}</span>
                    <span className="hover-musical">
                        {CAMELOT_POSITIONS.find(p => `${p.num}${hoveredKey.endsWith('A') ? 'A' : 'B'}` === hoveredKey)?.[hoveredKey.endsWith('A') ? 'minor' : 'major']}
                    </span>
                </div>
            )}
        </div>
    );
});

CamelotWheel.displayName = 'CamelotWheel';

export default CamelotWheel;

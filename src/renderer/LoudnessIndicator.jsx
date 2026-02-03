import React, { memo } from 'react';
import { Volume2, TrendingUp, TrendingDown, Minus } from 'lucide-react';

/**
 * Displays LUFS loudness with gain adjustment recommendation.
 * Shows how much gain to add/remove to reach target LUFS (-14).
 */
const LoudnessIndicator = memo(({ lufs, gainToTarget, compact = false }) => {
    if (lufs === null || lufs === undefined) {
        return compact ? null : (
            <div className="loudness-indicator empty">
                <Volume2 size={12} />
                <span>--</span>
            </div>
        );
    }

    // Determine color based on how far from target
    const absGain = Math.abs(gainToTarget || 0);
    let color, status, Icon;

    if (absGain <= 1) {
        color = '#10b981'; // Green - good
        status = 'Optimal';
        Icon = Minus;
    } else if (absGain <= 3) {
        color = '#f59e0b'; // Orange - minor adjustment
        status = gainToTarget > 0 ? 'Boost' : 'Reduce';
        Icon = gainToTarget > 0 ? TrendingUp : TrendingDown;
    } else {
        color = '#ef4444'; // Red - significant adjustment
        status = gainToTarget > 0 ? 'Low' : 'Hot';
        Icon = gainToTarget > 0 ? TrendingUp : TrendingDown;
    }

    if (compact) {
        return (
            <div
                className="loudness-indicator compact"
                style={{ color }}
                title={`${lufs} LUFS (${gainToTarget > 0 ? '+' : ''}${gainToTarget} dB to target)`}
            >
                <Volume2 size={10} />
                <span>{lufs}</span>
            </div>
        );
    }

    return (
        <div className="loudness-indicator" style={{ borderColor: color }}>
            <div className="loudness-value" style={{ color }}>
                <Volume2 size={14} />
                <span className="lufs-value">{lufs}</span>
                <span className="lufs-unit">LUFS</span>
            </div>
            {gainToTarget !== null && gainToTarget !== 0 && (
                <div className="loudness-adjust" style={{ color }}>
                    <Icon size={12} />
                    <span>{gainToTarget > 0 ? '+' : ''}{gainToTarget} dB</span>
                </div>
            )}
            <div className="loudness-status" style={{ color }}>
                {status}
            </div>
        </div>
    );
});

LoudnessIndicator.displayName = 'LoudnessIndicator';

export default LoudnessIndicator;

import React, { useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus, Check, X } from 'lucide-react';
import './bpmMatch.css';

const BPMMatch = ({ deckA, deckB }) => {
    const matchData = useMemo(() => {
        if (!deckA?.analysis?.bpm || !deckB?.analysis?.bpm) {
            return null;
        }

        const bpmA = deckA.analysis.bpm;
        const bpmB = deckB.analysis.bpm;
        const pitchPercent = ((bpmB - bpmA) / bpmA) * 100;
        const absPitch = Math.abs(pitchPercent);

        let color, status;
        if (absPitch <= 2) {
            color = '#10b981';
            status = 'Matched';
        } else if (absPitch <= 5) {
            color = '#f59e0b';
            status = 'Adjust';
        } else {
            color = '#ef4444';
            status = 'Off';
        }

        // Key compatibility
        const keyA = deckA.analysis?.key;
        const keyB = deckB.analysis?.key;
        let keyCompatible = false;
        if (keyA && keyB) {
            const numA = parseInt(keyA);
            const numB = parseInt(keyB);
            const letterA = keyA.slice(-1);
            const letterB = keyB.slice(-1);

            if (keyA === keyB) keyCompatible = true;
            else if (letterA === letterB && Math.abs(numA - numB) === 1) keyCompatible = true;
            else if (letterA === letterB && (numA === 12 && numB === 1 || numA === 1 && numB === 12)) keyCompatible = true;
            else if (numA === numB && letterA !== letterB) keyCompatible = true;
        }

        return {
            bpmA: Math.round(bpmA * 10) / 10,
            bpmB: Math.round(bpmB * 10) / 10,
            pitchPercent: pitchPercent.toFixed(1),
            color,
            status,
            direction: pitchPercent > 0 ? '+' : '',
            keyA,
            keyB,
            keyCompatible
        };
    }, [deckA, deckB]);

    if (!matchData) {
        return (
            <div className="bpm-match-bar empty">
                <span className="bpm-match-hint">Load tracks to both decks</span>
            </div>
        );
    }

    return (
        <div className="bpm-match-bar">
            <div className="bpm-info">
                <span className="deck-label">A</span>
                <span className="bpm-value">{matchData.bpmA}</span>
            </div>

            <div className="match-center">
                <div className="pitch-badge" style={{ backgroundColor: `${matchData.color}20`, color: matchData.color }}>
                    {matchData.direction}{matchData.pitchPercent}%
                </div>
                <div className={`key-badge ${matchData.keyCompatible ? 'compatible' : 'clash'}`}>
                    {matchData.keyCompatible ? <Check size={10} /> : <X size={10} />}
                    <span>{matchData.keyA} → {matchData.keyB}</span>
                </div>
            </div>

            <div className="bpm-info">
                <span className="bpm-value">{matchData.bpmB}</span>
                <span className="deck-label">B</span>
            </div>
        </div>
    );
};

export default BPMMatch;

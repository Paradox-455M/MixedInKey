import React, { useState } from 'react';
import { ArrowUp, ArrowDown, Music } from 'lucide-react';
import { getKeyColor, shiftKey } from './keyUtils';
import './library.css';

const KeyShiftPanel = ({ currentKey }) => {
    const [shift, setShift] = useState(0);

    const handleShift = (delta) => {
        setShift(prev => prev + delta);
    };

    const newKey = shiftKey(currentKey, shift);

    return (
        <div className="key-shift-panel">
            <div className="key-shift-header">
                <Music size={16} className="key-shift-icon" />
                <h3>Key Shift Calculator</h3>
            </div>

            <div className="key-shift-controls">
                <button className="shift-btn" onClick={() => handleShift(-1)}>
                    <ArrowDown size={14} /> -1
                </button>

                <div className="shift-display">
                    <div className="shift-amount">
                        {shift > 0 ? `+${shift}` : shift} Semitones
                    </div>
                    <div
                        className="shift-result-pill"
                        style={{
                            backgroundColor: getKeyColor(newKey),
                            color: '#fff',
                            textShadow: '0 1px 2px rgba(0,0,0,0.5)'
                        }}
                    >
                        {newKey}
                    </div>
                </div>

                <button className="shift-btn" onClick={() => handleShift(1)}>
                    <ArrowUp size={14} /> +1
                </button>
            </div>
        </div>
    );
};

export default KeyShiftPanel;

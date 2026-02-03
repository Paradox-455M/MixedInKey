import React from 'react';
import { Clock, Play } from 'lucide-react';

const HotCueCard = React.memo(({ slot, cue, onPlay }) => {
  if (!cue) return null;
  const timeStr = new Date((cue.time || 0) * 1000).toISOString().substr(14, 5);
  const handlePlay = () => {
    try {
      if (typeof onPlay === 'function') onPlay(cue);
    } catch (_) {}
  };
  return (
    <div className="cue-point-card clickable" onClick={handlePlay}>
      <div className="cue-header">
        <div className="cue-icon" style={{ backgroundColor: '#a78bfa' }}>
          <span style={{ fontWeight: 800 }}>{slot}</span>
        </div>
        <div className="cue-info">
          <div className="cue-name">Hot Cue {slot} • {cue.name}</div>
          <div className="cue-time">
            <Clock size={12} />
            {timeStr}
          </div>
        </div>
        <div className="cue-type-badge" style={{ backgroundColor: '#a78bfa' }}>
          HOT
        </div>
        <div className="play-cue-button" onClick={(e) => { e.stopPropagation(); handlePlay(); }}>
          <Play size={12} />
        </div>
      </div>
    </div>
  );
});

HotCueCard.displayName = 'HotCueCard';

export default HotCueCard;

import React, { useCallback, memo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * BeatJumpControls - Quick navigation by musical units
 * Jump forward/back by beats, bars, or phrases
 */

// Jump sizes in beats
const JUMP_SIZES = [
  { beats: 1, label: '1', title: '1 beat' },
  { beats: 4, label: 'BAR', title: '1 bar (4 beats)' },
  { beats: 16, label: '4', title: '4 bars' },
  { beats: 32, label: '8', title: '8 bars' },
  { beats: 64, label: '16', title: '16 bars' }
];

const BeatJumpControls = memo(({
  bpm = 120,
  onJump,
  quantize = false,
  downbeats = [],
  currentTime = 0
}) => {
  // Calculate beat duration in seconds
  const beatDuration = 60 / bpm;

  // Jump by number of beats
  const handleJump = useCallback((beats) => {
    if (!onJump) return;

    const jumpDuration = beats * beatDuration;

    if (quantize && downbeats && downbeats.length > 0) {
      // Find nearest beat to current position
      let nearestBeatIdx = 0;
      let minDiff = Infinity;

      for (let i = 0; i < downbeats.length; i++) {
        const diff = Math.abs(downbeats[i] - currentTime);
        if (diff < minDiff) {
          minDiff = diff;
          nearestBeatIdx = i;
        }
      }

      // Calculate target beat index
      const beatsToJump = Math.round(beats / 4); // downbeats are every 4 beats
      const targetIdx = Math.max(0, Math.min(downbeats.length - 1, nearestBeatIdx + beatsToJump));
      onJump(downbeats[targetIdx] - currentTime);
    } else {
      onJump(jumpDuration);
    }
  }, [onJump, beatDuration, quantize, downbeats, currentTime]);

  return (
    <div className="beat-jump-controls">
      <div className="beat-jump-label">BEAT JUMP</div>
      <div className="beat-jump-buttons">
        {JUMP_SIZES.map(({ beats, label, title }) => (
          <div key={beats} className="beat-jump-group">
            <button
              className="beat-jump-btn back"
              onClick={() => handleJump(-beats)}
              title={`Jump back ${title}`}
            >
              <ChevronLeft size={12} />
            </button>
            <span className="beat-jump-size" title={title}>{label}</span>
            <button
              className="beat-jump-btn forward"
              onClick={() => handleJump(beats)}
              title={`Jump forward ${title}`}
            >
              <ChevronRight size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
});

BeatJumpControls.displayName = 'BeatJumpControls';

export default BeatJumpControls;

const CAMELOT_RE = /^(?:[1-9]|1[0-2])[AB]$/;

const DEFAULT_OPTIONS = {
  energyCurve: 'warmup-peak-reset',
  peakPosition: 0.65,
};

const COMPATIBILITY_FALLBACK = 0.25;

const SCORE_WEIGHTS = {
  key: 0.55,
  energyTarget: 0.2,
  energyDelta: 0.15,
  bpm: 0.1,
};

const isValidCamelot = (key) => CAMELOT_RE.test(String(key || ''));

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const getTrackName = (analysis, file) => {
  if (analysis?.track_name) return analysis.track_name;
  if (analysis?.file_path) return analysis.file_path.split('/').pop();
  return file?.name || 'Unknown Track';
};

const getCueTime = (cues, types, pickLast = false) => {
  if (!Array.isArray(cues)) return null;
  const matches = cues.filter((cue) => types.includes(String(cue.type || '').toLowerCase()));
  if (!matches.length) return null;
  const sorted = matches.slice().sort((a, b) => (a.time || 0) - (b.time || 0));
  const cue = pickLast ? sorted[sorted.length - 1] : sorted[0];
  return typeof cue.time === 'number' ? cue.time : null;
};

const secondsToBars = (seconds, bpm) => {
  if (!seconds || !bpm) return null;
  const barSeconds = (60 / bpm) * 4;
  return seconds / barSeconds;
};

const normalizeTrack = ({ file, analysis }, index) => {
  const cues = analysis?.cue_points || analysis?.cues || [];
  const duration = analysis?.duration || 0;
  const bpm = analysis?.bpm || null;
  const energyRaw = analysis?.energy_analysis?.overall_energy ?? analysis?.energy_analysis?.energy_level ?? 5;
  const energy = clamp(Number(energyRaw) || 5, 1, 10);

  const mixInTime = getCueTime(cues, ['intro']) ?? 0;
  let mixOutTime = getCueTime(cues, ['outro'], true);
  if (mixOutTime == null && duration && bpm) {
    const bars = 16;
    const barSeconds = (60 / bpm) * 4;
    mixOutTime = Math.max(0, duration - bars * barSeconds);
  }
  if (mixOutTime == null && duration) {
    mixOutTime = Math.max(0, duration - 30);
  }

  return {
    id: `track-${index}`,
    filePath: file?.path || analysis?.file_path,
    fileName: file?.name || getTrackName(analysis, file),
    key: analysis?.key || null,
    bpm,
    energy,
    duration,
    cues,
    harmonicMixing: analysis?.harmonic_mixing || null,
    mixInTime,
    mixOutTime,
    mixInBars: secondsToBars(mixInTime, bpm),
    mixOutBars: mixOutTime != null ? secondsToBars(duration - mixOutTime, bpm) : null,
    analysis,
  };
};

const getCompatibleKeyScore = (from, to) => {
  const fromKey = from.key;
  const toKey = to.key;
  if (!fromKey || !toKey) {
    return { score: 0, reason: 'missing key' };
  }
  if (fromKey === toKey) {
    return { score: 1.0, reason: 'same key' };
  }
  const compatibleKeys = from.harmonicMixing?.compatible_keys || [];
  const match = compatibleKeys.find((keyInfo) => keyInfo.key === toKey);
  if (match) {
    return {
      score: typeof match.compatibility === 'number' ? match.compatibility : 0.8,
      reason: match.description || 'compatible key',
    };
  }
  return { score: COMPATIBILITY_FALLBACK, reason: 'key change risk' };
};

const getBpmScore = (from, to) => {
  if (!from.bpm || !to.bpm) {
    return { score: 0.6, diff: null };
  }
  const diff = Math.abs(from.bpm - to.bpm);
  let score = 0.2;
  if (diff <= 2) score = 1.0;
  else if (diff <= 4) score = 0.85;
  else if (diff <= 8) score = 0.65;
  else if (diff <= 12) score = 0.45;
  return { score, diff };
};

const buildEnergyTargets = (tracks, options) => {
  const energies = tracks.map((t) => t.energy).sort((a, b) => a - b);
  const minEnergy = energies[0] || 5;
  const maxEnergy = energies[energies.length - 1] || 8;
  const midEnergy = energies[Math.floor(energies.length / 2)] || (minEnergy + maxEnergy) / 2;
  const n = tracks.length;
  if (n <= 1) return [minEnergy];

  const peakIndex = clamp(Math.floor((options.peakPosition || 0.65) * (n - 1)), 1, n - 1);
  const targets = [];
  for (let i = 0; i < n; i += 1) {
    if (i <= peakIndex) {
      const t = peakIndex ? i / peakIndex : 0;
      targets.push(minEnergy + (maxEnergy - minEnergy) * t);
    } else {
      const t = (i - peakIndex) / Math.max(1, n - 1 - peakIndex);
      targets.push(maxEnergy - (maxEnergy - midEnergy) * t);
    }
  }
  return targets;
};

const scoreTransition = (from, to, targetEnergy) => {
  const key = getCompatibleKeyScore(from, to);
  const bpm = getBpmScore(from, to);
  const energyDelta = Math.abs(to.energy - from.energy);
  const energyDeltaScore = 1 - clamp(energyDelta / 5, 0, 1);
  const targetDelta = Math.abs(to.energy - targetEnergy);
  const targetScore = 1 - clamp(targetDelta / 5, 0, 1);

  let total = (key.score * SCORE_WEIGHTS.key)
    + (targetScore * SCORE_WEIGHTS.energyTarget)
    + (energyDeltaScore * SCORE_WEIGHTS.energyDelta)
    + (bpm.score * SCORE_WEIGHTS.bpm);

  if (key.score < 0.4) total -= 0.1;

  const reasons = [
    `Key: ${key.reason} (${Math.round(key.score * 100)}%)`,
    bpm.diff == null ? 'BPM: unknown' : `BPM diff: ${bpm.diff.toFixed(1)}`,
    `Energy move: ${energyDelta.toFixed(1)}`,
  ];

  return {
    total: clamp(total, 0, 1),
    keyScore: key.score,
    bpmScore: bpm.score,
    energyDeltaScore,
    targetScore,
    energyDelta,
    bpmDiff: bpm.diff,
    reasons,
  };
};

export const buildSetPlan = (analysisResults, options = {}) => {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const tracks = analysisResults.map((entry, idx) => normalizeTrack(entry, idx));

  const missingKey = tracks.filter((track) => !isValidCamelot(track.key));
  if (missingKey.length) {
    return {
      error: 'All tracks must have valid Camelot keys before planning.',
      missingKeys: missingKey.map((track) => track.fileName),
      tracks,
    };
  }

  const remaining = tracks.slice();
  const order = [];
  const targets = buildEnergyTargets(tracks, config);

  for (let i = 0; i < tracks.length; i += 1) {
    let selected = null;
    let selectedScore = -1;
    if (i === 0) {
      const targetEnergy = targets[0];
      remaining.forEach((track) => {
        const delta = Math.abs(track.energy - targetEnergy);
        const score = 1 - clamp(delta / 5, 0, 1);
        if (score > selectedScore) {
          selectedScore = score;
          selected = track;
        }
      });
    } else {
      const prev = order[order.length - 1];
      const targetEnergy = targets[i];
      remaining.forEach((track) => {
        const score = scoreTransition(prev, track, targetEnergy);
        if (score.total > selectedScore) {
          selectedScore = score.total;
          selected = track;
        }
      });
    }

    if (!selected) {
      selected = remaining[0];
    }

    order.push(selected);
    const idx = remaining.findIndex((track) => track.id === selected.id);
    if (idx >= 0) remaining.splice(idx, 1);
  }

  const transitions = [];
  for (let i = 0; i < order.length - 1; i += 1) {
    const from = order[i];
    const to = order[i + 1];
    const score = scoreTransition(from, to, targets[i + 1]);

    const overlapBars = Math.min(
      16,
      Math.max(
        8,
        Math.round(Math.min(from.mixOutBars || 16, to.mixInBars || 16))
      )
    );

    transitions.push({
      fromId: from.id,
      toId: to.id,
      score: Math.round(score.total * 100),
      reasons: score.reasons,
      bpmDiff: score.bpmDiff,
      energyDelta: score.energyDelta,
      mixOutTime: from.mixOutTime,
      mixInTime: to.mixInTime,
      overlapBars,
    });
  }

  return {
    tracks: order,
    transitions,
    targets,
    errors: [],
  };
};

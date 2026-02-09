from typing import Dict, Any, List, Optional
import numpy as np


class BridgeEnergyGapStage:
    """
    Step 14 — AI Bridge / Energy-Gap Detection
    ------------------------------------------
    Identifies the major “valley” between strong musical sections.

    Uses:
        • RMS valleys
        • Spectral flatness dips (silence-like or hollow sections)
        • Harmonic flux minima
        • Novelty minima
        • Beat-aligned snapping

    Returns:
        {
            "bridge": float | None,
            "cues": [...]
        }
    """

    # -------------------------
    # Utility
    # -------------------------
    def _norm(self, arr):
        arr = np.asarray(arr, dtype=float)
        if arr.size == 0:
            return arr
        mn, mx = float(np.min(arr)), float(np.max(arr))
        rng = mx - mn
        return (arr - mn) / (rng + 1e-12) if rng > 1e-9 else arr * 0.0

    def _snap_to_beat(self, t: float, beats: np.ndarray) -> float:
        """Snap forward to nearest beat."""
        if beats is None or len(beats) == 0 or t is None:
            return t
        forward = beats[beats >= t]
        if len(forward) == 0:
            return float(beats[np.argmin(np.abs(beats - t))])
        return float(forward[0])

    # -------------------------
    # Core Logic
    # -------------------------
    def run(self, file_path: str, y: Any = None, sr: int = None, features: Dict[str, Any] = None) -> Dict[str, Any]:
        import librosa
        import scipy.ndimage as ndi
        from scipy.signal import find_peaks

        cues: List[Dict[str, Any]] = []
        bridges: List[float] = []
        breakdowns: List[float] = []
        builds: List[float] = []

        try:
            if y is None or sr is None:
                y, sr = librosa.load(file_path, mono=True, sr=None)

            hop = 512
            duration = librosa.get_duration(y=y, sr=sr)

            # BPM-adaptive parameters
            bpm = 120.0
            if features and features.get('beat_times') is not None:
                beat_times = np.array(features['beat_times'])
                if len(beat_times) > 2:
                    median_ibi = float(np.median(np.diff(beat_times)))
                    if median_ibi > 0:
                        bpm = 60.0 / median_ibi
            else:
                _, beat_frames = librosa.beat.beat_track(
                    y=y, sr=sr, hop_length=hop, units="frames", trim=False
                )
                beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=hop)

            bar_seconds = 4.0 * 60.0 / max(bpm, 60.0)
            bar_frames = max(4, int(bar_seconds * sr / hop))

            # Use cached RMS from features if available
            if features and features.get('rms_512') is not None:
                rms = features['rms_512']
            else:
                rms = librosa.feature.rms(y=y, hop_length=hop)[0]
            rms_smooth = ndi.gaussian_filter1d(rms, sigma=4)
            rms_n = self._norm(rms_smooth)

            # Spectral flatness (empty/hollow sections)
            flat = librosa.feature.spectral_flatness(y=y, hop_length=hop)[0]
            flat_smooth = ndi.gaussian_filter1d(flat, sigma=5)
            flat_n = self._norm(1.0 - flat_smooth)

            # Use cached HPSS for harmonic flux analysis
            if features and features.get('y_harm') is not None:
                y_harm = features['y_harm']
            else:
                y_harm, _ = librosa.effects.hpss(y)
            cent = librosa.feature.spectral_centroid(y=y_harm, sr=sr, hop_length=hop)[0]
            cent_diff = np.abs(np.diff(ndi.gaussian_filter1d(cent, sigma=3)))
            cent_n = self._norm(np.pad(cent_diff, (0, 1)))

            # Novelty (minima = safe valley)
            contrast = librosa.feature.spectral_contrast(y=y, sr=sr, hop_length=hop)
            contrast_energy = np.mean(contrast, axis=0)
            novelty = np.abs(np.diff(ndi.gaussian_filter1d(contrast_energy, sigma=4)))
            nov_n = self._norm(np.pad(novelty, (1, 0)))

            # Multi-feature valley score
            valley_score = (1.0 - rms_n) + flat_n + (1.0 - cent_n) + (1.0 - nov_n)
            valley_score = self._norm(valley_score)

            times = librosa.frames_to_time(np.arange(len(valley_score)), sr=sr, hop_length=hop)

            # Search full track body (8s to duration-8s) instead of restricted 18-75%
            search_mask = (times > 8.0) & (times < duration - 8.0)

            if np.any(search_mask):
                masked_scores = valley_score.copy()
                masked_scores[~search_mask] = 0.0

                # Find ALL valleys using peak detection on inverted score
                valley_peaks, valley_props = find_peaks(
                    masked_scores,
                    distance=max(4, int(8 * bar_frames)),
                    prominence=0.15,
                    height=0.3,
                )

                for vp in valley_peaks:
                    t = float(times[vp])
                    rms_at_valley = float(rms_n[min(vp, len(rms_n) - 1)])

                    # Classify valley
                    if rms_at_valley < 0.25:
                        # Significant energy drop = breakdown
                        breakdowns.append(t)
                        cues.append({
                            "name": f"Breakdown {len(breakdowns)}",
                            "time": self._snap_to_beat(t, beat_times),
                            "type": "breakdown",
                            "confidence": 0.82,
                            "reason": "energy_gap_AI",
                            "instance": len(breakdowns),
                        })
                    elif rms_at_valley < 0.55:
                        # Reduced but present = bridge
                        bridges.append(t)
                        cues.append({
                            "name": f"Bridge {len(bridges)}",
                            "time": self._snap_to_beat(t, beat_times),
                            "type": "bridge",
                            "confidence": 0.78,
                            "reason": "energy_gap_AI",
                            "instance": len(bridges),
                        })

                    # Build detection: after each valley, check if RMS rises >30%
                    # over next 4-16 bars
                    build_search_start = vp
                    build_search_end = min(len(rms_n), vp + int(16 * bar_frames))
                    if build_search_end > build_search_start + int(4 * bar_frames):
                        segment = rms_n[build_search_start:build_search_end]
                        if len(segment) > 10:
                            # Find where slope rises significantly
                            start_val = float(np.mean(segment[:max(1, len(segment) // 8)]))
                            end_val = float(np.mean(segment[-max(1, len(segment) // 4):]))
                            if end_val > start_val + 0.30:
                                # Find the actual start of the rise
                                rise_start = build_search_start
                                for ri in range(build_search_start, build_search_end):
                                    if ri < len(rms_n) and rms_n[ri] > start_val + 0.10:
                                        rise_start = ri
                                        break
                                build_t = float(times[min(rise_start, len(times) - 1)])
                                # Ensure not too close to existing builds
                                min_build_gap = 4 * bar_seconds
                                if all(abs(build_t - bt) >= min_build_gap for bt in builds):
                                    builds.append(build_t)
                                    cues.append({
                                        "name": f"Build {len(builds)}",
                                        "time": self._snap_to_beat(build_t, beat_times),
                                        "type": "build",
                                        "confidence": 0.75,
                                        "reason": "energy_rise_AI",
                                        "instance": len(builds),
                                    })

        except Exception:
            pass

        bridge_t = bridges[0] if bridges else (breakdowns[0] if breakdowns else None)

        return {
            "bridge": bridge_t,
            "bridges": bridges,
            "breakdowns": breakdowns,
            "builds": builds,
            "cues": cues,
        }

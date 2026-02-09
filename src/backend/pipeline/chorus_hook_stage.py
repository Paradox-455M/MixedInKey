from typing import Dict, Any, Tuple, List, Optional
import numpy as np


class ChorusHookStage:
    """
    Step 13 – AI Chorus/Hook Detection
    ----------------------------------
    Uses:
        - Harmonic centroid motion
        - Spectral contrast spikes
        - Novelty curve
        - RMS bump voting
        - Beat-grid snapping

    Returns:
        {
            "chorus": float|None,
            "hook": float|None,
            "cues": [...]
        }
    """

    # -------------------------------------------
    # Helpers
    # -------------------------------------------

    def _norm(self, arr):
        """Min-max normalize safely."""
        if arr is None or len(arr) == 0:
            return arr
        arr = np.asarray(arr, dtype=float)
        mn, mx = float(np.min(arr)), float(np.max(arr))
        rng = mx - mn
        if rng < 1e-12:
            return arr * 0.0
        return (arr - mn) / (rng + 1e-12)

    def _snap_to_beat(self, t: float, beats: np.ndarray) -> float:
        """Snap time to nearest forward beat."""
        if beats is None or len(beats) == 0 or t is None:
            return t
        beats = np.asarray(beats)
        fwd = beats[beats >= t]
        if len(fwd) == 0:
            return float(beats[np.argmin(np.abs(beats - t))])
        return float(fwd[0])

    # -------------------------------------------
    # Core Detection
    # -------------------------------------------

    def _detect(self, y, sr, beats, hop, features=None) -> Tuple[List[float], List[float]]:
        """Detect ALL choruses and hooks (multi-instance)."""
        import librosa
        import scipy.ndimage as ndi
        from scipy import signal

        try:
            # Use cached HPSS from features if available (avoids expensive recomputation)
            if features and features.get('y_harm') is not None:
                y_harm = features['y_harm']
            else:
                y_harm, _ = librosa.effects.hpss(y)

            # Harmonic centroid motion
            centroid = librosa.feature.spectral_centroid(
                y=y_harm, sr=sr, hop_length=hop
            )[0]
            centroid_smooth = ndi.gaussian_filter1d(centroid, sigma=3)
            centroid_diff = np.abs(np.diff(centroid_smooth))

            # Spectral contrast
            contrast = librosa.feature.spectral_contrast(
                y=y, sr=sr, hop_length=hop
            )
            contrast_energy = np.mean(contrast, axis=0)
            contrast_smooth = ndi.gaussian_filter1d(contrast_energy, sigma=4)
            contrast_diff = np.abs(np.diff(contrast_smooth))

            # Novelty (contrast spike)
            novelty = contrast_diff.copy()

            # RMS bumps to reinforce chorus detection
            rms = librosa.feature.rms(y=y, hop_length=hop)[0]
            rms_smooth = ndi.gaussian_filter1d(rms, sigma=4)
            rms_diff = np.abs(np.diff(rms_smooth))

            # Normalize all features
            cd = self._norm(centroid_diff)
            ce = self._norm(contrast_diff)
            nv = self._norm(novelty)
            rd = self._norm(rms_diff)

            # Combined score
            n = min(len(cd), len(ce), len(nv), len(rd))
            if n < 20:
                return ([], [])

            score = cd[:n] + ce[:n] + 0.6 * nv[:n] + 0.4 * rd[:n]

            # Times
            score_times = librosa.frames_to_time(
                np.arange(len(score)), sr=sr, hop_length=hop
            )

            # BPM-adaptive parameters
            bpm = 120.0
            if features and features.get('beat_times') is not None:
                bt = np.array(features['beat_times'])
                if len(bt) > 2:
                    median_ibi = float(np.median(np.diff(bt)))
                    if median_ibi > 0:
                        bpm = 60.0 / median_ibi

            bar_seconds = 4.0 * 60.0 / max(bpm, 60.0)
            min_chorus_time = max(10.0, 4.0 * bar_seconds)  # 4 bars minimum
            min_gap = max(8.0, 8.0 * bar_seconds)  # 8 bars between detections

            # Peak detection
            peak_distance = max(6, int(min_gap / (float(hop) / sr)))
            peaks, props = signal.find_peaks(
                score,
                height=0.55 * (np.max(score) if np.size(score) > 0 else 1.0),
                distance=peak_distance
            )
            if len(peaks) == 0:
                return ([], [])

            # -------------------------------------------
            # Multi-chorus detection — find ALL peaks above threshold after min_chorus_time
            # -------------------------------------------
            choruses = []
            hooks = []
            chorus_threshold = 0.70 * np.max(score)
            hook_threshold = 0.50 * np.max(score)

            for p in peaks:
                t = float(score_times[p])
                s = float(score[p])
                if t < min_chorus_time:
                    continue

                # Check min gap from existing choruses
                if s >= chorus_threshold:
                    if all(abs(t - ct) >= min_gap for ct in choruses):
                        choruses.append(t)
                elif s >= hook_threshold:
                    if all(abs(t - ht) >= min_gap for ht in hooks):
                        if all(abs(t - ct) >= min_gap * 0.5 for ct in choruses):
                            hooks.append(t)

            # Snap all to beat-grid
            choruses = [self._snap_to_beat(t, beats) for t in choruses]
            hooks = [self._snap_to_beat(t, beats) for t in hooks]

            return choruses, hooks

        except Exception:
            return [], []

    # -------------------------------------------
    # Public API
    # -------------------------------------------

    def run(self, file_path: str, y: Any = None, sr: int = None, features: Dict[str, Any] = None) -> Dict[str, Any]:
        import librosa

        try:
            if y is None or sr is None:
                y, sr = librosa.load(file_path, mono=True, sr=None)
            hop = 512

            # Use cached beat times from features if available (avoids duplicate beat tracking)
            if features and features.get('beat_times') is not None:
                beat_times = features['beat_times']
            else:
                _, beat_frames = librosa.beat.beat_track(
                    y=y, sr=sr, hop_length=hop, units='frames', trim=False
                )
                beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=hop)

            choruses, hooks = self._detect(y, sr, beat_times, hop, features)

        except Exception:
            choruses, hooks = [], []

        # Build cues with instance numbering
        cues: List[Dict[str, Any]] = []
        chorus_t = choruses[0] if choruses else None
        hook_t = hooks[0] if hooks else None

        for i, t in enumerate(choruses):
            instance = i + 1
            cues.append({
                "name": f"Chorus {instance}" if len(choruses) > 1 else "Chorus",
                "time": float(t),
                "type": "chorus",
                "confidence": max(0.70, 0.85 - i * 0.05),
                "reason": "chorus_hook_AI",
                "instance": instance,
            })

        for i, t in enumerate(hooks):
            instance = i + 1
            cues.append({
                "name": f"Hook {instance}" if len(hooks) > 1 else "Hook",
                "time": float(t),
                "type": "hook",
                "confidence": max(0.65, 0.80 - i * 0.05),
                "reason": "chorus_hook_AI",
                "instance": instance,
            })

        return {
            "chorus": chorus_t,
            "hook": hook_t,
            "choruses": choruses,
            "hooks": hooks,
            "cues": cues,
        }

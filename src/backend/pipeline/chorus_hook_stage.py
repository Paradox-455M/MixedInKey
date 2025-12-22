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

    def _detect(self, y, sr, beats, hop) -> Tuple[Optional[float], Optional[float]]:
        import librosa
        import scipy.ndimage as ndi
        from scipy import signal

        try:
            # Harmonic separation
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
                return (None, None)

            score = cd[:n] + ce[:n] + 0.6 * nv[:n] + 0.4 * rd[:n]

            # Times
            score_times = librosa.frames_to_time(
                np.arange(len(score)), sr=sr, hop_length=hop
            )

            # Peak detection
            peaks, props = signal.find_peaks(
                score,
                height=0.55 * (np.max(score) if np.size(score) > 0 else 1.0),
                distance=6  # avoid micro-peaks
            )
            if len(peaks) == 0:
                return (None, None)

            # -------------------------------------------
            # Chorus detection
            # -------------------------------------------
            # First strong peak > 20s (avoids intro noise)
            chorus_t = None
            for p in peaks:
                t = float(score_times[p])
                if t > 20.0:
                    chorus_t = t
                    break

            if chorus_t is None:
                return (None, None)

            # -------------------------------------------
            # Hook detection
            # -------------------------------------------
            # Later peaks, minimum 12s after chorus
            later = [
                p for p in peaks
                if score_times[p] > chorus_t + 12.0
            ]

            hook_t = None
            if later:
                # Highest scoring later peak
                best_idx = later[np.argmax(score[later])]
                hook_t = float(score_times[best_idx])

            # Snap both to beat-grid
            chorus_t = self._snap_to_beat(chorus_t, beats)
            if hook_t is not None:
                hook_t = self._snap_to_beat(hook_t, beats)

            return chorus_t, hook_t

        except Exception:
            return None, None

    # -------------------------------------------
    # Public API
    # -------------------------------------------

    def run(self, file_path: str) -> Dict[str, Any]:
        import librosa

        try:
            y, sr = librosa.load(file_path, mono=True, sr=None)
            hop = 512

            # Beat grid
            _, beat_frames = librosa.beat.beat_track(
                y=y, sr=sr, hop_length=hop, units='frames', trim=False
            )
            beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=hop)

            chorus_t, hook_t = self._detect(y, sr, beat_times, hop)

        except Exception:
            chorus_t, hook_t = None, None

        # Build cues
        cues: List[Dict[str, Any]] = []

        if chorus_t is not None:
            cues.append({
                "name": "Chorus",
                "time": float(chorus_t),
                "type": "chorus",
                "confidence": 0.85,
                "reason": "chorus_hook_AI"
            })

        if hook_t is not None:
            cues.append({
                "name": "Hook",
                "time": float(hook_t),
                "type": "hook",
                "confidence": 0.80,
                "reason": "chorus_hook_AI"
            })

        return {
            "chorus": chorus_t,
            "hook": hook_t,
            "cues": cues
        }

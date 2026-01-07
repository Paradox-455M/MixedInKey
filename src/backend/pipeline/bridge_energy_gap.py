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
    def run(self, file_path: str, y=None, sr=None, beat_times=None) -> Dict[str, Any]:
        import librosa
        import scipy.ndimage as ndi

        bridge_t: Optional[float] = None
        cues: List[Dict[str, Any]] = []

        try:
            hop = 512
            if y is None or sr is None:
                y, sr = librosa.load(file_path, mono=True, sr=None)
            duration = librosa.get_duration(y=y, sr=sr)

            # Beat grid
            if beat_times is None:
                _, beat_frames = librosa.beat.beat_track(
                    y=y, sr=sr, hop_length=hop, units="frames", trim=False
                )
                beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=hop)

            # RMS energy
            rms = librosa.feature.rms(y=y, hop_length=hop)[0]
            rms_smooth = ndi.gaussian_filter1d(rms, sigma=4)
            rms_n = self._norm(rms_smooth)

            # Spectral flatness (empty/hollow sections)
            flat = librosa.feature.spectral_flatness(y=y, hop_length=hop)[0]
            flat_smooth = ndi.gaussian_filter1d(flat, sigma=5)
            flat_n = self._norm(1.0 - flat_smooth)  # low flatness = empty section

            # Harmonic flux (small = calm/bridge)
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

            # Restrict search window (core music body)
            search_mask = (
                (times > max(8.0, duration * 0.18)) &
                (times < duration * 0.75)
            )

            if np.any(search_mask):
                masked_scores = valley_score[search_mask]
                masked_times = times[search_mask]
                idx = int(np.argmax(masked_scores))
                bridge_t = float(masked_times[idx])

            # Beat snapping
            if bridge_t is not None:
                bridge_t = self._snap_to_beat(bridge_t, beat_times)

        except Exception:
            bridge_t = None

        # Final cue return
        if bridge_t is not None:
            cues.append({
                "name": "Bridge",
                "time": float(bridge_t),
                "type": "bridge",
                "confidence": 0.80,
                "reason": "energy_gap_AI"
            })

        return {"bridge": bridge_t, "cues": cues}

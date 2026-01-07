from typing import Dict, Any, List, Optional


class PyAudioStage:
    """
    Stage 3 – Structural Segmentation via pyAudioAnalysis (if available)
    --------------------------------------------------------------------
    Detects:
        - segment boundaries (novelty peaks)
        - silence regions
        - coarse structure markers (if possible)

    Fallback:
        - RMS-based novelty segmentation

    Outputs:
        {
            "segments": [ {start, end, label} ... ],
            "silences": [ {start, end} ... ],
            "boundaries": [float],
            "confidence": float,
            "reason": "pyaudio" | "fallback",
            "cues": []
        }
    """

    # ------------------------
    # Helpers
    # ------------------------

    def _norm(self, t: Any) -> Optional[float]:
        """Normalize timestamp → float seconds, reject invalid values."""
        try:
            v = float(t)
            if v < 0 or v != v:  # negative or NaN
                return None
            return v
        except Exception:
            return None

    # ------------------------
    # 1) PyAudioAnalysis Implementation
    # ------------------------

    def _pyaudio_segment(self, file_path: str) -> Optional[Dict[str, Any]]:
        """
        Attempt segmentation using pyAudioAnalysis.
        Returns dict or None on failure.
        """
        try:
            import numpy as np
            from pyAudioAnalysis import audioBasicIO, ShortTermFeatures
            import scipy.ndimage as ndi

            # Load audio
            [sr, y] = audioBasicIO.read_audio_file(file_path)
            if y is None or len(y) == 0:
                return None

            if y.ndim > 1:
                y = y.mean(axis=1)
            y = y.astype(float)

            # Normalize
            if np.max(np.abs(y)) > 0:
                y = y / (np.max(np.abs(y)) + 1e-9)

            win = 0.05  # 50ms
            step = 0.025  # 25ms

            F, feature_names = ShortTermFeatures.feature_extraction(
                y, sr,
                int(win * sr),
                int(step * sr)
            )

            # Use energy + flux as novelty proxy
            energy = F[0]
            flux = F[8] if F.shape[0] > 8 else energy

            novelty = ndi.gaussian_filter1d(energy + flux, sigma=2.0)
            diff = np.diff(novelty)

            times = np.arange(len(novelty)) * step
            peaks = (diff[1:] > 0) & (diff[:-1] <= 0)
            raw_bounds = times[1:-1][peaks]

            boundaries = [self._norm(t) for t in raw_bounds if self._norm(t) and t > 3.0]

            # Silence detection (simple threshold)
            silence_mask = np.abs(y) < 0.02
            silences = []
            cur_start = None
            for i, s in enumerate(silence_mask):
                if s and cur_start is None:
                    cur_start = i / sr
                elif not s and cur_start is not None:
                    silences.append({"start": self._norm(cur_start), "end": self._norm(i / sr)})
                    cur_start = None
            if cur_start is not None:
                silences.append({"start": self._norm(cur_start), "end": self._norm(len(y) / sr)})

            # Build segments from boundaries
            segs = []
            if boundaries:
                all_bounds = [0.0] + boundaries + [len(y) / sr]
                for i in range(len(all_bounds) - 1):
                    segs.append({
                        "start": self._norm(all_bounds[i]),
                        "end": self._norm(all_bounds[i+1]),
                        "label": f"segment_{i+1}"
                    })

            return {
                "boundaries": boundaries,
                "segments": segs,
                "silences": silences,
                "confidence": 0.75,
                "reason": "pyaudio"
            }

        except Exception:
            return None

    # ------------------------
    # 2) Librosa Fallback Implementation
    # ------------------------

    def _fallback_segment(self, file_path: str, y=None, sr: Optional[int] = None) -> Dict[str, Any]:
        """
        RMS-based novelty segmentation fallback.
        Always succeeds (as long as librosa installed).
        """
        import numpy as np
        import librosa
        import scipy.ndimage as ndi

        if y is None or sr is None:
            y, sr = librosa.load(file_path, mono=True, sr=None)

        hop = 512
        rms = librosa.feature.rms(y=y, hop_length=hop)[0]

        novelty = ndi.gaussian_filter1d(rms, sigma=4.0)
        diff = np.diff(novelty)

        times = librosa.frames_to_time(np.arange(len(novelty)), sr=sr, hop_length=hop)

        threshold = np.percentile(diff, 88) if len(diff) else 0.0
        raw_bounds = times[1:][diff[1:] > threshold]

        boundaries = [self._norm(b) for b in raw_bounds if self._norm(b) and b > 3.0]

        segs = []
        if boundaries:
            allb = [0.0] + boundaries + [len(y) / sr]
            for i in range(len(allb) - 1):
                segs.append({
                    "start": self._norm(allb[i]),
                    "end": self._norm(allb[i+1]),
                    "label": f"segment_{i+1}"
                })

        return {
            "boundaries": boundaries,
            "segments": segs,
            "silences": [],
            "confidence": 0.45,
            "reason": "fallback"
        }

    # ------------------------
    # Main API
    # ------------------------

    def run(self, file_path: str, y=None, sr: Optional[int] = None) -> Dict[str, Any]:
        """
        Top-level pipeline API.
        Guaranteed safe output.
        """
        result = self._pyaudio_segment(file_path)

        if result is None:
            result = self._fallback_segment(file_path, y=y, sr=sr)

        # Add cues (up to 6)
        cues = []
        for t in result["boundaries"][:6]:
            cues.append({
                "name": "Section Boundary",
                "time": t,
                "type": "section",
                "confidence": 0.55,
                "reason": result["reason"]
            })

        result["cues"] = cues
        return result

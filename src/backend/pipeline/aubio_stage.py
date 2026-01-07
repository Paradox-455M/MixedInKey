from typing import Dict, Any, List, Optional


class AubioStage:
    """
    Stage 2 – Aubio First-Beat & Onset Detection
    -------------------------------------------------
    Detects:
        - first strong beat
        - onset clusters
        - beatgrid

    If aubio is missing → fallback to librosa.
    Never throws exceptions (safe for pipeline use).
    """

    def _norm(self, t: Any) -> Optional[float]:
        """Normalize a timestamp into clean float seconds."""
        try:
            val = float(t)
            if val < 0 or val != val:  # negative or NaN
                return None
            return val
        except Exception:
            return None

    def _aubio_detect(self, file_path: str, y=None, sr: Optional[int] = None) -> Optional[Dict[str, Any]]:
        """
        Try aubio-based beat detection.
        Returns dict or None if aubio missing or errors.
        """
        try:
            import aubio
            import librosa  # used for safe loading if aubio cannot decode well

            # Load audio only if we weren't given it (avoid duplicate decode)
            if y is None or sr is None:
                y, sr = librosa.load(file_path, mono=True, sr=None)

            from aubio import tempo, source

            win_s = 1024
            hop_s = 512

            src = source(file_path, samplerate=sr, hop_size=hop_s)
            o = tempo("default", win_s, hop_s, sr)

            beats_sec = []
            total_frames = 0

            while True:
                samples, nread = src()
                if o(samples):  # True if beat detected
                    beat_time = o.get_last_s()
                    beats_sec.append(float(beat_time))

                total_frames += nread
                if nread < hop_s:
                    break

            # Detect onset clusters for "strongest" beat
            onset_clusters = self._aubio_onset_clusters(y, sr)

            return {
                "beats": [self._norm(b) for b in beats_sec if self._norm(b) is not None],
                "onsets": onset_clusters,
            }
        except Exception:
            return None

    def _aubio_onset_clusters(self, y, sr) -> List[float]:
        """
        Extract onset clusters using aubio onset detector.
        Clusters are helpful for ‘first strong beat’ estimation.
        """
        try:
            import aubio

            hop_s = 512
            win_s = 1024
            from aubio import onset

            on = onset("default", win_s, hop_s, sr)

            onsets = []
            import numpy as np
            total_frames = len(y)

            idx = 0
            while idx + hop_s <= total_frames:
                frame = y[idx: idx + hop_s].astype("float32")
                if on(frame):
                    onsets.append(float(on.get_last_s()))
                idx += hop_s

            return onsets
        except Exception:
            return []

    def _librosa_fallback(self, file_path: str) -> Dict[str, Any]:
        """
        Fallback: librosa-based onset + beat tracking.
        Always works (as long as librosa installed).
        """
        import librosa

        y, sr = librosa.load(file_path, mono=True, sr=None)

        hop = 512

        # Onset detection
        onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
        onset_frames = librosa.onset.onset_detect(onset_env=onset_env, sr=sr, hop_length=hop)
        onsets = librosa.frames_to_time(onset_frames, sr=sr, hop_length=hop)
        onsets = [self._norm(o) for o in onsets if self._norm(o) is not None]

        # Beat tracking
        tempo, beat_frames = librosa.beat.beat_track(
            y=y, sr=sr, hop_length=hop, units="frames", trim=False
        )
        beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=hop)
        beats = [self._norm(b) for b in beat_times if self._norm(b) is not None]

        return {"beats": beats, "onsets": onsets}

    def _first_strong_beat(self, beats: List[float], onsets: List[float]) -> Optional[float]:
        """
        Heuristic for the earliest reliable 'first strong beat'.
        Rules:
            - must occur after 0.25s
            - prioritize onset clusters over beatgrid
            - avoid silence/false positives
        """
        candidates = []

        # Prioritize onset clusters
        if onsets:
            for o in onsets:
                if o >= 0.25:
                    candidates.append(o)

        # Add beats
        if beats:
            for b in beats:
                if b >= 0.25:
                    candidates.append(b)

        if not candidates:
            return None

        return min(candidates)

    def run(self, file_path: str, y=None, sr: Optional[int] = None) -> Dict[str, Any]:
        """
        Stage output:
            {
              "first_strong_beat": float|None,
              "beats": [...],
              "beatgrid": [...],  # alias of beats for downstream stages
              "onsets": [...],
              "confidence": float,
              "cues": []
            }
        """
        beats = []
        onsets = []

        # Try aubio first
        aub = self._aubio_detect(file_path, y=y, sr=sr)
        if aub is not None:
            beats = aub.get("beats", [])
            onsets = aub.get("onsets", [])
            confidence = 0.85
        else:
            # librosa fallback
            # If we already have audio, avoid re-decoding for fallback too.
            if y is not None and sr is not None:
                import librosa
                hop = 512
                onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
                onset_frames = librosa.onset.onset_detect(onset_env=onset_env, sr=sr, hop_length=hop)
                onsets = librosa.frames_to_time(onset_frames, sr=sr, hop_length=hop)
                onsets = [self._norm(o) for o in onsets if self._norm(o) is not None]

                tempo, beat_frames = librosa.beat.beat_track(
                    y=y, sr=sr, hop_length=hop, units="frames", trim=False
                )
                beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=hop)
                beats = [self._norm(b) for b in beat_times if self._norm(b) is not None]
                fallback = {"beats": beats, "onsets": onsets}
            else:
                fallback = self._librosa_fallback(file_path)
            beats = fallback.get("beats", [])
            onsets = fallback.get("onsets", [])
            confidence = 0.60

        # Compute strongest starting beat
        fsb = self._first_strong_beat(beats, onsets)

        return {
            "first_strong_beat": fsb,
            "beats": beats,
            "beatgrid": beats,
            "onsets": onsets,
            "confidence": confidence,
            "cues": []  # First beat is not yet a cue (pipeline decides)
        }

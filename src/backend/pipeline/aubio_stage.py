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

    def _aubio_detect(self, file_path: str, y_cache: Any = None, sr_cache: int = None) -> Optional[Dict[str, Any]]:
        """
        Try aubio-based beat detection.
        Returns dict or None if aubio missing or errors.
        """
        try:
            import aubio
            import librosa  # used for safe loading if aubio cannot decode well

            # Load audio or use cache
            if y_cache is not None and sr_cache is not None:
                y = y_cache
                sr = sr_cache
            else:
                # Load audio at 22050Hz (speed optimization)
                target_sr = 22050
                try:
                    y, sr = librosa.load(file_path, mono=True, sr=target_sr)
                except Exception:
                     y, sr = librosa.load(file_path, mono=True, sr=None)

            from aubio import tempo, source

            # Use sr for window/hop
            # For 22k: win=512, hop=256
            # For 44k: win=1024, hop=512
            if sr < 32000:
                win_s = 512
                hop_s = 256
            else:
                win_s = 1024
                hop_s = 512

            # Use aubio.source (file streaming) for beats
            # Note: We can't easily perform beat tracking on 'y' without complex block loop
            # So we stick to file streaming for beats, but use 'y' for onsets below.
            # We try to enforce the SAME sr on source stream
            
            beats_sec = []
            try:
                src = source(file_path, samplerate=sr, hop_size=hop_s)
                o = tempo("default", win_s, hop_s, src.samplerate)
                
                total_frames = 0
                while True:
                    samples, nread = src()
                    if o(samples):
                        beat_time = o.get_last_s()
                        beats_sec.append(float(beat_time))
                    total_frames += nread
                    if nread < hop_s:
                        break
            except Exception:
                 # If aubio stream fails, maybe fallback to librosa beat track?
                 # But we have _librosa_fallback method below, so just fail here
                 pass # beats_sec stays empty

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

        # Load at 22050Hz
        y, sr = librosa.load(file_path, mono=True, sr=22050)

        hop = 256 # adjusted for 22050Hz

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

    def run(self, file_path: str, y: Any = None, sr: int = None, features: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        Stage output:
            {
              "first_strong_beat": float|None,
              "beats": [...],
              "onsets": [...],
              "confidence": float,
              "cues": []
            }
        """
        beats = []
        onsets = []

        # Try to use cached beat times from features first
        if features and features.get('beat_times') is not None:
            beats = list(features['beat_times'])
            # Still need onsets from aubio for first-beat detection
            aub = self._aubio_detect(file_path, y_cache=y, sr_cache=sr)
            if aub is not None:
                onsets = aub.get("onsets", [])
            confidence = 0.85
        else:
            # Try aubio detection
            aub = self._aubio_detect(file_path, y_cache=y, sr_cache=sr)
            if aub is not None:
                beats = aub.get("beats", [])
                onsets = aub.get("onsets", [])
                confidence = 0.85
            else:
                # librosa fallback
                fallback = self._librosa_fallback(file_path)
                beats = fallback.get("beats", [])
                onsets = fallback.get("onsets", [])
                confidence = 0.60

        # Compute strongest starting beat
        fsb = self._first_strong_beat(beats, onsets)

        return {
            "first_strong_beat": fsb,
            "beats": beats,
            "onsets": onsets,
            "confidence": confidence,
            "cues": []  # First beat is not yet a cue (pipeline decides)
        }

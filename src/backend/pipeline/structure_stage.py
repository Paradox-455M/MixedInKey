"""
Structure Stage — Chroma Self-Similarity Song Structure Detection
-----------------------------------------------------------------
Uses beat-synchronous chroma features, recurrence matrix, and spectral
novelty to detect structural sections (intro, verse, chorus, bridge,
breakdown, build, outro) with multi-instance labeling.

Output schema (backward compatible):
    {
        "song_structure": [
            {"type": "chorus", "start": 64.0, "end": 96.0, "duration": 32.0,
             "instance": 1, "energy": 7.5, "confidence": 0.88, "repeat_group": "A"}
        ]
    }
"""

from typing import Dict, Any, List, Optional
import numpy as np


class StructureStage:
    """Detect song structure via chroma self-similarity and structural novelty."""

    def run(self, file_path: str, y: Any = None, sr: int = None,
            features: Dict[str, Any] = None) -> Dict[str, Any]:
        import librosa
        from scipy import ndimage, signal
        from scipy.spatial.distance import cosine as cosine_dist

        try:
            if y is None or sr is None:
                y, sr = librosa.load(file_path, mono=True, sr=None)

            duration = float(len(y) / sr)
            hop = 512

            # --- Beat-synchronous chroma features ---
            # Use cached beat times from features if available
            if features and features.get('beat_times') is not None:
                beat_times = np.array(features['beat_times'])
            else:
                _, beat_frames = librosa.beat.beat_track(
                    y=y, sr=sr, hop_length=hop, units='frames', trim=False
                )
                beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=hop)

            if len(beat_times) < 8:
                return {"song_structure": self._fallback_structure(duration)}

            # Compute CQT chroma and sync to beats
            chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop)
            beat_frames = librosa.time_to_frames(beat_times, sr=sr, hop_length=hop)
            beat_frames = np.clip(beat_frames, 0, chroma.shape[1] - 1)
            chroma_sync = librosa.util.sync(chroma, beat_frames, aggregate=np.median)

            if chroma_sync.shape[1] < 4:
                return {"song_structure": self._fallback_structure(duration)}

            # --- Recurrence matrix ---
            rec = librosa.segment.recurrence_matrix(
                chroma_sync, mode='affinity', sym=True, k=None
            )

            # --- Structural novelty via checkerboard kernel ---
            novelty = self._checkerboard_novelty(rec, kernel_size=16)
            novelty_smooth = ndimage.gaussian_filter1d(novelty, sigma=1.5)

            # --- Peak-pick boundaries ---
            min_dist = max(4, int(len(novelty_smooth) * 0.03))  # at least ~3% of track
            height = np.percentile(novelty_smooth, 55) if len(novelty_smooth) > 10 else 0.0
            peaks, _ = signal.find_peaks(novelty_smooth, distance=min_dist, height=height)

            # Convert beat indices to times
            # peaks are indices into beat_times (sync frames correspond to beats)
            n_beats = min(chroma_sync.shape[1], len(beat_times))
            boundary_beats = [0] + [int(p) for p in peaks if p < n_beats] + [n_beats - 1]
            boundary_beats = sorted(set(boundary_beats))

            # Map to times, snap to downbeats (every 4th beat)
            boundary_times = []
            for bi in boundary_beats:
                bi_clamped = min(bi, len(beat_times) - 1)
                # Snap to nearest downbeat (4-beat boundary)
                snapped = round(bi_clamped / 4) * 4
                snapped = max(0, min(snapped, len(beat_times) - 1))
                boundary_times.append(float(beat_times[snapped]))
            boundary_times = sorted(set(boundary_times))

            # Ensure start and end
            if boundary_times[0] > 1.0:
                boundary_times.insert(0, 0.0)
            if boundary_times[-1] < duration - 2.0:
                boundary_times.append(duration)

            # --- Compute mean chroma per segment for similarity grouping ---
            segments = []
            segment_chromas = []
            for i in range(len(boundary_times) - 1):
                start = boundary_times[i]
                end = boundary_times[i + 1]
                seg_dur = end - start
                if seg_dur < 1.0:
                    continue

                # Mean chroma for this time range
                start_frame = librosa.time_to_frames(start, sr=sr, hop_length=hop)
                end_frame = librosa.time_to_frames(end, sr=sr, hop_length=hop)
                end_frame = min(end_frame, chroma.shape[1])
                if end_frame <= start_frame:
                    continue
                seg_chroma = np.mean(chroma[:, start_frame:end_frame], axis=1)

                # RMS energy for this segment
                seg_audio = y[int(start * sr):int(end * sr)]
                seg_rms = float(np.sqrt(np.mean(seg_audio ** 2))) if len(seg_audio) > 0 else 0.0

                segments.append({
                    'start': start,
                    'end': end,
                    'duration': seg_dur,
                    'rms': seg_rms,
                })
                segment_chromas.append(seg_chroma)

            if not segments:
                return {"song_structure": self._fallback_structure(duration)}

            # --- Group similar segments by chroma cosine similarity ---
            n_seg = len(segments)
            group_labels = [-1] * n_seg
            current_group = 0
            group_names = []  # 'A', 'B', 'C', ...

            for i in range(n_seg):
                if group_labels[i] >= 0:
                    continue
                group_labels[i] = current_group
                group_names.append(chr(65 + min(current_group, 25)))  # A-Z
                for j in range(i + 1, n_seg):
                    if group_labels[j] >= 0:
                        continue
                    sim = 1.0 - cosine_dist(segment_chromas[i], segment_chromas[j])
                    if sim > 0.85:
                        group_labels[j] = current_group
                current_group += 1

            # --- Label sections based on energy + position + repetition ---
            rms_values = [s['rms'] for s in segments]
            rms_p50 = np.percentile(rms_values, 50) if rms_values else 0.0
            rms_p75 = np.percentile(rms_values, 75) if rms_values else 0.0
            rms_p25 = np.percentile(rms_values, 25) if rms_values else 0.0

            # Count how many times each group appears
            from collections import Counter
            group_counts = Counter(group_labels)

            # Determine which groups are "repeated" (appear 2+ times)
            repeated_groups = {g for g, cnt in group_counts.items() if cnt >= 2}

            # Track instance counts per type
            type_instance_counts = {}

            structure = []
            for i, seg in enumerate(segments):
                grp = group_labels[i]
                rms = seg['rms']
                is_first = (i == 0)
                is_last = (i == n_seg - 1)
                is_repeated = grp in repeated_groups

                if is_first and rms < rms_p50:
                    seg_type = 'intro'
                elif is_last and rms < rms_p50:
                    seg_type = 'outro'
                elif is_repeated and rms >= rms_p75:
                    seg_type = 'chorus'
                elif is_repeated and rms < rms_p50:
                    seg_type = 'verse'
                elif not is_repeated and rms < rms_p25:
                    seg_type = 'breakdown'
                elif not is_repeated and rms < rms_p50:
                    seg_type = 'bridge'
                elif rms >= rms_p75:
                    seg_type = 'chorus'
                else:
                    seg_type = 'verse'

                # Detect "build" — rising energy before a chorus/drop
                if i < n_seg - 1:
                    next_rms = segments[i + 1]['rms']
                    if (rms < rms_p50 and next_rms >= rms_p75 and
                            seg['duration'] >= 4.0 and seg['duration'] <= 32.0):
                        seg_type = 'build'

                # Instance numbering
                type_instance_counts[seg_type] = type_instance_counts.get(seg_type, 0) + 1
                instance = type_instance_counts[seg_type]

                # Map RMS to 1-10 energy scale
                rms_max = max(rms_values) if rms_values else 1.0
                energy_1_10 = round(1.0 + (rms / (rms_max + 1e-10)) * 9.0, 1)

                # Confidence based on group size + energy distinctiveness
                conf = 0.70
                if is_repeated:
                    conf += 0.10
                if abs(rms - rms_p50) > (rms_p75 - rms_p25) * 0.5:
                    conf += 0.08
                conf = min(conf, 0.95)

                structure.append({
                    'type': seg_type,
                    'start': round(seg['start'], 2),
                    'end': round(seg['end'], 2),
                    'duration': round(seg['duration'], 2),
                    'instance': instance,
                    'energy': energy_1_10,
                    'confidence': round(conf, 2),
                    'repeat_group': group_names[grp] if grp < len(group_names) else '?',
                })

            if not structure:
                return {"song_structure": self._fallback_structure(duration)}

            return {"song_structure": structure}

        except Exception:
            return {"song_structure": self._fallback_structure(
                float(len(y) / sr) if y is not None and sr else 180.0
            )}

    def _checkerboard_novelty(self, rec: np.ndarray, kernel_size: int = 16) -> np.ndarray:
        """Compute structural novelty via checkerboard kernel convolution along diagonal."""
        n = rec.shape[0]
        if n < kernel_size:
            kernel_size = max(2, n // 2)

        # Build checkerboard kernel
        k = kernel_size
        half = k // 2
        kernel = np.ones((k, k))
        kernel[:half, :half] = -1
        kernel[half:, half:] = -1

        # Extract novelty along the diagonal
        novelty = np.zeros(n)
        pad = half
        rec_pad = np.pad(rec, pad, mode='reflect')
        for i in range(n):
            ii = i + pad
            block = rec_pad[ii - half:ii + half, ii - half:ii + half]
            if block.shape == (k, k):
                novelty[i] = np.sum(block * kernel)

        # Normalize
        mx = np.max(np.abs(novelty))
        if mx > 0:
            novelty = novelty / mx
        return np.clip(novelty, 0.0, None)

    def _fallback_structure(self, duration: float) -> List[Dict]:
        """Minimal fallback structure."""
        dur = max(duration, 10.0)
        return [
            {'type': 'intro', 'start': 0.0, 'end': min(30.0, dur * 0.15),
             'duration': min(30.0, dur * 0.15), 'instance': 1, 'energy': 3.0,
             'confidence': 0.5, 'repeat_group': 'X'},
            {'type': 'verse', 'start': min(30.0, dur * 0.15), 'end': dur * 0.85,
             'duration': dur * 0.70, 'instance': 1, 'energy': 5.0,
             'confidence': 0.5, 'repeat_group': 'Y'},
            {'type': 'outro', 'start': dur * 0.85, 'end': dur,
             'duration': dur * 0.15, 'instance': 1, 'energy': 3.0,
             'confidence': 0.5, 'repeat_group': 'Z'},
        ]

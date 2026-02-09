"""
Energy Level Analysis Module
Provides tools for analyzing track energy levels and energy-based mixing techniques.
Enables DJs to curate playlists and transitions based on energy levels.
"""

import numpy as np
import librosa
from typing import Dict, List, Tuple, Optional
from enum import Enum

try:
    import pyloudnorm as pyln
    _HAS_PYLOUDNORM = True
except ImportError:
    _HAS_PYLOUDNORM = False

class EnergyLevel(Enum):
    """Energy level classifications."""
    VERY_LOW = 1
    LOW = 2
    MEDIUM_LOW = 3
    MEDIUM = 4
    MEDIUM_HIGH = 5
    HIGH = 6
    VERY_HIGH = 7
    EXTREME = 8
    MAXIMUM = 9
    OVERDRIVE = 10

class EnergyAnalyzer:
    def __init__(self):
        # Energy level descriptions
        self.energy_descriptions = {
            EnergyLevel.VERY_LOW: "Very low energy - ambient, atmospheric, introspective",
            EnergyLevel.LOW: "Low energy - chill, downtempo, relaxed",
            EnergyLevel.MEDIUM_LOW: "Medium-low energy - groovy, laid-back, warm-up",
            EnergyLevel.MEDIUM: "Medium energy - balanced, steady, foundation",
            EnergyLevel.MEDIUM_HIGH: "Medium-high energy - building, engaging, momentum",
            EnergyLevel.HIGH: "High energy - peak, driving, intense",
            EnergyLevel.VERY_HIGH: "Very high energy - explosive, powerful, climax",
            EnergyLevel.EXTREME: "Extreme energy - maximum intensity, peak moment",
            EnergyLevel.MAXIMUM: "Maximum energy - absolute peak, overwhelming",
            EnergyLevel.OVERDRIVE: "Overdrive energy - beyond normal limits, special effect"
        }
        
        # Energy mixing techniques
        self.energy_techniques = {
            'energy_build': 'Gradually increase energy levels',
            'energy_release': 'Gradually decrease energy levels',
            'energy_plateau': 'Maintain consistent energy level',
            'energy_drop': 'Sudden decrease in energy',
            'energy_boost': 'Sudden increase in energy',
            'energy_oscillation': 'Alternate between high and low energy'
        }

    def analyze_energy_level(self, y: np.ndarray, sr: int, song_structure: List[Dict] = None) -> Dict:
        """Analyze energy with perceptual loudness, LUFS, and robust normalization."""
        try:
            # Calculate various energy metrics (normalized 0-1)
            rms_energy = self._calculate_rms_energy(y, sr)
            loudness = self._calculate_perceptual_loudness(y, sr)
            lufs_loudness = self._calculate_lufs_loudness(y, sr)
            spectral_energy = self._calculate_spectral_energy(y, sr)
            rhythmic_energy = self._calculate_rhythmic_energy(y, sr)
            dynamic_energy = self._calculate_dynamic_energy(y, sr)

            # Combine metrics for overall energy score (0-1)
            overall_energy_0_1 = self._combine_energy_metrics(
                rms_energy, spectral_energy, rhythmic_energy, dynamic_energy, loudness, lufs_loudness
            )

            # Map to 1-10
            overall_energy = 1 + overall_energy_0_1 * 9

            # Classify energy level
            energy_level = self._classify_energy_level(overall_energy)

            # Calculate energy profile over structural segments, normalized per track
            energy_profile = self._calculate_energy_profile(y, sr, song_structure)
            # Calculate continuous energy curve over entire track for line graph
            energy_curve = self._compute_energy_curve(y, sr)
            # Calculate LUFS time-series curve
            lufs_curve = self._compute_lufs_curve(y, sr)

            return {
                'overall_energy': round(float(overall_energy), 2),
                'energy_level': energy_level.value,
                'energy_level_name': energy_level.name,
                'energy_description': self.energy_descriptions[energy_level],
                'energy_metrics': {
                    'rms_energy': float(rms_energy),
                    'perceptual_loudness': float(loudness),
                    'lufs_loudness': float(lufs_loudness),
                    'spectral_energy': float(spectral_energy),
                    'rhythmic_energy': float(rhythmic_energy),
                    'dynamic_energy': float(dynamic_energy)
                },
                'energy_profile': energy_profile,
                'energy_curve': energy_curve,
                'lufs_curve': lufs_curve,
                'energy_peaks': self._find_energy_peaks(energy_profile),
                'energy_valleys': self._find_energy_valleys(energy_profile)
            }

        except Exception as e:
            raise Exception(f"Energy analysis failed: {str(e)}")

    def _compute_energy_curve(self, y: np.ndarray, sr: int) -> List[Dict]:
        """Return time-series energy curve normalized to 1-10, ~400 points max.

        Uses short-time RMS in dB with smoothing and robust percentile scaling.
        """
        try:
            hop = 512
            rms = librosa.feature.rms(y=y, hop_length=hop)[0]
            # Convert to dB-like scale and smooth
            rms_db = 20 * np.log10(rms + 1e-8)
            from scipy import ndimage
            rms_db = ndimage.gaussian_filter1d(rms_db, sigma=3.0)

            # Normalize using 5th-95th percentiles
            p5, p95 = np.percentile(rms_db, [5, 95])
            if p95 > p5:
                norm = (rms_db - p5) / (p95 - p5)
            else:
                norm = np.zeros_like(rms_db)
            norm = np.clip(norm, 0.0, 1.0)

            # Map to 1..10
            energy_1_10 = 1.0 + norm * 9.0

            # Decimate to ~400 points for UI
            max_points = 400
            step = int(max(1, np.ceil(len(energy_1_10) / max_points)))
            frames = np.arange(0, len(energy_1_10), step)
            times = librosa.frames_to_time(frames, sr=sr, hop_length=hop)

            curve: List[Dict] = []
            for i, f in enumerate(frames):
                curve.append({
                    'time': float(times[i]),
                    'energy': float(np.round(energy_1_10[f], 2))
                })
            return curve
        except Exception:
            return []

    def _calculate_rms_energy(self, y: np.ndarray, sr: int) -> float:
        """RMS energy normalized per signal (0-1)."""
        try:
            hop_length = 1024
            rms = librosa.feature.rms(y=y, hop_length=hop_length)[0]
            if np.max(rms) > 0:
                rms = rms / np.max(rms)
            return float(np.mean(rms))
            
        except Exception:
            return 0.0

    def _calculate_perceptual_loudness(self, y: np.ndarray, sr: int) -> float:
        """Approximate perceptual loudness (0-1) using mel-spectrogram and A-weighting."""
        try:
            safe_fmax = float(min(16000.0, max(200.0, (sr / 2.0) - 100.0)))
            S = librosa.feature.melspectrogram(y=y, sr=sr, n_mels=64, fmin=20, fmax=safe_fmax, power=2.0)
            freqs = librosa.mel_frequencies(n_mels=64, fmin=20, fmax=safe_fmax)
            S_dbA = librosa.perceptual_weighting(S, freqs)
            loud_db = float(np.mean(S_dbA))
            # Normalize from [-60, 0] dB to [0,1]
            return float(np.clip((loud_db + 60.0) / 60.0, 0.0, 1.0))
        except Exception:
            return 0.0

    def _calculate_lufs_loudness(self, y: np.ndarray, sr: int) -> float:
        """Calculate integrated LUFS loudness (0-1) using pyloudnorm or fallback."""
        try:
            if _HAS_PYLOUDNORM:
                meter = pyln.Meter(sr)
                # pyloudnorm expects shape (samples,) or (samples, channels)
                lufs = meter.integrated_loudness(y)
                if np.isnan(lufs) or np.isinf(lufs):
                    lufs = -40.0
            else:
                # Fallback: approximate LUFS from RMS in dB
                rms = np.sqrt(np.mean(y ** 2))
                lufs = 20.0 * np.log10(rms + 1e-10)
            # Map LUFS [-40, -6] → [0, 1]
            return float(np.clip((lufs + 40.0) / 34.0, 0.0, 1.0))
        except Exception:
            return 0.0

    def _compute_lufs_curve(self, y: np.ndarray, sr: int) -> List[Dict]:
        """Return LUFS time-series curve with ~200 points using 3-second sliding window."""
        try:
            window_sec = 3.0
            window_samples = int(window_sec * sr)
            if window_samples < 1 or len(y) < window_samples:
                return []

            # Target ~200 points
            max_points = 200
            hop_samples = max(1, (len(y) - window_samples) // max_points)

            lufs_values = []
            times = []

            if _HAS_PYLOUDNORM:
                meter = pyln.Meter(sr)
                for start in range(0, len(y) - window_samples, hop_samples):
                    segment = y[start:start + window_samples]
                    lufs = meter.integrated_loudness(segment)
                    if np.isnan(lufs) or np.isinf(lufs):
                        lufs = -40.0
                    lufs_values.append(lufs)
                    times.append(start / sr)
            else:
                # Fallback: RMS-based approximation
                for start in range(0, len(y) - window_samples, hop_samples):
                    segment = y[start:start + window_samples]
                    rms = np.sqrt(np.mean(segment ** 2))
                    lufs = 20.0 * np.log10(rms + 1e-10)
                    lufs_values.append(lufs)
                    times.append(start / sr)

            if not lufs_values:
                return []

            # Normalize to 1-10 scale for UI consistency
            arr = np.array(lufs_values)
            p5, p95 = np.percentile(arr, [5, 95])
            if p95 > p5:
                norm = np.clip((arr - p5) / (p95 - p5), 0.0, 1.0)
            else:
                norm = np.zeros_like(arr)
            energy_1_10 = 1.0 + norm * 9.0

            curve = []
            for i in range(len(times)):
                curve.append({
                    'time': round(float(times[i]), 2),
                    'lufs': round(float(lufs_values[i]), 1),
                    'energy': round(float(energy_1_10[i]), 2)
                })
            return curve
        except Exception:
            return []

    def _calculate_spectral_energy(self, y: np.ndarray, sr: int) -> float:
        """Calculate spectral energy with frequency weighting."""
        try:
            # Calculate spectrogram
            stft = librosa.stft(y, hop_length=512, n_fft=2048)
            magnitude = np.abs(stft)
            
            # Frequency bins
            freq_bins = librosa.fft_frequencies(sr=sr, n_fft=2048)
            
            # Perceptually important frequency bands
            # Low: 20-500 Hz (bass+kick), Mid: 500-4000 Hz (vocals), High: 4000-16000 Hz (presence)
            low_mask = (freq_bins >= 20) & (freq_bins <= 500)
            mid_mask = (freq_bins >= 500) & (freq_bins <= 4000)
            high_mask = (freq_bins >= 4000) & (freq_bins <= 16000)
            
            # Weighted energy calculation
            low_energy = np.mean(np.sum(magnitude[low_mask], axis=0))
            mid_energy = np.mean(np.sum(magnitude[mid_mask], axis=0))
            high_energy = np.mean(np.sum(magnitude[high_mask], axis=0))
            
            # Perceptual weighting (mid frequencies are most important)
            weighted_energy = (low_energy * 0.3 + mid_energy * 0.5 + high_energy * 0.2)
            
            # Normalize by total energy
            total_energy = low_energy + mid_energy + high_energy
            if total_energy > 0:
                return float(weighted_energy / total_energy)
            else:
                return 0.0
                
        except Exception:
            return 0.0

    def _calculate_rhythmic_energy(self, y: np.ndarray, sr: int) -> float:
        """Calculate rhythmic energy with beat emphasis."""
        try:
            # Separate harmonic and percussive components
            y_harmonic, y_percussive = librosa.effects.hpss(y, margin=8.0)
            
            # Focus on percussive component for rhythm
            onset_env = librosa.onset.onset_strength(
                y=y_percussive,
                sr=sr,
                hop_length=512,
                lag=2,
                max_size=3,
                aggregate=np.median
            )
            
            # Detect beats
            tempo, beats = librosa.beat.beat_track(
                onset_envelope=onset_env,
                sr=sr,
                hop_length=512,
                units='time'
            )
            
            # Calculate beat strength
            if len(beats) > 1:
                # Beat regularity (more regular = higher rhythmic energy)
                beat_intervals = np.diff(beats)
                beat_regularity = 1.0 / (1.0 + np.std(beat_intervals))
                
                # Onset strength at beats
                beat_frames = librosa.time_to_frames(beats, sr=sr, hop_length=512)
                beat_frames = beat_frames[beat_frames < len(onset_env)]
                
                if len(beat_frames) > 0:
                    beat_strength = np.mean(onset_env[beat_frames])
                    return float(beat_strength * beat_regularity)
            
            # Fallback to mean onset strength
            return float(np.mean(onset_env))
            
        except Exception:
            return 0.0

    def _calculate_dynamic_energy(self, y: np.ndarray, sr: int) -> float:
        """Dynamic range proxy (0-1) using percentile RMS in dB."""
        try:
            hop_length = 1024
            rms = librosa.feature.rms(y=y, hop_length=hop_length)[0]
            rms_db = 20 * np.log10(rms + 1e-8)
            p95 = np.percentile(rms_db, 95)
            p05 = np.percentile(rms_db, 5)
            dr = max(p95 - p05, 0.0)
            return float(np.clip(dr / 60.0, 0.0, 1.0))
            
        except Exception:
            return 0.0

    def _combine_energy_metrics(self, rms: float, spectral: float, rhythmic: float, dynamic: float, loudness: float, lufs: float = 0.0) -> float:
        """Combine metrics into overall energy in 0-1 space."""
        # Weights: RMS 0.15, Spectral 0.15, Rhythmic 0.25, Dynamic 0.1, Loudness 0.15, LUFS 0.20
        combined = (rms * 0.15 + spectral * 0.15 + rhythmic * 0.25 + dynamic * 0.10 + loudness * 0.15 + lufs * 0.20)
        return float(np.clip(combined, 0.0, 1.0))

    def _classify_energy_level(self, energy_score: float) -> EnergyLevel:
        """Classify energy score into energy level."""
        if energy_score <= 1.5:
            return EnergyLevel.VERY_LOW
        elif energy_score <= 2.5:
            return EnergyLevel.LOW
        elif energy_score <= 3.5:
            return EnergyLevel.MEDIUM_LOW
        elif energy_score <= 4.5:
            return EnergyLevel.MEDIUM
        elif energy_score <= 5.5:
            return EnergyLevel.MEDIUM_HIGH
        elif energy_score <= 6.5:
            return EnergyLevel.HIGH
        elif energy_score <= 7.5:
            return EnergyLevel.VERY_HIGH
        elif energy_score <= 8.5:
            return EnergyLevel.EXTREME
        elif energy_score <= 9.5:
            return EnergyLevel.MAXIMUM
        else:
            return EnergyLevel.OVERDRIVE

    def _calculate_energy_profile(self, y: np.ndarray, sr: int, song_structure: List[Dict] = None) -> List[Dict]:
        """Calculate energy profile over time with structural analysis and per-track normalization."""
        try:
            # Use provided song structure if available (from StructureStage), otherwise fallback
            if song_structure and len(song_structure) >= 2:
                segments = [
                    {'name': s.get('type', 'Section').capitalize(), 'start': s['start'], 'end': s['end']}
                    for s in song_structure if 'start' in s and 'end' in s
                ]
            else:
                segments = self._detect_structural_segments(y, sr)
            
            energy_profile = []
            raw_scores = []
            
            for segment in segments:
                start_time = segment['start']
                end_time = segment['end']
                segment_name = segment['name']
                
                # Extract segment audio
                start_sample = int(start_time * sr)
                end_sample = int(end_time * sr)
                segment_audio = y[start_sample:end_sample]
                
                if len(segment_audio) > sr * 0.5:  # At least 0.5 seconds
                    # Calculate normalized metrics for this segment (0-1)
                    rms_energy = self._calculate_rms_energy(segment_audio, sr)
                    loudness = self._calculate_perceptual_loudness(segment_audio, sr)
                    spectral_energy = self._calculate_spectral_energy(segment_audio, sr)
                    rhythmic_energy = self._calculate_rhythmic_energy(segment_audio, sr)
                    dynamic_energy = self._calculate_dynamic_energy(segment_audio, sr)
                    score_0_1 = self._combine_energy_metrics(rms_energy, spectral_energy, rhythmic_energy, dynamic_energy, loudness)
                    raw_scores.append(score_0_1)
                    energy_profile.append({
                        'name': segment_name,
                        'start_time': start_time,
                        'end_time': end_time,
                        'energy': score_0_1,  # temp; will rescale below
                        'level': 0
                    })
            
            # Normalize across segments to emphasize contrast (blend linear + rank-based)
            if energy_profile:
                scores = np.array([p['energy'] for p in energy_profile], dtype=float)
                # Robust linear scaling using 5th-95th percentiles
                p5, p95 = np.percentile(scores, [5, 95])
                if p95 > p5:
                    norm_lin = np.clip((scores - p5) / (p95 - p5), 0.0, 1.0)
                else:
                    norm_lin = np.zeros_like(scores)
                # Rank-based scaling to guarantee spread
                order = np.argsort(scores)
                ranks = np.empty_like(order, dtype=float)
                ranks[order] = np.linspace(0.0, 1.0, len(scores))
                # Blend
                norm = 0.6 * norm_lin + 0.4 * ranks
                for i, seg in enumerate(energy_profile):
                    energy_1_10 = 1 + float(np.clip(norm[i], 0.0, 1.0)) * 9
                    seg['energy'] = round(energy_1_10, 2)
                    seg['level'] = self._classify_energy_level(energy_1_10).value
            
            # Limit to 16 segments for UI readability
            return energy_profile[:16]
            
        except Exception:
            return []

    def _detect_structural_segments(self, y: np.ndarray, sr: int) -> List[Dict]:
        """Detect structural segments for energy analysis."""
        try:
            duration = len(y) / sr
            
            # Use MFCC for structural analysis
            mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13, hop_length=1024)
            
            # Calculate self-similarity matrix
            similarity_matrix = np.corrcoef(mfcc.T)
            
            # Find segment boundaries using novelty detection
            novelty = np.sum(np.diff(mfcc, axis=1)**2, axis=0)
            novelty = np.pad(novelty, (1, 0), mode='constant')
            
            # Smooth and find peaks
            from scipy import ndimage
            novelty_smooth = ndimage.gaussian_filter1d(novelty, sigma=5.0)
            
            # Find structural boundaries
            from scipy.signal import find_peaks
            peaks, _ = find_peaks(
                novelty_smooth,
                height=np.percentile(novelty_smooth, 60),
                distance=int(sr / 1024 * 10)  # Minimum 10 seconds between segments
            )
            
            # Convert to time
            boundary_times = librosa.frames_to_time(peaks, sr=sr, hop_length=1024)
            
            # Add start and end boundaries
            all_boundaries = np.concatenate([[0], boundary_times, [duration]])
            all_boundaries = np.unique(all_boundaries)
            
            # Create segments with names
            segments = []
            segment_names = ['Intro', 'Vocal Entry', 'Chorus', 'Breakdown', 'Chorus', 'Build-Up', 'Outro']
            
            for i in range(len(all_boundaries) - 1):
                start_time = all_boundaries[i]
                end_time = all_boundaries[i + 1]
                
                # Assign intelligent names based on position and characteristics
                if i == 0:
                    name = 'Intro'
                elif i == len(all_boundaries) - 2:
                    name = 'Outro'
                else:
                    # Use position-based naming with some intelligence
                    if i < len(segment_names):
                        name = segment_names[i]
                    else:
                        name = f'Section {i + 1}'
                
                segments.append({
                    'name': name,
                    'start': start_time,
                    'end': end_time
                })
            
            return segments
            
        except Exception:
            # Fallback: create simple time-based segments
            duration = len(y) / sr
            segment_duration = duration / 7  # 7 segments
            
            segments = []
            names = ['Intro', 'Vocal Entry', 'Chorus', 'Breakdown', 'Chorus', 'Build-Up', 'Outro']
            
            for i in range(7):
                start_time = i * segment_duration
                end_time = min((i + 1) * segment_duration, duration)
                
                segments.append({
                    'name': names[i],
                    'start': start_time,
                    'end': end_time
                })
            
            return segments

    def _find_energy_peaks(self, energy_profile: List[Dict]) -> List[Dict]:
        """Find energy peaks in the track."""
        if not energy_profile:
            return []
        
        peaks = []
        energies = [p['energy'] for p in energy_profile]
        
        for i in range(1, len(energies) - 1):
            if energies[i] > energies[i-1] and energies[i] > energies[i+1]:
                if energies[i] > 7:  # High energy threshold
                    peaks.append({
                        'time': energy_profile[i].get('start_time', 0.0),
                        'energy': energies[i],
                        'level': energy_profile[i]['level']
                    })
        
        return peaks

    def _find_energy_valleys(self, energy_profile: List[Dict]) -> List[Dict]:
        """Find energy valleys in the track."""
        if not energy_profile:
            return []
        
        valleys = []
        energies = [p['energy'] for p in energy_profile]
        
        for i in range(1, len(energies) - 1):
            if energies[i] < energies[i-1] and energies[i] < energies[i+1]:
                if energies[i] < 4:  # Low energy threshold
                    valleys.append({
                        'time': energy_profile[i].get('start_time', 0.0),
                        'energy': energies[i],
                        'level': energy_profile[i]['level']
                    })
        
        return valleys

    def get_energy_mixing_suggestions(self, current_energy: int, target_energy: int = None) -> Dict:
        """Get energy-based mixing suggestions."""
        suggestions = {
            'current_energy': current_energy,
            'energy_build_suggestions': [],
            'energy_release_suggestions': [],
            'energy_techniques': []
        }
        
        if target_energy:
            energy_diff = target_energy - current_energy
            
            if energy_diff > 0:
                # Need to build energy
                suggestions['energy_build_suggestions'] = self._get_energy_build_suggestions(
                    current_energy, target_energy
                )
            elif energy_diff < 0:
                # Need to release energy
                suggestions['energy_release_suggestions'] = self._get_energy_release_suggestions(
                    current_energy, target_energy
                )
        
        # General energy techniques
        suggestions['energy_techniques'] = self._get_energy_techniques(current_energy)
        
        return suggestions

    def _get_energy_build_suggestions(self, current_energy: int, target_energy: int) -> List[Dict]:
        """Get suggestions for building energy."""
        suggestions = []
        energy_diff = target_energy - current_energy
        
        if energy_diff <= 2:
            suggestions.append({
                'technique': 'gradual_build',
                'description': 'Gradually increase energy over 2-3 tracks',
                'strategy': 'Use tracks with energy levels between current and target'
            })
        elif energy_diff <= 4:
            suggestions.append({
                'technique': 'moderate_build',
                'description': 'Build energy with intermediate tracks',
                'strategy': 'Use tracks with energy levels 2-3 points higher than current'
            })
        else:
            suggestions.append({
                'technique': 'dramatic_build',
                'description': 'Dramatic energy increase',
                'strategy': 'Use high-energy tracks with strong rhythmic elements'
            })
        
        return suggestions

    def _get_energy_release_suggestions(self, current_energy: int, target_energy: int) -> List[Dict]:
        """Get suggestions for releasing energy."""
        suggestions = []
        energy_diff = current_energy - target_energy
        
        if energy_diff <= 2:
            suggestions.append({
                'technique': 'gradual_release',
                'description': 'Gradually decrease energy over 2-3 tracks',
                'strategy': 'Use tracks with energy levels between current and target'
            })
        elif energy_diff <= 4:
            suggestions.append({
                'technique': 'moderate_release',
                'description': 'Release energy with intermediate tracks',
                'strategy': 'Use tracks with energy levels 2-3 points lower than current'
            })
        else:
            suggestions.append({
                'technique': 'dramatic_release',
                'description': 'Dramatic energy decrease',
                'strategy': 'Use low-energy tracks with ambient or chill elements'
            })
        
        return suggestions

    def _get_energy_techniques(self, energy_level: int) -> List[Dict]:
        """Get energy mixing techniques for current energy level."""
        techniques = []
        
        if energy_level <= 3:
            # Low energy - focus on building
            techniques.append({
                'technique': 'energy_build',
                'description': 'Build energy gradually',
                'suitable_tracks': 'Medium to high energy tracks'
            })
        elif energy_level <= 6:
            # Medium energy - flexible
            techniques.append({
                'technique': 'energy_build',
                'description': 'Build energy for peak moments',
                'suitable_tracks': 'High energy tracks'
            })
            techniques.append({
                'technique': 'energy_release',
                'description': 'Release energy for variety',
                'suitable_tracks': 'Low to medium energy tracks'
            })
        else:
            # High energy - focus on maintaining/releasing
            techniques.append({
                'technique': 'energy_maintain',
                'description': 'Maintain high energy',
                'suitable_tracks': 'Similar high energy tracks'
            })
            techniques.append({
                'technique': 'energy_release',
                'description': 'Release energy for contrast',
                'suitable_tracks': 'Lower energy tracks'
            })
        
        return techniques

    def analyze_playlist_energy(self, tracks: List[Dict]) -> Dict:
        """Analyze energy flow in a playlist."""
        if not tracks:
            return {}
        
        analysis = {
            'total_tracks': len(tracks),
            'energy_distribution': {},
            'energy_flow': [],
            'energy_issues': [],
            'mixing_opportunities': []
        }
        
        # Analyze energy distribution
        for track in tracks:
            energy = track.get('energy', 5)
            energy_level = self._classify_energy_level(energy)
            
            if energy_level.name in analysis['energy_distribution']:
                analysis['energy_distribution'][energy_level.name] += 1
            else:
                analysis['energy_distribution'][energy_level.name] = 1
        
        # Analyze energy flow between consecutive tracks
        for i in range(len(tracks) - 1):
            track1 = tracks[i]
            track2 = tracks[i + 1]
            
            energy1 = track1.get('energy', 5)
            energy2 = track2.get('energy', 5)
            energy_diff = energy2 - energy1
            
            analysis['energy_flow'].append({
                'track1': track1.get('name', f'Track {i+1}'),
                'track2': track2.get('name', f'Track {i+2}'),
                'energy1': energy1,
                'energy2': energy2,
                'energy_diff': energy_diff,
                'flow_type': self._classify_energy_flow(energy_diff)
            })
        
        # Identify energy issues
        analysis['energy_issues'] = self._identify_energy_issues(tracks)
        
        # Find mixing opportunities
        analysis['mixing_opportunities'] = self._find_energy_mixing_opportunities(tracks)
        
        return analysis

    def _classify_energy_flow(self, energy_diff: float) -> str:
        """Classify the type of energy flow between tracks."""
        if energy_diff > 2:
            return 'energy_build'
        elif energy_diff > 0:
            return 'energy_slight_build'
        elif energy_diff == 0:
            return 'energy_maintain'
        elif energy_diff > -2:
            return 'energy_slight_release'
        else:
            return 'energy_release'

    def _identify_energy_issues(self, tracks: List[Dict]) -> List[Dict]:
        """Identify potential energy flow issues in the playlist."""
        issues = []
        
        for i in range(len(tracks) - 1):
            track1 = tracks[i]
            track2 = tracks[i + 1]
            
            energy1 = track1.get('energy', 5)
            energy2 = track2.get('energy', 5)
            energy_diff = energy2 - energy1
            
            # Check for dramatic energy changes
            if abs(energy_diff) > 4:
                issues.append({
                    'position': f'Tracks {i+1} -> {i+2}',
                    'energy1': energy1,
                    'energy2': energy2,
                    'energy_diff': energy_diff,
                    'issue': 'Dramatic energy change - may cause jarring transition',
                    'suggestion': 'Consider intermediate tracks for smoother transition'
                })
            
            # Check for too many consecutive high-energy tracks
            if i >= 2:
                prev_energy = tracks[i-1].get('energy', 5)
                if energy1 > 7 and energy2 > 7 and prev_energy > 7:
                    issues.append({
                        'position': f'Tracks {i-1} -> {i+1} -> {i+2}',
                        'issue': 'Too many consecutive high-energy tracks',
                        'suggestion': 'Consider adding lower energy tracks for variety'
                    })
        
        return issues

    def _find_energy_mixing_opportunities(self, tracks: List[Dict]) -> List[Dict]:
        """Find optimal energy mixing opportunities."""
        opportunities = []
        
        for i, track1 in enumerate(tracks):
            energy1 = track1.get('energy', 5)
            
            # Find tracks with complementary energy levels
            complementary_tracks = []
            for j, track2 in enumerate(tracks):
                if i == j:
                    continue
                
                energy2 = track2.get('energy', 5)
                energy_diff = energy2 - energy1
                
                # Good energy mixing opportunities
                if 1 <= abs(energy_diff) <= 3:
                    complementary_tracks.append({
                        'track': track2.get('name', f'Track {j+1}'),
                        'energy': energy2,
                        'energy_diff': energy_diff,
                        'technique': 'energy_build' if energy_diff > 0 else 'energy_release'
                    })
            
            if complementary_tracks:
                opportunities.append({
                    'source_track': track1.get('name', f'Track {i+1}'),
                    'source_energy': energy1,
                    'complementary_tracks': complementary_tracks
                })
        
        return opportunities

    def get_power_block_suggestions(self, tracks: List[Dict]) -> List[Dict]:
        """Get power block mixing suggestions (rapid transitions with energy variation)."""
        suggestions = []
        
        # Group tracks by energy levels
        energy_groups = {}
        for track in tracks:
            energy = track.get('energy', 5)
            energy_level = self._classify_energy_level(energy)
            
            if energy_level.name not in energy_groups:
                energy_groups[energy_level.name] = []
            energy_groups[energy_level.name].append(track)
        
        # Create power block suggestions
        for energy_level, group_tracks in energy_groups.items():
            if len(group_tracks) >= 2:
                suggestions.append({
                    'technique': 'power_block',
                    'energy_level': energy_level,
                    'tracks': [t.get('name', 'Unknown') for t in group_tracks],
                    'description': f'Power block mixing with {energy_level} energy tracks',
                    'strategy': 'Rapid transitions between tracks with similar energy levels'
                })
        
        return suggestions 
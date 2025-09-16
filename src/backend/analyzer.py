#!/usr/bin/env python3
"""
Mixed In AI - Audio Analysis Backend
Analyzes audio files to detect key, BPM, cue points, and song structure.
"""

import sys
import json
import numpy as np
import librosa
import soundfile as sf
from pydub import AudioSegment
import os
import logging
import tempfile
from scipy import signal
from scipy import ndimage
from scipy.stats import pearsonr
from typing import List, Dict, Tuple
import time
import subprocess
import shutil

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stderr)
    ]
)
logger = logging.getLogger(__name__)

class AudioAnalyzer:
    def __init__(self):
        # Camelot wheel mapping (aligned with UI mapping: A=Major, B=Minor)
        # Major (A)
        self.camelot_wheel = {
            'C': '12A', 'C#': '1A', 'D': '2A', 'D#': '3A', 'E': '4A', 'F': '5A',
            'F#': '6A', 'G': '7A', 'G#': '8A', 'A': '9A', 'A#': '10A', 'B': '11A',
            # Minor (B) — lower-case pitch names
            'c': '12B', 'c#': '1B', 'd': '2B', 'd#': '3B', 'e': '4B', 'f': '5B',
            'f#': '6B', 'g': '7B', 'g#': '8B', 'a': '9B', 'a#': '10B', 'b': '11B'
        }
        
        # Industry-standard key profiles (Krumhansl-Schmuckler)
        self.major_profile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
        self.minor_profile = [6.33, 2.68, 3.69, 5.38, 2.60, 3.67, 2.58, 4.95, 2.63, 3.71, 3.28, 3.73]

    def load_audio(self, file_path):
        """Load audio with industry-standard preprocessing."""
        try:
            # Try librosa first
            try:
                y, sr = librosa.load(file_path, sr=None, mono=True)
            except Exception as e:
                logger.warning(f"Librosa failed, trying pydub: {str(e)}")
                try:
                    # Fallback to pydub for many formats
                    audio = AudioSegment.from_file(file_path)
                    audio = audio.set_channels(1)  # Convert to mono
                    audio = audio.set_frame_rate(22050)  # Set sample rate
                    samples = np.array(audio.get_array_of_samples())
                    if audio.sample_width == 2:
                        samples = samples.astype(np.float32) / 32768.0
                    elif audio.sample_width == 4:
                        samples = samples.astype(np.float32) / 2147483648.0
                    else:
                        samples = samples.astype(np.float32) / 255.0
                    y = samples
                    sr = 22050
                except Exception as e2:
                    logger.warning(f"pydub failed, trying ffmpeg CLI: {str(e2)}")
                    y, sr = self._decode_with_ffmpeg_cli(file_path)
            
            # Resample to 22050 Hz for analysis (industry standard)
            if sr != 22050:
                y = librosa.resample(y, orig_sr=sr, target_sr=22050)
                sr = 22050
            
            duration = librosa.get_duration(y=y, sr=sr)
            
            # Check if audio is too short (corrupted)
            if duration < 1.0:
                logger.error(f"Audio file too short ({duration:.2f}s), likely corrupted")
                raise Exception(f"Audio file too short ({duration:.2f}s), likely corrupted")
            
            # Normalize audio (industry standard)
            y = librosa.util.normalize(y)
            
            return y, sr, duration
        except Exception as e:
            logger.error(f"Failed to load audio: {str(e)}")
            raise

    def _decode_with_ffmpeg_cli(self, file_path: str) -> Tuple[np.ndarray, int]:
        """Decode audio with ffmpeg CLI into float32 PCM mono 22050 Hz with robust fallbacks."""
        ffmpeg_path = shutil.which('ffmpeg')
        if not ffmpeg_path:
            raise RuntimeError('ffmpeg not found in PATH')

        attempts = []
        # 1) Basic
        attempts.append([
            ffmpeg_path, '-v', 'error', '-nostdin',
            '-i', file_path,
            '-vn', '-sn', '-dn', '-map', '0:a:0?',
            '-ac', '1', '-ar', '22050', '-f', 'f32le', 'pipe:1'
        ])
        # 2) Increase probe/analyze and ignore corrupt
        attempts.append([
            ffmpeg_path, '-v', 'error', '-nostdin', '-probesize', '100M', '-analyzeduration', '100M',
            '-fflags', '+discardcorrupt', '-err_detect', 'ignore_err',
            '-i', file_path,
            '-vn', '-sn', '-dn', '-map', '0:a:0?',
            '-ac', '1', '-ar', '22050', '-f', 'f32le', 'pipe:1'
        ])
        # 3) Force MP3 demuxer if extension suggests mp3
        if file_path.lower().endswith('.mp3'):
            attempts.append([
                ffmpeg_path, '-v', 'error', '-nostdin', '-f', 'mp3',
                '-i', file_path,
                '-vn', '-sn', '-dn', '-map', '0:a:0?',
                '-ac', '1', '-ar', '22050', '-f', 'f32le', 'pipe:1'
            ])

        last_err = None
        for cmd in attempts:
            proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if proc.returncode == 0 and proc.stdout:
                y = np.frombuffer(proc.stdout, dtype=np.float32)
                return y, 22050
            last_err = proc.stderr.decode('utf-8', 'ignore')

        raise RuntimeError(f"ffmpeg decode failed after retries: {last_err}")

    def detect_key_rekordbox_algorithm(self, y, sr):
        """Industry-standard key detection algorithm matching Mixed In Key/Rekordbox accuracy."""
        try:
            # Multi-algorithm approach for maximum accuracy
            results = []
            
            # Algorithm 1: Enhanced Chroma-based detection (Rekordbox style)
            result1 = self._detect_key_chroma_enhanced(y, sr)
            results.append(result1)
            
            # Algorithm 2: Harmonic-Percussive separation + Chroma
            result2 = self._detect_key_harmonic_percussive(y, sr)
            results.append(result2)
            
            # Algorithm 3: Multi-resolution Chroma analysis
            result3 = self._detect_key_multiresolution(y, sr)
            results.append(result3)
            
            # Weighted voting system (industry approach)
            final_key, final_mode, final_confidence = self._weighted_key_voting(results)
            
            # Convert to Camelot format
            camelot_key = self.camelot_wheel.get(final_key, final_key)
            
            return camelot_key, final_mode, final_confidence
            
        except Exception as e:
            logger.error(f"Key detection failed: {str(e)}")
            return '8A', 'major', 0.5

    def _detect_key_chroma_enhanced(self, y, sr):
        """Enhanced chroma-based key detection with preprocessing."""
        # Pre-emphasis filter (industry standard)
        y_preemph = np.append(y[0], y[1:] - 0.97 * y[:-1])
        
        # Extract high-quality chromagram
        chroma = librosa.feature.chroma_cqt(
            y=y_preemph, sr=sr,
            hop_length=512,
            bins_per_octave=36,  # Higher resolution
            n_chroma=12,
            tuning=0.0,
            norm=2,
            threshold=0.0,
            window='hann'
        )
        
        # Temporal smoothing (reduces noise)
        chroma_smooth = ndimage.gaussian_filter1d(chroma, sigma=1.0, axis=1)
        
        # Use weighted average (emphasize stable regions)
        weights = np.sum(chroma_smooth, axis=0)
        weights = weights / np.max(weights)
        weights = np.power(weights, 2)  # Emphasize high-energy regions
        
        chroma_avg = np.average(chroma_smooth, axis=1, weights=weights)
        chroma_avg = chroma_avg / np.linalg.norm(chroma_avg)
        
        # Industry-standard key profiles (Temperley-Krumhansl)
        major_profile = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
        minor_profile = np.array([6.33, 2.68, 3.69, 5.38, 2.60, 3.67, 2.58, 4.95, 2.63, 3.71, 3.28, 3.73])
        
        # Normalize profiles
        major_profile = major_profile / np.linalg.norm(major_profile)
        minor_profile = minor_profile / np.linalg.norm(minor_profile)
        
        # Calculate correlations for all keys
        correlations = []
        key_names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
        
        for i in range(12):
            try:
                # Major correlation
                major_shifted = np.roll(major_profile, i)
                corr_major = np.corrcoef(chroma_avg.astype(float), major_shifted.astype(float))[0, 1]
                correlations.append((key_names[i], 'major', corr_major if not np.isnan(corr_major) else 0))
                
                # Minor correlation
                minor_shifted = np.roll(minor_profile, i)
                corr_minor = np.corrcoef(chroma_avg.astype(float), minor_shifted.astype(float))[0, 1]
                correlations.append((key_names[i].lower(), 'minor', corr_minor if not np.isnan(corr_minor) else 0))
            except Exception as e:
                # Fallback correlations
                correlations.append((key_names[i], 'major', 0))
                correlations.append((key_names[i].lower(), 'minor', 0))
        
        # Find best match
        best_key, best_mode, best_corr = max(correlations, key=lambda x: x[2])
        
        return best_key, best_mode, max(0, best_corr)

    def _detect_key_harmonic_percussive(self, y, sr):
        """Key detection using harmonic-percussive separation."""
        # Separate harmonic and percussive components
        y_harmonic, y_percussive = librosa.effects.hpss(y, margin=8.0)
        
        # Focus on harmonic content for key detection
        chroma = librosa.feature.chroma_cqt(
            y=y_harmonic, sr=sr,
            hop_length=1024,
            bins_per_octave=36,
            n_chroma=12,
            norm=2
        )
        
        # Remove percussive interference
        chroma_clean = np.maximum(chroma - 0.1, 0)
        
        # Aggregate using harmonic mean (more stable)
        chroma_avg = np.power(np.prod(chroma_clean + 1e-8, axis=1), 1.0/chroma_clean.shape[1])
        chroma_avg = chroma_avg / np.linalg.norm(chroma_avg)
        
        # Use Krumhansl-Schmuckler profiles
        major_profile = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
        minor_profile = np.array([6.33, 2.68, 3.69, 5.38, 2.60, 3.67, 2.58, 4.95, 2.63, 3.71, 3.28, 3.73])
        
        major_profile = major_profile / np.linalg.norm(major_profile)
        minor_profile = minor_profile / np.linalg.norm(minor_profile)
        
        correlations = []
        key_names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
        
        for i in range(12):
            major_shifted = np.roll(major_profile, i)
            minor_shifted = np.roll(minor_profile, i)
            
            corr_major = np.dot(chroma_avg, major_shifted)
            corr_minor = np.dot(chroma_avg, minor_shifted)
            
            correlations.append((key_names[i], 'major', corr_major))
            correlations.append((key_names[i].lower(), 'minor', corr_minor))
        
        best_key, best_mode, best_corr = max(correlations, key=lambda x: x[2])
        return best_key, best_mode, max(0, best_corr)

    def _detect_key_multiresolution(self, y, sr):
        """Multi-resolution chroma analysis for robust key detection."""
        # Multiple hop lengths for different time resolutions
        hop_lengths = [256, 512, 1024, 2048]
        chroma_features = []
        
        for hop_length in hop_lengths:
            chroma = librosa.feature.chroma_cqt(
                y=y, sr=sr,
                hop_length=hop_length,
                bins_per_octave=36,
                n_chroma=12,
                norm=2
            )
            
            # Weight by spectral centroid (emphasize melodic content)
            spectral_centroid = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=hop_length)[0]
            weights = spectral_centroid / np.max(spectral_centroid)
            
            chroma_weighted = np.average(chroma, axis=1, weights=weights)
            chroma_features.append(chroma_weighted)
        
        # Combine multi-resolution features
        chroma_combined = np.mean(chroma_features, axis=0)
        chroma_combined = chroma_combined / np.linalg.norm(chroma_combined)
        
        # Enhanced key profiles (combined Temperley and Krumhansl)
        major_profile = np.array([6.6, 2.0, 3.5, 2.3, 4.6, 4.2, 2.5, 5.4, 2.4, 3.8, 2.3, 2.9])
        minor_profile = np.array([6.5, 2.7, 3.5, 5.4, 2.6, 3.5, 2.5, 5.2, 2.7, 3.4, 3.4, 3.7])
        
        major_profile = major_profile / np.linalg.norm(major_profile)
        minor_profile = minor_profile / np.linalg.norm(minor_profile)
        
        correlations = []
        key_names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
        
        for i in range(12):
            major_shifted = np.roll(major_profile, i)
            minor_shifted = np.roll(minor_profile, i)
            
            # Use cosine similarity
            corr_major = np.dot(chroma_combined, major_shifted)
            corr_minor = np.dot(chroma_combined, minor_shifted)
            
            correlations.append((key_names[i], 'major', corr_major))
            correlations.append((key_names[i].lower(), 'minor', corr_minor))
        
        best_key, best_mode, best_corr = max(correlations, key=lambda x: x[2])
        return best_key, best_mode, max(0, best_corr)

    def _weighted_key_voting(self, results):
        """Weighted voting system for key detection results."""
        # Weight algorithms by their typical accuracy
        weights = [0.4, 0.35, 0.25]  # Enhanced chroma, HP separation, Multi-resolution
        
        # Collect all key votes with weights
        key_votes = {}
        
        for i, (key, mode, confidence) in enumerate(results):
            vote_key = f"{key}_{mode}"
            weighted_confidence = confidence * weights[i]
            
            if vote_key in key_votes:
                key_votes[vote_key] += weighted_confidence
            else:
                key_votes[vote_key] = weighted_confidence
        
        # Find the winner
        if not key_votes:
            return 'C', 'major', 0.5
        
        best_vote = max(key_votes.items(), key=lambda x: x[1])
        best_key_mode = best_vote[0]
        best_confidence = best_vote[1]
        
        # Parse key and mode
        parts = best_key_mode.split('_')
        final_key = parts[0]
        final_mode = parts[1]
        
        # Normalize confidence
        final_confidence = min(best_confidence, 1.0)
        
        return final_key, final_mode, final_confidence

    def detect_bpm_rekordbox_algorithm(self, y, sr):
        """Industry-standard BPM detection algorithm matching Mixed In Key/Rekordbox accuracy."""
        try:
            # Multi-algorithm approach for maximum accuracy
            bpm_results = []
            
            # Algorithm 1: Enhanced onset-based detection
            bpm1 = self._detect_bpm_onset_enhanced(y, sr)
            bpm_results.append(bpm1)
            
            # Algorithm 2: Spectral-based detection
            bpm2 = self._detect_bpm_spectral(y, sr)
            bpm_results.append(bpm2)
            
            # Algorithm 3: Harmonic-percussive BPM detection
            bpm3 = self._detect_bpm_harmonic_percussive(y, sr)
            bpm_results.append(bpm3)
            
            # Algorithm 4: Multi-scale autocorrelation
            bpm4 = self._detect_bpm_autocorrelation(y, sr)
            bpm_results.append(bpm4)
            
            # Weighted voting for final BPM
            final_bpm = self._weighted_bpm_voting(bpm_results)
            
            return int(round(final_bpm))
            
        except Exception as e:
            logger.error(f"BPM detection failed: {str(e)}")
            return 120

    def _detect_bpm_onset_enhanced(self, y, sr):
        """Enhanced onset-based BPM detection."""
        # High-quality onset detection
        onset_env = librosa.onset.onset_strength(
            y=y, sr=sr,
            hop_length=512,
            lag=2,
            max_size=1,
            aggregate=np.median
        )
        
        # Apply temporal filtering
        onset_filtered = ndimage.gaussian_filter1d(onset_env, sigma=1.0)
        
        # Multi-scale tempo detection
        tempo_candidates = []
        
        # Different prior ranges for different genres
        prior_ranges = [
            (60, 100),   # Slow/ballad
            (100, 140),  # Medium/pop
            (120, 180),  # Dance/electronic
            (140, 200)   # Fast/hardcore
        ]
        
        for min_bpm, max_bpm in prior_ranges:
            try:
                tempo = librosa.beat.tempo(
                    onset_envelope=onset_filtered,
                    sr=sr,
                    hop_length=512,
                    start_bpm=min_bpm,
                    std_bpm=20.0,
                    ac_size=8.0,
                    max_tempo=max_bpm,
                    aggregate=np.median
                )[0]
                tempo_candidates.append(tempo)
            except:
                continue
        
        if tempo_candidates:
            # Return median of candidates
            return np.median(tempo_candidates)
        else:
            return 120.0

    def _detect_bpm_spectral(self, y, sr):
        """Spectral-based BPM detection using frequency domain analysis."""
        # Compute spectrogram
        stft = librosa.stft(y, hop_length=512, n_fft=2048)
        magnitude = np.abs(stft)
        
        # Focus on rhythmically important frequency bands
        # Bass: 20-250 Hz, Kick: 50-100 Hz, Snare: 150-250 Hz
        freq_bins = librosa.fft_frequencies(sr=sr, n_fft=2048)
        
        # Extract rhythm from bass frequencies
        bass_mask = (freq_bins >= 20) & (freq_bins <= 250)
        bass_energy = np.sum(magnitude[bass_mask], axis=0)
        
        # Normalize and smooth
        if np.max(bass_energy) > 0:
            bass_energy = bass_energy / np.max(bass_energy)
        bass_energy = ndimage.gaussian_filter1d(bass_energy, sigma=2.0)
        
        # Find periodicity using autocorrelation
        autocorr = np.correlate(bass_energy, bass_energy, mode='full')
        autocorr = autocorr[len(bass_energy)-1:]
        
        # Find peaks
        peaks, properties = signal.find_peaks(
            autocorr,
            height=0.3 * np.max(autocorr),
            distance=int(sr / 512 * 0.3)  # Minimum 0.3 seconds between peaks
        )
        
        if len(peaks) > 0:
            # Convert to BPM
            hop_time = 512.0 / sr
            periods = peaks * hop_time
            bpms = 60.0 / periods
            
            # Filter valid range
            valid_bpms = bpms[(bpms >= 60) & (bpms <= 200)]
            
            if len(valid_bpms) > 0:
                return np.median(valid_bpms)
        
        return 120.0

    def _detect_bpm_harmonic_percussive(self, y, sr):
        """BPM detection using harmonic-percussive separation."""
        # Separate harmonic and percussive components
        y_harmonic, y_percussive = librosa.effects.hpss(y, margin=8.0)
        
        # Focus on percussive component for rhythm
        onset_env = librosa.onset.onset_strength(
            y=y_percussive,
            sr=sr,
            hop_length=512,
            aggregate=np.median
        )
        
        # Enhanced tempo detection on percussive content
        tempo = librosa.beat.tempo(
            onset_envelope=onset_env,
            sr=sr,
            hop_length=512,
            start_bpm=120,
            std_bpm=30.0,
            ac_size=4.0,
            max_tempo=200,
            aggregate=np.median
        )[0]
        
        return tempo

    def _detect_bpm_autocorrelation(self, y, sr):
        """Multi-scale autocorrelation BPM detection."""
        # Extract onset strength with different parameters
        onset_env = librosa.onset.onset_strength(
            y=y, sr=sr,
            hop_length=256,  # Higher resolution
            lag=1,
            max_size=3,
            aggregate=np.mean
        )
        
        # Multi-scale autocorrelation
        scales = [1.0, 1.5, 2.0]  # Different time scales
        bpm_candidates = []
        
        for scale in scales:
            # Resample onset envelope
            if scale != 1.0:
                from scipy import interpolate
                old_indices = np.arange(len(onset_env))
                new_indices = np.arange(0, len(onset_env), scale)
                if len(new_indices) > 10:  # Ensure minimum length
                    f = interpolate.interp1d(old_indices, onset_env, kind='linear')
                    onset_scaled = f(new_indices)
                else:
                    onset_scaled = onset_env
            else:
                onset_scaled = onset_env
            
            # Autocorrelation
            autocorr = np.correlate(onset_scaled, onset_scaled, mode='full')
            autocorr = autocorr[len(onset_scaled)-1:]
            
            # Find peaks
            peaks, _ = signal.find_peaks(
                autocorr,
                height=0.2 * np.max(autocorr),
                distance=5
            )
            
            if len(peaks) > 0:
                # Convert to BPM
                hop_time = (256.0 / sr) * scale
                periods = peaks * hop_time
                bpms = 60.0 / periods
                
                # Filter and add candidates
                valid_bpms = bpms[(bpms >= 60) & (bpms <= 200)]
                bpm_candidates.extend(valid_bpms)
        
        if bpm_candidates:
            return np.median(bpm_candidates)
        else:
            return 120.0

    def _weighted_bpm_voting(self, bpm_results):
        """Weighted voting system for BPM detection results."""
        if not bpm_results:
            return 120.0
        
        # Remove outliers using IQR method
        q1 = np.percentile(bpm_results, 25)
        q3 = np.percentile(bpm_results, 75)
        iqr = q3 - q1
        
        # Define outlier bounds
        lower_bound = q1 - 1.5 * iqr
        upper_bound = q3 + 1.5 * iqr
        
        # Filter outliers
        filtered_bpms = [bpm for bpm in bpm_results if lower_bound <= bpm <= upper_bound]
        
        if not filtered_bpms:
            filtered_bpms = bpm_results
        
        # Weighted average (give more weight to results closer to median)
        median_bpm = np.median(filtered_bpms)
        weights = []
        
        for bpm in filtered_bpms:
            # Weight inversely proportional to distance from median
            distance = abs(bpm - median_bpm)
            weight = 1.0 / (1.0 + distance / 10.0)  # Normalize by 10 BPM
            weights.append(weight)
        
        # Normalize weights
        weights = np.array(weights)
        weights = weights / np.sum(weights)
        
        # Weighted average
        final_bpm = np.sum(np.array(filtered_bpms) * weights)
        
        # Industry-standard BPM correction
        final_bpm = self._correct_bpm_industry_standard(final_bpm)
        
        return final_bpm

    def _correct_bpm_industry_standard(self, bpm):
        """Apply industry-standard BPM corrections."""
        # Common BPM ranges and their corrections
        if bpm < 70:
            # Likely half-time, double it
            corrected = bpm * 2
            if 120 <= corrected <= 140:  # House music range
                return corrected
            elif 140 <= corrected <= 180:  # Techno/trance range
                return corrected
        
        elif bpm > 180:
            # Likely double-time, halve it
            corrected = bpm / 2
            if 80 <= corrected <= 100:  # Hip-hop range
                return corrected
            elif 120 <= corrected <= 140:  # House music range
                return corrected
        
        # Snap to common BPM values (industry practice)
        common_bpms = [90, 95, 100, 110, 120, 124, 125, 126, 128, 130, 132, 135, 140, 150]
        
        # Find closest common BPM
        closest_bpm = min(common_bpms, key=lambda x: abs(x - bpm))
        
        # Only snap if very close (within 2 BPM)
        if abs(bpm - closest_bpm) <= 2:
            return closest_bpm
        
        return bpm

    def detect_cue_points_rekordbox_algorithm(self, y, sr, duration):
        """Cue point detection aligned with energy profile and beats; outputs musically meaningful markers."""
        try:
            bpm, beats, onset_env, onset_times = self._analyze_rhythm(y, sr)

            # Analyze energy (recompute quickly here for tight coupling)
            energy = self._analyze_energy_levels(y, sr)
            energy_profile = energy.get('energy_profile', [])

            cues = self._detect_cues_aligned(y, sr, duration, beats, onset_times, energy_profile)
            cues = self._filter_and_sort_cues(cues, duration)
            return cues
        except Exception as e:
            logger.error(f"Cue point detection failed: {str(e)}")
            return [
                {'name': 'Intro', 'time': 0.0, 'type': 'intro'},
                {'name': 'Outro', 'time': float(max(0.0, duration - 30)), 'type': 'outro'}
            ]

    def _analyze_rhythm(self, y: np.ndarray, sr: int):
        """Return bpm, beats (seconds), onset envelope and onset peak times with high resolution."""
        hop = 256
        onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop, aggregate=np.mean)
        onset_frames = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr, hop_length=hop, units='frames', backtrack=True)
        onset_times = librosa.frames_to_time(onset_frames, sr=sr, hop_length=hop)

        # Try madmom if available for robust beat tracking
        beats = None
        bpm = None
        try:
            import madmom
            proc = madmom.features.beats.RNNBeatProcessor()
            act = proc(y)
            beat_times = madmom.features.beats.DBNBeatTrackingProcessor(fps=100)(act)
            beats = np.asarray(beat_times)
            if len(beats) > 1:
                bpm = float(60.0 / np.median(np.diff(beats)))
        except Exception:
            pass

        if beats is None or len(beats) < 4:
            tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, hop_length=hop, units='frames', trim=False)
            beats = librosa.frames_to_time(beat_frames, sr=sr, hop_length=hop)
            bpm = float(tempo if np.size(tempo) == 1 else tempo[0])

        return bpm, beats, onset_env, onset_times

    def _detect_cues_aligned(self, y: np.ndarray, sr: int, duration: float, beats: np.ndarray, onset_times: np.ndarray, energy_profile: List[dict]):
        """Detect key cue points using energy transitions and rhythmic alignment."""
        cues: List[dict] = []

        def nearest_beat(t: float) -> float:
            if beats is None or len(beats) == 0:
                return float(t)
            idx = int(np.argmin(np.abs(beats - t)))
            return float(beats[idx])

        # Helper to adjust to nearest onset then beat for sub-100ms precision
        def refine_time(t: float) -> float:
            if onset_times is not None and len(onset_times) > 0:
                idx = int(np.argmin(np.abs(onset_times - t)))
                t = float(onset_times[idx])
            return nearest_beat(t)

        # Intro start: first beat > 0.2s
        intro_t = 0.0
        if beats is not None and len(beats) > 0:
            valid = beats[beats > 0.2]
            intro_t = float(valid[0]) if len(valid) else 0.0
        cues.append({'name': 'Intro', 'time': refine_time(intro_t), 'type': 'intro'})

        # Use energy_profile to find major sections
        # Choose highest-energy segment as Chorus; preceding low-energy valley as Breakdown; middle rise as Build-up
        ep = energy_profile if energy_profile else []
        chorus_start = None
        chorus_end = None
        breakdown_start = None
        buildup_start = None

        if ep:
            energies = np.array([seg['energy'] for seg in ep], dtype=float)
            idx_max = int(np.argmax(energies))
            seg_max = ep[idx_max]
            chorus_start = float(seg_max['start']) if 'start' in seg_max else float(seg_max['start_time'])
            chorus_end = float(seg_max['end']) if 'end' in seg_max else float(seg_max['end_time'])

            # Find previous lower-energy segment as breakdown
            if idx_max > 0:
                prev_idx = idx_max - 1
                seg_prev = ep[prev_idx]
                breakdown_start = float(seg_prev.get('start', seg_prev.get('start_time', 0.0)))
                # Build-up: last segment before chorus that has rising energy
                buildup_start = float(seg_prev.get('end', seg_prev.get('end_time', breakdown_start)))

        # Drop: largest positive delta in onset envelope
        hop = 256
        onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop, aggregate=np.mean)
        odiff = np.diff(librosa.util.normalize(onset_env))
        if len(odiff) > 0:
            peak_idx = int(np.argmax(odiff))
            drop_t = float(librosa.frames_to_time(peak_idx, sr=sr, hop_length=hop))
        else:
            drop_t = duration * 0.4

        # Vocal entry: first significant harmonic energy peak after intro
        try:
            y_h, y_p = librosa.effects.hpss(y, margin=8.0)
            mel = librosa.feature.melspectrogram(y=y_h, sr=sr, n_mels=64, fmin=100, fmax=4000, hop_length=hop)
            mel_energy = np.mean(mel, axis=0)
            mel_smooth = ndimage.gaussian_filter1d(mel_energy, sigma=2.0)
            thr = np.percentile(mel_smooth, 70)
            cand = np.where(mel_smooth > thr)[0]
            vocal_t = float(librosa.frames_to_time(cand[0], sr=sr, hop_length=hop)) if len(cand) else intro_t + 8.0
        except Exception:
            vocal_t = intro_t + 8.0

        # Outro start: start of final segment or last beat - 32 beats window
        outro_t = max(duration - 30.0, duration * 0.7)
        if ep:
            last = ep[-1]
            outro_t = float(last.get('start', last.get('start_time', outro_t)))

        # If chorus not set, tie to drop
        if chorus_start is None:
            chorus_start = drop_t
            chorus_end = min(drop_t + 32.0 * (60.0 / max(1.0, self._safe_bpm_from_beats(beats))), duration)
        
        # Refine timings to musical grid
        vocal_t = refine_time(vocal_t)
        drop_t = refine_time(drop_t)
        if breakdown_start is not None:
            breakdown_start = refine_time(breakdown_start)
        if buildup_start is not None:
            buildup_start = refine_time(buildup_start)
        chorus_start = refine_time(chorus_start)
        chorus_end = refine_time(chorus_end)
        outro_t = refine_time(outro_t)

        # Assemble cues with requested types
        cues.extend([
            {'name': 'Vocal Entry', 'time': float(vocal_t), 'type': 'vocal_entry'},
        ])
        if breakdown_start is not None and 0 < breakdown_start < duration:
            cues.append({'name': 'Breakdown', 'time': float(breakdown_start), 'type': 'breakdown_start'})
        if buildup_start is not None and 0 < buildup_start < duration:
            cues.append({'name': 'Build-Up', 'time': float(buildup_start), 'type': 'build_up_start'})
        cues.append({'name': 'Chorus', 'time': float(chorus_start), 'type': 'chorus_start'})
        if chorus_end and chorus_end > chorus_start:
            cues.append({'name': 'Chorus End', 'time': float(chorus_end), 'type': 'chorus_end'})
        cues.append({'name': 'Drop', 'time': float(drop_t), 'type': 'drop'})
        cues.append({'name': 'Outro', 'time': float(outro_t), 'type': 'outro_start'})

        return cues

    def _safe_bpm_from_beats(self, beats: np.ndarray) -> float:
        if beats is None or len(beats) < 2:
            return 120.0
        return float(60.0 / np.median(np.diff(beats)))

    def _detect_intro_outro_cues(self, y, sr, duration):
        """Detect intro and outro cue points."""
        cue_points = []
        
        # Intro detection - find first significant energy increase
        rms = librosa.feature.rms(y=y, hop_length=512)[0]
        rms_times = librosa.frames_to_time(np.arange(len(rms)), sr=sr)
        
        # Smooth RMS for better detection
        from scipy import ndimage
        rms_smooth = ndimage.gaussian_filter1d(rms, sigma=2.0)
        
        # Find intro point (first significant energy rise)
        energy_threshold = np.percentile(rms_smooth, 20)
        intro_candidates = np.where(rms_smooth > energy_threshold)[0]
        
        if len(intro_candidates) > 0:
            intro_time = rms_times[intro_candidates[0]]
            # Snap to nearest beat
            intro_time = self._snap_to_beat(intro_time, y, sr)
            cue_points.append({
                'name': 'Intro',
                'time': float(max(0, intro_time)),
                'type': 'intro'
            })
        else:
            cue_points.append({
                'name': 'Intro',
                'time': 0.0,
                'type': 'intro'
            })
        
        # Outro detection - find last significant energy decrease
        outro_candidates = np.where(rms_smooth > energy_threshold)[0]
        if len(outro_candidates) > 0:
            outro_time = rms_times[outro_candidates[-1]]
            # Ensure outro is at least 30 seconds before end
            outro_time = min(outro_time, duration - 30)
            outro_time = self._snap_to_beat(outro_time, y, sr)
            cue_points.append({
                'name': 'Outro',
                'time': float(outro_time),
                'type': 'outro'
            })
        else:
            cue_points.append({
                'name': 'Outro',
                'time': float(max(0, duration - 30)),
                'type': 'outro'
            })
        
        return cue_points

    def _detect_energy_cues(self, y, sr, duration):
        """Detect energy-based cue points (drops, builds, breakdowns)."""
        cue_points = []
        
        # Calculate multi-band energy
        stft = librosa.stft(y, hop_length=512, n_fft=2048)
        magnitude = np.abs(stft)
        
        # Frequency bands
        freq_bins = librosa.fft_frequencies(sr=sr, n_fft=2048)
        bass_mask = (freq_bins >= 20) & (freq_bins <= 250)
        mid_mask = (freq_bins >= 250) & (freq_bins <= 4000)
        high_mask = (freq_bins >= 4000) & (freq_bins <= 16000)
        
        # Band energies
        bass_energy = np.sum(magnitude[bass_mask], axis=0)
        mid_energy = np.sum(magnitude[mid_mask], axis=0)
        high_energy = np.sum(magnitude[high_mask], axis=0)
        
        # Total energy
        total_energy = bass_energy + mid_energy + high_energy
        
        # Smooth energy signals
        bass_smooth = ndimage.gaussian_filter1d(bass_energy, sigma=2.0)
        total_smooth = ndimage.gaussian_filter1d(total_energy, sigma=2.0)
        
        # Time axis
        times = librosa.frames_to_time(np.arange(len(total_energy)), sr=sr, hop_length=512)
        
        # Detect drops (sudden energy increases)
        energy_diff = np.diff(total_smooth)
        drop_threshold = np.percentile(energy_diff, 90)
        drop_candidates = np.where(energy_diff > drop_threshold)[0]
        
        # Filter drops (minimum 30 seconds apart)
        filtered_drops = []
        for drop_idx in drop_candidates:
            drop_time = times[drop_idx]
            if not any(abs(drop_time - existing) < 30 for existing in filtered_drops):
                if 30 < drop_time < duration - 30:  # Not too close to start/end
                    filtered_drops.append(drop_time)
        
        # Add drop cue points
        for i, drop_time in enumerate(filtered_drops[:3]):  # Max 3 drops
            drop_time = self._snap_to_beat(drop_time, y, sr)
            cue_points.append({
                'name': f'Drop {i+1}',
                'time': float(drop_time),
                'type': 'drop'
            })
        
        # Detect breakdowns (sudden energy decreases)
        breakdown_threshold = np.percentile(energy_diff, 10)
        breakdown_candidates = np.where(energy_diff < breakdown_threshold)[0]
        
        # Filter breakdowns
        filtered_breakdowns = []
        for breakdown_idx in breakdown_candidates:
            breakdown_time = times[breakdown_idx]
            if not any(abs(breakdown_time - existing) < 30 for existing in filtered_breakdowns):
                if 30 < breakdown_time < duration - 30:
                    filtered_breakdowns.append(breakdown_time)
        
        # Add breakdown cue points
        for i, breakdown_time in enumerate(filtered_breakdowns[:2]):  # Max 2 breakdowns
            breakdown_time = self._snap_to_beat(breakdown_time, y, sr)
            cue_points.append({
                'name': f'Down {i+1}',
                'time': float(breakdown_time),
                'type': 'breakdown'
            })
        
        return cue_points

    def _detect_structural_cues(self, y, sr, duration):
        """Detect structural cue points using spectral analysis."""
        cue_points = []
        
        # Use MFCC for structural analysis
        mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13, hop_length=512)
        
        # Calculate novelty function
        novelty = np.sum(np.diff(mfcc, axis=1)**2, axis=0)
        novelty = np.pad(novelty, (1, 0), mode='constant')
        
        # Smooth novelty
        novelty_smooth = ndimage.gaussian_filter1d(novelty, sigma=3.0)
        
        # Find peaks in novelty (structural changes)
        from scipy.signal import find_peaks
        peaks, properties = find_peaks(
            novelty_smooth,
            height=np.percentile(novelty_smooth, 70),
            distance=int(sr / 512 * 15)  # Minimum 15 seconds apart
        )
        
        # Convert to time
        times = librosa.frames_to_time(peaks, sr=sr, hop_length=512)
        
        # Add structural cue points
        for i, struct_time in enumerate(times):
            if 30 < struct_time < duration - 30:
                struct_time = self._snap_to_beat(struct_time, y, sr)
                cue_points.append({
                    'name': f'Section {i+1}',
                    'time': float(struct_time),
                    'type': 'section'
                })
        
        return cue_points

    def _detect_rhythmic_cues(self, y, sr, duration):
        """Detect rhythm-based cue points."""
        cue_points = []
        
        # Beat tracking
        tempo, beats = librosa.beat.beat_track(
            y=y, sr=sr,
            hop_length=512,
            units='time',
            trim=False
        )
        
        if len(beats) > 16:  # Need sufficient beats
            # Find 16-bar phrases (assuming 4/4 time)
            beats_per_bar = 4
            bars_per_phrase = 16
            beats_per_phrase = beats_per_bar * bars_per_phrase
            
            # Find phrase boundaries
            phrase_starts = []
            for i in range(0, len(beats), beats_per_phrase):
                if i < len(beats):
                    phrase_time = beats[i]
                    if 15 < phrase_time < duration - 15:  # Valid range
                        phrase_starts.append(phrase_time)
            
            # Add phrase cue points (first few phrases)
            for i, phrase_time in enumerate(phrase_starts[:4]):
                cue_points.append({
                    'name': f'Phrase {i+1}',
                    'time': float(phrase_time),
                    'type': 'phrase'
                })
        
        return cue_points

    def _snap_to_beat(self, time, y, sr):
        """Snap a time position to the nearest beat."""
        try:
            # Get beats around the target time
            tempo, beats = librosa.beat.beat_track(
                y=y, sr=sr,
                hop_length=512,
                units='time',
                trim=False
            )
            
            if len(beats) > 0:
                # Find closest beat
                closest_beat_idx = np.argmin(np.abs(beats - time))
                return beats[closest_beat_idx]
            else:
                return time
        except:
            return time

    def _filter_and_sort_cues(self, cue_points, duration):
        """Filter cues intelligently for DJ use - adaptive based on song complexity."""
        if not cue_points:
            return self._create_essential_cues(duration)
        
        # Sort by time first
        cue_points.sort(key=lambda x: x['time'])
        
        # Determine song complexity and adjust cue count accordingly
        song_complexity = self._assess_song_complexity(cue_points, duration)
        max_cues = self._get_optimal_cue_count(song_complexity, duration)
        
        # Intelligent cue filtering for DJ use
        essential_cues = []
        
        # 1. Always include intro (mix-in point)
        intro_cues = [c for c in cue_points if c['type'] == 'intro']
        if intro_cues:
            essential_cues.append(intro_cues[0])
        else:
            essential_cues.append({
                'name': 'Mix In',
                'time': 0.0,
                'type': 'intro'
            })
        
        # 2. Find all good drops (energy peaks)
        drop_cues = [c for c in cue_points if c['type'] == 'drop']
        if drop_cues:
            # For complex songs, include multiple drops
            scored_drops = self._score_drops_for_complexity(drop_cues, duration, song_complexity)
            for drop in scored_drops[:min(3, len(scored_drops))]:  # Max 3 drops
                essential_cues.append(drop)
        
        # 3. Find breakdown points (good for mixing)
        breakdown_cues = [c for c in cue_points if c['type'] == 'breakdown']
        if breakdown_cues and song_complexity > 1:
            # Include breakdowns for complex songs
            good_breakdowns = [c for c in breakdown_cues if duration * 0.25 < c['time'] < duration * 0.85]
            for breakdown in good_breakdowns[:2]:  # Max 2 breakdowns
                essential_cues.append(breakdown)
        
        # 4. Find vocal/chorus points
        vocal_cues = [c for c in cue_points if c['type'] in ['section', 'phrase'] and 
                     duration * 0.15 < c['time'] < duration * 0.85]
        if vocal_cues:
            # Include multiple vocal points for longer/complex songs
            vocal_count = min(2 if song_complexity > 2 else 1, len(vocal_cues))
            for i, vocal in enumerate(vocal_cues[:vocal_count]):
                vocal['name'] = f'Vocal {i+1}' if vocal_count > 1 else 'Vocal'
                vocal['type'] = 'vocal'
                essential_cues.append(vocal)
        
        # 5. Add build-up points for complex songs
        if song_complexity > 2:
            buildup_cues = [c for c in cue_points if c['type'] in ['buildup', 'rise'] and 
                           duration * 0.2 < c['time'] < duration * 0.8]
            for buildup in buildup_cues[:2]:  # Max 2 build-ups
                buildup['name'] = 'Build-Up'
                buildup['type'] = 'buildup'
                essential_cues.append(buildup)
        
        # 6. Always include outro (mix-out point)
        outro_cues = [c for c in cue_points if c['type'] == 'outro']
        if outro_cues:
            essential_cues.append(outro_cues[0])
        else:
            outro_time = self._find_optimal_outro_point(duration)
            essential_cues.append({
                'name': 'Mix Out',
                'time': outro_time,
                'type': 'outro'
            })
        
        # Remove duplicates and ensure minimum spacing
        min_spacing = 20.0 if song_complexity > 2 else 30.0  # Closer spacing for complex songs
        final_cues = []
        for cue in essential_cues:
            if not any(abs(cue['time'] - existing['time']) < min_spacing for existing in final_cues):
                if 0 <= cue['time'] <= duration:
                    final_cues.append(cue)
        
        # Sort by time
        final_cues.sort(key=lambda x: x['time'])
        
        # Limit to max cues but ensure we have at least intro and outro
        if len(final_cues) > max_cues:
            # Keep intro, outro, and best middle cues
            intro = [c for c in final_cues if c['type'] == 'intro']
            outro = [c for c in final_cues if c['type'] == 'outro']
            middle_cues = [c for c in final_cues if c['type'] not in ['intro', 'outro']]
            
            # Sort middle cues by importance (drops first, then others)
            middle_cues.sort(key=lambda x: (0 if x['type'] == 'drop' else 1, x['time']))
            
            final_cues = intro + middle_cues[:max_cues-2] + outro
            final_cues.sort(key=lambda x: x['time'])
        
        # Ensure we have at least intro and outro
        if len(final_cues) < 2:
            return self._create_essential_cues(duration)
        
        return final_cues

    def _assess_song_complexity(self, cue_points, duration):
        """Assess song complexity to determine optimal cue point count."""
        complexity_score = 0
        
        # Length factor
        if duration > 360:  # 6+ minutes
            complexity_score += 3
        elif duration > 240:  # 4+ minutes
            complexity_score += 2
        elif duration > 180:  # 3+ minutes
            complexity_score += 1
        
        # Structure complexity
        unique_types = len(set(c['type'] for c in cue_points))
        complexity_score += min(unique_types // 2, 3)
        
        # Cue density
        cue_density = len(cue_points) / (duration / 60)  # cues per minute
        if cue_density > 3:
            complexity_score += 2
        elif cue_density > 2:
            complexity_score += 1
        
        return min(complexity_score, 5)  # Max complexity of 5

    def _get_optimal_cue_count(self, complexity, duration):
        """Get optimal cue count based on song complexity."""
        base_count = 3  # Minimum: intro, main point, outro
        
        if complexity <= 1:
            return base_count
        elif complexity <= 2:
            return base_count + 2  # 5 cues
        elif complexity <= 3:
            return base_count + 4  # 7 cues
        elif complexity <= 4:
            return base_count + 6  # 9 cues
        else:
            return base_count + 8  # 11 cues for very complex songs

    def _score_drops_for_complexity(self, drop_cues, duration, complexity):
        """Score and select drops based on song complexity."""
        scored_drops = []
        
        for drop in drop_cues:
            score = 0
            time = drop['time']
            
            # Position scoring
            if duration * 0.25 < time < duration * 0.75:
                score += 10
            elif duration * 0.15 < time < duration * 0.85:
                score += 5
            
            # Timing scoring
            if time > 30 and time < duration - 60:
                score += 5
            
            # Complexity bonus - prefer more drops for complex songs
            if complexity > 2:
                score += 3
            
            scored_drops.append((drop, score))
        
        # Sort by score and return top drops
        scored_drops.sort(key=lambda x: x[1], reverse=True)
        return [drop for drop, score in scored_drops]

    def _find_best_drop(self, drop_cues, duration):
        """Find the best drop for DJ mixing."""
        if not drop_cues:
            return None
        
        # Score drops based on timing and energy
        scored_drops = []
        for drop in drop_cues:
            score = 0
            time = drop['time']
            
            # Prefer drops in the middle section (better for mixing)
            if duration * 0.25 < time < duration * 0.75:
                score += 10
            elif duration * 0.15 < time < duration * 0.85:
                score += 5
            
            # Prefer drops that aren't too early or too late
            if time > 30 and time < duration - 60:
                score += 5
            
            scored_drops.append((drop, score))
        
        # Return the highest scored drop
        if scored_drops:
            best_drop, _ = max(scored_drops, key=lambda x: x[1])
            best_drop['name'] = 'Drop'
            return best_drop
        
        return None

    def _find_optimal_outro_point(self, duration):
        """Find optimal outro point for mixing out."""
        # Outro should be in the last third but not too close to the end
        optimal_time = max(duration * 0.7, duration - 90)  # At least 90 seconds from end
        return min(optimal_time, duration - 30)  # But at least 30 seconds from end

    def _create_essential_cues(self, duration):
        """Create essential cue points when detection fails."""
        return [
            {
                'name': 'Mix In',
                'time': 0.0,
                'type': 'intro'
            },
            {
                'name': 'Drop',
                'time': max(30.0, duration * 0.4),
                'type': 'drop'
            },
            {
                'name': 'Mix Out',
                'time': max(duration * 0.7, duration - 60),
                'type': 'outro'
            }
        ]

    def detect_song_structure_rekordbox_algorithm(self, y, sr, duration):
        """Robust song structure detection using MFCC novelty and peak picking."""
        try:
            hop_length = 1024
            mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=20, hop_length=hop_length)
            # Novelty from MFCC differences
            novelty = np.sum(np.diff(mfcc, axis=1) ** 2, axis=0)
            novelty = np.pad(novelty, (1, 0), mode='constant')
            novelty_smooth = ndimage.gaussian_filter1d(novelty, sigma=6.0)

            # Peak picking for boundaries
            from scipy.signal import find_peaks
            min_distance = int((sr / hop_length) * 10)  # ~10s between boundaries
            height = np.percentile(novelty_smooth, 65)
            peaks, _ = find_peaks(novelty_smooth, distance=max(min_distance, 5), height=height)

            # Boundary times with start/end
            boundary_times = librosa.frames_to_time(peaks, sr=sr, hop_length=hop_length)
            boundaries = np.unique(np.clip(np.concatenate([[0.0], boundary_times, [duration]]), 0, duration))

            structure: List[Dict[str, float]] = []
            for i in range(len(boundaries) - 1):
                start = float(boundaries[i])
                end = float(boundaries[i + 1])
                seg_dur = end - start
                if seg_dur <= 1.0:
                    continue

                # Simple heuristics for labels
                if i == 0:
                    seg_type = 'intro'
                elif i == len(boundaries) - 2:
                    seg_type = 'outro'
                else:
                    # Energy proxy
                    seg_audio = y[int(start * sr): int(end * sr)]
                    seg_rms = 0.0
                    if len(seg_audio) > 0:
                        seg_rms = float(np.mean(librosa.feature.rms(y=seg_audio, hop_length=512)))
                    if seg_rms > np.percentile(novelty_smooth, 75):
                        seg_type = 'chorus'
                    elif seg_dur >= 25:
                        seg_type = 'verse'
                    else:
                        seg_type = 'bridge'

                structure.append({'type': seg_type, 'start': start, 'end': end, 'duration': seg_dur})

            if not structure:
                return [
                    {'type': 'intro', 'start': 0.0, 'end': min(30.0, duration), 'duration': min(30.0, duration)},
                    {'type': 'outro', 'start': max(0.0, duration - 30.0), 'end': duration, 'duration': min(30.0, duration)}
                ]
            return structure
        except Exception as e:
            logger.error(f"Structure detection failed: {str(e)}")
            return [
                {'type': 'intro', 'start': 0.0, 'end': 30.0, 'duration': 30.0},
                {'type': 'verse', 'start': 30.0, 'end': float(max(30.0, duration - 30.0)), 'duration': float(max(0.0, duration - 60.0))},
                {'type': 'outro', 'start': float(max(0.0, duration - 30.0)), 'end': float(duration), 'duration': float(min(30.0, duration))}
            ]

    def analyze_audio(self, file_path):
        """Main analysis function that processes audio and returns comprehensive results."""
        try:
            # Unified, robust loading
            y, sr, duration = self.load_audio(file_path)

            # Generate waveform data for visualization
            waveform_data = self._generate_waveform_data(y, sr)

            # Basic audio analysis
            camelot_key, mode, key_conf = self.detect_key_rekordbox_algorithm(y, sr)
            bpm = int(round(self.detect_bpm_rekordbox_algorithm(y, sr)))
            cue_points = self.detect_cue_points_rekordbox_algorithm(y, sr, duration)
            song_structure = self.detect_song_structure_rekordbox_algorithm(y, sr, duration)

            # Advanced analysis modules (can be heavy; add short-circuit for long files)
            energy_analysis = self._analyze_energy_levels(y, sr)
            harmonic_mixing = self._analyze_harmonic_mixing(camelot_key)
            advanced_mixing = self._analyze_advanced_mixing(camelot_key, energy_analysis.get('energy_level', 5))

            # Compile results
            analysis = {
                'file_path': file_path,
                'duration': duration,
                'sample_rate': sr,
                'waveform_data': waveform_data,
                'key': camelot_key,
                'key_mode': mode,
                'key_confidence': float(key_conf),
                'bpm': bpm,
                'cue_points': cue_points,
                'song_structure': song_structure,
                'structure': song_structure,  # alias for compatibility with tests/clients
                'energy_analysis': energy_analysis,
                'harmonic_mixing': harmonic_mixing,
                'advanced_mixing': advanced_mixing,
                'analysis_timestamp': time.time()
            }

            return analysis

        except Exception as e:
            logger.error(f"analyze_audio failed: {e}")
            return None

    def _generate_waveform_data(self, y: np.ndarray, sr: int) -> List[float]:
        """Generate waveform data for visualization."""
        try:
            # Downsample for visualization (aim for ~1000-2000 points)
            target_points = 1500
            hop_length = max(1, len(y) // target_points)
            
            # Calculate RMS energy in windows for waveform
            waveform = []
            for i in range(0, len(y), hop_length):
                window = y[i:i + hop_length]
                if len(window) > 0:
                    # Calculate RMS and normalize
                    rms = np.sqrt(np.mean(window**2))
                    waveform.append(float(rms))
            
            # Normalize waveform data to 0-1 range
            if waveform:
                max_val = max(waveform)
                if max_val > 0:
                    waveform = [val / max_val for val in waveform]
            
            return waveform
            
        except Exception as e:
            return []

    def _analyze_energy_levels(self, y, sr):
        """Analyze energy levels using the energy analysis module."""
        try:
            import sys
            import os
            sys.path.append(os.path.join(os.path.dirname(__file__), 'tools'))
            from energy_analysis import EnergyAnalyzer
            energy_analyzer = EnergyAnalyzer()
            return energy_analyzer.analyze_energy_level(y, sr)
        except Exception as e:
            logger.warning(f"Energy analysis failed: {str(e)}")
            return {
                'overall_energy': 5,
                'energy_level': 5,
                'energy_level_name': 'MEDIUM',
                'energy_description': 'Medium energy - balanced, steady, foundation',
                'energy_metrics': {
                    'rms_energy': 0.5,
                    'spectral_energy': 0.5,
                    'rhythmic_energy': 0.5,
                    'dynamic_energy': 0.5
                },
                'energy_profile': [],
                'energy_peaks': [],
                'energy_valleys': []
            }

    def _analyze_harmonic_mixing(self, key):
        """Analyze harmonic mixing opportunities."""
        try:
            import sys
            import os
            sys.path.append(os.path.join(os.path.dirname(__file__), 'tools'))
            from harmonic_mixing import HarmonicMixer
            harmonic_mixer = HarmonicMixer()
            return harmonic_mixer.get_mixing_suggestions(key)
        except Exception as e:
            logger.warning(f"Harmonic mixing analysis failed: {str(e)}")
            return {
                'current_key': key,
                'current_key_name': key,
                'compatible_keys': [],
                'energy_build_suggestions': [],
                'energy_release_suggestions': [],
                'power_block_suggestions': []
            }

    def _analyze_advanced_mixing(self, key, energy_level):
        """Analyze advanced mixing techniques."""
        try:
            import sys
            import os
            sys.path.append(os.path.join(os.path.dirname(__file__), 'tools'))
            from advanced_mixing import AdvancedMixer
            advanced_mixer = AdvancedMixer()
            
            # Create a mock track for analysis
            mock_track = {
                'key': key,
                'energy': energy_level,
                'name': 'Current Track'
            }
            
            return {
                'harmonic_energy_suggestions': advanced_mixer.get_harmonic_energy_suggestions(key, energy_level),
                'beat_jump_opportunities': advanced_mixer.analyze_beat_jump_opportunities(mock_track),
                'cue_point_suggestions': []
            }
        except Exception as e:
            logger.warning(f"Advanced mixing analysis failed: {str(e)}")
            return {
                'harmonic_energy_suggestions': [],
                'beat_jump_opportunities': [],
                'cue_point_suggestions': []
            }

def main():
    """Main entry point for command line usage."""
    logger.info("Starting audio analyzer...")
    
    if len(sys.argv) != 2:
        logger.error("Usage: python analyzer.py <audio_file_path>")
        print("Usage: python analyzer.py <audio_file_path>")
        sys.exit(1)
    
    file_path = sys.argv[1]
    logger.info(f"Processing file: {file_path}")
    
    if not os.path.exists(file_path):
        logger.error(f"File does not exist: {file_path}")
        print(f"Error: File {file_path} does not exist")
        sys.exit(1)
    
    try:
        logger.info("Initializing AudioAnalyzer...")
        analyzer = AudioAnalyzer()
        analysis = analyzer.analyze_audio(file_path)
        if not analysis:
            logger.error("Analysis failed to produce a result")
            print(json.dumps({
                'error': 'ANALYSIS_FAILED',
                'message': 'Failed to decode or analyze audio file.'
            }))
            sys.exit(2)
        # Output JSON result
        logger.info("Outputting JSON result...")
        print(json.dumps(analysis, indent=2))
        logger.info("Analysis completed successfully")
        
    except Exception as e:
        logger.error(f"Analysis failed: {str(e)}")
        print(f"Error: {str(e)}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main() 
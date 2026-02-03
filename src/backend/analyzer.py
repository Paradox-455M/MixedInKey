#!/usr/bin/env python3
"""
Mixed In AI - Audio Analysis Backend
Analyzes audio files to detect key, BPM, cue points, and song structure.
"""

import os
# Ensure Numba JIT is enabled before importing libraries that may rely on it.
# Disabling JIT can cause objects expected to be Numba dispatchers to degrade to plain
# Python functions, triggering errors like: 'function' object has no attribute 'get_call_template'.
if os.environ.get('NUMBA_DISABLE_JIT') == '1':
    os.environ.pop('NUMBA_DISABLE_JIT', None)

import warnings
# Suppress specific librosa warnings
warnings.filterwarnings('ignore', category=FutureWarning, module='librosa')

# Configure thread counts (override with MIXEDINAI_THREADS). Defaults to a safe multi-core value.
def _configure_threads():
    desired = os.environ.get('MIXEDINAI_THREADS')
    try:
        threads = int(desired) if desired else min(4, max(1, (os.cpu_count() or 2)))
    except Exception:
        threads = min(4, max(1, (os.cpu_count() or 2)))
    for var in ['NUMBA_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'OMP_NUM_THREADS']:
        if not os.environ.get(var):
            os.environ[var] = str(threads)
    # Build a safe, introspectable info dict
    def _to_int(name: str, fallback: int) -> int:
        try:
            return int(os.environ.get(name, fallback))
        except Exception:
            return fallback
    return {
        'effective_threads': threads,
        'NUMBA_NUM_THREADS': _to_int('NUMBA_NUM_THREADS', threads),
        'OPENBLAS_NUM_THREADS': _to_int('OPENBLAS_NUM_THREADS', threads),
        'OMP_NUM_THREADS': _to_int('OMP_NUM_THREADS', threads)
    }

THREAD_INFO = _configure_threads()

import sys
import json
import math
import sqlite3
import numpy as np
import librosa
import soundfile as sf
from pydub import AudioSegment
import logging
import tempfile
from scipy import signal
from scipy import ndimage
from scipy.stats import pearsonr
from typing import List, Dict, Tuple, Optional
import time
import subprocess
import shutil
import struct
import concurrent.futures

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stderr)
    ]
)
logger = logging.getLogger(__name__)

# Optional import for the modular cue pipeline
try:
    from backend.pipeline.pipeline import CuePipeline as _CuePipeline  # type: ignore
except Exception:
    try:
        from pipeline.pipeline import CuePipeline as _CuePipeline  # type: ignore
    except Exception:
        _CuePipeline = None  # type: ignore

class CacheManager:
    """Manages persistent caching of analysis results using SQLite for O(1) operations."""
    def __init__(self, cache_file=None):
        if cache_file is None:
            self.cache_file = os.path.expanduser("~/.mixed_in_ai_cache.db")
        else:
            # Convert .json extension to .db if provided
            if cache_file.endswith('.json'):
                cache_file = cache_file[:-5] + '.db'
            self.cache_file = cache_file
        self.conn = None
        self._init_db()

    def _init_db(self):
        """Initialize SQLite database with indexed table and performance optimizations."""
        try:
            self.conn = sqlite3.connect(self.cache_file, check_same_thread=False)

            # Performance optimizations via PRAGMA
            self.conn.execute('PRAGMA journal_mode=WAL')       # Write-Ahead Logging for concurrent reads
            self.conn.execute('PRAGMA synchronous=NORMAL')     # Faster, still safe with WAL
            self.conn.execute('PRAGMA cache_size=-64000')      # 64MB cache
            self.conn.execute('PRAGMA temp_store=MEMORY')      # Temp tables in memory
            self.conn.execute('PRAGMA mmap_size=268435456')    # 256MB mmap for reads

            # Create table with waveform BLOB column for binary storage
            self.conn.execute('''
                CREATE TABLE IF NOT EXISTS cache (
                    file_path TEXT PRIMARY KEY,
                    mtime REAL NOT NULL,
                    analysis TEXT NOT NULL,
                    waveform BLOB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            self.conn.execute('CREATE INDEX IF NOT EXISTS idx_mtime ON cache(mtime)')

            # Migration: add waveform column if missing (for existing caches)
            cursor = self.conn.execute("PRAGMA table_info(cache)")
            columns = [row[1] for row in cursor.fetchall()]
            if 'waveform' not in columns:
                self.conn.execute('ALTER TABLE cache ADD COLUMN waveform BLOB')

            self.conn.commit()
        except Exception as e:
            logger.warning(f"Failed to initialize cache database: {e}")
            self.conn = None

    def get(self, file_path):
        """Get analysis from cache if file hasn't changed. O(1) lookup."""
        if self.conn is None:
            return None
        try:
            abs_path = os.path.abspath(file_path)

            # Check if file still exists
            if not os.path.exists(abs_path):
                return None

            cursor = self.conn.execute(
                'SELECT mtime, analysis, waveform FROM cache WHERE file_path = ?',
                (abs_path,)
            )
            row = cursor.fetchone()

            if not row:
                return None

            cached_mtime, analysis_json, waveform_blob = row
            current_mtime = os.path.getmtime(abs_path)

            # Validate mtime matches (file hasn't changed)
            if abs(cached_mtime - current_mtime) < 0.001:  # Float comparison
                analysis = json.loads(analysis_json)

                # Reassemble waveform from binary BLOB if present
                if waveform_blob and 'waveform_data' not in analysis:
                    num_floats = len(waveform_blob) // 4
                    analysis['waveform_data'] = list(struct.unpack(f'{num_floats}f', waveform_blob))

                return analysis

            return None
        except Exception as e:
            logger.warning(f"Cache lookup failed for {file_path}: {e}")
            return None

    def set(self, file_path, analysis):
        """Save analysis to cache. O(1) insert/update. Stores waveform as binary BLOB."""
        if self.conn is None:
            return
        try:
            abs_path = os.path.abspath(file_path)
            if not os.path.exists(abs_path):
                return

            mtime = os.path.getmtime(abs_path)

            # Extract waveform for separate binary BLOB storage
            analysis_copy = analysis.copy()
            waveform_data = analysis_copy.pop('waveform_data', None)
            waveform_blob = None
            if waveform_data and len(waveform_data) > 0:
                waveform_blob = struct.pack(f'{len(waveform_data)}f', *waveform_data)

            analysis_json = json.dumps(analysis_copy)

            self.conn.execute(
                'INSERT OR REPLACE INTO cache (file_path, mtime, analysis, waveform) VALUES (?, ?, ?, ?)',
                (abs_path, mtime, analysis_json, waveform_blob)
            )
            self.conn.commit()
        except Exception as e:
            logger.warning(f"Cache save failed for {file_path}: {e}")

    def set_many(self, items: List[Tuple[str, dict]]):
        """Batch insert/update multiple cache entries. Single commit at end for efficiency."""
        if self.conn is None:
            return
        try:
            for file_path, analysis in items:
                abs_path = os.path.abspath(file_path)
                if not os.path.exists(abs_path):
                    continue

                mtime = os.path.getmtime(abs_path)

                # Extract waveform for separate binary BLOB storage
                analysis_copy = analysis.copy()
                waveform_data = analysis_copy.pop('waveform_data', None)
                waveform_blob = None
                if waveform_data and len(waveform_data) > 0:
                    waveform_blob = struct.pack(f'{len(waveform_data)}f', *waveform_data)

                analysis_json = json.dumps(analysis_copy)

                self.conn.execute(
                    'INSERT OR REPLACE INTO cache (file_path, mtime, analysis, waveform) VALUES (?, ?, ?, ?)',
                    (abs_path, mtime, analysis_json, waveform_blob)
                )

            self.conn.commit()  # Single commit for entire batch
        except Exception as e:
            logger.warning(f"Batch cache save failed: {e}")

    def clear(self):
        """Clear all cached entries."""
        if self.conn is None:
            return
        try:
            self.conn.execute('DELETE FROM cache')
            self.conn.commit()
        except Exception as e:
            logger.warning(f"Cache clear failed: {e}")

    def remove(self, file_path):
        """Remove a specific entry from cache."""
        if self.conn is None:
            return
        try:
            abs_path = os.path.abspath(file_path)
            self.conn.execute('DELETE FROM cache WHERE file_path = ?', (abs_path,))
            self.conn.commit()
        except Exception as e:
            logger.warning(f"Cache remove failed for {file_path}: {e}")

    def get_stats(self):
        """Get cache statistics."""
        if self.conn is None:
            return {'count': 0, 'size_bytes': 0}
        try:
            cursor = self.conn.execute('SELECT COUNT(*), SUM(LENGTH(analysis)) FROM cache')
            row = cursor.fetchone()
            return {
                'count': row[0] or 0,
                'size_bytes': row[1] or 0
            }
        except Exception:
            return {'count': 0, 'size_bytes': 0}

    def __del__(self):
        """Close database connection on cleanup."""
        if self.conn:
            try:
                self.conn.close()
            except Exception:
                pass

class AudioAnalyzer:
    def __init__(self):
        # Camelot wheel mapping (industry standard): A = minor, B = major
        # Uppercase letters represent major keys; lowercase represent minor keys
        self.camelot_wheel = {
            # Major (B)
            'C': '8B', 'C#': '3B', 'D': '10B', 'D#': '5B', 'E': '12B', 'F': '7B',
            'F#': '2B', 'G': '9B', 'G#': '4B', 'A': '11B', 'A#': '6B', 'B': '1B',
            # Minor (A)
            'c': '5A', 'c#': '12A', 'd': '7A', 'd#': '2A', 'e': '9A', 'f': '4A',
            'f#': '11A', 'g': '6A', 'g#': '1A', 'a': '8A', 'a#': '3A', 'b': '10A'
        }
        
        # Industry-standard key profiles (Krumhansl-Schmuckler)
        self.major_profile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
        self.minor_profile = [6.33, 2.68, 3.69, 5.38, 2.60, 3.67, 2.58, 4.95, 2.63, 3.71, 3.28, 3.73]
        # Per-run feature cache (populated in analyze_audio)
        self._features = None

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

    def detect_key_rekordbox_algorithm(self, y, sr, features=None):
        """Industry-standard key detection algorithm matching Mixed In Key/Rekordbox accuracy.

        Args:
            y: Audio time series
            sr: Sample rate
            features: Optional precomputed features dict from _precompute_features()
        """
        try:
            # Use precomputed features if available, otherwise compute on demand
            if features is None:
                features = self._features if self._features else {}

            # Get tuning from precomputed features or estimate
            tuning = features.get('tuning', 0.0)
            if tuning == 0.0 and 'tuning' not in features:
                try:
                    tuning = float(librosa.estimate_tuning(y=y, sr=sr))
                except Exception:
                    tuning = 0.0

            # Multi-algorithm approach for maximum accuracy
            results = []

            # Algorithm 1: Enhanced Chroma-based detection (Rekordbox style)
            result1 = self._detect_key_chroma_enhanced(y, sr, features)
            results.append(result1)

            # Algorithm 2: Harmonic-Percussive separation + Chroma
            result2 = self._detect_key_harmonic_percussive(y, sr, features)
            results.append(result2)

            # Algorithm 3: Multi-resolution Chroma analysis
            result3 = self._detect_key_multiresolution(y, sr, features)
            results.append(result3)

            # Algorithm 4: Windowed-majority over track segments
            result4 = self._detect_key_windowed_majority(y, sr, features)
            results.append(result4)

            # Algorithm 5: Beat-synchronous chroma voting
            result5 = self._detect_key_beat_synchronous(y, sr, features)
            results.append(result5)

            # Weighted voting system (industry approach)
            final_key, final_mode, final_confidence = self._weighted_key_voting(results)

            # Convert to Camelot format
            camelot_key = self.camelot_wheel.get(final_key, final_key)

            return camelot_key, final_mode, final_confidence

        except Exception as e:
            logger.error(f"Key detection failed: {str(e)}")
            return '8A', 'minor', 0.5

    def _detect_key_chroma_enhanced(self, y, sr, features=None):
        """Enhanced chroma-based key detection with preprocessing.

        Uses precomputed chroma_512 from features if available.
        """
        # Try to use precomputed chromagram
        chroma = None
        if features and features.get('chroma_512') is not None:
            chroma = features['chroma_512']
        else:
            # Fallback: compute chromagram (pre-emphasis for better quality)
            y_preemph = np.append(y[0], y[1:] - 0.97 * y[:-1])
            try:
                tune = features.get('tuning', 0.0) if features else 0.0
                if tune == 0.0:
                    tune = float(librosa.estimate_tuning(y=y, sr=sr))
            except Exception:
                tune = 0.0
            chroma = librosa.feature.chroma_cqt(
                y=y_preemph, sr=sr,
                hop_length=512,
                bins_per_octave=36,
                n_chroma=12,
                tuning=tune,
                norm=2,
                threshold=0.0
            )

        # Temporal smoothing (reduces noise)
        chroma_smooth = ndimage.gaussian_filter1d(chroma, sigma=1.0, axis=1)

        # Use weighted average (emphasize stable regions)
        weights = np.sum(chroma_smooth, axis=0)
        max_weight = np.max(weights)
        if max_weight > 0:
            weights = weights / max_weight
        weights = np.power(weights, 2)  # Emphasize high-energy regions

        chroma_avg = np.average(chroma_smooth, axis=1, weights=weights)
        norm = np.linalg.norm(chroma_avg)
        if norm > 0:
            chroma_avg = chroma_avg / norm

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
            except Exception:
                correlations.append((key_names[i], 'major', 0))
                correlations.append((key_names[i].lower(), 'minor', 0))

        # Find best match
        best_key, best_mode, best_corr = max(correlations, key=lambda x: x[2])

        return best_key, best_mode, max(0, best_corr)

    def _detect_key_harmonic_percussive(self, y, sr, features=None):
        """Key detection using harmonic-percussive separation.

        Uses precomputed y_harm and chroma_harm_1024 from features if available.
        """
        # Use precomputed chroma on harmonic component if available
        chroma = None
        if features and features.get('chroma_harm_1024') is not None:
            chroma = features['chroma_harm_1024']
        else:
            # Fallback: compute HPSS and chroma
            y_harmonic = features.get('y_harm', y) if features else y
            if y_harmonic is y:
                y_harmonic, _ = librosa.effects.hpss(y, margin=8.0)

            try:
                tune = features.get('tuning', 0.0) if features else 0.0
            except Exception:
                tune = 0.0
            chroma = librosa.feature.chroma_cqt(
                y=y_harmonic, sr=sr,
                hop_length=1024,
                bins_per_octave=36,
                n_chroma=12,
                norm=2,
                tuning=tune
            )

        # Remove percussive interference
        chroma_clean = np.maximum(chroma - 0.1, 0)

        # Aggregate using harmonic mean (more stable)
        n_frames = chroma_clean.shape[1]
        if n_frames > 0:
            chroma_avg = np.power(np.prod(chroma_clean + 1e-8, axis=1), 1.0 / n_frames)
        else:
            chroma_avg = np.mean(chroma_clean, axis=1)
        norm = np.linalg.norm(chroma_avg)
        if norm > 0:
            chroma_avg = chroma_avg / norm

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

    def _detect_key_multiresolution(self, y, sr, features=None):
        """Multi-resolution chroma analysis for robust key detection.

        Uses precomputed chroma at multiple hop lengths and spectral centroids.
        """
        # Multiple hop lengths for different time resolutions
        hop_lengths = [256, 512, 1024, 2048]
        chroma_features = []

        for hop_length in hop_lengths:
            # Use precomputed chromagram if available
            chroma = None
            centroid = None
            if features:
                chroma = features.get(f'chroma_{hop_length}')
                centroid = features.get(f'spectral_centroid_{hop_length}')

            # Fallback: compute if not cached
            if chroma is None:
                chroma = librosa.feature.chroma_cqt(
                    y=y, sr=sr,
                    hop_length=hop_length,
                    bins_per_octave=36,
                    n_chroma=12,
                    norm=2
                )
            if centroid is None:
                centroid = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=hop_length)[0]

            # Weight by spectral centroid (emphasize melodic content)
            max_centroid = np.max(centroid)
            if max_centroid > 0:
                weights = centroid / max_centroid
            else:
                weights = np.ones_like(centroid)

            # Handle shape mismatch between chroma and centroid
            min_len = min(chroma.shape[1], len(weights))
            chroma_weighted = np.average(chroma[:, :min_len], axis=1, weights=weights[:min_len])
            chroma_features.append(chroma_weighted)

        # Combine multi-resolution features
        chroma_combined = np.mean(chroma_features, axis=0)
        norm = np.linalg.norm(chroma_combined)
        if norm > 0:
            chroma_combined = chroma_combined / norm

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

    def _detect_key_windowed_majority(self, y: np.ndarray, sr: int, features=None):
        """Detect key by voting over overlapping windows with energy weighting.

        Note: This method operates on segments and cannot fully leverage precomputed
        features. The features parameter is accepted for interface consistency.

        Returns tuple (pitch_name, 'major'|'minor', confidence_in_0_1).
        """
        duration = len(y) / float(sr) if sr > 0 else 0.0
        if duration <= 0.5:
            return 'C', 'major', 0.5

        window_s = float(min(20.0, max(8.0, duration * 0.15)))
        hop_s = float(max(4.0, window_s / 3.0))

        step = int(hop_s * sr)
        win = int(window_s * sr)
        if win <= 0 or step <= 0:
            return 'C', 'major', 0.5

        major_profile = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
        minor_profile = np.array([6.33, 2.68, 3.69, 5.38, 2.60, 3.67, 2.58, 4.95, 2.63, 3.71, 3.28, 3.73])
        major_profile = major_profile / np.linalg.norm(major_profile)
        minor_profile = minor_profile / np.linalg.norm(minor_profile)
        key_names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

        votes: Dict[str, float] = {}
        total_weight = 0.0

        for start in range(0, len(y) - win + 1, step):
            seg = y[start:start + win]
            if seg.size < win // 2:
                continue
            # Simple energy weight (RMS)
            rms = float(np.sqrt(np.mean(np.square(seg)) + 1e-12))
            if not np.isfinite(rms):
                rms = 0.0
            weight = 1.0 + 4.0 * (rms)  # emphasize high energy windows slightly

            # Chroma over segment
            try:
                chroma = librosa.feature.chroma_cqt(y=seg, sr=sr, hop_length=512, bins_per_octave=36, n_chroma=12, norm=2)
                chroma_avg = np.mean(chroma, axis=1)
                norm = np.linalg.norm(chroma_avg)
                if norm > 0:
                    chroma_avg = chroma_avg / norm
            except Exception:
                continue

            # Correlate with profiles across all rotations
            best = None
            best_val = -1.0
            best_mode = 'major'
            best_pitch = 'C'
            for i in range(12):
                corrM = float(np.dot(chroma_avg, np.roll(major_profile, i)))
                corrm = float(np.dot(chroma_avg, np.roll(minor_profile, i)))
                if corrM > best_val:
                    best_val = corrM
                    best_mode = 'major'
                    best_pitch = key_names[i]
                if corrm > best_val:
                    best_val = corrm
                    best_mode = 'minor'
                    best_pitch = key_names[i].lower()

            vote_key = f"{best_pitch}_{best_mode}"
            votes[vote_key] = votes.get(vote_key, 0.0) + weight
            total_weight += weight

        if not votes or total_weight <= 0:
            return 'C', 'major', 0.5

        best_vote = max(votes.items(), key=lambda kv: kv[1])
        best_key_mode, score = best_vote
        parts = best_key_mode.split('_')
        pitch = parts[0]
        mode = parts[1]
        confidence = float(np.clip(score / (total_weight + 1e-9), 0.0, 1.0))
        return pitch, mode, confidence

    def _detect_key_beat_synchronous(self, y: np.ndarray, sr: int, features=None):
        """Key via beat-synchronous chroma aggregation (robust to percussion).

        Uses precomputed chroma_harm_512 and beat_frames from features if available.
        """
        try:
            # Use precomputed chroma on harmonic component
            chroma = None
            beat_frames = None

            if features:
                chroma = features.get('chroma_harm_512')
                beat_frames = features.get('beat_frames')

            # Fallback: compute HPSS and chroma if not cached
            if chroma is None:
                y_h = features.get('y_harm', y) if features else y
                if y_h is y:
                    y_h, _ = librosa.effects.hpss(y, margin=8.0)
                chroma = librosa.feature.chroma_cqt(
                    y=y_h, sr=sr, hop_length=512,
                    bins_per_octave=36, n_chroma=12, norm=2
                )

            # Fallback: compute beat frames if not cached
            if beat_frames is None:
                y_h = features.get('y_harm', y) if features else y
                if y_h is y:
                    y_h, _ = librosa.effects.hpss(y, margin=8.0)
                _, beat_frames = librosa.beat.beat_track(
                    y=y_h, sr=sr, hop_length=512, units='frames', trim=False
                )

            if beat_frames is None or len(beat_frames) < 8:
                # fallback to median over chroma
                c = np.median(chroma, axis=1)
            else:
                c_sync = librosa.util.sync(chroma, beat_frames, aggregate=np.median)
                c = np.median(c_sync, axis=1)
            c = c / (np.linalg.norm(c) + 1e-9)

            major_profile = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
            minor_profile = np.array([6.33, 2.68, 3.69, 5.38, 2.60, 3.67, 2.58, 4.95, 2.63, 3.71, 3.28, 3.73])
            major_profile = major_profile / np.linalg.norm(major_profile)
            minor_profile = minor_profile / np.linalg.norm(minor_profile)
            key_names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
            best = ('C', 'major', -1.0)
            for i in range(12):
                corrM = float(np.dot(c, np.roll(major_profile, i)))
                corrm = float(np.dot(c, np.roll(minor_profile, i)))
                if corrM > best[2]:
                    best = (key_names[i], 'major', corrM)
                if corrm > best[2]:
                    best = (key_names[i].lower(), 'minor', corrm)
            return best[0], best[1], max(0.0, best[2])
        except Exception:
            return 'C', 'major', 0.5

    def _weighted_key_voting(self, results):
        """Weighted voting system for key detection results (dynamic length)."""
        # Base weights by method order: chroma_enhanced, HPSS, multires, windowed_majority, ...
        base_weights = [0.38, 0.32, 0.18, 0.12]
        if len(results) > len(base_weights):
            # Extend with decaying weights
            last = base_weights[-1]
            for _ in range(len(results) - len(base_weights)):
                last *= 0.7
                base_weights.append(last)
        # Normalize
        base_weights = np.array(base_weights[:len(results)], dtype=float)
        base_weights = base_weights / (np.sum(base_weights) or 1.0)

        key_votes: Dict[str, float] = {}
        for i, (key, mode, confidence) in enumerate(results):
            vote_key = f"{key}_{mode}"
            w = float(base_weights[i])
            weighted_confidence = float(np.clip(confidence, 0.0, 1.0)) * w
            key_votes[vote_key] = key_votes.get(vote_key, 0.0) + weighted_confidence

        if not key_votes:
            return 'C', 'major', 0.5

        best_vote = max(key_votes.items(), key=lambda x: x[1])
        best_key_mode = best_vote[0]
        best_confidence = best_vote[1]

        parts = best_key_mode.split('_')
        final_key = parts[0]
        final_mode = parts[1]
        final_confidence = float(np.clip(best_confidence / (np.max(list(key_votes.values())) or 1.0), 0.0, 1.0))
        return final_key, final_mode, final_confidence

    def detect_bpm_rekordbox_algorithm(self, y, sr, features=None):
        """Industry-standard BPM detection algorithm matching Mixed In Key/Rekordbox accuracy.

        Args:
            y: Audio time series
            sr: Sample rate
            features: Optional precomputed features dict from _precompute_features()
        """
        try:
            # Use precomputed features if available
            if features is None:
                features = self._features if self._features else {}

            # Check if we have a precomputed tempo - use it directly if available
            if features.get('tempo') is not None:
                # Still run voting for accuracy, but weight precomputed tempo highly
                precomputed_tempo = features['tempo']
                bpm_results = [precomputed_tempo]
            else:
                bpm_results = []

            # Algorithm 1: Enhanced onset-based detection
            bpm1 = self._detect_bpm_onset_enhanced(y, sr, features)
            bpm_results.append(bpm1)

            # Algorithm 2: Spectral-based detection
            bpm2 = self._detect_bpm_spectral(y, sr, features)
            bpm_results.append(bpm2)

            # Algorithm 3: Harmonic-percussive BPM detection
            bpm3 = self._detect_bpm_harmonic_percussive(y, sr, features)
            bpm_results.append(bpm3)

            # Algorithm 4: Multi-scale autocorrelation
            bpm4 = self._detect_bpm_autocorrelation(y, sr, features)
            bpm_results.append(bpm4)

            # Weighted voting for final BPM
            final_bpm = self._weighted_bpm_voting(bpm_results)

            return int(round(final_bpm))

        except Exception as e:
            logger.error(f"BPM detection failed: {str(e)}")
            return 120

    def _detect_bpm_onset_enhanced(self, y, sr, features=None):
        """Enhanced onset-based BPM detection.

        Uses precomputed onset_env_512 from features if available.
        """
        # Use precomputed onset envelope if available
        onset_env = None
        if features and features.get('onset_env_512') is not None:
            onset_env = features['onset_env_512']
        else:
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

    def _detect_bpm_spectral(self, y, sr, features=None):
        """Spectral-based BPM detection using frequency domain analysis.

        Uses precomputed stft_mag and freq_bins from features if available.
        """
        # Use features parameter or fall back to instance features
        feats = features if features else (self._features or {})

        # Compute/reuse spectrogram
        if feats.get('stft_mag') is not None:
            magnitude = feats['stft_mag']
        else:
            stft = librosa.stft(y, hop_length=512, n_fft=2048)
            magnitude = np.abs(stft)

        # Focus on rhythmically important frequency bands
        freq_bins = feats.get('freq_bins')
        if freq_bins is None:
            freq_bins = librosa.fft_frequencies(sr=sr, n_fft=2048)

        # Extract rhythm from bass frequencies
        bass_mask = (freq_bins >= 20) & (freq_bins <= 250)
        bass_energy = np.sum(magnitude[bass_mask], axis=0)

        # Normalize and smooth
        max_bass = np.max(bass_energy)
        if max_bass > 0:
            bass_energy = bass_energy / max_bass
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

    def _detect_bpm_harmonic_percussive(self, y, sr, features=None):
        """BPM detection using harmonic-percussive separation.

        Uses precomputed y_perc and onset_env_perc_512 from features if available.
        """
        # Use features parameter or fall back to instance features
        feats = features if features else (self._features or {})

        # Use precomputed onset envelope on percussive if available
        onset_env = feats.get('onset_env_perc_512')
        if onset_env is None:
            # Fallback: compute HPSS and onset
            y_percussive = feats.get('y_perc')
            if y_percussive is None:
                _, y_percussive = librosa.effects.hpss(y, margin=8.0)
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

    def _detect_bpm_autocorrelation(self, y, sr, features=None):
        """Multi-scale autocorrelation BPM detection.

        Uses precomputed onset_env_256 from features if available.
        """
        # Use features parameter or fall back to instance features
        feats = features if features else (self._features or {})

        # Use precomputed onset envelope at 256 hop if available
        onset_env = feats.get('onset_env_256')
        if onset_env is None:
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
            # Resample onset envelope using FFT-based resampling to avoid bounds errors
            if scale != 1.0:
                target_len = int(max(10, np.floor(len(onset_env) / scale)))
                try:
                    onset_scaled = signal.resample(onset_env, target_len)
                except Exception:
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
        """Robust BPM voting with half/double canonicalization and source priors.

        Expects bpm_results in order: [onset_enhanced, spectral, percussive, autocorrelation].
        Gives strongest weight to percussive (beat-based) estimate and tallies votes for
        candidate BPMs and their half/double where plausible.
        """
        if not bpm_results:
            return 120.0

        # Guard against NaNs/zeros
        bpm_results = [float(b) for b in bpm_results if b and not np.isnan(b)]
        if not bpm_results:
            return 120.0

        # Source reliability weights aligned with append order
        source_weights = [0.25, 0.15, 0.45, 0.15]

        # Vote tally by integer BPM
        tally: Dict[int, float] = {}

        def add_vote(bpm_val: float, idx: int, boost: float = 1.0):
            if 60.0 <= bpm_val <= 200.0:
                key = int(round(bpm_val))
                score = source_weights[min(idx, len(source_weights)-1)] * boost
                tally[key] = tally.get(key, 0.0) + score

        # Add original and plausible half/double candidates
        for i, bpm in enumerate(bpm_results):
            add_vote(bpm, i, 1.0)
            add_vote(bpm * 0.5, i, 0.6)
            add_vote(bpm * 2.0, i, 0.6)

        if not tally:
            return float(int(round(np.median(bpm_results))))

        # Winner by highest accumulated score
        best_bpm_int = max(tally.items(), key=lambda kv: kv[1])[0]

        # Refine around the winner using weighted average of close candidates (±1.5 BPM)
        close_vals = []
        close_wts = []
        for i, bpm in enumerate(bpm_results):
            for mult, boost in ((1.0, 1.0), (0.5, 0.6), (2.0, 0.6)):
                cand = bpm * mult
                if 60.0 <= cand <= 200.0 and abs(cand - best_bpm_int) <= 1.5:
                    close_vals.append(cand)
                    close_wts.append(source_weights[min(i, len(source_weights)-1)] * boost)

        final_bpm = float(best_bpm_int)
        if close_vals:
            try:
                final_bpm = float(np.average(close_vals, weights=close_wts))
            except Exception:
                final_bpm = float(best_bpm_int)

        # Conservative correction and snapping
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
        common_bpms = [90, 95, 100, 110, 115, 118, 120, 122, 124, 125, 126, 127, 128, 129,
                       130, 131, 132, 133, 135, 138, 140, 145, 150]
        
        # Find closest common BPM
        closest_bpm = min(common_bpms, key=lambda x: abs(x - bpm))
        
        # Only snap if very close (within 1.5 BPM)
        if abs(bpm - closest_bpm) <= 1.5:
            return closest_bpm
        
        return bpm

    def detect_genre_and_params(self, bpm: float, energy_data: dict, y: np.ndarray, sr: int):
        """
        Heuristic genre detection and parameter presets for cue detection.
        Returns (genre_name, params_dict).
        """
        try:
            overall_energy = float(energy_data.get('overall_energy', 5.0))
        except Exception:
            overall_energy = 5.0

        try:
            spec_cent = float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=512)[0]))
        except Exception:
            spec_cent = 3000.0

        bpm_val = float(bpm or 120.0)

        # coarse genre rules
        if bpm_val >= 125 and overall_energy >= 6.5:
            genre = 'edm'
        elif 118 <= bpm_val < 125 and overall_energy >= 5.0:
            genre = 'house'
        elif 90 <= bpm_val < 118 and overall_energy >= 4.0 and spec_cent < 3500:
            genre = 'pop'
        elif bpm_val <= 95 and overall_energy <= 5.5:
            genre = 'hiphop'
        else:
            genre = 'chill' if overall_energy < 4.5 else 'pop'

        presets = {
            'edm': {'rms_smooth_window': 31, 'rms_smooth_poly': 3, 'drop_search_start_pct': 0.15, 'phrase_bars': 8, 'min_intro_silence': 1.2, 'peak_threshold_factor': 1.3, 'min_cue_spacing': 12.0},
            'house': {'rms_smooth_window': 29, 'rms_smooth_poly': 3, 'drop_search_start_pct': 0.12, 'phrase_bars': 8, 'min_intro_silence': 1.0, 'peak_threshold_factor': 1.2, 'min_cue_spacing': 12.0},
            'pop': {'rms_smooth_window': 21, 'rms_smooth_poly': 3, 'drop_search_start_pct': 0.08, 'phrase_bars': 16, 'min_intro_silence': 0.8, 'peak_threshold_factor': 1.1, 'min_cue_spacing': 18.0},
            'hiphop': {'rms_smooth_window': 15, 'rms_smooth_poly': 2, 'drop_search_start_pct': 0.05, 'phrase_bars': 16, 'min_intro_silence': 0.6, 'peak_threshold_factor': 1.05, 'min_cue_spacing': 18.0},
            'chill': {'rms_smooth_window': 11, 'rms_smooth_poly': 2, 'drop_search_start_pct': 0.05, 'phrase_bars': 16, 'min_intro_silence': 1.5, 'peak_threshold_factor': 1.0, 'min_cue_spacing': 20.0}
        }

        params = dict(presets.get(genre, presets['pop']))
        # Sanity check: window must be odd and at least 3
        if params['rms_smooth_window'] % 2 == 0:
            params['rms_smooth_window'] -= 1
        params['rms_smooth_window'] = max(3, params['rms_smooth_window'])
        params['genre'] = genre
        return genre, params

    def detect_cue_points_rekordbox_algorithm(self, y, sr, duration, cue_params=None):
        """Cue point detection aligned with energy profile and beats; outputs musically meaningful markers."""
        try:
            bpm, beats, onset_env, onset_times = self._analyze_rhythm(y, sr)

            # Analyze energy (recompute quickly here for tight coupling)
            energy = self._analyze_energy_levels(y, sr)
            energy_profile = energy.get('energy_profile', [])

            # New Pro Engine wrapper (backward compatible)
            cues = self._pro_cue_engine(
                y=y, sr=sr, duration=duration,
                bpm=bpm, beats=beats,
                onset_times=onset_times,
                energy_profile=energy_profile,
                cue_params=cue_params or {}
            )
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
        # Reuse cached onset envelope if available
        if getattr(self, "_features", None) and self._features.get('onset_env_256') is not None:
            onset_env = self._features['onset_env_256']
        else:
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

    def _detect_downbeats(self, y: np.ndarray, sr: int, beats: np.ndarray, bpm: float) -> Tuple[np.ndarray, int]:
        """
        Detect downbeats (first beat of each bar) using bass flux analysis.
        Analyzes spectral flux in bass frequencies to find the actual bar starts.

        Returns:
            Tuple of (downbeat_times, phase_offset)
        """
        if beats is None or len(beats) < 4:
            return np.array([]), 0

        hop = 512
        # Compute spectral flux for low frequencies (bass emphasis for downbeat detection)
        stft = librosa.stft(y, hop_length=hop, n_fft=2048)
        mag = np.abs(stft)
        freq_bins = librosa.fft_frequencies(sr=sr, n_fft=2048)

        # Focus on bass frequencies (20-200 Hz) for kick detection
        bass_mask = (freq_bins >= 20) & (freq_bins <= 200)
        bass_diff = np.maximum(np.diff(mag[bass_mask, :], axis=1), 0)
        bass_flux = np.sum(bass_diff, axis=0)
        bass_flux = ndimage.gaussian_filter1d(bass_flux, sigma=1.5)

        # For each potential 4-beat offset (0, 1, 2, 3), compute average bass energy
        beat_frames = librosa.time_to_frames(beats, sr=sr, hop_length=hop)
        scores = []

        for offset in range(4):
            # Get every 4th beat starting at this offset
            indices = np.arange(offset, len(beat_frames), 4)
            valid_frames = beat_frames[indices]
            valid_frames = valid_frames[(valid_frames >= 0) & (valid_frames < len(bass_flux))]

            if len(valid_frames) > 0:
                avg_flux = np.mean(bass_flux[valid_frames])
                scores.append((offset, avg_flux))

        # Best offset has highest average bass flux (strongest kicks on downbeats)
        best_offset = max(scores, key=lambda x: x[1])[0] if scores else 0

        # Extract downbeats (every 4th beat from best offset)
        downbeat_indices = np.arange(best_offset, len(beats), 4)
        downbeats = beats[downbeat_indices]

        return downbeats, best_offset

    def _detect_phrase_boundaries(
        self,
        y: np.ndarray,
        sr: int,
        downbeats: np.ndarray,
        bpm: float,
        duration: float
    ) -> List[Dict]:
        """
        Detect phrase boundaries at 8, 16, and 32 bar intervals using spectral novelty.
        Uses MFCC-based novelty to validate phrase boundaries.

        Returns:
            List of phrase markers with time, bar_length, and confidence
        """
        if len(downbeats) < 8:
            return []

        hop = 512

        # Compute spectral novelty function using MFCC delta
        mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13, hop_length=hop)
        mfcc_delta = np.sum(np.abs(np.diff(mfcc, axis=1)), axis=0)
        mfcc_delta = ndimage.gaussian_filter1d(mfcc_delta, sigma=3.0)

        # Normalize
        if np.max(mfcc_delta) > 0:
            mfcc_delta = mfcc_delta / np.max(mfcc_delta)

        frame_times = librosa.frames_to_time(np.arange(len(mfcc_delta)), sr=sr, hop_length=hop)

        phrases = []
        bar_lengths = [8, 16, 32]

        for bar_len in bar_lengths:
            # Every bar_len bars is a potential phrase boundary
            for i in range(bar_len, len(downbeats), bar_len):
                if i >= len(downbeats):
                    break

                t = downbeats[i]

                # Skip if too close to start or end
                if t < 5.0 or t > duration - 10.0:
                    continue

                # Find novelty at this point
                frame_idx = np.argmin(np.abs(frame_times - t))

                # Average novelty in a small window around the boundary
                window = 5
                start_idx = max(0, frame_idx - window)
                end_idx = min(len(mfcc_delta), frame_idx + window)
                novelty_score = float(np.mean(mfcc_delta[start_idx:end_idx]))

                # Threshold: higher for longer phrases (they should be more prominent)
                threshold = 0.25 + (bar_len / 150)  # 0.30 for 8-bar, 0.36 for 16-bar, 0.46 for 32-bar

                if novelty_score > threshold:
                    phrases.append({
                        "time": float(t),
                        "bar_length": bar_len,
                        "confidence": float(min(novelty_score * 1.3, 1.0)),
                        "type": f"phrase_{bar_len}bar",
                        "name": f"{bar_len}-Bar",
                        "downbeat_index": i,
                        "spectral_novelty": float(novelty_score)
                    })

        # Remove duplicates (prefer longer phrases at same position)
        phrases.sort(key=lambda p: (p["time"], -p["bar_length"]))

        deduped = []
        for p in phrases:
            if not deduped or abs(p["time"] - deduped[-1]["time"]) > 2.0:
                deduped.append(p)
            elif p["bar_length"] > deduped[-1]["bar_length"]:
                deduped[-1] = p

        # Sort by time
        deduped.sort(key=lambda p: p["time"])

        return deduped

    def _detect_loops(
        self,
        y: np.ndarray,
        sr: int,
        downbeats: np.ndarray,
        bpm: float,
        duration: float
    ) -> List[Dict]:
        """
        Detect potential loop points using spectral self-similarity.
        Finds sections that repeat well when looped (4, 8, 16, 32 bars).

        Returns list of loop markers with:
            - start_time: Loop start in seconds
            - end_time: Loop end in seconds
            - bar_length: Number of bars (4, 8, 16, 32)
            - confidence: How well the section loops (0-1)
        """
        loops = []

        if len(downbeats) < 8 or bpm <= 0:
            return loops

        try:
            # Calculate duration per bar
            seconds_per_beat = 60.0 / bpm
            seconds_per_bar = seconds_per_beat * 4

            # Compute MFCCs for spectral similarity
            hop_length = 512
            n_mfcc = 13
            mfccs = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=n_mfcc, hop_length=hop_length)
            times = librosa.times_like(mfccs, sr=sr, hop_length=hop_length)

            def get_mfcc_segment(start_time, end_time):
                """Extract MFCC features for a time segment."""
                start_idx = np.searchsorted(times, start_time)
                end_idx = np.searchsorted(times, end_time)
                if end_idx <= start_idx:
                    return None
                return mfccs[:, start_idx:end_idx]

            def compute_loop_score(segment_mfcc):
                """Score how well a segment loops (first half vs second half similarity)."""
                if segment_mfcc is None or segment_mfcc.shape[1] < 4:
                    return 0.0
                mid = segment_mfcc.shape[1] // 2
                first_half = segment_mfcc[:, :mid]
                second_half = segment_mfcc[:, mid:mid*2]

                # Ensure same length
                min_len = min(first_half.shape[1], second_half.shape[1])
                if min_len < 2:
                    return 0.0

                first_half = first_half[:, :min_len]
                second_half = second_half[:, :min_len]

                # Cosine similarity between halves
                first_norm = np.linalg.norm(first_half, axis=0, keepdims=True)
                second_norm = np.linalg.norm(second_half, axis=0, keepdims=True)

                # Avoid division by zero
                first_norm = np.where(first_norm == 0, 1, first_norm)
                second_norm = np.where(second_norm == 0, 1, second_norm)

                first_normalized = first_half / first_norm
                second_normalized = second_half / second_norm

                similarity = np.mean(np.sum(first_normalized * second_normalized, axis=0))
                return float(max(0, min(1, similarity)))

            # Check loop points at various bar lengths
            bar_lengths = [4, 8, 16, 32]
            candidates = []

            for bar_len in bar_lengths:
                loop_duration = bar_len * seconds_per_bar

                # Check loops starting at each downbeat
                for i, start_time in enumerate(downbeats):
                    end_time = start_time + loop_duration

                    # Skip if loop extends beyond track
                    if end_time > duration - 1:
                        continue

                    # Skip very short loops at beginning or end
                    if start_time < 2 or end_time > duration - 2:
                        continue

                    # Get spectral features for this segment
                    segment_mfcc = get_mfcc_segment(start_time, end_time)
                    loop_score = compute_loop_score(segment_mfcc)

                    # Threshold based on bar length (longer = stricter)
                    threshold = 0.6 + (bar_len / 100)  # 0.64 for 4-bar, 0.68 for 8-bar, etc.

                    if loop_score > threshold:
                        candidates.append({
                            "start_time": float(start_time),
                            "end_time": float(end_time),
                            "bar_length": bar_len,
                            "confidence": float(loop_score),
                            "type": "loop",
                            "name": f"{bar_len}-Bar Loop"
                        })

            # Remove overlapping loops, prefer longer bars with higher confidence
            candidates.sort(key=lambda l: (-l["bar_length"], -l["confidence"]))

            for candidate in candidates:
                # Check if overlaps with existing loops
                overlaps = False
                for existing in loops:
                    # Check for overlap
                    if (candidate["start_time"] < existing["end_time"] and
                        candidate["end_time"] > existing["start_time"]):
                        overlaps = True
                        break

                if not overlaps:
                    loops.append(candidate)

            # Sort by start time
            loops.sort(key=lambda l: l["start_time"])

            # Limit to top 8 loops
            return loops[:8]

        except Exception as e:
            logger.warning(f"Loop detection failed: {e}")
            return []

    def _detect_cues_aligned(
        self,
        y: np.ndarray,
        sr: int,
        duration: float,
        beats: np.ndarray,
        onset_times: np.ndarray,
        energy_profile: List[dict],
        cue_params: Optional[dict] = None
    ):
        """Modern Cue Intelligence Layer — energy + phrasing–aware cue detection."""
        from scipy.signal import savgol_filter

        cues: List[dict] = []

        # --- 1️⃣ Prepare genre-adaptive parameters ---
        defaults = {
            "rms_smooth_window": 21,
            "rms_smooth_poly": 3,
            "min_intro_silence": 0.8,
            "drop_search_start_pct": 0.08,
            "phrase_bars": 8,
            "min_cue_spacing": 12.0,
        }
        if cue_params is None:
            cue_params = defaults
        else:
            for k, v in defaults.items():
                cue_params.setdefault(k, v)
        win = int(cue_params["rms_smooth_window"])
        poly = int(cue_params["rms_smooth_poly"])

        # --- 2️⃣ Energy envelope + smoothing ---
        hop = 512
        frame_length = 2048
        rms = librosa.feature.rms(y=y, hop_length=hop, frame_length=frame_length)[0]
        rms_times = self._map_frames(len(rms), hop, sr)

        if win >= 3 and len(rms) > win:
            try:
                rms_smooth = savgol_filter(rms, win, poly)
            except Exception:
                rms_smooth = ndimage.gaussian_filter1d(rms, sigma=2.0)
        else:
            rms_smooth = ndimage.gaussian_filter1d(rms, sigma=2.0)

        rms_smooth = np.clip(rms_smooth, 0, None)

        # --- 3️⃣ INTRO FIX: Silence gate + first beat, no 0.00 intro unless agreed by slope+beat ---
        genre = cue_params.get("genre", "pop")
        min_intro_time = float(cue_params.get("min_intro_silence", 0.8))
        intro_detected = False
        # Find silence end = first frame above 1.1 * 20th percentile
        p20 = float(np.percentile(rms_smooth, 20))
        thr = 1.1 * p20
        times_full = self._map_frames(len(rms_smooth), hop, sr)
        idxs = np.where(rms_smooth > thr)[0]
        silence_end_time = float(times_full[idxs[0]]) if len(idxs) > 0 else float(min_intro_time)
        # First beat after silence end, else rising RMS point
        intro_time = float(min_intro_time)
        if beats is not None and len(beats) > 0:
            after = beats[beats > silence_end_time]
            if len(after) > 0:
                intro_time = float(after[0])
                intro_detected = True
        if not intro_detected:
            slope = np.diff(rms_smooth)
            slope_times = self._map_frames(len(slope), hop, sr)
            mask = slope_times > silence_end_time
            if np.any(mask):
                try:
                    sidx = int(np.argmax(slope[mask]))
                    intro_time = float(slope_times[mask][sidx])
                    intro_detected = True
                except Exception:
                    intro_time = float(silence_end_time + 1.0)
            else:
                intro_time = float(silence_end_time + 1.0)
        # Final guard against 0.00 unless beat grid agrees
        if (beats is not None and len(beats) > 0) and (intro_time < 0.3):
            later_beats = beats[beats > 0.3]
            if len(later_beats) > 0:
                intro_time = float(later_beats[0])

        def refine_time_local(t):
            if onset_times is not None and len(onset_times):
                idx = int(np.argmin(np.abs(onset_times - t)))
                t = float(onset_times[idx])
            if beats is not None and len(beats):
                idxb = int(np.argmin(np.abs(beats - t)))
                snapped = float(beats[idxb])
                # Prevent intro snapping to 0.00 unless it's a REAL beat start
                if not (t < 1.0 and snapped < 0.5):
                    t = snapped
            return float(t)

        intro_t = refine_time_local(intro_time)
        cues.append(
            {
                "name": "Intro",
                "time": intro_t,
                "type": "intro",
                "confidence": 0.8 if intro_detected else 0.5,
                "reason": "energy_rise_after_silence",
            }
        )

        # --- 4️⃣ DROP DETECTION: GENRE AWARE ---
        drop_t = intro_t + 8.0  # default fallback
        if genre in ("pop", "chill", "hiphop"):
            if energy_profile and len(energy_profile) > 1:
                deltas = [
                    (i, energy_profile[i]["energy"] - energy_profile[i - 1]["energy"])
                    for i in range(1, len(energy_profile))
                ]
                deltas = [
                    d for d in deltas
                    if energy_profile[d[0]]["start_time"] > intro_time + 4.0
                ]
                if deltas:
                    idx, _ = max(deltas, key=lambda x: x[1])
                    drop_t = refine_time_local(energy_profile[idx]["start_time"])
                else:
                    bpm_local = self._safe_bpm_from_beats(beats)
                    bar_sec = 4.0 * 60.0 / max(1.0, bpm_local)
                    drop_t = refine_time_local(min(intro_t + 16.0 * bar_sec, max(0.0, duration - 12.0)))
            else:
                bpm_local = self._safe_bpm_from_beats(beats)
                bar_sec = 4.0 * 60.0 / max(1.0, bpm_local)
                drop_t = refine_time_local(min(intro_t + 16.0 * bar_sec, max(0.0, duration - 12.0)))
        else:
            energy_peaks = [
                p for p in energy_profile if p.get("energy", 0) >= 7.0
            ] if energy_profile else []
            if energy_peaks:
                candidates = [p for p in energy_peaks if p.get("start_time", 0) > 5.0]
                peak = max(candidates, key=lambda x: x["energy"]) if candidates else energy_peaks[0]
                drop_t = refine_time_local(peak.get("start_time", 0.0))
            else:
                # Reuse cached onset envelope if available
                if getattr(self, "_features", None) and self._features.get('onset_env_perc_512') is not None:
                    onset_env = self._features['onset_env_perc_512']
                else:
                    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
                onset_env = librosa.util.normalize(onset_env)
                diff_env = np.diff(onset_env)
                start_idx = int(len(diff_env) * cue_params.get("drop_search_start_pct", 0.08))
                if len(diff_env) > start_idx:
                    peak_idx = int(np.argmax(diff_env[start_idx:]) + start_idx)
                    drop_t = refine_time_local(librosa.frames_to_time(peak_idx, sr=sr, hop_length=hop))
                else:
                    bpm_local = self._safe_bpm_from_beats(beats)
                    bar_sec = 4.0 * 60.0 / max(1.0, bpm_local)
                    drop_t = refine_time_local(min(intro_t + 16.0 * bar_sec, max(0.0, duration - 12.0)))

        cues.append(
            {
                "name": "Drop",
                "time": drop_t,
                "type": "drop",
                "confidence": 0.9,
                "reason": "energy_peak_or_onset_rise",
            }
        )

        # --- 5️⃣ Breakdown (valley after drop) ---
        energy_valleys = [
            v for v in energy_profile if v.get("energy", 0) <= 4.0
        ] if energy_profile else []
        valley = next((v for v in energy_valleys if v.get("start_time", 0) > drop_t), None)
        if valley:
            bd_time = refine_time_local(valley["start_time"])
            if bd_time >= intro_t + 4.0:
                cues.append(
                    {
                        "name": "Breakdown",
                        "time": bd_time,
                        "type": "breakdown",
                        "confidence": 0.7,
                        "reason": "energy_valley_after_drop",
                    }
                )

        # --- Chorus & Hook Detection ---
        chorus_t, hook_t = self._detect_chorus_hook(y, sr, beats, hop)
        try:
            if chorus_t is not None and intro_t < chorus_t < (outro_t if 'outro_t' in locals() else duration):
                cues.append({
                    "name": "Chorus",
                    "time": refine_time_local(float(chorus_t)),
                    "type": "chorus",
                    "confidence": 0.8,
                    "reason": "harmonic_centroid_spectral_contrast_peak"
                })
            if hook_t is not None and (chorus_t is None or hook_t > chorus_t) and hook_t < (outro_t if 'outro_t' in locals() else duration):
                cues.append({
                    "name": "Hook",
                    "time": refine_time_local(float(hook_t)),
                    "type": "hook",
                    "confidence": 0.8,
                    "reason": "spectral_contrast_vocal_intensity_peak"
                })
        except Exception:
            pass

        # --- Compute Outro BEFORE vocal layer ---
        outro_seg = next(
            (s for s in (energy_profile or []) if str(s.get("name", "")).lower().startswith("outro")),
            None,
        )
        if outro_seg is not None:
            outro_t = refine_time_local(outro_seg.get("start", outro_seg.get("start_time", duration * 0.9)))
        else:
            bpm_local = self._safe_bpm_from_beats(beats)
            bar_sec = 4.0 * 60.0 / max(1.0, bpm_local)
            outro_t = refine_time_local(min(max(0.0, duration - 8.0 * bar_sec), max(0.0, duration - 12.0)))

        # Enforce drop window relative to intro/outro; recompute if conflicted
        try:
            allowed_start = float(intro_t + 4.0)
            allowed_end = float(outro_t - 8.0) if outro_t is not None else float(max(intro_t + 8.0, duration - 12.0))
            if not (drop_t > allowed_start and drop_t < allowed_end):
                candidate = None
                # (a) harmonic tension peaks from cached harmonic signal if available
                try:
                    y_harm = self._features.get("y_harm") if getattr(self, "_features", None) else None
                    if y_harm is not None and len(y_harm) > 0:
                        chroma = librosa.feature.chroma_cqt(y=y_harm, sr=sr, hop_length=512, bins_per_octave=36, n_chroma=12)
                        if chroma.shape[1] > 1:
                            chroma_flux = np.sqrt(np.sum(np.diff(chroma, axis=1) ** 2, axis=0))
                            chroma_times = self._map_frames(len(chroma_flux), 512, sr)
                            peaks, _ = signal.find_peaks(chroma_flux, height=np.percentile(chroma_flux, 80), distance=max(1, int(sr/512*2)))
                            if len(peaks) > 0:
                                hp = chroma_times[peaks]
                                in_window = hp[(hp > allowed_start) & (hp < allowed_end)]
                                if len(in_window) > 0:
                                    candidate = float(in_window[0])
                except Exception:
                    pass
                # (b) energy_slope peaks after intro + 4s using RMS slope
                if candidate is None:
                    try:
                        slope = np.diff(rms_smooth)
                        midx = (np.arange(len(slope)) + 0.5)
                        slope = np.diff(rms_smooth)
                        slope_times = self._map_frames(len(slope), hop, sr)
                        mask = (slope_times > allowed_start) & (slope_times < allowed_end)
                        if np.any(mask):
                            idx = int(np.argmax(slope[mask]))
                            cand_times = slope_times[mask]
                            candidate = float(cand_times[idx])
                    except Exception:
                        candidate = None
                # (c) strongest onset rise (beat-aligned later)
                if candidate is None:
                    try:
                        onset_env2 = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
                        odiff = np.diff(librosa.util.normalize(onset_env2))
                        odiff_times = self._map_frames(len(odiff), hop, sr)
                        mask = (odiff_times > allowed_start) & (odiff_times < allowed_end)
                        if np.any(mask):
                            idx = int(np.argmax(odiff[mask]))
                            candidate = float(odiff_times[mask][idx])
                    except Exception:
                        candidate = None
                if candidate is not None:
                    drop_t = refine_time_local(candidate)
            # Safety clamps
            if drop_t <= intro_t + 2.0:
                drop_t = intro_t + 4.0
            if outro_t is not None and drop_t >= outro_t - 4.0:
                drop_t = max(intro_t + 4.0, outro_t - 8.0)
            drop_t = refine_time_local(drop_t)
        except Exception:
            pass
        # Ensure the previously appended Drop cue reflects the final refined drop_t
        try:
            for c in cues:
                if c.get("type") == "drop":
                    # Only update if time differs meaningfully
                    if abs(float(c.get("time", 0.0)) - float(drop_t)) > 1e-3:
                        c["time"] = float(drop_t)
                        c["reason"] = "window_enforced_refined"
                    break
        except Exception:
            pass

        # --- STEP 8: VOCAL INTELLIGENCE LAYER (MFCC × FORMANTS × FLUX × ONSET) ---
        try:
            vocal_cues = []

            mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=20, hop_length=512)
            mfcc_vel = np.sum(np.abs(np.diff(mfcc, axis=1)), axis=0)
            mfcc_vel = ndimage.gaussian_filter1d(mfcc_vel, sigma=2.8)
            mfcc_times = self._map_frames(len(mfcc_vel), 512, sr)

            # Reuse precomputed STFT magnitude/frequency bins when available
            mag = None
            freqs = None
            if getattr(self, "_features", None):
                mag = self._features.get("stft_mag")
                freqs = self._features.get("freq_bins")
            if mag is None:
                stft = librosa.stft(y, n_fft=2048, hop_length=512)
                mag = np.abs(stft)
            if freqs is None:
                freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
            formant_mask = (freqs >= 700) & (freqs <= 3000)
            formant_energy = np.sum(mag[formant_mask, :], axis=0)
            formant_energy = ndimage.gaussian_filter1d(formant_energy, sigma=4.0)
            formant_energy = formant_energy / (np.max(formant_energy) + 1e-9)

            diff = np.diff(mag, axis=1)
            flux = np.sqrt(np.sum(np.maximum(diff, 0)**2, axis=0))
            flux = ndimage.gaussian_filter1d(flux, sigma=3.0)
            flux = flux / (np.max(flux) + 1e-9)

            activation = (
                (mfcc_vel / np.max(mfcc_vel)) * 0.45 +
                formant_energy * 0.35 +
                flux * 0.20
            )
            act_norm = activation / (np.max(activation) + 1e-9)

            bpm_local = self._safe_bpm_from_beats(beats)
            bpm_local = bpm_local if bpm_local > 0 else 120
            min_dist = max(1, int((60 / bpm_local) * (sr / 512)))

            vocal_peaks, _ = signal.find_peaks(
                act_norm,
                height=np.percentile(act_norm, 82),
                distance=min_dist,
            )

            for i, pk in enumerate(vocal_peaks[:4]):
                t = float((pk * 512) / float(sr))
                t = refine_time_local(t)
                if t < intro_t + 2.0:
                    continue
                if t > duration - 12:
                    continue

                vocal_cues.append({
                    "name": f"Vocal {i+1}",
                    "time": t,
                    "type": "vocal",
                    "confidence": 0.78,
                    "reason": "combined_vocal_gate",
                })

            cleaned = []
            for vc in vocal_cues:
                if abs(vc["time"] - drop_t) < 5.0:
                    continue
                if outro_t is not None and abs(vc["time"] - outro_t) < 8.0:
                    continue
                cleaned.append(vc)

            cues.extend(cleaned)

        except Exception:
            pass

        # --- 6️⃣ Outro (last 10 % of track or energy-profile outro) ---
        cues.append(
            {
                "name": "Outro",
                "time": outro_t,
                "type": "outro",
                "confidence": 0.8,
                "reason": "energy_fade_or_profile_outro",
            }
        )

        # --- 7️⃣ Phrase grouping (8–16 bars per genre) ---
        bpm_val = self._safe_bpm_from_beats(beats)
        if bpm_val > 0:
            sec_per_bar = 4 * 60.0 / bpm_val
            phrase_len = cue_params.get("phrase_bars", 8) * sec_per_bar
            for i, t in enumerate(np.arange(intro_t + phrase_len, duration, phrase_len)):
                if i >= 2:
                    break
                # Only add phrases when safely between intro and outro
                if t <= intro_t + 8.0:
                    continue
                if outro_t is not None and t >= (outro_t - 8.0):
                    continue
                cues.append(
                    {
                        "name": f"Phrase {i+1}",
                        "time": refine_time_local(t),
                        "type": "phrase",
                        "confidence": 0.6,
                        "reason": "bar_grid_phrase_marker",
                    }
                )

        # --- 8️⃣ Clean-up + sort ---
        cues = sorted(cues, key=lambda c: c["time"])

        # --- NEW: GLOBAL TIME CLAMP ---
        def _clamp_time(t):
            if not isinstance(t, (int, float)):
                return 0.0
            if t < 0.0:
                return 0.0
            if t > duration:
                return max(0.0, duration - 0.01)
            return float(t)

        for c in cues:
            c["time"] = _clamp_time(c.get("time", 0.0))

        # --- NEW: BREAKDOWN SAFETY FILTER ---
        safe_cues = []
        for c in cues:
            if c["type"] == "breakdown":
                if c["time"] <= intro_t + 4.0:
                    continue
                if c["time"] <= drop_t:
                    continue
                if c["time"] >= duration - 12.0:
                    continue
            safe_cues.append(c)
        cues = safe_cues

        seen = []
        pruned = []
        for c in cues:
            if any(abs(c["time"] - x["time"]) < cue_params["min_cue_spacing"] for x in pruned):
                continue
            pruned.append(c)
        return pruned

    def _postprocess_cue_confidence(self, cues: List[dict], energy_profile: List[dict], duration: float, sr: int):
        """
        Step 4 - AI-Aware Confidence & Rationale Enrichment
        Adds confidence tiers and rationale explanations to cues.
        """
        enriched = []
        if not cues:
            return enriched

        avg_energy = np.mean([s.get("energy", 5.0) for s in energy_profile]) if energy_profile else 5.0
        total_cues = len(cues)
        duration_mid = duration * 0.5

        for cue in cues:
            t = float(cue.get("time", 0.0))
            cue_type = cue.get("type", "unknown").lower()

            # --- Confidence tuning ---
            base_conf = cue.get("confidence", 0.7)
            if cue_type == "intro" and t < 2.0:
                base_conf *= 0.8  # too early
            if cue_type == "drop" and 0.15 * duration < t < 0.75 * duration:
                base_conf *= 1.1
            if cue_type == "outro" and t > 0.8 * duration:
                base_conf *= 1.05

            # --- Rationale inference ---
            reason = cue.get("reason", "")
            if cue_type == "intro":
                reason = "silence_to_energy_rise_transition"
            elif cue_type == "drop":
                reason = "main_energy_peak" if avg_energy >= 6.0 else "localized_energy_peak"
            elif cue_type == "breakdown":
                reason = "energy_valley_after_drop"
            elif cue_type == "phrase":
                reason = "structured_8bar_phrase_marker"
            elif cue_type == "outro":
                reason = "final_energy_decay"

            # --- Tier classification ---
            tier = "optional"
            if cue_type in ("intro", "drop", "outro"):
                tier = "primary"
            elif cue_type in ("breakdown", "chorus"):
                tier = "secondary"

            enriched.append({
                **cue,
                "confidence": float(np.clip(base_conf, 0.3, 1.0)),
                "reason": reason,
                "tier": tier,
            })

        # --- Harmonic Cue Adjustment Layer ---
        try:
            y_harm = None
            if getattr(self, "_features", None) and sr:
                y_harm = self._features.get("y_harm")
            energy_segments: List[Tuple[float, float, float]] = []
            for seg in energy_profile or []:
                start = float(seg.get("start", seg.get("start_time", 0.0)))
                end = float(seg.get("end", seg.get("end_time", start)))
                if end <= start:
                    end = start + 0.01
                energy_val = float(seg.get("energy", seg.get("energy_level", 0.0)))
                energy_segments.append((start, end, energy_val))
            energy_segments.sort(key=lambda x: x[0])

            max_time = duration - 0.01 if duration > 0.01 else duration

            def clamp_time(val: float) -> float:
                return float(max(0.0, min(max_time, val)))

            def energy_slope(time_val: float) -> Optional[float]:
                if not energy_segments:
                    return None
                idx = None
                for i, (start, end, _) in enumerate(energy_segments):
                    if start <= time_val <= end:
                        idx = i
                        break
                if idx is None:
                    idx = 0 if time_val < energy_segments[0][0] else len(energy_segments) - 1
                current = energy_segments[idx][2]
                prev_val = energy_segments[idx - 1][2] if idx > 0 else current
                next_val = energy_segments[idx + 1][2] if idx < len(energy_segments) - 1 else current
                return abs(next_val - prev_val)

            harmonic_points = None
            chroma_flux = None
            chroma_times = None
            if y_harm is not None and len(y_harm) > 0 and sr:
                chroma = librosa.feature.chroma_cqt(
                    y=y_harm, sr=sr, hop_length=512, bins_per_octave=36, n_chroma=12
                )
                if chroma.shape[1] > 1:
                    chroma_flux = np.sqrt(np.sum(np.diff(chroma, axis=1) ** 2, axis=0))
                    chroma_times = librosa.frames_to_time(
                        np.arange(len(chroma_flux)), sr=sr, hop_length=512
                    )
                    harm_peaks, _ = signal.find_peaks(
                        chroma_flux,
                        height=np.percentile(chroma_flux, 80),
                        distance=max(1, int(sr / 512 * 2)),
                    )
                    harmonic_points = chroma_times[harm_peaks] if len(harm_peaks) else np.array([])

            if harmonic_points is not None and len(harmonic_points):
                harmonic_points = np.array(harmonic_points, dtype=float)
                for c in enriched:
                    if c["type"] != "drop":
                        continue
                    base_time = float(c["time"])
                    idx = int(np.argmin(np.abs(harmonic_points - base_time)))
                    harmonic_time = float(harmonic_points[idx])
                    diff = abs(harmonic_time - base_time)
                    if diff <= 1.5:
                        harmonic_time = clamp_time(harmonic_time)
                        c["time"] = harmonic_time
                        c["reason"] = "harmonic_tension_peak"
                        boost = 0.15 if diff <= 0.5 else 0.05
                        c["confidence"] = float(min(1.0, c["confidence"] * (1.0 + boost)))
                    elif diff <= 3.0:
                        c["confidence"] = float(min(1.0, c["confidence"] * 1.05))

            if chroma_flux is not None and len(chroma_flux) and chroma_times is not None:
                flux_thresh = np.percentile(chroma_flux, 35)
                low_idxs = np.where(chroma_flux < flux_thresh)[0]
                for c in enriched:
                    if c["type"] != "intro" or not len(low_idxs):
                        continue
                    candidate_time = clamp_time(float(chroma_times[low_idxs[0]]))
                    if candidate_time >= c["time"]:
                        continue
                    slope = energy_slope(candidate_time)
                    if slope is not None and slope > 0.8:
                        continue
                    c["time"] = candidate_time
                    c["reason"] = "harmonic_stable_region"
                    c["confidence"] = float(min(1.0, c["confidence"] * 1.05))
        except Exception:
            pass

        # Ensure cues are sorted and consistent
        enriched.sort(key=lambda c: c["time"])
        return enriched

    def _balance_and_humanize_cues(self, cues: List[dict], genre: str, duration: float):
        """
        Step 5 - Adaptive Cue Balancing Engine
        Makes cue spacing, count, and naming dynamic based on genre, BPM, and structure.
        """
        if not cues:
            return cues

        # --- 1️⃣ Genre-based spacing rules ---
        genre_spacing = {
            'edm': 6.0,
            'house': 6.0,
            'pop': 6.0,
            'hiphop': 6.0,
            'chill': 6.0,
        }
        min_spacing = genre_spacing.get(genre, 6.0)

        # --- 2️⃣ Filter by confidence tiers ---
        filtered = []
        for c in cues:
            conf = c.get("confidence", 0.7)
            tier = c.get("tier", "optional")
            if c.get('type') in ('intro','drop','outro'):
                filtered.append(c)
                continue
            if conf < 0.50 and tier == "optional":
                continue
            filtered.append(c)

        # --- 3️⃣ Humanize cue naming ---
        for c in filtered:
            t = c["time"]
            name = c["name"].lower()
            if "phrase" in name:
                c["name"] = f"Bridge {int((t / duration) * 5) + 1}"
            elif c["type"] == "drop" and t < duration * 0.3:
                c["name"] = "Early Drop"
            elif c["type"] == "drop" and t > duration * 0.7:
                c["name"] = "Final Drop"
            elif c["type"] == "breakdown":
                c["name"] = "Breakdown"
            elif c["type"] == "outro":
                c["name"] = "Mix Out"
            elif c["type"] == "intro":
                c["name"] = "Mix In"

        # --- 4️⃣ De-cluster cues too close together ---
        balanced = []
        for c in filtered:
            if not balanced or abs(c["time"] - balanced[-1]["time"]) >= min_spacing:
                balanced.append(c)

        # --- 5️⃣ Dynamic cue limit by track length ---
        max_cues = 5
        if duration > 300:
            max_cues = 8
        elif duration < 120:
            max_cues = 4
        if len(balanced) > max_cues:
            # Keep high-confidence + primary first
            balanced.sort(key=lambda x: (x["tier"] != "primary", -x.get("confidence", 0)))
            balanced = sorted(balanced[:max_cues], key=lambda x: x["time"])

        return balanced

    # --- Pro DJ Cue Engine (wrapper using improved pipeline) ---
    def _pro_cue_engine(
        self,
        y: np.ndarray,
        sr: int,
        duration: float,
        bpm: float,
        beats: np.ndarray,
        onset_times: np.ndarray,
        energy_profile: List[dict],
        cue_params: dict
    ) -> List[dict]:
        """Generate Professional DJ Cue Pack using the modernized pipeline while preserving API shape."""
        try:
            # 1) Core detection
            raw_cues = self._detect_cues_aligned(y, sr, duration, beats, onset_times, energy_profile, cue_params=cue_params)
            # 2) Harmonic/AI confidence layer
            enriched = self._postprocess_cue_confidence(raw_cues, energy_profile, duration, sr)
            # 3) Basic filter/sort (legacy but safe)
            filtered = self._filter_and_sort_cues(enriched, duration)
            # 4) Adaptive balance and naming normalization
            genre = cue_params.get('genre', 'pop')
            balanced = self._balance_and_humanize_cues(filtered, genre, duration)
            # 5) Global sanitization and Pro DJ pack mapping
            pro_pack = self._map_to_pro_dj_cue_pack(balanced, duration)
            return pro_pack
        except Exception:
            # Fall back to a minimal safe set
            return [
                {'name': 'Mix In', 'time': 0.0, 'type': 'intro'},
                {'name': 'Mix Out', 'time': max(0.0, duration - 30.0), 'type': 'outro'}
            ]

    def _map_to_pro_dj_cue_pack(self, cues: List[dict], duration: float) -> List[dict]:
        """Map internal cue types to the Professional DJ Cue Pack with sanitization."""
        if not cues:
            return cues

        # Clamp times globally
        def clamp(t: float) -> float:
            if not isinstance(t, (int, float)):
                return 0.0
            if t < 0.0:
                return 0.0
            if t > duration:
                return max(0.0, duration - 0.01)
            return float(t)

        # Identify drop(s) for 'Final Drop' naming
        drop_times = [c['time'] for c in cues if c.get('type') == 'drop']
        last_drop_t = max(drop_times) if drop_times else None

        pro: List[dict] = []
        vocal_idx = 1
        phrase_idx = 1
        # Precompute key anchors
        first_drop_t = min(drop_times) if drop_times else None
        sorted_cues = sorted(cues, key=lambda x: x['time'])
        for c in sorted_cues:
            t = clamp(c.get('time', 0.0))
            ctype = c.get('type', '')
            cname = c.get('name', '')

            # Map names/types to Pro DJ vocabulary
            if ctype == 'intro':
                name = 'Mix In'
                out_type = 'intro'
            elif ctype == 'outro':
                name = 'Mix Out'
                out_type = 'outro'
            elif ctype == 'drop':
                if last_drop_t is not None and abs(t - last_drop_t) <= 6.0 and t > duration * 0.6:
                    name = 'Final Drop'
                else:
                    name = 'Drop'
                    out_type = 'drop'
            elif ctype in ('breakdown',):
                name = 'Breakdown'
                out_type = 'breakdown'
            elif ctype in ('buildup', 'rise'):
                name = 'Build'
                out_type = 'build'
            elif ctype in ('chorus',):
                name = 'Chorus'
                out_type = 'chorus'
            elif ctype in ('hook',):
                name = 'Hook'
                out_type = 'hook'
            elif ctype in ('section', 'phrase'):
                # Only include strong phrases
                if c.get('confidence', 0.0) >= 0.60 and (8.0 < t < duration - 12.0):
                    if phrase_idx <= 2:
                        name = f'Phrase {phrase_idx}'
                        phrase_idx += 1
                        out_type = 'phrase'
                    else:
                        continue
                else:
                    continue
            elif ctype in ('vocal',):
                # Smart naming based on sorted order and drop reference
                cname_lower = (cname or '').strip().lower()
                # Explicit detector names can be overridden by the smart policy per requirement
                if first_drop_t is None:
                    # No drop reference: first vocal -> Verse, later -> Hook N
                    if vocal_idx == 1:
                        name = 'Verse'
                    else:
                        name = f'Hook {vocal_idx-1}'
                else:
                    if t <= first_drop_t - 4.0:
                        # Well before drop
                        name = 'Verse'
                    elif first_drop_t - 4.0 < t <= first_drop_t:
                        name = 'Pre-Chorus'
                    elif t > first_drop_t and vocal_idx == 1:
                        name = 'Chorus'
                    else:
                        name = f'Hook {vocal_idx-1}'
                vocal_idx += 1
                out_type = 'vocal'
            else:
                # Keep as-is for unknowns but clamp time
                name = cname or 'Cue'
                out_type = ctype or 'cue'

            pro.append({
                'name': name,
                'time': t,
                'type': out_type,
                'confidence': float(c.get('confidence', 0.7)),
                'reason': c.get('reason', '')
            })

        # Final sanitization: ensure Mix In and Mix Out present
        has_intro = any(pc['type'] == 'intro' for pc in pro)
        has_outro = any(pc['type'] == 'outro' for pc in pro)
        if not has_intro:
            pro.insert(0, {'name': 'Mix In', 'time': 0.0, 'type': 'intro', 'confidence': 0.8, 'reason': 'fallback'})
        if not has_outro:
            pro.append({'name': 'Mix Out', 'time': max(0.0, duration - 30.0), 'type': 'outro', 'confidence': 0.8, 'reason': 'fallback'})

        # De-duplicate by time proximity (keep highest confidence)
        final: List[dict] = []
        for cue in sorted(pro, key=lambda x: (x['time'], -x.get('confidence', 0.0))):
            if final and abs(cue['time'] - final[-1]['time']) < 2.0:
                if cue.get('confidence', 0.0) > final[-1].get('confidence', 0.0):
                    final[-1] = cue
                continue
            final.append(cue)

        # Keep a reasonable maximum for UI while preserving required anchors
        MAX_CUES = 12
        if len(final) > MAX_CUES:
            anchors = [c for c in final if c['type'] in ('intro', 'drop', 'outro')]
            others = [c for c in final if c['type'] not in ('intro', 'drop', 'outro')]
            others = sorted(others, key=lambda x: (-x.get('confidence', 0.0), x['time']))[:MAX_CUES - len(anchors)]
            final = sorted(anchors + others, key=lambda x: x['time'])
        
        # Ensure essential cues exist where possible
        has_drop = any(c['type'] == 'drop' for c in final)
        if not has_drop and drop_times:
            first_drop = min(drop_times)
            final.append({'name': 'Drop', 'time': clamp(first_drop), 'type': 'drop', 'confidence': 0.8, 'reason': 'fallback'})
        has_vocal = any(c['type'] == 'vocal' for c in final)
        first_vocal = next((c for c in cues if c.get('type')=='vocal'), None)
        if not has_vocal and first_vocal:
            final.append({'name': 'Verse', 'time': clamp(first_vocal.get('time', 0.0)), 'type': 'vocal', 'confidence': 0.75, 'reason': 'fallback'})
        # Final Drop if late drop exists
        if drop_times:
            last_drop = max(drop_times)
            if last_drop > duration * 0.6 and not any(c['name'] == 'Final Drop' for c in final):
                final.append({'name': 'Final Drop', 'time': clamp(last_drop), 'type': 'drop', 'confidence': 0.8, 'reason': 'fallback'})
        final = sorted(final, key=lambda x: x['time'])
        return final

    def _safe_bpm_from_beats(self, beats: np.ndarray) -> float:
        if beats is None or len(beats) < 2:
            return 120.0
        return float(60.0 / np.median(np.diff(beats)))

    def _map_frames(self, arr_len, hop, sr):
        return librosa.frames_to_time(np.arange(arr_len), sr=sr, hop_length=hop)

    def _detect_chorus_hook(self, y, sr, beats, hop):
        """
        Returns: (chorus_t, hook_t) or (None, None)
        Using harmonic centroid motion + spectral contrast + novelty curve.
        """
        try:
            # A) Harmonic component
            y_harm, y_perc = librosa.effects.hpss(y)

            # B) Harmonic centroid motion
            centroid = librosa.feature.spectral_centroid(y=y_harm, sr=sr, hop_length=hop)[0]
            try:
                centroid_smooth = signal.savgol_filter(centroid, 31, 3)
            except Exception:
                centroid_smooth = ndimage.gaussian_filter1d(centroid, sigma=3.0)
            centroid_diff = np.abs(np.diff(centroid_smooth))
            centroid_times = self._map_frames(len(centroid_smooth), hop, sr)

            # C) Spectral contrast
            contrast = librosa.feature.spectral_contrast(y=y, sr=sr, hop_length=hop)
            contrast_energy = np.mean(contrast, axis=0)
            try:
                contrast_smooth = signal.savgol_filter(contrast_energy, 31, 3)
            except Exception:
                contrast_smooth = ndimage.gaussian_filter1d(contrast_energy, sigma=3.0)

            # D) Novelty curve
            novelty = np.abs(np.diff(contrast_smooth))
            novelty_times = self._map_frames(len(novelty), hop, sr)

            # Normalize curves to combine
            def _norm(x):
                x = np.asarray(x, dtype=float)
                mn = float(np.min(x)) if x.size else 0.0
                mx = float(np.max(x)) if x.size else 0.0
                rng = (mx - mn) if (mx - mn) > 1e-9 else 1.0
                return (x - mn) / rng

            n = int(min(len(centroid_diff), len(contrast_smooth)-1 if len(contrast_smooth)>1 else 0, len(novelty)))
            if n <= 8:
                return (None, None)
            cdiffN = _norm(centroid_diff[:n])
            cEngN = _norm(contrast_smooth[1:1+n])
            novN = _norm(novelty[:n])
            score = (cdiffN + cEngN + 0.6 * novN)
            if not np.any(np.isfinite(score)):
                return (None, None)
            # E) Chorus candidates after ~20s
            score_times = self._map_frames(n, hop, sr)
            peaks, props = signal.find_peaks(score, height=0.65 * (np.max(score) if np.size(score) else 1.0))
            if peaks.size == 0:
                return (None, None)
            chorus_t = None
            min_time = 20.0
            for p in peaks:
                t = float(score_times[p])
                if t > min_time:
                    chorus_t = t
                    break
            if chorus_t is None:
                return (None, None)

            # F) Hook candidates = strongest peak after chorus
            after_idx = peaks[score_times[peaks] > chorus_t]
            hook_t = None
            if after_idx.size > 0:
                # choose the one with highest score
                best_i = int(after_idx[np.argmax(score[after_idx])])
                hook_t = float(score_times[best_i])

            # G) Beat alignment to next/nearest beat forward
            def _snap_forward(t):
                if beats is None or len(beats) == 0:
                    return float(t)
                future = beats[beats >= t]
                if len(future) == 0:
                    # fallback to nearest beat
                    idx = int(np.argmin(np.abs(beats - t)))
                    return float(beats[idx])
                return float(future[0])

            chorus_t = _snap_forward(chorus_t) if chorus_t is not None else None
            hook_t = _snap_forward(hook_t) if hook_t is not None else None
            return (chorus_t, hook_t)
        except Exception:
            return (None, None)
    # Removed legacy detection helpers no longer used by Pro DJ Cue Engine

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
        # Slightly reduce spacing to surface more cues in UI
        min_spacing = 12.0 if song_complexity > 2 else 18.0
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
        # Populate a richer default set so UI shows >2 cues even on failure
        base_bpm = 120.0
        bar_seconds = 60.0 / base_bpm * 4.0
        mid = max(30.0, duration * 0.5)
        return [
            {'name': 'Mix In', 'time': 0.0, 'type': 'intro'},
            {'name': 'Vocal Entry', 'time': min(mid - 2 * bar_seconds, max(8.0, duration * 0.15)), 'type': 'vocal'},
            {'name': 'Drop', 'time': min(mid, duration * 0.6), 'type': 'drop'},
            {'name': 'Chorus', 'time': min(mid + bar_seconds, duration * 0.65), 'type': 'chorus'},
            {'name': 'Breakdown', 'time': min(duration * 0.75, duration - 90.0), 'type': 'breakdown'},
            {'name': 'Mix Out', 'time': max(duration * 0.7, duration - 60.0), 'type': 'outro'}
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

    def analyze_quick(self, file_path):
        """
        Quick analysis for library browsing - BPM, key, and waveform only.
        ~5x faster than full analysis by skipping cue detection, energy analysis, and pipeline stages.
        """
        try:
            start_time = time.time()

            # Load audio
            y, sr, duration = self.load_audio(file_path)

            # Generate waveform data for visualization
            waveform_data = self._generate_waveform_data(y, sr)

            # Detect key and BPM in parallel (the essentials for library browsing)
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                future_key = executor.submit(self.detect_key_rekordbox_algorithm, y, sr, None)
                future_bpm = executor.submit(self.detect_bpm_rekordbox_algorithm, y, sr, None)

                camelot_key, mode, key_conf = future_key.result()
                bpm = int(round(future_bpm.result()))

            elapsed = time.time() - start_time
            logger.info(f"Quick analysis completed in {elapsed:.2f}s")

            return {
                'file_path': file_path,
                'duration': duration,
                'sample_rate': sr,
                'waveform_data': waveform_data,
                'key': camelot_key,
                'key_mode': mode,
                'key_confidence': float(key_conf),
                'bpm': bpm,
                'quick_mode': True,
                'analysis_ms': int(elapsed * 1000),
                'analysis_timestamp': time.time()
            }

        except Exception as e:
            logger.error(f"Quick analysis failed: {str(e)}")
            return {
                'error': str(e),
                'file_path': file_path,
                'quick_mode': True
            }

    def analyze_audio(self, file_path):
        """Main analysis function that processes audio and returns comprehensive results."""
        try:
            start_time = time.time()
            # Unified, robust loading
            y, sr, duration = self.load_audio(file_path)
            
            # Precompute shared features BEFORE pipeline for reuse across all stages
            # This eliminates duplicate HPSS, beat tracking, and spectral computations
            self._features = self._precompute_features(y, sr)
            
            # --- Run Modular Cue Pipeline ---
            pipeline_result = {"cues": [], "beatgrid": [], "stages": {}}
            # Guard against recursive invocation when called from pipeline analyzer_stage
            import os as _os_guard
            if _CuePipeline is not None and _os_guard.environ.get("MIXEDIN_PIPELINE_ACTIVE") != "1":
                try:
                    pipeline = _CuePipeline()
                    # Pass audio buffer AND pre-computed features to pipeline stages
                    # This avoids redundant IO, resampling, and heavy DSP in stages.
                    pipeline_result = pipeline.run(file_path, y=y, sr=sr, features=self._features)
                except TypeError:
                     # Fallback for old calls or if pipeline doesn't support features yet
                     try:
                         pipeline_result = pipeline.run(file_path, y=y, sr=sr)
                     except TypeError:
                         pipeline_result = pipeline.run(file_path)
                except Exception as e:
                    pipeline_result = {
                        "cues": [],
                        "beatgrid": [],
                        "stages": {},
                        "error": f"pipeline_failed: {e}"
                    }

            # Generate waveform data for visualization
            waveform_data = self._generate_waveform_data(y, sr)
            audio_stats = self._calculate_audio_stats(y, sr)

            # Basic audio analysis
            # Parallelize independent heavy tasks - pass precomputed features to avoid redundant DSP
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
                future_key = executor.submit(self.detect_key_rekordbox_algorithm, y, sr, self._features)
                future_bpm = executor.submit(self.detect_bpm_rekordbox_algorithm, y, sr, self._features)
                future_energy = executor.submit(self._analyze_energy_levels, y, sr, self._features)
                future_structure = executor.submit(self.detect_song_structure_rekordbox_algorithm, y, sr, duration)

                camelot_key, mode, key_conf = future_key.result()
                bpm = int(round(future_bpm.result()))
                # Compute energy early to drive genre presets
                energy_analysis = future_energy.result()
                song_structure = future_structure.result()

            # Determine genre and cue detection parameters
            genre, cue_params = self.detect_genre_and_params(bpm, energy_analysis, y, sr)

            # --- Phrase Detection (8/16/32 bars) ---
            # Use beat grid from pipeline or compute from features
            beats = np.array(pipeline_result.get("beatgrid", []))
            if len(beats) < 4 and self._features and 'beat_times' in self._features:
                beats = np.array(self._features.get('beat_times', []))

            # Detect downbeats, phrase boundaries, and loops
            downbeats = np.array([])
            phrase_markers = []
            loop_markers = []
            if len(beats) >= 8 and bpm > 0:
                try:
                    downbeats, phase_offset = self._detect_downbeats(y, sr, beats, float(bpm))
                    phrase_markers = self._detect_phrase_boundaries(y, sr, downbeats, float(bpm), duration)
                    loop_markers = self._detect_loops(y, sr, downbeats, float(bpm), duration)
                    logger.info(f"Detected {len(downbeats)} downbeats, {len(phrase_markers)} phrase markers, {len(loop_markers)} loops")
                except Exception as e:
                    logger.warning(f"Phrase/loop detection failed: {e}")

            # If pipeline already found intro/outro, prefer them
            pipeline_intro = any((str(c.get("type", "")).lower() == "intro") for c in pipeline_result.get("cues", []))
            pipeline_outro = any((str(c.get("type", "")).lower() == "outro") for c in pipeline_result.get("cues", []))
            # Provide hints to internal detector (safe no-op if unused)
            try:
                if isinstance(cue_params, dict):
                    cue_params = dict(cue_params)
                    cue_params["skip_intro"] = bool(pipeline_intro)
                    cue_params["skip_outro"] = bool(pipeline_outro)
            except Exception:
                pass
            # Cue detection with params
            cue_points = self.detect_cue_points_rekordbox_algorithm(y, sr, duration, cue_params=cue_params)
            # Drop analyzer intro/outro if pipeline provided them to avoid duplication
            try:
                if pipeline_intro:
                    cue_points = [c for c in (cue_points or []) if str(c.get("type", "")).lower() != "intro"]
                if pipeline_outro:
                    cue_points = [c for c in (cue_points or []) if str(c.get("type", "")).lower() != "outro"]
            except Exception:
                pass

            # Advanced analysis modules (can be heavy; add short-circuit for long files)
            # Make energy profile align with shown cue points for UI consistency
            try:
                energy_profile_cue_aligned = self._energy_profile_from_cues(y, sr, float(bpm or 120.0), float(duration), cue_points)
                if energy_profile_cue_aligned:
                    energy_analysis['energy_profile'] = energy_profile_cue_aligned
            except Exception:
                # Keep original profile on failure
                pass
            harmonic_mixing = self._analyze_harmonic_mixing(camelot_key)
            advanced_mixing = self._analyze_advanced_mixing(camelot_key, energy_analysis.get('energy_level', 5))

            # Compile results
            analysis = {
                'file_path': file_path,
                'duration': duration,
                'sample_rate': sr,
                'waveform_data': waveform_data,
                'audio_stats': audio_stats,
                'key': camelot_key,
                'key_mode': mode,
                'key_confidence': float(key_conf),
                'bpm': bpm,
                'cue_points': cue_points,
                'song_structure': song_structure,
                'structure': song_structure,  # alias for compatibility with tests/clients
                'energy_analysis': energy_analysis,
                'genre': genre,
                'cue_detection_params': cue_params,
                'harmonic_mixing': harmonic_mixing,
                'advanced_mixing': advanced_mixing,
                'phrase_markers': phrase_markers,
                'loop_markers': loop_markers,
                'downbeats': downbeats.tolist() if hasattr(downbeats, 'tolist') else list(downbeats),
                'analysis_timestamp': time.time()
            }

            elapsed = time.time() - start_time
            logger.info(
                f"Analysis completed in {elapsed:.2f}s | Threads: "
                f"numba={THREAD_INFO['NUMBA_NUM_THREADS']}, openblas={THREAD_INFO['OPENBLAS_NUM_THREADS']}, omp={THREAD_INFO['OMP_NUM_THREADS']}"
            )
            # Attach diagnostics for UI/exports if needed
            analysis['analysis_ms'] = int(elapsed * 1000)
            analysis['threads'] = {
                'numba': THREAD_INFO['NUMBA_NUM_THREADS'],
                'openblas': THREAD_INFO['OPENBLAS_NUM_THREADS'],
                'omp': THREAD_INFO['OMP_NUM_THREADS']
            }
            # --- Merge Pipeline + Analyzer Cues ---
            def _sanitize(cues):
                out = []
                for c in cues or []:
                    try:
                        out.append({
                            "name": str(c.get("name", c.get("type", "cue"))),
                            "type": str(c.get("type", "cue")).lower(),
                            "time": float(c.get("time", 0.0)),
                            "confidence": float(c.get("confidence", 0.6)),
                            "reason": str(c.get("reason", "")),
                            "source": c.get("stage", "analyzer")
                        })
                    except Exception:
                        continue
                return out

            pipeline_cues = _sanitize(pipeline_result.get("cues"))
            analyzer_cues = _sanitize(analysis.get("cue_points"))

            # combine
            merged = pipeline_cues + analyzer_cues
            merged.sort(key=lambda x: x["time"])

            # remove duplicates (same type + ~same time)
            seen = set()
            final = []
            for c in merged:
                key = (c["type"], round(c["time"], 2))
                if key not in seen:
                    seen.add(key)
                    final.append(c)

            analysis["cues"] = final
            analysis["cue_points"] = final
            analysis["beatgrid"] = pipeline_result.get("beatgrid", [])
            analysis["pipeline"] = pipeline_result
            analysis["hotcues"] = pipeline_result.get("hotcues", [])

            # Mix quality scorecard
            try:
                import sys
                import os
                sys.path.append(os.path.join(os.path.dirname(__file__), 'tools'))
                from mix_scorecard import build_mix_scorecard
                analysis["mix_scorecard"] = build_mix_scorecard(analysis)
            except Exception as e:
                analysis["mix_scorecard"] = {"error": str(e)}

            # Auto-embed analysis results to file tags (ID3/MP4/FLAC)
            try:
                from tools.id3_tagger import ID3Tagger
                tagger = ID3Tagger()
                tag_result = tagger.write_tags(
                    file_path=file_path,
                    key=f"{camelot_key}",
                    bpm=float(bpm),
                    energy=int(energy_analysis.get('energy_level', 5)),
                    camelot=camelot_key,
                    cue_points=analysis.get('cue_points', [])[:8]
                )
                analysis["tags_written"] = tag_result
                logger.info(f"Embedded tags to file: {tag_result}")
            except ImportError:
                analysis["tags_written"] = {"status": "skipped", "reason": "mutagen not installed"}
            except Exception as e:
                analysis["tags_written"] = {"status": "error", "error": str(e)}
                logger.warning(f"Failed to write ID3 tags: {e}")

            return analysis

        except Exception as e:
            logger.error(f"analyze_audio failed: {e}")
            return None

    def _precompute_features(self, y: np.ndarray, sr: int) -> Dict[str, np.ndarray]:
        """Compute and cache heavy features reused by multiple algorithms.

        This method precomputes all expensive DSP features once to avoid redundant
        computation across key detection, BPM detection, and energy analysis.
        """
        feats: Dict[str, np.ndarray] = {}

        # ========== HPSS (Harmonic-Percussive Separation) ==========
        # Used by: key detection (harmonic), BPM detection (percussive)
        try:
            y_harm, y_perc = librosa.effects.hpss(y, margin=8.0)
            feats['y_harm'] = y_harm
            feats['y_perc'] = y_perc
        except Exception:
            feats['y_harm'] = y
            feats['y_perc'] = y

        # ========== STFT ==========
        # Used by: spectral BPM detection, energy analysis
        try:
            stft = librosa.stft(y, hop_length=512, n_fft=2048)
            feats['stft_mag'] = np.abs(stft)
            feats['freq_bins'] = librosa.fft_frequencies(sr=sr, n_fft=2048)
        except Exception:
            feats['stft_mag'] = None
            feats['freq_bins'] = None

        # ========== Multi-Resolution Chromagrams ==========
        # Used by: key detection (all 5 methods need different hop lengths)
        hop_lengths = [256, 512, 1024, 2048]
        for hop in hop_lengths:
            try:
                chroma = librosa.feature.chroma_cqt(
                    y=y, sr=sr,
                    hop_length=hop,
                    bins_per_octave=36,
                    n_chroma=12,
                    norm=2
                )
                feats[f'chroma_{hop}'] = chroma
            except Exception:
                feats[f'chroma_{hop}'] = None

        # ========== Harmonic Chromagram ==========
        # Used by: HPSS key detection, beat-synchronous key detection
        try:
            chroma_harm = librosa.feature.chroma_cqt(
                y=feats['y_harm'], sr=sr,
                hop_length=512,
                bins_per_octave=36,
                n_chroma=12,
                norm=2
            )
            feats['chroma_harm_512'] = chroma_harm

            # Also at 1024 for HPSS method
            chroma_harm_1024 = librosa.feature.chroma_cqt(
                y=feats['y_harm'], sr=sr,
                hop_length=1024,
                bins_per_octave=36,
                n_chroma=12,
                norm=2
            )
            feats['chroma_harm_1024'] = chroma_harm_1024
        except Exception:
            feats['chroma_harm_512'] = None
            feats['chroma_harm_1024'] = None

        # ========== Spectral Centroids (for multiresolution weighting) ==========
        # Used by: multiresolution key detection weighting
        for hop in hop_lengths:
            try:
                centroid = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=hop)[0]
                feats[f'spectral_centroid_{hop}'] = centroid
            except Exception:
                feats[f'spectral_centroid_{hop}'] = None

        # ========== Onset Envelopes ==========
        # Used by: BPM detection (multiple methods)
        try:
            feats['onset_env_256'] = librosa.onset.onset_strength(
                y=y, sr=sr, hop_length=256, aggregate=np.mean
            )
            feats['onset_env_512'] = librosa.onset.onset_strength(
                y=y, sr=sr, hop_length=512, aggregate=np.median
            )
            feats['onset_env_perc_512'] = librosa.onset.onset_strength(
                y=feats['y_perc'], sr=sr, hop_length=512, aggregate=np.median
            )
        except Exception:
            feats['onset_env_256'] = None
            feats['onset_env_512'] = None
            feats['onset_env_perc_512'] = None

        # ========== MFCC ==========
        # Used by: structure detection, energy analysis
        try:
            feats['mfcc_512'] = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13, hop_length=512)
        except Exception:
            feats['mfcc_512'] = None

        # ========== Beat Tracking ==========
        # Used by: beat-synchronous key detection, cue detection, energy alignment
        try:
            tempo, beat_frames = librosa.beat.beat_track(
                y=y, sr=sr, hop_length=512, units='frames', trim=False
            )
            beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=512)
            feats['beat_times'] = beat_times
            feats['beat_frames'] = beat_frames
            feats['tempo'] = float(tempo if np.size(tempo) == 1 else tempo[0])
        except Exception:
            feats['beat_times'] = None
            feats['beat_frames'] = None
            feats['tempo'] = None

        # ========== RMS Energy ==========
        # Used by: energy analysis, windowed key detection
        try:
            feats['rms_512'] = librosa.feature.rms(y=y, hop_length=512)[0]
            feats['rms_1024'] = librosa.feature.rms(y=y, hop_length=1024)[0]
        except Exception:
            feats['rms_512'] = None
            feats['rms_1024'] = None

        # ========== Tuning Estimation ==========
        # Used by: chroma-enhanced key detection
        try:
            feats['tuning'] = float(librosa.estimate_tuning(y=y, sr=sr))
        except Exception:
            feats['tuning'] = 0.0

        # Store sample rate for reference
        feats['sr'] = sr

        return feats

    def _energy_profile_from_cues(self, y: np.ndarray, sr: int, bpm: float, duration: float, cue_points: List[dict]) -> List[Dict[str, float]]:
        """Compute an energy profile aligned to cue points so the bar count matches cues.

        For each cue, measure energy over a fixed musical window (default 8 bars) starting at the cue time.
        Energy is computed via RMS and then normalized across cues to a 1-10 scale for readability.
        """
        if not cue_points or bpm <= 0 or duration <= 0:
            return []

        # Determine analysis window: 8 bars capped between 8s and 30s
        beats_per_bar = 4.0
        bars = 8.0
        window_seconds = bars * beats_per_bar * (60.0 / max(bpm, 1.0))
        window_seconds = float(min(30.0, max(8.0, window_seconds)))

        segments: List[Dict[str, float]] = []
        rms_values: List[float] = []

        # Sort cues by time; keep to a reasonable maximum for UI
        cues_sorted = sorted([c for c in cue_points if 'time' in c], key=lambda c: c['time'])[:16]

        for c in cues_sorted:
            # Clamp cue window start strictly within track duration
            start_t = float(max(0.0, min(c['time'], duration)))
            # Ensure end_t never exceeds duration and never precedes start_t
            end_t = float(max(start_t, min(duration, start_t + window_seconds)))
            if end_t - start_t < 0.5:
                continue
            start_i = int(start_t * sr)
            end_i = int(end_t * sr)
            seg = y[start_i:end_i]
            if seg.size == 0:
                continue
            # RMS energy
            rms = float(np.sqrt(np.mean(np.square(seg))))
            segments.append({
                'name': c.get('name', 'Cue'),
                'start_time': start_t,
                'end_time': end_t,
                'energy': rms  # temp - normalized below
            })
            rms_values.append(rms)

        if not segments:
            return []

        # Normalize RMS across cues to a readable 1-10 scale (robust percentile scaling)
        scores = np.array(rms_values, dtype=float)
        p5, p95 = np.percentile(scores, [5, 95])
        if p95 > p5:
            norm = (scores - p5) / (p95 - p5)
        else:
            norm = np.zeros_like(scores)
        norm = np.clip(norm, 0.0, 1.0)
        for i in range(len(segments)):
            segments[i]['energy'] = round(1.0 + float(norm[i]) * 9.0, 2)

        return segments

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

    def _calculate_audio_stats(self, y: np.ndarray, sr: int = 22050) -> Dict[str, float]:
        """Compute peak/RMS/LUFS stats for headroom and gain matching."""
        try:
            if y.size == 0:
                return {
                    "peak": 0.0, "rms": 0.0, "peak_dbfs": None, "rms_dbfs": None,
                    "crest_db": None, "lufs": None, "gain_to_target": None
                }
            peak = float(np.max(np.abs(y)))
            rms = float(np.sqrt(np.mean(np.square(y))))

            def to_dbfs(val: float) -> Optional[float]:
                if val <= 0:
                    return None
                return float(20.0 * math.log10(val))

            peak_dbfs = to_dbfs(peak)
            rms_dbfs = to_dbfs(rms)
            crest_db = None
            if peak_dbfs is not None and rms_dbfs is not None:
                crest_db = peak_dbfs - rms_dbfs

            # Calculate integrated loudness (LUFS) using pyloudnorm
            lufs = None
            gain_to_target = None
            TARGET_LUFS = -14.0  # Standard streaming/DJ target
            try:
                import pyloudnorm as pyln
                meter = pyln.Meter(sr)
                # pyloudnorm expects shape (samples,) or (samples, channels)
                if y.ndim == 1:
                    lufs = meter.integrated_loudness(y)
                else:
                    lufs = meter.integrated_loudness(y.T)

                if lufs is not None and not np.isinf(lufs) and not np.isnan(lufs):
                    lufs = round(float(lufs), 1)
                    # Calculate gain adjustment needed to reach target LUFS
                    gain_to_target = round(TARGET_LUFS - lufs, 1)
                else:
                    lufs = None
            except ImportError:
                logger.debug("pyloudnorm not installed, skipping LUFS calculation")
            except Exception as e:
                logger.debug(f"LUFS calculation failed: {e}")

            return {
                "peak": peak,
                "rms": rms,
                "peak_dbfs": None if peak_dbfs is None else round(peak_dbfs, 2),
                "rms_dbfs": None if rms_dbfs is None else round(rms_dbfs, 2),
                "crest_db": None if crest_db is None else round(crest_db, 2),
                "lufs": lufs,
                "gain_to_target": gain_to_target,
                "target_lufs": TARGET_LUFS
            }
        except Exception:
            return {
                "peak": 0.0, "rms": 0.0, "peak_dbfs": None, "rms_dbfs": None,
                "crest_db": None, "lufs": None, "gain_to_target": None
            }

    def _analyze_energy_levels(self, y, sr, features=None):
        """Analyze energy levels using the energy analysis module.

        Args:
            y: Audio time series
            sr: Sample rate
            features: Optional precomputed features dict from _precompute_features()
        """
        try:
            import sys
            import os
            sys.path.append(os.path.join(os.path.dirname(__file__), 'tools'))
            from energy_analysis import EnergyAnalyzer
            energy_analyzer = EnergyAnalyzer()
            # Pass features to energy analyzer if it supports them
            try:
                return energy_analyzer.analyze_energy_level(y, sr, features=features)
            except TypeError:
                # Fallback if energy analyzer doesn't support features parameter
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

    def analyze_batch_parallel(self, file_paths: List[str], progress_callback=None) -> List[Dict]:
        """
        Analyze multiple files in parallel using ThreadPoolExecutor.
        Each file runs on a separate thread.
        
        Args:
            file_paths: List of file paths to analyze
            progress_callback: Optional callback function(current, total, current_file_path)
        
        Returns:
            List of dicts with 'file_path', 'analysis', and optionally 'error'
        """
        results = []
        total = len(file_paths)
        files_to_process = []
        
        # Initialize cache manager
        cache_manager = CacheManager()
        
        # Check cache first
        for path in file_paths:
            cached_analysis = cache_manager.get(path)
            if cached_analysis:
                logger.info(f"Using cached analysis for {path}")
                results.append({
                    'file_path': path,
                    'analysis': cached_analysis
                })
                if progress_callback:
                    progress_callback(len(results), total, path)
            else:
                files_to_process.append(path)
        
        if not files_to_process:
            return results
            
        # Limit concurrent workers to avoid overwhelming system
        # Use fewer workers for large batches to prevent memory issues
        cpu_count = os.cpu_count() or 4
        
        # Adaptive worker count based on remaining files
        num_remaining = len(files_to_process)
        if num_remaining > 20:
            max_workers = min(2, cpu_count)  # Very conservative for large batches
        elif num_remaining > 5:
            max_workers = min(4, cpu_count)  # Moderate for medium batches
        else:
            max_workers = min(num_remaining, cpu_count, 4)  # Cap at 4 workers max
        
        logger.info(f"Batch analysis: {num_remaining} files to process (cached: {len(results)}), using {max_workers} workers")
        
        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
                # Submit all tasks
                future_to_path = {
                    executor.submit(self.analyze_audio, path): path 
                    for path in files_to_process
                }
                
                # Process completed tasks as they finish
                for future in concurrent.futures.as_completed(future_to_path):
                    path = future_to_path[future]
                    try:
                        result = future.result(timeout=300)  # 5 minute timeout per file
                        
                        # Cache successful results
                        if result:
                            cache_manager.set(path, result)
                            
                        results.append({
                            'file_path': path,
                            'analysis': result
                        })
                        if progress_callback:
                            progress_callback(len(results), total, path)
                    except concurrent.futures.TimeoutError:
                        logger.error(f"Analysis timeout for {path}")
                        results.append({
                            'file_path': path,
                            'analysis': None,
                            'error': 'Analysis timeout (exceeded 5 minutes)'
                        })
                        if progress_callback:
                            progress_callback(len(results), total, path)
                    except Exception as e:
                        logger.error(f"Analysis failed for {path}: {e}")
                        import traceback
                        logger.debug(f"Traceback: {traceback.format_exc()}")
                        results.append({
                            'file_path': path,
                            'analysis': None,
                            'error': str(e)
                        })
                        if progress_callback:
                            progress_callback(len(results), total, path)
        except Exception as e:
            logger.error(f"Batch analysis executor failed: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            # Return partial results if any were collected
            if not results:
                raise
        
        return results

def main():
    """Main entry point for command line usage."""
    import argparse

    parser = argparse.ArgumentParser(description='Mixed In AI Audio Analyzer')
    parser.add_argument('file_path', help='Path to the audio file to analyze')
    parser.add_argument('--quick', action='store_true',
                        help='Quick mode: BPM/key only, ~5x faster (skips cue detection)')

    args = parser.parse_args()

    logger.info("Starting audio analyzer...")
    logger.info(f"Processing file: {args.file_path}")
    logger.info(f"Quick mode: {args.quick}")

    if not os.path.exists(args.file_path):
        logger.error(f"File does not exist: {args.file_path}")
        print(json.dumps({
            'error': 'FILE_NOT_FOUND',
            'message': f'File {args.file_path} does not exist'
        }))
        sys.exit(1)

    try:
        logger.info("Initializing AudioAnalyzer...")
        analyzer = AudioAnalyzer()

        if args.quick:
            analysis = analyzer.analyze_quick(args.file_path)
        else:
            analysis = analyzer.analyze_audio(args.file_path)

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
        print(json.dumps({
            'error': 'ANALYSIS_EXCEPTION',
            'message': str(e)
        }))
        sys.exit(1)

if __name__ == "__main__":
    main() 
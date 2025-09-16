"""
Advanced Rhythm Analysis Module
Provides enhanced BPM detection and beat tracking using multiple algorithms.
"""

import numpy as np
import librosa
from typing import Tuple, Dict, List, Optional

class RhythmAnalyzer:
    def __init__(self):
        self.sample_rate = 44100
        self.hop_length = 512
        
    def detect_bpm_librosa(self, y: np.ndarray, sr: int) -> Tuple[float, np.ndarray]:
        """Detect BPM using Librosa's tempo detection."""
        try:
            # Use librosa's beat tracking
            tempo, beats = librosa.beat.beat_track(y=y, sr=sr)
            return tempo, beats
        except Exception as e:
            raise Exception(f"Librosa BPM detection failed: {str(e)}")
    
    def detect_bpm_essentia(self, y: np.ndarray, sr: int) -> Tuple[float, np.ndarray]:
        """Detect BPM using Librosa's enhanced rhythm extraction."""
        try:
            # Use Librosa's beat tracking with enhanced parameters
            tempo, beats = librosa.beat.beat_track(y=y, sr=sr, hop_length=512)
            
            # Calculate BPM from beat intervals for more accuracy
            if len(beats) > 1:
                beat_intervals = np.diff(beats)
                bpm_from_intervals = 60.0 / np.median(beat_intervals)
                # Weighted average
                final_bpm = (tempo * 0.7 + bpm_from_intervals * 0.3)
            else:
                final_bpm = tempo
            
            return float(final_bpm), beats
        except Exception as e:
            raise Exception(f"Librosa BPM detection failed: {str(e)}")
    
    def detect_bpm_madmom(self, y: np.ndarray, sr: int) -> Tuple[float, np.ndarray]:
        """Detect BPM using Librosa's alternative beat tracking."""
        try:
            # Use Librosa's beat tracking with different parameters
            tempo, beats = librosa.beat.beat_track(y=y, sr=sr, hop_length=256)
            
            # Calculate BPM from beat intervals
            if len(beats) > 1:
                beat_intervals = np.diff(beats)
                bpm = 60.0 / np.median(beat_intervals)
            else:
                # Fallback to librosa
                bpm, _ = self.detect_bpm_librosa(y, sr)
            
            return float(bpm), beats
        except Exception as e:
            raise Exception(f"Librosa alternative BPM detection failed: {str(e)}")
    
    def detect_bpm_hybrid(self, y: np.ndarray, sr: int) -> Tuple[float, np.ndarray]:
        """Hybrid BPM detection using multiple methods."""
        try:
            # Get results from all methods
            librosa_bpm, librosa_beats = self.detect_bpm_librosa(y, sr)
            essentia_bpm, essentia_beats = self.detect_bpm_essentia(y, sr)
            madmom_bpm, madmom_beats = self.detect_bpm_madmom(y, sr)
            
            # Weighted average of BPM values
            bpm_weights = [0.4, 0.4, 0.2]  # Librosa, Essentia, Madmom
            bpm_values = [librosa_bpm, essentia_bpm, madmom_bpm]
            
            # Filter out outliers
            bpm_array = np.array(bpm_values)
            bpm_std = np.std(bpm_array)
            bpm_mean = np.mean(bpm_array)
            
            # Remove values more than 2 std devs from mean
            valid_indices = np.abs(bpm_array - bpm_mean) <= 2 * bpm_std
            
            if np.sum(valid_indices) >= 2:
                filtered_bpms = bpm_array[valid_indices]
                filtered_weights = np.array(bpm_weights)[valid_indices]
                # Normalize weights
                filtered_weights = filtered_weights / np.sum(filtered_weights)
                final_bpm = np.sum(filtered_bpms * filtered_weights)
            else:
                # Use median if too many outliers
                final_bpm = np.median(bpm_array)
            
            # Use the most reliable beat track
            beat_tracks = [librosa_beats, essentia_beats, madmom_beats]
            track_lengths = [len(bt) for bt in beat_tracks]
            best_track_idx = np.argmax(track_lengths)
            final_beats = beat_tracks[best_track_idx]
            
            return round(final_bpm), final_beats
            
        except Exception as e:
            # Fallback to librosa
            return self.detect_bpm_librosa(y, sr)
    
    def detect_downbeats(self, y: np.ndarray, sr: int) -> np.ndarray:
        """Detect downbeats (first beat of each bar)."""
        try:
            # Use Librosa's beat tracking and estimate downbeats
            _, beats = self.detect_bpm_librosa(y, sr)
            if len(beats) > 0:
                # Assume 4/4 time signature, take every 4th beat
                downbeats = beats[::4]
                return downbeats
            else:
                return np.array([])
        except Exception as e:
            # Fallback: estimate downbeats from regular beats
            _, beats = self.detect_bpm_librosa(y, sr)
            if len(beats) > 0:
                # Assume 4/4 time signature, take every 4th beat
                downbeats = beats[::4]
                return downbeats
            else:
                return np.array([])
    
    def analyze_rhythm_confidence(self, y: np.ndarray, sr: int) -> Dict:
        """Detailed rhythm analysis with confidence metrics."""
        try:
            # Get hybrid BPM detection
            bpm, beats = self.detect_bpm_hybrid(y, sr)
            
            # Get individual method results
            librosa_bpm, librosa_beats = self.detect_bpm_librosa(y, sr)
            essentia_bpm, essentia_beats = self.detect_bpm_essentia(y, sr)
            madmom_bpm, madmom_beats = self.detect_bpm_madmom(y, sr)
            
            # Calculate BPM agreement
            bpm_values = [librosa_bpm, essentia_bpm, madmom_bpm]
            bpm_std = np.std(bpm_values)
            bpm_agreement = 1.0 / (1.0 + bpm_std)  # Higher agreement = lower std
            
            # Get downbeats
            downbeats = self.detect_downbeats(y, sr)
            
            # Calculate beat regularity
            if len(beats) > 1:
                beat_intervals = np.diff(beats)
                beat_regularity = 1.0 / (1.0 + np.std(beat_intervals))
            else:
                beat_regularity = 0.0
            
            # Convert beats to list safely
            beats_list = beats.tolist() if hasattr(beats, 'tolist') else list(beats)
            downbeats_list = downbeats.tolist() if hasattr(downbeats, 'tolist') else list(downbeats)
            
            return {
                'bpm': bpm,
                'beats': beats_list,
                'downbeats': downbeats_list,
                'confidence': {
                    'bpm_agreement': bpm_agreement,
                    'beat_regularity': beat_regularity,
                    'overall': (bpm_agreement + beat_regularity) / 2
                },
                'methods': {
                    'librosa': {'bpm': librosa_bpm, 'beats': len(librosa_beats)},
                    'essentia': {'bpm': essentia_bpm, 'beats': len(essentia_beats)},
                    'madmom': {'bpm': madmom_bpm, 'beats': len(madmom_beats)}
                }
            }
            
        except Exception as e:
            raise Exception(f"Rhythm analysis failed: {str(e)}")
    
    def detect_time_signature(self, y: np.ndarray, sr: int) -> Dict:
        """Detect time signature using beat patterns."""
        try:
            # Get downbeats and regular beats
            downbeats = self.detect_downbeats(y, sr)
            _, beats = self.detect_bpm_hybrid(y, sr)
            
            if len(downbeats) < 2 or len(beats) < 4:
                return {'numerator': 4, 'denominator': 4, 'confidence': 0.5}
            
            # Count beats between downbeats
            beat_counts = []
            for i in range(len(downbeats) - 1):
                start_time = downbeats[i]
                end_time = downbeats[i + 1]
                
                # Count beats in this bar
                bar_beats = np.sum((beats >= start_time) & (beats < end_time))
                beat_counts.append(bar_beats)
            
            # Most common beat count is likely the time signature
            if beat_counts:
                from collections import Counter
                beat_counter = Counter(beat_counts)
                most_common_beats = beat_counter.most_common(1)[0][0]
                
                # Common time signatures
                time_signatures = {
                    2: (2, 4), 3: (3, 4), 4: (4, 4), 6: (6, 8), 8: (8, 8)
                }
                
                numerator, denominator = time_signatures.get(most_common_beats, (4, 4))
                confidence = beat_counter.most_common(1)[0][1] / len(beat_counts)
                
                return {
                    'numerator': numerator,
                    'denominator': denominator,
                    'confidence': confidence,
                    'beat_counts': beat_counts
                }
            else:
                return {'numerator': 4, 'denominator': 4, 'confidence': 0.5}
                
        except Exception as e:
            return {'numerator': 4, 'denominator': 4, 'confidence': 0.5} 
"""
Advanced Key Detection Module
Provides enhanced key detection with Camelot wheel mapping and confidence scoring.
"""

import numpy as np
import librosa
from typing import Tuple, Dict, List

class KeyDetector:
    def __init__(self):
        # Camelot mapping (industry standard): A = minor, B = major
        self.camelot_wheel = {
            # Major (B)
            'C': '8B', 'C#': '3B', 'D': '10B', 'D#': '5B', 'E': '12B', 'F': '7B',
            'F#': '2B', 'G': '9B', 'G#': '4B', 'A': '11B', 'A#': '6B', 'B': '1B',
            # Minor (A)
            'c': '5A', 'c#': '12A', 'd': '7A', 'd#': '2A', 'e': '9A', 'f': '4A',
            'f#': '11A', 'g': '6A', 'g#': '1A', 'a': '8A', 'a#': '3A', 'b': '10A'
        }
        
        # Display names with A=minor, B=major
        self.key_names = {
            '1A': 'A♭ Minor', '2A': 'E♭ Minor', '3A': 'B♭ Minor', '4A': 'F Minor',
            '5A': 'C Minor', '6A': 'G Minor', '7A': 'D Minor', '8A': 'A Minor',
            '9A': 'E Minor', '10A': 'B Minor', '11A': 'F♯ Minor', '12A': 'C♯ Minor',
            '1B': 'B Major', '2B': 'F♯ Major', '3B': 'D♭ Major', '4B': 'A♭ Major',
            '5B': 'E♭ Major', '6B': 'B♭ Major', '7B': 'F Major', '8B': 'C Major',
            '9B': 'G Major', '10B': 'D Major', '11B': 'A Major', '12B': 'E Major'
        }
    
    def detect_key_essentia(self, y: np.ndarray, sr: int) -> Tuple[str, str, float]:
        """Chroma + Krumhansl profiling for mode and key with confidence."""
        try:
            chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=512)
            chroma_mean = np.mean(chroma, axis=1)
            chroma_vec = chroma_mean / (np.linalg.norm(chroma_mean) + 1e-8)

            major_profile = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
            minor_profile = np.array([6.33, 2.68, 3.69, 5.38, 2.60, 3.67, 2.58, 4.95, 2.63, 3.71, 3.28, 3.73])
            major_profile /= np.linalg.norm(major_profile)
            minor_profile /= np.linalg.norm(minor_profile)
            key_names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

            best = (None, None, -1.0)
            for i in range(12):
                corr_M = float(np.dot(chroma_vec, np.roll(major_profile, i)))
                corr_m = float(np.dot(chroma_vec, np.roll(minor_profile, i)))
                if corr_M > best[2]:
                    best = (key_names[i], 'major', corr_M)
                if corr_m > best[2]:
                    best = (key_names[i].lower(), 'minor', corr_m)

            pitch, mode, conf = best
            camelot_key = self.camelot_wheel.get(pitch, pitch)
            return camelot_key, mode, conf
        except Exception as e:
            raise Exception(f"Key detection failed: {str(e)}")
    
    def detect_key_librosa(self, y: np.ndarray, sr: int) -> Tuple[str, str, float]:
        """Simpler chroma peak method as backup."""
        try:
            # Extract chromagram
            chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
            
            # Simple key detection based on chroma peaks
            chroma_mean = np.mean(chroma, axis=1)
            key_idx = np.argmax(chroma_mean)
            
            # Map to key names
            key_names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
            key = key_names[key_idx]
            mode = 'major'  # fallback
            
            # Convert to Camelot format
            camelot_key = self.camelot_wheel.get(key, key)
            
            # Calculate confidence based on chroma strength
            confidence = float(np.mean(chroma.max(axis=1)))
            
            return camelot_key, mode, confidence
        except Exception as e:
            raise Exception(f"Librosa key detection failed: {str(e)}")
    
    def detect_key_hybrid(self, y: np.ndarray, sr: int) -> Tuple[str, str, float]:
        """Hybrid key detection using multiple methods."""
        try:
            # Get results from both methods
            essentia_key, essentia_scale, essentia_strength = self.detect_key_essentia(y, sr)
            librosa_key, librosa_mode, librosa_confidence = self.detect_key_librosa(y, sr)
            
            # If both methods agree, use higher confidence
            if essentia_key == librosa_key:
                if essentia_strength > librosa_confidence:
                    return essentia_key, essentia_scale, essentia_strength
                else:
                    return librosa_key, librosa_mode, librosa_confidence
            
            # If they disagree, use the one with higher confidence
            if essentia_strength > librosa_confidence:
                return essentia_key, essentia_scale, essentia_strength
            else:
                return librosa_key, librosa_mode, librosa_confidence
                
        except Exception as e:
            # Fallback to Librosa
            return self.detect_key_librosa(y, sr)
    
    def get_key_display_name(self, camelot_key: str) -> str:
        """Get human-readable key name from Camelot format."""
        return self.key_names.get(camelot_key, camelot_key)
    
    def get_compatible_keys(self, key: str) -> List[str]:
        """Get harmonically compatible keys (adjacent on Camelot wheel)."""
        if key not in self.camelot_wheel.values():
            return []
        
        # Parse key number and mode
        key_num = int(key[:-1])
        key_mode = key[-1]
        
        # Adjacent keys on the wheel
        compatible = []
        
        # Same mode, adjacent numbers
        for offset in [-1, 1]:
            adj_num = ((key_num - 1 + offset) % 12) + 1
            compatible.append(f"{adj_num}{key_mode}")
        
        # Parallel key (same number, different mode)
        other_mode = 'B' if key_mode == 'A' else 'A'
        compatible.append(f"{key_num}{other_mode}")
        
        return compatible
    
    def analyze_key_confidence(self, y: np.ndarray, sr: int) -> Dict:
        """Detailed key analysis with confidence metrics."""
        try:
            # Get hybrid detection
            key, scale, confidence = self.detect_key_hybrid(y, sr)
            
            # Get individual method results
            essentia_key, essentia_scale, essentia_strength = self.detect_key_essentia(y, sr)
            librosa_key, librosa_mode, librosa_confidence = self.detect_key_librosa(y, sr)
            
            # Calculate agreement
            methods_agree = essentia_key == librosa_key
            
            return {
                'final_key': key,
                'final_scale': scale,
                'confidence': confidence,
                'methods_agree': methods_agree,
                'essentia_result': {
                    'key': essentia_key,
                    'scale': essentia_scale,
                    'strength': essentia_strength
                },
                'librosa_result': {
                    'key': librosa_key,
                    'mode': librosa_mode,
                    'confidence': librosa_confidence
                },
                'compatible_keys': self.get_compatible_keys(key),
                'display_name': self.get_key_display_name(key)
            }
            
        except Exception as e:
            raise Exception(f"Key analysis failed: {str(e)}") 
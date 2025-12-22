"""
Harmonic Mixing Module
Provides tools for harmonic mixing using the Camelot wheel system.
Enables DJs to find compatible keys for seamless transitions.
"""

import numpy as np
from typing import Dict, List, Tuple, Optional
from enum import Enum

class MixingTechnique(Enum):
    """Different harmonic mixing techniques."""
    SAME_KEY = "same_key"
    RELATIVE_MAJOR_MINOR = "relative_major_minor"
    PARALLEL_KEYS = "parallel_keys"
    SUBDOMINANT = "subdominant"
    DOMINANT = "dominant"
    TRITONE = "tritone"
    SEMITONE = "semitone"
    WHOLE_TONE = "whole_tone"

class HarmonicMixer:
    def __init__(self):
        # Camelot wheel mapping (industry standard): A = minor, B = major
        self.camelot_wheel = {
            # Major (B)
            'C': '8B', 'C#': '3B', 'D': '10B', 'D#': '5B', 'E': '12B', 'F': '7B',
            'F#': '2B', 'G': '9B', 'G#': '4B', 'A': '11B', 'A#': '6B', 'B': '1B',
            # Minor (A)
            'c': '5A', 'c#': '12A', 'd': '7A', 'd#': '2A', 'e': '9A', 'f': '4A',
            'f#': '11A', 'g': '6A', 'g#': '1A', 'a': '8A', 'a#': '3A', 'b': '10A'
        }
        
        # Reverse mapping
        self.camelot_to_key = {v: k for k, v in self.camelot_wheel.items()}
        
        # Key names for display (A = minor, B = major)
        self.key_names = {
            '1A': 'A♭ Minor', '2A': 'E♭ Minor', '3A': 'B♭ Minor', '4A': 'F Minor',
            '5A': 'C Minor', '6A': 'G Minor', '7A': 'D Minor', '8A': 'A Minor',
            '9A': 'E Minor', '10A': 'B Minor', '11A': 'F♯ Minor', '12A': 'C♯ Minor',
            '1B': 'B Major', '2B': 'F♯ Major', '3B': 'D♭ Major', '4B': 'A♭ Major',
            '5B': 'E♭ Major', '6B': 'B♭ Major', '7B': 'F Major', '8B': 'C Major',
            '9B': 'G Major', '10B': 'D Major', '11B': 'A Major', '12B': 'E Major'
        }
        
        # Harmonic relationships (compatibility scores)
        self.harmonic_relationships = {
            MixingTechnique.SAME_KEY: 1.0,
            MixingTechnique.RELATIVE_MAJOR_MINOR: 0.9,
            MixingTechnique.PARALLEL_KEYS: 0.8,
            MixingTechnique.SUBDOMINANT: 0.7,
            MixingTechnique.DOMINANT: 0.6,
            MixingTechnique.TRITONE: 0.4,
            MixingTechnique.SEMITONE: 0.3,
            MixingTechnique.WHOLE_TONE: 0.2
        }

    def get_key_number_and_mode(self, camelot_key: str) -> Tuple[int, str]:
        """Extract key number and mode from Camelot format."""
        if not camelot_key or len(camelot_key) < 2:
            return 1, 'A'
        
        key_num = int(camelot_key[:-1])
        mode = camelot_key[-1]
        return key_num, mode

    def get_compatible_keys(self, camelot_key: str, technique: MixingTechnique = None) -> List[Dict]:
        """Get harmonically compatible keys for a given key."""
        if not camelot_key or camelot_key not in self.key_names:
            return []
        
        key_num, mode = self.get_key_number_and_mode(camelot_key)
        compatible_keys = []
        
        if technique is None:
            # Return all compatible keys with their techniques
            for tech in MixingTechnique:
                keys = self._get_keys_for_technique(camelot_key, tech)
                compatible_keys.extend(keys)
        else:
            compatible_keys = self._get_keys_for_technique(camelot_key, technique)
        
        return compatible_keys

    def _get_keys_for_technique(self, camelot_key: str, technique: MixingTechnique) -> List[Dict]:
        """Get compatible keys for a specific mixing technique."""
        key_num, mode = self.get_key_number_and_mode(camelot_key)
        compatible_keys = []
        
        if technique == MixingTechnique.SAME_KEY:
            # Same key (perfect match)
            compatible_keys.append({
                'key': camelot_key,
                'technique': technique.value,
                'compatibility': self.harmonic_relationships[technique],
                'description': 'Perfect harmonic match'
            })
        
        elif technique == MixingTechnique.RELATIVE_MAJOR_MINOR:
            # Relative major/minor (same number, different mode)
            other_mode = 'B' if mode == 'A' else 'A'
            relative_key = f"{key_num}{other_mode}"
            if relative_key in self.key_names:
                compatible_keys.append({
                    'key': relative_key,
                    'technique': technique.value,
                    'compatibility': self.harmonic_relationships[technique],
                    'description': 'Relative major/minor - very smooth transition'
                })
        
        elif technique == MixingTechnique.PARALLEL_KEYS:
            # Parallel keys (adjacent on wheel)
            for offset in [-1, 1]:
                adj_num = ((key_num - 1 + offset) % 12) + 1
                parallel_key = f"{adj_num}{mode}"
                if parallel_key in self.key_names:
                    compatible_keys.append({
                        'key': parallel_key,
                        'technique': technique.value,
                        'compatibility': self.harmonic_relationships[technique],
                        'description': 'Parallel key - smooth transition'
                    })
        
        elif technique == MixingTechnique.SUBDOMINANT:
            # Subdominant relationship (4th degree)
            subdominant_num = ((key_num - 1 + 5) % 12) + 1  # +5 semitones
            subdominant_key = f"{subdominant_num}{mode}"
            if subdominant_key in self.key_names:
                compatible_keys.append({
                    'key': subdominant_key,
                    'technique': technique.value,
                    'compatibility': self.harmonic_relationships[technique],
                    'description': 'Subdominant relationship - good for building energy'
                })
        
        elif technique == MixingTechnique.DOMINANT:
            # Dominant relationship (5th degree)
            dominant_num = ((key_num - 1 + 7) % 12) + 1  # +7 semitones
            dominant_key = f"{dominant_num}{mode}"
            if dominant_key in self.key_names:
                compatible_keys.append({
                    'key': dominant_key,
                    'technique': technique.value,
                    'compatibility': self.harmonic_relationships[technique],
                    'description': 'Dominant relationship - creates tension and resolution'
                })
        
        elif technique == MixingTechnique.TRITONE:
            # Tritone relationship (6 semitones apart)
            tritone_num = ((key_num - 1 + 6) % 12) + 1
            tritone_key = f"{tritone_num}{mode}"
            if tritone_key in self.key_names:
                compatible_keys.append({
                    'key': tritone_key,
                    'technique': technique.value,
                    'compatibility': self.harmonic_relationships[technique],
                    'description': 'Tritone relationship - creates dramatic tension'
                })
        
        elif technique == MixingTechnique.SEMITONE:
            # Semitone relationship (1 semitone apart)
            for offset in [-1, 1]:
                semitone_num = ((key_num - 1 + offset) % 12) + 1
                semitone_key = f"{semitone_num}{mode}"
                if semitone_key in self.key_names:
                    compatible_keys.append({
                        'key': semitone_key,
                        'technique': technique.value,
                        'compatibility': self.harmonic_relationships[technique],
                        'description': 'Semitone relationship - creates tension'
                    })
        
        elif technique == MixingTechnique.WHOLE_TONE:
            # Whole tone relationship (2 semitones apart)
            for offset in [-2, 2]:
                whole_tone_num = ((key_num - 1 + offset) % 12) + 1
                whole_tone_key = f"{whole_tone_num}{mode}"
                if whole_tone_key in self.key_names:
                    compatible_keys.append({
                        'key': whole_tone_key,
                        'technique': technique.value,
                        'compatibility': self.harmonic_relationships[technique],
                        'description': 'Whole tone relationship - moderate tension'
                    })
        
        return compatible_keys

    def get_mixing_suggestions(self, current_key: str, target_energy: int = None) -> Dict:
        """Get comprehensive mixing suggestions for a key."""
        if not current_key or current_key not in self.key_names:
            return {}
        
        suggestions = {
            'current_key': current_key,
            'current_key_name': self.key_names.get(current_key, current_key),
            'compatible_keys': [],
            'energy_build_suggestions': [],
            'energy_release_suggestions': [],
            'power_block_suggestions': []
        }
        
        # Get all compatible keys
        all_compatible = self.get_compatible_keys(current_key)
        suggestions['compatible_keys'] = all_compatible
        
        # Energy build suggestions (higher energy keys)
        if target_energy:
            suggestions['energy_build_suggestions'] = self._get_energy_build_suggestions(
                current_key, target_energy
            )
        
        # Energy release suggestions (lower energy keys)
        suggestions['energy_release_suggestions'] = self._get_energy_release_suggestions(
            current_key
        )
        
        # Power block suggestions (same key, different energy levels)
        suggestions['power_block_suggestions'] = self._get_power_block_suggestions(
            current_key
        )
        
        return suggestions

    def _get_energy_build_suggestions(self, current_key: str, target_energy: int) -> List[Dict]:
        """Get suggestions for building energy in a mix."""
        key_num, mode = self.get_key_number_and_mode(current_key)
        
        # Keys that typically build energy (dominant, subdominant relationships)
        energy_build_keys = []
        
        # Dominant relationship (builds tension)
        dominant_num = ((key_num - 1 + 7) % 12) + 1
        dominant_key = f"{dominant_num}{mode}"
        if dominant_key in self.key_names:
            energy_build_keys.append({
                'key': dominant_key,
                'technique': 'energy_build',
                'description': 'Dominant relationship - builds tension and energy',
                'energy_boost': '+2'
            })
        
        # Parallel major (if current is minor)
        if mode == 'B':
            parallel_major = f"{key_num}A"
            if parallel_major in self.key_names:
                energy_build_keys.append({
                    'key': parallel_major,
                    'technique': 'energy_build',
                    'description': 'Parallel major - brighter, more energetic',
                    'energy_boost': '+1'
                })
        
        return energy_build_keys

    def _get_energy_release_suggestions(self, current_key: str) -> List[Dict]:
        """Get suggestions for releasing energy in a mix."""
        key_num, mode = self.get_key_number_and_mode(current_key)
        
        # Keys that typically release energy
        energy_release_keys = []
        
        # Subdominant relationship (releases tension)
        subdominant_num = ((key_num - 1 + 5) % 12) + 1
        subdominant_key = f"{subdominant_num}{mode}"
        if subdominant_key in self.key_names:
            energy_release_keys.append({
                'key': subdominant_key,
                'technique': 'energy_release',
                'description': 'Subdominant relationship - releases tension',
                'energy_reduction': '-1'
            })
        
        # Parallel minor (if current is major)
        if mode == 'A':
            parallel_minor = f"{key_num}B"
            if parallel_minor in self.key_names:
                energy_release_keys.append({
                    'key': parallel_minor,
                    'technique': 'energy_release',
                    'description': 'Parallel minor - darker, more introspective',
                    'energy_reduction': '-1'
                })
        
        return energy_release_keys

    def _get_power_block_suggestions(self, current_key: str) -> List[Dict]:
        """Get suggestions for power block mixing (same key, different energy)."""
        return [{
            'key': current_key,
            'technique': 'power_block',
            'description': 'Power block mixing - same key, different energy levels',
            'strategy': 'Use tracks in the same key but with varying energy levels for rapid transitions'
        }]

    def analyze_playlist_harmonics(self, tracks: List[Dict]) -> Dict:
        """Analyze harmonic compatibility of a playlist."""
        if not tracks:
            return {}
        
        analysis = {
            'total_tracks': len(tracks),
            'key_distribution': {},
            'compatibility_matrix': [],
            'mixing_opportunities': [],
            'potential_issues': []
        }
        
        # Analyze key distribution
        for track in tracks:
            key = track.get('key', 'Unknown')
            if key in analysis['key_distribution']:
                analysis['key_distribution'][key] += 1
            else:
                analysis['key_distribution'][key] = 1
        
        # Analyze compatibility between consecutive tracks
        for i in range(len(tracks) - 1):
            track1 = tracks[i]
            track2 = tracks[i + 1]
            
            key1 = track1.get('key')
            key2 = track2.get('key')
            
            if key1 and key2 and key1 in self.key_names and key2 in self.key_names:
                compatibility = self._calculate_track_compatibility(key1, key2)
                analysis['compatibility_matrix'].append({
                    'track1': track1.get('name', f'Track {i+1}'),
                    'track2': track2.get('name', f'Track {i+2}'),
                    'key1': key1,
                    'key2': key2,
                    'compatibility': compatibility
                })
        
        # Find mixing opportunities
        analysis['mixing_opportunities'] = self._find_mixing_opportunities(tracks)
        
        # Identify potential issues
        analysis['potential_issues'] = self._identify_mixing_issues(tracks)
        
        return analysis

    def _calculate_track_compatibility(self, key1: str, key2: str) -> float:
        """Calculate compatibility score between two keys."""
        if key1 == key2:
            return 1.0  # Perfect match
        
        # Check all techniques
        for technique in MixingTechnique:
            compatible_keys = self._get_keys_for_technique(key1, technique)
            for comp_key in compatible_keys:
                if comp_key['key'] == key2:
                    return comp_key['compatibility']
        
        return 0.0  # No compatibility

    def _find_mixing_opportunities(self, tracks: List[Dict]) -> List[Dict]:
        """Find optimal mixing opportunities in the playlist."""
        opportunities = []
        
        for i, track1 in enumerate(tracks):
            key1 = track1.get('key')
            if not key1 or key1 not in self.key_names:
                continue
            
            # Find compatible tracks
            compatible_tracks = []
            for j, track2 in enumerate(tracks):
                if i == j:
                    continue
                
                key2 = track2.get('key')
                if key2 and key2 in self.key_names:
                    compatibility = self._calculate_track_compatibility(key1, key2)
                    if compatibility > 0.5:  # Good compatibility threshold
                        compatible_tracks.append({
                            'track': track2.get('name', f'Track {j+1}'),
                            'key': key2,
                            'compatibility': compatibility
                        })
            
            if compatible_tracks:
                opportunities.append({
                    'source_track': track1.get('name', f'Track {i+1}'),
                    'source_key': key1,
                    'compatible_tracks': compatible_tracks
                })
        
        return opportunities

    def _identify_mixing_issues(self, tracks: List[Dict]) -> List[Dict]:
        """Identify potential mixing issues in the playlist."""
        issues = []
        
        for i in range(len(tracks) - 1):
            track1 = tracks[i]
            track2 = tracks[i + 1]
            
            key1 = track1.get('key')
            key2 = track2.get('key')
            
            if key1 and key2 and key1 in self.key_names and key2 in self.key_names:
                compatibility = self._calculate_track_compatibility(key1, key2)
                
                if compatibility < 0.3:  # Low compatibility threshold
                    issues.append({
                        'position': f'Tracks {i+1} -> {i+2}',
                        'key1': key1,
                        'key2': key2,
                        'compatibility': compatibility,
                        'issue': 'Low harmonic compatibility - may cause key clash',
                        'suggestion': f'Consider mixing with a track in {key1} or a compatible key'
                    })
        
        return issues 
"""
Advanced Mixing Techniques Module
Provides advanced DJ mixing techniques including power block mixing,
energy boost mixing, and beat jumping with cue points.
"""

import numpy as np
import librosa
from typing import Dict, List, Tuple, Optional
from enum import Enum

class MixingStyle(Enum):
    """Different mixing styles and techniques."""
    POWER_BLOCK = "power_block"
    ENERGY_BOOST = "energy_boost"
    BEAT_JUMP = "beat_jump"
    HARMONIC_ENERGY = "harmonic_energy"
    RHYTHMIC_LAYERING = "rhythmic_layering"
    DYNAMIC_CONTRAST = "dynamic_contrast"

class AdvancedMixer:
    def __init__(self):
        # Mixing technique descriptions
        self.technique_descriptions = {
            MixingStyle.POWER_BLOCK: "Rapid transitions between tracks in the same key with energy variation",
            MixingStyle.ENERGY_BOOST: "Sudden energy increases using high-energy tracks",
            MixingStyle.BEAT_JUMP: "Jumping between specific beat-aligned sections",
            MixingStyle.HARMONIC_ENERGY: "Combining harmonic compatibility with energy flow",
            MixingStyle.RHYTHMIC_LAYERING: "Layering rhythmic elements from multiple tracks",
            MixingStyle.DYNAMIC_CONTRAST: "Creating contrast through dramatic energy changes"
        }
        
        # Cue point types for beat jumping
        self.cue_point_types = {
            'intro': 'Track introduction, ideal for starting mixes',
            'verse': 'Main vocal section with supporting elements',
            'chorus': 'High-energy section with prominent hooks',
            'drop': 'Maximum energy section with strong bass and percussion',
            'breakdown': 'Lower energy section for building tension',
            'build': 'Energy building section',
            'outro': 'Track conclusion, ideal for mixing out'
        }

    def analyze_power_block_opportunities(self, tracks: List[Dict]) -> List[Dict]:
        """Analyze power block mixing opportunities."""
        opportunities = []
        
        # Group tracks by key
        key_groups = {}
        for track in tracks:
            key = track.get('key')
            if key:
                if key not in key_groups:
                    key_groups[key] = []
                key_groups[key].append(track)
        
        # Find power block opportunities
        for key, group_tracks in key_groups.items():
            if len(group_tracks) >= 2:
                # Sort by energy level
                sorted_tracks = sorted(group_tracks, key=lambda x: x.get('energy', 5))
                
                # Find energy variation within the same key
                energy_levels = [t.get('energy', 5) for t in sorted_tracks]
                energy_range = max(energy_levels) - min(energy_levels)
                
                if energy_range >= 2:  # Good energy variation
                    opportunities.append({
                        'technique': 'power_block',
                        'key': key,
                        'tracks': [t.get('name', 'Unknown') for t in sorted_tracks],
                        'energy_range': energy_range,
                        'energy_levels': energy_levels,
                        'description': f'Power block mixing in {key} with energy range {energy_range}',
                        'strategy': 'Rapid transitions between tracks in the same key with varying energy levels'
                    })
        
        return opportunities

    def analyze_energy_boost_opportunities(self, tracks: List[Dict]) -> List[Dict]:
        """Analyze energy boost mixing opportunities."""
        opportunities = []
        
        for i, track1 in enumerate(tracks):
            energy1 = track1.get('energy', 5)
            
            # Find high-energy tracks that can boost energy
            boost_candidates = []
            for j, track2 in enumerate(tracks):
                if i == j:
                    continue
                
                energy2 = track2.get('energy', 5)
                energy_boost = energy2 - energy1
                
                # Good energy boost candidates
                if energy_boost >= 3:  # Significant energy increase
                    boost_candidates.append({
                        'track': track2.get('name', f'Track {j+1}'),
                        'energy': energy2,
                        'energy_boost': energy_boost,
                        'key': track2.get('key'),
                        'bpm': track2.get('bpm')
                    })
            
            if boost_candidates:
                # Sort by energy boost potential
                boost_candidates.sort(key=lambda x: x['energy_boost'], reverse=True)
                
                opportunities.append({
                    'source_track': track1.get('name', f'Track {i+1}'),
                    'source_energy': energy1,
                    'boost_candidates': boost_candidates[:3],  # Top 3 candidates
                    'technique': 'energy_boost',
                    'description': f'Energy boost from {energy1} to {boost_candidates[0]["energy"]}',
                    'strategy': 'Use high-energy tracks for dramatic energy increases'
                })
        
        return opportunities

    def analyze_beat_jump_opportunities(self, track: Dict) -> List[Dict]:
        """Analyze beat jumping opportunities within a track."""
        if not track.get('cue_points'):
            return []
        
        opportunities = []
        cue_points = track.get('cue_points', [])
        
        # Find cue points suitable for beat jumping
        for i, cue in enumerate(cue_points):
            cue_type = cue.get('type', 'unknown')
            
            if cue_type in ['drop', 'chorus', 'build']:
                # High-energy sections good for jumping to
                opportunities.append({
                    'cue_point': cue.get('name', f'Cue {i+1}'),
                    'time': cue.get('time', 0),
                    'type': cue_type,
                    'technique': 'beat_jump_to_energy',
                    'description': f'Jump to {cue_type} section for energy boost',
                    'strategy': 'Use high-energy cue points for dramatic transitions'
                })
            
            elif cue_type in ['breakdown', 'verse']:
                # Lower energy sections good for contrast
                opportunities.append({
                    'cue_point': cue.get('name', f'Cue {i+1}'),
                    'time': cue.get('time', 0),
                    'type': cue_type,
                    'technique': 'beat_jump_to_contrast',
                    'description': f'Jump to {cue_type} section for energy contrast',
                    'strategy': 'Use lower energy cue points for dramatic drops'
                })
        
        return opportunities

    def get_harmonic_energy_suggestions(self, current_key: str, current_energy: int) -> List[Dict]:
        """Get harmonic energy mixing suggestions."""
        suggestions = []
        
        # Import harmonic mixer for key compatibility
        try:
            from .harmonic_mixing import HarmonicMixer
            harmonic_mixer = HarmonicMixer()
            
            # Get compatible keys
            compatible_keys = harmonic_mixer.get_compatible_keys(current_key)
            
            for comp_key in compatible_keys:
                key = comp_key['key']
                technique = comp_key['technique']
                compatibility = comp_key['compatibility']
                
                # Suggest energy levels based on harmonic relationship
                if technique == 'same_key':
                    # Same key - maintain or slightly vary energy
                    suggestions.append({
                        'key': key,
                        'technique': 'harmonic_energy_same',
                        'energy_range': [current_energy - 1, current_energy + 1],
                        'description': f'Same key mixing - maintain energy around {current_energy}',
                        'strategy': 'Use tracks in the same key with similar energy levels'
                    })
                
                elif technique == 'relative_major_minor':
                    # Relative major/minor - energy variation
                    if 'A' in key:  # Major key - higher energy
                        suggestions.append({
                            'key': key,
                            'technique': 'harmonic_energy_relative',
                            'energy_range': [current_energy + 1, current_energy + 3],
                            'description': f'Relative major key - increase energy by 1-3 points',
                            'strategy': 'Use relative major for energy boost'
                        })
                    else:  # Minor key - lower energy
                        suggestions.append({
                            'key': key,
                            'technique': 'harmonic_energy_relative',
                            'energy_range': [current_energy - 1, current_energy + 1],
                            'description': f'Relative minor key - maintain or slightly lower energy',
                            'strategy': 'Use relative minor for energy release'
                        })
                
                elif technique == 'parallel_keys':
                    # Parallel keys - similar energy
                    suggestions.append({
                        'key': key,
                        'technique': 'harmonic_energy_parallel',
                        'energy_range': [current_energy - 1, current_energy + 1],
                        'description': f'Parallel key mixing - similar energy levels',
                        'strategy': 'Use parallel keys for smooth transitions'
                    })
        
        except ImportError:
            # Fallback if harmonic mixer not available
            suggestions.append({
                'key': current_key,
                'technique': 'harmonic_energy_fallback',
                'energy_range': [current_energy - 2, current_energy + 2],
                'description': 'Harmonic energy mixing - moderate energy variation',
                'strategy': 'Use compatible keys with moderate energy variation'
            })
        
        return suggestions

    def analyze_rhythmic_layering_opportunities(self, tracks: List[Dict]) -> List[Dict]:
        """Analyze rhythmic layering opportunities."""
        opportunities = []
        
        for i, track1 in enumerate(tracks):
            bpm1 = track1.get('bpm')
            key1 = track1.get('key')
            
            if not bpm1:
                continue
            
            # Find tracks with compatible BPM for layering
            layering_candidates = []
            for j, track2 in enumerate(tracks):
                if i == j:
                    continue
                
                bpm2 = track2.get('bpm')
                if not bpm2:
                    continue
                
                # Check BPM compatibility (within 5% or exact multiples)
                bpm_ratio = bpm2 / bpm1
                bpm_compatible = (
                    abs(bpm2 - bpm1) <= bpm1 * 0.05 or  # Within 5%
                    abs(bpm_ratio - 2) <= 0.1 or  # Double time
                    abs(bpm_ratio - 0.5) <= 0.1   # Half time
                )
                
                if bpm_compatible:
                    # Check key compatibility
                    key2 = track2.get('key')
                    key_compatible = key1 == key2 if key1 and key2 else True
                    
                    if key_compatible:
                        layering_candidates.append({
                            'track': track2.get('name', f'Track {j+1}'),
                            'bpm': bpm2,
                            'bpm_ratio': bpm_ratio,
                            'key': key2,
                            'energy': track2.get('energy', 5)
                        })
            
            if layering_candidates:
                opportunities.append({
                    'source_track': track1.get('name', f'Track {i+1}'),
                    'source_bpm': bpm1,
                    'source_key': key1,
                    'layering_candidates': layering_candidates,
                    'technique': 'rhythmic_layering',
                    'description': f'Rhythmic layering with {len(layering_candidates)} compatible tracks',
                    'strategy': 'Layer tracks with compatible BPM and keys'
                })
        
        return opportunities

    def analyze_dynamic_contrast_opportunities(self, tracks: List[Dict]) -> List[Dict]:
        """Analyze dynamic contrast opportunities."""
        opportunities = []
        
        for i, track1 in enumerate(tracks):
            energy1 = track1.get('energy', 5)
            
            # Find tracks for dramatic contrast
            contrast_candidates = []
            for j, track2 in enumerate(tracks):
                if i == j:
                    continue
                
                energy2 = track2.get('energy', 5)
                energy_diff = abs(energy2 - energy1)
                
                # Significant energy contrast
                if energy_diff >= 4:
                    contrast_candidates.append({
                        'track': track2.get('name', f'Track {j+1}'),
                        'energy': energy2,
                        'energy_diff': energy_diff,
                        'contrast_type': 'energy_drop' if energy2 < energy1 else 'energy_boost',
                        'key': track2.get('key'),
                        'bpm': track2.get('bpm')
                    })
            
            if contrast_candidates:
                # Sort by contrast strength
                contrast_candidates.sort(key=lambda x: x['energy_diff'], reverse=True)
                
                opportunities.append({
                    'source_track': track1.get('name', f'Track {i+1}'),
                    'source_energy': energy1,
                    'contrast_candidates': contrast_candidates[:3],  # Top 3 candidates
                    'technique': 'dynamic_contrast',
                    'description': f'Dynamic contrast from {energy1} to {contrast_candidates[0]["energy"]}',
                    'strategy': 'Use dramatic energy changes for contrast and excitement'
                })
        
        return opportunities

    def get_cue_point_mixing_suggestions(self, cue_points: List[Dict]) -> List[Dict]:
        """Get mixing suggestions based on cue points."""
        suggestions = []
        
        if not cue_points:
            return suggestions
        
        # Analyze cue point patterns
        intro_cues = [c for c in cue_points if c.get('type') == 'intro']
        drop_cues = [c for c in cue_points if c.get('type') == 'drop']
        breakdown_cues = [c for c in cue_points if c.get('type') == 'breakdown']
        outro_cues = [c for c in cue_points if c.get('type') == 'outro']
        
        # Intro mixing suggestions
        if intro_cues:
            suggestions.append({
                'cue_type': 'intro',
                'cues': intro_cues,
                'technique': 'intro_mixing',
                'description': 'Use intro sections for smooth mix-ins',
                'strategy': 'Start new tracks during intro sections for seamless transitions'
            })
        
        # Drop mixing suggestions
        if drop_cues:
            suggestions.append({
                'cue_type': 'drop',
                'cues': drop_cues,
                'technique': 'drop_mixing',
                'description': 'Use drop sections for energy boosts',
                'strategy': 'Time track changes to coincide with drop sections for maximum impact'
            })
        
        # Breakdown mixing suggestions
        if breakdown_cues:
            suggestions.append({
                'cue_type': 'breakdown',
                'cues': breakdown_cues,
                'technique': 'breakdown_mixing',
                'description': 'Use breakdown sections for energy releases',
                'strategy': 'Introduce new tracks during breakdown sections for smooth energy transitions'
            })
        
        # Outro mixing suggestions
        if outro_cues:
            suggestions.append({
                'cue_type': 'outro',
                'cues': outro_cues,
                'technique': 'outro_mixing',
                'description': 'Use outro sections for mix-outs',
                'strategy': 'Start new tracks during outro sections for seamless transitions'
            })
        
        return suggestions

    def create_mixing_workflow(self, tracks: List[Dict]) -> Dict:
        """Create a comprehensive mixing workflow."""
        workflow = {
            'power_block_opportunities': self.analyze_power_block_opportunities(tracks),
            'energy_boost_opportunities': self.analyze_energy_boost_opportunities(tracks),
            'rhythmic_layering_opportunities': self.analyze_rhythmic_layering_opportunities(tracks),
            'dynamic_contrast_opportunities': self.analyze_dynamic_contrast_opportunities(tracks),
            'cue_point_suggestions': [],
            'overall_strategy': {}
        }
        
        # Analyze cue points for each track
        for track in tracks:
            if track.get('cue_points'):
                cue_suggestions = self.get_cue_point_mixing_suggestions(track['cue_points'])
                workflow['cue_point_suggestions'].append({
                    'track': track.get('name', 'Unknown'),
                    'suggestions': cue_suggestions
                })
        
        # Create overall strategy
        workflow['overall_strategy'] = self._create_overall_strategy(workflow)
        
        return workflow

    def _create_overall_strategy(self, workflow: Dict) -> Dict:
        """Create an overall mixing strategy based on opportunities."""
        strategy = {
            'primary_technique': None,
            'secondary_techniques': [],
            'energy_flow': 'build',
            'key_flow': 'harmonic',
            'recommendations': []
        }
        
        # Determine primary technique based on opportunities
        technique_counts = {
            'power_block': len(workflow['power_block_opportunities']),
            'energy_boost': len(workflow['energy_boost_opportunities']),
            'rhythmic_layering': len(workflow['rhythmic_layering_opportunities']),
            'dynamic_contrast': len(workflow['dynamic_contrast_opportunities'])
        }
        
        if technique_counts['power_block'] > 0:
            strategy['primary_technique'] = 'power_block'
            strategy['recommendations'].append('Focus on power block mixing for rapid, energetic transitions')
        
        if technique_counts['energy_boost'] > 0:
            strategy['secondary_techniques'].append('energy_boost')
            strategy['recommendations'].append('Use energy boost techniques for dramatic moments')
        
        if technique_counts['rhythmic_layering'] > 0:
            strategy['secondary_techniques'].append('rhythmic_layering')
            strategy['recommendations'].append('Layer tracks with compatible BPM for complex rhythms')
        
        if technique_counts['dynamic_contrast'] > 0:
            strategy['secondary_techniques'].append('dynamic_contrast')
            strategy['recommendations'].append('Use dynamic contrast for variety and excitement')
        
        return strategy 
"""
Mix Point Analyzer Module
Analyzes two tracks to recommend optimal mix points for DJ transitions.
Uses phrase alignment, key compatibility, energy matching, and cue points.
"""

from typing import Dict, List, Optional, Tuple
from .harmonic_mixing import HarmonicMixer


class MixPointAnalyzer:
    """Analyzes tracks to find optimal mix points for DJ transitions."""

    # Scoring weights for mix point recommendations
    WEIGHTS = {
        'phrase_alignment': 0.30,   # Mix at phrase boundaries
        'key_compatibility': 0.25,  # Harmonic mixing
        'energy_match': 0.20,       # Energy flow
        'cue_alignment': 0.15,      # Align with cue points (intro/outro)
        'bpm_match': 0.10           # Tempo compatibility
    }

    def __init__(self):
        self.harmonic_mixer = HarmonicMixer()

    def analyze_mix_points(
        self,
        track_a: Dict,
        track_b: Dict,
        max_recommendations: int = 3
    ) -> List[Dict]:
        """
        Analyze two tracks and return mix point recommendations.

        Args:
            track_a: Outgoing track analysis data
            track_b: Incoming track analysis data
            max_recommendations: Maximum number of recommendations to return

        Returns:
            List of mix point recommendations with scores and details
        """
        if not track_a or not track_b:
            return []

        recommendations = []

        # Get potential out points from track A (outro, drops, phrase boundaries)
        out_points = self._get_out_points(track_a)

        # Get potential in points from track B (intro, drops, phrase boundaries)
        in_points = self._get_in_points(track_b)

        # Calculate global compatibility scores (don't depend on specific points)
        key_score = self._calculate_key_compatibility(track_a, track_b)
        bpm_score = self._calculate_bpm_compatibility(track_a, track_b)

        # Score all combinations of out/in points
        for out_point in out_points:
            for in_point in in_points:
                score, reasons = self._score_mix_point(
                    track_a, track_b,
                    out_point, in_point,
                    key_score, bpm_score
                )

                recommendations.append({
                    'outPoint': out_point,
                    'inPoint': in_point,
                    'score': round(score, 1),
                    'reasons': reasons,
                    'overlapBars': self._calculate_overlap_bars(
                        track_a, track_b, out_point, in_point
                    )
                })

        # Sort by score descending and return top N
        recommendations.sort(key=lambda x: x['score'], reverse=True)
        return recommendations[:max_recommendations]

    def _get_out_points(self, track: Dict) -> List[Dict]:
        """Get potential mix-out points from a track."""
        points = []
        duration = track.get('duration', 300)
        cue_points = track.get('cue_points', [])
        phrase_markers = track.get('phrase_markers', [])

        # Look for outro cue point
        outro_cue = self._find_cue_by_type(cue_points, ['outro', 'end'])
        if outro_cue:
            points.append({
                'time': outro_cue['time'],
                'type': 'outro',
                'label': outro_cue.get('name', 'Outro'),
                'source': 'cue'
            })

        # Look for last drop/breakdown as potential out point
        drops = [c for c in cue_points if 'drop' in (c.get('name', '') + c.get('type', '')).lower()]
        if drops:
            last_drop = max(drops, key=lambda x: x['time'])
            # Out point would be after the drop plays out
            out_time = last_drop['time'] + self._get_phrase_duration(track, 16)
            if out_time < duration:
                points.append({
                    'time': out_time,
                    'type': 'post_drop',
                    'label': 'After Last Drop',
                    'source': 'derived'
                })

        # Add phrase boundaries in the last third of the track
        last_third_start = duration * 0.66
        for phrase in phrase_markers:
            if phrase['time'] >= last_third_start and phrase.get('bar_length', 8) >= 8:
                points.append({
                    'time': phrase['time'],
                    'type': 'phrase',
                    'label': f"{phrase.get('bar_length', 8)}-bar phrase",
                    'source': 'phrase',
                    'bar_length': phrase.get('bar_length', 8)
                })

        # If no points found, add a default at 75% of track
        if not points:
            points.append({
                'time': duration * 0.75,
                'type': 'default',
                'label': 'Default (75%)',
                'source': 'default'
            })

        return points

    def _get_in_points(self, track: Dict) -> List[Dict]:
        """Get potential mix-in points from a track."""
        points = []
        cue_points = track.get('cue_points', [])
        phrase_markers = track.get('phrase_markers', [])

        # Always consider the start
        points.append({
            'time': 0.0,
            'type': 'start',
            'label': 'Track Start',
            'source': 'default'
        })

        # Look for intro cue point
        intro_cue = self._find_cue_by_type(cue_points, ['intro', 'start', 'begin'])
        if intro_cue and intro_cue['time'] > 0:
            points.append({
                'time': intro_cue['time'],
                'type': 'intro',
                'label': intro_cue.get('name', 'Intro'),
                'source': 'cue'
            })

        # Look for first drop
        drops = [c for c in cue_points if 'drop' in (c.get('name', '') + c.get('type', '')).lower()]
        if drops:
            first_drop = min(drops, key=lambda x: x['time'])
            points.append({
                'time': first_drop['time'],
                'type': 'drop',
                'label': first_drop.get('name', 'Drop'),
                'source': 'cue'
            })

        # Add early phrase boundaries (first third of track)
        duration = track.get('duration', 300)
        first_third_end = duration * 0.33
        for phrase in phrase_markers:
            if phrase['time'] <= first_third_end and phrase.get('bar_length', 8) >= 8:
                points.append({
                    'time': phrase['time'],
                    'type': 'phrase',
                    'label': f"{phrase.get('bar_length', 8)}-bar phrase",
                    'source': 'phrase',
                    'bar_length': phrase.get('bar_length', 8)
                })

        return points

    def _find_cue_by_type(self, cue_points: List[Dict], type_keywords: List[str]) -> Optional[Dict]:
        """Find a cue point by type keywords."""
        for cue in cue_points:
            cue_name = (cue.get('name', '') + cue.get('type', '')).lower()
            for keyword in type_keywords:
                if keyword in cue_name:
                    return cue
        return None

    def _get_phrase_duration(self, track: Dict, bars: int = 8) -> float:
        """Calculate duration in seconds for a given number of bars."""
        bpm = track.get('bpm', 128)
        beats_per_bar = 4
        seconds_per_beat = 60.0 / bpm
        return bars * beats_per_bar * seconds_per_beat

    def _score_mix_point(
        self,
        track_a: Dict,
        track_b: Dict,
        out_point: Dict,
        in_point: Dict,
        key_score: float,
        bpm_score: float
    ) -> Tuple[float, List[Dict]]:
        """Score a specific mix point combination."""
        reasons = []

        # 1. Phrase alignment score
        phrase_score = self._calculate_phrase_alignment_score(out_point, in_point)
        reasons.append({
            'label': 'Phrase Aligned' if phrase_score > 70 else 'Phrase',
            'score': round(phrase_score)
        })

        # 2. Key compatibility (already calculated)
        reasons.append({
            'label': 'Key Match' if key_score > 70 else 'Key',
            'score': round(key_score)
        })

        # 3. Energy match score
        energy_score = self._calculate_energy_match_score(
            track_a, track_b, out_point, in_point
        )
        reasons.append({
            'label': 'Energy Flow' if energy_score > 70 else 'Energy',
            'score': round(energy_score)
        })

        # 4. Cue alignment score
        cue_score = self._calculate_cue_alignment_score(out_point, in_point)
        reasons.append({
            'label': 'Cue Aligned' if cue_score > 70 else 'Cue',
            'score': round(cue_score)
        })

        # 5. BPM match (already calculated)
        reasons.append({
            'label': 'BPM Match' if bpm_score > 70 else 'BPM',
            'score': round(bpm_score)
        })

        # Calculate weighted total
        total_score = (
            phrase_score * self.WEIGHTS['phrase_alignment'] +
            key_score * self.WEIGHTS['key_compatibility'] +
            energy_score * self.WEIGHTS['energy_match'] +
            cue_score * self.WEIGHTS['cue_alignment'] +
            bpm_score * self.WEIGHTS['bpm_match']
        )

        return total_score, reasons

    def _calculate_phrase_alignment_score(self, out_point: Dict, in_point: Dict) -> float:
        """Score based on phrase boundary alignment."""
        score = 50  # Base score

        # Bonus for phrase-based points
        if out_point.get('source') == 'phrase':
            score += 25
            # Extra bonus for longer phrases
            if out_point.get('bar_length', 8) >= 16:
                score += 15
            if out_point.get('bar_length', 8) >= 32:
                score += 10

        if in_point.get('source') == 'phrase':
            score += 25
            if in_point.get('bar_length', 8) >= 16:
                score += 15
            if in_point.get('bar_length', 8) >= 32:
                score += 10

        return min(100, score)

    def _calculate_key_compatibility(self, track_a: Dict, track_b: Dict) -> float:
        """Calculate key compatibility score between tracks."""
        key_a = track_a.get('key', '')
        key_b = track_b.get('key', '')

        if not key_a or not key_b:
            return 50  # Neutral if keys unknown

        # Convert to Camelot if needed
        camelot_a = self._to_camelot(key_a)
        camelot_b = self._to_camelot(key_b)

        if not camelot_a or not camelot_b:
            return 50

        # Use harmonic mixer to get compatibility
        compatibility = self.harmonic_mixer._calculate_track_compatibility(camelot_a, camelot_b)

        # Scale from 0-1 to 0-100
        return compatibility * 100

    def _to_camelot(self, key: str) -> Optional[str]:
        """Convert key notation to Camelot format."""
        # If already in Camelot format (e.g., "8A", "11B")
        if len(key) >= 2 and key[-1] in 'AB':
            try:
                int(key[:-1])
                return key
            except ValueError:
                pass

        # Try to convert from standard notation
        return self.harmonic_mixer.camelot_wheel.get(key)

    def _calculate_bpm_compatibility(self, track_a: Dict, track_b: Dict) -> float:
        """Calculate BPM compatibility score."""
        bpm_a = track_a.get('bpm', 0)
        bpm_b = track_b.get('bpm', 0)

        if not bpm_a or not bpm_b:
            return 50

        # Calculate pitch adjustment needed
        pitch_percent = abs((bpm_b - bpm_a) / bpm_a) * 100

        # Score based on pitch adjustment
        if pitch_percent <= 2:
            return 100  # Perfect match
        elif pitch_percent <= 5:
            return 85   # Good match
        elif pitch_percent <= 8:
            return 60   # Moderate adjustment
        elif pitch_percent <= 12:
            return 40   # Significant adjustment
        else:
            return 20   # Large adjustment needed

    def _calculate_energy_match_score(
        self,
        track_a: Dict,
        track_b: Dict,
        out_point: Dict,
        in_point: Dict
    ) -> float:
        """Calculate energy flow score at mix points."""
        energy_a = track_a.get('overall_energy', 5)
        energy_b = track_b.get('overall_energy', 5)

        # Get energy profiles if available
        profile_a = track_a.get('energy_profile', [])
        profile_b = track_b.get('energy_profile', [])

        # Try to get energy at specific points
        if profile_a and track_a.get('duration'):
            segment_idx = int((out_point['time'] / track_a['duration']) * len(profile_a))
            segment_idx = min(segment_idx, len(profile_a) - 1)
            energy_a_at_point = profile_a[segment_idx].get('energy', energy_a)
        else:
            energy_a_at_point = energy_a

        if profile_b and track_b.get('duration'):
            segment_idx = int((in_point['time'] / track_b['duration']) * len(profile_b))
            segment_idx = min(segment_idx, len(profile_b) - 1)
            energy_b_at_point = profile_b[segment_idx].get('energy', energy_b)
        else:
            energy_b_at_point = energy_b

        # Score based on energy difference
        # Slight increase is good (building energy), big jumps are bad
        energy_diff = energy_b_at_point - energy_a_at_point

        if -1 <= energy_diff <= 2:
            return 100  # Smooth energy flow
        elif -2 <= energy_diff <= 3:
            return 80   # Acceptable energy change
        elif -3 <= energy_diff <= 4:
            return 60   # Noticeable change
        else:
            return 40   # Large energy jump

    def _calculate_cue_alignment_score(self, out_point: Dict, in_point: Dict) -> float:
        """Score based on cue point alignment."""
        score = 50  # Base score

        # Bonus for cue-based points
        if out_point.get('source') == 'cue':
            score += 25
            # Extra bonus for outro
            if out_point.get('type') == 'outro':
                score += 15

        if in_point.get('source') == 'cue':
            score += 25
            # Extra bonus for intro
            if in_point.get('type') == 'intro':
                score += 15

        # Bonus for matching outro->intro
        if out_point.get('type') == 'outro' and in_point.get('type') == 'intro':
            score += 10

        return min(100, score)

    def _calculate_overlap_bars(
        self,
        track_a: Dict,
        track_b: Dict,
        out_point: Dict,
        in_point: Dict
    ) -> int:
        """Calculate recommended overlap duration in bars."""
        # Base overlap depends on point types
        if out_point.get('type') == 'outro' and in_point.get('type') == 'intro':
            return 16  # Full intro/outro blend
        elif 'drop' in (out_point.get('type', '') + in_point.get('type', '')):
            return 8   # Quick drop transition
        elif out_point.get('source') == 'phrase' or in_point.get('source') == 'phrase':
            bar_length = max(
                out_point.get('bar_length', 8),
                in_point.get('bar_length', 8)
            )
            return bar_length
        else:
            return 16  # Default overlap


def get_mix_recommendations(track_a: Dict, track_b: Dict) -> List[Dict]:
    """
    Convenience function to get mix point recommendations.

    Args:
        track_a: Analysis data for outgoing track
        track_b: Analysis data for incoming track

    Returns:
        List of mix point recommendations
    """
    analyzer = MixPointAnalyzer()
    return analyzer.analyze_mix_points(track_a, track_b)

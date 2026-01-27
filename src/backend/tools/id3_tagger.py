#!/usr/bin/env python3
"""
ID3 Tag Writer for Mixed In AI
Embeds key, BPM, and energy level into music file metadata.
Supports MP3, M4A/MP4, FLAC, and WAV formats.
"""

import os
import logging
from typing import Optional, Dict, Any

try:
    from mutagen.id3 import ID3, TKEY, TBPM, TXXX, ID3NoHeaderError
    from mutagen.mp3 import MP3
    from mutagen.mp4 import MP4
    from mutagen.flac import FLAC
    from mutagen.wave import WAVE
    MUTAGEN_AVAILABLE = True
except ImportError:
    MUTAGEN_AVAILABLE = False

logger = logging.getLogger(__name__)


class ID3Tagger:
    """
    Write analysis results (key, BPM, energy) to music file metadata.
    
    Supported formats:
    - MP3: ID3v2.4 tags (TKEY, TBPM, TXXX)
    - M4A/MP4: iTunes-style atoms
    - FLAC: Vorbis comments
    - WAV: ID3v2 chunk
    """
    
    def __init__(self):
        if not MUTAGEN_AVAILABLE:
            raise ImportError(
                "mutagen library is required for ID3 tagging. "
                "Install with: pip install mutagen"
            )
    
    def write_tags(
        self,
        file_path: str,
        key: Optional[str] = None,
        bpm: Optional[float] = None,
        energy: Optional[int] = None,
        camelot: Optional[str] = None,
        cue_points: Optional[list] = None,
        preserve_existing: bool = True
    ) -> Dict[str, Any]:
        """
        Write analysis data to music file tags.
        
        Args:
            file_path: Path to the audio file
            key: Musical key (e.g., "C major", "Am")
            bpm: Tempo in beats per minute
            energy: Energy level (1-10)
            camelot: Camelot wheel notation (e.g., "8A", "11B")
            cue_points: List of cue point dicts with 'time' and 'name'
            preserve_existing: If True, keep existing tags not being overwritten
            
        Returns:
            Dict with status and written tags
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File not found: {file_path}")
        
        ext = os.path.splitext(file_path)[1].lower()
        
        if ext == '.mp3':
            return self._write_mp3(file_path, key, bpm, energy, camelot, cue_points, preserve_existing)
        elif ext in ('.m4a', '.mp4', '.aac'):
            return self._write_mp4(file_path, key, bpm, energy, camelot, preserve_existing)
        elif ext == '.flac':
            return self._write_flac(file_path, key, bpm, energy, camelot, preserve_existing)
        elif ext == '.wav':
            return self._write_wav(file_path, key, bpm, energy, camelot, preserve_existing)
        else:
            raise ValueError(f"Unsupported format: {ext}")
    
    def _write_mp3(
        self,
        file_path: str,
        key: Optional[str],
        bpm: Optional[float],
        energy: Optional[int],
        camelot: Optional[str],
        cue_points: Optional[list],
        preserve_existing: bool
    ) -> Dict[str, Any]:
        """Write tags to MP3 file using ID3v2.4."""
        written = {}
        
        try:
            audio = MP3(file_path)
            if audio.tags is None:
                audio.add_tags()
        except ID3NoHeaderError:
            audio = MP3(file_path)
            audio.add_tags()
        
        tags = audio.tags
        
        # Musical key (TKEY frame)
        if key:
            # Use Camelot notation if available, otherwise standard key
            key_value = camelot if camelot else key
            tags.delall('TKEY')
            tags.add(TKEY(encoding=3, text=key_value))
            written['key'] = key_value
        
        # BPM (TBPM frame)
        if bpm:
            tags.delall('TBPM')
            tags.add(TBPM(encoding=3, text=str(round(bpm, 1))))
            written['bpm'] = round(bpm, 1)
        
        # Energy level (custom TXXX frame)
        if energy is not None:
            # Remove existing energy tag
            tags.delall('TXXX:ENERGY')
            tags.add(TXXX(encoding=3, desc='ENERGY', text=str(energy)))
            written['energy'] = energy
        
        # Store original key alongside Camelot for compatibility
        if key and camelot:
            tags.delall('TXXX:INITIALKEY')
            tags.add(TXXX(encoding=3, desc='INITIALKEY', text=key))
            written['initial_key'] = key
        
        # Cue points as TXXX (for backup, main cues go to Rekordbox XML)
        if cue_points:
            import json
            cue_json = json.dumps(cue_points[:8])  # Max 8 cues
            tags.delall('TXXX:MIXEDINAI_CUES')
            tags.add(TXXX(encoding=3, desc='MIXEDINAI_CUES', text=cue_json))
            written['cue_count'] = len(cue_points[:8])
        
        audio.save(v2_version=4)
        
        logger.info(f"Wrote MP3 tags to {file_path}: {written}")
        return {'status': 'success', 'format': 'mp3', 'written': written}
    
    def _write_mp4(
        self,
        file_path: str,
        key: Optional[str],
        bpm: Optional[float],
        energy: Optional[int],
        camelot: Optional[str],
        preserve_existing: bool
    ) -> Dict[str, Any]:
        """Write tags to M4A/MP4 file using iTunes atoms."""
        written = {}
        
        audio = MP4(file_path)
        if audio.tags is None:
            audio.add_tags()
        
        # Key (no standard atom, use comment or custom)
        if key:
            key_value = camelot if camelot else key
            audio.tags['----:com.apple.iTunes:INITIALKEY'] = \
                key_value.encode('utf-8')
            written['key'] = key_value
        
        # BPM (tmpo atom)
        if bpm:
            audio.tags['tmpo'] = [int(round(bpm))]
            written['bpm'] = int(round(bpm))
        
        # Energy (custom iTunes atom)
        if energy is not None:
            audio.tags['----:com.apple.iTunes:ENERGY'] = \
                str(energy).encode('utf-8')
            written['energy'] = energy
        
        audio.save()
        
        logger.info(f"Wrote M4A tags to {file_path}: {written}")
        return {'status': 'success', 'format': 'm4a', 'written': written}
    
    def _write_flac(
        self,
        file_path: str,
        key: Optional[str],
        bpm: Optional[float],
        energy: Optional[int],
        camelot: Optional[str],
        preserve_existing: bool
    ) -> Dict[str, Any]:
        """Write tags to FLAC file using Vorbis comments."""
        written = {}
        
        audio = FLAC(file_path)
        
        # Key
        if key:
            key_value = camelot if camelot else key
            audio['INITIALKEY'] = key_value
            written['key'] = key_value
        
        # BPM
        if bpm:
            audio['BPM'] = str(round(bpm, 1))
            written['bpm'] = round(bpm, 1)
        
        # Energy
        if energy is not None:
            audio['ENERGY'] = str(energy)
            written['energy'] = energy
        
        audio.save()
        
        logger.info(f"Wrote FLAC tags to {file_path}: {written}")
        return {'status': 'success', 'format': 'flac', 'written': written}
    
    def _write_wav(
        self,
        file_path: str,
        key: Optional[str],
        bpm: Optional[float],
        energy: Optional[int],
        camelot: Optional[str],
        preserve_existing: bool
    ) -> Dict[str, Any]:
        """Write tags to WAV file using ID3v2 chunk."""
        written = {}
        
        try:
            audio = WAVE(file_path)
            if audio.tags is None:
                audio.add_tags()
        except Exception:
            # WAV may not have tags, create them
            audio = WAVE(file_path)
            audio.add_tags()
        
        tags = audio.tags
        
        # Key
        if key:
            key_value = camelot if camelot else key
            tags.delall('TKEY')
            tags.add(TKEY(encoding=3, text=key_value))
            written['key'] = key_value
        
        # BPM
        if bpm:
            tags.delall('TBPM')
            tags.add(TBPM(encoding=3, text=str(round(bpm, 1))))
            written['bpm'] = round(bpm, 1)
        
        # Energy
        if energy is not None:
            tags.delall('TXXX:ENERGY')
            tags.add(TXXX(encoding=3, desc='ENERGY', text=str(energy)))
            written['energy'] = energy
        
        audio.save()
        
        logger.info(f"Wrote WAV tags to {file_path}: {written}")
        return {'status': 'success', 'format': 'wav', 'written': written}
    
    def read_tags(self, file_path: str) -> Dict[str, Any]:
        """
        Read existing analysis tags from a music file.
        
        Returns:
            Dict with key, bpm, energy if present
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File not found: {file_path}")
        
        ext = os.path.splitext(file_path)[1].lower()
        result = {'file': file_path, 'format': ext[1:]}
        
        try:
            if ext == '.mp3':
                audio = MP3(file_path)
                if audio.tags:
                    if 'TKEY' in audio.tags:
                        result['key'] = str(audio.tags['TKEY'])
                    if 'TBPM' in audio.tags:
                        result['bpm'] = float(str(audio.tags['TBPM']))
                    for frame in audio.tags.getall('TXXX'):
                        if frame.desc == 'ENERGY':
                            result['energy'] = int(frame.text[0])
                        elif frame.desc == 'INITIALKEY':
                            result['initial_key'] = frame.text[0]
                        elif frame.desc == 'MIXEDINAI_CUES':
                            import json
                            result['cue_points'] = json.loads(frame.text[0])
            
            elif ext in ('.m4a', '.mp4', '.aac'):
                audio = MP4(file_path)
                if audio.tags:
                    if 'tmpo' in audio.tags:
                        result['bpm'] = audio.tags['tmpo'][0]
                    key_atom = '----:com.apple.iTunes:INITIALKEY'
                    if key_atom in audio.tags:
                        result['key'] = audio.tags[key_atom][0].decode('utf-8')
                    energy_atom = '----:com.apple.iTunes:ENERGY'
                    if energy_atom in audio.tags:
                        result['energy'] = int(audio.tags[energy_atom][0].decode('utf-8'))
            
            elif ext == '.flac':
                audio = FLAC(file_path)
                if 'INITIALKEY' in audio:
                    result['key'] = audio['INITIALKEY'][0]
                if 'BPM' in audio:
                    result['bpm'] = float(audio['BPM'][0])
                if 'ENERGY' in audio:
                    result['energy'] = int(audio['ENERGY'][0])
            
            elif ext == '.wav':
                audio = WAVE(file_path)
                if audio.tags:
                    if 'TKEY' in audio.tags:
                        result['key'] = str(audio.tags['TKEY'])
                    if 'TBPM' in audio.tags:
                        result['bpm'] = float(str(audio.tags['TBPM']))
        
        except Exception as e:
            logger.warning(f"Error reading tags from {file_path}: {e}")
            result['error'] = str(e)
        
        return result


def embed_analysis_to_file(
    file_path: str,
    analysis: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Convenience function to embed full analysis results into a file.
    
    Args:
        file_path: Path to the audio file
        analysis: Analysis dict from AudioAnalyzer with keys:
            - key: str (e.g., "C major")
            - bpm: float
            - energy: int (1-10)
            - camelot: str (e.g., "8B")
            - cue_points: list
    
    Returns:
        Result dict from ID3Tagger.write_tags()
    """
    tagger = ID3Tagger()
    return tagger.write_tags(
        file_path=file_path,
        key=analysis.get('key'),
        bpm=analysis.get('bpm'),
        energy=analysis.get('energy'),
        camelot=analysis.get('camelot'),
        cue_points=analysis.get('cue_points')
    )


if __name__ == '__main__':
    # Quick test
    import sys
    if len(sys.argv) > 1:
        test_file = sys.argv[1]
        tagger = ID3Tagger()
        
        # Read existing
        print("Reading existing tags:")
        print(tagger.read_tags(test_file))
        
        # Write test data
        print("\nWriting test tags...")
        result = tagger.write_tags(
            test_file,
            key="A minor",
            bpm=128.0,
            energy=7,
            camelot="8A"
        )
        print(f"Write result: {result}")
        
        # Read back
        print("\nReading tags after write:")
        print(tagger.read_tags(test_file))

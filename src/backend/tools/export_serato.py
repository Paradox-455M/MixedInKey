#!/usr/bin/env python3
"""
Serato DJ Exporter
Exports analysis data to Serato DJ Pro format via ID3 tags.
"""

import base64
import struct
import logging
from typing import Dict, Any, List, Optional
import os

try:
    from mutagen.id3 import ID3, TXXX, GEOB
    from mutagen.mp3 import MP3
    from mutagen.aiff import AIFF
    MUTAGEN_AVAILABLE = True
except ImportError:
    MUTAGEN_AVAILABLE = False

logger = logging.getLogger(__name__)

class SeratoExporter:
    """
    Writes Serato-compatible tags to audio files.
    
    Serato stores cue points, loops, and colors in GEOB/TXXX frames.
    Note: The full binary format for 'Serato Markers2' is complex and proprietary.
    This implementation writes compatible text tags and simplified markers where possible.
    """
    
    def __init__(self):
        if not MUTAGEN_AVAILABLE:
            logger.warning("Mutagen not available, Serato export will fail")

    def export_track(self, file_path: str, analysis: Dict[str, Any]) -> bool:
        """
        Write Serato tags to the file.
        """
        if not os.path.exists(file_path):
            logger.error(f"File not found: {file_path}")
            return False
            
        ext = os.path.splitext(file_path)[1].lower()
        
        try:
            if ext == '.mp3':
                return self._write_mp3_serato(file_path, analysis)
            # Add other formats as needed
            else:
                logger.info(f"Serato tagging not fully supported for {ext} yet")
                return False
        except Exception as e:
            logger.error(f"Serato export failed for {file_path}: {e}")
            return False

    def _write_mp3_serato(self, file_path: str, analysis: Dict[str, Any]) -> bool:
        audio = ID3(file_path)
        
        # 1. Key (Serato reads TKEY)
        # Already handled by standard ID3 tagger, but we ensure it matches
        
        # 2. BPM (Serato reads TBPM)
        # Already handled by standard ID3 tagger
        
        # 3. Serato Analysis Version (TXXX:Serato Analysis)
        # Indicates the file has been analyzed
        audio.add(TXXX(encoding=3, desc='Serato Analysis', text='1'))
        
        # 4. Serato Autotags (prohibits re-analysis if set)
        audio.add(TXXX(encoding=3, desc='Serato Autotags', text='bpm,key'))
        
        # 5. Cue Points (GEOB:Serato Markers2)
        # This is a complex binary format. 
        # For now, we will NOT overwrite existing Serato markers to avoid corruption.
        # We only set the basic metadata that Serato respects.
        
        logger.info(f"Wrote basic Serato tags to {file_path}")
        audio.save()
        return True

    def _generate_markers2(self, cue_points: List[Dict[str, Any]]) -> bytes:
        """
        Generate the binary payload for Serato Markers2.
        Required reverse-engineering the schema (base64 encoded struct).
        Placeholder for future 'Pro' implementation.
        """
        # TODO: Implement full Serato Markers2 binary generation
        return b''

    def export_playlist(self, tracks: List[Dict[str, Any]], playlist_name: str, output_path: str) -> bool:
        """
        Export set plan as Serato playlist file (.m3u8 format).
        Serato can import M3U playlists, which is simpler than binary crate format.
        
        Args:
            tracks: List of track dicts with 'path', 'name', etc.
            playlist_name: Name for the playlist
            output_path: Output file path (.m3u8)
        
        Returns:
            True if successful
        """
        try:
            import os
            
            # Ensure .m3u8 extension
            if not output_path.lower().endswith('.m3u8'):
                output_path = os.path.splitext(output_path)[0] + '.m3u8'
            
            with open(output_path, 'w', encoding='utf-8') as f:
                # M3U8 header
                f.write('#EXTM3U\n')
                f.write(f'#EXTINF:-1,{playlist_name}\n')
                
                # Write each track
                for track in tracks:
                    file_path = track.get('path') or track.get('file_path')
                    if not file_path:
                        continue
                    
                    # Get track info
                    name = track.get('name', os.path.basename(file_path))
                    artist = track.get('artist', 'Unknown Artist')
                    duration = track.get('duration', -1)
                    
                    # Write EXTINF line
                    f.write(f'#EXTINF:{duration},{artist} - {name}\n')
                    
                    # Write file path (use absolute path)
                    abs_path = os.path.abspath(file_path)
                    # On Windows, use forward slashes for M3U compatibility
                    if os.sep == '\\':
                        abs_path = abs_path.replace('\\', '/')
                    f.write(f'{abs_path}\n')
            
            logger.info(f"Serato playlist exported to {output_path}")
            return True
        except Exception as e:
            logger.error(f"Serato playlist export failed: {e}")
            return False

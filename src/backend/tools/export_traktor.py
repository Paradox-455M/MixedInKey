#!/usr/bin/env python3
"""
Traktor NML Exporter
Generates Native Instruments Traktor collection files (.nml).
"""

import xml.dom.minidom
import os
import logging
import time
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

class TraktorExporter:
    """Generate Traktor NML v19 files."""
    
    def create_collection(self, tracks: List[Dict[str, Any]], output_path: str = "collection.nml"):
        """
        Create an NML file for a list of analyzed tracks.
        
        Args:
            tracks: List of analysis dicts. Must include 'file_path'.
            output_path: Destination .nml file path
        """
        doc = xml.dom.minidom.Document()
        
        # Root element
        nml = doc.createElement('NML')
        nml.setAttribute('VERSION', '19')
        doc.appendChild(nml)
        
        # Head
        head = doc.createElement('HEAD')
        head.setAttribute('COMPANY', 'Mixed In AI')
        head.setAttribute('PROGRAM', 'Mixed In AI')
        nml.appendChild(head)
        
        # Collection
        collection = doc.createElement('COLLECTION')
        collection.setAttribute('ENTRIES', str(len(tracks)))
        nml.appendChild(collection)
        
        for track_data in tracks:
            entry = self._create_entry(doc, track_data)
            if entry:
                collection.appendChild(entry)
                
        # Write to file
        xml_str = doc.toprettyxml(indent="  ")
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(xml_str)
            
        return output_path

    def _create_entry(self, doc, track_data):
        file_path = track_data.get('file_path') or track_data.get('path')
        if not file_path:
            return None
            
        filename = os.path.basename(file_path)
        folder = os.path.dirname(file_path)
        
        # ENTRY
        entry = doc.createElement('ENTRY')
        entry.setAttribute('MODIFIED_DATE', time.strftime("%Y/%m/%d"))
        entry.setAttribute('MODIFIED_TIME', time.strftime("%H:%M:%S"))
        entry.setAttribute('TITLE', track_data.get('title', filename))
        entry.setAttribute('ARTIST', track_data.get('artist', 'Unknown'))
        
        # LOCATION
        location = doc.createElement('LOCATION')
        location.setAttribute('DIR', folder.replace('/', ':') + ':') # Traktor volume format approx
        location.setAttribute('FILE', filename)
        location.setAttribute('VOLUME', 'Macintosh HD') # Placeholder
        entry.appendChild(location)
        
        # INFO
        info = doc.createElement('INFO')
        bpm = track_data.get('bpm', 0)
        if bpm:
            info.setAttribute('BITRATE', '320000') # Placeholder
            info.setAttribute('GENRE', track_data.get('genre', ''))
            key = track_data.get('key', '')
            if key:
                info.setAttribute('KEY', key)
        entry.appendChild(info)
        
        # TEMPO
        if bpm:
            tempo = doc.createElement('TEMPO')
            tempo.setAttribute('BPM', str(bpm))
            tempo.setAttribute('BPM_QUALITY', '100')
            entry.appendChild(tempo)
            
        # CUE_V2 (Cue Points)
        cues = track_data.get('cue_points', [])
        for i, cue in enumerate(cues):
            cue_node = doc.createElement('CUE_V2')
            cue_node.setAttribute('NAME', cue.get('name', f'Cue {i+1}'))
            cue_node.setAttribute('DISPL_ORDER', str(i))
            cue_node.setAttribute('TYPE', self._map_cue_type(cue.get('type', 'Cue')))
            
            # Start in ms
            start_ms = float(cue.get('time', 0)) * 1000
            cue_node.setAttribute('START', str(start_ms))
            
            entry.appendChild(cue_node)
            
        return entry

    def _map_cue_type(self, cue_type):
        """Map generic cue types to Traktor integers."""
        # 0=Cue, 1=Fade In, 2=Fade Out, 3=Load, 4=Grid, 5=Loop
        t = str(cue_type).lower()
        if 'intro' in t or 'mix in' in t: return '1'
        if 'outro' in t or 'mix out' in t: return '2'
        if 'loop' in t: return '5'
        return '0' # Standard Cue

    def create_playlist(self, tracks: List[Dict[str, Any]], playlist_name: str, output_path: str = "collection.nml"):
        """
        Create Traktor playlist from set plan tracks.
        Adds a PLAYLISTS section with ordered tracks.
        
        Args:
            tracks: List of track dicts with 'file_path', 'name', etc.
            playlist_name: Name for the playlist
            output_path: Destination .nml file path
        """
        doc = xml.dom.minidom.Document()
        
        # Root element
        nml = doc.createElement('NML')
        nml.setAttribute('VERSION', '19')
        doc.appendChild(nml)
        
        # Head
        head = doc.createElement('HEAD')
        head.setAttribute('COMPANY', 'Mixed In AI')
        head.setAttribute('PROGRAM', 'Mixed In AI')
        nml.appendChild(head)
        
        # Collection
        collection = doc.createElement('COLLECTION')
        collection.setAttribute('ENTRIES', str(len(tracks)))
        nml.appendChild(collection)
        
        # Create entries and track IDs
        track_ids = []
        for idx, track_data in enumerate(tracks):
            entry = self._create_entry(doc, track_data)
            if entry:
                track_id = idx + 1
                track_ids.append(track_id)
                collection.appendChild(entry)
        
        # Playlists section
        playlists = doc.createElement('PLAYLISTS')
        nml.appendChild(playlists)
        
        # Playlist node
        playlist_node = doc.createElement('NODE')
        playlist_node.setAttribute('TYPE', '0')
        playlist_node.setAttribute('NAME', 'ROOT')
        playlist_node.setAttribute('COUNT', '1')
        playlists.appendChild(playlist_node)
        
        # Playlist
        playlist = doc.createElement('NODE')
        playlist.setAttribute('TYPE', '1')
        playlist.setAttribute('NAME', playlist_name)
        playlist.setAttribute('KEYTYPE', '0')
        playlist.setAttribute('ENTRIES', str(len(track_ids)))
        playlist_node.appendChild(playlist)
        
        # Add tracks to playlist in order
        for track_id in track_ids:
            track_ref = doc.createElement('PRIMITIVE')
            track_ref.setAttribute('KEY', str(track_id))
            track_ref.setAttribute('TYPE', 'TRACK')
            playlist.appendChild(track_ref)
        
        # Write to file
        xml_str = doc.toprettyxml(indent="  ")
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(xml_str)
        
        return output_path

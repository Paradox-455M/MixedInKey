#!/usr/bin/env python3
"""
Mixed In AI - Export Manager
CLI entry point for exporting analysis data to various formats.
"""

import sys
import os
import argparse
import json
import logging
import traceback

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def main():
    parser = argparse.ArgumentParser(description='Mixed In AI Export Manager')
    parser.add_argument('format', choices=['serato', 'traktor'], help='Export format')
    parser.add_argument('--file', help='Single audio file path (for Serato tagging)')
    parser.add_argument('--json', help='JSON data payload (string)')
    parser.add_argument('--json-file', help='JSON data payload (file path)')
    parser.add_argument('--output', help='Output file path (for Traktor .nml or Serato .m3u8)')
    parser.add_argument('--playlist-name', help='Playlist name (for playlist exports)')
    parser.add_argument('--playlist', action='store_true', help='Export as playlist (not single track)')
    
    args = parser.parse_args()
    
    result = {"status": "error", "message": "Unknown error"}
    
    try:
        # Import tools dynamically
        sys.path.append(os.path.dirname(os.path.abspath(__file__)))
        
        # Load JSON data
        data = None
        if args.json_file:
            with open(args.json_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
        elif args.json:
            data = json.loads(args.json)

        if args.format == 'serato':
            from tools.export_serato import SeratoExporter
            exporter = SeratoExporter()
            
            if args.playlist:
                # Playlist export
                tracks = data if isinstance(data, list) else []
                if not tracks:
                    raise ValueError("Serato playlist export requires tracks list")
                
                playlist_name = args.playlist_name or "Mixed In AI Set"
                output_path = args.output or "playlist.m3u8"
                
                success = exporter.export_playlist(tracks, playlist_name, output_path)
                result = {"status": "success" if success else "error", "file": output_path}
            else:
                # Single track tagging
                if not args.file:
                    raise ValueError("Serato export requires --file path")
                
                analysis = data if isinstance(data, dict) else {}
                success = exporter.export_track(args.file, analysis)
                result = {"status": "success" if success else "error", "file": args.file}

        elif args.format == 'traktor':
            # For Traktor we expect a list of tracks
            tracks = data
            if not isinstance(tracks, list):
                 # fallback if single track object passed?
                 if isinstance(tracks, dict):
                     tracks = [tracks]
                 else:
                     raise ValueError("Traktor export requires JSON tracks list")
            
            from tools.export_traktor import TraktorExporter
            exporter = TraktorExporter()
            
            output_path = args.output or "collection.nml"
            
            if args.playlist:
                # Playlist export
                playlist_name = args.playlist_name or "Mixed In AI Set"
                final_path = exporter.create_playlist(tracks, playlist_name, output_path)
            else:
                # Collection export
                final_path = exporter.create_collection(tracks, output_path)
            
            result = {"status": "success", "file": final_path}
            
    except Exception as e:
        logger.error(f"Export failed: {e}")
        traceback.print_exc()
        result = {"status": "error", "message": str(e), "trace": traceback.format_exc()}

    # Print JSON result to stdout for Electron to read
    print(json.dumps(result))

if __name__ == '__main__':
    main()

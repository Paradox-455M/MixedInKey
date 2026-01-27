#!/usr/bin/env python3
"""
Verify exports work via CLI.
"""
import os
import json
import subprocess
import tempfile

def test_exports():
    print("Testing exports...")
    
    # Create dummy file with valid-ish MP3 frame 
    # FFmpeg-generated silence or just a minimal known valid frame is better
    # Frame sync (11 bits set) + MPEG 1 Layer 3...
    # simple approach: just use a tiny valid mp3 content if possible, or just catch the error in test
    # But better to write something mutagen can read.
    # writing ID3v2.3 header explicitly might help
    # ID3 | ver | flags | size (4 bytes syncsafe)
    id3_header = b'ID3\x03\x00\x00\x00\x00\x00\x0a' 
    with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as f:
        f.write(id3_header + b'\x00'*10)
        dummy_mp3 = f.name
        
    try:
        # 1. Test Serato (needs mutagen, might fail if env issue, but let's try)
        print("Testing Serato export...")
        cmd = [
            "/Users/rahulsharma/Downloads/MixedInKey/venv/bin/python",
            "src/backend/export_manager.py",
            "serato",
            "--file", dummy_mp3,
            "--json", '{"bpm": 128.0, "key": "8A"}'
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, cwd="/Users/rahulsharma/Downloads/MixedInKey")
        print(f"Serato Output: {result.stdout}")
        if "success" in result.stdout:
            print("✅ Serato CLI passed")
        else:
            print(f"❌ Serato CLI failed: {result.stderr}")

        # 2. Test Traktor
        print("\nTesting Traktor export...")
        tracks = [{"file_path": dummy_mp3, "title": "Test Track", "bpm": 128.0, "key": "8A"}]
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as tf:
            json.dump(tracks, tf)
            json_path = tf.name
            
        nml_out = "test_collection.nml"
        cmd = [
            "/Users/rahulsharma/Downloads/MixedInKey/venv/bin/python",
            "src/backend/export_manager.py",
            "traktor",
            "--json-file", json_path,
            "--output", nml_out
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, cwd="/Users/rahulsharma/Downloads/MixedInKey")
        print(f"Traktor Output: {result.stdout}")
        
        if os.path.exists(os.path.join("/Users/rahulsharma/Downloads/MixedInKey", nml_out)):
             print("✅ Traktor NML created")
             os.unlink(os.path.join("/Users/rahulsharma/Downloads/MixedInKey", nml_out))
        else:
             print("❌ Traktor NML missing")

        os.unlink(json_path)
    finally:
        os.unlink(dummy_mp3)

if __name__ == "__main__":
    test_exports()

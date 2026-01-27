#!/usr/bin/env python3
"""
Verify Stems Separator.
"""
import sys
import os

def test_stems():
    print("Testing Stems module...")
    try:
        from src.backend.stems.separator import StemSeparator
        sep = StemSeparator()
        print("✅ StemSeparator initialized")
        
        # Check if we can run check_demucs_installed
        has_demucs = sep.check_demucs_installed()
        print(f"Demucs installed: {has_demucs}")
        
    except ImportError as e:
        print(f"❌ Import failed: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    test_stems()

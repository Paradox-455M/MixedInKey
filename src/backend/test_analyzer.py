import sys
import json
import os

# Ensure we can import analyzer from src/backend
CURRENT_DIR = os.path.dirname(__file__)
BACKEND_DIR = os.path.join(CURRENT_DIR, "src", "backend")
if BACKEND_DIR not in sys.path:
    sys.path.append(BACKEND_DIR)

from analyzer import AudioAnalyzer


def main():
    if len(sys.argv) != 2:
        print("Usage: python test_analyzer.py <audio_file>")
        sys.exit(1)

    file_path = sys.argv[1]
    analyzer = AudioAnalyzer()
    result = analyzer.analyze_audio(file_path)

    if not result or 'cue_points' not in result:
        print("❌ Analysis failed or no cue points found.")
        sys.exit(1)

    print("\n🎧 DJ Cue Points\n----------------------")
    for cue in result['cue_points']:
        t = cue['time']
        name = cue['name']
        ctype = cue['type']
        minutes = int(t // 60)
        seconds = int(t % 60)
        print(f"{name:15s}  [{ctype:10s}]  →  {minutes:02d}:{seconds:02d}")

    print("\n✅ Done. Cues printed in order of appearance.\n")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Test script for the Mixed In AI audio analyzer.
This script tests the analyzer with a simple sine wave to verify functionality.
"""

import sys
import os
import numpy as np
import soundfile as sf
import tempfile
from analyzer import AudioAnalyzer

def create_test_audio(duration=10, sample_rate=44100):
    """Create a test audio file with a simple sine wave."""
    # Create a 440 Hz sine wave (A note)
    t = np.linspace(0, duration, int(sample_rate * duration), False)
    frequency = 440  # A4 note
    audio = 0.3 * np.sin(2 * np.pi * frequency * t)
    
    # Add some harmonics to make it more interesting
    audio += 0.1 * np.sin(2 * np.pi * frequency * 2 * t)  # Second harmonic
    audio += 0.05 * np.sin(2 * np.pi * frequency * 3 * t)  # Third harmonic
    
    return audio, sample_rate

def test_analyzer():
    """Test the audio analyzer with a generated test file."""
    print("🎵 Testing Mixed In AI Audio Analyzer")
    print("=" * 50)
    
    try:
        # Create test audio
        print("📝 Creating test audio file...")
        audio, sr = create_test_audio(duration=10)
        
        # Save to temporary file
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
            sf.write(tmp_file.name, audio, sr)
            test_file_path = tmp_file.name
        
        print(f"✅ Test audio created: {test_file_path}")
        
        # Initialize analyzer
        print("🔧 Initializing analyzer...")
        analyzer = AudioAnalyzer()
        
        # Run analysis
        print("🎼 Running audio analysis...")
        analysis = analyzer.analyze_audio(test_file_path)
        
        # Display results
        print("\n📊 Analysis Results:")
        print("-" * 30)
        print(f"🎼 Key: {analysis['key']}")
        print(f"⚡ BPM: {analysis['bpm']}")
        print(f"⏱️  Duration: {analysis['duration']:.2f}s")
        print(f"🎯 Cue Points: {len(analysis['cue_points'])}")
        print(f"📊 Structure Sections: {len(analysis['structure'])}")
        
        print("\n🎯 Cue Points:")
        for cue in analysis['cue_points']:
            print(f"  - {cue['name']}: {cue['time']:.2f}s ({cue['type']})")
        
        print("\n📊 Song Structure:")
        for section in analysis['structure']:
            print(f"  - {section['type']}: {section['start']:.2f}s - {section['end']:.2f}s")
        
        print("\n✅ Analysis completed successfully!")
        
        # Clean up
        os.unlink(test_file_path)
        print(f"🧹 Cleaned up test file: {test_file_path}")
        
        return True
        
    except Exception as e:
        print(f"❌ Test failed: {str(e)}")
        return False

def test_key_detection():
    """Test key detection specifically."""
    print("\n🎼 Testing Key Detection")
    print("-" * 30)
    
    try:
        from tools.key_detection import KeyDetector
        
        # Create test audio (A major scale)
        audio, sr = create_test_audio(duration=5)
        
        detector = KeyDetector()
        key_analysis = detector.analyze_key_confidence(audio, sr)
        
        print(f"🎼 Detected Key: {key_analysis['final_key']}")
        print(f"📊 Display Name: {key_analysis['display_name']}")
        print(f"🎯 Confidence: {key_analysis['confidence']:.2f}")
        print(f"✅ Methods Agree: {key_analysis['methods_agree']}")
        
        print("\n🔗 Compatible Keys:")
        for key in key_analysis['compatible_keys']:
            print(f"  - {key}")
        
        return True
        
    except Exception as e:
        print(f"❌ Key detection test failed: {str(e)}")
        return False

def test_rhythm_analysis():
    """Test rhythm analysis specifically."""
    print("\n⚡ Testing Rhythm Analysis")
    print("-" * 30)
    
    try:
        from tools.rhythm_analysis import RhythmAnalyzer
        
        # Create test audio with beat
        duration = 10
        sr = 44100
        t = np.linspace(0, duration, int(sr * duration), False)
        
        # Create a beat pattern (120 BPM)
        bpm = 120
        beat_interval = 60.0 / bpm
        beat_times = np.arange(0, duration, beat_interval)
        
        audio = np.zeros_like(t)
        for beat_time in beat_times:
            beat_start = int(beat_time * sr)
            beat_end = min(beat_start + int(0.1 * sr), len(audio))
            audio[beat_start:beat_end] = 0.5 * np.sin(2 * np.pi * 440 * t[beat_start:beat_end])
        
        analyzer = RhythmAnalyzer()
        
        # Test basic BPM detection
        bpm, beats = analyzer.detect_bpm_librosa(audio, sr)
        print(f"⚡ Detected BPM: {bpm}")
        print(f"🎯 Beat Count: {len(beats)}")
        
        # Test downbeat detection
        downbeats = analyzer.detect_downbeats(audio, sr)
        print(f"📊 Downbeat Count: {len(downbeats)}")
        
        # Test time signature detection
        time_sig = analyzer.detect_time_signature(audio, sr)
        print(f"📏 Time Signature: {time_sig['numerator']}/{time_sig['denominator']}")
        print(f"🎯 Time Sig Confidence: {time_sig['confidence']:.2f}")
        
        return True
        
    except Exception as e:
        print(f"❌ Rhythm analysis test failed: {str(e)}")
        return False

def main():
    """Run all tests."""
    print("🧪 Mixed In AI - Test Suite")
    print("=" * 50)
    
    tests = [
        ("Main Analyzer", test_analyzer),
        ("Key Detection", test_key_detection),
        ("Rhythm Analysis", test_rhythm_analysis)
    ]
    
    passed = 0
    total = len(tests)
    
    for test_name, test_func in tests:
        print(f"\n🔬 Running {test_name} test...")
        if test_func():
            passed += 1
            print(f"✅ {test_name} test passed!")
        else:
            print(f"❌ {test_name} test failed!")
    
    print(f"\n📊 Test Results: {passed}/{total} tests passed")
    
    if passed == total:
        print("🎉 All tests passed! The analyzer is working correctly.")
        return 0
    else:
        print("⚠️  Some tests failed. Please check the error messages above.")
        return 1

if __name__ == "__main__":
    sys.exit(main()) 
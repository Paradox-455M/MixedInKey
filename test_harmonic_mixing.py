#!/usr/bin/env python3
"""
Test script for harmonic mixing and energy analysis features.
"""

import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), 'src', 'backend'))

def test_harmonic_mixing():
    """Test harmonic mixing functionality."""
    print("Testing Harmonic Mixing...")
    
    try:
        from tools.harmonic_mixing import HarmonicMixer
        
        mixer = HarmonicMixer()
        
        # Test compatible keys
        test_key = "8A"  # A♭ Major
        compatible_keys = mixer.get_compatible_keys(test_key)
        
        print(f"Compatible keys for {test_key}:")
        for key in compatible_keys[:3]:  # Show first 3
            print(f"  - {key['key']}: {key['description']} (Compatibility: {key['compatibility']:.2f})")
        
        # Test mixing suggestions
        suggestions = mixer.get_mixing_suggestions(test_key)
        print(f"\nMixing suggestions for {test_key}:")
        print(f"  - Energy build suggestions: {len(suggestions['energy_build_suggestions'])}")
        print(f"  - Energy release suggestions: {len(suggestions['energy_release_suggestions'])}")
        
        return True
        
    except Exception as e:
        print(f"Harmonic mixing test failed: {str(e)}")
        return False

def test_energy_analysis():
    """Test energy analysis functionality."""
    print("\nTesting Energy Analysis...")
    
    try:
        from tools.energy_analysis import EnergyAnalyzer
        
        analyzer = EnergyAnalyzer()
        
        # Test energy level classification
        test_energies = [1, 3, 5, 7, 9]
        for energy in test_energies:
            level = analyzer._classify_energy_level(energy)
            print(f"  Energy {energy} -> {level.name}")
        
        # Test energy mixing suggestions
        suggestions = analyzer.get_energy_mixing_suggestions(5, 8)
        print(f"\nEnergy mixing suggestions (5 -> 8):")
        print(f"  - Build suggestions: {len(suggestions['energy_build_suggestions'])}")
        print(f"  - Techniques: {len(suggestions['energy_techniques'])}")
        
        return True
        
    except Exception as e:
        print(f"Energy analysis test failed: {str(e)}")
        return False

def test_advanced_mixing():
    """Test advanced mixing functionality."""
    print("\nTesting Advanced Mixing...")
    
    try:
        from tools.advanced_mixing import AdvancedMixer
        
        mixer = AdvancedMixer()
        
        # Test harmonic energy suggestions
        suggestions = mixer.get_harmonic_energy_suggestions("8A", 5)
        print(f"Harmonic energy suggestions for 8A (energy 5):")
        for suggestion in suggestions[:2]:  # Show first 2
            print(f"  - {suggestion['key']}: {suggestion['description']}")
        
        # Test beat jump opportunities
        mock_track = {
            'key': '8A',
            'energy': 5,
            'name': 'Test Track',
            'cue_points': [
                {'name': 'Intro', 'time': 0, 'type': 'intro'},
                {'name': 'Drop', 'time': 60, 'type': 'drop'},
                {'name': 'Breakdown', 'time': 120, 'type': 'breakdown'}
            ]
        }
        
        opportunities = mixer.analyze_beat_jump_opportunities(mock_track)
        print(f"\nBeat jump opportunities: {len(opportunities)}")
        for opp in opportunities:
            print(f"  - {opp['cue_point']}: {opp['description']}")
        
        return True
        
    except Exception as e:
        print(f"Advanced mixing test failed: {str(e)}")
        return False

def main():
    """Run all tests."""
    print("Testing MixedInKey Advanced Features")
    print("=" * 40)
    
    tests = [
        test_harmonic_mixing,
        test_energy_analysis,
        test_advanced_mixing
    ]
    
    passed = 0
    total = len(tests)
    
    for test in tests:
        if test():
            passed += 1
    
    print(f"\n{'=' * 40}")
    print(f"Tests passed: {passed}/{total}")
    
    if passed == total:
        print("✅ All tests passed!")
    else:
        print("❌ Some tests failed.")
    
    return passed == total

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1) 
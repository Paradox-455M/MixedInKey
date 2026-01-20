import math

from mix_scorecard import build_mix_scorecard


def test_build_mix_scorecard_basic():
    analysis = {
        "bpm": 120,
        "key": "8A",
        "key_confidence": 0.9,
        "beatgrid": [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0],
        "cues": [
            {"type": "intro", "time": 0.0},
            {"type": "drop", "time": 16.0},
            {"type": "outro", "time": 96.0},
        ],
        "segments": [
            {"type": "intro", "start": 0.0, "end": 16.0},
            {"type": "outro", "start": 96.0, "end": 112.0},
        ],
        "energy_analysis": {
            "energy_profile": [
                {"energy": 3.0},
                {"energy": 5.0},
                {"energy": 7.0},
                {"energy": 6.0},
            ]
        },
        "audio_stats": {"peak_dbfs": -3.5},
    }

    scorecard = build_mix_scorecard(analysis)
    assert "overall_score" in scorecard
    assert "categories" in scorecard
    assert "checks" in scorecard
    assert scorecard["overall_score"] is None or math.isfinite(scorecard["overall_score"])


if __name__ == "__main__":
    test_build_mix_scorecard_basic()
    print("mix_scorecard test passed")

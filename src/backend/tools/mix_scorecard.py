"""
Mix quality scorecard for DJ mixing standards.
Produces explicit checks and a weighted score summary.
"""

from typing import Dict, Any, List, Optional, Tuple
import math
import re

CAMELot_RE = re.compile(r"^(?:[1-9]|1[0-2])[AB]$")

PHRASE_CUE_TYPES = {
    "intro",
    "outro",
    "drop",
    "chorus",
    "hook",
    "breakdown",
    "bridge",
    "verse",
    "vocal",
    "build_up",
    "build_up_start",
    "breakdown_start",
    "chorus_start",
    "chorus_end",
    "outro_start",
}


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _mean(values: List[float]) -> Optional[float]:
    if not values:
        return None
    return sum(values) / float(len(values))


def _median(values: List[float]) -> Optional[float]:
    if not values:
        return None
    values = sorted(values)
    mid = len(values) // 2
    if len(values) % 2 == 0:
        return (values[mid - 1] + values[mid]) / 2.0
    return values[mid]


def _status_for_score(score: Optional[float]) -> str:
    if score is None:
        return "unknown"
    if score >= 85:
        return "good"
    if score >= 70:
        return "ok"
    return "poor"


def _build_check(
    check_id: str,
    label: str,
    score: Optional[float],
    summary: str,
    details: Optional[Dict[str, Any]] = None,
    issue: Optional[str] = None,
    suggestion: Optional[str] = None,
) -> Dict[str, Any]:
    return {
        "id": check_id,
        "label": label,
        "score": None if score is None else round(float(score), 1),
        "status": _status_for_score(score),
        "summary": summary,
        "details": details or {},
        "issue": issue,
        "suggestion": suggestion,
    }


def _get_beat_interval(bpm: Optional[float], beatgrid: List[float]) -> Optional[float]:
    if bpm and bpm > 0:
        return 60.0 / float(bpm)
    if beatgrid and len(beatgrid) >= 2:
        intervals = [beatgrid[i + 1] - beatgrid[i] for i in range(len(beatgrid) - 1)]
        intervals = [v for v in intervals if v > 0.0]
        return _median(intervals)
    return None


def _score_beatgrid_stability(beatgrid: List[float]) -> Dict[str, Any]:
    if not beatgrid or len(beatgrid) < 8:
        return _build_check(
            "beatgrid_stability",
            "Beatgrid stability",
            None,
            "Beatgrid unavailable or too short for stability check.",
            {"beats": len(beatgrid) if beatgrid else 0},
        )

    intervals = [beatgrid[i + 1] - beatgrid[i] for i in range(len(beatgrid) - 1)]
    intervals = [v for v in intervals if v > 0.0]
    if len(intervals) < 4:
        return _build_check(
            "beatgrid_stability",
            "Beatgrid stability",
            None,
            "Beatgrid intervals insufficient for stability check.",
            {"beats": len(beatgrid)},
        )

    median_interval = _median(intervals) or 0.0
    avg_interval = _mean(intervals) or 0.0
    variance = _mean([(v - avg_interval) ** 2 for v in intervals]) or 0.0
    jitter_ratio = math.sqrt(variance) / median_interval if median_interval > 0 else None

    score = None
    if jitter_ratio is not None:
        if jitter_ratio <= 0.015:
            score = 95
        elif jitter_ratio <= 0.03:
            score = 88
        elif jitter_ratio <= 0.05:
            score = 78
        elif jitter_ratio <= 0.08:
            score = 65
        else:
            score = 50

    issue = None
    suggestion = None
    if score is not None and score < 70:
        issue = "Beatgrid jitter is high; long blends may drift."
        suggestion = "Verify beatgrid or reanalyze to improve beat alignment."

    summary = (
        f"Median beat interval {median_interval:.3f}s with jitter {jitter_ratio:.3f}"
        if jitter_ratio is not None
        else "Beatgrid stability could not be estimated."
    )

    return _build_check(
        "beatgrid_stability",
        "Beatgrid stability",
        score,
        summary,
        {
            "beats": len(beatgrid),
            "median_interval_sec": round(median_interval, 4),
            "jitter_ratio": None if jitter_ratio is None else round(jitter_ratio, 4),
        },
        issue,
        suggestion,
    )


def _score_phrase_alignment(
    cues: List[Dict[str, Any]], beatgrid: List[float], bpm: Optional[float]
) -> Dict[str, Any]:
    if not cues:
        return _build_check(
            "phrase_alignment",
            "Phrase alignment",
            None,
            "No cues available for phrase alignment check.",
        )

    beat_sec = _get_beat_interval(bpm, beatgrid)
    if not beat_sec:
        return _build_check(
            "phrase_alignment",
            "Phrase alignment",
            None,
            "Missing BPM/beatgrid for phrase alignment check.",
        )

    beat_zero = beatgrid[0] if beatgrid else 0.0
    relevant = [c for c in cues if str(c.get("type", "")).lower() in PHRASE_CUE_TYPES]
    if len(relevant) < 2:
        return _build_check(
            "phrase_alignment",
            "Phrase alignment",
            None,
            "Not enough cue points for phrase alignment check.",
            {"cue_count": len(relevant)},
        )

    tolerance_beats = 0.25
    aligned = 0
    for cue in relevant:
        t = float(cue.get("time", 0.0))
        beats_from_start = (t - beat_zero) / beat_sec
        if beats_from_start < 0:
            continue
        bar_pos = beats_from_start / 4.0
        if abs(bar_pos - round(bar_pos)) * 4.0 <= tolerance_beats:
            aligned += 1

    total = len(relevant)
    ratio = aligned / float(total) if total else 0.0

    if ratio >= 0.85:
        score = 95
    elif ratio >= 0.7:
        score = 85
    elif ratio >= 0.55:
        score = 70
    elif ratio >= 0.4:
        score = 55
    else:
        score = 40

    issue = None
    suggestion = None
    if score < 70:
        issue = "Cues are not consistently aligned to bar boundaries."
        suggestion = "Move cues to bar 1 or bar 9 to keep 16/32-bar phrasing."

    summary = f"{aligned}/{total} cues aligned to bar boundaries."

    return _build_check(
        "phrase_alignment",
        "Phrase alignment",
        score,
        summary,
        {"aligned": aligned, "total": total, "tolerance_beats": tolerance_beats},
        issue,
        suggestion,
    )


def _segment_duration(segments: List[Dict[str, Any]], seg_type: str) -> Optional[float]:
    for seg in segments:
        if str(seg.get("type", "")).lower() != seg_type:
            continue
        start = seg.get("start", seg.get("start_time"))
        end = seg.get("end", seg.get("end_time"))
        if start is None or end is None:
            continue
        try:
            duration = float(end) - float(start)
            if duration > 0.1:
                return duration
        except Exception:
            continue
    return None


def _estimate_mix_window_from_cues(
    cues: List[Dict[str, Any]], target_type: str
) -> Optional[float]:
    if not cues:
        return None
    sorted_cues = sorted(cues, key=lambda c: float(c.get("time", 0.0)))
    cue_times = [(str(c.get("type", "")).lower(), float(c.get("time", 0.0))) for c in sorted_cues]
    if target_type == "intro":
        intro_times = [t for t_type, t in cue_times if t_type == "intro"]
        if not intro_times:
            return None
        intro_time = intro_times[0]
        next_times = [t for t_type, t in cue_times if t > intro_time and t_type != "intro"]
        if not next_times:
            return None
        return max(0.0, next_times[0] - intro_time)
    if target_type == "outro":
        outro_times = [t for t_type, t in cue_times if t_type == "outro"]
        if not outro_times:
            return None
        outro_time = outro_times[-1]
        prev_times = [t for t_type, t in cue_times if t < outro_time and t_type != "outro"]
        if not prev_times:
            return None
        return max(0.0, outro_time - prev_times[-1])
    return None


def _score_mix_windows(
    cues: List[Dict[str, Any]],
    segments: List[Dict[str, Any]],
    bpm: Optional[float],
    beatgrid: List[float],
) -> Dict[str, Any]:
    intro_duration = _segment_duration(segments, "intro")
    outro_duration = _segment_duration(segments, "outro")

    if intro_duration is None:
        intro_duration = _estimate_mix_window_from_cues(cues, "intro")
    if outro_duration is None:
        outro_duration = _estimate_mix_window_from_cues(cues, "outro")

    bar_sec = None
    beat_sec = _get_beat_interval(bpm, beatgrid)
    if beat_sec:
        bar_sec = beat_sec * 4.0

    def duration_to_bars(duration: Optional[float]) -> Optional[float]:
        if duration is None:
            return None
        if bar_sec:
            return duration / bar_sec
        # fallback seconds heuristic (assume 120 BPM)
        return duration / 2.0

    intro_bars = duration_to_bars(intro_duration)
    outro_bars = duration_to_bars(outro_duration)

    durations = [v for v in [intro_bars, outro_bars] if v is not None]
    if not durations:
        return _build_check(
            "mix_windows",
            "Mix-in/out windows",
            None,
            "Intro/outro windows could not be estimated.",
        )

    min_bars = min(durations)
    both_present = intro_bars is not None and outro_bars is not None

    if both_present:
        if min_bars >= 8:
            score = 95
        elif min_bars >= 4:
            score = 80
        elif min_bars >= 2:
            score = 60
        else:
            score = 45
    else:
        if min_bars >= 8:
            score = 75
        elif min_bars >= 4:
            score = 60
        else:
            score = 45

    issue = None
    suggestion = None
    if score < 70:
        issue = "Intro or outro mix window is short."
        suggestion = "Create a longer mix-in/out section (8+ bars) if possible."

    summary = "Intro {:.1f} bars, Outro {:.1f} bars.".format(
        intro_bars if intro_bars is not None else 0.0,
        outro_bars if outro_bars is not None else 0.0,
    )

    return _build_check(
        "mix_windows",
        "Mix-in/out windows",
        score,
        summary,
        {"intro_bars": intro_bars, "outro_bars": outro_bars},
        issue,
        suggestion,
    )


def _score_cue_coverage(cues: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not cues:
        return _build_check(
            "cue_coverage",
            "Cue coverage",
            None,
            "No cues available for coverage check.",
        )

    types = {str(c.get("type", "")).lower() for c in cues}
    has_intro = "intro" in types
    has_outro = "outro" in types
    has_peak = bool(types.intersection({"drop", "chorus", "hook"}))
    has_break = bool(types.intersection({"breakdown", "bridge", "breakdown_start"}))

    score = 50
    if has_intro and has_outro:
        score = 80
    if has_peak:
        score += 10
    if has_break:
        score += 10
    score = _clamp(score, 40, 100)

    issue = None
    suggestion = None
    if not has_intro or not has_outro:
        issue = "Intro/outro cues are missing."
        suggestion = "Set mix-in and mix-out cue points before live play."

    summary = f"Intro: {has_intro}, Outro: {has_outro}, Peak: {has_peak}, Breakdown: {has_break}"

    return _build_check(
        "cue_coverage",
        "Cue coverage",
        score,
        summary,
        {"has_intro": has_intro, "has_outro": has_outro, "has_peak": has_peak, "has_breakdown": has_break},
        issue,
        suggestion,
    )


def _score_key_confidence(key: Optional[str], key_confidence: Optional[float]) -> Dict[str, Any]:
    if key_confidence is None:
        return _build_check(
            "key_confidence",
            "Key confidence",
            None,
            "Key confidence is unavailable.",
        )

    conf = float(key_confidence)
    if conf <= 1.0:
        score = conf * 100.0
    else:
        score = conf
    score = _clamp(score, 0.0, 100.0)

    if key and not CAMELot_RE.match(str(key)):
        score = max(0.0, score - 10.0)

    issue = None
    suggestion = None
    if score < 70:
        issue = "Key confidence is low; harmonic mixing may be unreliable."
        suggestion = "Verify key manually or analyze with another detector."

    summary = f"Key {key or 'unknown'} with confidence {conf:.2f}."

    return _build_check(
        "key_confidence",
        "Key confidence",
        score,
        summary,
        {"key": key, "confidence": conf},
        issue,
        suggestion,
    )


def _score_headroom(peak_dbfs: Optional[float]) -> Dict[str, Any]:
    if peak_dbfs is None:
        return _build_check(
            "headroom",
            "Headroom",
            None,
            "Peak level unavailable for headroom check.",
        )

    peak = float(peak_dbfs)
    if peak > -0.1:
        score = 50
    elif peak > -1.0:
        score = 60
    elif peak > -3.0:
        score = 80
    elif peak > -6.0:
        score = 95
    elif peak > -12.0:
        score = 80
    else:
        score = 65

    issue = None
    suggestion = None
    if peak > -1.0:
        issue = "Track is very hot; clipping risk when stacking lows."
        suggestion = "Reduce channel gain before blending or add headroom."
    elif peak < -12.0:
        issue = "Track is quiet; may require gain boost."
        suggestion = "Increase channel gain or normalize the track."

    summary = f"Peak level {peak:.2f} dBFS."

    return _build_check(
        "headroom",
        "Headroom",
        score,
        summary,
        {"peak_dbfs": peak},
        issue,
        suggestion,
    )


def _score_energy_flow(energy_profile: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not energy_profile or len(energy_profile) < 2:
        return _build_check(
            "energy_flow",
            "Energy flow",
            None,
            "Energy profile unavailable for flow check.",
        )

    values: List[float] = []
    for seg in energy_profile:
        try:
            values.append(float(seg.get("energy", 0.0)))
        except Exception:
            continue

    if not values or len(values) < 2:
        return _build_check(
            "energy_flow",
            "Energy flow",
            None,
            "Energy profile values unavailable for flow check.",
        )

    if max(values) <= 1.5:
        values = [v * 10.0 for v in values]

    deltas = [abs(values[i + 1] - values[i]) for i in range(len(values) - 1)]
    avg_delta = _mean(deltas) or 0.0
    jump_ratio = len([d for d in deltas if d >= 3.0]) / float(len(deltas))

    if jump_ratio <= 0.2:
        score = 90
    elif jump_ratio <= 0.4:
        score = 75
    elif jump_ratio <= 0.6:
        score = 60
    else:
        score = 45

    if avg_delta <= 1.5:
        score = _clamp(score + 5, 0.0, 100.0)
    elif avg_delta >= 4.0:
        score = _clamp(score - 5, 0.0, 100.0)

    issue = None
    suggestion = None
    if score < 70:
        issue = "Energy jumps are large; transitions may feel abrupt."
        suggestion = "Use breakdowns or long blends to smooth energy changes."

    summary = f"Average energy change {avg_delta:.2f}, jump ratio {jump_ratio:.2f}."

    return _build_check(
        "energy_flow",
        "Energy flow",
        score,
        summary,
        {"avg_delta": avg_delta, "jump_ratio": jump_ratio},
        issue,
        suggestion,
    )


def _average_scores(scores: List[Optional[float]]) -> Optional[float]:
    valid = [s for s in scores if s is not None]
    if not valid:
        return None
    return sum(valid) / float(len(valid))


def build_mix_scorecard(analysis: Dict[str, Any]) -> Dict[str, Any]:
    cues = analysis.get("cues") or analysis.get("cue_points") or []
    beatgrid = analysis.get("beatgrid") or (analysis.get("pipeline", {}) or {}).get("beatgrid") or []
    bpm = analysis.get("bpm")
    segments = analysis.get("segments") or analysis.get("song_structure") or analysis.get("structure") or []
    energy_profile = (
        (analysis.get("energy_analysis") or {}).get("energy_profile")
        or analysis.get("energy_profile")
        or []
    )
    key = analysis.get("key")
    key_confidence = analysis.get("key_confidence")
    audio_stats = analysis.get("audio_stats") or {}
    peak_dbfs = audio_stats.get("peak_dbfs")

    checks = [
        _score_cue_coverage(cues),
        _score_mix_windows(cues, segments, bpm, beatgrid),
        _score_beatgrid_stability(beatgrid),
        _score_phrase_alignment(cues, beatgrid, bpm),
        _score_key_confidence(key, key_confidence),
        _score_headroom(peak_dbfs),
        _score_energy_flow(energy_profile),
    ]

    check_map = {c["id"]: c for c in checks}

    categories = [
        {
            "id": "prep",
            "label": "Preparation and cues",
            "checks": ["cue_coverage", "mix_windows"],
            "weight": 0.2,
        },
        {
            "id": "timing",
            "label": "Timing and phrasing",
            "checks": ["beatgrid_stability", "phrase_alignment"],
            "weight": 0.25,
        },
        {
            "id": "harmonic",
            "label": "Harmonic readiness",
            "checks": ["key_confidence"],
            "weight": 0.2,
        },
        {
            "id": "loudness",
            "label": "Loudness and headroom",
            "checks": ["headroom"],
            "weight": 0.15,
        },
        {
            "id": "energy",
            "label": "Energy flow",
            "checks": ["energy_flow"],
            "weight": 0.2,
        },
    ]

    category_results = []
    for cat in categories:
        scores = [check_map[cid]["score"] for cid in cat["checks"] if cid in check_map]
        score = _average_scores(scores)
        category_results.append(
            {
                "id": cat["id"],
                "label": cat["label"],
                "score": None if score is None else round(float(score), 1),
                "status": _status_for_score(score),
                "checks": cat["checks"],
                "weight": cat["weight"],
            }
        )

    weighted_scores = [
        (cat["score"], cat["weight"]) for cat in category_results if cat["score"] is not None
    ]
    if weighted_scores:
        total_weight = sum(w for _, w in weighted_scores)
        overall_score = sum(score * weight for score, weight in weighted_scores) / total_weight
    else:
        overall_score = None

    grade = "Unknown"
    if overall_score is not None:
        if overall_score >= 85:
            grade = "Pro"
        elif overall_score >= 70:
            grade = "Good"
        elif overall_score >= 55:
            grade = "Needs Work"
        else:
            grade = "Fix"

    issues = []
    suggestions = []
    for check in checks:
        score = check.get("score")
        if score is None:
            continue
        if check.get("issue") and score < 70:
            severity = "critical" if score < 55 else "warning"
            issues.append(
                {
                    "severity": severity,
                    "check_id": check["id"],
                    "message": check["issue"],
                    "summary": check["summary"],
                }
            )
        if check.get("suggestion") and score < 80:
            suggestions.append(
                {
                    "check_id": check["id"],
                    "message": check["suggestion"],
                }
            )

    return {
        "overall_score": None if overall_score is None else round(float(overall_score), 1),
        "grade": grade,
        "categories": category_results,
        "checks": checks,
        "issues": issues,
        "suggestions": suggestions,
        "inputs": {
            "bpm": bpm,
            "beatgrid_beats": len(beatgrid) if beatgrid else 0,
            "cue_count": len(cues) if cues else 0,
        },
    }

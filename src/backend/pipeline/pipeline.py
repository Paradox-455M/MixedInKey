from typing import Dict, Any, List, Optional
import math
import traceback

from .autocue_stage import AutoCueStage
from .aubio_stage import AubioStage
from .pyaudio_stage import PyAudioStage
from .analyzer_stage import AnalyzerStage
from .chorus_hook_stage import ChorusHookStage
from .bridge_energy_gap import BridgeEnergyGapStage
from .hotcue_stage import HotCueStage


def _nearest_beat(t: float, beatgrid: List[float]) -> float:
    if not beatgrid:
        return float(t)
    idx = min(range(len(beatgrid)), key=lambda i: abs(beatgrid[i] - t))
    return float(beatgrid[idx])


def _merge_cues(*lists: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    merged: List[Dict[str, Any]] = []
    for lst in lists:
        merged.extend(lst or [])
    return merged


def _dedup_and_space(cues: List[Dict[str, Any]], min_spacing: float = 6.0) -> List[Dict[str, Any]]:
    cues = sorted(cues, key=lambda c: c.get("time", 0.0))
    pruned: List[Dict[str, Any]] = []
    for c in cues:
        t = float(c.get("time", 0.0))
        if pruned and abs(t - pruned[-1]["time"]) < min_spacing:
            # keep the higher confidence one
            if c.get("confidence", 0.0) > pruned[-1].get("confidence", 0.0):
                pruned[-1] = c
            continue
        pruned.append(c)
    return pruned


# ----------------------- Conflict-aware AI Cue Orchestrator ----------------------- #
PRIORITY_ORDER: List[str] = [
    "drop",            # 1. Drop (all sources)
    "outro",           # 2. Outro
    "chorus", "hook",  # 3. Chorus/Hook
    "bridge",          # 4. Bridge (energy gap)
    "intro",           # 5. Intro
    "vocal",           # 6. Vocals
    "section",         # 7. Boundaries
]

SNAP_TYPES = {"intro", "drop", "chorus", "hook", "bridge", "outro"}

GROUPS = {
    "intro_group": {"intro", "mix_in"},
    "outro_group": {"outro", "mix_out"},
    "vocal_group": {"vocal", "verse"},
    "chorus_group": {"chorus", "hook"},
    "energy_group": {"drop", "bridge", "breakdown"},
    "misc_group": {"section"},
}


def _priority_index(t: str) -> int:
    t = (t or "").lower()
    for i, k in enumerate(PRIORITY_ORDER):
        if t == k:
            return i
    # put unknowns at the end
    return len(PRIORITY_ORDER) + 1


def _standardize(cue: Dict[str, Any], stage: str) -> Dict[str, Any]:
    """Ensure cue schema consistency and attach stage."""
    return {
        "name": str(cue.get("name", cue.get("type", "Cue"))),
        "type": str(cue.get("type", "cue")).lower(),
        "time": float(cue.get("time", 0.0)),
        "confidence": float(cue.get("confidence", 0.6)),
        "reason": str(cue.get("reason", stage)),
        "stage": stage,
    }


def _valid_time(t: Any, duration: Optional[float]) -> bool:
    try:
        ft = float(t)
        if not (ft >= 0.0):  # rejects NaN/neg
            return False
        if duration is not None and ft > duration:
            return False
        return True
    except Exception:
        return False


class CuePipeline:
    """
    Master orchestrator that runs stages in this order:
    raw audio → autocue_stage → aubio_stage → pyaudio_stage → analyzer_stage
              → chorus_hook_stage → bridge_energy_gap → final merged cue set
    """

    def __init__(self):
        self.autocue = AutoCueStage()
        self.aubio = AubioStage()
        self.pyaudio = PyAudioStage()
        self.analyzer = AnalyzerStage()
        self.chorus_hook = ChorusHookStage()
        self.bridge = BridgeEnergyGapStage()

    def run(self, file_path: str) -> Dict[str, Any]:
        logs: List[str] = []
        # 1) Execute stages defensively
        try:
            s_autocue = self.autocue.run(file_path)
        except Exception:
            logs.append("autocue_stage failed: " + traceback.format_exc(limit=1))
            s_autocue = {"cues": []}
        try:
            s_aubio = self.aubio.run(file_path)
        except Exception:
            logs.append("aubio_stage failed: " + traceback.format_exc(limit=1))
            s_aubio = {"beatgrid": [], "cues": []}
        try:
            s_pyaudio = self.pyaudio.run(file_path)
        except Exception:
            logs.append("pyaudio_stage failed: " + traceback.format_exc(limit=1))
            s_pyaudio = {"cues": []}
        try:
            s_analyzer = self.analyzer.run(file_path)
        except Exception:
            logs.append("analyzer_stage failed: " + traceback.format_exc(limit=1))
            s_analyzer = {"cues": [], "bpm": None}
        try:
            s_ch = self.chorus_hook.run(file_path)
        except Exception:
            logs.append("chorus_hook_stage failed: " + traceback.format_exc(limit=1))
            s_ch = {"cues": []}
        try:
            s_bridge = self.bridge.run(file_path)
        except Exception:
            logs.append("bridge_energy_gap failed: " + traceback.format_exc(limit=1))
            s_bridge = {"cues": []}

        beatgrid: List[float] = s_aubio.get("beatgrid", []) or []

        # 2) Determine duration (best-effort)
        duration: Optional[float] = None
        try:
            import librosa  # optional
            y, sr = librosa.load(file_path, mono=True, sr=None)
            duration = float(len(y) / sr)
        except Exception:
            duration = None

        # 3) Build standardized cue list with stage tags
        stage_cue_sets = [
            ("autocue", s_autocue.get("cues", [])),
            ("pyaudio", s_pyaudio.get("cues", [])),
            ("analyzer", s_analyzer.get("cues", [])),
            ("chorus_hook", s_ch.get("cues", [])),
            ("bridge", s_bridge.get("cues", [])),
        ]
        raw_cues: List[Dict[str, Any]] = []
        for stage_name, lst in stage_cue_sets:
            for c in (lst or []):
                std = _standardize(c, stage_name)
                raw_cues.append(std)
                logs.append(f"stage={stage_name} add {std['type']}@{std['time']:.2f}s conf={std['confidence']:.2f}")

        # 4) Validity filtering and minimal structure
        valid: List[Dict[str, Any]] = []
        for c in raw_cues:
            t = c["time"]
            if not _valid_time(t, duration):
                logs.append(f"discard invalid time: {c}")
                continue
            if c["type"] in {"breakdown", "bridge"} and t < 8.0:
                logs.append(f"discard early energy cue (<8s): {c}")
                continue
            valid.append(c)

        # Minimal structure defaults
        bpm = s_analyzer.get("bpm")
        bar_sec = 60.0 / float(bpm) * 4.0 if bpm and bpm > 0 else 8.0
        # find intro/outro candidates
        intro = next((c for c in valid if c["type"] == "intro"), None)
        if not intro:
            valid.append({"name": "Mix In", "type": "intro", "time": 0.0, "confidence": 0.7, "reason": "fallback", "stage": "pipeline"})
            logs.append("added fallback intro at 0.00s")
        outro = next((c for c in valid if c["type"] == "outro"), None)
        if not outro and duration is not None:
            t = max(0.0, duration - 12.0)
            valid.append({"name": "Mix Out", "type": "outro", "time": t, "confidence": 0.7, "reason": "fallback", "stage": "pipeline"})
            logs.append(f"added fallback outro at {t:.2f}s")

        # 5) Apply ordering validity (DROP/OUTRO > INTRO + 4 bars)
        intro_time = next((c["time"] for c in valid if c["type"] == "intro"), 0.0)
        for c in valid:
            if c["type"] == "drop" and c["time"] <= intro_time + bar_sec:
                old = c["time"]
                c["time"] = intro_time + bar_sec + 0.1
                logs.append(f"adjust drop from {old:.2f}s -> {c['time']:.2f}s (intro+4bars)")
            if c["type"] == "outro" and c["time"] <= intro_time + bar_sec:
                old = c["time"]
                c["time"] = intro_time + bar_sec + 4.0
                logs.append(f"adjust outro from {old:.2f}s -> {c['time']:.2f}s (intro+4bars)")

        # 6) Conflict resolution within 6s window
        # Keep >0.75 confidence always; otherwise use priority, then confidence, then earlier time
        valid.sort(key=lambda c: c["time"])
        resolved: List[Dict[str, Any]] = []
        window = 6.0
        for c in valid:
            if not resolved:
                resolved.append(c)
                continue
            last = resolved[-1]
            if abs(c["time"] - last["time"]) < window:
                # If types are drop/outro together at the same spot, keep both but separate by 0.5s
                if {c["type"], last["type"]} == {"drop", "outro"}:
                    if c["type"] == "drop":
                        c["time"] = min(c["time"], last["time"] - 0.5)
                    else:
                        c["time"] = max(c["time"], last["time"] + 0.5)
                    logs.append(f"separate drop/outro around {last['time']:.2f}s")
                    resolved.append(c)
                    continue
                # otherwise choose winner
                if c["confidence"] > 0.75 and last["confidence"] <= 0.75:
                    logs.append(f"keep high-confidence {c} over {last}")
                    resolved[-1] = c
                elif last["confidence"] > 0.75 and c["confidence"] <= 0.75:
                    logs.append(f"keep high-confidence {last} over {c}")
                else:
                    # compare priority then confidence then earlier
                    p_last = _priority_index(last["type"])
                    p_c = _priority_index(c["type"])
                    if p_c < p_last:
                        logs.append(f"priority win {c['type']} over {last['type']} at ~{c['time']:.2f}s")
                        resolved[-1] = c
                    elif p_c > p_last:
                        logs.append(f"priority keep {last['type']} over {c['type']} at ~{c['time']:.2f}s")
                    else:
                        if c["confidence"] > last["confidence"]:
                            logs.append(f"confidence win {c['confidence']:.2f}>{last['confidence']:.2f} at ~{c['time']:.2f}s")
                            resolved[-1] = c
                        elif c["confidence"] < last["confidence"]:
                            logs.append(f"confidence keep {last['confidence']:.2f}> {c['confidence']:.2f} at ~{c['time']:.2f}s")
                        else:
                            # tie -> earlier time wins
                            if c["time"] < last["time"]:
                                logs.append(f"time tiebreaker earlier {c['time']:.2f} replaces {last['time']:.2f}")
                                resolved[-1] = c
            else:
                resolved.append(c)

        # Re-sort after replacements
        resolved.sort(key=lambda c: c["time"])

        # 7) Beat snapping only for specific types
        snapped: List[Dict[str, Any]] = []
        for cue in resolved:
            t = cue["time"]
            if cue["type"] in SNAP_TYPES and beatgrid:
                t_snapped = _nearest_beat(t, beatgrid)
                logs.append(f"snap {cue['type']} {t:.2f} -> {t_snapped:.2f}")
                cue = dict(cue)
                cue["time"] = t_snapped
            snapped.append(cue)

        # 8) Final clamp, spacing, and sort
        final_cues = [c for c in snapped if _valid_time(c["time"], duration)]
        final_cues = _dedup_and_space(final_cues, min_spacing=6.0)

        # Add HotCue generation
        hotcue_stage = HotCueStage()
        hotcue_data = hotcue_stage.run(final_cues)

        return {
            "cues": final_cues,
            "hotcues": hotcue_data.get("hotcues", []),
            "beatgrid": beatgrid,
            "duration": duration,
            "stages": {
                "autocue": s_autocue,
                "aubio": s_aubio,
                "pyaudio": s_pyaudio,
                "analyzer": s_analyzer,
                "chorus_hook": s_ch,
                "bridge": s_bridge,
            },
            "logs": logs,
        }



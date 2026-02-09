from typing import Dict, Any, List, Optional
import math
import traceback
import numpy as np

from .autocue_stage import AutoCueStage
from .aubio_stage import AubioStage
from .pyaudio_stage import PyAudioStage
from .analyzer_stage import AnalyzerStage
from .chorus_hook_stage import ChorusHookStage
from .bridge_energy_gap import BridgeEnergyGapStage
from .hotcue_stage import HotCueStage
from .structure_stage import StructureStage


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


def _nearest_bar(t: float, beatgrid: List[float], bpm: float) -> float:
    """Snap time to the nearest downbeat (1st beat of a 4-bar phrase approximation)."""
    if not beatgrid or bpm <= 0:
        return float(t)
    
    # Simple heuristic: Assume first beat is a downbeat (common in EDM)
    # Then every 4th beat is a bar start.
    # Find nearest beat index
    idx = min(range(len(beatgrid)), key=lambda i: abs(beatgrid[i] - t))
    
    # Snap to nearest 4-beat boundary (0, 4, 8, ...)
    # If the track is perfectly quantized, this works.
    # TODO: More advanced downbeat detection would need spectral analysis.
    bar_idx = round(idx / 4) * 4
    
    # Clamp to valid range
    bar_idx = max(0, min(bar_idx, len(beatgrid) - 1))
    return float(beatgrid[bar_idx])


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
    "breakdown",       # 4. Breakdown
    "build",           # 5. Build/Buildup
    "bridge",          # 6. Bridge (energy gap)
    "pre_chorus",      # 7. Pre-chorus
    "intro",           # 8. Intro
    "vocal",           # 9. Vocals
    "section",         # 10. Boundaries
]

SNAP_TYPES = {"intro", "drop", "chorus", "hook", "bridge", "outro", "breakdown", "build"}

GROUPS = {
    "intro_group": {"intro", "mix_in"},
    "outro_group": {"outro", "mix_out"},
    "vocal_group": {"vocal", "verse"},
    "chorus_group": {"chorus", "hook"},
    "energy_group": {"drop", "bridge", "breakdown", "build", "pre_chorus"},
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
        self.structure = StructureStage()

    def _smart_intro_time(self, y, sr, beatgrid, bpm) -> float:
        """Find intro point where energy first exceeds 10% of the 80th-percentile RMS."""
        try:
            import librosa
            if y is None or sr is None:
                return 0.0
            hop = 1024
            rms = librosa.feature.rms(y=y, hop_length=hop)[0]
            threshold = np.percentile(rms, 80) * 0.10
            times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop)
            for i, val in enumerate(rms):
                if val > threshold:
                    t = float(times[i])
                    # Snap to nearest bar if possible
                    if beatgrid and bpm and bpm > 0:
                        t = _nearest_bar(t, beatgrid, float(bpm))
                    return max(0.0, t)
            return 0.0
        except Exception:
            return 0.0

    def _smart_outro_time(self, y, sr, duration, beatgrid, bpm) -> float:
        """Find outro point where energy drops below 15% of 80th-percentile RMS from 60% onward."""
        try:
            import librosa
            if y is None or sr is None or duration is None:
                return max(0.0, (duration or 0) - 12.0)
            hop = 1024
            rms = librosa.feature.rms(y=y, hop_length=hop)[0]
            threshold = np.percentile(rms, 80) * 0.15
            times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop)
            # Search from 60% onward
            start_idx = int(len(rms) * 0.60)
            for i in range(start_idx, len(rms)):
                if rms[i] < threshold:
                    t = float(times[i])
                    if beatgrid and bpm and bpm > 0:
                        t = _nearest_bar(t, beatgrid, float(bpm))
                    return max(0.0, t)
            # Fallback: 12 seconds before end
            return max(0.0, duration - 12.0)
        except Exception:
            return max(0.0, (duration or 0) - 12.0)

    def run(self, file_path: str, y: Any = None, sr: int = None, features: Dict[str, Any] = None) -> Dict[str, Any]:
        logs: List[str] = []
        # 1) Execute stages in parallel using ThreadPoolExecutor
        import concurrent.futures
        
        # Initialize default results
        s_autocue = {"cues": []}
        s_aubio = {"beatgrid": [], "cues": []}
        s_pyaudio = {"cues": []}
        s_analyzer = {"cues": [], "bpm": None}
        s_ch = {"cues": []}
        s_bridge = {"cues": []}
        s_structure = {"song_structure": []}
        
        # Ensure features dict exists
        if features is None:
            features = {}

        # Define wrapper functions to capture exceptions without crashing the thread pool
        def run_safely(stage_name, stage_obj, fpath, **kwargs):
            try:
                # pass kwargs if the stage accepts them
                if hasattr(stage_obj, 'run') and stage_obj.run.__code__.co_argcount > 2:
                     return stage_obj.run(fpath, **kwargs)
                return stage_obj.run(fpath)
            except Exception:
                return f"{stage_name}_failed: " + traceback.format_exc(limit=1)

        with concurrent.futures.ThreadPoolExecutor(max_workers=7) as executor:
            # Pass y/sr AND features to all stages that can use them
            # This eliminates duplicate HPSS, beat tracking, and spectral feature computation

            future_autocue = executor.submit(run_safely, "autocue_stage", self.autocue, file_path)
            future_aubio = executor.submit(run_safely, "aubio_stage", self.aubio, file_path, y=y, sr=sr, features=features)
            future_pyaudio = executor.submit(run_safely, "pyaudio_stage", self.pyaudio, file_path, y=y, sr=sr, features=features)
            future_analyzer = executor.submit(run_safely, "analyzer_stage", self.analyzer, file_path) # analyzer handles itself
            future_ch = executor.submit(run_safely, "chorus_hook_stage", self.chorus_hook, file_path, y=y, sr=sr, features=features)
            future_bridge = executor.submit(run_safely, "bridge_energy_gap", self.bridge, file_path, y=y, sr=sr, features=features)
            future_structure = executor.submit(run_safely, "structure_stage", self.structure, file_path, y=y, sr=sr, features=features)

            # Collect results
            res_autocue = future_autocue.result()
            if isinstance(res_autocue, str):
                logs.append(res_autocue)
            else:
                s_autocue = res_autocue

            res_aubio = future_aubio.result()
            if isinstance(res_aubio, str):
                logs.append(res_aubio)
            else:
                s_aubio = res_aubio

            res_pyaudio = future_pyaudio.result()
            if isinstance(res_pyaudio, str):
                logs.append(res_pyaudio)
            else:
                s_pyaudio = res_pyaudio

            res_analyzer = future_analyzer.result()
            if isinstance(res_analyzer, str):
                logs.append(res_analyzer)
            else:
                s_analyzer = res_analyzer

            res_ch = future_ch.result()
            if isinstance(res_ch, str):
                logs.append(res_ch)
            else:
                s_ch = res_ch

            res_bridge = future_bridge.result()
            if isinstance(res_bridge, str):
                logs.append(res_bridge)
            else:
                s_bridge = res_bridge

            res_structure = future_structure.result()
            if isinstance(res_structure, str):
                logs.append(res_structure)
            else:
                s_structure = res_structure

        beatgrid: List[float] = s_aubio.get("beatgrid", []) or []

        # Fallback: If aubio failed to produce a beatgrid, generate one from analyzer BPM
        if not beatgrid:
            bpm = s_analyzer.get("bpm")
            if bpm and bpm > 0:
                 # Generate a simple grid starting at 0.0 (or first cue time)
                 beat_interval = 60.0 / float(bpm)
                 # Estimate start time from first cue or onset if available
                 start_t = 0.0
                 # Try to find a sync point from onsets
                 onsets = s_aubio.get("onsets", [])
                 if onsets:
                     start_t = onsets[0]
                 
                 # Generate grid for 10 minutes (safe upper bound) or duration
                 limit = 600.0
                 try:
                     import soundfile as sf
                     info = sf.info(file_path)
                     limit = float(info.duration)
                 except Exception:
                     pass
                     
                 curr = start_t
                 while curr < limit:
                     beatgrid.append(curr)
                     curr += beat_interval
                 logs.append(f"generated fallback beatgrid from BPM {bpm} starting at {start_t:.2f}s")

        # 2) Determine duration (fast)
        duration: Optional[float] = None
        try:
            import soundfile as sf
            info = sf.info(file_path)
            duration = float(info.duration)
        except Exception:
            try:
                import librosa
                duration = librosa.get_duration(filename=file_path)
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
        # find intro/outro candidates — use smart energy-based detection instead of 0.0s / duration-12s
        intro = next((c for c in valid if c["type"] == "intro"), None)
        if not intro:
            intro_time = self._smart_intro_time(y, sr, beatgrid, bpm)
            valid.append({"name": "Mix In", "type": "intro", "time": intro_time, "confidence": 0.7, "reason": "smart_energy", "stage": "pipeline"})
            logs.append(f"added smart intro at {intro_time:.2f}s")
        outro = next((c for c in valid if c["type"] == "outro"), None)
        if not outro and duration is not None:
            outro_time = self._smart_outro_time(y, sr, duration, beatgrid, bpm)
            valid.append({"name": "Mix Out", "type": "outro", "time": outro_time, "confidence": 0.7, "reason": "smart_energy", "stage": "pipeline"})
            logs.append(f"added smart outro at {outro_time:.2f}s")

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

        # 6) Conflict resolution with BPM-adaptive window
        # Keep >0.75 confidence always; otherwise use priority, then confidence, then earlier time
        valid.sort(key=lambda c: c["time"])
        resolved: List[Dict[str, Any]] = []
        bpm_val = float(bpm or 120.0)
        bar_seconds = 4.0 * 60.0 / max(bpm_val, 60.0)
        window = max(3.0, min(10.0, 2.0 * bar_seconds))  # 2 bars, clamped 3-10s
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

        # 7) Beat snapping with bar awareness
        snapped: List[Dict[str, Any]] = []
        
        # Major structural cues should snap to bars (16-beat / 4-bar phrases ideally, but 1-bar is safe)
        BAR_SNAP_TYPES = {"intro", "outro", "drop", "breakdown"}
        
        for cue in resolved:
            t = cue["time"]
            ctype = cue["type"]
            
            if not beatgrid:
                snapped.append(cue)
                continue
                
            if ctype in BAR_SNAP_TYPES:
                 # Snap to nearest bar (downbeat)
                 bpm_val = s_analyzer.get("bpm") or 120.0
                 t_snapped = _nearest_bar(t, beatgrid, float(bpm_val))
                 if abs(t - t_snapped) < 2.0: # Only snap if fairly close (prevent huge jumps)
                     logs.append(f"snap-bar {ctype} {t:.2f} -> {t_snapped:.2f}")
                     cue = dict(cue)
                     cue["time"] = t_snapped
                 else:
                     # Fallback to nearest beat if bar snap is too far (likely pickup or misaligned grid)
                     t_beat = _nearest_beat(t, beatgrid)
                     logs.append(f"snap-beat {ctype} {t:.2f} -> {t_beat:.2f} (bar too far)")
                     cue = dict(cue)
                     cue["time"] = t_beat
            elif ctype in SNAP_TYPES:
                # Regular beat snap
                t_snapped = _nearest_beat(t, beatgrid)
                logs.append(f"snap {ctype} {t:.2f} -> {t_snapped:.2f}")
                cue = dict(cue)
                cue["time"] = t_snapped
                
            snapped.append(cue)

        # 8) Final clamp, spacing, and sort (BPM-adaptive min spacing)
        final_cues = [c for c in snapped if _valid_time(c["time"], duration)]
        bpm_val = float(bpm or 120.0)
        adaptive_spacing = max(3.0, min(10.0, 2.0 * (4.0 * 60.0 / max(bpm_val, 60.0))))
        final_cues = _dedup_and_space(final_cues, min_spacing=adaptive_spacing)

        # Add HotCue generation
        hotcue_stage = HotCueStage()
        hotcue_data = hotcue_stage.run(final_cues)

        return {
            "cues": final_cues,
            "hotcues": hotcue_data.get("hotcues", []),
            "beatgrid": beatgrid,
            "duration": duration,
            "song_structure": s_structure.get("song_structure", []),
            "stages": {
                "autocue": s_autocue,
                "aubio": s_aubio,
                "pyaudio": s_pyaudio,
                "analyzer": s_analyzer,
                "chorus_hook": s_ch,
                "bridge": s_bridge,
                "structure": s_structure,
            },
            "logs": logs,
        }



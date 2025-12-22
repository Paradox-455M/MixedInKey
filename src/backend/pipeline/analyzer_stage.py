from __future__ import annotations

from typing import Dict, Any, List, Optional, Callable


# Try to import the user's main analyzer class.
# The expected name is MixedInAIAnalyzer, but we fall back to AudioAnalyzer if needed.
try:
    # Preferred name per instructions
    from analyzer import MixedInAIAnalyzer  # type: ignore
except Exception:
    try:
        from analyzer import AudioAnalyzer as MixedInAIAnalyzer  # type: ignore
    except Exception:
        MixedInAIAnalyzer = None  # type: ignore


class AnalyzerStage:
    """
    Wrapper around the user's main analyzer (analyzer.py).
    Returns a normalized dict consumed by the pipeline orchestrator.
    """

    def __init__(self) -> None:
        self.analyzer = None
        if MixedInAIAnalyzer is not None:
            try:
                self.analyzer = MixedInAIAnalyzer()
            except Exception:
                # Defer to run() error handling
                self.analyzer = None

    def _call_analyze(self, file_path: str) -> Dict[str, Any]:
        """
        Call the analyzer using the best available entrypoint.
        Supports .analyze() or .analyze_audio().
        """
        if self.analyzer is None:
            raise RuntimeError("Analyzer class could not be instantiated")

        # Prefer 'analyze', fallback to 'analyze_audio'
        if hasattr(self.analyzer, "analyze") and callable(getattr(self.analyzer, "analyze")):
            return self.analyzer.analyze(file_path)  # type: ignore[attr-defined]
        if hasattr(self.analyzer, "analyze_audio") and callable(getattr(self.analyzer, "analyze_audio")):
            return self.analyzer.analyze_audio(file_path)  # type: ignore[attr-defined]
        raise AttributeError("Analyzer has no 'analyze' or 'analyze_audio' method")

    def run(self, file_path: str) -> Dict[str, Any]:
        try:
            # Avoid recursive pipeline invocation from inside analyzer.analyze_audio
            import os
            prev_flag = os.environ.get("MIXEDIN_PIPELINE_ACTIVE")
            os.environ["MIXEDIN_PIPELINE_ACTIVE"] = "1"
            try:
                result: Dict[str, Any] = self._call_analyze(file_path)
            finally:
                if prev_flag is None:
                    try:
                        del os.environ["MIXEDIN_PIPELINE_ACTIVE"]
                    except Exception:
                        pass
                else:
                    os.environ["MIXEDIN_PIPELINE_ACTIVE"] = prev_flag

            # Normalize cue structure
            cues_out: List[Dict[str, Any]] = []
            raw_cues: List[Dict[str, Any]] = (
                result.get("cues", [])  # preferred
                or result.get("cue_points", [])  # analyzer.py uses 'cue_points'
                or []
            )
            for c in raw_cues:
                try:
                    cues_out.append({
                        "name": str(c.get("name", c.get("type", "Cue"))),
                        "type": str(c.get("type", "cue")).lower(),
                        "time": float(c.get("time", 0.0)),
                        "confidence": float(c.get("confidence", 0.6)),
                        "reason": str(c.get("reason", "analyzer")),
                        "stage": "analyzer",
                    })
                except Exception:
                    # Skip malformed entries safely
                    continue

            # Normalize segments and energy profile
            segments = (
                result.get("segments")
                or result.get("song_structure")
                or result.get("structure")
                or []
            )
            energy_profile = (
                result.get("energy_profile")
                or (result.get("energy_analysis", {}) or {}).get("energy_profile", [])
                or []
            )

            return {
                "bpm": result.get("bpm"),
                "duration": result.get("duration"),
                "cues": cues_out,
                "segments": segments,
                "energy_profile": energy_profile,
            }

        except Exception as e:
            return {
                "bpm": None,
                "duration": None,
                "cues": [],
                "segments": [],
                "energy_profile": [],
                "error": str(e),
            }

from typing import Dict, Any, List


class AnalyzerStage:
    """
    Wraps existing AudioAnalyzer and exposes:
    { key, bpm, energy, harmonic_cues, drops, cues }
    """

    def run(self, file_path: str) -> Dict[str, Any]:
        try:
            from ..analyzer import AudioAnalyzer  # relative import from backend
        except Exception:
            from src.backend.analyzer import AudioAnalyzer  # fallback
        key = None
        bpm = None
        energy = None
        drops: List[float] = []
        harmonic_cues: List[Dict[str, Any]] = []
        cues: List[Dict[str, Any]] = []
        try:
            analyzer = AudioAnalyzer()
            result = analyzer.analyze_audio(file_path)
            if result:
                key = result.get("key")
                bpm = result.get("bpm")
                energy = result.get("energy_analysis", {}).get("overall_energy")
                cues = result.get("cue_points", []) or []
                for c in cues:
                    if c.get("type") == "drop":
                        drops.append(float(c.get("time", 0.0)))
                    if c.get("type") in ("chorus", "hook"):
                        harmonic_cues.append(c)
        except Exception:
            pass
        return {
            "key": key,
            "bpm": bpm,
            "energy": energy,
            "harmonic_cues": harmonic_cues,
            "drops": drops,
            "cues": cues,
        }



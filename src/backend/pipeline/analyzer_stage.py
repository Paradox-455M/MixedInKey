from __future__ import annotations

from typing import Dict, Any, List, Optional


class AnalyzerStage:
    """
    Wrapper around the project's analyzer (`src/backend/analyzer.py`).

    Key performance property: the underlying analyzer instance is created once
    and reused across calls (avoids repeated heavy imports/initialization).
    """

    def __init__(self) -> None:
        self.analyzer = self._instantiate_analyzer()

    @staticmethod
    def _instantiate_analyzer():
        """
        Best-effort import that works whether code runs as:
        - `src.backend.pipeline.*`
        - `backend.pipeline.*`
        - executed from repo root with `src/` on PYTHONPATH
        """
        candidates = []
        try:
            from ..analyzer import AudioAnalyzer as _Analyzer  # type: ignore
            candidates.append(_Analyzer)
        except Exception:
            pass
        try:
            from src.backend.analyzer import AudioAnalyzer as _Analyzer  # type: ignore
            candidates.append(_Analyzer)
        except Exception:
            pass
        try:
            from analyzer import AudioAnalyzer as _Analyzer  # type: ignore
            candidates.append(_Analyzer)
        except Exception:
            pass

        last_err: Optional[Exception] = None
        for cls in candidates:
            try:
                return cls()
            except Exception as e:
                last_err = e
                continue
        if last_err is not None:
            raise last_err
        raise RuntimeError("Could not import AudioAnalyzer")

    def _call_analyze(self, file_path: str) -> Dict[str, Any]:
        """
        Call the analyzer using the best available entrypoint.
        Supports `.analyze()` or `.analyze_audio()`.
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



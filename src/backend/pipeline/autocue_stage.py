from __future__ import annotations

import json
import os
import shutil
import subprocess
from typing import Any, Dict, List, Optional


class AutoCueStage:
    """
    Stage 1: Moonbase59/autocue wrapper.

    This stage attempts to invoke an external `autocue` CLI to detect intro/outro.
    It is designed for production use:
      - Never crashes if the binary is missing or fails
      - Normalizes/validates times
      - Returns a stable, documented schema
      - Uses only Python stdlib; no external runtime deps

    Returned schema:
        {
            "intro": float | None,
            "outro": float | None,
            "cues": [
                { "name": str, "type": str, "time": float, "confidence": float, "reason": str }
            ],
            "fallback": str | None
        }
    """

    def __init__(self, timeout_sec: float = 60.0, binary_names: Optional[List[str]] = None) -> None:
        self.timeout_sec = float(timeout_sec)
        # Common binary names users might install
        self.binary_names = binary_names or ["autocue", "autocue-cli"]

    # ------------------------------- internal helpers ------------------------------- #
    def _find_binary(self) -> Optional[str]:
        """
        Locate the `autocue` executable in PATH. Returns None if not found.
        """
        for name in self.binary_names:
            path = shutil.which(name)
            if path:
                return path
        return None

    @staticmethod
    def _normalize_time(value: Any) -> Optional[float]:
        """
        Convert input to a safe non-negative float time (seconds).
        Rejects NaN, negative, or non-numeric values.
        """
        try:
            t = float(value)
            if not (t >= 0.0):  # also guards against NaN
                return None
            return t
        except Exception:
            return None

    @staticmethod
    def _build_cue(name: str, ctype: str, time_val: Optional[float], confidence: float, reason: str) -> Optional[Dict[str, Any]]:
        if time_val is None:
            return None
        return {
            "name": name,
            "type": ctype,
            "time": float(time_val),
            "confidence": float(confidence),
            "reason": reason,
        }

    # ----------------------------------- API ----------------------------------- #
    def run(self, file_path: str) -> Dict[str, Any]:
        """
        Invoke `autocue` if available. Never raises. Returns stable schema.
        """
        intro: Optional[float] = None
        outro: Optional[float] = None
        fallback: Optional[str] = None
        cues: List[Dict[str, Any]] = []

        # Validate the input path exists early (but don't crash if it doesn't)
        if not file_path or not os.path.exists(file_path):
            fallback = "File not found or not accessible"
            return {"intro": None, "outro": None, "cues": [], "fallback": fallback}

        binary = self._find_binary()
        if not binary:
            # Autocue is optional; report gracefully
            fallback = "autocue binary not found in PATH"
            return {"intro": None, "outro": None, "cues": [], "fallback": fallback}

        # Try JSON output first
        commands_to_try = [
            [binary, "--json", file_path],
            [binary, file_path],  # best-effort fallback
        ]

        last_error: Optional[str] = None
        for cmd in commands_to_try:
            try:
                proc = subprocess.run(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=self.timeout_sec,
                    check=False,
                    text=True,
                )
            except Exception as e:
                last_error = f"subprocess failed: {e}"
                continue

            stdout = proc.stdout or ""
            stderr = proc.stderr or ""

            # Attempt to parse JSON first (expected by --json)
            parsed: Optional[Dict[str, Any]] = None
            try:
                parsed = json.loads(stdout)
            except Exception:
                # If not valid JSON, try to heuristically find times (very defensive)
                parsed = None

            if isinstance(parsed, dict):
                intro = self._normalize_time(parsed.get("intro"))
                outro = self._normalize_time(parsed.get("outro"))
                break  # Parsed successfully; stop trying other commands
            else:
                # Non-JSON mode: attempt naive heuristics on stdout/stderr
                # Keep this minimal and safe; don't rely on exact formatting.
                import re

                def _extract(label: str, text: str) -> Optional[float]:
                    # Find the first float after the label
                    try:
                        pattern = re.compile(rf"{label}[^0-9\-\.]*([0-9]+(?:\.[0-9]+)?)", re.IGNORECASE)
                        m = pattern.search(text)
                        if m:
                            return self._normalize_time(m.group(1))
                    except Exception:
                        return None
                    return None

                cand_intro = _extract("intro", stdout) or _extract("intro", stderr)
                cand_outro = _extract("outro", stdout) or _extract("outro", stderr)
                if cand_intro is not None or cand_outro is not None:
                    intro = cand_intro
                    outro = cand_outro
                    break
                else:
                    # Nothing usable from this attempt; keep last error details
                    last_error = (stderr or stdout or "").strip() or f"autocue exited code {proc.returncode}"

        # Build cues if any times were found
        intro_cue = self._build_cue("Mix In", "intro", intro, 0.78, "autocue")
        if intro_cue:
            cues.append(intro_cue)
        outro_cue = self._build_cue("Mix Out", "outro", outro, 0.78, "autocue")
        if outro_cue:
            cues.append(outro_cue)

        # Prepare fallback message if we couldn't obtain times
        if intro is None and outro is None and not fallback:
            fallback = last_error or "autocue produced no usable output"

        return {
            "intro": intro,
            "outro": outro,
            "cues": cues,
            "fallback": fallback,
        }

import json
import subprocess
from typing import Dict, Any


class AutoCueStage:
    """
    Runs Moonbase59/autocue via subprocess if available.
    Returns a standard dict: { 'intro': float|None, 'outro': float|None, 'cues': [ ... ] }
    """

    def run(self, file_path: str) -> Dict[str, Any]:
        intro = None
        outro = None
        try:
            # Try calling `autocue` CLI (if installed in PATH)
            # The actual CLI/options may differ; this is a best-effort wrapper.
            proc = subprocess.run(
                ["autocue", "--json", file_path],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
            if proc.returncode == 0 and proc.stdout:
                data = json.loads(proc.stdout.decode("utf-8", "ignore"))
                intro = float(data.get("intro", None)) if data.get("intro") is not None else None
                outro = float(data.get("outro", None)) if data.get("outro") is not None else None
        except Exception:
            pass

        cues = []
        if intro is not None:
            cues.append({"name": "Mix In", "time": float(intro), "type": "intro", "confidence": 0.75, "reason": "autocue"})
        if outro is not None:
            cues.append({"name": "Mix Out", "time": float(outro), "type": "outro", "confidence": 0.75, "reason": "autocue"})
        return {"intro": intro, "outro": outro, "cues": cues}



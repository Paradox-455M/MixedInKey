from typing import Dict, Any, List


class HotCueStage:
    """
    Generates Hot Cues (A–H) from musically important cue types:
      A = Intro (Mix In)
      B = First Vocal / Verse
      C = First Chorus
      D = First Build / Buildup
      E = Main Drop
      F = First Breakdown
      G = Second Chorus (or second drop)
      H = Outro (Mix Out)

    Includes:
      - alias matching
      - fallback picking
      - automatic ordering
    """

    ALIASES = {
        "intro": ["intro", "mix_in", "mixin"],
        "vocal": ["vocal", "verse", "vox", "lead_vocal"],
        "chorus": ["chorus", "hook"],
        "build": ["build", "buildup", "build_up", "pre_chorus"],
        "drop": ["drop", "energy_peak", "climax"],
        "breakdown": ["breakdown", "bridge"],
        "outro": ["outro", "mix_out", "mixout"],
    }

    ORDER = ["intro", "vocal", "chorus", "build", "drop", "breakdown", "chorus2", "outro"]
    ALL_SLOTS = ["A", "B", "C", "D", "E", "F", "G", "H"]

    def _match(self, cue_type: str, target: str) -> bool:
        cue_type = str(cue_type).lower().strip()
        return cue_type in self.ALIASES.get(target, [])

    def _pick_all(self, cues: List[Dict[str, Any]], target: str) -> List[Dict[str, Any]]:
        return [c for c in cues if self._match(str(c.get("type", "")), target)]

    def _first_after(self, items: List[Dict[str, Any]], t: float) -> List[Dict[str, Any]]:
        return sorted([c for c in items if float(c.get("time", 0.0)) >= t], key=lambda x: float(x.get("time", 0.0)))

    def _first_before(self, items: List[Dict[str, Any]], t: float) -> List[Dict[str, Any]]:
        return sorted([c for c in items if float(c.get("time", 0.0)) < t], key=lambda x: float(x.get("time", 0.0)))

    def _choose_with_spacing(self, candidates: List[Dict[str, Any]], chosen: List[Dict[str, Any]], min_spacing: float = 6.0):
        for c in candidates:
            t = float(c.get("time", 0.0))
            if all(abs(t - float(x.get("time", 0.0))) >= min_spacing for x in chosen):
                return c
        return None

    def run(self, cues: List[Dict[str, Any]]) -> Dict[str, Any]:
        cues = sorted(cues or [], key=lambda x: float(x.get("time", 0.0)))
        if not cues:
            return {"hotcues": []}

        duration = float(max([float(c.get("time", 0.0)) for c in cues] + [0.0])) + 0.01
        min_spacing = 6.0
        hot: List[Dict[str, Any]] = []

        intros = self._pick_all(cues, "intro")
        vocals = self._pick_all(cues, "vocal")
        choruses = self._pick_all(cues, "chorus")
        builds = self._pick_all(cues, "build")
        drops = self._pick_all(cues, "drop")
        breakdowns = self._pick_all(cues, "breakdown")
        outros = self._pick_all(cues, "outro")
        phrases = [c for c in cues if str(c.get("type", "")).lower() in ("phrase", "section")]

        first_intro = intros[0] if intros else (phrases[0] if phrases else (cues[0] if cues else None))
        first_drop = None
        if drops:
            mid_start = duration * 0.35
            mid_end = duration * 0.60
            mid_drops = [d for d in drops if mid_start <= float(d.get("time", 0.0)) <= mid_end]
            try:
                def score(d):
                    t = float(d.get("time", 0.0))
                    conf = float(d.get("confidence", 0.7))
                    pos_bonus = 1.0 - abs(((mid_start + mid_end) / 2) - t) / ((mid_end - mid_start) / 2 + 1e-6)
                    return conf * 0.7 + pos_bonus * 0.3
                pool = mid_drops if mid_drops else drops
                first_drop = max(pool, key=score)
            except Exception:
                first_drop = drops[0]

        # A = Intro (Mix In)
        if first_intro:
            hot.append({"slot": "A", "cue": first_intro})

        # B = First Vocal / Verse
        b_cand = None
        if vocals:
            if first_drop:
                before = self._first_before(vocals, float(first_drop.get("time", 0.0)))
                b_cand = before[0] if before else vocals[0]
            else:
                b_cand = vocals[0]
        if not b_cand and choruses:
            b_cand = choruses[0]
        if b_cand:
            chosen = [x["cue"] for x in hot]
            pick = self._choose_with_spacing([b_cand], chosen, min_spacing) or b_cand
            hot.append({"slot": "B", "cue": pick})

        # C = First Chorus
        c_cand = choruses[0] if choruses else None
        if not c_cand and vocals and len(vocals) > 1:
            c_cand = vocals[1]
        if c_cand:
            chosen = [x["cue"] for x in hot]
            pick = self._choose_with_spacing([c_cand], chosen, min_spacing) or c_cand
            hot.append({"slot": "C", "cue": pick})

        # D = First Build / Buildup
        d_cand = builds[0] if builds else None
        if not d_cand and first_drop:
            # Look for any cue just before the drop as a build proxy
            before_drop = [c for c in cues if float(c.get("time", 0.0)) < float(first_drop.get("time", 0.0)) - 4.0]
            if before_drop:
                d_cand = before_drop[-1]
        if d_cand:
            chosen = [x["cue"] for x in hot]
            pick = self._choose_with_spacing([d_cand], chosen, min_spacing) or d_cand
            hot.append({"slot": "D", "cue": pick})

        # E = Main Drop
        if first_drop:
            chosen = [x["cue"] for x in hot]
            pick = self._choose_with_spacing([first_drop], chosen, min_spacing) or first_drop
            hot.append({"slot": "E", "cue": pick})
        elif choruses:
            fallback = choruses[-1]
            chosen = [x["cue"] for x in hot]
            pick = self._choose_with_spacing([fallback], chosen, min_spacing) or fallback
            hot.append({"slot": "E", "cue": pick})

        # F = First Breakdown
        f_cand = breakdowns[0] if breakdowns else None
        if f_cand:
            chosen = [x["cue"] for x in hot]
            pick = self._choose_with_spacing([f_cand], chosen, min_spacing) or f_cand
            hot.append({"slot": "F", "cue": pick})

        # G = Second Chorus (or second drop)
        g_cand = None
        if len(choruses) > 1:
            g_cand = choruses[1]
        elif len(drops) > 1:
            g_cand = drops[1]
        if g_cand:
            chosen = [x["cue"] for x in hot]
            pick = self._choose_with_spacing([g_cand], chosen, min_spacing) or g_cand
            hot.append({"slot": "G", "cue": pick})

        # H = Outro (Mix Out)
        h_cand = outros[-1] if outros else (phrases[-1] if phrases else (cues[-1] if cues else None))
        if h_cand:
            chosen = [x["cue"] for x in hot]
            pick = self._choose_with_spacing([h_cand], chosen, min_spacing) or h_cand
            hot.append({"slot": "H", "cue": pick})

        # If fewer than 8, backfill from remaining high-confidence anchors with spacing
        if len(hot) < 8:
            used_ids = {id(x["cue"]) for x in hot}
            remaining = sorted(
                [c for c in cues if id(c) not in used_ids],
                key=lambda x: (-float(x.get("confidence", 0.6)), float(x.get("time", 0.0)))
            )
            slots = [s for s in self.ALL_SLOTS if s not in [h["slot"] for h in hot]]
            for s in slots:
                pick = self._choose_with_spacing(remaining, [x["cue"] for x in hot], min_spacing)
                if not pick:
                    break
                hot.append({"slot": s, "cue": pick})
                remaining = [c for c in remaining if id(c) != id(pick)]
                if len(hot) >= 8:
                    break

        # Ensure ordered by slot A..H
        order = {s: i for i, s in enumerate(self.ALL_SLOTS)}
        hot.sort(key=lambda x: order.get(x["slot"], 99))
        return {"hotcues": hot}



from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class Event:
    timestamp: int
    speaker: str
    modality: str
    content: str
    tone: Optional[str] = None
    action: Optional[str] = None
    movement: Optional[str] = None


@dataclass
class Interpretation:
    label: str
    score: float
    evidence: List[str] = field(default_factory=list)


class ContextGraph:
    """Minimal temporal context graph for ambiguity resolution."""

    def __init__(self) -> None:
        self.events: List[Event] = []

    def add_event(self, event: Event) -> None:
        self.events.append(event)
        self.events.sort(key=lambda e: e.timestamp)

    def interpret(self, event: Event) -> Interpretation:
        text = event.content.strip().lower()
        scores: Dict[str, float] = {
            "acknowledgement": 0.25,
            "agreement": 0.25,
            "reluctance": 0.25,
            "conversation_end": 0.25,
        }
        evidence: List[str] = []

        if text == "okay":
            if event.tone in {"calm", "neutral"}:
                scores["acknowledgement"] += 0.35
                evidence.append(f"tone={event.tone}")
            if event.tone in {"enthusiastic", "excited"}:
                scores["agreement"] += 0.45
                evidence.append(f"tone={event.tone}")
            if event.tone in {"frustrated", "flat"}:
                scores["reluctance"] += 0.45
                evidence.append(f"tone={event.tone}")
            if event.action in {"walk_away", "leave"} or event.movement == "toward_door":
                scores["conversation_end"] += 0.5
                evidence.append("departure cue")

        prior = self.events[:-1] if self.events and self.events[-1] is event else self.events
        if prior:
            previous_text = " ".join(e.content.lower() for e in prior[-3:])
            if "i reject option b" in previous_text or "rejected option b" in previous_text:
                scores["agreement"] += 0.10
                evidence.append("prior task state")

        label, score = max(scores.items(), key=lambda item: item[1])
        return Interpretation(label=label, score=round(min(score, 1.0), 3), evidence=evidence)

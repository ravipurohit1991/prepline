"""Core value types for the meal scheduler.

All times are integer minutes relative to the plan's target serve time:
0 is the moment food hits the table, negative values are before it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Literal


class Attention(StrEnum):
    ACTIVE = "active"  # occupies the cook's hands (chop, stir, plate)
    PASSIVE = "passive"  # unattended (oven, simmer, rest, chill)


@dataclass(frozen=True)
class EquipmentUse:
    kind: str  # "burner", "oven", or any free-form station name
    temp_c: int | None = None  # oven temperature; None shares with any temperature


@dataclass(frozen=True)
class PlanStep:
    id: str
    recipe_id: str
    name: str
    duration: int  # minutes, >= 1
    attention: Attention = Attention.ACTIVE
    equipment: tuple[EquipmentUse, ...] = ()
    depends_on: tuple[str, ...] = ()
    hold_max: int = 15  # minutes the finished result can sit without losing quality
    recipe_name: str = ""
    instruction: str = ""


@dataclass
class Resources:
    cooks: int = 1
    burners: int = 4
    oven_slots: int = 2  # dishes the oven fits at once (same temperature only)

    def capacity(self, kind: str) -> int:
        if kind == "cook":
            return self.cooks
        if kind == "burner":
            return self.burners
        if kind == "oven":
            return self.oven_slots
        return 1


@dataclass(frozen=True)
class Placement:
    step: PlanStep
    start: int
    end: int


@dataclass(frozen=True)
class ScheduleWarning:
    code: str
    message: str
    step_id: str | None = None


@dataclass(frozen=True)
class StepProgress:
    """Live progress of one step during a cook session.

    ``start``/``end`` are minute offsets from the original serve target.
    For a running step, ``end`` is the projected finish (now + remaining).
    """

    status: Literal["pending", "running", "done"]
    start: int | None = None
    end: int | None = None


@dataclass
class Schedule:
    placements: list[Placement] = field(default_factory=list)
    serve_push: int = 0  # minutes the serve time had to slip past the target
    warnings: list[ScheduleWarning] = field(default_factory=list)

    @property
    def start(self) -> int:
        return min((p.start for p in self.placements), default=0)

    @property
    def end(self) -> int:
        return max((p.end for p in self.placements), default=0)

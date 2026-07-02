"""Resource-constrained backward scheduler for multi-recipe meals.

The engine packs every step as late as possible — so food is fresh at
serve time — subject to:

- step dependencies (a step never starts before its prerequisites end)
- the cook's hands (at most ``cooks`` active steps overlap)
- equipment capacity (burners, oven slots, any named station)
- oven temperature compatibility (dishes share the oven only at one temperature)

Steps are placed in reverse-topological order (latest-finish first) using a
greedy latest-fit search over a minute-resolution resource ledger. During a
live cook session, :func:`replan` re-schedules the remaining steps forward
of "now" around whatever is already done or running; if the target serve
time is no longer reachable, it is pushed later minute by minute until the
plan fits again.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Sequence

from .types import (
    Attention,
    EquipmentUse,
    Placement,
    PlanStep,
    Resources,
    Schedule,
    ScheduleWarning,
    StepProgress,
)

_SEARCH_WINDOW = 24 * 60  # how far before its latest finish a step may be pushed
_MAX_PUSH = 12 * 60  # give up if serving must slip more than this

_COOK = EquipmentUse(kind="cook")


class ScheduleError(ValueError):
    """The step graph is invalid or cannot be scheduled."""


class _Occupancy:
    """Minute-resolution ledger of resource usage."""

    def __init__(self, resources: Resources) -> None:
        self._resources = resources
        self._used: dict[str, dict[int, int]] = defaultdict(lambda: defaultdict(int))
        self._oven_temp: dict[int, int] = {}

    @staticmethod
    def _demands(step: PlanStep) -> list[EquipmentUse]:
        demands = [_COOK] if step.attention is Attention.ACTIVE else []
        demands.extend(step.equipment)
        return demands

    def blocked_minute(self, step: PlanStep, start: int, end: int) -> int | None:
        """Highest minute in [start, end) where the step cannot run, else None."""
        demands = self._demands(step)
        for minute in range(end - 1, start - 1, -1):
            for use in demands:
                if self._used[use.kind][minute] >= self._resources.capacity(use.kind):
                    return minute
                if use.kind == "oven" and use.temp_c is not None:
                    temp = self._oven_temp.get(minute)
                    if temp is not None and temp != use.temp_c:
                        return minute
        return None

    def occupy(self, step: PlanStep, start: int, end: int) -> None:
        for use in self._demands(step):
            for minute in range(start, end):
                self._used[use.kind][minute] += 1
                if use.kind == "oven" and use.temp_c is not None:
                    self._oven_temp[minute] = use.temp_c


def _validate(steps: Sequence[PlanStep], fixed_ids: set[str]) -> dict[str, PlanStep]:
    by_id: dict[str, PlanStep] = {}
    for step in steps:
        if step.id in by_id or step.id in fixed_ids:
            raise ScheduleError(f"duplicate step id {step.id!r}")
        if step.duration < 1:
            raise ScheduleError(f"step {step.name!r} must last at least one minute")
        by_id[step.id] = step
    for step in steps:
        for dep in step.depends_on:
            if dep not in by_id and dep not in fixed_ids:
                raise ScheduleError(f"step {step.name!r} depends on unknown step {dep!r}")
    return by_id


def _reverse_topo_order(steps: Sequence[PlanStep], by_id: dict[str, PlanStep]) -> list[PlanStep]:
    """Order steps successors-first by their unconstrained latest finish time."""
    successors: dict[str, list[PlanStep]] = defaultdict(list)
    for step in steps:
        for dep in step.depends_on:
            if dep in by_id:
                successors[dep].append(step)

    latest_finish: dict[str, int] = {}

    def visit(step: PlanStep, trail: set[str]) -> int:
        if step.id in latest_finish:
            return latest_finish[step.id]
        if step.id in trail:
            raise ScheduleError("dependency cycle detected between steps")
        trail.add(step.id)
        succ = successors.get(step.id, [])
        value = 0 if not succ else min(visit(s, trail) - s.duration for s in succ)
        trail.remove(step.id)
        latest_finish[step.id] = value
        return value

    for step in steps:
        visit(step, set())

    # Least-holdable dishes get first pick of the latest slots.
    return sorted(steps, key=lambda s: (-latest_finish[s.id], s.hold_max, -s.duration, s.id))


def _latest_fit(
    occupancy: _Occupancy, step: PlanStep, latest_end: int, floor_start: int
) -> tuple[int, int] | None:
    end = latest_end
    while True:
        start = end - step.duration
        if start < floor_start:
            return None
        blocked = occupancy.blocked_minute(step, start, end)
        if blocked is None:
            return start, end
        end = blocked  # jump past the conflict instead of sliding minute by minute


def _attempt(
    order: Sequence[PlanStep],
    successors: dict[str, list[str]],
    resources: Resources,
    push: int,
    not_before: int | None,
    fixed: Sequence[Placement],
    fixed_end: dict[str, int],
) -> tuple[list[Placement], list[ScheduleWarning]] | None:
    occupancy = _Occupancy(resources)
    for placement in fixed:
        occupancy.occupy(placement.step, placement.start, placement.end)

    placed: dict[str, Placement] = {}
    warnings: list[ScheduleWarning] = []
    for step in order:
        succ_ids = successors.get(step.id, [])
        latest_end = push if not succ_ids else min(placed[s].start for s in succ_ids)
        floor = not_before if not_before is not None else latest_end - _SEARCH_WINDOW
        for dep in step.depends_on:
            if dep in fixed_end:
                floor = max(floor, fixed_end[dep])
        spot = _latest_fit(occupancy, step, latest_end, floor)
        if spot is None:
            return None
        start, end = spot
        occupancy.occupy(step, start, end)
        placed[step.id] = Placement(step=step, start=start, end=end)
        if not succ_ids:
            early = push - end
            if early > step.hold_max:
                dish = step.recipe_name or step.name
                warnings.append(
                    ScheduleWarning(
                        code="long_hold",
                        step_id=step.id,
                        message=(
                            f"{dish}: ready {early} min before serving "
                            f"(best enjoyed within {step.hold_max} min)."
                        ),
                    )
                )
    return list(placed.values()), warnings


def compute_schedule(
    steps: Sequence[PlanStep],
    resources: Resources,
    *,
    not_before: int | None = None,
    fixed: Iterable[Placement] = (),
    max_push: int = _MAX_PUSH,
) -> Schedule:
    """Schedule ``steps`` backward from the serve target (minute 0).

    ``fixed`` placements (already done or currently running) keep their
    times and their resource claims. ``not_before`` is the lower bound for
    every newly placed step — "now" during a live session. If the target
    is unreachable, the serve time is pushed later until the plan fits.
    """
    fixed = list(fixed)
    fixed_ids = {p.step.id for p in fixed}
    by_id = _validate(steps, fixed_ids)
    order = _reverse_topo_order(steps, by_id)
    fixed_end = {p.step.id: p.end for p in fixed}
    successors: dict[str, list[str]] = defaultdict(list)
    for step in steps:
        for dep in step.depends_on:
            if dep in by_id:
                successors[dep].append(step.id)

    push = 0
    while True:
        attempt = _attempt(order, successors, resources, push, not_before, fixed, fixed_end)
        if attempt is not None:
            placements, warnings = attempt
            if push > 0:
                warnings.insert(
                    0,
                    ScheduleWarning(
                        code="serve_pushed",
                        message=f"The target serve time is out of reach; serving slips {push} min later.",
                    ),
                )
            placements = sorted([*fixed, *placements], key=lambda p: (p.start, p.end, p.step.id))
            return Schedule(placements=placements, serve_push=push, warnings=warnings)
        if not_before is None:
            raise ScheduleError("could not place every step inside the scheduling window")
        push += 1 if push < 30 else 5
        if push > max_push:
            raise ScheduleError("the plan cannot be completed within the maximum serve delay")


def replan(
    steps: Sequence[PlanStep],
    resources: Resources,
    progress: dict[str, StepProgress],
    now: int,
    *,
    max_push: int = _MAX_PUSH,
) -> Schedule:
    """Re-schedule a meal mid-cook around what already happened.

    Done steps are pinned to their actual times, running steps to their
    projected finish; everything still pending is packed as late as
    possible but never before ``now``.
    """
    fixed: list[Placement] = []
    pending: list[PlanStep] = []
    for step in steps:
        state = progress.get(step.id)
        if state is None or state.status == "pending":
            pending.append(step)
            continue
        end = state.end if state.end is not None else now
        start = state.start if state.start is not None else end
        if state.status == "running":
            end = max(end, now + 1)
        fixed.append(Placement(step=step, start=min(start, end), end=end))
    return compute_schedule(pending, resources, not_before=now, fixed=fixed, max_push=max_push)

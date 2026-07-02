from itertools import combinations

import pytest

from app.scheduler import (
    Attention,
    EquipmentUse,
    PlanStep,
    Resources,
    ScheduleError,
    StepProgress,
    compute_schedule,
    replan,
)

BURNER = (EquipmentUse(kind="burner"),)


def step(
    id: str,
    duration: int,
    *,
    attention: Attention = Attention.ACTIVE,
    equipment: tuple[EquipmentUse, ...] = (),
    depends_on: tuple[str, ...] = (),
    hold_max: int = 120,
    recipe_id: str = "r1",
) -> PlanStep:
    return PlanStep(
        id=id,
        recipe_id=recipe_id,
        name=id,
        duration=duration,
        attention=attention,
        equipment=equipment,
        depends_on=depends_on,
        hold_max=hold_max,
        recipe_name=recipe_id,
    )


def placements_by_id(schedule):
    return {p.step.id: p for p in schedule.placements}


def overlap(a, b) -> int:
    return max(0, min(a.end, b.end) - max(a.start, b.start))


def test_single_chain_is_packed_against_serve_time():
    steps = [
        step("prep", 10),
        step("cook", 30, depends_on=("prep",)),
        step("plate", 5, depends_on=("cook",)),
    ]
    schedule = compute_schedule(steps, Resources())
    by_id = placements_by_id(schedule)
    assert by_id["plate"].end == 0
    assert by_id["cook"].end == by_id["plate"].start
    assert by_id["prep"].end == by_id["cook"].start
    assert schedule.start == -45


def test_dependencies_never_overlap_their_successors():
    steps = [
        step("a", 10),
        step("b", 10, depends_on=("a",)),
        step("c", 10, depends_on=("a",)),
        step("d", 10, depends_on=("b", "c")),
    ]
    schedule = compute_schedule(steps, Resources(cooks=2))
    by_id = placements_by_id(schedule)
    for later, deps in [("b", ["a"]), ("c", ["a"]), ("d", ["b", "c"])]:
        for dep in deps:
            assert by_id[dep].end <= by_id[later].start


def test_one_cook_never_does_two_active_steps_at_once():
    steps = [
        step("chop-1", 15, recipe_id="r1"),
        step("chop-2", 15, recipe_id="r2"),
        step("chop-3", 15, recipe_id="r3"),
    ]
    schedule = compute_schedule(steps, Resources(cooks=1))
    for a, b in combinations(schedule.placements, 2):
        assert overlap(a, b) == 0


def test_two_cooks_can_work_in_parallel():
    steps = [step("chop-1", 15, recipe_id="r1"), step("chop-2", 15, recipe_id="r2")]
    schedule = compute_schedule(steps, Resources(cooks=2))
    assert all(p.end == 0 for p in schedule.placements)


def test_passive_steps_do_not_occupy_the_cook():
    steps = [
        step("simmer", 30, attention=Attention.PASSIVE, equipment=BURNER, recipe_id="r1"),
        step("chop", 30, recipe_id="r2"),
    ]
    schedule = compute_schedule(steps, Resources(cooks=1, burners=1))
    assert all(p.end == 0 for p in schedule.placements)


def test_burner_capacity_is_respected():
    steps = [
        step(f"pot-{i}", 20, attention=Attention.PASSIVE, equipment=BURNER, recipe_id=f"r{i}")
        for i in range(3)
    ]
    schedule = compute_schedule(steps, Resources(burners=2))
    for minute in range(schedule.start, schedule.end):
        burning = sum(1 for p in schedule.placements if p.start <= minute < p.end)
        assert burning <= 2


def test_oven_shares_only_at_matching_temperature():
    oven_220 = (EquipmentUse(kind="oven", temp_c=220),)
    oven_190 = (EquipmentUse(kind="oven", temp_c=190),)
    steps = [
        step("roast", 40, attention=Attention.PASSIVE, equipment=oven_220, recipe_id="r1"),
        step("bake", 30, attention=Attention.PASSIVE, equipment=oven_190, recipe_id="r2"),
    ]
    schedule = compute_schedule(steps, Resources(oven_slots=2))
    a, b = schedule.placements
    assert overlap(a, b) == 0

    same_temp = [
        step("roast", 40, attention=Attention.PASSIVE, equipment=oven_220, recipe_id="r1"),
        step("potatoes", 30, attention=Attention.PASSIVE, equipment=oven_220, recipe_id="r2"),
    ]
    schedule = compute_schedule(same_temp, Resources(oven_slots=2))
    assert all(p.end == 0 for p in schedule.placements)


def test_terminal_step_forced_early_beyond_hold_raises_warning():
    steps = [
        step("carve", 30, hold_max=5, recipe_id="r1"),
        step("toss", 30, hold_max=10, recipe_id="r2"),
    ]
    schedule = compute_schedule(steps, Resources(cooks=1))
    by_id = placements_by_id(schedule)
    # The least holdable dish wins the latest slot; the other is displaced
    # 30 minutes early, beyond its 10-minute hold window.
    assert by_id["carve"].end == 0
    assert by_id["toss"].end == -30
    assert [w.code for w in schedule.warnings] == ["long_hold"]
    assert schedule.warnings[0].step_id == "toss"


def test_schedule_is_deterministic():
    steps = [
        step("a", 12),
        step("b", 7, depends_on=("a",)),
        step("c", 20, attention=Attention.PASSIVE, equipment=BURNER, recipe_id="r2"),
        step("d", 9, recipe_id="r2", depends_on=("c",)),
    ]
    first = compute_schedule(steps, Resources())
    second = compute_schedule(steps, Resources())
    assert [(p.step.id, p.start, p.end) for p in first.placements] == [
        (p.step.id, p.start, p.end) for p in second.placements
    ]


def test_cycle_is_rejected():
    steps = [step("a", 5, depends_on=("b",)), step("b", 5, depends_on=("a",))]
    with pytest.raises(ScheduleError, match="cycle"):
        compute_schedule(steps, Resources())


def test_unknown_dependency_is_rejected():
    with pytest.raises(ScheduleError, match="unknown step"):
        compute_schedule([step("a", 5, depends_on=("ghost",))], Resources())


def test_duplicate_ids_are_rejected():
    with pytest.raises(ScheduleError, match="duplicate"):
        compute_schedule([step("a", 5), step("a", 6)], Resources())


def test_zero_duration_step_is_rejected():
    with pytest.raises(ScheduleError, match="at least one minute"):
        compute_schedule([step("a", 0)], Resources())


def test_replan_pushes_serve_when_time_runs_out():
    steps = [step("a", 10), step("b", 10, depends_on=("a",))]
    # Five minutes before serving with twenty minutes of work left.
    schedule = replan(steps, Resources(), {}, now=-5)
    assert schedule.serve_push == 15
    by_id = placements_by_id(schedule)
    assert by_id["a"].start == -5
    assert by_id["b"].end == 15
    assert any(w.code == "serve_pushed" for w in schedule.warnings)


def test_replan_keeps_finished_steps_pinned():
    steps = [step("a", 10), step("b", 10, depends_on=("a",))]
    progress = {"a": StepProgress(status="done", start=-40, end=-32)}
    schedule = replan(steps, Resources(), progress, now=-30)
    by_id = placements_by_id(schedule)
    assert (by_id["a"].start, by_id["a"].end) == (-40, -32)
    assert by_id["b"].end == 0
    assert schedule.serve_push == 0


def test_replan_running_step_blocks_its_dependents():
    steps = [
        step("roast", 40, attention=Attention.PASSIVE, equipment=(EquipmentUse("oven", 220),)),
        step("rest", 10, attention=Attention.PASSIVE, depends_on=("roast",)),
    ]
    # The roast went in late and still needs until +5 past the target.
    progress = {"roast": StepProgress(status="running", start=-35, end=5)}
    schedule = replan(steps, Resources(), progress, now=-10)
    by_id = placements_by_id(schedule)
    assert by_id["rest"].start >= 5
    assert schedule.serve_push == 15


def test_replan_running_step_frees_equipment_for_later_steps():
    oven_220 = (EquipmentUse(kind="oven", temp_c=220),)
    oven_190 = (EquipmentUse(kind="oven", temp_c=190),)
    steps = [
        step("roast", 30, attention=Attention.PASSIVE, equipment=oven_220, recipe_id="r1"),
        step(
            "bake", 20, attention=Attention.PASSIVE, equipment=oven_190, recipe_id="r2", hold_max=0
        ),
    ]
    progress = {"roast": StepProgress(status="running", start=-60, end=-30)}
    schedule = replan(steps, Resources(oven_slots=1), progress, now=-50)
    by_id = placements_by_id(schedule)
    # The 190C bake cannot overlap the 220C roast, so it starts after it.
    assert by_id["bake"].start >= -30
    assert by_id["bake"].end == 0


def test_replan_with_no_progress_matches_fresh_forward_schedule():
    steps = [step("a", 10), step("b", 10, depends_on=("a",))]
    schedule = replan(steps, Resources(), {}, now=-120)
    by_id = placements_by_id(schedule)
    assert by_id["b"].end == 0
    assert by_id["a"].start >= -120
    assert schedule.serve_push == 0

"""Bridges the persistence layer and the scheduler."""

import uuid
from datetime import timedelta

from sqlmodel import Session

from app.core.timeutil import iso_utc
from app.models import MealPlan, Recipe, RecipeStep
from app.scheduler import Attention, EquipmentUse, Placement, PlanStep, Resources, Schedule
from app.schemas import RecipeIn


def build_recipe(payload: RecipeIn) -> Recipe:
    """Materialize a recipe, resolving step dependency indexes to step ids."""
    ids = [uuid.uuid4().hex for _ in payload.steps]
    steps: list[RecipeStep] = []
    for i, step in enumerate(payload.steps):
        if step.depends_on is None:
            dep_ids = [ids[i - 1]] if i > 0 else []
        else:
            for j in step.depends_on:
                if not 0 <= j < i:
                    raise ValueError(
                        f"step {i + 1} ({step.name!r}) may only depend on earlier steps"
                    )
            dep_ids = [ids[j] for j in step.depends_on]
        steps.append(
            RecipeStep(
                id=ids[i],
                position=i,
                name=step.name,
                instruction=step.instruction,
                duration_min=step.duration_min,
                attention=step.attention,
                equipment=[e.model_dump() for e in step.equipment],
                depends_on=dep_ids,
                hold_max_min=step.hold_max_min,
            )
        )
    return Recipe(
        name=payload.name,
        description=payload.description,
        servings=payload.servings,
        tags=payload.tags,
        ingredients=payload.ingredients,
        steps=steps,
    )


def plan_steps(db: Session, plan: MealPlan) -> tuple[list[PlanStep], list[Recipe], list[str]]:
    """Scheduler steps for a plan, its recipes in plan order, and missing recipe ids."""
    recipes: list[Recipe] = []
    missing: list[str] = []
    for recipe_id in plan.recipe_ids:
        recipe = db.get(Recipe, recipe_id)
        if recipe is None:
            missing.append(recipe_id)
        else:
            recipes.append(recipe)

    steps: list[PlanStep] = []
    for recipe in recipes:
        for row in sorted(recipe.steps, key=lambda s: s.position):
            steps.append(
                PlanStep(
                    id=row.id,
                    recipe_id=recipe.id,
                    recipe_name=recipe.name,
                    name=row.name,
                    instruction=row.instruction,
                    duration=row.duration_min,
                    attention=Attention(row.attention),
                    equipment=tuple(
                        EquipmentUse(kind=e["kind"], temp_c=e.get("temp_c")) for e in row.equipment
                    ),
                    depends_on=tuple(row.depends_on),
                    hold_max=row.hold_max_min,
                )
            )
    return steps, recipes, missing


def plan_resources(plan: MealPlan) -> Resources:
    stored = plan.resources or {}
    return Resources(
        cooks=stored.get("cooks", 1),
        burners=stored.get("burners", 4),
        oven_slots=stored.get("oven_slots", 2),
    )


def entry_payload(placement: Placement, plan: MealPlan) -> dict:
    step = placement.step
    return {
        "step_id": step.id,
        "recipe_id": step.recipe_id,
        "recipe_name": step.recipe_name,
        "name": step.name,
        "instruction": step.instruction,
        "attention": step.attention.value,
        "equipment": [{"kind": e.kind, "temp_c": e.temp_c} for e in step.equipment],
        "duration_min": step.duration,
        "hold_max_min": step.hold_max,
        "start": iso_utc(plan.serve_at + timedelta(minutes=placement.start)),
        "end": iso_utc(plan.serve_at + timedelta(minutes=placement.end)),
    }


def schedule_payload(
    plan: MealPlan,
    schedule: Schedule,
    recipes: list[Recipe],
    missing: list[str] | None = None,
) -> dict:
    warnings = [
        {"code": w.code, "message": w.message, "step_id": w.step_id} for w in schedule.warnings
    ]
    for recipe_id in missing or []:
        warnings.append(
            {
                "code": "missing_recipe",
                "message": f"A recipe in this plan no longer exists (id {recipe_id}).",
                "step_id": None,
            }
        )
    return {
        "plan_id": plan.id,
        "plan_name": plan.name,
        "serve_at": iso_utc(plan.serve_at),
        "serve_eta": iso_utc(plan.serve_at + timedelta(minutes=schedule.serve_push)),
        "serve_push_min": schedule.serve_push,
        "start_at": iso_utc(plan.serve_at + timedelta(minutes=schedule.start)),
        "resources": plan.resources,
        "recipes": [{"id": r.id, "name": r.name} for r in recipes],
        "entries": [entry_payload(p, plan) for p in schedule.placements],
        "warnings": warnings,
    }

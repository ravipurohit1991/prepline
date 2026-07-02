from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.core.db import get_db
from app.core.timeutil import iso_utc
from app.models import MealPlan, Recipe
from app.scheduler import ScheduleError, compute_schedule
from app.schemas import PlanIn, PlanOut, ResourcesIO
from app.services.planning import plan_resources, plan_steps, schedule_payload

router = APIRouter(prefix="/plans", tags=["plans"])


def plan_out(plan: MealPlan) -> PlanOut:
    return PlanOut(
        id=plan.id,
        name=plan.name,
        serve_at=iso_utc(plan.serve_at),
        recipe_ids=plan.recipe_ids,
        resources=ResourcesIO(**(plan.resources or {})),
        created_at=iso_utc(plan.created_at),
    )


def _get_or_404(db: Session, plan_id: str) -> MealPlan:
    plan = db.get(MealPlan, plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="plan not found")
    return plan


def _check_recipes(db: Session, recipe_ids: list[str]) -> None:
    for recipe_id in recipe_ids:
        if db.get(Recipe, recipe_id) is None:
            raise HTTPException(status_code=422, detail=f"unknown recipe id {recipe_id}")


@router.get("", response_model=list[PlanOut])
def list_plans(db: Session = Depends(get_db)) -> list[PlanOut]:
    plans = db.exec(select(MealPlan).order_by(MealPlan.created_at.desc())).all()
    return [plan_out(p) for p in plans]


@router.post("", response_model=PlanOut, status_code=201)
def create_plan(payload: PlanIn, db: Session = Depends(get_db)) -> PlanOut:
    _check_recipes(db, payload.recipe_ids)
    plan = MealPlan(
        name=payload.name,
        serve_at=payload.serve_at,
        recipe_ids=payload.recipe_ids,
        resources=payload.resources.model_dump(),
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan_out(plan)


@router.get("/{plan_id}", response_model=PlanOut)
def get_plan(plan_id: str, db: Session = Depends(get_db)) -> PlanOut:
    return plan_out(_get_or_404(db, plan_id))


@router.put("/{plan_id}", response_model=PlanOut)
def update_plan(plan_id: str, payload: PlanIn, db: Session = Depends(get_db)) -> PlanOut:
    plan = _get_or_404(db, plan_id)
    _check_recipes(db, payload.recipe_ids)
    plan.name = payload.name
    plan.serve_at = payload.serve_at
    plan.recipe_ids = payload.recipe_ids
    plan.resources = payload.resources.model_dump()
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan_out(plan)


@router.delete("/{plan_id}", status_code=204)
def delete_plan(plan_id: str, db: Session = Depends(get_db)) -> None:
    plan = _get_or_404(db, plan_id)
    db.delete(plan)
    db.commit()


@router.get("/{plan_id}/schedule")
def get_schedule(plan_id: str, db: Session = Depends(get_db)) -> dict:
    plan = _get_or_404(db, plan_id)
    steps, recipes, missing = plan_steps(db, plan)
    try:
        schedule = compute_schedule(steps, plan_resources(plan))
    except ScheduleError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return schedule_payload(plan, schedule, recipes, missing)

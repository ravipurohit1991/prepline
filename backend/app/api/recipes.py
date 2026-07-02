from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.core.db import get_db
from app.core.timeutil import iso_utc
from app.models import Recipe
from app.schemas import EquipmentUseIO, RecipeIn, RecipeOut, StepOut
from app.services.planning import build_recipe

router = APIRouter(prefix="/recipes", tags=["recipes"])


def recipe_out(recipe: Recipe) -> RecipeOut:
    return RecipeOut(
        id=recipe.id,
        name=recipe.name,
        description=recipe.description,
        servings=recipe.servings,
        tags=recipe.tags,
        ingredients=recipe.ingredients,
        created_at=iso_utc(recipe.created_at),
        steps=[
            StepOut(
                id=s.id,
                position=s.position,
                name=s.name,
                instruction=s.instruction,
                duration_min=s.duration_min,
                attention=s.attention,
                equipment=[EquipmentUseIO(**e) for e in s.equipment],
                depends_on=s.depends_on,
                hold_max_min=s.hold_max_min,
            )
            for s in sorted(recipe.steps, key=lambda s: s.position)
        ],
    )


def _get_or_404(db: Session, recipe_id: str) -> Recipe:
    recipe = db.get(Recipe, recipe_id)
    if recipe is None:
        raise HTTPException(status_code=404, detail="recipe not found")
    return recipe


@router.get("", response_model=list[RecipeOut])
def list_recipes(db: Session = Depends(get_db)) -> list[RecipeOut]:
    recipes = db.exec(select(Recipe).order_by(Recipe.created_at)).all()
    return [recipe_out(r) for r in recipes]


@router.post("", response_model=RecipeOut, status_code=201)
def create_recipe(payload: RecipeIn, db: Session = Depends(get_db)) -> RecipeOut:
    try:
        recipe = build_recipe(payload)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    db.add(recipe)
    db.commit()
    db.refresh(recipe)
    return recipe_out(recipe)


@router.get("/{recipe_id}", response_model=RecipeOut)
def get_recipe(recipe_id: str, db: Session = Depends(get_db)) -> RecipeOut:
    return recipe_out(_get_or_404(db, recipe_id))


@router.put("/{recipe_id}", response_model=RecipeOut)
def update_recipe(recipe_id: str, payload: RecipeIn, db: Session = Depends(get_db)) -> RecipeOut:
    recipe = _get_or_404(db, recipe_id)
    try:
        fresh = build_recipe(payload)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    recipe.name = fresh.name
    recipe.description = fresh.description
    recipe.servings = fresh.servings
    recipe.tags = fresh.tags
    recipe.ingredients = fresh.ingredients
    recipe.steps = fresh.steps
    db.add(recipe)
    db.commit()
    db.refresh(recipe)
    return recipe_out(recipe)


@router.delete("/{recipe_id}", status_code=204)
def delete_recipe(recipe_id: str, db: Session = Depends(get_db)) -> None:
    recipe = _get_or_404(db, recipe_id)
    db.delete(recipe)
    db.commit()

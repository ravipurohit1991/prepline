import uuid
from datetime import datetime

from sqlmodel import JSON, Column, Field, Relationship, SQLModel

from app.core.timeutil import utcnow


def _uuid() -> str:
    return uuid.uuid4().hex


class Recipe(SQLModel, table=True):
    id: str = Field(default_factory=_uuid, primary_key=True)
    name: str = Field(index=True)
    description: str = ""
    servings: int = 4
    tags: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    ingredients: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utcnow)

    steps: list["RecipeStep"] = Relationship(
        back_populates="recipe",
        sa_relationship_kwargs={
            "order_by": "RecipeStep.position",
            "cascade": "all, delete-orphan",
        },
    )


class RecipeStep(SQLModel, table=True):
    id: str = Field(default_factory=_uuid, primary_key=True)
    recipe_id: str = Field(foreign_key="recipe.id", index=True)
    position: int
    name: str
    instruction: str = ""
    duration_min: int
    attention: str = "active"
    equipment: list[dict] = Field(default_factory=list, sa_column=Column(JSON))
    depends_on: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    hold_max_min: int = 15

    recipe: Recipe = Relationship(back_populates="steps")


class MealPlan(SQLModel, table=True):
    id: str = Field(default_factory=_uuid, primary_key=True)
    name: str
    serve_at: datetime
    recipe_ids: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    resources: dict = Field(default_factory=dict, sa_column=Column(JSON))
    # Per-recipe serving overrides for this plan. Missing keys fall back to
    # the recipe's own ``servings`` value when the plan is scheduled.
    recipe_servings: dict[str, int] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utcnow)


class CookSession(SQLModel, table=True):
    id: str = Field(default_factory=_uuid, primary_key=True)
    plan_id: str = Field(foreign_key="mealplan.id", index=True)
    status: str = "live"
    started_at: datetime = Field(default_factory=utcnow)
    progress: dict = Field(default_factory=dict, sa_column=Column(JSON))

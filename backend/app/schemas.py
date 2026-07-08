from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.core.timeutil import to_naive_utc

Attention = Literal["active", "passive"]


class EquipmentUseIO(BaseModel):
    kind: str = Field(min_length=1, max_length=40)
    temp_c: int | None = Field(default=None, ge=40, le=350)


class StepIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    instruction: str = ""
    duration_min: int = Field(ge=1, le=24 * 60)
    attention: Attention = "active"
    equipment: list[EquipmentUseIO] = Field(default_factory=list, max_length=4)
    # Indexes of earlier steps this one waits for; None means "the previous step".
    depends_on: list[int] | None = None
    hold_max_min: int = Field(default=15, ge=0, le=24 * 60)


class RecipeIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    servings: int = Field(default=4, ge=1, le=50)
    tags: list[str] = Field(default_factory=list, max_length=10)
    ingredients: list[str] = Field(default_factory=list, max_length=60)
    steps: list[StepIn] = Field(min_length=1, max_length=60)


class StepOut(BaseModel):
    id: str
    position: int
    name: str
    instruction: str
    duration_min: int
    attention: str
    equipment: list[EquipmentUseIO]
    depends_on: list[str]
    hold_max_min: int


class RecipeOut(BaseModel):
    id: str
    name: str
    description: str
    servings: int
    tags: list[str]
    ingredients: list[str]
    created_at: str
    steps: list[StepOut]


class ResourcesIO(BaseModel):
    cooks: int = Field(default=1, ge=1, le=6)
    burners: int = Field(default=4, ge=0, le=12)
    oven_slots: int = Field(default=2, ge=0, le=6)


class PlanIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    serve_at: datetime
    recipe_ids: list[str] = Field(min_length=1, max_length=12)
    resources: ResourcesIO = Field(default_factory=ResourcesIO)
    # Optional per-recipe serving overrides for this plan. Keys must reference
    # recipes in ``recipe_ids``; values must be in [1, 50]. Omitted recipes
    # use their own ``servings`` value when the plan is scheduled.
    recipe_servings: dict[str, int] = Field(default_factory=dict)

    @field_validator("serve_at")
    @classmethod
    def _normalize(cls, value: datetime) -> datetime:
        return to_naive_utc(value)

    @field_validator("recipe_servings")
    @classmethod
    def _validate_servings(cls, value: dict[str, int]) -> dict[str, int]:
        for recipe_id, servings in value.items():
            if not isinstance(servings, int) or isinstance(servings, bool):
                raise ValueError(f"recipe_servings[{recipe_id!r}] must be an integer")
            if servings < 1 or servings > 50:
                raise ValueError(f"recipe_servings[{recipe_id!r}] must be between 1 and 50")
        return value


class PlanOut(BaseModel):
    id: str
    name: str
    serve_at: str
    recipe_ids: list[str]
    resources: ResourcesIO
    recipe_servings: dict[str, int]
    created_at: str


class SessionCreate(BaseModel):
    plan_id: str


class EventIn(BaseModel):
    type: Literal["start_step", "complete_step", "delay_step", "reset_step", "finish"]
    step_id: str | None = None
    minutes: int = Field(default=5, ge=1, le=120)


class ShoppingListRecipeRef(BaseModel):
    recipe_id: str
    recipe_name: str


class ShoppingListItem(BaseModel):
    display: str
    normalized: str
    count: int
    recipes: list[ShoppingListRecipeRef]


class ShoppingListOut(BaseModel):
    plan_id: str
    plan_name: str
    items: list[ShoppingListItem]
    warnings: list[dict]

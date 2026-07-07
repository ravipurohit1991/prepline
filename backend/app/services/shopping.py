"""Shopping-list generation for a meal plan.

Ingredients are currently free-form strings, so this is deliberately a
"first slice": it deduplicates entries that normalize to the same text and
shows which recipes each item comes from. Unit consolidation across different
wordings (e.g. "80 g butter" and "100 g cold butter") is intentionally left
for a future parser.
"""

from __future__ import annotations

import re
from collections import OrderedDict
from dataclasses import dataclass, field

from app.models import MealPlan, Recipe


@dataclass
class ShoppingListRecipeRef:
    recipe_id: str
    recipe_name: str


@dataclass
class ShoppingListItem:
    display: str
    normalized: str
    recipes: list[ShoppingListRecipeRef] = field(default_factory=list)

    @property
    def count(self) -> int:
        return len(self.recipes)


_NORMALIZE_RE = re.compile(r"\s+")


def _normalize(text: str) -> str:
    """Lowercase, trim, collapse whitespace, and drop common leading bullets."""
    text = text.strip()
    if text.startswith(("-", "*", "•", "–", "—")):
        text = text[1:].strip()
    text = text.lower()
    text = _NORMALIZE_RE.sub(" ", text)
    # Keep internal punctuation; only strip trailing punctuation that is not
    # part of a quantity range like "1–2 kg".
    if text.endswith((",", ".", ";", ":")):
        text = text[:-1].strip()
    return text


def build_shopping_list(plan: MealPlan, recipes: list[Recipe]) -> list[ShoppingListItem]:
    """Combine ingredients for every recipe in a plan.

    Items are returned in first-encounter order. Identical normalized strings
    are merged and attributed to every recipe they appear in.
    """
    by_key: OrderedDict[str, ShoppingListItem] = OrderedDict()
    recipe_by_id = {r.id: r for r in recipes}

    for recipe_id in plan.recipe_ids:
        recipe = recipe_by_id.get(recipe_id)
        if recipe is None:
            continue
        for raw in recipe.ingredients:
            key = _normalize(raw)
            if not key:
                continue
            item = by_key.get(key)
            if item is None:
                item = ShoppingListItem(display=raw.strip(), normalized=key)
                by_key[key] = item
            # Attribute each recipe at most once per item, but preserve the
            # plan order of first appearance.
            if not any(r.recipe_id == recipe.id for r in item.recipes):
                item.recipes.append(
                    ShoppingListRecipeRef(recipe_id=recipe.id, recipe_name=recipe.name)
                )

    return list(by_key.values())

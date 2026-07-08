"""Shopping-list generation for a meal plan.

Ingredients are currently free-form strings, so this is deliberately a
"first slice": it deduplicates entries that normalize to the same text and
shows which recipes each item comes from. It also rescales lines that start
with a single numeric quantity by the per-recipe serving override on the
plan (e.g. ``"80 g butter"`` for a recipe doubled to 8 servings becomes
``"160 g butter"``). Lines without a recognizable leading number are left
as-is so free text like "salt to taste" still reads naturally. Unit
consolidation across different wordings is intentionally left for a future
parser.
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
# Match a single number at the very start of the line. Supports both
# integer ("80 g butter") and decimal ("1.5 kg potatoes") forms, and an
# optional unicode fraction ("½", "¼", "¾"). Quantities with a unit ("2 tbsp
# oil") are not handled here because units are free-form and the first
# slice is intentionally narrow.
_LEADING_NUM_RE = re.compile(r"^\s*(?P<num>\d+(?:\.\d+)?|[½¼¾⅓⅔⅛⅜⅝⅞])\s*(?P<rest>.*)$")
_FRACTION_VALUES = {
    "½": 0.5,
    "¼": 0.25,
    "¾": 0.75,
    "⅓": 1 / 3,
    "⅔": 2 / 3,
    "⅛": 0.125,
    "⅜": 0.375,
    "⅝": 0.625,
    "⅞": 0.875,
}


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


def _scale_factor(plan: MealPlan, recipe: Recipe) -> float:
    """Servings-scale ratio for ``recipe`` against the plan override."""
    target = (plan.recipe_servings or {}).get(recipe.id, recipe.servings)
    if recipe.servings <= 0 or target <= 0:
        return 1.0
    return target / recipe.servings


def _parse_leading_number(text: str) -> tuple[float, str] | None:
    match = _LEADING_NUM_RE.match(text)
    if match is None:
        return None
    raw = match.group("num")
    if raw in _FRACTION_VALUES:
        value = _FRACTION_VALUES[raw]
    else:
        try:
            value = float(raw)
        except ValueError:
            return None
    return value, match.group("rest")


def _format_scaled_number(value: float) -> str:
    """Render a scaled quantity, keeping the original style when reasonable."""
    rounded = round(value, 2)
    if abs(rounded - round(rounded)) < 1e-9:
        return str(int(round(rounded)))
    # Trim trailing zeros from the decimal form.
    return f"{rounded:g}"


def _scale_ingredient(text: str, factor: float) -> str:
    """Multiply the leading number of ``text`` by ``factor``; otherwise return ``text``."""
    if factor == 1.0:
        return text
    parsed = _parse_leading_number(text.strip())
    if parsed is None:
        return text
    value, rest = parsed
    scaled = value * factor
    if abs(scaled - value) < 1e-9:
        return text
    return f"{_format_scaled_number(scaled)} {rest}".strip()


def build_shopping_list(plan: MealPlan, recipes: list[Recipe]) -> list[ShoppingListItem]:
    """Combine ingredients for every recipe in a plan.

    Items are returned in first-encounter order. Identical normalized strings
    are merged and attributed to every recipe they appear in. When the plan
    overrides a recipe's serving count, leading quantities in that recipe's
    ingredient lines are scaled by the same ratio.
    """
    by_key: OrderedDict[str, ShoppingListItem] = OrderedDict()
    recipe_by_id = {r.id: r for r in recipes}

    for recipe_id in plan.recipe_ids:
        recipe = recipe_by_id.get(recipe_id)
        if recipe is None:
            continue
        factor = _scale_factor(plan, recipe)
        for raw in recipe.ingredients:
            display = _scale_ingredient(raw, factor)
            key = _normalize(display)
            if not key:
                continue
            item = by_key.get(key)
            if item is None:
                item = ShoppingListItem(display=display, normalized=key)
                by_key[key] = item
            # Attribute each recipe at most once per item, but preserve the
            # plan order of first appearance.
            if not any(r.recipe_id == recipe.id for r in item.recipes):
                item.recipes.append(
                    ShoppingListRecipeRef(recipe_id=recipe.id, recipe_name=recipe.name)
                )

    return list(by_key.values())

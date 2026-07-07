from app.models import MealPlan, Recipe
from app.services.shopping import _normalize, build_shopping_list


def test_normalize_collapses_whitespace_and_bullets():
    assert _normalize("  *  80 g soft butter  ") == "80 g soft butter"
    assert _normalize("- 1 kg potatoes,") == "1 kg potatoes"
    assert _normalize("Salt \t &   pepper.") == "salt & pepper"


def test_build_shopping_list_returns_items_in_first_encounter_order():
    r1 = Recipe(id="r1", name="Chicken", ingredients=["1 chicken", "80 g butter"])
    r2 = Recipe(id="r2", name="Potatoes", ingredients=["1 kg potatoes", "80 g butter"])
    plan = MealPlan(name="Dinner", recipe_ids=["r1", "r2"])

    items = build_shopping_list(plan, [r1, r2])
    assert [i.display for i in items] == ["1 chicken", "80 g butter", "1 kg potatoes"]


def test_build_shopping_list_deduplicates_case_and_punctuation():
    r1 = Recipe(id="r1", name="A", ingredients=["80 g soft butter"])
    r2 = Recipe(id="r2", name="B", ingredients=["- 80 g soft butter."])
    plan = MealPlan(name="Dinner", recipe_ids=["r1", "r2"])

    items = build_shopping_list(plan, [r1, r2])
    assert len(items) == 1
    assert items[0].display == "80 g soft butter"
    assert items[0].count == 2


def test_build_shopping_list_attribution_is_unique_per_recipe():
    r1 = Recipe(id="r1", name="A", ingredients=["salt", "salt"])
    plan = MealPlan(name="Dinner", recipe_ids=["r1"])

    items = build_shopping_list(plan, [r1])
    assert len(items) == 1
    assert items[0].count == 1


def test_build_shopping_list_skips_missing_recipes():
    r1 = Recipe(id="r1", name="A", ingredients=["salt"])
    plan = MealPlan(name="Dinner", recipe_ids=["r1", "missing"])

    items = build_shopping_list(plan, [r1])
    assert len(items) == 1
    assert items[0].recipes[0].recipe_id == "r1"

"""Demo content: a six-dish Sunday roast that exercises every constraint —
shared oven temperatures, burner contention, one pair of hands, and dishes
that must land hot at the table.

Run ``python -m app.seed`` to seed an empty database, ``--reset`` to wipe
and reseed.
"""

import argparse
from datetime import timedelta

from sqlmodel import Session, SQLModel, delete, select

from app.core.config import Settings
from app.core.db import make_engine
from app.core.timeutil import utcnow
from app.models import CookSession, MealPlan, Recipe, RecipeStep
from app.schemas import RecipeIn
from app.services.planning import build_recipe

OVEN_HOT = [{"kind": "oven", "temp_c": 220}]
OVEN_MED = [{"kind": "oven", "temp_c": 190}]
BURNER = [{"kind": "burner"}]

DEMO_RECIPES: list[dict] = [
    {
        "name": "Herb-Butter Roast Chicken",
        "description": "Spatchcocked for even, faster roasting; the centrepiece the whole plan revolves around.",
        "servings": 4,
        "tags": ["main", "roast"],
        "ingredients": [
            "1 whole chicken (about 1.6 kg)",
            "80 g soft butter",
            "1 lemon",
            "4 sprigs thyme",
            "2 sprigs rosemary",
            "3 garlic cloves",
            "Salt & black pepper",
        ],
        "steps": [
            {
                "name": "Spatchcock & dry the chicken",
                "instruction": "Cut out the backbone with shears, press flat, and pat completely dry.",
                "duration_min": 12,
                "attention": "active",
            },
            {
                "name": "Work herb butter under the skin",
                "instruction": "Mash butter with chopped herbs, garlic and lemon zest; spread under the breast skin and season all over.",
                "duration_min": 6,
                "attention": "active",
            },
            {
                "name": "Roast at 220 °C",
                "instruction": "Roast skin-side up until the thickest part of the thigh reads 74 °C.",
                "duration_min": 50,
                "attention": "passive",
                "equipment": OVEN_HOT,
            },
            {
                "name": "Rest under foil",
                "instruction": "Tent loosely with foil. Do not skip — the juices need to settle.",
                "duration_min": 12,
                "attention": "passive",
            },
            {
                "name": "Carve & platter",
                "instruction": "Carve, pile onto a warm platter, pour over any resting juices.",
                "duration_min": 6,
                "attention": "active",
                "hold_max_min": 10,
            },
        ],
    },
    {
        "name": "Crispy Smashed Potatoes",
        "description": "Parboiled, smashed flat and roasted until shattering-crisp. Worst dish to let sit — schedule it last.",
        "servings": 4,
        "tags": ["side"],
        "ingredients": [
            "1 kg baby potatoes",
            "4 tbsp olive oil",
            "Flaky salt",
            "2 sprigs rosemary",
        ],
        "steps": [
            {
                "name": "Scrub & halve the potatoes",
                "instruction": "Scrub well; halve anything bigger than a golf ball.",
                "duration_min": 6,
                "attention": "active",
            },
            {
                "name": "Parboil until fork-tender",
                "instruction": "Start in cold salted water, bring to a boil and cook until a fork slides in.",
                "duration_min": 18,
                "attention": "passive",
                "equipment": BURNER,
            },
            {
                "name": "Drain, smash & oil",
                "instruction": "Steam-dry 2 minutes, smash flat on an oiled tray, brush generously with oil.",
                "duration_min": 6,
                "attention": "active",
            },
            {
                "name": "Roast at 220 °C until crisp",
                "instruction": "Roast without turning until deep golden at the edges.",
                "duration_min": 25,
                "attention": "passive",
                "equipment": OVEN_HOT,
            },
            {
                "name": "Flaky salt & serve",
                "instruction": "Scatter with rosemary and flaky salt straight out of the oven.",
                "duration_min": 2,
                "attention": "active",
                "hold_max_min": 5,
            },
        ],
    },
    {
        "name": "Maple-Glazed Carrots",
        "description": "Simmered then glazed in maple butter until lacquered.",
        "servings": 4,
        "tags": ["side"],
        "ingredients": [
            "600 g carrots",
            "2 tbsp maple syrup",
            "30 g butter",
            "2 sprigs thyme",
        ],
        "steps": [
            {
                "name": "Peel & bias-cut the carrots",
                "instruction": "Peel and cut on a steep angle, about 1 cm thick.",
                "duration_min": 7,
                "attention": "active",
            },
            {
                "name": "Simmer in salted water",
                "instruction": "Simmer until just tender — they finish in the glaze.",
                "duration_min": 10,
                "attention": "passive",
                "equipment": BURNER,
            },
            {
                "name": "Glaze with maple & butter",
                "instruction": "Drain, add butter, maple and thyme; toss over high heat until glossy.",
                "duration_min": 6,
                "attention": "active",
                "equipment": BURNER,
                "hold_max_min": 15,
            },
        ],
    },
    {
        "name": "Proper Pan Gravy",
        "description": "A stock-based gravy you can build while the bird rests.",
        "servings": 4,
        "tags": ["sauce"],
        "ingredients": [
            "30 g butter",
            "2 tbsp flour",
            "500 ml hot chicken stock",
            "Splash of cream (optional)",
            "Black pepper",
        ],
        "steps": [
            {
                "name": "Make the roux",
                "instruction": "Melt butter, whisk in flour, cook to a pale biscuit colour.",
                "duration_min": 5,
                "attention": "active",
                "equipment": BURNER,
            },
            {
                "name": "Whisk in stock & simmer",
                "instruction": "Add hot stock in stages, whisking; simmer gently to thicken.",
                "duration_min": 8,
                "attention": "passive",
                "equipment": BURNER,
            },
            {
                "name": "Season & finish",
                "instruction": "Season, add a splash of cream if you like, keep warm on the lowest heat.",
                "duration_min": 3,
                "attention": "active",
                "equipment": BURNER,
                "hold_max_min": 20,
            },
        ],
    },
    {
        "name": "Apple-Oat Crumble",
        "description": "Bakes at a different temperature than the roast — watch the scheduler route it around the oven conflict.",
        "servings": 4,
        "tags": ["dessert"],
        "ingredients": [
            "5 apples",
            "80 g rolled oats",
            "80 g flour",
            "90 g brown sugar",
            "100 g cold butter",
            "1 tsp cinnamon",
        ],
        "steps": [
            {
                "name": "Peel & slice the apples",
                "instruction": "Peel, core and slice; toss with a spoon of sugar and the cinnamon.",
                "duration_min": 10,
                "attention": "active",
                "depends_on": [],
            },
            {
                "name": "Rub the crumble topping",
                "instruction": "Rub cold butter into flour, oats and sugar until clumpy.",
                "duration_min": 8,
                "attention": "active",
                "depends_on": [],
            },
            {
                "name": "Assemble in the baking dish",
                "instruction": "Apples below, topping above. Don't press it down.",
                "duration_min": 4,
                "attention": "active",
                "depends_on": [0, 1],
            },
            {
                "name": "Bake at 190 °C until bubbling",
                "instruction": "Bake until the juices bubble up through the topping.",
                "duration_min": 35,
                "attention": "passive",
                "equipment": OVEN_MED,
                "hold_max_min": 90,
            },
        ],
    },
    {
        "name": "Lemon-Dressed Greens",
        "description": "Sharp, cold contrast to the roast. Dress at the last possible minute.",
        "servings": 4,
        "tags": ["salad"],
        "ingredients": [
            "150 g mixed leaves",
            "1 lemon",
            "3 tbsp olive oil",
            "1 tsp dijon mustard",
            "1 small shallot",
        ],
        "steps": [
            {
                "name": "Wash & spin the leaves",
                "instruction": "Wash, spin very dry, keep cold.",
                "duration_min": 5,
                "attention": "active",
                "depends_on": [],
            },
            {
                "name": "Shake the dressing",
                "instruction": "Shake lemon, oil, dijon and minced shallot in a jar; season.",
                "duration_min": 4,
                "attention": "active",
                "depends_on": [],
            },
            {
                "name": "Toss & plate",
                "instruction": "Dress lightly at the very last moment.",
                "duration_min": 3,
                "attention": "active",
                "depends_on": [0, 1],
                "hold_max_min": 5,
            },
        ],
    },
]

DEMO_PLAN_NAME = "Sunday Roast for Four"


def _upcoming_half_hour(lead_minutes: int = 150):
    moment = utcnow() + timedelta(minutes=lead_minutes)
    moment = moment.replace(second=0, microsecond=0)
    spare = (30 - moment.minute % 30) % 30
    return moment + timedelta(minutes=spare)


def seed_demo(engine, *, force: bool = False) -> bool:
    with Session(engine) as db:
        if db.exec(select(Recipe)).first() is not None:
            if not force:
                return False
            for table in (CookSession, MealPlan, RecipeStep, Recipe):
                db.exec(delete(table))
            db.commit()

        recipes = [build_recipe(RecipeIn(**data)) for data in DEMO_RECIPES]
        for recipe in recipes:
            db.add(recipe)
        db.commit()

        plan = MealPlan(
            name=DEMO_PLAN_NAME,
            serve_at=_upcoming_half_hour(),
            recipe_ids=[r.id for r in recipes],
            resources={"cooks": 1, "burners": 4, "oven_slots": 2},
        )
        db.add(plan)
        db.commit()
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed the Prepline database with a demo dinner.")
    parser.add_argument("--reset", action="store_true", help="wipe existing data first")
    args = parser.parse_args()

    settings = Settings()
    engine = make_engine(settings.database_url)
    SQLModel.metadata.create_all(engine)
    if seed_demo(engine, force=args.reset):
        print(f"Seeded {len(DEMO_RECIPES)} recipes and the '{DEMO_PLAN_NAME}' plan.")
    else:
        print("Database already has recipes — use --reset to reseed.")


if __name__ == "__main__":
    main()

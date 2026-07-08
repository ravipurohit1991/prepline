from datetime import UTC, datetime, timedelta


def recipe_payload(name: str = "Test Roast", *, servings: int = 4) -> dict:
    return {
        "name": name,
        "description": "test dish",
        "servings": servings,
        "ingredients": ["80 g butter", "salt to taste", "1.5 kg potatoes"],
        "steps": [
            {"name": "prep", "duration_min": 10},
            {
                "name": "cook",
                "duration_min": 20,
                "attention": "passive",
                "equipment": [{"kind": "burner"}],
            },
            {"name": "plate", "duration_min": 5, "hold_max_min": 5},
        ],
    }


def serve_at(minutes_from_now: int) -> datetime:
    return datetime.now(UTC) + timedelta(minutes=minutes_from_now)


def make_recipe(client, name: str = "Test Roast", *, servings: int = 4) -> dict:
    response = client.post("/api/recipes", json=recipe_payload(name, servings=servings))
    assert response.status_code == 201, response.text
    return response.json()


def make_plan(
    client,
    recipe_ids: list[str],
    *,
    minutes_from_now: int = 120,
    recipe_servings: dict[str, int] | None = None,
) -> dict:
    body: dict = {
        "name": "Test Dinner",
        "serve_at": serve_at(minutes_from_now).isoformat(),
        "recipe_ids": recipe_ids,
    }
    if recipe_servings:
        body["recipe_servings"] = recipe_servings
    response = client.post("/api/plans", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def test_plan_steps_scale_duration_by_recipe_servings(client):
    recipe = make_recipe(client, "Doubled", servings=4)
    plan = make_plan(client, [recipe["id"]], recipe_servings={recipe["id"]: 8})

    response = client.get(f"/api/plans/{plan['id']}/schedule")
    assert response.status_code == 200
    schedule = response.json()

    durations = {entry["step_id"]: entry["duration_min"] for entry in schedule["entries"]}
    # Base 10/20/5 -> scaled by 2.0 -> 20/40/10.
    assert durations[recipe["steps"][0]["id"]] == 20
    assert durations[recipe["steps"][1]["id"]] == 40
    assert durations[recipe["steps"][2]["id"]] == 10

    recipe_meta = next(r for r in schedule["recipes"] if r["id"] == recipe["id"])
    assert recipe_meta["servings"] == 8
    for entry in schedule["entries"]:
        if entry["recipe_id"] == recipe["id"]:
            assert entry["servings"] == 8


def test_plan_steps_floor_scaled_duration_to_one_minute(client):
    recipe = make_recipe(client, "Tiny", servings=10)
    plan = make_plan(client, [recipe["id"]], recipe_servings={recipe["id"]: 1})

    response = client.get(f"/api/plans/{plan['id']}/schedule")
    assert response.status_code == 200
    schedule = response.json()
    # 10/20/5 scaled by 0.1 -> 1/2/1 (rounded, then floored at 1).
    durations = sorted(entry["duration_min"] for entry in schedule["entries"])
    assert durations[0] >= 1
    assert all(d >= 1 for d in durations)


def test_plan_steps_default_to_recipe_servings_when_omitted(client):
    recipe = make_recipe(client, "Default", servings=6)
    plan = make_plan(client, [recipe["id"]])

    response = client.get(f"/api/plans/{plan['id']}/schedule")
    schedule = response.json()
    recipe_meta = next(r for r in schedule["recipes"] if r["id"] == recipe["id"])
    assert recipe_meta["servings"] == 6
    for entry in schedule["entries"]:
        if entry["recipe_id"] == recipe["id"]:
            assert entry["servings"] == 6


def test_plan_recipe_servings_round_trip(client):
    recipe = make_recipe(client, "Persisted", servings=2)
    plan = make_plan(client, [recipe["id"]], recipe_servings={recipe["id"]: 6})

    fetched = client.get(f"/api/plans/{plan['id']}").json()
    assert fetched["recipe_servings"] == {recipe["id"]: 6}

    response = client.put(
        f"/api/plans/{plan['id']}",
        json={
            "name": "Renamed",
            "serve_at": plan["serve_at"],
            "recipe_ids": [recipe["id"]],
            "recipe_servings": {recipe["id"]: 3},
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["recipe_servings"] == {recipe["id"]: 3}


def test_plan_rejects_unknown_recipe_in_servings(client):
    recipe = make_recipe(client)
    response = client.post(
        "/api/plans",
        json={
            "name": "Bad",
            "serve_at": serve_at(60).isoformat(),
            "recipe_ids": [recipe["id"]],
            "recipe_servings": {"nope": 4},
        },
    )
    assert response.status_code == 422
    assert "unknown recipe id nope" in response.text


def test_plan_rejects_out_of_range_servings(client):
    recipe = make_recipe(client)
    response = client.post(
        "/api/plans",
        json={
            "name": "Bad",
            "serve_at": serve_at(60).isoformat(),
            "recipe_ids": [recipe["id"]],
            "recipe_servings": {recipe["id"]: 0},
        },
    )
    assert response.status_code == 422


def test_shopping_list_scales_leading_quantities(client):
    recipe = make_recipe(client, "Dinner", servings=4)
    plan = make_plan(client, [recipe["id"]], recipe_servings={recipe["id"]: 8})

    data = client.get(f"/api/plans/{plan['id']}/shopping-list").json()
    by_display = {item["display"]: item for item in data["items"]}
    assert by_display["160 g butter"]["count"] == 1
    assert by_display["3 kg potatoes"]["count"] == 1
    # "salt to taste" has no leading number and is left untouched.
    assert "salt to taste" in by_display


def test_shopping_list_leaves_text_intact_when_factor_is_one(client):
    recipe = make_recipe(client, "Same", servings=2)
    plan = make_plan(client, [recipe["id"]])

    data = client.get(f"/api/plans/{plan['id']}/shopping-list").json()
    displays = {item["display"] for item in data["items"]}
    assert "80 g butter" in displays
    assert "1.5 kg potatoes" in displays


def test_shopping_list_scales_down_for_smaller_party(client):
    recipe = make_recipe(client, "Smaller", servings=4)
    plan = make_plan(client, [recipe["id"]], recipe_servings={recipe["id"]: 2})

    data = client.get(f"/api/plans/{plan['id']}/shopping-list").json()
    by_display = {item["display"]: item for item in data["items"]}
    assert "40 g butter" in by_display
    assert "0.75 kg potatoes" in by_display

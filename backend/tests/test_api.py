from datetime import UTC, datetime, timedelta


def recipe_payload(name: str) -> dict:
    return {
        "name": name,
        "description": "test dish",
        "ingredients": ["thing one", "thing two"],
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


def serve_at(minutes_from_now: int) -> str:
    return (datetime.now(UTC) + timedelta(minutes=minutes_from_now)).isoformat()


def make_recipe(client, name: str = "Test Roast") -> dict:
    response = client.post("/api/recipes", json=recipe_payload(name))
    assert response.status_code == 201, response.text
    return response.json()


def make_plan(client, recipe_ids: list[str], minutes_from_now: int = 120) -> dict:
    response = client.post(
        "/api/plans",
        json={
            "name": "Test Dinner",
            "serve_at": serve_at(minutes_from_now),
            "recipe_ids": recipe_ids,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_recipe_crud(client):
    recipe = make_recipe(client)
    assert [s["name"] for s in recipe["steps"]] == ["prep", "cook", "plate"]
    # Default chaining: each step depends on the previous one.
    assert recipe["steps"][1]["depends_on"] == [recipe["steps"][0]["id"]]

    listed = client.get("/api/recipes").json()
    assert [r["name"] for r in listed] == ["Test Roast"]

    update = recipe_payload("Renamed Roast")
    update["steps"] = update["steps"][:2]
    response = client.put(f"/api/recipes/{recipe['id']}", json=update)
    assert response.status_code == 200
    assert response.json()["name"] == "Renamed Roast"
    assert len(response.json()["steps"]) == 2

    assert client.delete(f"/api/recipes/{recipe['id']}").status_code == 204
    assert client.get(f"/api/recipes/{recipe['id']}").status_code == 404


def test_recipe_rejects_forward_dependencies(client):
    payload = recipe_payload("Bad Deps")
    payload["steps"][0]["depends_on"] = [2]
    response = client.post("/api/recipes", json=payload)
    assert response.status_code == 422


def test_plan_schedule_lands_on_serve_time(client):
    first = make_recipe(client, "Dish One")
    second = make_recipe(client, "Dish Two")
    plan = make_plan(client, [first["id"], second["id"]])

    response = client.get(f"/api/plans/{plan['id']}/schedule")
    assert response.status_code == 200, response.text
    schedule = response.json()
    assert schedule["serve_push_min"] == 0
    assert len(schedule["entries"]) == 6

    serve = schedule["serve_at"]
    assert all(entry["end"] <= serve for entry in schedule["entries"])
    assert max(entry["end"] for entry in schedule["entries"]) == serve

    ends = {e["step_id"]: e["end"] for e in schedule["entries"]}
    starts = {e["step_id"]: e["start"] for e in schedule["entries"]}
    for recipe in (first, second):
        steps = recipe["steps"]
        for step in steps:
            for dep in step["depends_on"]:
                assert ends[dep] <= starts[step["id"]]


def test_plan_with_unknown_recipe_is_rejected(client):
    response = client.post(
        "/api/plans",
        json={"name": "Ghost Dinner", "serve_at": serve_at(60), "recipe_ids": ["nope"]},
    )
    assert response.status_code == 422


def test_session_flow(client):
    recipe = make_recipe(client)
    plan = make_plan(client, [recipe["id"]])

    created = client.post("/api/sessions", json={"plan_id": plan["id"]})
    assert created.status_code == 201, created.text
    state = created.json()
    session_id = state["session_id"]
    assert state["status"] == "live"
    assert all(step["status"] == "pending" for step in state["steps"])
    assert state["serve_push_min"] == 0

    # Creating again reuses the live session.
    again = client.post("/api/sessions", json={"plan_id": plan["id"]})
    assert again.json()["session_id"] == session_id

    first_step = state["steps"][0]
    events = f"/api/sessions/{session_id}/events"

    response = client.post(events, json={"type": "start_step", "step_id": first_step["step_id"]})
    assert response.status_code == 200
    running = next(s for s in response.json()["steps"] if s["step_id"] == first_step["step_id"])
    assert running["status"] == "running"

    # A pending step cannot be delayed.
    other = next(s for s in state["steps"] if s["step_id"] != first_step["step_id"])
    response = client.post(events, json={"type": "delay_step", "step_id": other["step_id"]})
    assert response.status_code == 409

    response = client.post(
        events, json={"type": "delay_step", "step_id": first_step["step_id"], "minutes": 15}
    )
    assert response.status_code == 200

    response = client.post(events, json={"type": "complete_step", "step_id": first_step["step_id"]})
    done = next(s for s in response.json()["steps"] if s["step_id"] == first_step["step_id"])
    assert done["status"] == "done"
    assert done["actual_end"] is not None


def test_session_pushes_serve_when_started_too_late(client):
    recipe = make_recipe(client)  # 35 minutes of work
    plan = make_plan(client, [recipe["id"]], minutes_from_now=5)
    state = client.post("/api/sessions", json={"plan_id": plan["id"]}).json()
    assert state["serve_push_min"] >= 25
    assert any(w["code"] == "serve_pushed" for w in state["warnings"])


def test_session_websocket_round_trip(client):
    recipe = make_recipe(client)
    plan = make_plan(client, [recipe["id"]])
    state = client.post("/api/sessions", json={"plan_id": plan["id"]}).json()

    with client.websocket_connect(f"/api/sessions/{state['session_id']}/ws") as socket:
        hello = socket.receive_json()
        assert hello["type"] == "state"

        first_step = hello["steps"][0]["step_id"]
        socket.send_json({"type": "start_step", "step_id": first_step})
        update = socket.receive_json()
        assert update["type"] == "state"
        started = next(s for s in update["steps"] if s["step_id"] == first_step)
        assert started["status"] == "running"

        socket.send_json({"type": "start_step", "step_id": first_step})
        error = socket.receive_json()
        assert error["type"] == "error"


def test_plan_shopping_list_combines_ingredients(client):
    first = make_recipe(client, "Dish One")
    second = make_recipe(client, "Dish Two")
    # Give the second recipe a duplicate-looking ingredient.
    second["ingredients"].append("thing one")  # overlaps with first recipe's ingredient
    plan = make_plan(client, [first["id"], second["id"]])

    response = client.get(f"/api/plans/{plan['id']}/shopping-list")
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["plan_id"] == plan["id"]
    assert data["plan_name"] == "Test Dinner"

    displays = {item["display"] for item in data["items"]}
    assert "thing one" in displays
    butter = next(item for item in data["items"] if item["display"] == "thing one")
    assert butter["count"] == 2
    assert {ref["recipe_name"] for ref in butter["recipes"]} == {"Dish One", "Dish Two"}


def test_plan_shopping_list_returns_404_for_unknown_plan(client):
    response = client.get("/api/plans/nope/shopping-list")
    assert response.status_code == 404


def test_demo_seed_produces_a_valid_plan(seeded_client):
    recipes = seeded_client.get("/api/recipes").json()
    assert len(recipes) == 6

    plans = seeded_client.get("/api/plans").json()
    assert len(plans) == 1

    schedule = seeded_client.get(f"/api/plans/{plans[0]['id']}/schedule").json()
    assert schedule["serve_push_min"] == 0
    total_steps = sum(len(r["steps"]) for r in recipes)
    assert len(schedule["entries"]) == total_steps

    # The oven never runs two temperatures at once.
    oven_entries = [
        (e["start"], e["end"], next(q["temp_c"] for q in e["equipment"] if q["kind"] == "oven"))
        for e in schedule["entries"]
        if any(q["kind"] == "oven" for q in e["equipment"])
    ]
    assert len(oven_entries) == 3
    for i, (start_a, end_a, temp_a) in enumerate(oven_entries):
        for start_b, end_b, temp_b in oven_entries[i + 1 :]:
            if temp_a != temp_b:
                assert min(end_a, end_b) <= max(start_a, start_b)

"""End-to-end API tests, including the hybrid priority ranking rules.

Run from ``backend/``:  pytest
"""

def make_task(client, title, **kwargs):
    r = client.post("/tasks", json={"title": title, **kwargs})
    assert r.status_code == 201, r.text
    return r.json()


def link(client, source, target, edge_type):
    r = client.post(
        "/edges",
        json={"source_task_id": source["id"], "target_task_id": target["id"], "edge_type": edge_type},
    )
    assert r.status_code == 201, r.text
    return r.json()


def ranks(client):
    return {t["title"]: t["suggested_priority_rank"] for t in client.get("/tasks").json()}


def test_task_crud(client):
    task = make_task(client, "  Write docs  ")
    assert task["title"] == "Write docs"  # whitespace stripped
    assert task["status"] == "todo"
    assert task["suggested_priority_rank"] == 1

    r = client.patch(f"/tasks/{task['id']}", json={"status": "in_progress", "what_worked": "outline"})
    assert r.status_code == 200
    assert r.json()["status"] == "in_progress"
    assert r.json()["what_worked"] == "outline"
    assert r.json()["title"] == "Write docs"  # untouched by PATCH

    assert client.delete(f"/tasks/{task['id']}").status_code == 204
    assert client.get(f"/tasks/{task['id']}").status_code == 404


def test_fan_out_ranks_unlocking_tasks_higher(client):
    hub = make_task(client, "hub")
    leaf = make_task(client, "leaf")
    a, b = make_task(client, "a"), make_task(client, "b")

    link(client, hub, a, "next")
    link(client, hub, b, "next")

    assert ranks(client)["hub"] == 1
    assert ranks(client)["leaf"] > ranks(client)["hub"]


def test_blocked_tasks_rank_lowest(client):
    blocked = make_task(client, "blocked")
    blocker = make_task(client, "blocker")
    free = make_task(client, "free")

    link(client, blocked, blocker, "blocked_by")

    result = {t["title"]: t for t in client.get("/tasks").json()}
    assert result["blocked"]["is_blocked"] is True
    assert result["blocked"]["suggested_priority_rank"] == 3
    # The blocker gains fan-out because finishing it unlocks `blocked`.
    assert result["blocker"]["fan_out"] == 1
    assert result["blocker"]["suggested_priority_rank"] == 1
    assert result["free"]["is_blocked"] is False


def test_blockers_are_named_not_just_counted(client):
    blocked = make_task(client, "Deploy")
    first = make_task(client, "Write migration")
    second = make_task(client, "Get approval")
    link(client, blocked, first, "blocked_by")
    link(client, blocked, second, "blocked_by")

    result = {t["title"]: t for t in client.get("/tasks").json()}["Deploy"]
    assert {b["title"] for b in result["blockers"]} == {"Write migration", "Get approval"}
    assert all(b["status"] != "done" for b in result["blockers"])
    assert [b["id"] for b in result["blockers"]] == result["blocker_ids"]

    # Finishing one blocker leaves only the other named.
    client.patch(f"/tasks/{first['id']}", json={"status": "done"})
    result = {t["title"]: t for t in client.get("/tasks").json()}["Deploy"]
    assert [b["title"] for b in result["blockers"]] == ["Get approval"]
    assert result["is_blocked"] is True


def test_transitive_leverage_beats_direct_fan_out(client):
    # deep:  deep -> m1 -> m2 -> m3   (one direct, three total)
    # wide:  wide -> w1, w2           (two direct, two total)
    deep, wide = make_task(client, "deep"), make_task(client, "wide")
    m1, m2, m3 = (make_task(client, n) for n in ("m1", "m2", "m3"))
    link(client, deep, m1, "next")
    link(client, m1, m2, "next")
    link(client, m2, m3, "next")
    for name in ("w1", "w2"):
        link(client, wide, make_task(client, name), "next")

    result = {t["title"]: t for t in client.get("/tasks").json()}
    assert (result["deep"]["fan_out"], result["deep"]["unlocks_total"]) == (1, 3)
    assert (result["wide"]["fan_out"], result["wide"]["unlocks_total"]) == (2, 2)
    # Direct fan-out would rank `wide` first; transitive leverage knows better.
    assert result["deep"]["suggested_priority_rank"] < result["wide"]["suggested_priority_rank"]


def test_root_blockers_point_past_the_immediate_blocker(client):
    a, b, c = make_task(client, "a"), make_task(client, "b"), make_task(client, "c")
    link(client, a, b, "blocked_by")  # a waits on b
    link(client, b, c, "blocked_by")  # b waits on c

    result = {t["title"]: t for t in client.get("/tasks").json()}
    assert [x["title"] for x in result["a"]["blockers"]] == ["b"]
    # b is itself blocked, so the thing to actually start on is c.
    assert [x["title"] for x in result["a"]["root_blockers"]] == ["c"]
    # For b the root *is* the direct blocker, so it isn't repeated.
    assert result["b"]["root_blockers"] == []
    assert result["c"]["is_blocked"] is False


def test_circular_dependencies_are_rejected(client):
    a, b, c = make_task(client, "a"), make_task(client, "b"), make_task(client, "c")
    link(client, a, b, "blocked_by")
    link(client, b, c, "blocked_by")

    # Direct two-task loop.
    direct = client.post(
        "/edges", json={"source_task_id": b["id"], "target_task_id": a["id"], "edge_type": "blocked_by"}
    )
    assert direct.status_code == 409
    assert "circular" in direct.json()["detail"].lower()

    # Longer loop through the chain: c waiting on a would close a -> b -> c -> a.
    indirect = client.post(
        "/edges", json={"source_task_id": c["id"], "target_task_id": a["id"], "edge_type": "blocked_by"}
    )
    assert indirect.status_code == 409

    # `next` edges may legitimately loop, so they stay permitted.
    assert client.post(
        "/edges", json={"source_task_id": c["id"], "target_task_id": a["id"], "edge_type": "next"}
    ).status_code == 201


def test_existing_deadlocks_are_flagged_and_ranked_last(client):
    # Cycles can predate the guard, so the reader must still cope with them.
    a, b, healthy = make_task(client, "a"), make_task(client, "b"), make_task(client, "healthy")
    link(client, a, b, "blocked_by")

    from app.database import SessionLocal
    from app.models import Edge as EdgeModel, EdgeType

    with SessionLocal() as session:  # bypass the API guard to plant the cycle
        session.add(EdgeModel(source_task_id=b["id"], target_task_id=a["id"], edge_type=EdgeType.blocked_by))
        session.commit()

    result = {t["title"]: t for t in client.get("/tasks").json()}
    assert result["a"]["in_deadlock"] is True
    assert result["b"]["in_deadlock"] is True
    assert result["healthy"]["in_deadlock"] is False
    # Unactionable work sorts below everything that can actually be done.
    assert result["healthy"]["suggested_priority_rank"] < result["a"]["suggested_priority_rank"]
    # And neither can name a root blocker, because there isn't one.
    assert result["a"]["root_blockers"] == []


def test_restoring_a_deleted_task_keeps_its_id(client):
    task = make_task(client, "Oops", description="keep me")
    other = make_task(client, "neighbour")
    link(client, task, other, "next")

    client.delete(f"/tasks/{task['id']}")
    assert client.get("/edges").json() == []  # edges went with it

    # Undo re-creates the task under its original id, so links can be rebuilt.
    restored = client.post("/tasks", json={"id": task["id"], "title": "Oops", "description": "keep me"})
    assert restored.status_code == 201
    assert restored.json()["id"] == task["id"]
    assert restored.json()["description"] == "keep me"

    link(client, task, other, "next")
    assert len(client.get("/edges").json()) == 1

    # Reusing a live id is refused rather than silently overwriting.
    assert client.post("/tasks", json={"id": task["id"], "title": "clash"}).status_code == 409


def test_description_round_trips(client):
    task = make_task(client, "Research", description="Compare the three candidate approaches.")
    assert task["description"] == "Compare the three candidate approaches."

    updated = client.patch(f"/tasks/{task['id']}", json={"description": "Narrowed to two."}).json()
    assert updated["description"] == "Narrowed to two."
    assert updated["title"] == "Research"  # unrelated fields untouched

    # Defaults to empty rather than null, so the UI never renders "undefined".
    assert make_task(client, "No notes")["description"] == ""


def test_completing_a_blocker_unblocks_the_dependent(client):
    blocked = make_task(client, "blocked")
    blocker = make_task(client, "blocker")
    link(client, blocked, blocker, "blocked_by")

    client.patch(f"/tasks/{blocker['id']}", json={"status": "done"})

    result = {t["title"]: t for t in client.get("/tasks").json()}
    assert result["blocked"]["is_blocked"] is False
    assert result["blocked"]["suggested_priority_rank"] == 1
    assert result["blocker"]["suggested_priority_rank"] is None  # done tasks leave the ranking


def test_override_beats_computed_score(client):
    hub = make_task(client, "hub")
    for name in ("a", "b", "c"):
        link(client, hub, make_task(client, name), "next")
    pinned = make_task(client, "pinned")

    assert ranks(client)["hub"] == 1

    client.patch(f"/tasks/{pinned['id']}", json={"priority_override": 1})
    result = {t["title"]: t for t in client.get("/tasks").json()}
    assert result["pinned"]["suggested_priority_rank"] == 1
    assert result["pinned"]["is_pinned"] is True
    assert result["hub"]["suggested_priority_rank"] == 2

    # Explicit null clears the pin and hands the top slot back to fan-out.
    client.patch(f"/tasks/{pinned['id']}", json={"priority_override": None})
    assert ranks(client)["hub"] == 1


def test_edge_validation_and_cascade(client):
    a, b = make_task(client, "a"), make_task(client, "b")

    self_link = client.post(
        "/edges", json={"source_task_id": a["id"], "target_task_id": a["id"], "edge_type": "next"}
    )
    assert self_link.status_code == 400

    missing = client.post(
        "/edges", json={"source_task_id": a["id"], "target_task_id": "nope", "edge_type": "next"}
    )
    assert missing.status_code == 404

    edge = link(client, a, b, "next")
    duplicate = client.post(
        "/edges", json={"source_task_id": a["id"], "target_task_id": b["id"], "edge_type": "next"}
    )
    assert duplicate.status_code == 409

    # Deleting a task removes its edges too.
    client.delete(f"/tasks/{a['id']}")
    assert client.get("/edges").json() == []
    assert client.delete(f"/edges/{edge['id']}").status_code == 404


def test_positions_persist(client):
    task = make_task(client, "draggable")
    client.patch(f"/tasks/{task['id']}", json={"position_x": 120.5, "position_y": -40.25})
    stored = client.get(f"/tasks/{task['id']}").json()
    assert (stored["position_x"], stored["position_y"]) == (120.5, -40.25)


def test_a_batch_of_positions_saves_in_one_request(client):
    a, b = make_task(client, "a"), make_task(client, "b")
    r = client.post(
        "/tasks/positions",
        json={"positions": [
            {"id": a["id"], "position_x": 10.0, "position_y": 20.0},
            {"id": b["id"], "position_x": -5.5, "position_y": 0.0},
        ]},
    )
    assert r.status_code == 204, r.text

    stored = {t["title"]: (t["position_x"], t["position_y"]) for t in client.get("/tasks").json()}
    assert stored == {"a": (10.0, 20.0), "b": (-5.5, 0.0)}


def test_a_batch_with_an_unknown_task_moves_nothing(client):
    a = make_task(client, "a")
    r = client.post(
        "/tasks/positions",
        json={"positions": [
            {"id": a["id"], "position_x": 99.0, "position_y": 99.0},
            {"id": "does-not-exist", "position_x": 1.0, "position_y": 1.0},
        ]},
    )
    assert r.status_code == 404

    stored = client.get(f"/tasks/{a['id']}").json()
    assert (stored["position_x"], stored["position_y"]) == (0.0, 0.0)


def test_project_grouping_from_a_selection(client):
    a, b, loose = make_task(client, "a"), make_task(client, "b"), make_task(client, "loose")

    r = client.post("/projects", json={"name": "  Launch  ", "task_ids": [a["id"], b["id"]]})
    assert r.status_code == 201, r.text
    project = r.json()
    assert project["name"] == "Launch"
    assert project["task_count"] == 2
    assert project["color"]  # auto-assigned from the palette

    by_title = {t["title"]: t for t in client.get("/tasks").json()}
    assert by_title["a"]["project_id"] == project["id"]
    assert by_title["loose"]["project_id"] is None

    # Adding and removing members.
    assert client.post(f"/projects/{project['id']}/tasks", json={"task_ids": [loose["id"]]}).json()["task_count"] == 3
    assert client.delete(f"/projects/{project['id']}/tasks/{loose['id']}").json()["task_count"] == 2
    assert client.delete(f"/projects/{project['id']}/tasks/{loose['id']}").status_code == 404


def test_a_task_belongs_to_one_project_at_a_time(client):
    task = make_task(client, "movable")
    first = client.post("/projects", json={"name": "First", "task_ids": [task["id"]]}).json()
    second = client.post("/projects", json={"name": "Second", "task_ids": [task["id"]]}).json()

    assert client.get(f"/tasks/{task['id']}").json()["project_id"] == second["id"]
    assert next(p for p in client.get("/projects").json() if p["id"] == first["id"])["task_count"] == 0


def test_deleting_a_project_releases_its_tasks(client):
    task = make_task(client, "survivor")
    project = client.post("/projects", json={"name": "Doomed", "task_ids": [task["id"]]}).json()

    assert client.delete(f"/projects/{project['id']}").status_code == 204

    remaining = client.get(f"/tasks/{task['id']}")
    assert remaining.status_code == 200          # the task outlives the grouping
    assert remaining.json()["project_id"] is None
    assert client.get("/projects").json() == []


def test_project_assignment_validation(client):
    task = make_task(client, "a")
    assert client.patch(f"/tasks/{task['id']}", json={"project_id": "nope"}).status_code == 404
    assert client.post("/projects", json={"name": "X", "task_ids": ["nope"]}).status_code == 404
    assert client.post("/projects", json={"name": "   "}).status_code == 422

    project = client.post("/projects", json={"name": "Real"}).json()
    assert client.patch(f"/tasks/{task['id']}", json={"project_id": project["id"]}).json()["project_id"] == project["id"]
    # Explicit null pulls the task back out of the project.
    assert client.patch(f"/tasks/{task['id']}", json={"project_id": None}).json()["project_id"] is None


def test_renaming_a_project(client):
    project = client.post("/projects", json={"name": "Old", "color": "teal"}).json()
    updated = client.patch(f"/projects/{project['id']}", json={"name": "New"}).json()
    assert (updated["name"], updated["color"]) == ("New", "teal")


def test_disconnected_clusters_all_rank(client):
    for name in ("island_a", "island_b", "island_c"):
        make_task(client, name)
    assert sorted(ranks(client).values()) == [1, 2, 3]

"""Tests for the shared source library and its many-to-many attachment to tasks.

Run from ``backend/``:  pytest
"""

from app.database import UPLOAD_DIR


def make_task(client, title, **kwargs):
    r = client.post("/tasks", json={"title": title, **kwargs})
    assert r.status_code == 201, r.text
    return r.json()


def make_source(client, **kwargs):
    r = client.post("/sources", json=kwargs)
    assert r.status_code == 201, r.text
    return r.json()


def make_project(client, name, **kwargs):
    r = client.post("/projects", json={"name": name, **kwargs})
    assert r.status_code == 201, r.text
    return r.json()


def get_project(client, project_id):
    # There's no single-project GET endpoint — list-and-find matches the
    # existing project tests in test_api.py.
    return next(p for p in client.get("/projects").json() if p["id"] == project_id)


def test_create_link_note_and_local_path_sources(client):
    link = make_source(client, type="link", title="Docs", url="https://example.com")
    assert link["type"] == "link"
    assert link["url"] == "https://example.com"

    note = make_source(client, type="note", title="Reminder", content="don't forget the migration")
    assert note["content"] == "don't forget the migration"

    local = make_source(client, type="local_path", title="Spec", local_path="/home/me/spec.pdf")
    assert local["local_path"] == "/home/me/spec.pdf"


def test_type_specific_field_is_required(client):
    assert client.post("/sources", json={"type": "link", "title": "no url"}).status_code == 422
    assert client.post("/sources", json={"type": "note", "title": "no content"}).status_code == 422
    assert client.post("/sources", json={"type": "local_path", "title": "no path"}).status_code == 422


def test_file_sources_must_go_through_upload(client):
    r = client.post("/sources", json={"type": "file", "title": "nope"})
    assert r.status_code == 422


def test_patch_updates_fields_with_exclude_unset_semantics(client):
    source = make_source(client, type="note", title="Original", content="v1")
    r = client.patch(f"/sources/{source['id']}", json={"content": "v2"})
    assert r.status_code == 200
    assert r.json()["content"] == "v2"
    assert r.json()["title"] == "Original"  # untouched


def test_patch_rejects_unknown_field(client):
    source = make_source(client, type="note", title="Original", content="v1")
    assert client.patch(f"/sources/{source['id']}", json={"type": "link"}).status_code == 422


def test_delete_source(client):
    source = make_source(client, type="note", title="temp", content="x")
    assert client.delete(f"/sources/{source['id']}").status_code == 204
    assert client.get(f"/sources/{source['id']}").status_code == 404


def test_unknown_id_404s_on_get_patch_delete(client):
    assert client.get("/sources/nope").status_code == 404
    assert client.patch("/sources/nope", json={"title": "x"}).status_code == 404
    assert client.delete("/sources/nope").status_code == 404


def test_upload_creates_a_file_source(client):
    r = client.post(
        "/sources/upload",
        files={"file": ("notes.txt", b"hello world", "text/plain")},
    )
    assert r.status_code == 201, r.text
    source = r.json()
    assert source["type"] == "file"
    assert source["title"] == "notes.txt"
    assert source["file_name"] == "notes.txt"
    assert (UPLOAD_DIR / source["file_path"]).exists()


def test_upload_with_explicit_title(client):
    r = client.post(
        "/sources/upload",
        data={"title": "My doc"},
        files={"file": ("notes.txt", b"hello", "text/plain")},
    )
    assert r.json()["title"] == "My doc"


def test_upload_rejects_empty_file(client):
    r = client.post("/sources/upload", files={"file": ("empty.txt", b"", "text/plain")})
    assert r.status_code == 400


def test_upload_rejects_oversized_file(client, monkeypatch):
    # Lower the cap instead of allocating a real 20MB+ body, which is wasteful
    # and can hit sandbox memory limits during multipart encoding.
    from app.routers import sources as sources_router

    monkeypatch.setattr(sources_router, "MAX_UPLOAD_BYTES", 10)
    r = client.post("/sources/upload", files={"file": ("big.bin", b"x" * 11, "application/octet-stream")})
    assert r.status_code == 413


def test_uploaded_file_is_served_back(client):
    r = client.post("/sources/upload", files={"file": ("notes.txt", b"hello world", "text/plain")})
    source = r.json()
    served = client.get(f"/files/{source['file_path']}")
    assert served.status_code == 200
    assert served.content == b"hello world"


def test_deleting_a_file_source_removes_it_from_disk(client):
    r = client.post("/sources/upload", files={"file": ("notes.txt", b"hello", "text/plain")})
    source = r.json()
    on_disk = UPLOAD_DIR / source["file_path"]
    assert on_disk.exists()

    assert client.delete(f"/sources/{source['id']}").status_code == 204
    assert not on_disk.exists()


def test_deleting_a_file_source_already_missing_from_disk_does_not_crash(client):
    r = client.post("/sources/upload", files={"file": ("notes.txt", b"hello", "text/plain")})
    source = r.json()
    (UPLOAD_DIR / source["file_path"]).unlink()

    assert client.delete(f"/sources/{source['id']}").status_code == 204


def test_search_matches_across_fields(client):
    make_source(client, type="link", title="React docs", url="https://react.dev")
    make_source(client, type="note", title="Migration plan", content="use alembic-like steps")
    make_source(client, type="local_path", title="Contract", local_path="/docs/contract.pdf")

    assert {s["title"] for s in client.get("/sources?q=react").json()} == {"React docs"}
    assert {s["title"] for s in client.get("/sources?q=alembic").json()} == {"Migration plan"}
    assert {s["title"] for s in client.get("/sources?q=contract").json()} == {"Contract"}


def test_search_by_type_filter(client):
    make_source(client, type="link", title="A", url="https://a.example")
    make_source(client, type="note", title="B", content="x")

    assert [s["type"] for s in client.get("/sources?type=link").json()] == ["link"]


def test_search_with_no_sources_returns_empty(client):
    assert client.get("/sources?q=anything").json() == []


def test_attach_one_source_to_two_tasks(client):
    a, b = make_task(client, "a"), make_task(client, "b")
    source = make_source(client, type="note", title="shared", content="x")

    client.post(f"/tasks/{a['id']}/sources", json={"source_ids": [source["id"]]})
    client.post(f"/tasks/{b['id']}/sources", json={"source_ids": [source["id"]]})

    assert client.get(f"/sources/{source['id']}").json()["task_count"] == 2
    assert client.get(f"/tasks/{a['id']}").json()["source_count"] == 1
    assert client.get(f"/tasks/{b['id']}").json()["source_count"] == 1


def test_attaching_the_same_source_twice_is_idempotent(client):
    task = make_task(client, "a")
    source = make_source(client, type="note", title="x", content="x")

    client.post(f"/tasks/{task['id']}/sources", json={"source_ids": [source["id"]]})
    r = client.post(f"/tasks/{task['id']}/sources", json={"source_ids": [source["id"]]})
    assert r.status_code == 200

    attached = client.get(f"/tasks/{task['id']}/sources").json()
    assert len(attached) == 1


def test_attach_with_unknown_task_or_source_404s(client):
    task = make_task(client, "a")
    source = make_source(client, type="note", title="x", content="x")

    assert client.post("/tasks/nope/sources", json={"source_ids": [source["id"]]}).status_code == 404

    r = client.post(f"/tasks/{task['id']}/sources", json={"source_ids": [source["id"], "nope"]})
    assert r.status_code == 404
    # No partial attach: the valid id from the same request was not linked either.
    assert client.get(f"/tasks/{task['id']}/sources").json() == []


def test_detach_unknown_link_404s(client):
    task = make_task(client, "a")
    source = make_source(client, type="note", title="x", content="x")
    assert client.delete(f"/tasks/{task['id']}/sources/{source['id']}").status_code == 404


def test_deleting_a_source_detaches_it_from_all_tasks(client):
    a, b = make_task(client, "a"), make_task(client, "b")
    source = make_source(client, type="note", title="shared", content="x")
    client.post(f"/tasks/{a['id']}/sources", json={"source_ids": [source["id"]]})
    client.post(f"/tasks/{b['id']}/sources", json={"source_ids": [source["id"]]})

    assert client.delete(f"/sources/{source['id']}").status_code == 204

    assert client.get(f"/tasks/{a['id']}").json()["source_count"] == 0
    assert client.get(f"/tasks/{b['id']}").json()["source_count"] == 0


def test_deleting_a_task_detaches_but_keeps_the_source_in_the_library(client):
    task = make_task(client, "a")
    source = make_source(client, type="note", title="survives", content="x")
    client.post(f"/tasks/{task['id']}/sources", json={"source_ids": [source["id"]]})

    assert client.delete(f"/tasks/{task['id']}").status_code == 204

    assert client.get(f"/sources/{source['id']}").status_code == 200
    assert client.get(f"/sources/{source['id']}").json()["task_count"] == 0
    assert client.get("/sources").json()  # still present in the library


def test_task_without_sources_has_zero_count(client):
    task = make_task(client, "a")
    assert client.get(f"/tasks/{task['id']}").json()["source_count"] == 0


def test_source_ids_can_be_attached_at_creation(client):
    task = make_task(client, "a")
    source = make_source(client, type="link", title="x", url="https://x.example", task_ids=[task["id"]])
    assert source["task_count"] == 1
    assert client.get(f"/tasks/{task['id']}").json()["source_count"] == 1


# --------------------------------------------------------------------------
# Project-attached sources — independent of any task attachment.


def test_attach_source_to_a_project(client):
    project = make_project(client, "Launch")
    source = make_source(client, type="link", title="Brand guide", url="https://example.com/brand")

    r = client.post(f"/projects/{project['id']}/sources", json={"source_ids": [source["id"]]})
    assert r.status_code == 200, r.text
    assert r.json()["source_count"] == 1

    attached = client.get(f"/projects/{project['id']}/sources").json()
    assert [s["title"] for s in attached] == ["Brand guide"]


def test_project_and_task_attachments_are_independent(client):
    project = make_project(client, "Launch")
    task = make_task(client, "a")
    source = make_source(client, type="note", title="shared", content="x")

    client.post(f"/projects/{project['id']}/sources", json={"source_ids": [source["id"]]})
    client.post(f"/tasks/{task['id']}/sources", json={"source_ids": [source["id"]]})

    assert client.get(f"/sources/{source['id']}").json()["task_count"] == 1

    # Detaching from the task leaves the project attachment untouched.
    client.delete(f"/tasks/{task['id']}/sources/{source['id']}")
    assert get_project(client, project['id'])["source_count"] == 1
    assert client.get(f"/tasks/{task['id']}").json()["source_count"] == 0


def test_attaching_the_same_source_to_a_project_twice_is_idempotent(client):
    project = make_project(client, "Launch")
    source = make_source(client, type="note", title="x", content="x")

    client.post(f"/projects/{project['id']}/sources", json={"source_ids": [source["id"]]})
    r = client.post(f"/projects/{project['id']}/sources", json={"source_ids": [source["id"]]})
    assert r.status_code == 200

    assert len(client.get(f"/projects/{project['id']}/sources").json()) == 1


def test_attach_to_project_with_unknown_project_or_source_404s(client):
    project = make_project(client, "Launch")
    source = make_source(client, type="note", title="x", content="x")

    assert client.post("/projects/nope/sources", json={"source_ids": [source["id"]]}).status_code == 404

    r = client.post(f"/projects/{project['id']}/sources", json={"source_ids": [source["id"], "nope"]})
    assert r.status_code == 404
    assert client.get(f"/projects/{project['id']}/sources").json() == []


def test_detach_unknown_project_source_link_404s(client):
    project = make_project(client, "Launch")
    source = make_source(client, type="note", title="x", content="x")
    assert client.delete(f"/projects/{project['id']}/sources/{source['id']}").status_code == 404


def test_deleting_a_source_detaches_it_from_projects_too(client):
    project = make_project(client, "Launch")
    source = make_source(client, type="note", title="x", content="x")
    client.post(f"/projects/{project['id']}/sources", json={"source_ids": [source["id"]]})

    assert client.delete(f"/sources/{source['id']}").status_code == 204
    assert get_project(client, project['id'])["source_count"] == 0


def test_deleting_a_project_detaches_but_keeps_the_source_in_the_library(client):
    project = make_project(client, "Launch")
    source = make_source(client, type="note", title="survives", content="x")
    client.post(f"/projects/{project['id']}/sources", json={"source_ids": [source["id"]]})

    assert client.delete(f"/projects/{project['id']}").status_code == 204

    assert client.get(f"/sources/{source['id']}").status_code == 200
    assert client.get(f"/sources/{source['id']}").json()["task_count"] == 0


def test_source_ids_and_project_ids_can_both_be_attached_at_creation(client):
    task = make_task(client, "a")
    project = make_project(client, "Launch")
    source = make_source(
        client,
        type="link",
        title="x",
        url="https://x.example",
        task_ids=[task["id"]],
        project_ids=[project["id"]],
    )
    assert source["task_count"] == 1
    assert get_project(client, project['id'])["source_count"] == 1


def test_upload_can_attach_to_a_project(client):
    project = make_project(client, "Launch")
    r = client.post(
        "/sources/upload",
        data={"project_ids": project["id"]},
        files={"file": ("notes.txt", b"hello", "text/plain")},
    )
    assert r.status_code == 201, r.text
    assert get_project(client, project['id'])["source_count"] == 1

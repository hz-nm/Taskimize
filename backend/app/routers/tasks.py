"""Task CRUD endpoints."""

from dataclasses import dataclass

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Edge, Project, Source, Task, TaskSource
from ..priority import compute_priorities
from ..routers.sources import _serialize as _serialize_source
from ..routers.sources import _task_ids_by_source
from ..schemas import BlockerRef, SourceRead, TaskCreate, TaskPositions, TaskRead, TaskSourceLinks, TaskUpdate

router = APIRouter(prefix="/tasks", tags=["tasks"])


def _serialize(task: Task, graph: "Graph") -> TaskRead:
    info = graph.priorities[task.id]

    def refs(ids) -> list[BlockerRef]:
        return [
            BlockerRef(id=t.id, title=t.title, status=t.status)
            for t in (graph.by_id.get(i) for i in ids)
            if t is not None
        ]

    blockers = refs(info.blocker_ids)
    # Only worth showing when they differ from the direct blockers — otherwise
    # the panel would just repeat itself.
    direct = set(info.blocker_ids)
    root = refs([i for i in info.root_blocker_ids if i not in direct])
    return TaskRead(
        **{c: getattr(task, c) for c in (
            "id", "title", "status", "description", "what_i_did", "what_worked", "what_didnt",
            "priority_override", "position_x", "position_y", "project_id",
            "created_at", "updated_at",
        )},
        suggested_priority_rank=info.rank,
        fan_out=info.fan_out,
        unlocks_total=info.unlocks_total,
        is_blocked=info.is_blocked,
        is_pinned=info.is_pinned,
        blocker_ids=list(info.blocker_ids),
        blockers=blockers,
        root_blockers=root,
        in_deadlock=info.in_deadlock,
        source_count=graph.source_counts.get(task.id, 0),
    )


@dataclass(frozen=True)
class Graph:
    """One snapshot of the whole board — every response is derived from this."""

    tasks: list[Task]
    priorities: dict
    by_id: dict[str, Task]
    source_counts: dict[str, int]


def _graph(db: Session) -> Graph:
    tasks = list(db.scalars(select(Task)))
    edges = list(db.scalars(select(Edge)))
    source_counts: dict[str, int] = {}
    for task_id in db.scalars(select(TaskSource.task_id)):
        source_counts[task_id] = source_counts.get(task_id, 0) + 1
    return Graph(tasks, compute_priorities(tasks, edges), {t.id: t for t in tasks}, source_counts)


@router.get("", response_model=list[TaskRead])
def list_tasks(db: Session = Depends(get_db)) -> list[TaskRead]:
    """All tasks, each carrying its freshly computed `suggested_priority_rank`."""
    graph = _graph(db)
    serialized = [_serialize(t, graph) for t in graph.tasks]
    # Ranked tasks first (ascending), then done/unranked tasks by recency.
    serialized.sort(key=lambda t: (t.suggested_priority_rank is None, t.suggested_priority_rank or 0, t.created_at))
    return serialized


def _check_project(project_id: str | None, db: Session) -> None:
    if project_id is not None and db.get(Project, project_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Project {project_id} not found")


@router.post("", response_model=TaskRead, status_code=status.HTTP_201_CREATED)
def create_task(payload: TaskCreate, db: Session = Depends(get_db)) -> TaskRead:
    _check_project(payload.project_id, db)

    fields = payload.model_dump()
    requested_id = fields.pop("id", None)
    if requested_id:
        if db.get(Task, requested_id) is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "A task with that id already exists")
        fields["id"] = requested_id

    task = Task(**fields)
    db.add(task)
    db.commit()
    db.refresh(task)
    return _serialize(task, _graph(db))


# Declared ahead of the `/{task_id}` routes so the literal path always wins.
@router.post("/positions", status_code=status.HTTP_204_NO_CONTENT)
def save_positions(payload: TaskPositions, db: Session = Depends(get_db)) -> Response:
    """Move a batch of tasks in one round trip.

    Positions are pure layout — they feed nothing in the priority computation —
    so this returns no body and the client keeps the coordinates it already has.
    """
    wanted = {p.id: p for p in payload.positions}
    found = {t.id: t for t in db.scalars(select(Task).where(Task.id.in_(wanted)))}

    missing = [task_id for task_id in wanted if task_id not in found]
    if missing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown task ids: {', '.join(missing)}")

    for task_id, position in wanted.items():
        found[task_id].position_x = position.position_x
        found[task_id].position_y = position.position_y

    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{task_id}", response_model=TaskRead)
def get_task(task_id: str, db: Session = Depends(get_db)) -> TaskRead:
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    return _serialize(task, _graph(db))


@router.patch("/{task_id}", response_model=TaskRead)
def update_task(task_id: str, payload: TaskUpdate, db: Session = Depends(get_db)) -> TaskRead:
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")

    changes = payload.model_dump(exclude_unset=True)
    if "project_id" in changes:
        _check_project(changes["project_id"], db)

    # exclude_unset keeps PATCH honest: an omitted field is untouched, while an
    # explicit `"priority_override": null` clears the manual pin.
    for field, value in changes.items():
        setattr(task, field, value)

    db.commit()
    db.refresh(task)
    return _serialize(task, _graph(db))


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: str, db: Session = Depends(get_db)) -> Response:
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    db.delete(task)  # attached edges and source links cascade away
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _load_sources(source_ids: list[str], db: Session) -> None:
    for source_id in source_ids:
        if db.get(Source, source_id) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Source {source_id} not found")


@router.get("/{task_id}/sources", response_model=list[SourceRead])
def list_task_sources(task_id: str, db: Session = Depends(get_db)) -> list[SourceRead]:
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")

    links = list(
        db.scalars(select(TaskSource).where(TaskSource.task_id == task_id).order_by(TaskSource.created_at))
    )
    by_source = _task_ids_by_source(db, [link.source_id for link in links])
    return [_serialize_source(link.source, by_source.get(link.source_id, [])) for link in links]


@router.post("/{task_id}/sources", response_model=TaskRead)
def attach_sources(task_id: str, payload: TaskSourceLinks, db: Session = Depends(get_db)) -> TaskRead:
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    _load_sources(payload.source_ids, db)

    existing = set(
        db.scalars(
            select(TaskSource.source_id).where(
                TaskSource.task_id == task_id, TaskSource.source_id.in_(payload.source_ids)
            )
        )
    )
    for source_id in payload.source_ids:
        if source_id not in existing:
            db.add(TaskSource(task_id=task_id, source_id=source_id))

    db.commit()
    return _serialize(task, _graph(db))


@router.delete("/{task_id}/sources/{source_id}", response_model=TaskRead)
def detach_source(task_id: str, source_id: str, db: Session = Depends(get_db)) -> TaskRead:
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")

    link = db.get(TaskSource, {"task_id": task_id, "source_id": source_id})
    if link is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That source is not attached to this task")

    db.delete(link)
    db.commit()
    return _serialize(task, _graph(db))

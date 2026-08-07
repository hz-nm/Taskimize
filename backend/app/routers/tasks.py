"""Task CRUD endpoints."""

from dataclasses import dataclass

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Edge, Project, Task
from ..priority import compute_priorities
from ..schemas import BlockerRef, TaskCreate, TaskRead, TaskUpdate

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
    )


@dataclass(frozen=True)
class Graph:
    """One snapshot of the whole board — every response is derived from this."""

    tasks: list[Task]
    priorities: dict
    by_id: dict[str, Task]


def _graph(db: Session) -> Graph:
    tasks = list(db.scalars(select(Task)))
    edges = list(db.scalars(select(Edge)))
    return Graph(tasks, compute_priorities(tasks, edges), {t.id: t for t in tasks})


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
    db.delete(task)  # attached edges cascade away
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

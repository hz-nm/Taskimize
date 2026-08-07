"""Project endpoints — named groupings created by box-selecting nodes on the canvas."""

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Project, Task
from ..schemas import PROJECT_COLORS, ProjectCreate, ProjectMembers, ProjectRead, ProjectUpdate

router = APIRouter(prefix="/projects", tags=["projects"])


def _serialize(project: Project, db: Session) -> ProjectRead:
    count = len(db.scalars(select(Task.id).where(Task.project_id == project.id)).all())
    return ProjectRead(
        id=project.id,
        name=project.name,
        color=project.color,
        created_at=project.created_at,
        updated_at=project.updated_at,
        task_count=count,
    )


def _next_color(db: Session) -> str:
    """Cycle the palette so consecutive projects are visually distinct."""
    used = len(db.scalars(select(Project.id)).all())
    return PROJECT_COLORS[used % len(PROJECT_COLORS)]


def _load_tasks(task_ids: list[str], db: Session) -> list[Task]:
    tasks = []
    for task_id in task_ids:
        task = db.get(Task, task_id)
        if task is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Task {task_id} not found")
        tasks.append(task)
    return tasks


@router.get("", response_model=list[ProjectRead])
def list_projects(db: Session = Depends(get_db)) -> list[ProjectRead]:
    projects = db.scalars(select(Project).order_by(Project.created_at)).all()
    return [_serialize(p, db) for p in projects]


@router.post("", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
def create_project(payload: ProjectCreate, db: Session = Depends(get_db)) -> ProjectRead:
    tasks = _load_tasks(payload.task_ids, db)

    project = Project(name=payload.name, color=payload.color or _next_color(db))
    db.add(project)
    db.flush()  # assign the id before reassigning members

    # A task belongs to at most one project, so this moves rather than copies.
    for task in tasks:
        task.project_id = project.id

    db.commit()
    db.refresh(project)
    return _serialize(project, db)


@router.patch("/{project_id}", response_model=ProjectRead)
def update_project(project_id: str, payload: ProjectUpdate, db: Session = Depends(get_db)) -> ProjectRead:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(project, field, value)

    db.commit()
    db.refresh(project)
    return _serialize(project, db)


@router.post("/{project_id}/tasks", response_model=ProjectRead)
def add_tasks(project_id: str, payload: ProjectMembers, db: Session = Depends(get_db)) -> ProjectRead:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")

    for task in _load_tasks(payload.task_ids, db):
        task.project_id = project.id

    db.commit()
    return _serialize(project, db)


@router.delete("/{project_id}/tasks/{task_id}", response_model=ProjectRead)
def remove_task(project_id: str, task_id: str, db: Session = Depends(get_db)) -> ProjectRead:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")

    task = db.get(Task, task_id)
    if task is None or task.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That task is not in this project")

    task.project_id = None
    db.commit()
    return _serialize(project, db)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: str, db: Session = Depends(get_db)) -> Response:
    """Deletes the grouping only — its tasks are released, never destroyed."""
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")

    for task in db.scalars(select(Task).where(Task.project_id == project_id)):
        task.project_id = None

    db.delete(project)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

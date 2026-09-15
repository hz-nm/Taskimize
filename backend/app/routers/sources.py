"""Source library endpoints — a shared pool of reference material (links, notes,
file uploads, local file paths) that tasks attach to via `TaskSource`, and that
projects independently attach to via `ProjectSource`.

Attach/detach live on the `tasks` and `projects` routers instead
(`/tasks/{id}/sources`, `/projects/{id}/sources`), since that's how the UI
reaches them — a task's or project's panel manages its own attachments.
"""

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import UPLOAD_DIR, get_db
from ..models import Project, ProjectSource, Source, SourceType, Task, TaskSource
from ..schemas import SourceCreate, SourceRead, SourceUpdate

router = APIRouter(prefix="/sources", tags=["sources"])

MAX_UPLOAD_BYTES = 20 * 1024 * 1024


def _task_ids_by_source(db: Session, source_ids: list[str]) -> dict[str, list[str]]:
    if not source_ids:
        return {}
    rows = db.execute(
        select(TaskSource.source_id, TaskSource.task_id).where(TaskSource.source_id.in_(source_ids))
    ).all()
    by_source: dict[str, list[str]] = {sid: [] for sid in source_ids}
    for source_id, task_id in rows:
        by_source[source_id].append(task_id)
    return by_source


def _serialize(source: Source, task_ids: list[str]) -> SourceRead:
    return SourceRead(
        id=source.id,
        type=source.type,
        title=source.title,
        url=source.url,
        content=source.content,
        file_path=source.file_path,
        file_name=source.file_name,
        file_size=source.file_size,
        local_path=source.local_path,
        created_at=source.created_at,
        updated_at=source.updated_at,
        task_count=len(task_ids),
        task_ids=task_ids,
    )


def _attach(db: Session, source_id: str, task_ids: list[str]) -> None:
    """Idempotent bulk attach — re-attaching an already-linked task is a no-op."""
    for task_id in task_ids:
        if db.get(Task, task_id) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Task {task_id} not found")

    existing = set(
        db.scalars(
            select(TaskSource.task_id).where(TaskSource.source_id == source_id, TaskSource.task_id.in_(task_ids))
        )
    )
    for task_id in task_ids:
        if task_id not in existing:
            db.add(TaskSource(task_id=task_id, source_id=source_id))


def _attach_projects(db: Session, source_id: str, project_ids: list[str]) -> None:
    """Idempotent bulk attach to projects — the same shape as `_attach` above,
    for a separate join table since a source's task and project attachments
    are independent of each other."""
    for project_id in project_ids:
        if db.get(Project, project_id) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Project {project_id} not found")

    existing = set(
        db.scalars(
            select(ProjectSource.project_id).where(
                ProjectSource.source_id == source_id, ProjectSource.project_id.in_(project_ids)
            )
        )
    )
    for project_id in project_ids:
        if project_id not in existing:
            db.add(ProjectSource(project_id=project_id, source_id=source_id))


@router.get("", response_model=list[SourceRead])
def list_sources(q: str | None = None, type: SourceType | None = None, db: Session = Depends(get_db)) -> list[SourceRead]:
    stmt = select(Source).order_by(Source.updated_at.desc())
    if type is not None:
        stmt = stmt.where(Source.type == type)
    sources = list(db.scalars(stmt))

    if q:
        needle = q.strip().lower()
        if needle:
            def matches(s: Source) -> bool:
                fields = (s.title, s.url, s.content, s.local_path, s.file_name)
                return any(f and needle in f.lower() for f in fields)

            sources = [s for s in sources if matches(s)]

    by_source = _task_ids_by_source(db, [s.id for s in sources])
    return [_serialize(s, by_source.get(s.id, [])) for s in sources]


@router.post("", response_model=SourceRead, status_code=status.HTTP_201_CREATED)
def create_source(payload: SourceCreate, db: Session = Depends(get_db)) -> SourceRead:
    source = Source(
        type=payload.type,
        title=payload.title,
        url=payload.url,
        content=payload.content,
        local_path=payload.local_path,
    )
    db.add(source)
    db.flush()  # assign the id before attaching

    _attach(db, source.id, payload.task_ids)
    _attach_projects(db, source.id, payload.project_ids)

    db.commit()
    db.refresh(source)
    return _serialize(source, list(payload.task_ids))


@router.post("/upload", response_model=SourceRead, status_code=status.HTTP_201_CREATED)
async def upload_source(
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
    task_ids: str = Form(default=""),
    project_ids: str = Form(default=""),
    db: Session = Depends(get_db),
) -> SourceRead:
    body = await file.read(MAX_UPLOAD_BYTES + 1)
    if not body:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Uploaded file is empty")
    if len(body) > MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "File exceeds the 20MB upload limit")

    original_name = file.filename or "upload"
    on_disk_name = f"{uuid.uuid4().hex}{Path(original_name).suffix}"
    (UPLOAD_DIR / on_disk_name).write_bytes(body)

    ids = [t.strip() for t in task_ids.split(",") if t.strip()]
    proj_ids = [p.strip() for p in project_ids.split(",") if p.strip()]

    source = Source(
        type=SourceType.file,
        title=(title or original_name).strip() or original_name,
        file_path=on_disk_name,
        file_name=original_name,
        file_size=len(body),
    )
    db.add(source)
    db.flush()

    try:
        _attach(db, source.id, ids)
        _attach_projects(db, source.id, proj_ids)
    except HTTPException:
        (UPLOAD_DIR / on_disk_name).unlink(missing_ok=True)
        db.rollback()
        raise

    db.commit()
    db.refresh(source)
    return _serialize(source, ids)


@router.get("/{source_id}", response_model=SourceRead)
def get_source(source_id: str, db: Session = Depends(get_db)) -> SourceRead:
    source = db.get(Source, source_id)
    if source is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source not found")
    task_ids = _task_ids_by_source(db, [source_id]).get(source_id, [])
    return _serialize(source, task_ids)


@router.patch("/{source_id}", response_model=SourceRead)
def update_source(source_id: str, payload: SourceUpdate, db: Session = Depends(get_db)) -> SourceRead:
    source = db.get(Source, source_id)
    if source is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(source, field, value)

    db.commit()
    db.refresh(source)
    task_ids = _task_ids_by_source(db, [source_id]).get(source_id, [])
    return _serialize(source, task_ids)


@router.delete("/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_source(source_id: str, db: Session = Depends(get_db)) -> Response:
    source = db.get(Source, source_id)
    if source is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source not found")

    if source.type == SourceType.file and source.file_path:
        (UPLOAD_DIR / source.file_path).unlink(missing_ok=True)

    db.delete(source)  # TaskSource rows cascade
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

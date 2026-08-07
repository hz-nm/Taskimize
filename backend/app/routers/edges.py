"""Edge (link) endpoints."""

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Edge, EdgeType, Task
from ..priority import build_blocker_map
from ..schemas import EdgeCreate, EdgeRead

router = APIRouter(prefix="/edges", tags=["edges"])


@router.get("", response_model=list[EdgeRead])
def list_edges(db: Session = Depends(get_db)) -> list[Edge]:
    return list(db.scalars(select(Edge).order_by(Edge.created_at)))


def _would_deadlock(source_id: str, target_id: str, db: Session) -> bool:
    """Would ``source blocked_by target`` close a dependency loop?

    Only if ``target`` already depends on ``source``, directly or through a chain.
    Rejecting up front is much kinder than letting the board reach a state where
    two tasks each wait on the other and neither can ever be started.
    """
    tasks = list(db.scalars(select(Task)))
    blockers = build_blocker_map(tasks, list(db.scalars(select(Edge))))

    stack, seen = [target_id], set()
    while stack:
        node = stack.pop()
        if node == source_id:
            return True
        if node in seen:
            continue
        seen.add(node)
        stack.extend(blockers.get(node, ()))
    return False


@router.post("", response_model=EdgeRead, status_code=status.HTTP_201_CREATED)
def create_edge(payload: EdgeCreate, db: Session = Depends(get_db)) -> Edge:
    if payload.source_task_id == payload.target_task_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A task cannot link to itself")

    for task_id in (payload.source_task_id, payload.target_task_id):
        if db.get(Task, task_id) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Task {task_id} not found")

    if payload.edge_type == EdgeType.blocked_by and _would_deadlock(
        payload.source_task_id, payload.target_task_id, db
    ):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "That link would create a circular dependency — the two tasks would block each other forever",
        )

    edge = Edge(**payload.model_dump())
    db.add(edge)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "That link already exists")
    db.refresh(edge)
    return edge


@router.delete("/{edge_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_edge(edge_id: str, db: Session = Depends(get_db)) -> Response:
    edge = db.get(Edge, edge_id)
    if edge is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Edge not found")
    db.delete(edge)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

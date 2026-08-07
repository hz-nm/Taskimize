"""SQLAlchemy ORM models: Task nodes and the Edge links between them."""

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import CheckConstraint, DateTime, Enum, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class TaskStatus(str, enum.Enum):
    todo = "todo"
    in_progress = "in_progress"
    done = "done"


class EdgeType(str, enum.Enum):
    next = "next"
    blocked_by = "blocked_by"


class Project(Base):
    """A named grouping of tasks, drawn as a hull behind its members on the canvas.

    Membership is a plain nullable FK on Task, so a task belongs to at most one
    project and deleting a project releases its tasks rather than destroying them.
    """

    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    color: Mapped[str] = mapped_column(String(20), nullable=False, default="indigo")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now, onupdate=_now)

    tasks: Mapped[list["Task"]] = relationship(back_populates="project")


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    status: Mapped[TaskStatus] = mapped_column(
        Enum(TaskStatus, native_enum=False, length=20), nullable=False, default=TaskStatus.todo
    )

    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    what_i_did: Mapped[str] = mapped_column(Text, nullable=False, default="")
    what_worked: Mapped[str] = mapped_column(Text, nullable=False, default="")
    what_didnt: Mapped[str] = mapped_column(Text, nullable=False, default="")

    # When set, this manual pin wins over the computed priority score.
    priority_override: Mapped[int | None] = mapped_column(Integer, nullable=True)

    position_x: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    position_y: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    project_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now, onupdate=_now)

    project: Mapped["Project | None"] = relationship(back_populates="tasks")

    outgoing_edges: Mapped[list["Edge"]] = relationship(
        back_populates="source",
        foreign_keys="Edge.source_task_id",
        cascade="all, delete-orphan",
    )
    incoming_edges: Mapped[list["Edge"]] = relationship(
        back_populates="target",
        foreign_keys="Edge.target_task_id",
        cascade="all, delete-orphan",
    )

    __table_args__ = (CheckConstraint("priority_override IS NULL OR priority_override >= 1", name="ck_override_positive"),)


class Edge(Base):
    __tablename__ = "edges"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    source_task_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    target_task_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    edge_type: Mapped[EdgeType] = mapped_column(Enum(EdgeType, native_enum=False, length=20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now)

    source: Mapped["Task"] = relationship(back_populates="outgoing_edges", foreign_keys=[source_task_id])
    target: Mapped["Task"] = relationship(back_populates="incoming_edges", foreign_keys=[target_task_id])

    __table_args__ = (
        UniqueConstraint("source_task_id", "target_task_id", "edge_type", name="uq_edge_triplet"),
        CheckConstraint("source_task_id != target_task_id", name="ck_no_self_link"),
    )

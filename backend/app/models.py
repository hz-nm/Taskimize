"""SQLAlchemy ORM models: Task nodes and the Edge links between them."""

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, CheckConstraint, DateTime, Enum, Float, ForeignKey, Integer, String, Text, UniqueConstraint
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


class SourceType(str, enum.Enum):
    link = "link"
    note = "note"
    file = "file"
    local_path = "local_path"


class Project(Base):
    """A named grouping of tasks, drawn as a hull behind its members on the canvas.

    Membership is a plain nullable FK on Task, so a task belongs to at most one
    project and deleting a project releases its tasks rather than destroying them.
    """

    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    color: Mapped[str] = mapped_column(String(20), nullable=False, default="indigo")
    # A pure visibility flag — hides the project and its tasks from the board
    # and sidebar without touching any task's status. Nothing else reacts to it
    # server-side; the frontend does all the filtering.
    hidden: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now, onupdate=_now)

    tasks: Mapped[list["Task"]] = relationship(back_populates="project")
    source_links: Mapped[list["ProjectSource"]] = relationship(back_populates="project", cascade="all, delete-orphan")


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
    source_links: Mapped[list["TaskSource"]] = relationship(back_populates="task", cascade="all, delete-orphan")

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


class Source(Base):
    """A reusable piece of reference material — a link, note, upload, or local
    file path — that can be attached to any number of tasks via `TaskSource`,
    and independently to any number of projects via `ProjectSource`.

    Deleting a Source detaches it from every task and project it's attached to
    (those join rows cascade), but neither a Task nor a Project being deleted
    ever deletes a Source — the library is shared and outlives any one owner.
    """

    __tablename__ = "sources"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    type: Mapped[SourceType] = mapped_column(Enum(SourceType, native_enum=False, length=20), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)

    # Only the field matching `type` is populated. Kept as plain nullable columns
    # (rather than subtables) since search needs to scan across all of them at once.
    url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    file_name: Mapped[str | None] = mapped_column(String(300), nullable=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    local_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now, onupdate=_now)

    task_links: Mapped[list["TaskSource"]] = relationship(back_populates="source", cascade="all, delete-orphan")
    project_links: Mapped[list["ProjectSource"]] = relationship(back_populates="source", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint(
            "(type != 'link' OR url IS NOT NULL) AND "
            "(type != 'note' OR content IS NOT NULL) AND "
            "(type != 'file' OR file_path IS NOT NULL) AND "
            "(type != 'local_path' OR local_path IS NOT NULL)",
            name="ck_source_type_fields",
        ),
    )


class TaskSource(Base):
    """Many-to-many join between tasks and the shared source library."""

    __tablename__ = "task_sources"

    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True)
    source_id: Mapped[str] = mapped_column(String(36), ForeignKey("sources.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now)

    task: Mapped["Task"] = relationship(back_populates="source_links")
    source: Mapped["Source"] = relationship(back_populates="task_links")


class ProjectSource(Base):
    """Many-to-many join between projects and the shared source library —
    project-wide reference material, independent of any one task inside it."""

    __tablename__ = "project_sources"

    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    source_id: Mapped[str] = mapped_column(String(36), ForeignKey("sources.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now)

    project: Mapped["Project"] = relationship(back_populates="source_links")
    source: Mapped["Source"] = relationship(back_populates="project_links")

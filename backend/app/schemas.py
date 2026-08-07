"""Pydantic request/response schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .models import EdgeType, TaskStatus


PROJECT_COLORS = ("indigo", "teal", "amber", "rose", "violet", "lime")


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    color: str | None = None
    # Task ids to move into the new project in the same request.
    task_ids: list[str] = []

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name must not be blank")
        return v


class ProjectUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=200)
    color: str | None = None


class ProjectMembers(BaseModel):
    task_ids: list[str]


class ProjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    color: str
    created_at: datetime
    updated_at: datetime
    task_count: int = 0


class BlockerRef(BaseModel):
    """Enough about an unfinished blocker to name it in the UI without a second fetch."""

    id: str
    title: str
    status: TaskStatus


class TaskCreate(BaseModel):
    # Normally server-assigned. Supplying one lets "undo delete" put a task back
    # with its original id, so its edges can be restored exactly as they were.
    id: str | None = Field(default=None, max_length=36)
    title: str = Field(min_length=1, max_length=500)
    status: TaskStatus = TaskStatus.todo
    description: str = ""
    what_i_did: str = ""
    what_worked: str = ""
    what_didnt: str = ""
    priority_override: int | None = Field(default=None, ge=1)
    position_x: float = 0.0
    position_y: float = 0.0
    project_id: str | None = None

    @field_validator("title")
    @classmethod
    def _strip_title(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("title must not be blank")
        return v


class TaskUpdate(BaseModel):
    """Every field optional — PATCH only touches what is supplied.

    ``priority_override: null`` explicitly clears the manual pin.
    """

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=500)
    status: TaskStatus | None = None
    description: str | None = None
    what_i_did: str | None = None
    what_worked: str | None = None
    what_didnt: str | None = None
    priority_override: int | None = Field(default=None, ge=1)
    position_x: float | None = None
    position_y: float | None = None
    project_id: str | None = None

    @field_validator("title")
    @classmethod
    def _strip_title(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            raise ValueError("title must not be blank")
        return v


class TaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    status: TaskStatus
    description: str
    what_i_did: str
    what_worked: str
    what_didnt: str
    priority_override: int | None
    position_x: float
    position_y: float
    project_id: str | None
    created_at: datetime
    updated_at: datetime

    # Computed on read, never stored.
    suggested_priority_rank: int | None = None
    fan_out: int = 0
    # Everything downstream, not just the immediate neighbours — this is what
    # actually drives the ranking.
    unlocks_total: int = 0
    is_blocked: bool = False
    is_pinned: bool = False
    blocker_ids: list[str] = []
    # The unfinished blockers themselves, so the UI can name what's in the way.
    blockers: list[BlockerRef] = []
    # Blockers up the chain that are workable right now — where to actually start.
    root_blockers: list[BlockerRef] = []
    # Part of a circular dependency: can never be unblocked by doing work.
    in_deadlock: bool = False


class EdgeCreate(BaseModel):
    source_task_id: str
    target_task_id: str
    edge_type: EdgeType


class EdgeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    source_task_id: str
    target_task_id: str
    edge_type: EdgeType
    created_at: datetime

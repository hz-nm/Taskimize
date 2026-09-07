"""Pydantic request/response schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .models import EdgeType, SourceType, TaskStatus


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


class TaskPosition(BaseModel):
    id: str
    position_x: float
    position_y: float


class TaskPositions(BaseModel):
    """A whole drag's worth of moves. Dragging a project shifts every member, and
    one request for the group beats one per node."""

    positions: list[TaskPosition] = Field(min_length=1)


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
    source_count: int = 0


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


class SourceCreate(BaseModel):
    """Creates a link, note, or local_path source. `file` sources are created
    through the /sources/upload endpoint instead, since they need an actual
    file body rather than JSON fields."""

    type: SourceType
    title: str = Field(min_length=1, max_length=300)
    url: str | None = None
    content: str | None = None
    local_path: str | None = None
    # Optional: attach to these tasks in the same request.
    task_ids: list[str] = []

    @field_validator("title")
    @classmethod
    def _strip_title(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("title must not be blank")
        return v

    @model_validator(mode="after")
    def _check_type_fields(self) -> "SourceCreate":
        if self.type == SourceType.file:
            raise ValueError("file sources must be created via /sources/upload")
        if self.type == SourceType.link and not (self.url or "").strip():
            raise ValueError("url is required for a link source")
        if self.type == SourceType.note and not (self.content or "").strip():
            raise ValueError("content is required for a note source")
        if self.type == SourceType.local_path and not (self.local_path or "").strip():
            raise ValueError("local_path is required for a local_path source")
        return self


class SourceUpdate(BaseModel):
    """Every field optional — PATCH only touches what is supplied. `type` is
    immutable after creation; a wrong-type source is deleted and recreated
    rather than converted. `file` sources may only have their title edited —
    replacing the file itself is a delete + re-upload."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=300)
    url: str | None = None
    content: str | None = None
    local_path: str | None = None

    @field_validator("title")
    @classmethod
    def _strip_title(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            raise ValueError("title must not be blank")
        return v


class SourceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    type: SourceType
    title: str
    url: str | None
    content: str | None
    file_path: str | None
    file_name: str | None
    file_size: int | None
    local_path: str | None
    created_at: datetime
    updated_at: datetime

    # Computed on read, never stored.
    task_count: int = 0
    task_ids: list[str] = []


class TaskSourceLinks(BaseModel):
    source_ids: list[str]

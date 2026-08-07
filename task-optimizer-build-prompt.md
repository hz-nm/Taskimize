# Build Prompt: Task Optimization Graph App

Copy everything below into Claude Code as your instruction.

---

## Project: Task Optimization System

Build a single-user, locally-hosted, containerized web app for managing tasks as a
visual dependency/flow graph — like a mindmap where tasks link to their next step or
their blockers.

### Stack
- **Backend:** Python, FastAPI, SQLite (file-based DB stored in a mounted volume for persistence)
- **Frontend:** React + React Flow (for the draggable graph canvas)
- **Containerization:** Docker + docker-compose. Two services: `backend` (FastAPI, serves API on
  e.g. port 8000) and `frontend` (React app, served via Vite dev server or built static files on
  port 3000/80). Mount a volume for the SQLite DB file so data survives container restarts and the
  whole thing can be redeployed anywhere with data intact.
- No authentication — single user, no login flow needed.

### Data Model

**Task**
- `id` (uuid or int, primary key)
- `title` (string, required)
- `status` (enum: `todo`, `in_progress`, `done`)
- `what_i_did` (text, freeform)
- `what_worked` (text, freeform)
- `what_didnt` (text, freeform)
- `priority_override` (nullable int/enum — if set, this wins over computed priority)
- `position_x`, `position_y` (floats — saved node position on canvas, so layout persists across
  reloads)
- `created_at`, `updated_at` (timestamps)

**Edge (Link)**
- `id`
- `source_task_id`
- `target_task_id`
- `edge_type` (enum: `next` — source leads to target, or `blocked_by` — source is blocked by target)
- `created_at`

Tasks can exist without any edges (disconnected nodes/clusters are fine — not everything needs to
be connected). Multiple independent clusters of tasks should render fine on the same shared canvas.

### Priority Logic (Hybrid)
Compute a suggested priority score per task using this logic:
- Tasks with `status = done` are excluded from active priority ranking (but stay visible, dimmed/greyed).
- A task with **no unresolved blockers** (i.e., all `blocked_by` links point to tasks that are
  `done`, or it has no `blocked_by` links) is eligible to be prioritized.
- Among eligible tasks, rank higher by **fan-out**: how many other tasks have a `next` link
  pointing away from it, or how many tasks are blocked by it — i.e., tasks that "unlock" more
  downstream work should rank higher.
- Tasks that are currently blocked (have an incomplete `blocked_by` dependency) should rank lowest
  and be visually flagged as blocked.
- If `priority_override` is set on a task, it always wins over the computed score, and the UI
  should visually distinguish "manually pinned" priority from "suggested" priority.
- Expose a computed `suggested_priority_rank` per task via the API (recalculated on read, no need
  to store it).

### Frontend Layout

**Left sidebar (quick entry point):**
- Simple input box to add a new task by title only (defaults to `todo` status, no links). Hitting
  enter/submit immediately creates the node on the canvas.
- Below the input: a compact scrollable list of all tasks, each showing title + status + priority
  indicator, with the ability to click a task in the list to focus/select it on the canvas.
- Simple filter/sort controls: filter by status, sort by suggested priority.

**Main canvas (React Flow):**
- Renders all tasks as nodes. Node should show title, status (color-coded), and a small priority
  badge (e.g. a numbered ribbon or colored dot — suggested vs manually overridden shown
  differently).
- Free-drag: user can move nodes anywhere; position is saved (debounced auto-save on drag end) to
  `position_x`/`position_y`.
- Two distinct edge visual styles:
  - `next` edges: solid arrow, neutral color, direction = flow of work (A → B means "B is the next
    step after A")
  - `blocked_by` edges: dashed arrow, warning color (e.g. red/orange), direction = dependency (A
    ⇢ B means "A is blocked by B")
- User can draw a new edge by dragging from one node's handle to another; on creation, prompt
  (small inline popup) asking whether this is a `next` link or `blocked_by` link.
- Clicking a node opens a side panel or modal to edit: title, status, what_i_did, what_worked,
  what_didnt, and manual priority override.
- Clean, tidy, minimal visual style — generous whitespace, soft shadows, rounded nodes, muted
  color palette. Should feel like a calm mindmap, not a cluttered kanban board.

### API Endpoints (FastAPI)
- `GET /tasks` — list all tasks with computed `suggested_priority_rank`
- `POST /tasks` — create task
- `PATCH /tasks/{id}` — update task fields (status, notes, priority_override, position)
- `DELETE /tasks/{id}`
- `GET /edges` — list all edges
- `POST /edges` — create edge (source_task_id, target_task_id, edge_type)
- `DELETE /edges/{id}`

### Deliverables
- Full working codebase: `backend/` (FastAPI app + SQLite models, e.g. via SQLAlchemy) and
  `frontend/` (React + React Flow app)
- `docker-compose.yml` at project root that runs both services with one command
  (`docker-compose up`)
- A mounted volume for the SQLite file so data persists across container restarts/redeploys
- A brief `README.md` with setup/run instructions

Build this as a complete, working, one-shot implementation — not a scaffold or partial stub.

# Task Optimizer

A single-user, locally-hosted task manager that treats your work as a **dependency graph**
instead of a list. Tasks are nodes on a canvas; links between them mean either *"this is the
next step"* or *"this is blocked by that"*. The app reads the shape of the graph and tells you
what to work on next.

- **Backend:** Python · FastAPI · SQLAlchemy · SQLite (file on a mounted volume)
- **Frontend:** React 18 · React Flow · Vite
- **Deploy:** Docker Compose, two services, one command
- **Auth:** none — it's a single-user local app

---

## Quick start

```bash
docker compose up --build
```

Then open **http://localhost:3000**. The API is on **http://localhost:9000**, with interactive
docs at **http://localhost:9000/docs**.

To stop: `docker compose down`. Your data stays in the `task-data` volume — only
`docker compose down -v` erases it.

### Hot-reload development

```bash
docker compose -f docker-compose.dev.yml up --build
```

Backend reloads on save; the frontend runs the Vite dev server on port 3000. This uses a
separate `task-data-dev` volume so experiments never touch your real data.

### Running without Docker

```bash
# Terminal 1 — backend
cd backend
python -m venv .venv && .venv/Scripts/activate      # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
DATABASE_PATH=./data/tasks.db uvicorn app.main:app --reload   # PowerShell: $env:DATABASE_PATH="./data/tasks.db"

# Terminal 2 — frontend
cd frontend
npm install
VITE_API_TARGET=http://localhost:9000 npm run dev
```

---

## Using it

| Action | How |
| --- | --- |
| Add a task | Point at the spot on the canvas where you want it, type a title in the sidebar box, press Enter. The node lands under where your cursor last was on the canvas (falling back to the middle of the current view), nudged aside if that spot is taken. |
| Move a node | Drag it. The position auto-saves (400 ms debounce) and survives reloads. |
| Link two tasks | Hover a node, drag from its right handle onto another node. A prompt asks whether it's a **next step** or a **blocked by** link (keys `1` / `2`, `Esc` to cancel). |
| Delete a link | Double-click it on the canvas, or use the × in the detail panel's Links list. |
| Edit a task | Click a node. The right-hand panel edits title, description, status, the three note fields and the priority override. Text saves on a 500 ms debounce and on blur. |
| See why something is stuck | A blocked task's card is fully tinted and lists what it's waiting on. The panel's **Blocked by** list links straight to each blocker. |
| Select many tasks | Click and drag across empty canvas to rubber-band a dotted selection box, desktop-style. Ctrl/⌘-click adds individual nodes. |
| Group into a project | With 2+ tasks selected, the floating bar offers **Group into project** (name it) or **Add to existing…**. |
| Manage projects | The Projects list in the sidebar: click to frame a project, double-click to rename, × to ungroup. Ungrouping keeps the tasks. |
| Move one task between projects | The Project dropdown in the detail panel. |
| Find a task | Search box in the sidebar — matches titles *and* all note fields, since that's often the only place a detail was written down. Esc clears. Or click any row in the list to pan and zoom to that node. |
| Tidy the board | **Tidy** button, top-right of the canvas. Lays the graph out left-to-right along the flow of work. Undoable. |
| Undo a mistake | Deleting a task or tidying the board raises an undo bar for 9 seconds. A restored task comes back with its original id *and* its links. |
| Filter / sort | The two dropdowns above the sidebar list filter by status and sort by priority, recency or title. |
| Switch theme | The sun/moon button top-right of the sidebar. |

### Light & dark mode

The app follows your OS appearance setting on first load and the toggle overrides it, persisting
to `localStorage`. If you never touch the toggle it keeps tracking the OS, including live changes
while the app is open. A small inline script in [index.html](frontend/index.html) applies the theme
before first paint, so dark mode never flashes white.

Every colour is a CSS custom property defined once in [styles.css](frontend/src/styles.css);
`[data-theme="dark"]` re-points the same tokens. React Flow edges are the one exception — it paints
them as inline SVG attributes, so their colours are resolved per theme in
[App.jsx](frontend/src/App.jsx).

### Reading the canvas

Cards carry their status as a soft top-down gradient, so state is legible even zoomed out too far
to read the text. `todo` stays neutral on purpose — it's the resting state and shouldn't compete.

| Signal | Meaning |
| --- | --- |
| Neutral card, grey dot | `todo` |
| **Blue gradient card** | `in_progress` |
| **Green gradient card**, dimmed + struck through | `done` — visible but out of the ranking |
| **Amber gradient card** + `Waiting on` list | Blocked, naming the unfinished blockers |
| **Red gradient card** + `Circular dependency` | Deadlocked — see below |
| `3` neutral chip | Suggested priority rank (computed) |
| `📌 3` amber chip | Manually pinned via `priority_override` |
| `unlocks 4` tag | Direct fan-out — tasks this one immediately frees |
| Solid teal gradient arrow | `next` — A → B means B is the next step after A |
| Dashed amber arrow | `blocked_by` — A ⇢ B means A is blocked by B |
| Dashed tinted hull | A project, auto-sized around its member tasks |

Blocked outranks the other states visually: a task that is both in progress and blocked shows as
blocked, because the blocker is the thing you need to see.

Both link types are drawn as **directional gradients** — deep at the source, bright at the target —
so the direction of work reads at a glance instead of depending on the arrowhead. `next` is teal
(work flowing forward); warm amber is reserved for `blocked_by`, the one link type that represents
a problem. Connector handles sit on the left and right of each node, always faintly visible, and
turn teal when you're over a valid drop target.

Disconnected tasks and separate clusters are fully supported — not everything has to be linked.

### Canvas navigation

Because left-drag draws a selection box, panning moved to the other usual gestures:

Trackpad and mouse get different behaviour from the same wheel event, following the Figma/Miro
convention:

| Gesture | Action |
| --- | --- |
| Two-finger scroll | Pan (both axes) |
| Pinch | Zoom, anchored on the cursor |
| Ctrl + scroll | Zoom |
| Mouse wheel | Zoom — down zooms out, up zooms in |
| Shift + wheel | Pan sideways |
| Middle- or right-drag, or Space + drag | Pan |
| Left-drag on empty space | Rubber-band select |
| Double-click empty space | Zoom in |

All of this lives in [useCanvasGestures.js](frontend/src/useCanvasGestures.js) rather than React
Flow's built-ins, for two reasons. Its wheel zoom delegates to d3-zoom, which hard-codes a 0.002
multiplier and exposes no speed setting — the reason pinch felt slow. And `panOnScroll` is global,
so scroll can be *either* pan or zoom for everyone, when a trackpad and a mouse want opposites.

The replacement scales exponentially (every notch is the same *ratio*, so zooming feels identical
at 0.3x and 2x), keeps the point under the cursor fixed, and classifies each event by device:
mice emit chunky, vertical-only, whole-number deltas; trackpads don't. Detection is sticky for
800 ms, because one fast frame mid-swipe can look like a mouse notch and would otherwise flip the
canvas between panning and zooming inside a single gesture. Tune the `GAIN` constants at the top
of the file to taste.

---

## How priority is computed

Recalculated on every read from the live graph; nothing is stored. See
[backend/app/priority.py](backend/app/priority.py).

1. **`done` tasks leave the ranking** (`suggested_priority_rank: null`). They stay on the canvas,
   dimmed.
2. **Blocked** means the task has at least one `blocked_by` edge pointing at a task that isn't
   `done`. Finishing the blocker unblocks it automatically on the next read.
3. **Pinned tasks win.** Any task with a `priority_override` outranks every unpinned task, ordered
   by the override value ascending (1 = most important). The UI shows these with an amber 📌 badge
   so a manual pin is never mistaken for a suggestion.
4. **Unblocked tasks rank by leverage, descending** — the work that unlocks the most other work
   comes first.
5. **Blocked tasks rank below those**, and **deadlocked tasks last of all**.

Ties break on `created_at`, then `id`, so the order is stable between reads.

### Leverage is transitive

Direct fan-out under-counts importance. If A unlocks B, and B unlocks C and D, then finishing A
eventually frees three tasks — not one. So ranking uses `unlocks_total` (everything downstream),
while `fan_out` keeps the direct count for display. A long chain now correctly outranks a shallow
fan of two.

Both directions count as unlocking: an outgoing `next` edge (what follows this task) and an
incoming `blocked_by` edge (what this task is holding up).

### Root blockers

When a task's blocker is *itself* blocked, the direct blocker isn't actionable. `root_blockers`
walks up the chain and returns the blockers that are workable right now — the answer to "so what
do I actually do?". The panel shows them under **Start with**, and omits them when they're the
same as the direct blockers.

### Deadlock

`A blocked_by B` plus `B blocked_by A` leaves both tasks permanently blocked: no order of work can
ever clear them, and they'd otherwise sit silently at the bottom of the list forever.

- **Creating** such a link is rejected with a `409` — including indirect loops through a chain of
  any length. `next` edges may legitimately loop, so they stay permitted.
- **Existing** cycles (planted before the guard, or via direct DB edits) are detected on read,
  flagged `in_deadlock`, ranked below even blocked tasks, and shown on the canvas as a red card
  reading *"Circular dependency — remove a link to unblock"*.

Detection is a depth-first walk of the blocker graph: revisiting a node still on the current stack
means a loop, which marks everything on that path unworkable.

---

## API

Base URL `http://localhost:9000`. Full OpenAPI docs at `/docs`.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/tasks` | All tasks with computed `suggested_priority_rank`, sorted by rank |
| `POST` | `/tasks` | Create — only `title` is required. An optional `id` may be supplied so *undo delete* can restore a task under its original id (409 if that id is live) |
| `GET` | `/tasks/{id}` | Single task |
| `PATCH` | `/tasks/{id}` | Partial update. Omitted fields are untouched; explicit `"priority_override": null` clears the pin |
| `DELETE` | `/tasks/{id}` | Cascades to its edges |
| `GET` | `/edges` | All links |
| `POST` | `/edges` | `{source_task_id, target_task_id, edge_type}` — 400 self-link, 404 unknown task, 409 duplicate **or circular dependency** |
| `DELETE` | `/edges/{id}` | |
| `GET` | `/projects` | All projects with `task_count` |
| `POST` | `/projects` | `{name, color?, task_ids?}` — colour auto-cycles the palette if omitted |
| `PATCH` | `/projects/{id}` | Rename / recolour |
| `POST` | `/projects/{id}/tasks` | `{task_ids}` — add members |
| `DELETE` | `/projects/{id}/tasks/{task_id}` | Remove one member |
| `DELETE` | `/projects/{id}` | Deletes the grouping only; its tasks are released, never destroyed |
| `GET` | `/health` | Liveness probe used by Compose |

A task belongs to at most one project, so adding it to a second one moves it out of the first.

Each task in a response carries these read-only computed fields alongside its stored columns:

```jsonc
{
  "suggested_priority_rank": 2,     // null for done tasks
  "fan_out": 3,                     // downstream work unlocked by finishing this
  "is_blocked": false,              // has an unfinished blocker
  "unlocks_total": 5,               // everything downstream — drives the ranking
  "is_pinned": false,               // priority_override is set
  "blocker_ids": [],                // ids of the unfinished blockers
  "blockers": [],                   // the same blockers as {id, title, status}
  "root_blockers": [],              // blockers up the chain that are workable now
  "in_deadlock": false              // part of a circular dependency
}
```

Example:

```bash
curl -X POST localhost:9000/tasks -H 'Content-Type: application/json' \
  -d '{"title": "Draft the schema"}'

curl -X POST localhost:9000/edges -H 'Content-Type: application/json' \
  -d '{"source_task_id":"<a>","target_task_id":"<b>","edge_type":"blocked_by"}'
```

---

## Data model

**tasks** — `id` (uuid), `title`, `description`, `status` (`todo` | `in_progress` | `done`),
`what_i_did`, `what_worked`, `what_didnt`, `priority_override` (nullable, ≥ 1), `position_x`,
`position_y`, `project_id` (nullable), `created_at`, `updated_at`

**edges** — `id` (uuid), `source_task_id`, `target_task_id`, `edge_type` (`next` | `blocked_by`),
`created_at`

**projects** — `id` (uuid), `name`, `color`, `created_at`, `updated_at`. Membership is the nullable
`tasks.project_id` FK, so deleting a project releases its tasks (`ON DELETE SET NULL`).

### Schema changes on an existing database

`create_all` only creates missing *tables*, so columns added after first release would be silently
absent on an existing volume. [database.py](backend/app/database.py) keeps a small `_ADDED_COLUMNS`
list applied on every startup, each guarded by a `PRAGMA table_info` check — idempotent, and it
upgrades a live volume in place without touching your data. Add to that list when you add a column.

Constraints enforced at the DB level: no self-links, no duplicate
`(source, target, type)` triplets, and `ON DELETE CASCADE` so deleting a task takes its edges with
it (SQLite foreign keys are switched on explicitly at connect time).

---

## Persistence & backup

The SQLite file lives at `DATABASE_PATH` (`/data/tasks.db` in the container), backed by the
`task-data` named volume. Restarts, rebuilds and redeploys keep the data.

```bash
# Back up
docker run --rm -v task-data:/data -v "$PWD:/backup" alpine tar czf /backup/tasks-backup.tar.gz -C /data .

# Restore
docker run --rm -v task-data:/data -v "$PWD:/backup" alpine tar xzf /backup/tasks-backup.tar.gz -C /data
```

To move the whole thing to another machine, copy the repo plus that tarball.

---

## Tests

```bash
cd backend
pip install -r requirements.txt pytest httpx
pytest
```

Twenty end-to-end API tests cover CRUD, fan-out and transitive-leverage ranking, blocking and
unblocking, root blockers, deadlock rejection and detection of pre-existing cycles, override
precedence, edge validation and cascade deletes, restore-by-id, position persistence, disconnected
clusters, project grouping, single-project membership, and project deletion releasing rather than
destroying its tasks. They run against a throwaway SQLite file, never your real data.

---

## Project layout

```
├── docker-compose.yml          # production: nginx-served frontend + FastAPI backend
├── docker-compose.dev.yml      # hot-reload variant
├── backend/
│   ├── app/
│   │   ├── main.py             # FastAPI app, CORS, router wiring
│   │   ├── database.py         # engine, session, SQLite pragmas
│   │   ├── models.py           # Task + Edge ORM models
│   │   ├── schemas.py          # Pydantic request/response types
│   │   ├── priority.py         # the hybrid ranking algorithm
│   │   └── routers/{tasks,edges,projects}.py
│   └── tests/test_api.py
└── frontend/
    ├── nginx.conf              # serves the SPA, proxies /api -> backend:9000
    └── src/
        ├── App.jsx             # graph state, React Flow wiring, persistence
        ├── api.js              # fetch wrapper
        ├── theme.js            # light/dark state, OS preference, localStorage
        ├── useCanvasGestures.js # device-aware pan/zoom (trackpad vs mouse)
        ├── layout.js           # dagre auto-layout for the Tidy button
        ├── styles.css          # design tokens + both themes
        └── components/
            ├── Sidebar · TaskNode · TaskPanel · LinkTypePrompt
            ├── FlowEdge.jsx      # gradient-stroked edges
            ├── ProjectLayer.jsx  # auto-sized hulls behind grouped nodes
            ├── SelectionBar.jsx  # marquee actions
            └── PriorityBadge.jsx · ThemeToggle.jsx
```

## Notes

- The browser only ever talks to one origin: nginx (prod) and Vite (dev) both proxy `/api` to the
  backend, so no API URL is baked into the bundle.
- Port 9000 is published mainly for `/docs` and scripting; the UI doesn't need it.
- To run on a different port, change the `ports` mapping in `docker-compose.yml` (e.g.
  `"8080:80"` for the frontend).

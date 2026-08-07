"""Hybrid priority computation.

Ranking is recomputed on every read — nothing is stored — so the graph is always
the single source of truth.

Rules, in order:

1. ``done`` tasks are excluded from ranking entirely (rank ``None``). They stay
   visible on the canvas, just dimmed.
2. A task is **blocked** if it has any ``blocked_by`` edge pointing at a task that
   is not ``done``.
3. Tasks with a ``priority_override`` are pinned and always outrank computed ones,
   ordered by the override value ascending (1 = most important).
4. Unblocked tasks come next, ranked by how much work finishing them unlocks —
   see "leverage" below.
5. Blocked tasks rank below those, and deadlocked tasks last of all, since no
   amount of work on them is currently possible.

Ties break on ``created_at`` then ``id`` so the ordering is stable across reads.

**Leverage** is measured transitively. Direct fan-out under-counts a task's real
importance: if A unlocks B and B unlocks C and D, finishing A eventually frees
three tasks, not one. ``unlocks_total`` counts everything downstream and drives
the ranking; ``fan_out`` keeps the direct count for display.

**Deadlock.** ``A blocked_by B`` plus ``B blocked_by A`` leaves both permanently
blocked — no order of work can ever clear them. Such tasks are flagged
``in_deadlock`` and sorted last, because they need the *graph* edited, not work
done. ``root_blocker_ids`` answers the practical question for everything else:
of all the things standing in this task's way, which ones can I start on now?
"""

from dataclasses import dataclass

from .models import Edge, EdgeType, Task, TaskStatus


@dataclass(frozen=True)
class PriorityInfo:
    rank: int | None
    fan_out: int
    unlocks_total: int
    is_blocked: bool
    is_pinned: bool
    blocker_ids: tuple[str, ...]
    root_blocker_ids: tuple[str, ...]
    in_deadlock: bool


def build_blocker_map(tasks: list[Task], edges: list[Edge]) -> dict[str, list[str]]:
    """``task id -> ids of its unfinished blockers``. Shared with cycle checking."""
    by_id = {t.id: t for t in tasks}
    blockers: dict[str, list[str]] = {t.id: [] for t in tasks}

    for edge in edges:
        if edge.edge_type != EdgeType.blocked_by:
            continue
        if edge.source_task_id not in by_id or edge.target_task_id not in by_id:
            continue
        if by_id[edge.target_task_id].status != TaskStatus.done:
            blockers[edge.source_task_id].append(edge.target_task_id)

    return blockers


def _reachable(start: str, graph: dict[str, list[str]]) -> set[str]:
    """Everything reachable from ``start``, excluding itself. Cycle-safe."""
    seen: set[str] = set()
    stack = list(graph.get(start, ()))
    while stack:
        node = stack.pop()
        if node in seen:
            continue
        seen.add(node)
        stack.extend(graph.get(node, ()))
    seen.discard(start)
    return seen


def _find_deadlocked(blockers: dict[str, list[str]]) -> set[str]:
    """Tasks whose blocker chain contains a cycle, so it can never be worked off.

    A task is completable when every one of its unfinished blockers is
    completable; revisiting a node still on the current DFS stack means we've
    walked a loop, which makes everything on that path uncompletable.
    """
    UNVISITED, IN_PROGRESS, COMPLETABLE, STUCK = 0, 1, 2, 3
    state = dict.fromkeys(blockers, UNVISITED)

    def visit(node: str) -> bool:
        current = state[node]
        if current == COMPLETABLE:
            return True
        if current in (IN_PROGRESS, STUCK):
            return False  # a loop, or a known-stuck node

        state[node] = IN_PROGRESS
        ok = all(visit(blocker) for blocker in blockers.get(node, ()))
        state[node] = COMPLETABLE if ok else STUCK
        return ok

    for node in blockers:
        visit(node)

    return {node for node, value in state.items() if value == STUCK}


def compute_priorities(tasks: list[Task], edges: list[Edge]) -> dict[str, PriorityInfo]:
    """Return a ``task_id -> PriorityInfo`` map for the whole graph."""
    by_id = {t.id: t for t in tasks}
    unfinished = {t.id for t in tasks if t.status != TaskStatus.done}

    # `unlocks[x]` = tasks that become workable once x is finished.
    unlocks: dict[str, list[str]] = {t.id: [] for t in tasks}

    for edge in edges:
        # Ignore dangling edges (shouldn't exist thanks to FK cascade, but be safe).
        if edge.source_task_id not in by_id or edge.target_task_id not in by_id:
            continue

        if edge.edge_type == EdgeType.next:
            # source -> target: finishing `source` leads to `target`.
            unlocks[edge.source_task_id].append(edge.target_task_id)
        elif edge.edge_type == EdgeType.blocked_by:
            # source is blocked by target: finishing `target` frees `source`.
            unlocks[edge.target_task_id].append(edge.source_task_id)

    blockers = build_blocker_map(tasks, edges)
    deadlocked = _find_deadlocked(blockers)

    def root_blockers(task_id: str) -> tuple[str, ...]:
        """Blockers up the chain that are themselves unblocked — start here."""
        return tuple(sorted(b for b in _reachable(task_id, blockers) if not blockers.get(b)))

    fan_out = {t.id: len({u for u in unlocks[t.id] if u in unfinished}) for t in tasks}
    unlocks_total = {t.id: len(_reachable(t.id, unlocks) & unfinished) for t in tasks}

    rankable = [t for t in tasks if t.status != TaskStatus.done]

    def sort_key(task: Task):
        is_pinned = task.priority_override is not None
        is_blocked = bool(blockers[task.id])
        return (
            0 if is_pinned else 1,                       # pinned tasks first
            task.priority_override if is_pinned else 0,  # ...by override value ascending
            2 if task.id in deadlocked else (1 if is_blocked else 0),  # workable first
            -unlocks_total[task.id],                     # most downstream work freed
            -fan_out[task.id],                           # then most immediately freed
            task.created_at,                             # stable tiebreakers
            task.id,
        )

    ordered = sorted(rankable, key=sort_key)
    ranks = {task.id: i + 1 for i, task in enumerate(ordered)}

    return {
        t.id: PriorityInfo(
            rank=ranks.get(t.id),
            fan_out=fan_out[t.id],
            unlocks_total=unlocks_total[t.id],
            is_blocked=bool(blockers[t.id]) and t.status != TaskStatus.done,
            is_pinned=t.priority_override is not None,
            blocker_ids=tuple(blockers[t.id]),
            root_blocker_ids=root_blockers(t.id) if t.status != TaskStatus.done else (),
            in_deadlock=t.id in deadlocked and t.status != TaskStatus.done,
        )
        for t in tasks
    }

/**
 * Rank chip. Manually pinned priorities get the pin glyph and a warm tint;
 * computed suggestions stay neutral, so the two are never confused.
 */
export default function PriorityBadge({ task, size, label }) {
  if (task.status === 'done' || task.suggested_priority_rank == null) return null

  const pinned = task.is_pinned
  return (
    <span
      className={`badge ${pinned ? 'badge--pinned' : 'badge--suggested'} ${size === 'sm' ? 'badge--sm' : ''}`}
      title={pinned ? `Manually pinned (override ${task.priority_override})` : 'Suggested priority'}
    >
      {pinned ? (
        <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true">
          <path d="M14.5 2.5 21.5 9.5l-2.1 2.1-1.4-.4-3.6 3.6.6 3.1-1.8 1.8-4.2-4.2-4.9 4.9-1-1 4.9-4.9L3.8 10.3l1.8-1.8 3.1.6 3.6-3.6-.4-1.4z" />
        </svg>
      ) : null}
      {label && <span className="badge__label">{pinned ? 'pinned' : 'suggested'}</span>}
      {task.suggested_priority_rank}
    </span>
  )
}

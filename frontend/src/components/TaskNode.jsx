import { memo } from 'react'
import { Handle, Position } from 'reactflow'

import PriorityBadge from './PriorityBadge'

const STATUS_LABEL = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
}

/** A single task card on the canvas. */
function TaskNode({ data, selected }) {
  const { task } = data
  const done = task.status === 'done'
  const blocked = task.is_blocked && !done
  const deadlocked = task.in_deadlock && !done
  const blockers = task.blockers ?? []

  return (
    <div
      className={[
        'node',
        `node--${task.status}`,
        blocked ? 'node--blocked' : '',
        deadlocked ? 'node--deadlock' : '',
        // `selected` is React Flow's (click / marquee); `focused` is ours, set
        // when a task is opened from the sidebar or the detail panel.
        selected || data.focused ? 'node--selected' : '',
        selected ? 'node--picked' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Handle type="target" position={Position.Left} className="node__handle" />

      <div className="node__head">
        <span className="node__status">
          <i className={`dot dot--${blocked ? 'blocked' : task.status}`} aria-hidden="true" />
          {blocked ? 'Blocked' : STATUS_LABEL[task.status]}
        </span>
        <PriorityBadge task={task} />
      </div>

      <p className="node__title">{task.title}</p>

      {task.description && <p className="node__description">{task.description}</p>}

      {deadlocked && (
        <div className="node__deadlock">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-6.2-8.6" />
            <path d="M21 3v5h-5" />
          </svg>
          Circular dependency — remove a link to unblock
        </div>
      )}

      {/* Name what's in the way, rather than only flagging that something is. */}
      {blocked && !deadlocked && blockers.length > 0 && (
        <div className="node__blockers">
          <span className="node__blockers-label">Waiting on</span>
          <ul>
            {blockers.slice(0, 2).map((blocker) => (
              <li key={blocker.id} title={blocker.title}>{blocker.title}</li>
            ))}
          </ul>
          {blockers.length > 2 && <span className="node__blockers-more">+{blockers.length - 2} more</span>}
        </div>
      )}

      {task.fan_out > 0 && (
        <div className="node__meta">
          <span className="tag">unlocks {task.fan_out}</span>
        </div>
      )}

      <Handle type="source" position={Position.Right} className="node__handle" />
    </div>
  )
}

export default memo(TaskNode)

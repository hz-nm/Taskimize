import SourceIcon from './SourceIcon'

/** Shows on a task's node/list entry whenever it has attached reference
 * material, so a relevant source already on file is never missed at a glance. */
export default function SourceBadge({ task, size }) {
  if (!task.source_count) return null

  return (
    <span
      className={`badge badge--source ${size === 'sm' ? 'badge--sm' : ''}`}
      title={`${task.source_count} attached source${task.source_count === 1 ? '' : 's'}`}
    >
      <SourceIcon type="attachment" size={11} />
      {task.source_count}
    </span>
  )
}

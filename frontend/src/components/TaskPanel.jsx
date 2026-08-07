import { useEffect, useRef, useState } from 'react'

import PriorityBadge from './PriorityBadge'

const STATUSES = [
  { value: 'todo', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
]

const NOTES = [
  { field: 'what_i_did', label: 'What I did', placeholder: 'Actions taken so far…' },
  { field: 'what_worked', label: 'What worked', placeholder: 'Keep doing this…' },
  { field: 'what_didnt', label: "What didn't", placeholder: 'Dead ends, things to avoid…' },
]

/** Detail editor for the selected task. Text edits save on a short debounce. */
export default function TaskPanel({
  task,
  tasks,
  links,
  projects,
  onChange,
  onDelete,
  onDeleteLink,
  onClose,
  onFocusTask,
}) {
  const [draft, setDraft] = useState(task)
  const timer = useRef(null)

  // Adopt server-side changes (rank, timestamps) without clobbering active typing.
  useEffect(() => {
    setDraft((current) => ({ ...task, ...(timer.current ? current : {}) }))
  }, [task])

  useEffect(() => () => clearTimeout(timer.current), [])

  const commit = (patch) => {
    clearTimeout(timer.current)
    timer.current = null
    onChange(task.id, patch)
  }

  const editText = (field, value) => {
    setDraft((current) => ({ ...current, [field]: value }))
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      const trimmed = field === 'title' ? value.trim() : value
      if (field === 'title' && !trimmed) return // never save a blank title
      onChange(task.id, { [field]: trimmed })
    }, 500)
  }

  const setOverride = (raw) => {
    const value = raw === '' ? null : Math.max(1, Number(raw))
    setDraft((current) => ({ ...current, priority_override: value }))
    if (raw !== '' && Number.isNaN(value)) return
    commit({ priority_override: value })
  }

  const titleOf = (id) => tasks.find((t) => t.id === id)?.title ?? 'unknown task'
  // Read off the live task, not the draft — blockers are computed server-side.
  const blockers = task.status === 'done' ? [] : task.blockers ?? []
  const rootBlockers = task.status === 'done' ? [] : task.root_blockers ?? []

  return (
    <aside className="panel">
      <header className="panel__header">
        <div>
          <span className="panel__eyebrow">Task details</span>
          <PriorityBadge task={task} label />
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close panel">×</button>
      </header>

      <div className="panel__body">
        <label className="field">
          <span>Title</span>
          <input
            type="text"
            value={draft.title}
            onChange={(e) => editText('title', e.target.value)}
            onBlur={(e) => e.target.value.trim() && commit({ title: e.target.value.trim() })}
          />
        </label>

        {/* Sits directly under the title: what this task actually is, as opposed
            to the retro notes further down which are about how it went. */}
        <label className="field">
          <span>Description</span>
          <textarea
            rows="3"
            value={draft.description ?? ''}
            placeholder="What is this task, in a sentence or two…"
            onChange={(e) => editText('description', e.target.value)}
            onBlur={(e) => commit({ description: e.target.value })}
          />
        </label>

        {task.in_deadlock && (
          <div className="field">
            <span>Circular dependency</span>
            <p className="callout callout--danger">
              This task and its blockers wait on each other in a loop, so no amount of work can
              clear it. Delete one of the <em>blocked by</em> links to break the cycle.
            </p>
          </div>
        )}

        {blockers.length > 0 && (
          <div className="field">
            <span>Blocked by</span>
            <ul className="blocker-list">
              {blockers.map((blocker) => (
                <li key={blocker.id}>
                  <button type="button" onClick={() => onFocusTask(blocker.id)}>
                    <i className={`dot dot--${blocker.status}`} aria-hidden="true" />
                    <span>{blocker.title}</span>
                  </button>
                </li>
              ))}
            </ul>
            <small>This task stays at the bottom of the ranking until these are done.</small>
          </div>
        )}

        {/* The blockers are themselves blocked — name what can actually be started. */}
        {rootBlockers.length > 0 && (
          <div className="field">
            <span>Start with</span>
            <ul className="blocker-list blocker-list--root">
              {rootBlockers.map((blocker) => (
                <li key={blocker.id}>
                  <button type="button" onClick={() => onFocusTask(blocker.id)}>
                    <i className={`dot dot--${blocker.status}`} aria-hidden="true" />
                    <span>{blocker.title}</span>
                  </button>
                </li>
              ))}
            </ul>
            <small>Further up the chain, and workable right now.</small>
          </div>
        )}

        <div className="field">
          <span>Status</span>
          <div className="segmented">
            {STATUSES.map((s) => (
              <button
                key={s.value}
                type="button"
                className={draft.status === s.value ? 'is-active' : ''}
                onClick={() => {
                  setDraft((c) => ({ ...c, status: s.value }))
                  commit({ status: s.value })
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {projects.length > 0 && (
          <label className="field">
            <span>Project</span>
            <select
              value={draft.project_id ?? ''}
              onChange={(e) => {
                const value = e.target.value || null
                setDraft((c) => ({ ...c, project_id: value }))
                commit({ project_id: value })
              }}
            >
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
        )}

        <label className="field">
          <span>Priority override</span>
          <input
            type="number"
            min="1"
            placeholder="Auto (suggested)"
            value={draft.priority_override ?? ''}
            onChange={(e) => setOverride(e.target.value)}
          />
          <small>
            Leave blank to use the suggested rank. A number pins this task above every unpinned one
            (1 = highest).
          </small>
        </label>

        {NOTES.map(({ field, label, placeholder }) => (
          <label key={field} className="field">
            <span>{label}</span>
            <textarea
              rows="3"
              value={draft[field] ?? ''}
              placeholder={placeholder}
              onChange={(e) => editText(field, e.target.value)}
              onBlur={(e) => commit({ [field]: e.target.value })}
            />
          </label>
        ))}

        <div className="field">
          <span>Links ({links.length})</span>
          {links.length === 0 && <small>No links yet — drag from a node handle on the canvas.</small>}
          <ul className="link-list">
            {links.map((link) => {
              const outgoing = link.source_task_id === task.id
              const other = outgoing ? link.target_task_id : link.source_task_id
              const description =
                link.edge_type === 'next'
                  ? outgoing ? 'next step →' : '← follows'
                  : outgoing ? 'blocked by ⇢' : '⇠ blocks'
              return (
                <li key={link.id} className={`link-list__item link-list__item--${link.edge_type}`}>
                  <button type="button" className="link-list__go" onClick={() => onFocusTask(other)}>
                    <em>{description}</em> {titleOf(other)}
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => onDeleteLink(link.id)}
                    aria-label="Delete link"
                  >
                    ×
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </div>

      <footer className="panel__footer">
        {/* No confirm dialog: deletion is undoable for a few seconds, which is
            less friction than a modal and just as safe. */}
        <button type="button" className="danger" onClick={() => onDelete(task.id)}>
          Delete task
        </button>
      </footer>
    </aside>
  )
}

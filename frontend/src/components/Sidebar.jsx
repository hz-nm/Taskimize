import { useMemo, useState } from 'react'

import PriorityBadge from './PriorityBadge'
import ThemeToggle from './ThemeToggle'

const STATUS_LABEL = { todo: 'To do', in_progress: 'In progress', done: 'Done' }

/** Quick-entry box, the project list, and the filterable/sortable task list. */
export default function Sidebar({
  tasks,
  selectedId,
  loading,
  theme,
  onToggleTheme,
  onAdd,
  onSelect,
  projects,
  onSelectProject,
  onRenameProject,
  onDeleteProject,
}) {
  const [draft, setDraft] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('priority')
  const [renamingId, setRenamingId] = useState(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [query, setQuery] = useState('')

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = tasks.filter((task) => {
      if (statusFilter !== 'all' && task.status !== statusFilter) return false
      if (!needle) return true
      // Search the notes too — often the only place a detail was written down.
      return ['title', 'description', 'what_i_did', 'what_worked', 'what_didnt'].some((field) =>
        (task[field] ?? '').toLowerCase().includes(needle),
      )
    })
    const sorted = [...filtered]

    if (sortBy === 'priority') {
      // Unranked (done) tasks sink to the bottom.
      sorted.sort((a, b) => {
        const ra = a.suggested_priority_rank ?? Number.MAX_SAFE_INTEGER
        const rb = b.suggested_priority_rank ?? Number.MAX_SAFE_INTEGER
        return ra - rb || a.title.localeCompare(b.title)
      })
    } else if (sortBy === 'title') {
      sorted.sort((a, b) => a.title.localeCompare(b.title))
    } else {
      sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    }

    return sorted
  }, [tasks, statusFilter, sortBy, query])

  const submit = (event) => {
    event.preventDefault()
    const title = draft.trim()
    if (!title) return
    setDraft('')
    onAdd(title)
  }

  const openCount = tasks.filter((t) => t.status !== 'done').length

  const commitRename = (event) => {
    event.preventDefault()
    const name = renameDraft.trim()
    if (name) onRenameProject(renamingId, name)
    setRenamingId(null)
  }

  return (
    <aside className="sidebar">
      <header className="sidebar__header">
        <div>
          <h1>Task Optimizer</h1>
          <p className="sidebar__subtitle">
            {loading ? 'Loading…' : `${openCount} open · ${tasks.length} total`}
          </p>
        </div>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </header>

      <form className="sidebar__form" onSubmit={submit}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a task…"
          aria-label="New task title"
          autoComplete="off"
        />
        <button type="submit" disabled={!draft.trim()} aria-label="Add task">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </form>

      {projects.length > 0 && (
        <section className="projects">
          <h2 className="sidebar__section">Projects</h2>
          <ul className="projects__list">
            {projects.map((project) => (
              <li key={project.id} className={`projects__item projects__item--${project.color}`}>
                {renamingId === project.id ? (
                  <form className="projects__rename" onSubmit={commitRename}>
                    <input
                      autoFocus
                      value={renameDraft}
                      aria-label="Project name"
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => e.key === 'Escape' && setRenamingId(null)}
                    />
                  </form>
                ) : (
                  <>
                    <button
                      type="button"
                      className="projects__go"
                      onClick={() => onSelectProject(project.id)}
                      onDoubleClick={() => {
                        setRenamingId(project.id)
                        setRenameDraft(project.name)
                      }}
                      title="Click to frame · double-click to rename"
                    >
                      <i className="projects__swatch" aria-hidden="true" />
                      <span className="projects__name">{project.name}</span>
                      <span className="projects__count">{project.task_count}</span>
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      title="Ungroup (tasks are kept)"
                      aria-label={`Ungroup ${project.name}`}
                      onClick={() => onDeleteProject(project.id)}
                    >
                      ×
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="search">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"
             strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tasks and notes…"
          aria-label="Search tasks"
          onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
        />
        {query && (
          <button type="button" className="icon-button" onClick={() => setQuery('')} aria-label="Clear search">
            ×
          </button>
        )}
      </div>

      <div className="sidebar__controls">
        <label>
          <span>Status</span>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="todo">To do</option>
            <option value="in_progress">In progress</option>
            <option value="done">Done</option>
          </select>
        </label>
        <label>
          <span>Sort</span>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="priority">By priority</option>
            <option value="created">Newest first</option>
            <option value="title">By title</option>
          </select>
        </label>
      </div>

      <ul className="task-list">
        {visible.map((task) => (
          <li key={task.id}>
            <button
              type="button"
              className={[
                'task-list__item',
                `task-list__item--${task.status}`,
                task.id === selectedId ? 'is-selected' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onSelect(task.id)}
            >
              <span
                className={`dot dot--${
                  task.is_blocked && task.status !== 'done' ? 'blocked' : task.status
                }`}
                aria-hidden="true"
              />
              <span className="task-list__title">{task.title}</span>
              <PriorityBadge task={task} size="sm" />
              <span className="sr-only">{STATUS_LABEL[task.status]}</span>
            </button>
          </li>
        ))}
        {visible.length === 0 && !loading && (
          <li className="task-list__empty">
            {query ? `Nothing matches “${query.trim()}”.` : 'No tasks match this filter.'}
          </li>
        )}
      </ul>
    </aside>
  )
}

import { useEffect, useRef, useState } from 'react'

/**
 * Floating action bar for a marquee selection: name the group and it becomes a
 * project, or drop the selection into one that already exists.
 */
export default function SelectionBar({ count, projects, onCreate, onAddTo, onClear }) {
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (naming) inputRef.current?.focus()
  }, [naming])

  // A fresh selection resets the bar to its default state.
  useEffect(() => {
    setNaming(false)
    setName('')
  }, [count])

  const submit = (event) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    onCreate(trimmed)
  }

  return (
    <div className="selection-bar">
      <span className="selection-bar__count">
        {count} task{count === 1 ? '' : 's'} selected
      </span>

      {naming ? (
        <form className="selection-bar__form" onSubmit={submit}>
          <input
            ref={inputRef}
            type="text"
            value={name}
            placeholder="Project name…"
            aria-label="Project name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setNaming(false)}
          />
          <button type="submit" className="selection-bar__primary" disabled={!name.trim()}>
            Create
          </button>
        </form>
      ) : (
        <>
          <button type="button" className="selection-bar__primary" onClick={() => setNaming(true)}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"
                 strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="4" strokeDasharray="3 3" />
            </svg>
            Group into project
          </button>

          {projects.length > 0 && (
            <select
              className="selection-bar__select"
              value=""
              aria-label="Add selection to an existing project"
              onChange={(e) => e.target.value && onAddTo(e.target.value)}
            >
              <option value="">Add to existing…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
        </>
      )}

      <button type="button" className="icon-button" onClick={onClear} aria-label="Clear selection">×</button>
    </div>
  )
}

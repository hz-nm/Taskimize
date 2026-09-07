import { useEffect, useMemo, useState } from 'react'

import SourceIcon from './SourceIcon'

function preview(source) {
  return source.url || source.content || source.local_path || source.file_name || ''
}

/** Search-and-attach modal for the shared source library — the fix for "I know
 * I already saved this somewhere". Stays open across attaches so several
 * sources found in one search can all be attached in one session. */
export default function SourcePicker({ sources, attachedIds, onAttach, onCancel }) {
  const [query, setQuery] = useState('')

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matches = !needle
      ? sources
      : sources.filter((s) =>
          [s.title, s.url, s.content, s.local_path, s.file_name].some((f) =>
            (f ?? '').toLowerCase().includes(needle),
          ),
        )
    return [...matches].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
  }, [sources, query])

  return (
    <div className="prompt-backdrop" onClick={onCancel} role="presentation">
      <div
        className="prompt source-picker"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Attach an existing source"
      >
        <p className="prompt__title">Attach an existing source</p>

        <div className="source-picker__search">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            autoFocus
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the source library…"
            aria-label="Search sources"
          />
        </div>

        <ul className="source-picker__results">
          {results.map((source) => {
            const attached = attachedIds.has(source.id)
            return (
              <li key={source.id} className="source-picker__row">
                <SourceIcon type={source.type} size={14} />
                <div className="source-picker__row-body">
                  <div className="source-picker__row-title">{source.title}</div>
                  <p className="source-picker__row-preview">{preview(source)}</p>
                </div>
                <button
                  type="button"
                  className="button--sm"
                  disabled={attached}
                  onClick={() => onAttach(source.id)}
                >
                  {attached ? 'Attached' : 'Attach'}
                </button>
              </li>
            )
          })}
          {results.length === 0 && (
            <li className="source-picker__empty">
              {query ? 'Nothing matches — try "New source" instead.' : 'The source library is empty.'}
            </li>
          )}
        </ul>

        <button type="button" className="prompt__cancel" onClick={onCancel}>Done (Esc)</button>
      </div>
    </div>
  )
}

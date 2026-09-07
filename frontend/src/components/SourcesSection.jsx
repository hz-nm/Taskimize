import { useState } from 'react'

import SourceIcon from './SourceIcon'
import SourcePicker from './SourcePicker'

const TYPES = [
  { value: 'link', label: 'Link' },
  { value: 'note', label: 'Note' },
  { value: 'file', label: 'File' },
  { value: 'local_path', label: 'Local path' },
]

const FILES_BASE = (import.meta.env.VITE_API_BASE || '/api') + '/files'

function openSource(source) {
  if (source.type === 'link') window.open(source.url, '_blank', 'noopener,noreferrer')
  if (source.type === 'file') window.open(`${FILES_BASE}/${source.file_path}`, '_blank', 'noopener,noreferrer')
}

/** Attached-sources list, an "attach existing" picker, and a quick-add form —
 * the task-side half of the shared source library. */
export default function SourcesSection({ taskId, sources, allSources, onAttach, onDetach, onCreate, onUpload }) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  const [adding, setAdding] = useState(false)
  const [type, setType] = useState('link')
  const [title, setTitle] = useState('')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  const attachedIds = new Set(sources.map((s) => s.id))

  const resetAdd = () => {
    setAdding(false)
    setTitle('')
    setValue('')
    setType('link')
  }

  const submitAdd = async (event) => {
    event.preventDefault()
    if (type === 'file') return
    if (!title.trim() || !value.trim()) return
    setBusy(true)
    try {
      const fields = { title: title.trim() }
      if (type === 'link') fields.url = value.trim()
      if (type === 'note') fields.content = value
      if (type === 'local_path') fields.local_path = value.trim()
      await onCreate({ type, task_ids: [taskId], ...fields })
      resetAdd()
    } finally {
      setBusy(false)
    }
  }

  const submitFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      await onUpload(file, title.trim() || undefined)
      resetAdd()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="field">
      <span>Sources ({sources.length})</span>
      {sources.length === 0 && <small>No sources attached — attach one you already have, or add a new one.</small>}

      <ul className="link-list">
        {sources.map((source) => (
          <li key={source.id} className="link-list__item source-list__item">
            <span className="source-list__icon"><SourceIcon type={source.type} size={13} /></span>
            <div className="source-list__body">
              {source.type === 'note' && (
                <button
                  type="button"
                  className="link-list__go source-list__title"
                  onClick={() => setExpandedId((cur) => (cur === source.id ? null : source.id))}
                >
                  {source.title}
                </button>
              )}
              {source.type === 'local_path' && <span className="source-list__title">{source.title}</span>}
              {(source.type === 'link' || source.type === 'file') && (
                <button
                  type="button"
                  className="link-list__go source-list__title"
                  onClick={() => openSource(source)}
                >
                  {source.title}
                </button>
              )}
              {source.type === 'note' && expandedId === source.id && (
                <p className="source-list__content">{source.content}</p>
              )}
              {source.type === 'local_path' && (
                <div className="source-list__path">
                  <code title={source.local_path}>{source.local_path}</code>
                  <button
                    type="button"
                    className="icon-button"
                    title="Copy path"
                    aria-label="Copy path"
                    onClick={() => navigator.clipboard?.writeText(source.local_path)}
                  >
                    ⧉
                  </button>
                </div>
              )}
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={() => onDetach(source.id)}
              aria-label="Detach source"
              title="Detach (stays in the library)"
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <div className="source-add__actions">
        <button type="button" className="button--sm" onClick={() => setPickerOpen(true)}>
          Attach existing
        </button>
        <button type="button" className="button--sm" onClick={() => setAdding((v) => !v)}>
          {adding ? 'Cancel' : 'New source'}
        </button>
      </div>

      {adding && (
        <form className="source-add" onSubmit={submitAdd}>
          <div className="segmented">
            {TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                className={type === t.value ? 'is-active' : ''}
                onClick={() => setType(t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <input
            type="text"
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          {type === 'link' && (
            <input
              type="url"
              placeholder="https://…"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
          {type === 'note' && (
            <textarea rows="3" placeholder="Note text…" value={value} onChange={(e) => setValue(e.target.value)} />
          )}
          {type === 'local_path' && (
            <input
              type="text"
              placeholder="/path/on/this/machine"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
          {type === 'file' && (
            <input type="file" onChange={submitFile} disabled={busy} />
          )}

          {type !== 'file' && (
            <button type="submit" className="button--sm button--primary" disabled={busy}>
              Add &amp; attach
            </button>
          )}
        </form>
      )}

      {pickerOpen && (
        <SourcePicker
          sources={allSources}
          attachedIds={attachedIds}
          onAttach={onAttach}
          onCancel={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}

import { useEffect } from 'react'

/** Asks what kind of link was just drawn, before anything is persisted. */
export default function LinkTypePrompt({ labels, onPick, onCancel }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel()
      if (e.key === '1') onPick('next')
      if (e.key === '2') onPick('blocked_by')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onPick, onCancel])

  const source = labels?.source ?? 'this task'
  const target = labels?.target ?? 'that task'

  return (
    <div className="prompt-backdrop" onClick={onCancel} role="presentation">
      <div className="prompt" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Choose link type">
        <p className="prompt__title">What kind of link is this?</p>
        <div className="prompt__options">
          <button type="button" className="prompt__option prompt__option--next" onClick={() => onPick('next')}>
            <strong>Next step</strong>
            <span>“{target}” comes after “{source}”</span>
            <kbd>1</kbd>
          </button>
          <button
            type="button"
            className="prompt__option prompt__option--blocked"
            onClick={() => onPick('blocked_by')}
          >
            <strong>Blocked by</strong>
            <span>“{source}” can't start until “{target}” is done</span>
            <kbd>2</kbd>
          </button>
        </div>
        <button type="button" className="prompt__cancel" onClick={onCancel}>Cancel (Esc)</button>
      </div>
    </div>
  )
}

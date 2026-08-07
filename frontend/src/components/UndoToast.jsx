import { useEffect, useState } from 'react'

const LIFETIME_MS = 9000

/** Transient "that happened — take it back?" bar, with a draining progress line. */
export default function UndoToast({ action, onUndo, onDismiss }) {
  const [remaining, setRemaining] = useState(1)

  useEffect(() => {
    const started = performance.now()
    let frame

    const tick = () => {
      const left = 1 - (performance.now() - started) / LIFETIME_MS
      if (left <= 0) {
        onDismiss()
        return
      }
      setRemaining(left)
      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
    // Re-arms whenever a new action replaces the current one.
  }, [action, onDismiss])

  return (
    <div className="undo-toast" role="status">
      <span className="undo-toast__label">{action.label}</span>
      <button type="button" className="undo-toast__action" onClick={onUndo}>
        Undo
      </button>
      <button type="button" className="icon-button" onClick={onDismiss} aria-label="Dismiss">×</button>
      <i className="undo-toast__timer" style={{ transform: `scaleX(${remaining})` }} aria-hidden="true" />
    </div>
  )
}

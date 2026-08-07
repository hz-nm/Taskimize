import { useEffect } from 'react'
import { useReactFlow } from 'reactflow'

/*
 * Canvas pan/zoom gestures, handled directly instead of through React Flow.
 *
 * Two reasons not to use the built-ins: d3-zoom hard-codes a 0.002 wheel
 * multiplier with no speed setting (which is why pinch crawled), and React Flow
 * makes scroll either pan or zoom globally — but a trackpad and a mouse want
 * opposite things from the same wheel event.
 *
 * The convention here is the one Figma and Miro use:
 *
 *   two-finger scroll  -> pan          (trackpad)
 *   pinch              -> zoom         (trackpad, arrives as ctrl+wheel)
 *   ctrl + scroll      -> zoom         (either device)
 *   shift + scroll     -> pan sideways (mouse)
 *   wheel notch        -> zoom         (mouse, map-style)
 */

// deltaMode 1 = lines, 2 = pages. Normalise to pixels first.
const LINE = 16
const PAGE = 400

// Per-device zoom gain, tuned so one gesture is a ~2-3x change: mouse notch
// ~1.6x, long trackpad pinch ~2.5x.
const GAIN = { pinch: 0.01, wheel: 0.005 }

// Once a trackpad is detected, stay in trackpad mode briefly. A single flick
// emits a burst of events and a fast one can look like a mouse notch mid-stream;
// without this the canvas would flip between panning and zooming inside one swipe.
const TRACKPAD_MEMORY_MS = 800

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

/** Mice emit chunky, vertical-only, whole-number deltas; trackpads don't. */
function looksLikeTrackpad(event) {
  if (event.deltaX !== 0) return true
  if (event.deltaMode !== 0) return false
  return Math.abs(event.deltaY) < 50 || !Number.isInteger(event.deltaY)
}

export function useCanvasGestures(ref, { minZoom, maxZoom }) {
  const { getViewport, setViewport } = useReactFlow()

  useEffect(() => {
    const element = ref.current
    if (!element) return undefined

    let lastTrackpadAt = -Infinity

    const zoomBy = (rawDelta, clientX, clientY, gain) => {
      const { x, y, zoom } = getViewport()

      // Exponential so each notch is a constant *ratio* — zooming feels the same
      // at 0.3x as at 2x. Scrolling down (positive delta) zooms out, as in maps.
      const next = clamp(zoom * Math.exp(-rawDelta * gain), minZoom, maxZoom)
      if (next === zoom) return

      // Anchor on the pointer so the canvas point under the cursor stays put.
      const rect = element.getBoundingClientRect()
      const px = clientX - rect.left
      const py = clientY - rect.top
      const ratio = next / zoom

      setViewport({ x: px - (px - x) * ratio, y: py - (py - y) * ratio, zoom: next })
    }

    const panBy = (dx, dy) => {
      const { x, y, zoom } = getViewport()
      // Viewport translation is in screen pixels, so deltas apply directly.
      setViewport({ x: x - dx, y: y - dy, zoom })
    }

    const onWheel = (event) => {
      // Stops page scroll and the browser's own ctrl+wheel zoom.
      event.preventDefault()

      const scale = event.deltaMode === 1 ? LINE : event.deltaMode === 2 ? PAGE : 1
      const dx = event.deltaX * scale
      const dy = event.deltaY * scale
      if (!dx && !dy) return

      const now = performance.now()
      if (!event.ctrlKey && looksLikeTrackpad(event)) lastTrackpadAt = now
      const trackpad = now - lastTrackpadAt < TRACKPAD_MEMORY_MS

      if (event.ctrlKey) {
        // Pinch, or an explicit ctrl+scroll on a mouse.
        zoomBy(dy, event.clientX, event.clientY, trackpad ? GAIN.pinch : GAIN.wheel)
      } else if (trackpad) {
        panBy(dx, dy)
      } else if (event.shiftKey) {
        panBy(dy, 0) // mouse convention: shift turns the wheel sideways
      } else {
        zoomBy(dy, event.clientX, event.clientY, GAIN.wheel)
      }
    }

    // passive:false is required for preventDefault to take effect on wheel.
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [ref, getViewport, setViewport, minZoom, maxZoom])
}

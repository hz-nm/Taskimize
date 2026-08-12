import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useStore } from 'reactflow'

const PADDING = 26
const HEADER = 26

const selectTransform = (s) => s.transform
const selectNodeInternals = (s) => s.nodeInternals

/** Bounding box per project, in flow coordinates. */
function hullBoxes(projects, tasks, nodeInternals) {
  const membersByProject = new Map(projects.map((p) => [p.id, []]))
  for (const task of tasks) {
    if (!task.project_id) continue
    const node = nodeInternals.get(task.id)
    const bucket = membersByProject.get(task.project_id)
    // A node has no width until React Flow has measured it on first paint.
    if (node && bucket && node.width) bucket.push(node)
  }

  return projects
    .map((project) => {
      const members = membersByProject.get(project.id) ?? []
      if (members.length === 0) return null
      return {
        project,
        count: members.length,
        left: Math.min(...members.map((n) => n.positionAbsolute.x)) - PADDING,
        top: Math.min(...members.map((n) => n.positionAbsolute.y)) - PADDING - HEADER,
        right: Math.max(...members.map((n) => n.positionAbsolute.x + n.width)) + PADDING,
        bottom: Math.max(...members.map((n) => n.positionAbsolute.y + (n.height ?? 90))) + PADDING,
      }
    })
    .filter(Boolean)
}

/**
 * Draws a rounded hull behind each project, sized to the bounding box of its
 * member nodes, with a label chip that doubles as a drag handle for the group.
 *
 * Geometry comes straight from React Flow's store rather than from task data, so
 * a hull resizes continuously while a member is dragged instead of snapping once
 * the save lands.
 *
 * This renders as **two** layers, and that split is load-bearing. React Flow
 * stacks its pane (which captures marquee drags) above anything drawn behind the
 * nodes, so a handle painted with the hull body would sit under the pane and
 * never receive a pointer event. Bodies therefore go below the nodes, purely
 * decorative; label chips go above them in their own layer, where they can
 * actually be grabbed.
 *
 * Panning and zooming fire on every wheel tick but move nothing on the canvas,
 * so the two things this component produces are deliberately kept apart: the
 * viewport transform is a plain CSS string, while the hulls themselves are
 * memoised on node positions and survive untouched through a pan.
 */
export default function ProjectLayer({
  projects,
  tasks,
  selectedProjectId,
  onDragStart,
  onDrag,
  onDragEnd,
}) {
  const transform = useStore(selectTransform)
  // Changes on every frame of a node drag, but not while panning or zooming.
  const nodeInternals = useStore(selectNodeInternals)
  const dragRef = useRef(null)

  const boxes = useMemo(
    () => hullBoxes(projects, tasks, nodeInternals),
    [projects, tasks, nodeInternals],
  )

  const [tx, ty, zoom] = transform
  const viewport = useMemo(
    () => ({ transform: `translate(${tx}px, ${ty}px) scale(${zoom})` }),
    [tx, ty, zoom],
  )

  // Read at pointer-down only, so the handlers below stay referentially stable
  // through a zoom rather than invalidating every memoised label chip.
  const zoomRef = useRef(zoom)
  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  const startDrag = useCallback(
    (event, projectId) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation() // keep the pane from starting a marquee underneath
      event.currentTarget.setPointerCapture(event.pointerId)
      dragRef.current = { startX: event.clientX, startY: event.clientY, zoom: zoomRef.current }
      onDragStart(projectId)
    },
    [onDragStart],
  )

  const moveDrag = useCallback(
    (event) => {
      const drag = dragRef.current
      if (!drag) return
      // Screen pixels -> flow units, so the group tracks the cursor at any zoom.
      onDrag((event.clientX - drag.startX) / drag.zoom, (event.clientY - drag.startY) / drag.zoom)
    },
    [onDrag],
  )

  const endDrag = useCallback(
    (event) => {
      if (!dragRef.current) return
      dragRef.current = null
      event.currentTarget.releasePointerCapture?.(event.pointerId)
      onDragEnd()
    },
    [onDragEnd],
  )

  // Held as elements rather than rebuilt inline: a pan re-renders this component
  // with identical hulls, and returning the same elements lets React skip them.
  const hulls = useMemo(
    () =>
      boxes.map(({ project, left, top, right, bottom }) => (
        <div
          key={project.id}
          className={`hull hull--${project.color} ${project.id === selectedProjectId ? 'is-selected' : ''}`}
          style={{ left, top, width: right - left, height: bottom - top }}
        />
      )),
    [boxes, selectedProjectId],
  )

  const labels = useMemo(
    () =>
      boxes.map(({ project, count, left, top }) => (
        <span
          key={project.id}
          className={`hull__label hull--${project.color}`}
          style={{ left: left + 12, top: top + 4 }}
          title={`Drag to move all ${count} tasks in “${project.name}”`}
          onPointerDown={(e) => startDrag(e, project.id)}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true">
            <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" />
            <circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" />
            <circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
          </svg>
          {project.name}
          <em>{count}</em>
        </span>
      )),
    [boxes, startDrag, moveDrag, endDrag],
  )

  if (boxes.length === 0) return null

  return (
    <>
      <div className="project-layer" style={viewport}>{hulls}</div>
      <div className="project-labels" style={viewport}>{labels}</div>
    </>
  )
}

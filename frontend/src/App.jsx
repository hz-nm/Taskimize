import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  ReactFlowProvider,
  SelectionMode,
  applyNodeChanges,
  useReactFlow,
} from 'reactflow'

import { api } from './api'
import { useTheme } from './theme'
import { useCanvasGestures } from './useCanvasGestures'
import { layoutGraph } from './layout'
import Sidebar from './components/Sidebar'
import TaskNode from './components/TaskNode'
import TaskPanel from './components/TaskPanel'
import LinkTypePrompt from './components/LinkTypePrompt'
import FlowEdge from './components/FlowEdge'
import ProjectLayer from './components/ProjectLayer'
import SelectionBar from './components/SelectionBar'
import UndoToast from './components/UndoToast'

const nodeTypes = { task: TaskNode }
const edgeTypes = { flow: FlowEdge }

// The gradient itself lives in FlowEdge; arrowheads are separate SVG markers that
// can't take a gradient fill, so they use the gradient's bright end colour.
const ARROW_COLORS = {
  light: { next: '#14b8a6', blocked_by: '#f0a93b', grid: '#dcdfe6' },
  dark: { next: '#5eead4', blocked_by: '#f5bc5c', grid: '#2e2e37' },
}

const MIN_ZOOM = 0.2
const MAX_ZOOM = 2.5

// Roughly the rendered card size, used to centre a new node on the cursor.
const NODE_W = 218
const NODE_H = 92

function Board() {
  const [tasks, setTasks] = useState([])
  const [links, setLinks] = useState([])
  const [projects, setProjects] = useState([])
  const [nodes, setNodes] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [selectedNodeIds, setSelectedNodeIds] = useState([])
  const [pendingConnection, setPendingConnection] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  // A single-slot undo: { label, run }. Deliberately not a stack — undo here is
  // an "oops" affordance for the action just taken, not an edit history.
  const [undoAction, setUndoAction] = useState(null)

  const { theme, toggle: toggleTheme } = useTheme()
  const { setCenter, getNode, fitView, screenToFlowPosition } = useReactFlow()
  const saveTimers = useRef(new Map())

  const canvasRef = useRef(null)
  // Last pointer position over the canvas, in screen coordinates. Typing in the
  // sidebar necessarily moves the mouse off the canvas, so the *last* place the
  // cursor was is the position the user actually meant.
  const pointerRef = useRef(null)

  useCanvasGestures(canvasRef, { minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM })

  const report = useCallback((err) => setError(err?.message || String(err)), [])

  const refresh = useCallback(async () => {
    try {
      const [nextTasks, nextLinks, nextProjects] = await Promise.all([
        api.listTasks(),
        api.listEdges(),
        api.listProjects(),
      ])
      setTasks(nextTasks)
      setLinks(nextLinks)
      setProjects(nextProjects)
      setError(null)
    } catch (err) {
      report(err)
    } finally {
      setLoading(false)
    }
  }, [report])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Flush any pending position saves if the tab goes away mid-debounce.
  useEffect(() => {
    const timers = saveTimers.current
    return () => timers.forEach((timer) => clearTimeout(timer))
  }, [])

  // Rebuild canvas nodes whenever task data changes. Dragging and marquee
  // selection only mutate React Flow's own node state, so both are carried over
  // rather than recomputed — otherwise a background refresh would drop them.
  useEffect(() => {
    setNodes((current) => {
      const previous = new Map(current.map((n) => [n.id, n]))
      return tasks.map((task) => {
        const prior = previous.get(task.id)
        return {
          id: task.id,
          type: 'task',
          position: prior?.position ?? { x: task.position_x, y: task.position_y },
          selected: prior?.selected ?? false,
          data: { task, focused: task.id === selectedId },
        }
      })
    })
  }, [tasks, selectedId])

  const flowEdges = useMemo(() => {
    const arrows = ARROW_COLORS[theme] ?? ARROW_COLORS.light
    return links.map((link) => ({
      id: link.id,
      source: link.source_task_id,
      target: link.target_task_id,
      type: 'flow',
      data: { edge_type: link.edge_type, theme },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: arrows[link.edge_type],
        width: 15,
        height: 15,
      },
    }))
  }, [links, theme])

  const savePosition = useCallback(
    (id, position) => {
      const timers = saveTimers.current
      clearTimeout(timers.get(id))
      timers.set(
        id,
        setTimeout(async () => {
          timers.delete(id)
          try {
            await api.updateTask(id, { position_x: position.x, position_y: position.y })
            setTasks((prev) =>
              prev.map((t) => (t.id === id ? { ...t, position_x: position.x, position_y: position.y } : t)),
            )
          } catch (err) {
            report(err)
          }
        }, 400),
      )
    },
    [report],
  )

  const onNodesChange = useCallback((changes) => setNodes((current) => applyNodeChanges(changes, current)), [])

  const onNodeDragStop = useCallback((_event, node) => savePosition(node.id, node.position), [savePosition])

  /**
   * Where a newly added task should land: centred on the cursor's last canvas
   * position, falling back to the middle of the current view. If that spot is
   * already occupied, cascade slightly so rapid entries don't stack into one pile.
   */
  const spawnPosition = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect()
    const screen = pointerRef.current ??
      (rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: 0, y: 0 })

    const point = screenToFlowPosition(screen)
    let x = point.x - NODE_W / 2
    let y = point.y - NODE_H / 2

    const taken = (px, py) =>
      tasks.some((t) => Math.abs(t.position_x - px) < 24 && Math.abs(t.position_y - py) < 24)

    for (let i = 0; i < 40 && taken(x, y); i += 1) {
      x += 28
      y += 28
    }
    return { x, y }
  }, [tasks, screenToFlowPosition])

  const addTask = useCallback(
    async (title) => {
      try {
        const position = spawnPosition()
        const created = await api.createTask({ title, position_x: position.x, position_y: position.y })
        setTasks((prev) => [...prev, created])
        setSelectedId(created.id)
        await refresh()
      } catch (err) {
        report(err)
      }
    },
    [spawnPosition, refresh, report],
  )

  const patchTask = useCallback(
    async (id, patch) => {
      // Optimistic so typing in the panel stays responsive; refresh reconciles ranks.
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
      try {
        await api.updateTask(id, patch)
        await refresh()
      } catch (err) {
        report(err)
        await refresh()
      }
    },
    [refresh, report],
  )

  const removeTask = useCallback(
    async (id) => {
      const doomed = tasks.find((t) => t.id === id)
      // Capture the links first — deleting the task cascades them away, and
      // they're what makes a restored task actually useful again.
      const doomedLinks = links.filter((l) => l.source_task_id === id || l.target_task_id === id)
      if (!doomed) return

      try {
        await api.deleteTask(id)
        setSelectedId((current) => (current === id ? null : current))
        await refresh()

        setUndoAction({
          label: `Deleted “${doomed.title}”`,
          run: async () => {
            // Restored under its original id, so the saved links still resolve.
            await api.createTask({
              id: doomed.id,
              title: doomed.title,
              description: doomed.description,
              status: doomed.status,
              what_i_did: doomed.what_i_did,
              what_worked: doomed.what_worked,
              what_didnt: doomed.what_didnt,
              priority_override: doomed.priority_override,
              position_x: doomed.position_x,
              position_y: doomed.position_y,
              project_id: doomed.project_id,
            })
            for (const link of doomedLinks) {
              // Best-effort: the task at the other end may have gone too.
              await api
                .createEdge({
                  source_task_id: link.source_task_id,
                  target_task_id: link.target_task_id,
                  edge_type: link.edge_type,
                })
                .catch(() => {})
            }
          },
        })
      } catch (err) {
        report(err)
      }
    },
    [tasks, links, refresh, report],
  )

  const removeLink = useCallback(
    async (id) => {
      try {
        await api.deleteEdge(id)
        await refresh()
      } catch (err) {
        report(err)
      }
    },
    [refresh, report],
  )

  /** Persist a batch of positions and mirror them into local state. */
  const savePositions = useCallback(
    async (positions) => {
      await Promise.all(
        positions.map(({ id, position }) =>
          api.updateTask(id, { position_x: position.x, position_y: position.y }),
        ),
      )
      const map = new Map(positions.map((p) => [p.id, p.position]))
      setNodes((current) =>
        current.map((n) => (map.has(n.id) ? { ...n, position: map.get(n.id) } : n)),
      )
      setTasks((current) =>
        current.map((t) =>
          map.has(t.id) ? { ...t, position_x: map.get(t.id).x, position_y: map.get(t.id).y } : t,
        ),
      )
    },
    [],
  )

  /** Arrange the board along the flow of work, with one-click undo. */
  const tidyLayout = useCallback(async () => {
    if (tasks.length === 0) return
    const before = tasks.map((t) => ({ id: t.id, position: { x: t.position_x, y: t.position_y } }))

    try {
      await savePositions(layoutGraph(tasks, links, projects))
      window.requestAnimationFrame(() => fitView({ padding: 0.2, duration: 500, maxZoom: 1 }))
      setUndoAction({
        label: 'Board tidied',
        run: async () => {
          await savePositions(before)
          window.requestAnimationFrame(() => fitView({ padding: 0.2, duration: 400, maxZoom: 1 }))
        },
      })
    } catch (err) {
      report(err)
    }
  }, [tasks, links, projects, savePositions, fitView, report])

  const runUndo = useCallback(async () => {
    const action = undoAction
    setUndoAction(null)
    if (!action) return
    try {
      await action.run()
      await refresh()
    } catch (err) {
      report(err)
    }
  }, [undoAction, refresh, report])

  // --- projects -----------------------------------------------------------

  const clearSelection = useCallback(() => {
    setNodes((current) => current.map((n) => (n.selected ? { ...n, selected: false } : n)))
    setSelectedNodeIds([])
  }, [])

  const groupSelection = useCallback(
    async (name) => {
      try {
        await api.createProject({ name, task_ids: selectedNodeIds })
        clearSelection()
        await refresh()
      } catch (err) {
        report(err)
      }
    },
    [selectedNodeIds, clearSelection, refresh, report],
  )

  const addSelectionToProject = useCallback(
    async (projectId) => {
      try {
        await api.addToProject(projectId, selectedNodeIds)
        clearSelection()
        await refresh()
      } catch (err) {
        report(err)
      }
    },
    [selectedNodeIds, clearSelection, refresh, report],
  )

  const renameProject = useCallback(
    async (id, name) => {
      try {
        await api.updateProject(id, { name })
        await refresh()
      } catch (err) {
        report(err)
      }
    },
    [refresh, report],
  )

  const removeProject = useCallback(
    async (id) => {
      try {
        await api.deleteProject(id)
        await refresh()
      } catch (err) {
        report(err)
      }
    },
    [refresh, report],
  )

  // Drawing an edge asks what kind of link it is before anything is persisted.
  const onConnect = useCallback((connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return
    setPendingConnection(connection)
  }, [])

  const confirmConnection = useCallback(
    async (edgeType) => {
      const connection = pendingConnection
      setPendingConnection(null)
      if (!connection) return
      try {
        await api.createEdge({
          source_task_id: connection.source,
          target_task_id: connection.target,
          edge_type: edgeType,
        })
        await refresh()
      } catch (err) {
        report(err)
      }
    },
    [pendingConnection, refresh, report],
  )

  const focusTask = useCallback(
    (id) => {
      setSelectedId(id)
      const node = getNode(id)
      if (node) setCenter(node.position.x + 110, node.position.y + 50, { zoom: 1.15, duration: 400 })
    },
    [getNode, setCenter],
  )

  /** Frame a whole project and mark its members as the active selection. */
  const focusProject = useCallback(
    (projectId) => {
      const memberIds = tasks.filter((t) => t.project_id === projectId).map((t) => t.id)
      if (memberIds.length === 0) return
      const members = new Set(memberIds)
      setNodes((current) => current.map((n) => ({ ...n, selected: members.has(n.id) })))
      setSelectedNodeIds(memberIds)
      fitView({ nodes: memberIds.map((id) => ({ id })), padding: 0.45, duration: 400, maxZoom: 1.2 })
    },
    [tasks, fitView],
  )

  const selectedTask = tasks.find((t) => t.id === selectedId) || null
  const selectedLinks = links.filter((l) => l.source_task_id === selectedId || l.target_task_id === selectedId)

  const pendingLabels = pendingConnection && {
    source: tasks.find((t) => t.id === pendingConnection.source)?.title,
    target: tasks.find((t) => t.id === pendingConnection.target)?.title,
  }

  return (
    <div className="app">
      <Sidebar
        tasks={tasks}
        selectedId={selectedId}
        loading={loading}
        theme={theme}
        onToggleTheme={toggleTheme}
        onAdd={addTask}
        onSelect={focusTask}
        projects={projects}
        onSelectProject={focusProject}
        onRenameProject={renameProject}
        onDeleteProject={removeProject}
      />

      <main
        className="canvas"
        ref={canvasRef}
        onPointerMove={(e) => {
          pointerRef.current = { x: e.clientX, y: e.clientY }
        }}
      >
        <ReactFlow
          nodes={nodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStop={onNodeDragStop}
          onNodeClick={(_e, node) => setSelectedId(node.id)}
          onPaneClick={() => {
            setSelectedId(null)
            setSelectedNodeIds([])
          }}
          onSelectionChange={({ nodes: picked }) => setSelectedNodeIds(picked.map((n) => n.id))}
          onConnect={onConnect}
          onEdgeDoubleClick={(_e, edge) => removeLink(edge.id)}
          edgeTypes={edgeTypes}
          // Left-drag on empty canvas draws a marquee (desktop-style); pan with
          // middle/right mouse or space-drag.
          selectionOnDrag
          selectionMode={SelectionMode.Partial}
          panOnDrag={[1, 2]}
          selectNodesOnDrag={false}
          connectionRadius={30}
          // Pan/zoom gestures are handled by useCanvasGestures: React Flow makes
          // scroll either pan or zoom globally, but a trackpad and a mouse want
          // opposite things from the same wheel event.
          zoomOnScroll={false}
          zoomOnPinch={false}
          panOnScroll={false}
          fitView
          fitViewOptions={{ padding: 0.35, maxZoom: 1 }}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} size={1} color={ARROW_COLORS[theme].grid} />
          <Controls showInteractive={false} position="bottom-right" />
          <ProjectLayer projects={projects} tasks={tasks} selectedProjectId={selectedTask?.project_id} />
        </ReactFlow>

        <div className="canvas-toolbar">
          <button
            type="button"
            className="canvas-toolbar__button"
            onClick={tidyLayout}
            disabled={tasks.length === 0}
            title="Arrange the board along the flow of work"
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"
                 strokeLinecap="round" aria-hidden="true">
              <path d="M4 6h6M4 12h10M4 18h7" />
              <path d="M17 9l3 3-3 3" />
            </svg>
            Tidy
          </button>
        </div>

        <div className="legend">
          <span><i className="swatch swatch--next" /> next step</span>
          <span><i className="swatch swatch--blocked" /> blocked by</span>
          <span className="legend__hint">two fingers to pan · pinch to zoom · drag empty space to select</span>
        </div>

        {selectedNodeIds.length > 1 && (
          <SelectionBar
            count={selectedNodeIds.length}
            projects={projects}
            onCreate={groupSelection}
            onAddTo={addSelectionToProject}
            onClear={clearSelection}
          />
        )}

        {tasks.length === 0 && !loading && (
          <div className="empty-canvas">
            <h2>Nothing on the board yet</h2>
              <p>Point at a spot on the canvas, then add a task from the sidebar — it lands there.</p>
          </div>
        )}
      </main>

      {selectedTask && (
        <TaskPanel
          key={selectedTask.id}
          task={selectedTask}
          tasks={tasks}
          links={selectedLinks}
          projects={projects}
          onChange={patchTask}
          onDelete={removeTask}
          onDeleteLink={removeLink}
          onClose={() => setSelectedId(null)}
          onFocusTask={focusTask}
        />
      )}

      {pendingConnection && (
        <LinkTypePrompt
          labels={pendingLabels}
          onPick={confirmConnection}
          onCancel={() => setPendingConnection(null)}
        />
      )}

      {undoAction && (
        <UndoToast action={undoAction} onUndo={runUndo} onDismiss={() => setUndoAction(null)} />
      )}

      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss">×</button>
        </div>
      )}
    </div>
  )
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Board />
    </ReactFlowProvider>
  )
}

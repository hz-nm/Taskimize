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

// Fields whose change can reorder `suggested_priority_rank` or flip a blocked
// flag — anywhere on the board, not just on the task being edited. Everything
// else a PATCH can touch is local to that one task, so its response is the whole
// truth and there is nothing to refetch.
const RANKING_FIELDS = ['status', 'priority_override']

/**
 * Fold a fresh server list into the one we hold, keeping the previous object for
 * any task that came back unchanged.
 *
 * Node `data` is keyed on task identity, which is what lets `memo` skip cards a
 * refresh didn't actually touch — so identity has to survive a refetch, or the
 * memo compares two structurally identical objects and re-renders all of them.
 */
function mergeTasks(previous, incoming) {
  const byId = new Map(previous.map((t) => [t.id, t]))
  return incoming.map((task) => {
    const prior = byId.get(task.id)
    return prior && JSON.stringify(prior) === JSON.stringify(task) ? prior : task
  })
}

const ALL = { tasks: true, edges: true, projects: true }

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
  // Positions move far more often than they need saving, so they collect here
  // and go out as one request when the dragging stops.
  const pendingPositions = useRef(new Map())
  const positionTimer = useRef(null)

  const canvasRef = useRef(null)
  // Last pointer position over the canvas, in screen coordinates. Typing in the
  // sidebar necessarily moves the mouse off the canvas, so the *last* place the
  // cursor was is the position the user actually meant.
  const pointerRef = useRef(null)

  useCanvasGestures(canvasRef, { minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM })

  const report = useCallback((err) => setError(err?.message || String(err)), [])

  /**
   * Refetch only the collections the last action could have invalidated.
   *
   * The three lists are independent: renaming a project can't move a rank, and
   * editing a description can't change who is blocked. Pulling all three on
   * every edit was most of the cost of typing.
   */
  const refresh = useCallback(
    async (parts = ALL) => {
      try {
        const [nextTasks, nextLinks, nextProjects] = await Promise.all([
          parts.tasks ? api.listTasks() : null,
          parts.edges ? api.listEdges() : null,
          parts.projects ? api.listProjects() : null,
        ])
        if (nextTasks) setTasks((prev) => mergeTasks(prev, nextTasks))
        if (nextLinks) setLinks(nextLinks)
        if (nextProjects) setProjects(nextProjects)
        setError(null)
      } catch (err) {
        report(err)
      } finally {
        setLoading(false)
      }
    },
    [report],
  )

  useEffect(() => {
    refresh()
  }, [refresh])

  // Drop any pending position save if the tab goes away mid-debounce.
  useEffect(() => () => clearTimeout(positionTimer.current), [])

  // Rebuild canvas nodes whenever task data changes. Dragging and marquee
  // selection only mutate React Flow's own node state, so both are carried over
  // rather than recomputed — otherwise a background refresh would drop them.
  //
  // Nodes whose task and focus are both unchanged are handed back *as the same
  // object*. TaskNode is memoised, and a fresh `data` on every rebuild defeated
  // that entirely: selecting a card used to re-render all of them.
  useEffect(() => {
    setNodes((current) => {
      const previous = new Map(current.map((n) => [n.id, n]))
      let changed = current.length !== tasks.length
      const next = tasks.map((task) => {
        const prior = previous.get(task.id)
        if (prior && prior.data.task === task && prior.data.focused === (task.id === selectedId)) {
          return prior
        }
        changed = true
        return {
          id: task.id,
          type: 'task',
          position: prior?.position ?? { x: task.position_x, y: task.position_y },
          selected: prior?.selected ?? false,
          data: { task, focused: task.id === selectedId },
        }
      })
      return changed ? next : current
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

  /** Persist a batch of positions and mirror them into local state. */
  const savePositions = useCallback(async (positions) => {
    await api.saveTaskPositions(
      positions.map(({ id, position }) => ({ id, position_x: position.x, position_y: position.y })),
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
  }, [])

  const flushPositions = useCallback(async () => {
    positionTimer.current = null
    const pending = [...pendingPositions.current.entries()].map(([id, position]) => ({ id, position }))
    pendingPositions.current.clear()
    if (pending.length === 0) return
    try {
      await savePositions(pending)
    } catch (err) {
      report(err)
    }
  }, [savePositions, report])

  // Dragging a selection moves every node in it; one debounce over the whole
  // group means one request, not one per node.
  const queuePositions = useCallback(
    (moved) => {
      moved.forEach(({ id, position }) => pendingPositions.current.set(id, { ...position }))
      clearTimeout(positionTimer.current)
      positionTimer.current = setTimeout(flushPositions, 400)
    },
    [flushPositions],
  )

  const onNodesChange = useCallback((changes) => setNodes((current) => applyNodeChanges(changes, current)), [])

  // Read through a ref so drag handlers always see the latest positions rather
  // than whatever was current when the callback was created.
  const nodesRef = useRef(nodes)
  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

  const onNodeDragStop = useCallback(
    (_event, node) => {
      // React Flow drags every selected node together but only reports the one
      // under the cursor — so save the whole group, or the rest snap back on
      // the next refresh.
      const current = nodesRef.current
      const dragged = current.find((n) => n.id === node.id)
      const moved = dragged?.selected ? current.filter((n) => n.selected) : [node]
      queuePositions(moved.map((n) => ({ id: n.id, position: n.position })))
    },
    [queuePositions],
  )

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
        // A new task takes a slot in the ordering, nudging everyone below it.
        await refresh({ tasks: true })
      } catch (err) {
        report(err)
      }
    },
    [spawnPosition, refresh, report],
  )

  const patchTask = useCallback(
    async (id, patch) => {
      // Optimistic so typing in the panel stays responsive.
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))

      const reranks = RANKING_FIELDS.some((field) => field in patch)
      const regroups = 'project_id' in patch
      try {
        const updated = await api.updateTask(id, patch)
        if (reranks || regroups) {
          // Board-wide effects: ranks shift, or a project gains and loses a member.
          await refresh({ tasks: true, projects: regroups })
        } else {
          // A title or a note. The PATCH response already is the new task.
          setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)))
        }
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
        await refresh({ tasks: true, edges: true })
      } catch (err) {
        report(err)
      }
    },
    [refresh, report],
  )

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

  // Positions of a project's members when a hull drag began, so every move is
  // computed from the start point rather than accumulating rounding drift.
  const projectDragRef = useRef(null)

  const beginProjectDrag = useCallback(
    (projectId) => {
      const memberIds = new Set(tasks.filter((t) => t.project_id === projectId).map((t) => t.id))
      projectDragRef.current = new Map(
        nodesRef.current.filter((n) => memberIds.has(n.id)).map((n) => [n.id, { ...n.position }]),
      )
      // Select the members too, so the move reads as "this whole group".
      setNodes((current) => current.map((n) => ({ ...n, selected: memberIds.has(n.id) })))
      setSelectedNodeIds([...memberIds])
    },
    [tasks],
  )

  const dragProjectBy = useCallback((dx, dy) => {
    const start = projectDragRef.current
    if (!start) return
    setNodes((current) =>
      current.map((n) => {
        const origin = start.get(n.id)
        return origin ? { ...n, position: { x: origin.x + dx, y: origin.y + dy } } : n
      }),
    )
  }, [])

  const endProjectDrag = useCallback(async () => {
    const start = projectDragRef.current
    projectDragRef.current = null
    if (!start) return

    const moved = nodesRef.current.filter((n) => start.has(n.id))
    // Skip the round-trip on a click that didn't actually move anything.
    const shifted = moved.filter((n) => {
      const origin = start.get(n.id)
      return Math.abs(origin.x - n.position.x) > 0.5 || Math.abs(origin.y - n.position.y) > 0.5
    })
    if (shifted.length === 0) return

    try {
      await savePositions(moved.map((n) => ({ id: n.id, position: n.position })))
    } catch (err) {
      report(err)
    }
  }, [savePositions, report])

  const clearSelection = useCallback(() => {
    setNodes((current) => current.map((n) => (n.selected ? { ...n, selected: false } : n)))
    setSelectedNodeIds([])
  }, [])

  const groupSelection = useCallback(
    async (name) => {
      try {
        await api.createProject({ name, task_ids: selectedNodeIds })
        clearSelection()
        await refresh({ tasks: true, projects: true })
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
        await refresh({ tasks: true, projects: true })
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
        await refresh({ projects: true })
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
        // Members survive the project, but come back without a project_id.
        await refresh({ tasks: true, projects: true })
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
        await refresh({ tasks: true, edges: true })
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

  /**
   * Frame a project and select its members. Selecting is what makes the group
   * movable: React Flow drags every selected node together, so dragging any one
   * member now carries the whole project with it.
   */
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
          <ProjectLayer
            projects={projects}
            tasks={tasks}
            selectedProjectId={selectedTask?.project_id}
            onDragStart={beginProjectDrag}
            onDrag={dragProjectBy}
            onDragEnd={endProjectDrag}
          />
        </ReactFlow>

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

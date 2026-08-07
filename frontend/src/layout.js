import dagre from '@dagrejs/dagre'

const NODE_W = 218
const NODE_H = 108

/**
 * Lay the graph out left-to-right along the direction work actually flows.
 *
 * `next` edges point forward already (A → B means B follows A). `blocked_by` runs
 * the other way — A ⇢ B means A waits on B — so it's reversed for layout, putting
 * blockers to the left of what they hold up. The result reads as a timeline.
 *
 * Disconnected clusters are laid out too: dagre packs each component separately,
 * then they're stacked vertically so they don't overlap.
 */
export function layoutGraph(tasks, links, projects = []) {
  const graph = new dagre.graphlib.Graph({ compound: true })
  graph.setGraph({
    rankdir: 'LR',
    ranksep: 90,
    nodesep: 34,
    marginx: 40,
    marginy: 40,
  })
  graph.setDefaultEdgeLabel(() => ({}))

  const ids = new Set(tasks.map((t) => t.id))
  for (const task of tasks) {
    graph.setNode(task.id, { width: NODE_W, height: NODE_H })
  }

  // Grouped tasks become children of a cluster node, which keeps a project's
  // members physically together instead of scattered along the flow.
  const grouped = new Set(tasks.filter((t) => t.project_id).map((t) => t.project_id))
  for (const project of projects) {
    if (!grouped.has(project.id)) continue
    graph.setNode(`project:${project.id}`, {})
  }
  for (const task of tasks) {
    if (task.project_id && grouped.has(task.project_id)) {
      graph.setParent(task.id, `project:${task.project_id}`)
    }
  }

  for (const link of links) {
    if (!ids.has(link.source_task_id) || !ids.has(link.target_task_id)) continue
    if (link.edge_type === 'blocked_by') {
      graph.setEdge(link.target_task_id, link.source_task_id)
    } else {
      graph.setEdge(link.source_task_id, link.target_task_id)
    }
  }

  dagre.layout(graph)

  // dagre reports centres; React Flow positions by top-left corner.
  return tasks.map((task) => {
    const node = graph.node(task.id)
    return {
      id: task.id,
      position: node
        ? { x: Math.round(node.x - NODE_W / 2), y: Math.round(node.y - NODE_H / 2) }
        : { x: task.position_x, y: task.position_y },
    }
  })
}

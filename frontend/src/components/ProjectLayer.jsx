import { useStore } from 'reactflow'

const PADDING = 26
const HEADER = 26

/**
 * Draws a rounded hull behind each project, sized to the bounding box of its
 * member nodes.
 *
 * It reads live node geometry straight from React Flow's store rather than from
 * task data, so a hull resizes continuously while you drag a member around
 * instead of snapping after the save lands.
 *
 * Hulls are deliberately non-interactive: they sit under the pane that captures
 * marquee drags, so making them clickable would only create dead zones where
 * box-selection mysteriously stopped working. Project actions live in the sidebar.
 */
export default function ProjectLayer({ projects, tasks, selectedProjectId }) {
  const transform = useStore((s) => s.transform)
  const nodeInternals = useStore((s) => s.nodeInternals)

  if (projects.length === 0) return null

  const membersByProject = new Map(projects.map((p) => [p.id, []]))
  for (const task of tasks) {
    if (!task.project_id) continue
    const node = nodeInternals.get(task.id)
    const bucket = membersByProject.get(task.project_id)
    // A node is missing width until React Flow has measured it on first paint.
    if (node && bucket && node.width) bucket.push(node)
  }

  const [tx, ty, zoom] = transform

  return (
    <div className="project-layer" style={{ transform: `translate(${tx}px, ${ty}px) scale(${zoom})` }}>
      {projects.map((project) => {
        const members = membersByProject.get(project.id) ?? []
        if (members.length === 0) return null

        const left = Math.min(...members.map((n) => n.positionAbsolute.x)) - PADDING
        const top = Math.min(...members.map((n) => n.positionAbsolute.y)) - PADDING - HEADER
        const right = Math.max(...members.map((n) => n.positionAbsolute.x + n.width)) + PADDING
        const bottom = Math.max(...members.map((n) => n.positionAbsolute.y + (n.height ?? 90))) + PADDING

        return (
          <div
            key={project.id}
            className={`hull hull--${project.color} ${project.id === selectedProjectId ? 'is-selected' : ''}`}
            style={{ left, top, width: right - left, height: bottom - top }}
          >
            <span className="hull__label">
              {project.name}
              <em>{members.length}</em>
            </span>
          </div>
        )
      })}
    </div>
  )
}

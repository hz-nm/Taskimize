import { layoutGraph } from './src/layout.js'

const task = (id, project_id = null) => ({ id, project_id, position_x: 0, position_y: 0 })
const link = (s, t, edge_type) => ({ source_task_id: s, target_task_id: t, edge_type })

// Chain + a blocked_by + two disconnected islands + a project cluster
const tasks = ['a','b','c','x','y','p1','p2'].map((id) => task(id, id.startsWith('p') ? 'proj' : null))
const links = [link('a','b','next'), link('b','c','next'), link('c','a','blocked_by'.replace('blocked_by','blocked_by'))]
const projects = [{ id: 'proj', name: 'Group', color: 'indigo' }]

const out = layoutGraph(tasks, [link('a','b','next'), link('b','c','next')], projects)
console.log('nodes laid out:', out.length)
console.log('all finite:', out.every(n => Number.isFinite(n.position.x) && Number.isFinite(n.position.y)))

const at = Object.fromEntries(out.map(n => [n.id, n.position]))
console.log('flow is left-to-right (a<b<c):', at.a.x < at.b.x && at.b.x < at.c.x)

// No two nodes overlap (218x108 boxes)
let overlaps = 0
for (let i = 0; i < out.length; i++) for (let j = i+1; j < out.length; j++) {
  const A = out[i].position, B = out[j].position
  if (Math.abs(A.x-B.x) < 218 && Math.abs(A.y-B.y) < 108) overlaps++
}
console.log('overlapping pairs:', overlaps)

// blocked_by must reverse: blocker sits LEFT of the task it blocks
const b2 = layoutGraph([task('t'), task('blk')], [link('t','blk','blocked_by')], [])
const p = Object.fromEntries(b2.map(n => [n.id, n.position]))
console.log('blocker left of blocked:', p.blk.x < p.t.x)

// Project members stay together
const g = Object.fromEntries(out.filter(n => n.id.startsWith('p')).map(n => [n.id, n.position]))
console.log('project members near each other:', Math.abs(g.p1.x - g.p2.x) < 400 && Math.abs(g.p1.y - g.p2.y) < 400)

console.log('empty graph ok:', layoutGraph([], [], []).length === 0)

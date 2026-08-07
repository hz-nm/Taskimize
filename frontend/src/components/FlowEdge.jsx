import { BaseEdge, getSmoothStepPath } from 'reactflow'

/**
 * Both link types are drawn with a directional gradient: the stroke runs from a
 * deep shade at the source to a bright one at the target, so you can read which
 * way work flows without hunting for the arrowhead.
 *
 * The gradient is `userSpaceOnUse` and anchored to the real endpoint coordinates,
 * so it stays aligned with the line while nodes are dragged.
 */
/*
 * `next` is the positive relationship — work flowing forward — so it runs
 * teal→emerald rather than anything in the red family, which reads as "stopped".
 * Warm amber is reserved for `blocked_by`, the one link type that *is* a problem.
 */
const RAMPS = {
  light: {
    next: ['#0f766e', '#14b8a6'],
    blocked_by: ['#a16207', '#f0a93b'],
  },
  dark: {
    next: ['#0d9488', '#5eead4'],
    blocked_by: ['#a86a1c', '#f5bc5c'],
  },
}

export default function FlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
  selected,
}) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 16,
  })

  const type = data?.edge_type === 'blocked_by' ? 'blocked_by' : 'next'
  const [from, to] = (RAMPS[data?.theme] ?? RAMPS.light)[type]
  const gradientId = `edge-gradient-${id}`

  return (
    <>
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1={sourceX}
          y1={sourceY}
          x2={targetX}
          y2={targetY}
        >
          <stop offset="0%" stopColor={from} />
          <stop offset="100%" stopColor={to} />
        </linearGradient>
      </defs>

      <BaseEdge
        path={path}
        markerEnd={markerEnd}
        interactionWidth={22}
        style={{
          stroke: `url(#${gradientId})`,
          strokeWidth: selected ? 3 : 2,
          strokeDasharray: type === 'blocked_by' ? '7 6' : undefined,
          strokeLinecap: 'round',
        }}
      />
    </>
  )
}

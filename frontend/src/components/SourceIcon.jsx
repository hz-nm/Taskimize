const PATHS = {
  attachment: (
    <path d="M17 7.5v9a4 4 0 0 1-8 0V6a2.5 2.5 0 0 1 5 0v9a1 1 0 0 1-2 0v-8" />
  ),
  link: (
    <>
      <path d="M9 15 15 9" />
      <path d="M10.5 6.5 12 5a3.5 3.5 0 0 1 5 5l-1.5 1.5" />
      <path d="M13.5 17.5 12 19a3.5 3.5 0 0 1-5-5l1.5-1.5" />
    </>
  ),
  note: (
    <>
      <path d="M6 3h9l3 3v15H6z" />
      <path d="M9 10h6M9 14h6M9 18h3" />
    </>
  ),
  file: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
    </>
  ),
  local_path: (
    <>
      <path d="M3 7h6l2 2h10v10H3z" />
    </>
  ),
}

/** Small type-specific glyph for a source, drawn the same way as every other
 * icon in this app: a hand-written inline SVG rather than a library. */
export default function SourceIcon({ type, size = 12 }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[type] ?? PATHS.attachment}
    </svg>
  )
}

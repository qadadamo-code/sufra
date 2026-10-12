import React from 'react'

const paths: Record<string, React.ReactNode> = {
  square: <rect x="6" y="6" width="12" height="12" rx="2" />,
  rect: <rect x="3" y="8" width="18" height="8" rx="2" />,
  round: <circle cx="12" cy="12" r="7" />,
  oval: <ellipse cx="12" cy="12" rx="9" ry="5.5" />,
  booth: (
    <>
      <rect x="5" y="9" width="14" height="6" rx="1.5" />
      <path d="M5 5.5h14M5 18.5h14" />
    </>
  ),
  bar: (
    <>
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <circle cx="7" cy="16.5" r="1.6" />
      <circle cx="12" cy="16.5" r="1.6" />
      <circle cx="17" cy="16.5" r="1.6" />
    </>
  ),
  wall: <rect x="3" y="10" width="18" height="4" />,
  pillar: <rect x="8" y="8" width="8" height="8" />,
  door: <path d="M5 19V5M5 5a14 14 0 0 1 14 14M3 19h18" />,
  counter: <rect x="3" y="9" width="18" height="6" rx="3" />,
  plant: <path d="M12 20v-8M12 12c-4 0-6-3-6-6 3 0 6 2 6 6Zm0 0c4 0 6-3 6-6-3 0-6 2-6 6Z" />,
  window: <path d="M3 12h18M3 9h18M3 15h18" />,
  undo: <path d="M9 7 4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2" />,
  redo: <path d="m15 7 5 5-5 5M20 12H9a5 5 0 0 0 0 10h2" />,
  fit: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  rotate: <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
    </>
  ),
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  unlink: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7M4 4l16 16" />,
  magnet: <path d="M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4ZM6 8h4M14 8h4" />,
  multi: (
    <>
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <rect x="13" y="13" width="8" height="8" rx="2" />
      <path d="M13 7h5v4M11 17H6v-4" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 7.5-2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" />
    </>
  ),
  alignTop: <path d="M4 4h16M8 8v10M16 8v6" />,
  alignMid: <path d="M4 12h16M8 6v12M16 8v8" />,
  spread: <path d="M4 4v16M20 4v16M10 8v8M14 8v8" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  people: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20a6 6 0 0 1 12 0M16 11a3 3 0 1 0 0-6M21 20a6 6 0 0 0-4-5.6" />
    </>
  ),
  warn: <path d="M12 4 2 20h20L12 4ZM12 10v4M12 17v.5" />,
  check: <path d="m5 12 5 5 9-10" />,
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M9 3v4M15 3v4" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  cake: <path d="M4 20h16M5 20v-6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6M5 15.5c2 1.5 4.5 1.5 7 0s5-1.5 7 0M12 12V8M12 5.5v-.5" />,
  reset: <path d="M4 12a8 8 0 1 0 2.3-5.7M4 4v5h5" />,
}

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name] ?? null}
    </svg>
  )
}

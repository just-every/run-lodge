// The workspace's line icons: 24-unit strokes in the current colour, always beside a visible label.
const PATHS = {
  overview: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  vacancies: 'M4 8h16v11H4zM9 8V5.5h6V8M4 13h16',
  applications: 'M4 4h4.5v16H4zM10 4h4.5v11H10zM16 4h4v7h-4z',
  candidates: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.5a3.3 3.3 0 0 1 0 6.4M18 14.6c1.9.7 3.1 2.5 3.5 5.4',
  approvals: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12.3l2.8 2.8L16.2 9.6',
  proposals: 'M8 4h8l1 2h2v15H5V6h2zM8 4v3h8V4M9 12h6M9 16h4',
  retention: 'M4 5h16v4H4zM5.5 9v10h13V9M10 13h4',
  movein: 'M12 3v11M7.5 9.5 12 14l4.5-4.5M4 15v5h16v-5',
  people: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 13.5l1.6 1-1.5 2.6-1.8-.5a7 7 0 0 1-1.7 1L15.5 19h-3M4.6 10.5 3 9.5l1.5-2.6 1.8.5a7 7 0 0 1 1.7-1L8.5 5h3',
  audit: 'M12 21a9 9 0 1 0-9-9M3 4v5h5M12 7v5l3 2',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  search: 'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM16 16l5 5',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3.5v4M16 3.5v4',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
  pin: 'M12 21s7-6.2 7-11.5a7 7 0 1 0-14 0C5 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  dollar: 'M12 3v18M16.5 7.5c-.6-1.6-2.4-2.5-4.5-2.5-2.6 0-4.3 1.3-4.3 3.3 0 4.6 9 2.4 9 7.2 0 2-1.9 3.5-4.7 3.5-2.4 0-4.2-1-4.8-2.8',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2',
  alert: 'M4 6h16v14H4zM4 10h16M8 3.5v4M16 3.5v4M10 13.5l4 4M14 13.5l-4 4',
  mail: 'M3.5 5.5h17v13h-17zM4 6l8 6.5L20 6',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3.5 2',
  folder: 'M3.5 6.5h6l2 2h9v10h-17z',
  agent: 'M12 3v3M5 9h14v10H5zM9 13.5h.01M15 13.5h.01M9.5 16.5h5M2.5 13v3M21.5 13v3',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <svg className="icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false"><path d={PATHS[name]} /></svg>
}

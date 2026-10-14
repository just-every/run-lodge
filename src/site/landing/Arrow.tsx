export function Arrow({ down = false }: { down?: boolean }) {
  return <svg className="arrow" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {down ? <path d="M12 4v16M6 14l6 6 6-6" /> : <path d="M4 12h16M14 6l6 6-6 6" />}
  </svg>
}

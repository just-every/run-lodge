// Engraved line icons for the "Also included" tiles.
const paths = {
  page: <><path d="M8 4h11l6 6v18H8z" /><path d="M19 4v6h6M12 16h9M12 20h9M12 24h6" /></>,
  calendar: <><rect x="5" y="7" width="22" height="20" rx="2" /><path d="M5 13h22M11 4v6M21 4v6" /><path d="M10 18h2M15 18h2M20 18h2M10 22h2M15 22h2" /></>,
  mail: <><rect x="4" y="8" width="24" height="17" rx="2" /><path d="m5 9 11 9 11-9" /></>,
  copies: <><rect x="10" y="10" width="16" height="17" rx="2" /><path d="M6 22V7a2 2 0 0 1 2-2h12" /></>,
  records: <><rect x="7" y="4" width="18" height="24" rx="2" /><path d="M11 10h10M11 15h10M11 20h10" /></>,
  agent: <><circle cx="9" cy="16" r="3.5" /><circle cx="23" cy="8" r="3" /><circle cx="23" cy="24" r="3" /><path d="M12.5 16H17M17 8v16M17 8h3M17 24h3" /></>,
}
export type IconName = keyof typeof paths

export function Icon({ name }: { name: IconName }) {
  return <svg className="icon" viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

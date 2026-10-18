import type { ReactNode } from 'react'

/**
 * A line of "·"-separated facts. Each fact stays whole on its line and carries its separator at its end, so a
 * wrapped line never starts with "·" and a name, date or pay range never splits. On a phone the hero strip lets a
 * fact wrap inside itself, so the data keeps names and times together with no-break spaces.
 */
export function Facts({ items, className }: { items: ReactNode[]; className?: string }) {
  return <span className={className}>{items.map((item, i) => <span key={i}><span className="nowrap">{item}{i < items.length - 1 ? '\u00a0·' : ''}</span>{i < items.length - 1 ? ' ' : ''}</span>)}</span>
}

export type Tone = 'green' | 'amber' | 'red' | 'sky' | 'grey' | 'ink'

export function Chip({ tone = 'green', icon, children }: { tone?: Tone; icon?: 'check' | 'clock' | 'stop'; children: ReactNode }) {
  return <span className={`chip chip-${tone}`}>{icon === 'check' && <Check />}{icon === 'clock' && <Clock />}{icon === 'stop' && <Stop />}{children}</span>
}

export function Dot({ tone = 'green' }: { tone?: Tone }) {
  return <span className={`dot dot-${tone}`} aria-hidden="true" />
}

/** A filled check disc (green by default), as on the desk's cards. */
export function Check({ tone = 'green' }: { tone?: Tone }) {
  return <svg className={`check check-${tone}`} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" /><path d="M7 12.4l3.3 3.3L17.2 8.8" /></svg>
}

export function Clock() {
  return <svg className="icon-clock" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="9.5" /><path d="M12 7v5.2l3.4 2.2" /></svg>
}

export function Stop() {
  return <svg className="icon-stop" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4"><circle cx="12" cy="12" r="9.5" /><path d="M5.4 5.4l13.2 13.2" /></svg>
}

export function Avatar({ initials, tone = 'sky' }: { initials: string; tone?: 'sky' | 'rose' | 'violet' | 'grey' | 'green' }) {
  return <span className={`avatar avatar-${tone}`} aria-hidden="true">{initials}</span>
}

/** A section's eyebrow, heading and subhead. */
export function Copy({ id, eyebrow, title, sub }: { id: string; eyebrow: string; title: ReactNode; sub: ReactNode }) {
  return <div className="copy">
    <p className="eyebrow">{eyebrow}</p>
    <h2 id={id}>{title}</h2>
    <p className="sub">{sub}</p>
  </div>
}

export function Section({ id, className = '', children }: { id: string; className?: string; children: ReactNode }) {
  return <section id={id} className={`band ${className}`.trim()} aria-labelledby={`${id}-title`}>
    <div className="site-wrap">{children}</div>
  </section>
}

/** A painted plate as AVIF with a WebP fallback at three widths. */
export function Plate({ name, widths, sizes, alt = '', width, height, className, eager = false }: { name: string; widths: number[]; sizes: string; alt?: string; width: number; height: number; className?: string; eager?: boolean }) {
  const set = (ext: string) => widths.map(w => `/site/${name}-${w}.${ext} ${w}w`).join(', ')
  return <picture className={className}>
    <source type="image/avif" srcSet={set('avif')} sizes={sizes} />
    <img src={`/site/${name}-${widths[widths.length - 1]}.webp`} srcSet={set('webp')} sizes={sizes} alt={alt} width={width} height={height} loading={eager ? 'eager' : 'lazy'} decoding="async" fetchPriority={eager ? 'high' : undefined} />
  </picture>
}

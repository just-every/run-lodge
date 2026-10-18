import { links } from './links'

/** Run Lodge (the red pill to /run), Try the demo and Read the docs. */
export function Actions({ className = '' }: { className?: string }) {
  return <p className={`site-actions ${className}`.trim()}>
    <a className="site-pill" href={links.run}>Run Lodge <Arrow /></a>
    <a className="site-link" href={links.demo}>Try the demo</a>
    <a className="site-link" href={links.docs}>Read the docs</a>
  </p>
}

export function Arrow() {
  return <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 10h12.5M11 5l5 5-5 5" /></svg>
}

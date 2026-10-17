import { Lockup } from './Lockup'
import { links } from './links'

export function SiteHeader({ current }: { current?: 'docs' }) {
  return <header className="site-bar">
    <Lockup />
    <nav aria-label="Site">
      <a href={links.docs} aria-current={current === 'docs' ? 'page' : undefined}>Docs</a>
      <a href={links.contract}>Contract</a>
      <a className="wide-only" href={links.source}>Source</a>
    </nav>
  </header>
}

import { Lockup } from './Lockup'
import { links } from './links'

/** The bar on every run-site page: the lockup at left, Docs and Source at right. */
export function SiteHeader({ current, overlay = false }: { current?: 'docs'; overlay?: boolean }) {
  return <header className={overlay ? 'site-header overlay' : 'site-header'}>
    <div className="site-wrap site-header-row">
      <Lockup />
      <nav aria-label="Site">
        <a href={links.docs} aria-current={current === 'docs' ? 'page' : undefined}>Docs</a>
        <a href={links.source}>Source</a>
      </nav>
    </div>
  </header>
}

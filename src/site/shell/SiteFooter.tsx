import { Lockup } from './Lockup'
import { links } from './links'

export function SiteFooter() {
  return <footer className="site-foot">
    <Lockup />
    <span className="licence">MIT licensed</span>
    <nav aria-label="Footer"><a href={links.docs}>Docs</a><a href={links.source}>Source</a></nav>
  </footer>
}

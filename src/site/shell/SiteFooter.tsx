import { Lockup } from './Lockup'
import { links } from './links'

/** The footer strip: the lockup and what Lodge is, then Docs, Contract, Source and the licence. */
export function SiteFooter() {
  return <footer className="site-footer">
    <div className="site-wrap site-footer-row">
      <p className="site-footer-name"><Lockup /><span>Free, open source applicant tracking</span></p>
      <nav aria-label="Footer"><a href={links.docs}>Docs</a><a href={links.contract}>Contract</a><a href={links.source}>Source</a><a href={links.licence}>MIT licensed</a></nav>
    </div>
  </footer>
}

import '../styles/site.css'
import '../styles/docs.css'
import { SiteFooter } from '../shell/SiteFooter'
import { SiteHeader } from '../shell/SiteHeader'
import { docsSections, plainText } from './content'
import { DocsNav } from './DocsNav'

/** /docs: every guide by section, each with its first line as plain text (a card is one link, so no inline markup or nested links). */
export function DocsIndex() {
  return <div className="site docs">
    <SiteHeader current="docs" />
    <div className="docs-band">
      <div className="site-wrap">
        <p className="eyebrow">Docs</p>
        <h1 id="docs-title">Run Lodge and hire with it.</h1>
        <p className="docs-lead">How to start Lodge on your computer, open a vacancy, run interviews and scorecards, record offers and keep your records.</p>
      </div>
    </div>
    <main className="site-wrap docs-layout no-toc">
      <DocsNav />
      <article className="docs-article" aria-labelledby="docs-title">
        {docsSections.map(section => <section key={section.title} className="docs-index-group" aria-label={section.title}>
          <h2>{section.title}</h2>
          <ul className="docs-cards">{section.pages.map(page => <li key={page.slug}><a href={`/docs/${page.slug}`}><strong className="docs-card-title">{plainText(page.title)}</strong><span className="docs-card-lead">{plainText(page.lead)}</span></a></li>)}</ul>
        </section>)}
      </article>
    </main>
    <SiteFooter />
  </div>
}

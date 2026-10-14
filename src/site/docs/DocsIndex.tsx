import '../site.css'
import './docs.css'
import { SiteFooter } from '../shell/SiteFooter'
import { SiteHeader } from '../shell/SiteHeader'
import { docsSections } from './content'
import { DocsNav } from './DocsNav'

/** /docs: every guide by section, each with its first line. */
export function DocsIndex() {
  return <div className="site docs">
    <SiteHeader current="docs" />
    <main className="docs-layout">
      <DocsNav />
      <article className="docs-article" aria-labelledby="docs-title">
        <p className="eyebrow">Docs</p>
        <h1 id="docs-title">Lodge docs</h1>
        <p className="docs-lead">How to run Lodge, hire with it and keep your records.</p>
        {docsSections.map(section => <section key={section.title} className="docs-index-group" aria-label={section.title}>
          <h2>{section.title}</h2>
          <ul className="docs-cards">{section.pages.map(page => <li key={page.slug}><a href={`/docs/${page.slug}`}><strong dangerouslySetInnerHTML={{ __html: page.title }} /><span dangerouslySetInnerHTML={{ __html: page.lead }} /></a></li>)}</ul>
        </section>)}
      </article>
    </main>
    <SiteFooter />
  </div>
}

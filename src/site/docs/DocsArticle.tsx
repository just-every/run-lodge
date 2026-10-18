import '../styles/site.css'
import '../styles/docs.css'
import { SiteFooter } from '../shell/SiteFooter'
import { SiteHeader } from '../shell/SiteHeader'
import { docsPages } from './content'
import { DocsNav } from './DocsNav'

/** One guide: the title on the sky band, then the menu, the article from its Markdown, "On this page" and the next guide. */
export function DocsArticle({ slug }: { slug: string }) {
  const index = docsPages.findIndex(page => page.slug === slug), page = docsPages[index], next = docsPages[index + 1]
  const lead = page.html.match(/^<p class="docs-lead">([\s\S]*?)<\/p>/)
  const body = lead ? page.html.slice(lead[0].length) : page.html
  return <div className="site docs">
    <SiteHeader current="docs" />
    <div className="docs-band">
      <div className="site-wrap">
        <p className="eyebrow">{page.eyebrow}</p>
        <h1 id="docs-title" dangerouslySetInnerHTML={{ __html: page.title }} />
        {lead && <p className="docs-lead" dangerouslySetInnerHTML={{ __html: lead[1] }} />}
      </div>
    </div>
    <main className={page.toc.length > 0 ? 'site-wrap docs-layout' : 'site-wrap docs-layout no-toc'}>
      <DocsNav current={slug} />
      <article className="docs-article" aria-labelledby="docs-title">
        <div className="docs-body" dangerouslySetInnerHTML={{ __html: body }} />
        {next && <p className="docs-next"><a className="next-pill" href={`/docs/${next.slug}`}><span>Next: <span dangerouslySetInnerHTML={{ __html: next.title }} /></span><span aria-hidden="true">→</span></a></p>}
      </article>
      {page.toc.length > 0 && <nav className="docs-toc" aria-labelledby="toc-title"><p id="toc-title" className="docs-toc-title">On this page</p><ul>{page.toc.map(entry => <li key={entry.id}><a href={`#${entry.id}`} dangerouslySetInnerHTML={{ __html: entry.text }} /></li>)}</ul></nav>}
    </main>
    <SiteFooter />
  </div>
}

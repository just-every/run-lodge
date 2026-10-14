import { docsSections } from './content'

/** The docs menu: the sidebar at 1440, a disclosure under the bar on a phone. */
export function DocsNav({ current }: { current?: string }) {
  const list = <>{docsSections.map(section => <div key={section.title} className="docs-group">
    <p className="docs-group-title">{section.title}</p>
    <ul>{section.pages.map(page => <li key={page.slug}><a href={`/docs/${page.slug}`} aria-current={page.slug === current ? 'page' : undefined} dangerouslySetInnerHTML={{ __html: page.title }} /></li>)}</ul>
  </div>)}</>
  const here = docsSections.flatMap(s => s.pages).find(p => p.slug === current)?.title ?? 'All guides'
  return <>
    <nav className="docs-side" aria-label="Docs">{list}</nav>
    <details className="docs-menu"><summary><span className="visually-hidden">Docs menu: </span><span dangerouslySetInnerHTML={{ __html: here }} /></summary><nav aria-label="Docs menu">{list}</nav></details>
  </>
}

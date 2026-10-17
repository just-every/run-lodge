import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { contractPageHtml } from '../base/contract-page'
import { runPageHtml, siteNotFoundHtml, type SiteBuild, type SiteContext } from '../base/run-site'
import { identity } from '../identity'
import { DocsArticle } from './docs/DocsArticle'
import { DocsIndex } from './docs/DocsIndex'
import { docsPages, plainText } from './docs/content'
import { copy } from './landing/copy'
import { Landing } from './landing/Landing'
import { run } from './run'

/**
 * The run site (run-lodge.com), written by `rer build --site`: the landing at `/`, whose Run Lodge opens the Run page
 * at `/run`; the guides at `/docs` and `/docs/<slug>`, rendered from the repository's Markdown; and the not-found page.
 * Every page is static, works without JavaScript and links to no instance-only route.
 */
export function sitePages({ styles, contract }: SiteContext): SiteBuild {
  const document = (title: string, description: string, body: ReactElement) => '<!doctype html>' + renderToStaticMarkup(
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta name="theme-color" content="#fdfbf6" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="preload" href="/fonts/bitter/bitter-latin-wght-normal.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="stylesheet" href="/fonts/fonts.css" />
        <link rel="stylesheet" href="/rer-theme.css" />
        {styles.map(href => <link key={href} rel="stylesheet" href={href} />)}
      </head>
      <body>{body}</body>
    </html>,
  )
  return {
    pages: [
      { path: '/', html: document(copy.meta.title, copy.meta.description, <Landing />) },
      { path: '/run', html: runPageHtml(identity, run, contract) },
      ...(contract ? [{ path: '/contract', html: contractPageHtml(identity, run, contract) }] : []),
      { path: '/docs', html: document('Docs · Lodge', 'How to run Lodge, hire with it and keep your records.', <DocsIndex />) },
      ...docsPages.map(page => ({ path: `/docs/${page.slug}`, html: document(`${plainText(page.title)} · Lodge docs`, plainText(page.lead), <DocsArticle slug={page.slug} />) })),
      { path: '/404', html: siteNotFoundHtml(identity, run, contract) },
    ],
    assets: ['rer-theme.css', 'fonts', 'brand', 'favicon.svg'],
  }
}

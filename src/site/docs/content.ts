// The docs, rendered at build time from the repository's Markdown (docs/site.json and docs/*.md).
// A broken link between pages, a missing file or a page without a title fails the run site build.
import { Marked, type Tokens } from 'marked'
import site from '../../../docs/site.json'

export type DocsPage = { slug: string; title: string; lead: string; html: string; toc: { id: string; text: string }[]; section: string; eyebrow: string }
export type DocsSection = { title: string; pages: { slug: string; title: string; lead: string }[] }

const files = import.meta.glob('../../../docs/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const source = (file: string) => {
  const text = files[`../../../docs/${file}`]
  if (text === undefined) throw new Error(`Docs: docs/${file} is listed in docs/site.json but missing.`)
  return text
}
const slugs = new Set(site.sections.flatMap(section => section.pages.map(page => page.slug)))
const fileSlug = new Map(site.sections.flatMap(section => section.pages.map(page => [page.file, page.slug] as const)))
const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
// Drops every tag in one scan: each `<` is consumed up to its `>`, so no tag can be rebuilt from what is left.
const stripTags = (html: string) => {
  let out = '', i = 0
  while (i < html.length) {
    const close = html[i] === '<' ? html.indexOf('>', i) : -1
    if (close === -1) out += html[i++]
    else i = close + 1
  }
  return out
}
const entities: Record<string, string> = { '&amp;': '&', '&#39;': '’', '&quot;': '"', '&lt;': '<', '&gt;': '>' }
/** The plain text of rendered inline HTML, for `<title>` and meta descriptions. */
export const plainText = (html: string) => stripTags(html).replace(/&(?:amp|#39|quot|lt|gt);/g, entity => entities[entity])
const anchor = (text: string) => stripTags(text.toLowerCase()).replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

function render(file: string) {
  const toc: DocsPage['toc'] = []
  let title = '', lead = ''
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }: Tokens.Heading) {
        const text = this.parser.parseInline(tokens)
        if (depth === 1) { title = text; return '' }
        const id = anchor(text)
        // The step number stays in the heading; "On this page" lists the names.
        if (depth === 2) toc.push({ id, text: text.replace(/^\d+\.\s+/, '') })
        return `<h${depth} id="${id}">${text}</h${depth}>`
      },
      paragraph({ tokens }: Tokens.Paragraph) {
        const text = this.parser.parseInline(tokens)
        if (title && !lead) { lead = text; return `<p class="docs-lead">${text}</p>` }
        return `<p>${text}</p>`
      },
      link({ href, tokens }: Tokens.Link) {
        const text = this.parser.parseInline(tokens)
        if (/^https:\/\//.test(href)) return `<a href="${escape(href)}">${text}</a>`
        const [path, hash] = href.split('#')
        const slug = fileSlug.get(path)
        if (!slug || !slugs.has(slug)) throw new Error(`Docs: docs/${file} links to ${href}, which is not a docs page.`)
        return `<a href="/docs/${slug}${hash ? '#' + hash : ''}">${text}</a>`
      },
      code({ text }: Tokens.Code) { return `<div class="docs-code"><pre tabindex="0"><code>${escape(text)}</code></pre><button class="docs-copy" type="button" hidden>Copy</button></div>` },
      blockquote({ tokens }: Tokens.Blockquote) { return `<aside class="docs-tip"><span class="docs-tip-mark" aria-hidden="true">i</span><div>${this.parser.parse(tokens)}</div></aside>` },
      table(token: Tokens.Table) {
        const cell = (c: Tokens.TableCell) => this.parser.parseInline(c.tokens)
        return `<div class="docs-table"><table><thead><tr>${token.header.map(c => `<th scope="col">${cell(c)}</th>`).join('')}</tr></thead><tbody>${token.rows.map(row => `<tr>${row.map(c => `<td>${cell(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
      },
      html({ text }: Tokens.HTML | Tokens.Tag) { return escape(text) },
    },
  })
  const html = marked.parse(source(file), { async: false }) as string
  if (!title || !lead) throw new Error(`Docs: docs/${file} needs a # title and a first paragraph.`)
  return { title, lead, html, toc }
}

export const docsPages: DocsPage[] = site.sections.flatMap(section => section.pages.map(page => ({ slug: page.slug, section: section.title, eyebrow: section.eyebrow, ...render(page.file) })))
export const docsSections: DocsSection[] = site.sections.map(section => ({ title: section.title, pages: section.pages.map(page => { const p = docsPages.find(x => x.slug === page.slug)!; return { slug: p.slug, title: p.title, lead: p.lead } }) }))

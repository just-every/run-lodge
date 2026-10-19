import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

export interface ReadingPage { text: string; image?: string; html?: string }
export interface Reading { pages: ReadingPage[]; dispose: () => void }

const safeTags = new Set(['P', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'STRONG', 'EM', 'U', 'S', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'BLOCKQUOTE', 'SUP', 'SUB', 'IMG'])

// Word conversion supplies structure, never active HTML, links or embedded objects.
function readableHtml(html: string) {
  const source = new DOMParser().parseFromString(html, 'text/html')
  function copy(node: Node, into: Node) {
    if (node.nodeType === Node.TEXT_NODE) { into.appendChild(document.createTextNode(node.textContent ?? '')); return }
    if (!(node instanceof Element)) return
    const target = safeTags.has(node.tagName) ? document.createElement(node.tagName.toLowerCase()) : document.createDocumentFragment()
    if (node.tagName === 'IMG' && target instanceof Element && /^data:image\/(png|jpeg|gif|webp);base64,/.test(node.getAttribute('src') ?? '')) target.setAttribute('src', node.getAttribute('src')!)
    for (const child of node.childNodes) copy(child, target)
    into.appendChild(target)
  }
  const out = document.createElement('div')
  for (const child of source.body.childNodes) copy(child, out)
  return out.innerHTML
}

export function markHtml(html: string, term: string) {
  const dom = new DOMParser().parseFromString(html, 'text/html')
  if (term) {
    const walker = dom.createTreeWalker(dom.body, NodeFilter.SHOW_TEXT), nodes: Node[] = []
    while (walker.nextNode()) nodes.push(walker.currentNode)
    for (const node of nodes) {
      const value = node.textContent ?? '', lower = value.toLocaleLowerCase(), query = term.toLocaleLowerCase()
      const parts = dom.createDocumentFragment(); let from = 0, at = lower.indexOf(query)
      if (at < 0) continue
      while (at >= 0) {
        parts.appendChild(dom.createTextNode(value.slice(from, at)))
        const mark = dom.createElement('mark'); mark.textContent = value.slice(at, at + term.length); parts.appendChild(mark)
        from = at + term.length; at = lower.indexOf(query, from)
      }
      parts.appendChild(dom.createTextNode(value.slice(from))); node.parentNode?.replaceChild(parts, node)
    }
  }
  return dom.body.innerHTML
}

/** Genuine local decoding; unsupported/corrupt files report the failure and keep the original download. */
export async function readDocument(bytes: ArrayBuffer, name: string, mediaType: string): Promise<Reading> {
  if (mediaType === 'application/pdf' || /\.pdf$/i.test(name)) {
    const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs')
    pdf.GlobalWorkerOptions.workerSrc = workerUrl
    const task = pdf.getDocument({ data: bytes, useSystemFonts: true, stopAtErrors: true })
    try {
      const doc = await task.promise, pages: ReadingPage[] = []
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n), viewport = page.getViewport({ scale: 1.25 })
        const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
        await page.render({ canvas, viewport }).promise
        const content = await page.getTextContent()
        const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('')
        pages.push({ text, image: canvas.toDataURL('image/png') }); canvas.width = canvas.height = 0; page.cleanup()
      }
      return { pages, dispose: () => { void task.destroy() } }
    } catch (error) { await task.destroy(); throw error }
  }
  if (/\.docx$/i.test(name) || mediaType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const { default: mammoth } = await import('mammoth/mammoth.browser')
    const result = await mammoth.convertToHtml({ arrayBuffer: bytes }, { externalFileAccess: false })
    const html = readableHtml(result.value), dom = new DOMParser().parseFromString(html, 'text/html')
    return { pages: [{ html, text: dom.body.textContent ?? '' }], dispose() {} }
  }
  if (/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(mediaType)) {
    const image = URL.createObjectURL(new Blob([bytes], { type: mediaType }))
    return { pages: [{ image, text: '' }], dispose: () => URL.revokeObjectURL(image) }
  }
  if (mediaType.startsWith('text/') || /\.(txt|csv|md)$/i.test(name)) return { pages: [{ text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }], dispose() {} }
  throw new Error('This file type cannot be read inline. Download the original to open it.')
}

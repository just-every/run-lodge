import { useEffect, useState } from 'react'
import type { D } from './shared'
import { markHtml, readDocument, type Reading } from './document-rendering'

export const applicationDocuments = (app: D, w: D): D[] => w.documents.filter((d: D) => d.application === app.id || app.earlier?.some((e: D) => e.application === d.application) || (d.candidate === app.candidate && !d.application))

function Highlight({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>
  const parts = []; let start = 0, at = text.toLocaleLowerCase().indexOf(term.toLocaleLowerCase())
  while (at >= 0) { parts.push(text.slice(start, at), <mark key={at}>{text.slice(at, at + term.length)}</mark>); start = at + term.length; at = text.toLocaleLowerCase().indexOf(term.toLocaleLowerCase(), start) }
  parts.push(text.slice(start)); return <>{parts}</>
}

function Reader({ doc }: { doc: D }) {
  const [reading, setReading] = useState<Reading | null>(null), [error, setError] = useState(''), [query, setQuery] = useState('')
  useEffect(() => {
    let ended = false, current: Reading | null = null, checking = false
    const controller = new AbortController(), base = `/api/lodge/view/document/${doc.id}`
    const clear = (message: string) => { current?.dispose(); current = null; setReading(null); setError(message) }
    async function check() {
      if (ended || checking) return
      checking = true
      try {
        const r = await fetch(base + '?access=1', { cache: 'no-store', signal: controller.signal })
        if (!r.ok) throw new Error('Access to this document has ended. Close the viewer and refresh the workspace.')
      } catch (e) { if (!ended) clear((e as Error).message); throw e } finally { checking = false }
    }
    async function load() {
      try {
        const r = await fetch(base, { cache: 'no-store', signal: controller.signal })
        if (!r.ok) throw new Error('This document is no longer available to you.')
        const parsed = await readDocument(await r.arrayBuffer(), doc.name, doc.mediaType)
        if (ended) { parsed.dispose(); return }
        current = parsed
        await check()
        if (!ended && current) setReading(parsed)
      } catch (e) { if (!ended) clear((e as Error).message) }
    }
    void load()
    const refresh = () => { void check().catch(() => undefined) }
    const visibility = () => { if (document.visibilityState !== 'visible') { current?.dispose(); current = null; setReading(null) } else { setError(''); void load() } }
    const offline = () => clear('The connection was lost. Close the viewer and reconnect before reading again.')
    const timer = window.setInterval(refresh, 2000)
    window.addEventListener('focus', refresh); window.addEventListener('offline', offline); document.addEventListener('visibilitychange', visibility)
    return () => { ended = true; controller.abort(); clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('offline', offline); document.removeEventListener('visibilitychange', visibility); current?.dispose() }
  }, [doc.id, doc.name, doc.mediaType])
  const term = query.trim(), matches = reading?.pages.reduce((n, p) => n + (term ? p.text.toLocaleLowerCase().split(term.toLocaleLowerCase()).length - 1 : 0), 0) ?? 0
  return <div className="document-reader" aria-label={`Reading ${doc.name}`}>
    {error ? <p role="alert">{error}</p> : !reading ? <p role="status">Opening document…</p> : <>
      <label>Search in document<input type="search" value={query} onChange={e => setQuery(e.target.value)} /></label>
      {term && <p role="status">{matches} {matches === 1 ? 'match' : 'matches'}</p>}
      {reading.pages.map((page, index) => <article className="reading-page" key={index} aria-label={`Page ${index + 1}`}>
        {page.image && <img src={page.image} alt={`Page ${index + 1} of ${doc.name}`} />}
        {page.html ? <div className="word-reading" dangerouslySetInnerHTML={{ __html: markHtml(page.html, term) }} /> : page.text ? <p className="pre document-text"><Highlight text={page.text} term={term} /></p> : <p className="hint">No searchable text on this page.</p>}
      </article>)}
    </>}
  </div>
}

export function DocumentViewer({ documents }: { documents: D[] }) {
  const [selected, setSelected] = useState('')
  const doc = documents.find(d => d.id === selected)
  if (!documents.length) return <p className="hint">No documents you can read.</p>
  return <section className="inline-documents" aria-label="Inline documents">
    <label>Read a document<select value={doc?.id ?? ''} onChange={e => setSelected(e.target.value)}><option value="">Choose a document</option>{documents.map(d => <option key={d.id} value={d.id}>{d.name}{d.restricted ? ' (restricted)' : ''}</option>)}</select></label>
    {doc && <><p><a href={`/api/lodge/download/document/${doc.id}`}>Download original: {doc.name}</a></p><Reader key={doc.id} doc={doc} /></>}
  </section>
}

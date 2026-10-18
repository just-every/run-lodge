import { useEffect, useState } from 'react'
import type { Target } from '../app'
import { weekday } from '../format'
import { Icon } from '../icons'
import { call, type D } from '../shared'

const KIND: D = { candidate: 'Candidate', vacancy: 'Vacancy', document: 'Document' }

/** Search over what the signed-in person can already see (GET /api/lodge/search), opening the record it finds. */
function Search({ w, go }: { w: D; go: (tab: string, target?: Target) => void }) {
  const [q, setQ] = useState(''), [results, setResults] = useState<D[] | null>(null), [error, setError] = useState('')
  useEffect(() => {
    if (q.trim().length < 2) { setResults(null); setError(''); return }
    const timer = setTimeout(() => call('search?q=' + encodeURIComponent(q.trim())).then(r => { setResults(r.results); setError('') }, e => setError(e.message)), 250)
    return () => clearTimeout(timer)
  }, [q])
  const open = (r: D) => {
    setQ('')
    if (r.kind === 'candidate') {
      const app = w.applications.filter((a: D) => a.candidate === r.id).sort((x: D, y: D) => (x.status === 'active' ? 0 : 1) - (y.status === 'active' ? 0 : 1) || y.submittedAt.localeCompare(x.submittedAt))[0]
      return app ? go('Applications', { app: app.id, job: app.vacancy }) : go('Candidates')
    }
    const v = w.vacancies.find((x: D) => x.id === r.id)
    return v?.manages ? go('Vacancies', { vacancy: r.id }) : go('Applications', { job: r.id, app: null })
  }
  return <div className="search" role="search">
    <Icon name="search" />
    <input type="search" aria-label="Search candidates, vacancies and documents" placeholder="Search candidates, jobs or documents…" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Escape' && setQ('')} />
    {(results || error) && <div className="search-results">
      {error ? <p role="alert">{error}</p> : !results!.length ? <p className="empty">Nothing matches “{q.trim()}”.</p>
        : <ul>{results!.slice(0, 8).map(r => <li key={r.kind + r.id}>{r.kind === 'document'
          ? <a href={`/api/lodge/download/document/${r.id}`}><strong>{r.label}</strong><small>{KIND[r.kind]}</small></a>
          : <button onClick={() => open(r)}><strong>{r.label}</strong><small>{KIND[r.kind]} · matched {r.fields.join(', ')}</small></button>}</li>)}</ul>}
    </div>}
  </div>
}

export function TopBar({ w, go, manager }: { w: D; go: (tab: string, target?: Target) => void; manager: boolean }) {
  const today = new Date().toISOString()
  return <header className="topbar">
    {w.business && <Search w={w} go={go} />}
    <span className="today">{weekday(today)}, {new Date(today).getFullYear()}</span>
    {manager && w.business && <button className="primary new" onClick={() => go('Vacancies', { vacancy: 'new' })}><Icon name="plus" />New vacancy</button>}
  </header>
}

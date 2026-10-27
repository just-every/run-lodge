import { useEffect, useState } from 'react'
import type { PageProps } from './app'
import { call, Field, Form, Table, type D } from './shared'
import { businessZone, times } from '../lodge/core/time'

export function CohortReport({ w, follow }: Pick<PageProps, 'w' | 'follow'>) {
  const [query, setQuery] = useState(''), [report, setReport] = useState<D>(), [error, setError] = useState('')
  useEffect(() => {
    let current = true
    setReport(undefined); setError('')
    call('reports/cohort' + query).then(r => { if (current) setReport(r) }).catch(e => { if (current) setError(e.message) })
    return () => { current = false }
  }, [w, query])
  const dates = times(report?.filter.timeZone ?? businessZone(w.business))
  return <div className="page wide">
    <h1>Recruiting cohort report</h1>
    <p>Submission cohorts, accepted-offer timing and current close reasons. Open a record to inspect its history.</p>
    <Form label="Apply cohort filters" onSubmit={async values => { setQuery('?' + new URLSearchParams(values).toString()) }}>
      <Field label="Job" name="vacancy" required={false} options={w.vacancies.filter((v: D) => v.manages).map((v: D) => ({ value: v.id, label: v.title }))} />
      <Field label="Submitted from" name="from" type="date" required={false} />
      <Field label="Submitted through" name="to" type="date" required={false} />
      <Field label="Reporting time zone" name="timeZone" defaultValue={businessZone(w.business)} />
      <Field label="History" name="history" defaultValue="all" options={[{ value: 'all', label: 'Native and imported' }, { value: 'native', label: 'Native only' }, { value: 'imported', label: 'Imported only' }]} />
    </Form>
    {error && <p role="alert">{error}</p>}
    {report && <section aria-label="Cohort results">
      <h2>Cohort results</h2>
      <p>{report.totals.applications} applications · {report.totals.measuredHires} measured hires · Mean time to hire: {report.totals.meanDaysToHire === null ? 'Not available' : `${report.totals.meanDaysToHire.toFixed(1)} calendar days`}</p>
      <p>Time zone: {report.filter.timeZone} · Submission dates: {report.filter.from ?? 'Any'} to {report.filter.to ?? 'Any'} · History: {report.filter.history}</p>
      <p>{report.disclosures.missingSubmission} records with missing submission dates in scope; {report.disclosures.excludedUndated} excluded by date filters. {report.disclosures.incompleteHireTiming} hires with incomplete timing. {report.disclosures.offerAccessUnavailable} records without offer access.</p>
      <p><a href={'/api/lodge/download/cohort' + query}>Export cohort report</a></p>
      <h3>Current status</h3>
      <Table heads={['Status', 'Applications']}>{Object.entries(report.totals.statuses).map(([status, n]) => <tr key={status}><td>{status}</td><td>{String(n)}</td></tr>)}</Table>
      <h3>Current close reasons</h3>
      <Table heads={['Outcome', 'Reason', 'Applications']} empty="No current closes in this cohort.">{report.reasons.map((r: D) => <tr key={r.status + r.reason}><td>{r.status}</td><td>{r.label}</td><td>{r.count}</td></tr>)}</Table>
      <h3>Underlying applications</h3>
      <Table heads={['Application', 'Job', 'Status', 'Submitted', 'Accepted offer', 'Days to hire', 'Timing history', 'Current reason']} empty="No applications match these filters.">{report.rows.map((r: D) => <tr key={r.application}>
        <td><button className="link" onClick={() => follow(r.link)}>{r.candidateName}</button>{r.imported && <small> · imported</small>}</td><td>{r.job}</td><td>{r.status}</td><td>{r.submittedAt ? dates.stamped(r.submittedAt) : 'Unknown'}</td><td>{r.acceptedAt ? dates.stamped(r.acceptedAt) : 'Not recorded or unavailable'}</td><td>{r.daysToHire ?? 'Not measured'}</td><td>{r.timing}</td><td>{r.closeLabel ?? '—'}</td>
      </tr>)}</Table>
      <h3>Definitions and limits</h3>
      {Object.values(report.definitions).map((definition: any, i) => <p key={i}>{definition}</p>)}
    </section>}
  </div>
}

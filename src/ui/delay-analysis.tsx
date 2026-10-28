import { useEffect, useState } from 'react'
import type { PageProps } from './app'
import { call, Field, Form, Table, type D } from './shared'
import { businessZone } from '../lodge/core/time'

const hours = (value: number) => new Intl.NumberFormat('en-US', { maximumSignificantDigits: 4 }).format(value)

function DelayCases({ report, follow }: { report: D; follow: PageProps['follow'] }) {
  return <>{report.cases.map((row: D) => <details key={row.application}>
    <summary>Source case: {row.name}</summary>
    <p><button className="link" onClick={() => follow('/app?application=' + encodeURIComponent(row.application))}>Open application history</button> · {row.status}</p>
    <p>Application revision: <code>{row.source.revision}</code></p>
    {row.missing.map((limit: string) => <p key={limit}>{limit}</p>)}
    <h4>Native stage events</h4>
    <ul>{row.events.map((e: D) => <li key={e.id}>{e.at ?? 'Unknown time'} · {e.fromLabel} → {e.toLabel}<details><summary>Exact event citation</summary><p>Record <code>{e.id}</code></p><p>Revision <code>{e.revision}</code></p></details></li>)}</ul>
    <ul>{row.intervals.map((i: D) => <li key={i.start + i.end}>{i.label}: {hours(i.hours)} elapsed hours · {i.from} to {i.to}</li>)}</ul>
    <h4>Native scheduling observations</h4>
    {!row.scheduling?.length && <p>No native scheduling observations; external attempts remain unknown.</p>}
    {(row.scheduling ?? []).map((iv: D) => <p key={iv.id}>{iv.status} · {iv.panelResponses} of {iv.panelSize} panel declarations · candidate availability {iv.candidateResponded ? 'recorded' : 'unknown'} · proposal to recorded schedule {iv.hoursToRecordedSchedule === null ? 'unknown' : hours(iv.hoursToRecordedSchedule) + ' hours'} · proposal to candidate availability {iv.hoursToCandidateAvailability === null ? 'unknown' : hours(iv.hoursToCandidateAvailability) + ' hours'} · Record <code>{iv.id}</code> · Revision <code>{iv.revision}</code>. Provider availability unverified.</p>)}
    <h4>Recorded offer outcomes</h4>
    {!row.offers.length && <p>No recorded offers.</p>}
    {row.offers.map((o: D) => <p key={o.id}>{o.status} · {o.hoursToOutcome === null ? 'Duration unknown' : hours(o.hoursToOutcome) + ' hours to recorded outcome'} · Record <code>{o.id}</code> · Revision <code>{o.revision}</code></p>)}
  </details>)}</>
}

function Evidence({ report, follow }: { report: D; follow: PageProps['follow'] }) {
  return <>
    <p>{report.totals.cases} cases · {report.totals.completedIntervals} completed stage intervals · {report.totals.offers} recorded offers · {report.totals.measuredOutcomes} measured offer outcomes.</p>
    <p>Original submission cohort: {report.cohort.from ?? 'Any date'} to {report.cohort.to ?? 'Any date'} · {report.cohort.timeZone}</p>
    <p>{report.disclosures.incompleteCases} cases with incomplete or unfinished history; {report.disclosures.excludedUndated} undated cases excluded by date filters.</p>
    <Table heads={['Stage', 'Completed visits', 'Mean elapsed hours']}>
      {report.stages.map((st: D) => <tr key={st.stage}><td>{st.label}</td><td>{st.intervals}</td><td>{st.meanHours === null ? 'Unknown' : hours(st.meanHours)}</td></tr>)}
    </Table>
    <p>Mean time from offer creation to recorded outcome: {report.totals.meanOfferHours === null ? 'Unknown' : hours(report.totals.meanOfferHours) + ' hours'}.</p>
    {report.hiring && <p>Native time to hire: {report.hiring.totals.meanDaysToHire === null ? 'Unknown' : hours(report.hiring.totals.meanDaysToHire) + ' calendar days'} · {report.hiring.totals.measuredHires} measured hires. {report.hiring.definition}</p>}
    <h3>Missing observations and limits</h3>
    {report.unknowns.map((x: string) => <p key={x}>{x}</p>)}
    <details><summary>Cohort and metric definitions</summary>{Object.values(report.definitions).map((x: any, i) => <p key={i}>{x}</p>)}</details>
    <DelayCases report={report} follow={follow} />
  </>
}

export function DelayAnalysis({ w, follow }: Pick<PageProps, 'w' | 'follow'>) {
  const [query, setQuery] = useState(''), [report, setReport] = useState<D>(), [error, setError] = useState(''), [feedback, setFeedback] = useState<D>()
  useEffect(() => {
    let live = true
    setReport(undefined); setFeedback(undefined); setError('')
    if (query) call('delay-analysis?' + query).then(r => { if (live) setReport(r) }).catch(e => { if (live) setError(e.message) })
    return () => { live = false }
  }, [query, w])
  const jobs = w.vacancies.filter((v: D) => v.manages && v.permissions?.includes('offers'))
  if (!jobs.length) return null
  return <section aria-label="Native delay evidence" className="delay-analysis">
    <details><summary>Inspect native delay evidence</summary>
      <p>Read observed durations before requesting a diagnosis from your coding agent. Missing evidence stays unknown.</p>
      <Form label="Load delay evidence" onSubmit={async values => { setQuery(new URLSearchParams(values).toString()) }}>
        <Field label="Delay evidence job" name="vacancy" options={jobs.map((v: D) => ({ value: v.id, label: v.title }))} />
        <Field label="Original submissions from" name="from" type="date" required={false} />
        <Field label="Original submissions through" name="to" type="date" required={false} />
        <Field label="Cohort time zone" name="timeZone" defaultValue={businessZone(w.business)} />
      </Form>
      {error && <p role="alert">{error}</p>}
      {report && <Evidence report={report} follow={follow} />}
      {report && !w.actor.agent && (w.actor.owner || w.actor.roles.includes('admin')) && <>
        <button onClick={async () => { try { setFeedback(await call('delay-feedback?' + query)) } catch (e: any) { setError(e.message) } }}>Read human-only survey context</button>
        {feedback && <section aria-label="Human-only delay feedback"><p>{feedback.definition}</p><p>{feedback.limit}</p>
          {!feedback.surveys.length && <p>No retained survey observations for this job.</p>}
          {feedback.surveys.map((r: D) => <section key={r.id}><h3>{r.title} · version {r.version}</h3><p>{r.responses} responses from {r.invitations} provider handoffs.</p>{r.suppressed ? <p>Small sample: answers suppressed.</p> : <><p>Mean process ratings: {r.averages.join(', ')}</p>{r.identified.map((x: D) => <p key={x.application}>{x.candidateName} · stage days {x.stageDays} · arrival to interview hours {x.schedulingHours.join(', ') || 'unknown'}</p>)}</>}</section>)}
        </section>}
      </>}
    </details>
  </section>
}

export function DelayDraft({ p, w, mutate, follow }: Pick<PageProps, 'w' | 'mutate' | 'follow'> & { p: D }) {
  return <article className="card delay-analysis" aria-label="Delay diagnosis draft">
    <p className="eyebrow">Agent-authored diagnosis draft · {p.status}</p>
    <h2>{p.summary}</h2>
    <p>Observational evidence only. Accepting records review of this draft; a sandbox trial and production activation require separate review. No hiring decision or configuration changes here.</p>
    {p.findings.map((f: D, i: number) => <section key={i}><h3>{f.kind === 'hypothesis' ? 'Uncertain hypothesis' : 'Observation'}</h3><p>{f.text}</p><details><summary>Finding citations</summary>{f.citations.map((c: D) => <p key={c.kind + c.id}>{c.kind} <code>{c.id}</code> · Revision <code>{c.revision}</code></p>)}</details></section>)}
    <h3>Uncertainty</h3><p>{p.uncertainty}</p>
    <h3>Sample limits</h3><p>{p.sampleLimits}</p>
    <h3>Proposed workflow change</h3><p>{p.proposedChange}</p>
    <h3>Measurable success criterion</h3><p>{p.successCriterion}</p>
    <p>{p.measurement.label}: mean completed stage hours from {hours(p.measurement.baselineHours)} ({p.measurement.baselineIntervals} visits) to below {hours(p.measurement.targetHours)}, with at least {p.measurement.minimumIntervals} completed visits in a future {p.measurement.windowDays}-day submission cohort using the same definition. No trial has run.</p>
    <details><summary>Evidence read for this draft</summary><Evidence report={p.delay} follow={follow} /></details>
    {p.status === 'proposed' && !w.actor.agent && p.approver === w.actor.email && <Form label="Record draft review" onSubmit={values => mutate('decide-proposal', { id: p.id, ...values })}>
      <Field label="Draft decision" name="decision" options={[{ value: 'accepted', label: 'Accept draft only' }, { value: 'rejected', label: 'Reject draft' }]} />
      <Field label="Draft review reason" name="reason" />
    </Form>}
    {p.reason && <p>Review reason: {p.reason}</p>}
  </article>
}

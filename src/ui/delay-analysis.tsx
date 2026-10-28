import { useEffect, useState } from 'react'
import type { PageProps } from './app'
import { call, Check, Field, Form, Table, type D } from './shared'
import { businessZone } from '../lodge/core/time'

const hours = (value: number) => new Intl.NumberFormat('en-US', { maximumSignificantDigits: 4 }).format(value)
const waitLabels: Record<string, string> = { candidate: 'Candidate availability', panel: 'Complete panel declarations', readyToSchedule: 'Ready to recorded schedule' }

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
    {(row.scheduling ?? []).map((iv: D) => <div key={iv.id}><p>{iv.status} · {iv.panelResponses} of {iv.panelSize} panel declarations · candidate availability {iv.candidateResponded ? 'recorded' : 'unknown'} · proposal to recorded schedule {iv.hoursToRecordedSchedule === null ? 'unknown' : hours(iv.hoursToRecordedSchedule) + ' hours'} · proposal to candidate availability {iv.hoursToCandidateAvailability === null ? 'unknown' : hours(iv.hoursToCandidateAvailability) + ' hours'} · Record <code>{iv.id}</code> · Revision <code>{iv.revision}</code>. Provider availability unverified.</p>{iv.historyIncomplete && <p>Earlier native availability edits have no complete observation history.</p>}
      {iv.waits && <ul>{Object.entries(iv.waits).map(([metric, value]: [string, any]) => <li key={metric}>{waitLabels[metric]}: {value.hours === null ? 'Unknown; complete timestamped declarations are unavailable' : hours(value.hours) + ' elapsed hours'}{value.observations.length > 0 && ' · observations ' + value.observations.map((index: number) => index + 1).join(', ')}</li>)}</ul>}
      <ul>{iv.observations.map((event: D, i: number) => <li key={i}>Observation {i + 1} · {event.kind}: {event.at} · {event.hoursAfterProposal === null ? 'Unknown elapsed time' : hours(event.hoursAfterProposal) + ' hours after proposal'}{event.availableSlots === null ? '' : ' · ' + event.availableSlots + ' available choices'}</li>)}</ul></div>)}
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
    {report.scheduling && <section aria-label="Recorded scheduling waits"><h3>Recorded scheduling waits</h3>
      <p>These observations help separate candidate availability, panel declarations and a possible recruiter queue. Waits can overlap; they do not establish a cause or verify any provider.</p>
      <Table heads={['Observation', 'Measured interviews', 'Unknown', 'Mean elapsed hours']}>
        {report.scheduling.map((row: D) => <tr key={row.metric}><td>{waitLabels[row.metric]}</td><td>{row.measured}</td><td>{row.unknown}</td><td>{row.meanHours === null ? 'Unknown' : hours(row.meanHours)}</td></tr>)}
      </Table>
    </section>}
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
    {p.findings.map((f: D, i: number) => <section key={i}><h3>{f.kind === 'hypothesis' ? 'Uncertain hypothesis' : 'Observation'}</h3><p>{f.text}</p><details><summary>Finding citations</summary>{f.citations.map((c: D, index: number) => <p key={index}>{c.kind} <code>{c.id}</code> · Revision <code>{c.revision}</code>{c.observation !== undefined && <> · Observation {c.observation + 1}: {c.observationKind} at {c.at}</>}</p>)}</details></section>)}
    <h3>Uncertainty</h3><p>{p.uncertainty}</p>
    <h3>Sample limits</h3><p>{p.sampleLimits}</p>
    <h3>Proposed workflow change</h3><p>{p.proposedChange}</p>
    <h3>Measurable success criterion</h3><p>{p.successCriterion}</p>
    <p>{p.measurement.label}: mean elapsed hours from {hours(p.measurement.baselineHours)} ({p.measurement.baselineIntervals} {p.measurement.sampleLabel ?? 'completed visits'}) to below {hours(p.measurement.targetHours)}, with at least {p.measurement.minimumIntervals} {p.measurement.sampleLabel ?? 'completed visits'} in a future {p.measurement.windowDays}-day submission cohort using the same definition. {p.delayTrial ? 'Trial status: ' + p.delayTrial.status + '.' : 'No trial has run.'}</p>
    {p.measurement.definition && <details><summary>Reviewed metric definition</summary><p>{p.measurement.definition}</p></details>}
    {p.status === 'accepted' && w.actor.owner && !w.actor.agent && <p><button className="link" onClick={() => follow('/app?settings=delay-trials')}>Open native trial settings</button></p>}
    {p.delayTrial?.comparison && <p>{p.delayTrial.comparison.conclusion}: {p.delayTrial.comparison.meanHours === null ? 'Unknown duration' : hours(p.delayTrial.comparison.meanHours) + ' mean elapsed hours'} from {p.delayTrial.comparison.intervals} {p.delayTrial.comparison.sampleLabel ?? 'completed visits'}. {p.delayTrial.comparison.limitation}</p>}
    <details><summary>Evidence read for this draft</summary><Evidence report={p.delay} follow={follow} /></details>
    {p.status === 'proposed' && !w.actor.agent && p.approver === w.actor.email && <Form label="Record draft review" onSubmit={values => mutate('decide-proposal', { id: p.id, ...values })}>
      <Field label="Draft decision" name="decision" options={[{ value: 'accepted', label: 'Accept draft only' }, { value: 'rejected', label: 'Reject draft' }]} />
      <Field label="Draft review reason" name="reason" />
    </Form>}
    {p.reason && <p>Review reason: {p.reason}</p>}
  </article>
}

/** Extend the existing Settings page; all configuration stays out of draft review. */
export function DelayTrialSettings({ w, mutate }: Pick<PageProps, 'w' | 'mutate'>) {
  if (!w.actor.owner || w.actor.agent) return null
  const accepted = w.proposals.filter((p: D) => p.workflow === 'delay-diagnosis' && p.status === 'accepted')
  return <section className="card delay-analysis" aria-label="Native delay trial settings"><h2>Native delay trial settings</h2>
    <p>The owner can review an internal queue task policy. It sends no mail, changes no hiring decision and grants no candidate-contact authority. A sandbox replay freezes observed baseline submissions; future comparisons retain the same definitions and disclose uncertainty.</p>
    {!accepted.length && <p>Accept a source-bound diagnosis draft before reviewing a trial.</p>}
    {accepted.map((p: D) => <details key={p.id}><summary>Trial for {p.summary}</summary>
      <p>{p.measurement.label} · target below {hours(p.measurement.targetHours)} elapsed hours · at least {p.measurement.minimumIntervals} {p.measurement.sampleLabel ?? 'completed visits'} over {p.measurement.windowDays} submission days. Internal task stage: {p.measurement.triggerLabel ?? p.measurement.label}.</p>
      {p.delayTrial?.status !== 'active' && <Form label="Preview internal task trial" onSubmit={values => mutate('delay-trial-preview', { id: p.id, ...values })}>
        <Field label="Hours before an internal review task" name="afterHours" type="number" defaultValue={p.delayTrial?.policy.afterHours ?? 24} />
      </Form>}
      {p.delayTrial && <><p>Trial status: {p.delayTrial.status}</p><p>Baseline snapshot: {p.delayTrial.baselineObservedAt}. Later baseline submissions or events are not added to its frozen comparison. One internal task per native stage entry, assigned to the owner after {p.delayTrial.policy.afterHours} elapsed hours. Imported histories are excluded; no automatic sends.</p>
        {p.delayTrial.status === 'review' && <><p>Isolated replay: {p.delayTrial.impact.length} eligible cases. Production tasks created: 0. Outbound contacts: 0. This does not predict a delay reduction.</p><Form label="Activate reviewed native trial" onSubmit={values => mutate('delay-trial-activate', { id: p.id, token: p.delayTrial.token, ...values })}><Check label="Approve this exact internal task policy" name="confirm" /></Form></>}
        {p.delayTrial.comparisonCohort && <p>Future submission cohort: {p.delayTrial.comparisonCohort.from} to {p.delayTrial.comparisonCohort.to} · {p.delayTrial.comparisonCohort.timeZone}. Unknown observations remain excluded from the reviewed metric's measured denominator.</p>}
        {p.delayTrial.status === 'active' && <><Form label="Run reviewed internal tasks" onSubmit={() => mutate('delay-trial-run', { id: p.id })} /><Form label="Roll back native trial" onSubmit={() => mutate('delay-trial-rollback', { id: p.id })} /></>}
        {['active', 'rolled-back'].includes(p.delayTrial.status) && <Form label="Measure observed comparison" onSubmit={() => mutate('delay-trial-compare', { id: p.id })} />}
        {p.delayTrial.comparison && <p>{p.delayTrial.comparison.conclusion} · {p.delayTrial.comparison.intervals} {p.delayTrial.comparison.sampleLabel ?? 'completed visits'} · mean {p.delayTrial.comparison.meanHours === null ? 'unknown' : hours(p.delayTrial.comparison.meanHours) + ' elapsed hours'}. {p.delayTrial.comparison.limitation}</p>}
      </>}
    </details>)}
  </section>
}

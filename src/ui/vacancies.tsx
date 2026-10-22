import { ReferralReview } from './referrals'
import { EsignSettings } from './esign'
import type { PageProps } from './app'
import { VacancyInternal } from './internal'
import { EMPLOYMENT_TYPES, vacancyFacts } from '../lodge/core/labels'
import { pay, payShort, since } from './format'
import { Icon } from './icons'
import { person } from './names'
import { cents, Check, Empty, Field, Form, memberOptions, Status, Table, type D } from './shared'
import { columns } from './pipeline/facts'
import { Kickoffs } from './kickoffs'
import { Openings } from './openings'
import { Posts } from './posts'
import { JobQuestions } from './questions'
import { Rules } from './rules'
import { departmentOptions, officeOptions } from './org'
import { Sourcing, Team } from './team'
import { OfferTemplates, JobOfferTemplate } from './offer-templates'
import { JobCopies, Templates } from './templates'
import { JobFields } from './fields'
import { JobHiringViews } from './hiring-views'
import { Agencies } from './agencies'

export function VacancyStatus({ v }: { v: D }) {
  if (v.imported) return <Status>imported history</Status>
  if (v.status === 'open') return <Status tone="good">published</Status>
  if (v.status === 'closed') return <Status>closed</Status>
  if (v.approvedNow) return <Status tone="good">approved, not published</Status>
  if (v.approval?.status === 'pending' && v.approval.version === v.version) return <Status tone="warn">awaiting approval</Status>
  return <Status>draft</Status>
}

function Terms({ v, w, mutate, onSaved }: { v?: D; w: D; mutate: PageProps['mutate']; onSaved?: (id: string) => void }) {
  const c = v?.compensation
  return <Form label={v ? 'Save terms' : 'Create vacancy'} onSubmit={async x => {
    const compensation = x.min || x.max ? { currency: x.currency.toUpperCase(), min: cents(x.min), max: cents(x.max), period: x.period } : null
    const saved = await mutate(x.template ? 'vacancy-from-template' : 'vacancy', { id: v?.id, template: x.template || undefined, title: x.title, department: x.department, departmentId: x.departmentId || undefined, officeId: x.officeId || undefined, locations: (w.offices ?? []).filter((o: D) => x['also-' + o.id]).map((o: D) => o.id), location: x.location, workMode: x.workMode, employmentType: x.employmentType, description: x.description, headcount: x.headcount, manager: x.manager, compensation })
    onSaved?.(saved.id)
  }}>
    {!v && w.jobTemplates?.length ? <Field label="Start from template" name="template" required={false} defaultValue="" options={w.jobTemplates.map((t: D) => ({ value: t.id, label: t.name }))} /> : null}
    <Field label="Job title" name="title" defaultValue={v?.title} />
    {w.departments?.length ? <Field label="Managed department" name="departmentId" required={false} defaultValue={v?.departmentId ?? ''} options={departmentOptions(w)} /> : null}
    <Field label="Department" name="department" required={false} defaultValue={v?.department} hint={w.departments?.length ? 'Filled from the managed department when one is chosen' : undefined} />
    {w.offices?.length ? <Field label="Office" name="officeId" required={false} defaultValue={v?.officeId ?? ''} options={officeOptions(w)} /> : null}
    {w.offices?.length > 1 ? <fieldset className="wide"><legend>Other approved offices (for job posts)</legend>{officeOptions(w).map((o: D) => <Check key={o.value} name={'also-' + o.value} label={o.label} defaultChecked={(v?.locations ?? []).includes(o.value)} />)}</fieldset> : null}
    <Field label="Location" name="location" required={false} defaultValue={v?.location} />
    <Field label="Work mode" name="workMode" defaultValue={v?.workMode ?? 'onsite'} options={[{ value: 'onsite', label: 'On site' }, { value: 'hybrid', label: 'Hybrid' }, { value: 'remote', label: 'Remote' }]} />
    <Field label="Employment type" name="employmentType" defaultValue={v?.employmentType ?? 'full-time'} options={Object.entries(EMPLOYMENT_TYPES).map(([value, label]) => ({ value, label }))} />
    <Field label="Headcount" name="headcount" type="number" required={false} defaultValue={v?.headcount ?? ''} />
    <Field label="Pay currency" name="currency" required={false} defaultValue={c?.currency ?? 'USD'} />
    <Field label="Pay period" name="period" defaultValue={c?.period ?? 'year'} options={[{ value: 'year', label: 'per year' }, { value: 'month', label: 'per month' }, { value: 'hour', label: 'per hour' }]} />
    <Field label="Minimum pay" name="min" type="number" required={false} defaultValue={c ? c.min / 100 : ''} />
    <Field label="Maximum pay" name="max" type="number" required={false} defaultValue={c ? c.max / 100 : ''} />
    <Field label="Hiring manager" name="manager" defaultValue={v?.manager ?? w.actor.email} options={memberOptions(w.members, 'manager')} />
    <Field label="Description applicants will read" name="description" type="textarea" wide required={false} defaultValue={v?.description} />
  </Form>
}

function Setup({ v, w, mutate }: { v: D; w: D; mutate: PageProps['mutate'] }) {
  const rubric = v.rubrics.at(-1)
  const stageName = (id: string) => v.stages.find((s: D) => s.id === id)?.name ?? id
  const critName = (id: string) => rubric?.criteria.find((c: D) => c.id === id)?.name ?? id
  const locked = v.status !== 'draft' || v.imported
  return <div className="columns">
    <div><h3>Stages</h3>
    {locked ? <ol className="stages">{v.stages.map((s: D) => <li key={s.id}>{s.name}</li>)}</ol> : <Form label="Save stages" onSubmit={x => mutate('vacancy-stages', { id: v.id, stages: x.stages.split('\n').map((n: string) => n.trim()).filter(Boolean).map((name: string) => ({ id: v.stages.find((s: D) => s.name === name)?.id, name })) })}>
      <Field label="Stages, one per line, in order" name="stages" type="textarea" wide defaultValue={v.stages.map((s: D) => s.name).join('\n')} />
    </Form>}</div>
    <div><h3>Rubric {rubric ? `(version ${rubric.version})` : ''}</h3>
    {rubric && <ul>{rubric.criteria.map((c: D) => <li key={c.id}><strong>{c.name}</strong>: {c.description}</li>)}</ul>}
    {!locked && <Form label="Save rubric version" onSubmit={x => mutate('rubric', { id: v.id, criteria: x.criteria.split('\n').map((l: string) => l.trim()).filter(Boolean).map((l: string) => { const [name, ...rest] = l.split(':'); return { id: rubric?.criteria.find((c: D) => c.name === name.trim())?.id, name: name.trim(), description: rest.join(':').trim() } }) })}>
      <Field label="Criteria, one per line as “Name: the job-related evidence it looks for”" name="criteria" type="textarea" wide defaultValue={rubric?.criteria.map((c: D) => `${c.name}: ${c.description}`).join('\n')} />
    </Form>}</div>
    <div><h3>Interview plan</h3>
    {v.plan.length > 0 && <ul>{v.plan.map((p: D) => <li key={p.id}>{p.name}{stageName(p.stage) !== p.name && ` · ${stageName(p.stage)}`} · {p.durationMinutes} min · {p.criteria.map(critName).join(', ') || 'all criteria'}{p.questions?.length ? ` · kit: ${p.questions.length} questions` : ''}
      {!locked && <details><summary>Kit for {p.name}</summary><Form label="Save kit" onSubmit={x => mutate('interview-kit', { id: v.id, item: p.id, purpose: x.purpose, questions: x.questions.split('\n').map((l: string) => l.trim()).filter(Boolean).map((l: string) => { const [text, ...guidance] = l.split('|'); return { text: text.trim(), guidance: guidance.join('|').trim() } }) })}>
        <Field label={`Purpose of ${p.name}`} name="purpose" type="textarea" wide required={false} defaultValue={p.purpose} />
        <Field label={`Questions for ${p.name} (each line “Question | guidance”)`} name="questions" type="textarea" wide required={false} defaultValue={(p.questions ?? []).map((q: D) => q.guidance ? `${q.text} | ${q.guidance}` : q.text).join('\n')} />
      </Form></details>}</li>)}</ul>}
    {!locked && rubric && <Form label="Save interview plan" onSubmit={x => mutate('interview-plan', { id: v.id, plan: x.plan.split('\n').map((l: string) => l.trim()).filter(Boolean).map((l: string) => { const [name, stage, minutes, focus = ''] = l.split('|').map(p => p.trim()); return { id: v.plan.find((p: D) => p.name === name)?.id, name, stage: v.stages.find((s: D) => s.name === stage)?.id, durationMinutes: Number(minutes || 45), criteria: focus.split(',').map(f => f.trim()).filter(Boolean).map(f => rubric.criteria.find((c: D) => c.name === f)?.id ?? f) } }) })}>
      <Field label="Interviews, one per line as “Name | Stage | minutes | criterion, criterion”" name="plan" type="textarea" wide defaultValue={v.plan.map((p: D) => `${p.name} | ${stageName(p.stage)} | ${p.durationMinutes} | ${p.criteria.map(critName).join(', ')}`).join('\n')} />
    </Form>}</div>
  </div>
}

function Detail({ v, w, mutate, go, select }: { v: D; select: (id: string) => void } & Pick<PageProps, 'w' | 'mutate' | 'go'>) {
  const apps = w.applications.filter((a: D) => a.vacancy === v.id)
  return <section className="record card" aria-label={v.title}>
    <header className="record-head"><h2>{v.title}</h2><VacancyStatus v={v} />{apps.length > 0 && <button className="secondary" onClick={() => go('Applications', { job: v.id, app: null })}><Icon name="applications" size={18} />Open pipeline</button>}</header>
    <p className="meta">{[...vacancyFacts(v), pay(v.compensation), `headcount ${v.headcount ?? 'not set'}`, `hires ${v.hires ?? 0}`, `manager ${person(w, v.manager) || 'none'}`].join(' · ')}</p>
    {v.kickoff && (k => k && <p className="hint">From {person(w, k.author)}’s kickoff: {pay(k.payRange)}, headcount {k.headcount}, start {k.targetStart}. Its pay and headcount are part of the approved terms.</p>)(w.kickoffs.find((x: D) => x.id === v.kickoff))}
    {v.imported && <p className="hint">Imported from Workable ({v.sourceState || 'unknown state'}). Kept as history; it cannot be reopened.</p>}
    {v.status === 'open' && <p className="page-link"><Icon name="external" size={18} />Application page: <a href={`/jobs/${v.slug}`}>/jobs/{v.slug}</a> · {apps.length} applications</p>}
    {!v.imported && <Openings v={v} w={w} mutate={mutate} />}
    {!v.imported && v.manages && <Posts v={v} w={w} mutate={mutate} />}
    {!v.imported && v.manages && <Team v={v} w={w} mutate={mutate} />}
    {v.manages && (w.actor.owner || w.actor.roles.includes('admin')) && <Agencies v={v} w={w} mutate={mutate} />}
    {!v.imported && v.manages && <ReferralReview v={v} w={w} mutate={mutate} />}
    {!v.imported && v.manages && <JobQuestions v={v} w={w} mutate={mutate} />}
    {!v.imported && <JobFields v={v} w={w} mutate={mutate} />}
    {!v.imported && <JobHiringViews v={v} mutate={mutate} />}
    {!v.imported && v.manages && <Rules v={v} w={w} mutate={mutate} />}
    {v.missing?.length > 0 && !v.imported && <p className="warn">Before approval, add: {v.missing.join(', ')}.</p>}
    {v.status === 'draft' && !v.imported && <details><summary>Edit terms</summary><Terms v={v} w={w} mutate={mutate} /></details>}
    {!v.imported && <Setup v={v} w={w} mutate={mutate} />}
    {v.status === 'draft' && !v.imported && <section className="approval">
      <h3>Approval</h3>
      {v.approval && <p>Latest request: {v.approval.status} by {person(w, v.approval.approver)}{v.approval.reason ? ` (“${v.approval.reason}”)` : ''}{v.approval.version !== v.version ? ' · the terms changed since, so it no longer applies' : ''}</p>}
      {v.approvedNow ? <button className="primary" onClick={() => mutate('publish', { id: v.id })}>Publish application page</button>
        : <Form label="Request approval" compact onSubmit={x => mutate('request-vacancy-approval', { id: v.id, approver: x.approver })}><Field label="Approver" name="approver" options={memberOptions(w.members, 'approver')} /></Form>}
    </section>}
    {v.status === 'open' && <Form label="Unpublish" compact onSubmit={x => mutate('unpublish', { id: v.id, reason: x.reason })}><Field label="Reason for unpublishing" name="reason" /></Form>}
    {!v.imported && v.status !== 'closed' && <VacancyInternal v={v} mutate={mutate} />}
    {(w.actor.owner || w.actor.roles.includes('admin')) && !v.imported && <details><summary>{v.confidential ? 'Confidential job' : 'Make confidential'}</summary>
      <p className="hint">Only the people you name, its hiring team, the owner and holders of “see private” see a confidential job and its candidates. It stays off the careers page unless you give a neutral title.</p>
      <Form label="Save confidentiality" onSubmit={x => mutate('vacancy-privacy', { id: v.id, confidential: x.confidential === true, publicTitle: x.publicTitle, namedPeople: x.namedPeople.split(',').map((e: string) => e.trim()).filter(Boolean) })}>
        <Check name="confidential" label="Confidential" defaultChecked={v.confidential} />
        <Field label="Named people (emails, comma-separated)" name="namedPeople" required={false} defaultValue={(v.namedPeople ?? []).join(', ')} />
        <Field label="Neutral title for the careers page (blank keeps it off)" name="publicTitle" required={false} defaultValue={v.publicTitle} />
      </Form></details>}
    {v.status !== 'closed' && !v.imported && <Form label="Close vacancy" compact onSubmit={x => mutate('close-vacancy', { id: v.id, reason: x.reason })}><Field label="Reason for closing" name="reason" /></Form>}
    {!v.imported && v.manages && <JobOfferTemplate v={v} w={w} mutate={mutate} />}
    {!v.imported && v.manages && <JobCopies v={v} w={w} mutate={mutate} select={select} />}
    <p><a href={`/api/lodge/download/vacancy/${v.id}`}>Export this vacancy’s whole history (JSON)</a></p>
  </section>
}

export function Vacancies({ w, mutate, go, nav }: PageProps) {
  const v = w.vacancies.find((x: D) => x.id === nav.vacancy)
  const select = (id: string) => go('Vacancies', { vacancy: id })
  const mine = w.vacancies.filter((x: D) => x.manages)
  return <div className="page">
    <h1>Vacancies</h1>
    {nav.vacancy === 'new' && <section className="card"><h2>Terms of the new vacancy</h2><p className="hint">An approver sees these terms with the stages, rubric and interview plan as one set; changing any of them later needs a new approval.</p><Terms w={w} mutate={mutate} onSaved={select} /></section>}
    {v && <Detail v={v} w={w} mutate={mutate} go={go} select={select} />}
    {!mine.length && nav.vacancy !== 'new' ? <Empty icon="vacancies" title="No vacancies yet.">Use New vacancy to write the first one: its pay range, headcount and the description applicants will read.</Empty>
      : <Table heads={['Title', 'Status', 'Pay', 'By stage', 'Applications', '']}>{mine.map((x: D) => {
        const apps = w.applications.filter((a: D) => a.vacancy === x.id), stages = columns(x, apps).filter(c => c.id !== 'closed')
        return <tr key={x.id} className={x.id === nav.vacancy ? 'current' : undefined}><td><strong>{x.title}</strong><small>{vacancyFacts(x).join(' · ')}</small></td>
          <td><span className="stage-cell"><VacancyStatus v={x} />{x.status === 'open' && x.publishedAt && <small>open {since(x.publishedAt)}</small>}</span></td><td>{payShort(x.compensation)}</td>
          <td>{apps.length ? <span className="split" title={stages.map(c => `${c.name} ${c.apps.length}`).join(', ')}>{stages.map(c => c.apps.length).join(' · ')}</span> : <small>{x.status === 'open' ? 'None yet' : '—'}</small>}</td>
          <td>{apps.length}{apps.some((a: D) => a.status !== 'active') && <small>{apps.filter((a: D) => a.status !== 'active').length} closed</small>}</td><td><button aria-label={'Open ' + x.title} onClick={() => select(x.id)}>Open</button></td></tr>
      })}</Table>}
    <Sourcing w={w} />
    <OfferTemplates w={w} mutate={mutate} />
    <EsignSettings w={w} mutate={mutate} />
    <Templates w={w} mutate={mutate} />
    <Kickoffs w={w} mutate={mutate} select={select} />
  </div>
}

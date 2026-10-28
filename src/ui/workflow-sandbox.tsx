import type { PageProps } from './app'
import { Check, Field, Form, memberOptions, Status, Table, type D } from './shared'
import { ProviderSetup } from './provider-setup'
import { SandboxRules } from './workflow-sandbox-rules'
import { SandboxFields } from './workflow-sandbox-fields'

function Configuration({ box, w, mutate }: { box: D } & Pick<PageProps, 'w' | 'mutate'>) {
  const c = box.config, criteria = c.rubrics.at(-1)?.criteria ?? []
  return <Form label="Save trial configuration" key={box.updatedAt ?? box.id} onSubmit={x => {
    const stages = x.stages.split('\n').map((name: string, i: number) => ({ ...(c.stages[i] ?? {}), name: name.trim() })).filter((s: D) => s.name)
    const nextCriteria = x.criteria.split('\n').filter(Boolean).map((line: string, i: number) => { const at = line.indexOf('|'); return { ...(criteria[i] ?? {}), name: line.slice(0, at).trim(), description: line.slice(at + 1).trim() } })
    const plan = c.plan.map((p: D) => ({ ...p, name: x['plan-name-' + p.id], stage: x['plan-stage-' + p.id], durationMinutes: x['plan-duration-' + p.id] }))
    const routing = Object.fromEntries(['vacancy', 'offer', 'message'].filter(k => x['route-' + k]).map(k => [k, x['route-' + k]]))
    const questions = w.questions.filter((q: D) => x['question-' + q.id]).map((q: D) => ({ question: q.id, required: x['required-' + q.id] }))
    const edits: D[] = [{ op: 'vacancy-stages', input: { stages } }, { op: 'rubric', input: { criteria: nextCriteria } }, { op: 'interview-plan', input: { plan } }, { op: 'approval-routing', input: { routing, chain: x.chain.split('\n').filter((line: string) => line.trim()).map((line: string) => ({ approvers: line.split('|')[0].split(',').map((email: string) => email.trim()).filter(Boolean), ...(line.includes('|') ? { escalation: { businessDays: Number(line.split('|')[1].trim()), owner: (line.split('|')[2] ?? '').trim() } } : {}) })) } }, { op: 'job-questions', input: { questions } }]
    if (w.providerSetup) {
      const connectors = w.providerSetup.catalog.filter((p: D) => x['connector-' + p.id]).map((p: D) => p.id)
      if (JSON.stringify(connectors) !== JSON.stringify(c.workflowConnectors)) edits.push({ op: 'workflow-connectors', input: { connectors } })
    }
    return mutate('sandbox-edit', { id: box.id, edits })
  }}>
    <Field label="Stage names, in order (one per line)" name="stages" type="textarea" wide defaultValue={c.stages.map((s: D) => s.name).join('\n')} hint="Existing stage identities stay in order. A stage in use cannot be removed." />
    <Field label="Rubric (one criterion per line: name | job-related evidence)" name="criteria" type="textarea" wide defaultValue={criteria.map((k: D) => k.name + ' | ' + k.description).join('\n')} />
    {c.plan.map((p: D) => <fieldset className="wide" key={p.id}><legend>Interview: {p.name}</legend>
      <Field label="Interview name" name={'plan-name-' + p.id} defaultValue={p.name} />
      <Field label="Interview stage" name={'plan-stage-' + p.id} defaultValue={p.stage} options={c.stages.map((s: D) => ({ value: s.id, label: s.name }))} />
      <Field label="Interview duration (minutes)" name={'plan-duration-' + p.id} type="number" defaultValue={p.durationMinutes} />
    </fieldset>)}
    {['vacancy', 'offer', 'message'].map(kind => <Field key={kind} label={kind + ' approval route'} name={'route-' + kind} required={false} defaultValue={c.approvalRouting[kind]} options={memberOptions(w.members, kind === 'message' ? 'manager' : 'approver')} />)}
    <Field label="Headcount approval steps" name="chain" type="textarea" wide required={false} defaultValue={(c.approvalChain?.steps ?? []).map((step: D) => (step.approvers.join(', ') + (step.escalation ? ' | ' + step.escalation.businessDays + ' | ' + step.escalation.owner : ''))).join('\n')} hint="One step per line, using saved approver addresses. Separate people in a parallel step with commas; everyone must approve before the next line. Optionally append | business days | escalation owner to a line. Escalation requests attention without replacing a required decision. Leave empty to use the single-person route." />
    <fieldset className="wide"><legend>Application fields (screening questions)</legend>{w.questions.map((q: D) => <div key={q.id}><Check name={'question-' + q.id} label={q.versions.at(-1).text} defaultChecked={c.questions.some((x: D) => x.question === q.id)} /><Check name={'required-' + q.id} label={'Required: ' + q.versions.at(-1).text} defaultChecked={c.questions.find((x: D) => x.question === q.id)?.required} /></div>)}</fieldset>
    {w.providerSetup && <fieldset className="wide"><legend>Connectors named by this configuration</legend><p>Deployment requires employer-confirmed setup for each selection. Naming a connector creates no account or connection; execution remains unavailable until its integration ships.</p>{w.providerSetup.catalog.map((p: D) => <Check key={p.id} name={'connector-' + p.id} label={p.name} defaultChecked={c.workflowConnectors.includes(p.id)} />)}</fieldset>}
  </Form>
}

function Impact({ box }: { box: D }) {
  const impact = box.preview?.impact
  if (!impact) return null
  const stage = (id: string) => box.config.stages.find((s: D) => s.id === id)?.name ?? id
  return <section aria-label="Sandbox impact" style={{ overflowWrap: 'anywhere' }}><h3>Reviewed impact</h3><p>{impact.explanation}</p>
    <Table heads={['Configuration', 'Current', 'Reviewed change']} empty="Configuration is unchanged.">{impact.changes.map((change: D) => <tr key={change.area}><td style={{ minWidth: '9em' }}>{({ customFields: 'Custom fields', savedViews: 'Team views' } as Record<string, string>)[change.area] ?? change.area}</td><td>{change.before}</td><td>{change.after}</td></tr>)}</Table>
    <Table heads={['Test case', 'Before', 'Expected outcome', 'Actions']}>
      {impact.outcomes.map((o: D) => <tr key={o.case}><td>{o.case}</td><td>{stage(o.before.stage)} · {o.before.status}</td><td>{o.error ? <p role="alert">Trial refused: {o.error}</p> : <>{stage(o.after.stage)} · {o.after.status}</>}<br />{o.views?.map((view: D) => <p key={view.id}>{view.name}: {view.matches ? 'matches' : 'does not match'}</p>)}Reviewers: {o.after.reviewers.join(', ') || 'none'}<br />Tags: {o.after.tags.join(', ') || 'none'}</td><td>{o.rules.map((r: D) => `${r.rule} v${r.version}: ${r.status} — ${r.reason}`).join('; ')}{o.scheduling && <p>{o.scheduling.title} · {o.scheduling.durationMinutes} minutes · {o.scheduling.status} · {o.scheduling.start ?? o.scheduling.slots.join(', ')} · {o.scheduling.timezone}</p>}</td></tr>)}
    </Table><p>Approval routes: {Object.entries(impact.routes).map(([k, v]) => k + ': ' + v).join('; ') || 'Person selected when requesting approval'}</p>
    {impact.approval?.chain && <section aria-label="Headcount chain preview"><h3>Headcount chain preview</h3><ol>{impact.approval.chain.steps.map((step: D, i: number) => <li key={i}>Step {i + 1}: {step.approvers.join(' and ')} · everyone must approve{step.escalation && <> · notify {step.escalation.owner} after {step.escalation.businessDays} business days</>}</li>)}</ol>{impact.approval.delegations?.map((d: D, i: number) => <p key={i}>{d.delegate} on behalf of {d.approver}</p>)}{impact.approval.stepDueAt && <p>Current step escalation due: {impact.approval.stepDueAt} · {impact.approval.timeZone}. Monday to Friday; public holidays are not excluded.</p>}{impact.approval.escalationTrial?.map((e: D) => <p key={e.step}>Isolated due-time trial: escalated to {e.owner}; the approval remains pending.</p>)}<p>Trial result: {impact.approval.status}. No production decision or opening is created.</p>{impact.approval.outcomes?.map((decision: D, i: number) => <p key={i}>{decision.approver}: {decision.error ?? decision.status}</p>)}</section>}
    <p>Production contact: {impact.productionContact}; production signatures: {impact.productionSignatures}; production HR records: {impact.productionHrRecords}.</p>
  </section>
}

export function WorkflowSandbox({ w, mutate }: PageProps) {
  const jobs = w.vacancies.filter((v: D) => v.manages && v.permissions.includes('settings') && !v.imported && v.status !== 'closed')
  return <div className="page"><h1>Workflow sandbox</h1><p>Clone current configuration and choose test inputs. Previews run in isolation. Deploying copies only the reviewed configuration; it never copies test candidates or executes production contact, signatures or HR creation. Published jobs must be unpublished before deployment.</p>
    <Form label="Clone into sandbox" onSubmit={x => mutate('sandbox-create', { name: x.name, vacancy: x.vacancy, mode: x.mode, confirmSynthetic: x.confirmSynthetic, approvalDecisions: JSON.parse(x.approvalDecisions || '[]'), samples: x.mode === 'synthetic' ? JSON.parse(x.samples) : x.history.split(',').map((id: string) => ({ application: id.trim() })).filter((s: D) => s.application) })}>
      <Field label="Sandbox name" name="name" />
      <Field label="Source vacancy" name="vacancy" options={jobs.map((v: D) => ({ value: v.id, label: v.title }))} />
      <Field label="Test data" name="mode" options={[{ value: 'historical', label: 'Selected historical applications' }, { value: 'synthetic', label: 'Explicit synthetic test cases' }]} defaultValue="historical" />
      <Field label="Historical application IDs (comma-separated)" name="history" required={false} hint="Select only the source job's applications listed below. Stored history is never modified." />
      <Field label="Synthetic test cases (JSON array)" name="samples" required={false} type="textarea" wide hint={'Each case: {"label":"your test label","answers":{"question-id":"yes"}}. Optional move: {"to":"stage-id","reason":"trial"}; interview: {"planItem":"plan-id","participants":["member email"],"slots":["ISO instant"],"slot":0}.'} />
      <Field label="Headcount trial decisions (JSON array)" name="approvalDecisions" type="textarea" wide required={false} hint={'Optional ordered decisions: [{"approver":"saved member address","decision":"approved"}]. These run only in the isolated preview.'} />
      <Check name="confirmSynthetic" label="I selected synthetic test data; these are not live candidates or recipients" />
    </Form>
    <details><summary>Applications available to select</summary><Table heads={['Candidate', 'Vacancy', 'Application ID']}>{w.applications.filter((a: D) => jobs.some((v: D) => v.id === a.vacancy)).map((a: D) => <tr key={a.id}><td>{a.candidateName}</td><td>{jobs.find((v: D) => v.id === a.vacancy)?.title}</td><td>{a.id}</td></tr>)}</Table></details>
    {w.sandboxes.map((box: D) => <article className="card" aria-label={'Sandbox ' + box.name} key={box.id}><h2>{box.name}</h2><Status>{box.status}</Status>
      {box.status !== 'deployed' && <><Configuration box={box} w={w} mutate={mutate} /><SandboxRules box={box} w={w} mutate={mutate} /><SandboxFields box={box} w={w} mutate={mutate} />
        <Form label="Preview expected outcomes" compact onSubmit={() => mutate('sandbox-preview', { id: box.id })} /></>}
      <Impact box={box} />
      {box.status === 'review' && <Form label="Deploy this reviewed version" onSubmit={x => mutate('sandbox-deploy', { id: box.id, token: box.preview.token, confirmProduction: x.confirmProduction })}><Check name="confirmProduction" label="I approve this exact reviewed configuration for production" /></Form>}
      {box.status === 'deployed' && <Form label="Rollback prior configuration" compact onSubmit={() => mutate('sandbox-rollback', { id: box.id })} />}
    </article>)}
    <ProviderSetup w={w} mutate={mutate} />
  </div>
}

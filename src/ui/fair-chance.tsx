import type { PageProps } from './app'
import { day, when } from './format'
import { person } from './names'
import { Field, Form, Table, type D } from './shared'

// HIRE-007: fair-chance places (admins) and, on an application, the steps after a conditional offer. Restricted to the
// owner and hiring admins, like accommodation answers. Lodge records what the employer did; it sends no notice itself.

export function FairChanceSettings({ w, mutate }: Pick<PageProps, 'w' | 'mutate'>) {
  const places: D[] = w.fairChance?.places ?? []
  const save = (next: D[]) => mutate('fair-chance-places', { places: next.map(p => ({ place: p.place, waitingDays: Number(p.waitingDays) })) })
  return <section aria-label="Fair-chance places">
    <h2>Fair-chance places</h2>
    <p className="hint">Where your counsel says criminal history may be asked or checked only after a conditional offer. Jobs there never ask criminal-history questions on their application page.</p>
    <Table heads={['Place', 'Waiting period', '']} empty="No fair-chance places yet.">{places.map(p => <tr key={p.place}><td>{p.place}</td><td>{p.waitingDays} days</td><td><Form label="Remove" compact onSubmit={() => save(places.filter(x => x.place !== p.place))} /></td></tr>)}</Table>
    <Form label="Add place" compact reset onSubmit={x => save([...places, { place: x.place, waitingDays: x.waitingDays }])}>
      <Field label="State or city" name="place" hint="For example California, or Philadelphia" />
      <Field label="Waiting period after the pre-adverse notice (days)" name="waitingDays" type="number" defaultValue={5} />
    </Form>
  </section>
}

/** The fair-chance steps of one application, once its conditional offer is recorded. */
export function FairChanceSteps({ app, w, mutate }: { app: D; w: D; mutate: PageProps['mutate'] }) {
  if (!w.fairChance) return null
  const r = w.fairChance.records.find((x: D) => x.application === app.id)
  const conditional = w.offers.some((o: D) => o.application === app.id && o.conditional && (o.status === 'accepted' || o.approvedNow))
  if (!r && !conditional) return null
  const step = (body: D) => mutate('fair-chance-step', { application: app.id, ...body })
  return <section className="decide" aria-label="Fair-chance steps">
    <h3>Fair-chance steps{r ? ` · ${r.place}` : ''}</h3>
    {r?.assessments.map((x: D, i: number) => <p key={i}><strong>Individualized assessment</strong> · {person(w, x.by)} · {when(x.at)}<br />{x.text}</p>)}
    {r?.notice && <p><strong>Pre-adverse notice given by the employer on {day(r.notice.date)}</strong> (recorded here; Lodge sent nothing) · {r.notice.note}<br />A final adverse decision may be recorded from {day(r.adverseFrom)}.</p>}
    {r?.decision ? <p><strong>Final decision: {r.decision.outcome === 'adverse' ? 'adverse' : 'proceed'}</strong> · {person(w, r.decision.by)} · {when(r.decision.at)} · {r.decision.reason}</p> : <>
      <Form label="Record assessment" compact reset onSubmit={x => step({ step: 'assessment', text: x.text })}><Field label="Individualized assessment" name="text" type="textarea" wide /></Form>
      {r?.assessments.length > 0 && !r.notice && <Form label="Record the notice" compact reset onSubmit={x => step({ step: 'pre-adverse-notice', date: x.date, text: x.text })}>
        <Field label="Day the employer gave the pre-adverse notice" name="date" type="date" /><Field label="What it said and how it was given" name="text" />
      </Form>}
      {r?.assessments.length > 0 && <Form label="Record final decision" compact reset onSubmit={x => step({ step: 'final-decision', outcome: x.outcome, text: x.text })}>
        <Field label="Final decision" name="outcome" options={[{ value: 'proceed', label: 'Proceed with the hire' }, ...(r.notice ? [{ value: 'adverse', label: 'Final adverse decision' }] : [])]} /><Field label="Why" name="text" />
      </Form>}
    </>}
  </section>
}

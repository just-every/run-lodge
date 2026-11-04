import type { PageProps } from './app'
import { Field, Form, type D } from './shared'
import { itineraryWords } from '../lodge/candidate/itinerary'
import { when } from './format'

/** Sharing configuration stays in Settings; each field is the exact candidate projection. */
export function CandidateItinerarySettings({ w, nav, mutate }: PageProps) {
  const app = w.applications.find((a: D) => a.id === nav.app)
  const config = w.candidateItineraries?.find((r: D) => r.application === nav.app)
  if (!app || !config) return null
  return <section className="card" aria-label="Candidate itinerary settings"><h2>Candidate itinerary settings</h2><p>{app.candidateName} · Application language: {config.language}</p>
    <p>Sharing is separate from self-scheduling and starts off. Review every field below in the application language. Only checked sessions and explicitly selected display names and titles reach the signed-in candidate.</p>
    <p role="status">{config.current ? 'Reviewed sharing is current.' : config.enabled ? 'Sources changed. Sharing needs a new review.' : 'Itinerary sharing is off.'}</p>
    {app.status === 'active' && <Form key={config.source + ':' + config.version} label="Review and share itinerary" onSubmit={x => mutate('candidate-itinerary-review', { application: app.id, enabled: true, reviewed: !!x.reviewed, version: config.version, source: config.source, language: config.language, copy: Object.fromEntries(itineraryWords.map(key => [key, x['copy-' + key]])), sessions: config.sessions.filter((iv: D) => x['share-' + iv.id]).map((iv: D) => ({ interview: iv.id, title: x['title-' + iv.id], location: x['location-' + iv.id], panel: iv.panel.filter((p: D, i: number) => x['panel-' + iv.id + '-' + i]).map((p: D) => ({ member: p.member, name: x['name-' + iv.id + '-' + iv.panel.indexOf(p)], title: x['role-' + iv.id + '-' + iv.panel.indexOf(p)] })) })) })}>
      <details><summary>Review candidate page labels</summary>{itineraryWords.map(key => <Field key={key} label={'Candidate label: ' + key} name={'copy-' + key} defaultValue={config.copy?.[key] ?? ''} wide />)}</details>
      {config.sessions.map((iv: D) => <fieldset key={iv.id} className="wide"><legend>{iv.title}</legend><p>{when(iv.start)} · {iv.durationMinutes} min · {iv.status}</p>
        <label className="check"><input type="checkbox" name={'share-' + iv.id} defaultChecked={!!iv.reviewed} /> Share this scheduled session</label>
        <Field label={'Candidate title: ' + iv.title} name={'title-' + iv.id} defaultValue={iv.reviewed?.title ?? iv.title} required={false} />
        <Field label={'Candidate location: ' + iv.title} name={'location-' + iv.id} defaultValue={iv.reviewed?.location ?? iv.location} required={false} />
        {iv.panel.map((p: D, i: number) => { const approved = iv.reviewed?.panel.find((entry: D) => entry.member === p.member); return <div key={p.member}><label className="check"><input type="checkbox" name={'panel-' + iv.id + '-' + i} defaultChecked={!!approved} disabled={!p.active} /> Approve display identity for {p.name}</label><Field label={'Display name: ' + iv.title + ' ' + p.name} name={'name-' + iv.id + '-' + i} defaultValue={approved?.name ?? p.name} required={false} /><Field label={'Display title: ' + iv.title + ' ' + p.name} name={'role-' + iv.id + '-' + i} defaultValue={approved?.title} required={false} /></div> })}
      </fieldset>)}
      <label className="check"><input type="checkbox" name="reviewed" required /> I reviewed the exact candidate fields, language, times, durations and states shown here.</label>
    </Form>}
    {config.enabled && <Form label="Disable itinerary sharing" onSubmit={() => mutate('candidate-itinerary-review', { application: app.id, enabled: false, version: config.version })} />}
    <p>No notices are sent. Provider calendars, video creation and delivered reminders remain separate.</p><p><a href={'/app?application=' + app.id}>Back to application</a></p>
  </section>
}

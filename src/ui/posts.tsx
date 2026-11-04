import { PostTranslation } from './post-translation'
import type { PageProps } from './app'
import { when } from './format'
import { Check, Field, Form, Status, Table, type D } from './shared'

// ATTR-012: a job's posts. Each has its own title, description, locations from
// the job's approved offices, extra questions and destinations, and goes live,
// pauses or closes on its own; pay, headcount, stages, rubric and team stay the job's.

const WHERE: [string, string][] = [['careers', 'On the hosted careers page'], ['embed', 'In the embedded board'], ['api', 'Through the board API'], ['linkedin', 'In the LinkedIn native feed'], ['indeed', 'In the Indeed native feed']]
const TONE: D = { live: 'good', paused: 'warn', draft: 'neutral', closed: 'neutral' }
const SAID: D = { live: 'live', paused: 'paused', draft: 'not live yet', closed: 'closed' }

function PostForm({ v, w, post, mutate }: { v: D; w: D; post?: D; mutate: PageProps['mutate'] }) {
  const offices: string[] = [v.officeId, ...(v.locations ?? [])].filter(Boolean)
  const extra: D[] = (w.questions ?? []).filter((q: D) => !(v.questions ?? []).some((x: D) => x.question === q.id))
  return <Form label={post ? 'Save post' : 'Add post'} reset={!post} onSubmit={x => mutate('job-post', {
    vacancy: v.id, post: post?.id, title: x.postTitle, description: x.postText, language: x.language === 'other' ? x.languageTag : x.language,
    locations: offices.filter(id => x['at-' + id]), destinations: WHERE.map(([k]) => k).filter(k => x['on-' + k]),
    questions: extra.filter(q => x['ask-' + q.id]).map(q => ({ question: q.id })),
  })}>
    <Field label="Post language" name="language" defaultValue={post && !['en', 'es'].includes(post.language) ? 'other' : post?.language ?? 'en'} options={[{ value: 'en', label: 'English' }, { value: 'es', label: 'Español' }, { value: 'other', label: 'Another language' }]} />
    <Field label="Other language tag (for Another language)" name="languageTag" required={false} defaultValue={post && !['en', 'es'].includes(post.language) ? post.language : ''} hint="For example fr for French or de for German. Complete and review its application and receipt text before publishing." />
    <Field label="Post title" name="postTitle" defaultValue={post?.title ?? v.title} />
    <Field label="What this post says to applicants" name="postText" type="textarea" wide required={false} defaultValue={post?.description ?? v.description} />
    <fieldset className="wide"><legend>Where the post is (approved offices only)</legend>
      {offices.map(id => <Check key={id} name={'at-' + id} label={w.offices?.find((o: D) => o.id === id)?.name ?? id} defaultChecked={post ? post.locations.includes(id) : offices.length === 1} />)}</fieldset>
    <fieldset className="wide"><legend>Where it appears</legend>
      {WHERE.map(([k, label]) => <Check key={k} name={'on-' + k} label={label} defaultChecked={post ? post.destinations.includes(k) : ['careers', 'embed', 'api'].includes(k)} />)}
      <small>Native feeds also need separate human-reviewed opt-in under Settings and a hosted careers destination. Spanish posts need an employer-reviewed translation before going live.</small></fieldset>
    {extra.length > 0 && <fieldset className="wide"><legend>Extra questions on this post</legend>
      {extra.map(q => <Check key={q.id} name={'ask-' + q.id} label={q.versions.at(-1).text} defaultChecked={post?.questions?.some((x: D) => x.question === q.id)} />)}</fieldset>}
  </Form>
}

export function Posts({ v, w, mutate }: { v: D } & Pick<PageProps, 'w' | 'mutate'>) {
  const posts: D[] = v.posts ?? []
  const live = !v.imported && v.status !== 'closed'
  const offices: string[] = [v.officeId, ...(v.locations ?? [])].filter(Boolean)
  const name = (id: string) => w.offices?.find((o: D) => o.id === id)?.name ?? id
  const apps = (p: D) => w.applications.filter((a: D) => a.post === p.id).length
  return <section className="posts" aria-label="Job posts">
    <h3>Job posts</h3>
    <p className="hint">One job can carry several posts, each with its own title, wording and approved locations. Once a post goes live, applicants reach this job only through its live posts.</p>
    {posts.length > 0 && <Table heads={['Post', 'Where', 'Appears', 'Status', 'Applications']}>{posts.map(p => <tr key={p.id}>
      <td><strong>{p.title}</strong>{p.status === 'live' && v.status === 'open' && p.destinations.includes('careers') && <small><a href={`/jobs/${p.slug}`}>/jobs/{p.slug}</a></small>}</td>
      <td>{p.locations.map(name).join(', ')}</td><td>{WHERE.filter(([k]) => p.destinations.includes(k)).map(([, l]) => l.replace(/^(On|In|Through) the /, '')).join(', ')}</td>
      <td><Status tone={TONE[p.status]}>{SAID[p.status]}</Status>{p.history?.length ? <small>since {when(p.history.at(-1).at)}</small> : null}</td><td>{apps(p)}</td>
    </tr>)}</Table>}
    {live && v.manages && posts.filter(p => p.status !== 'closed').map(p => <details key={p.id}><summary>Change post “{p.title}”</summary>
      <div className="form-end">
        {p.status !== 'live' && v.status === 'open' && <Form label="Go live" compact onSubmit={() => mutate('post-status', { vacancy: v.id, post: p.id, status: 'live' })} />}
        {p.status === 'live' && <Form label="Pause post" compact onSubmit={() => mutate('post-status', { vacancy: v.id, post: p.id, status: 'paused' })} />}
        <Form label="Close post" compact onSubmit={() => mutate('post-status', { vacancy: v.id, post: p.id, status: 'closed' })} />
      </div>
      <PostForm v={v} w={w} post={p} mutate={mutate} />
      {p.language !== 'en' && <PostTranslation v={v} w={w} post={p} mutate={mutate} />}
    </details>)}
    {live && v.manages && (offices.length
      ? <details><summary>Add a post</summary><PostForm v={v} w={w} mutate={mutate} /></details>
      : <p className="empty">Choose the job’s office (and any other approved offices) in its terms to add posts.</p>)}
  </section>
}


/** Feed configuration stays under Settings and uses the existing labelled form components. */
export function FreeFeedSettings({ w, mutate }: Pick<PageProps, 'w' | 'mutate'>) {
  const jobs: D[] = w.vacancies.filter((v: D) => w.freeFeedSettings?.some((x: D) => x.vacancy === v.id) && !v.imported && v.status !== 'closed')
  if (w.actor.agent || !(w.actor.owner || w.actor.roles.includes('admin'))) return null
  return <section aria-label="Free job-board feeds" className="card">
    <h2>Free job-board feeds</h2>
    <p>Serve employer-selected native XML. Provider enrollment, Company Page permission, acceptance and remote listings require separate authorization. Feed links record declared source only.</p>
    <p><a href="/careers/feeds/linkedin.xml">LinkedIn XML</a> · <a href="/careers/feeds/indeed.xml">Indeed XML</a></p>
    {jobs.map(v => <details key={v.id}><summary>Feed settings for {v.title}</summary>
      {w.freeFeedSettings.find((x: D) => x.vacancy === v.id).targets.map((target: D) => <details key={target.post ?? 'job'}><summary>{target.post ? 'Post: ' : 'Job: '}{target.title}</summary>
        <p>{target.content.description}</p><p style={{ whiteSpace: 'pre-line' }}>{target.content.pay}</p><p>Employment type: {target.content.employmentType}</p>
        {target.boards.map((item: D) => {
          const c = item.config ?? {}, post = v.posts?.find((p: D) => p.id === target.post)
          const offices: string[] = post?.locations ?? [v.officeId, ...(v.locations ?? [])].filter(Boolean)
          return <details key={item.board}><summary>{item.board === 'linkedin' ? 'LinkedIn Limited Listings' : 'Indeed organic'} — {item.status}</summary>
            {c.version && <p>Configuration version {c.version}. Reviewed {when(c.reviewedAt)}. Earlier versions remain in the hiring record.</p>}
            <Form key={String(c.version) + target.source} label="Save reviewed feed configuration" onSubmit={x => mutate('free-feed', {
              vacancy: v.id, post: target.post, board: item.board, version: c.version ?? 0, source: target.source,
              enabled: x.enabled, reviewed: x.reviewed, companyName: x.companyName, companyUrl: x.companyUrl,
              companyId: x.companyId, posterEmail: x.posterEmail, creditKind: x.creditKind, creditWho: x.creditWho,
              locations: offices.map(id => ({ officeId: id, city: x['city-' + id], state: x['state-' + id], country: x['country-' + id], postalCode: x['postal-' + id], streetAddress: x['street-' + id] })),
            })}>
              <Check name="enabled" label="Opt this listing into this native feed" defaultChecked={!!c.enabled} />
              <Field name="companyName" label="Employer name for this feed" defaultValue={c.companyName ?? w.business.name} required={false} />
              <Field name="companyUrl" label="Employer HTTPS website" defaultValue={c.companyUrl} required={false} />
              {item.board === 'linkedin' && <Field name="companyId" label="Actual LinkedIn Company ID" defaultValue={c.companyId} required={false} hint="Supply the employer’s numeric Company Page ID. This does not establish provider authorization." />}
              <Field name="posterEmail" label="Public feed contact email" defaultValue={c.posterEmail} type="email" required={false} hint="The board requires its employer contact. Enabling includes this address in public XML." />
              {offices.map(id => {
                const loc = c.locations?.find((x: D) => x.officeId === id) ?? {}
                return <fieldset key={id} className="wide"><legend>{w.offices.find((o: D) => o.id === id)?.name ?? id}</legend>
                  <Field name={'city-' + id} label="Feed city" defaultValue={loc.city} required={false} />
                  <Field name={'state-' + id} label="Feed US state abbreviation" defaultValue={loc.state} required={false} />
                  <Field name={'country-' + id} label="Feed country code" defaultValue={loc.country} required={false} />
                  <Field name={'postal-' + id} label="Feed postal code if on careers page" defaultValue={loc.postalCode} required={false} />
                  <Field name={'street-' + id} label="Feed street address if on careers page" defaultValue={loc.streetAddress} required={false} />
                </fieldset>
              })}
              <Field name="creditKind" label="Optional CRM credit kind" defaultValue={c.credit?.kind ?? 'sourcer'} options={[{ value: 'sourcer', label: 'Sourcer' }, { value: 'recruiter', label: 'Recruiter' }]} />
              <Field name="creditWho" label="Optional credited current member" defaultValue={c.credit?.who} required={false} options={w.members.filter((m: D) => m.active && !m.agent).map((m: D) => ({ value: m.email, label: m.name }))} />
              <Check name="reviewed" label="I reviewed this exact content and the supplied public feed metadata" />
            </Form>
          </details>
        })}
      </details>)}
    </details>)}
    {!jobs.length && <p>Create a native job before configuring a feed.</p>}
  </section>
}

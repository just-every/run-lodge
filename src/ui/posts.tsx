import type { PageProps } from './app'
import { when } from './format'
import { Check, Field, Form, Status, Table, type D } from './shared'

// ATTR-012: a job's posts. Each has its own title, description, locations from
// the job's approved offices, extra questions and destinations, and goes live,
// pauses or closes on its own; pay, headcount, stages, rubric and team stay the job's.

const WHERE: [string, string][] = [['careers', 'On the hosted careers page'], ['embed', 'In the embedded board'], ['api', 'Through the board API']]
const TONE: D = { live: 'good', paused: 'warn', draft: 'neutral', closed: 'neutral' }
const SAID: D = { live: 'live', paused: 'paused', draft: 'not live yet', closed: 'closed' }

function PostForm({ v, w, post, mutate }: { v: D; w: D; post?: D; mutate: PageProps['mutate'] }) {
  const offices: string[] = [v.officeId, ...(v.locations ?? [])].filter(Boolean)
  const extra: D[] = (w.questions ?? []).filter((q: D) => !(v.questions ?? []).some((x: D) => x.question === q.id))
  return <Form label={post ? 'Save post' : 'Add post'} reset={!post} onSubmit={x => mutate('job-post', {
    vacancy: v.id, post: post?.id, title: x.postTitle, description: x.postText, language: 'en',
    locations: offices.filter(id => x['at-' + id]), destinations: WHERE.map(([k]) => k).filter(k => x['on-' + k]),
    questions: extra.filter(q => x['ask-' + q.id]).map(q => ({ question: q.id })),
  })}>
    <Field label="Post title" name="postTitle" defaultValue={post?.title ?? v.title} />
    <Field label="What this post says to applicants" name="postText" type="textarea" wide required={false} defaultValue={post?.description ?? v.description} />
    <fieldset className="wide"><legend>Where the post is (approved offices only)</legend>
      {offices.map(id => <Check key={id} name={'at-' + id} label={w.offices?.find((o: D) => o.id === id)?.name ?? id} defaultChecked={post ? post.locations.includes(id) : offices.length === 1} />)}</fieldset>
    <fieldset className="wide"><legend>Where it appears</legend>
      {WHERE.map(([k, label]) => <Check key={k} name={'on-' + k} label={label} defaultChecked={post ? post.destinations.includes(k) : true} />)}
      <small>Job boards join this list as their connections arrive. Posts are in English; Spanish comes with translated posts.</small></fieldset>
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
    </details>)}
    {live && v.manages && (offices.length
      ? <details><summary>Add a post</summary><PostForm v={v} w={w} mutate={mutate} /></details>
      : <p className="empty">Choose the job’s office (and any other approved offices) in its terms to add posts.</p>)}
  </section>
}

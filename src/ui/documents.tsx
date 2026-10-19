import { DocumentViewer, applicationDocuments } from './document-viewer'
import type { PageProps } from './app'
import { sentence } from './names'
import { Field, fileFrom, Form, readFile, type D } from './shared'

const kind = (k: string) => sentence(k.replace(/-/g, ' '))

export function Documents({ app, w, mutate }: { app: D; w: D; mutate: PageProps['mutate'] }) {
  const docs = applicationDocuments(app, w)
  return <section className="card">
    <h3>Documents</h3>
    {docs.length ? <ul>{docs.map((d: D) => <li key={d.id}><a href={`/api/lodge/download/document/${d.id}`}>{d.name}</a> · {kind(d.kind)}{d.restricted ? ' · restricted' : ''} · {Math.ceil(d.size / 1024)} KB</li>)}</ul> : <p className="empty">No documents you can see.</p>}
    <DocumentViewer documents={docs} />
    {app.manages && <Form label="Upload document" compact reset onSubmit={async (x, form) => {
      const file = fileFrom(form, 'file')
      if (!file) throw new Error('Choose a file')
      await mutate('document', { application: app.id, kind: x.kind, restricted: x.restricted === true, ...await readFile(file) })
    }}>
      <label>File<input type="file" name="file" required /></label>
      <Field label="Kind" name="kind" defaultValue="other" options={['resume', 'cover-letter', 'portfolio', 'work-sample', 'right-to-work', 'offer', 'other'].map(k => ({ value: k, label: kind(k) }))} />
      <label className="check"><input type="checkbox" name="restricted" /> Restricted (owner and hiring admins only)</label>
    </Form>}
  </section>
}
